import { NextRequest, NextResponse } from 'next/server'
import { getProduct, upsertProduct, getRecentPrices, insertPrices, insertSearchLog } from '@/lib/db'
import { getCachedPrices, setCachedPrices, getCachedProduct, setCachedProduct } from '@/lib/redis'
import { searchByBarcode } from '@/lib/naver-shopping'
import { lookupOpenFoodFacts, lookupUPCItemDB } from '@/lib/open-food-facts'
import { searchCoupang } from '@/lib/coupang'
import { auth } from '@/lib/auth'
import { checkGuestLimit, checkUserLimit, DAILY_LIMITS } from '@/lib/rate-limit'
import { BarcodeSearchResult, Product, PriceSnapshot } from '@/types'

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ code: string }> }
) {
  const { code: barcode } = await params

  if (!/^\d{8,14}$/.test(barcode)) {
    return NextResponse.json({ error: '유효하지 않은 바코드 형식입니다.' }, { status: 400 })
  }

  // 검색 횟수 제한 체크
  try {
    const session = await auth()
    if (session?.user?.email) {
      const { allowed, remaining, tier } = await checkUserLimit(session.user.email)
      if (!allowed) {
        return NextResponse.json({
          error: `일일 검색 한도 초과 (${tier === 'free' ? '로그인' : '기부'} 회원: ${DAILY_LIMITS[tier]}회/일)`,
          limitExceeded: true,
          tier,
        }, { status: 429 })
      }
    } else {
      const ip = req.headers.get('x-forwarded-for')?.split(',')[0] || '127.0.0.1'
      const { allowed, remaining } = await checkGuestLimit(ip)
      if (!allowed) {
        return NextResponse.json({
          error: `비회원 일일 검색 한도 초과 (${DAILY_LIMITS.guest}회/일). 카카오 로그인 시 ${DAILY_LIMITS.free}회 이용 가능`,
          limitExceeded: true,
          tier: 'guest',
        }, { status: 429 })
      }
    }
  } catch (e) {
    console.error('[rate-limit] 오류:', e)
  }

  try {
    // 1. 제품 정보 (캐시 → DB → Open Food Facts)
    let product: Product | null = null
    let productCached = false

    const cachedProduct = await getCachedProduct(barcode)
    if (cachedProduct) {
      product = typeof cachedProduct === 'string' ? JSON.parse(cachedProduct) : cachedProduct as Product
      productCached = true
    } else {
      product = await getProduct(barcode) as Product | null

      if (!product) {
        // OFF → UPC Item DB 순서로 조회
        const offProduct = await lookupOpenFoodFacts(barcode)
        const extProduct = offProduct?.name ? offProduct : await lookupUPCItemDB(barcode)
        if (extProduct?.name) {
          product = await upsertProduct({
            barcode,
            name: extProduct.name,
            brand: extProduct.brand,
            category: extProduct.category,
            image_url: extProduct.image_url,
          }) as Product
        }
      }

      if (product) await setCachedProduct(barcode, product)
    }

    // 2. 가격 정보 (캐시 → DB → 네이버 실시간)
    let prices: PriceSnapshot[] = []
    let pricesCached = false

    const cachedPrices = await getCachedPrices(barcode)
    if (cachedPrices) {
      prices = typeof cachedPrices === 'string' ? JSON.parse(cachedPrices) : cachedPrices as PriceSnapshot[]
      pricesCached = true
    } else {
      const dbPrices = await getRecentPrices(barcode)

      if (dbPrices.length > 0) {
        prices = dbPrices as PriceSnapshot[]
        await setCachedPrices(barcode, dbPrices)
      } else {
        const isKoreanBarcode = barcode.startsWith('880')
        const nameIsEnglish = product?.name ? !/[가-힣]/.test(product.name) : false
        // 영어 이름이거나 이름 없으면 바코드로 검색, 한국어 이름 있으면 이름으로 검색
        const queryName = (product?.name && !nameIsEnglish) ? product.name : barcode

        // 네이버 + 쿠팡 병렬 조회
        const [naverResult, coupangResult] = await Promise.all([
          searchByBarcode(barcode, queryName, isKoreanBarcode && nameIsEnglish ? product?.name : undefined),
          searchCoupang(queryName !== barcode ? queryName : (product?.name || barcode), barcode),
        ])

        naverResult.prices = [...naverResult.prices, ...coupangResult.prices]

        // 네이버 결과에서 한국어 이름 추출 → 영어 이름 덮어쓰기
        const naverKoreanName = naverResult.inferredName && /[가-힣]/.test(naverResult.inferredName)
          ? naverResult.inferredName : null

        if (naverResult.prices.length > 0) {
          if (!product) {
            // 신규 등록: 한국어 이름 + 네이버 이미지 저장
            const name = naverKoreanName || naverResult.inferredName || barcode
            const inserted = await upsertProduct({
              barcode,
              name,
              brand: naverResult.inferredBrand,
              category: naverResult.inferredCategory,
              image_url: naverResult.inferredImage,
            })
            product = inserted as Product
            if (product) await setCachedProduct(barcode, product)
          } else if (naverKoreanName && nameIsEnglish) {
            // 기존 영어 이름 → 한국어로 교체, 이미지도 없으면 추가 (비동기)
            const newImageUrl = product.image_url || naverResult.inferredImage
            upsertProduct({ barcode, name: naverKoreanName, brand: product.brand, category: product.category, image_url: newImageUrl })
              .then(updated => { if (updated) setCachedProduct(barcode, updated) })
              .catch(console.error)
            product = { ...product, name: naverKoreanName }
          } else if (!product.image_url && naverResult.inferredImage) {
            // 이미지 없는 기존 제품 → 네이버 이미지 추가 (비동기)
            upsertProduct({ barcode, name: product.name, brand: product.brand, category: product.category, image_url: naverResult.inferredImage })
              .then(updated => { if (updated) setCachedProduct(barcode, updated) })
              .catch(console.error)
            product = { ...product, image_url: naverResult.inferredImage }
          }

          insertPrices(naverResult.prices).catch(console.error)
          prices = naverResult.prices
          await setCachedPrices(barcode, naverResult.prices)
        }
      }
    }

    const sortedPrices = [...prices].sort((a, b) => a.price - b.price)

    const result: BarcodeSearchResult = {
      product,
      prices,
      lowestPrice: sortedPrices[0] || null,
      highestPrice: sortedPrices[sortedPrices.length - 1] || null,
      cached: productCached && pricesCached,
      fetchedAt: new Date().toISOString(),
    }

    // 검색 기록 저장 (응답 전에 완료해야 카운트가 정확함)
    await insertSearchLog(barcode, product?.name ?? null, product?.image_url ?? null)

    return NextResponse.json(result)
  } catch (error) {
    console.error('[barcode API] 오류:', error)
    return NextResponse.json({ error: '서버 오류가 발생했습니다.' }, { status: 500 })
  }
}
