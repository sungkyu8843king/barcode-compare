import { NextRequest, NextResponse } from 'next/server'
import { getProduct, upsertProduct, getRecentPrices, insertPrices, insertSearchLog, getCatalogMap, saveCatalogMap } from '@/lib/db'
import { getCachedPrices, setCachedPrices, getCachedProduct, setCachedProduct } from '@/lib/redis'
import { searchByBarcode } from '@/lib/naver-shopping'
import { lookupOpenFoodFacts, lookupUPCItemDB, lookupFoodsafety } from '@/lib/open-food-facts'
import { searchCoupang } from '@/lib/coupang'
import { auth } from '@/lib/auth'
import { checkGuestLimit, checkUserLimit, DAILY_LIMITS } from '@/lib/rate-limit'
import { BarcodeSearchResult, Product, PriceSnapshot } from '@/types'
import { parseProductName } from '@/lib/claude-ai'

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
        // 한국 바코드(880*)는 식품안전나라 우선, 그 다음 OFF → UPC Item DB
        const fsProduct = await lookupFoodsafety(barcode)
        const offProduct = fsProduct?.name ? null : await lookupOpenFoodFacts(barcode)
        const extProduct = fsProduct?.name ? fsProduct
          : offProduct?.name ? offProduct
          : await lookupUPCItemDB(barcode)

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
        const nameIsEnglish = product?.name ? !/[가-힣]/.test(product.name) : false

        // 저장된 카탈로그 매핑 조회
        const catalogMap = await getCatalogMap(barcode)

        // 네이버 먼저 → Naver 추론 브랜드를 쿠팡에 활용
        const coupangQuery = (product?.name && !nameIsEnglish) ? product.name : (product?.name || barcode)
        const naverResult = await searchByBarcode(barcode, product?.name || undefined, product?.brand || undefined, (product as any)?.spec || undefined, catalogMap?.naver_product_id)

        // 쿠팡: DB 브랜드 먼저, 결과 없으면 Naver 추론 브랜드로 재시도, 그래도 없으면 Naver 추론 전체 상품명으로 재시도
        let coupangResult = await searchCoupang(coupangQuery, barcode, product?.brand || undefined)
        if (coupangResult.prices.length === 0 && naverResult.inferredBrand && naverResult.inferredBrand !== product?.brand) {
          coupangResult = await searchCoupang(coupangQuery, barcode, naverResult.inferredBrand)
        }
        if (coupangResult.prices.length === 0 && naverResult.inferredName && naverResult.inferredName !== coupangQuery) {
          coupangResult = await searchCoupang(naverResult.inferredName, barcode, undefined)
        }

        naverResult.prices = [...naverResult.prices, ...coupangResult.prices]

        // 네이버 결과에서 한국어 이름 추출 → 영어 이름 덮어쓰기
        const naverKoreanName = naverResult.inferredName && /[가-힣]/.test(naverResult.inferredName)
          ? naverResult.inferredName : null

        if (naverResult.prices.length > 0) {
          if (!product) {
            // 신규 등록: Claude로 제품명 정제 후 저장
            const rawName = naverKoreanName || naverResult.inferredName || barcode
            let finalName = rawName
            let finalBrand = naverResult.inferredBrand
            let finalSpec = naverResult.inferredSpec

            if (rawName !== barcode && process.env.ANTHROPIC_API_KEY) {
              const parsed = await parseProductName(rawName, barcode)
              if (parsed?.name) {
                finalName = parsed.name
                finalBrand = parsed.brand || finalBrand
                finalSpec = parsed.spec || finalSpec
              }
            }

            const inserted = await upsertProduct({
              barcode,
              name: finalName,
              brand: finalBrand,
              category: naverResult.inferredCategory,
              image_url: naverResult.inferredImage,
              spec: finalSpec,
            })
            product = inserted as Product
            if (product) await setCachedProduct(barcode, product)
          } else if (naverKoreanName && nameIsEnglish && product) {
            // 기존 영어 이름 → Claude 정제 후 한국어로 교체 (비동기)
            const newImageUrl = product.image_url || naverResult.inferredImage
            const refineAndSave = async () => {
              let cleanName = naverKoreanName
              let cleanBrand = product!.brand
              let cleanSpec = naverResult.inferredSpec
              if (process.env.ANTHROPIC_API_KEY) {
                const parsed = await parseProductName(naverKoreanName, barcode)
                if (parsed?.name) {
                  cleanName = parsed.name
                  cleanBrand = parsed.brand || cleanBrand
                  cleanSpec = parsed.spec || cleanSpec
                }
              }
              const updated = await upsertProduct({ barcode, name: cleanName, brand: cleanBrand, category: product!.category, image_url: newImageUrl, spec: cleanSpec })
              if (updated) setCachedProduct(barcode, updated)
            }
            refineAndSave().catch(console.error)
            product = { ...product, name: naverKoreanName }
          } else {
            // spec 없는 기존 제품 → 네이버 결과에서 추출해서 보완 (비동기)
            const needsSpec = !(product as any).spec && naverResult.inferredSpec
            const needsImage = naverResult.inferredImage && (!product.image_url || naverResult.inferredImageIsOfficial)
            if (needsSpec || needsImage) {
              upsertProduct({
                barcode,
                name: product.name,
                brand: product.brand,
                category: product.category,
                image_url: needsImage ? naverResult.inferredImage : product.image_url,
                spec: naverResult.inferredSpec,
              })
                .then(updated => { if (updated) setCachedProduct(barcode, updated) })
                .catch(console.error)
              product = { ...product, image_url: needsImage ? naverResult.inferredImage! : product.image_url }
            }
          }

          insertPrices(naverResult.prices).catch(console.error)
          prices = naverResult.prices
          await setCachedPrices(barcode, naverResult.prices)

          // 새로 발견된 카탈로그 productId 저장 (없을 때만)
          if (naverResult.naverProductId && !catalogMap?.naver_product_id) {
            saveCatalogMap(barcode, naverResult.naverProductId).catch(console.error)
          }
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
