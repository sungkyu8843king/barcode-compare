import { NextRequest, NextResponse } from 'next/server'
import { getProduct, upsertProduct, getRecentPrices, insertPrices } from '@/lib/db'
import { getCachedPrices, setCachedPrices, getCachedProduct, setCachedProduct } from '@/lib/redis'
import { searchByBarcode } from '@/lib/naver-shopping'
import { lookupOpenFoodFacts } from '@/lib/open-food-facts'
import { BarcodeSearchResult, Product, PriceSnapshot } from '@/types'

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ code: string }> }
) {
  const { code: barcode } = await params

  if (!/^\d{8,14}$/.test(barcode)) {
    return NextResponse.json({ error: '유효하지 않은 바코드 형식입니다.' }, { status: 400 })
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
        const offProduct = await lookupOpenFoodFacts(barcode)
        if (offProduct && offProduct.name) {
          product = await upsertProduct({
            barcode,
            name: offProduct.name,
            brand: offProduct.brand,
            category: offProduct.category,
            image_url: offProduct.image_url,
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
        const queryName = product?.name || barcode
        const naverResult = await searchByBarcode(barcode, queryName)

        if (naverResult.prices.length > 0) {
          // 제품이 DB에 없으면 네이버 결과에서 추출한 정보로 등록
          if (!product) {
            const name = naverResult.inferredName || barcode
            const inserted = await upsertProduct({
              barcode,
              name,
              brand: naverResult.inferredBrand,
              category: naverResult.inferredCategory,
            })
            product = inserted as Product
            if (product) await setCachedProduct(barcode, product)
          }
          // 비동기 저장 (응답 블로킹 없음)
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

    return NextResponse.json(result)
  } catch (error) {
    console.error('[barcode API] 오류:', error)
    return NextResponse.json({ error: '서버 오류가 발생했습니다.' }, { status: 500 })
  }
}
