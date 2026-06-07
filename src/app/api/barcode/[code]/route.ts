import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
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
    // 1. 제품 정보 조회 (캐시 → DB → 외부 API)
    let product: Product | null = null
    let productCached = false

    const cachedProduct = await getCachedProduct(barcode)
    if (cachedProduct) {
      product = typeof cachedProduct === 'string' ? JSON.parse(cachedProduct) : cachedProduct as Product
      productCached = true
    } else {
      const { data } = await supabaseAdmin
        .from('products')
        .select('*')
        .eq('barcode', barcode)
        .single()

      if (data) {
        product = data
        await setCachedProduct(barcode, data)
      } else {
        // DB에 없으면 Open Food Facts에서 조회
        const offProduct = await lookupOpenFoodFacts(barcode)
        if (offProduct) {
          const { data: inserted } = await supabaseAdmin
            .from('products')
            .upsert({ ...offProduct, barcode })
            .select()
            .single()
          product = inserted
          if (inserted) await setCachedProduct(barcode, inserted)
        }
      }
    }

    // 2. 가격 정보 조회 (캐시 → DB → 실시간 크롤)
    let prices: PriceSnapshot[] = []
    let pricesCached = false

    const cachedPrices = await getCachedPrices(barcode)
    if (cachedPrices) {
      prices = typeof cachedPrices === 'string' ? JSON.parse(cachedPrices) : cachedPrices as PriceSnapshot[]
      pricesCached = true
    } else {
      // DB에서 최근 1시간 이내 가격 조회
      const { data: dbPrices } = await supabaseAdmin
        .from('price_snapshots')
        .select('*')
        .eq('barcode', barcode)
        .gte('fetched_at', new Date(Date.now() - 60 * 60 * 1000).toISOString())
        .order('fetched_at', { ascending: false })

      if (dbPrices && dbPrices.length > 0) {
        prices = dbPrices
        await setCachedPrices(barcode, dbPrices)
      } else {
        // 실시간 네이버 검색
        const queryName = product?.name || barcode
        const naverPrices = await searchByBarcode(barcode, queryName)

        if (naverPrices.length > 0) {
          // DB 저장 (비동기, 응답 블로킹 없음)
          supabaseAdmin
            .from('price_snapshots')
            .insert(naverPrices.map(p => ({ ...p, id: undefined })))
            .then(() => {})

          prices = naverPrices
          await setCachedPrices(barcode, naverPrices)
        }
      }
    }

    // 3. 최저/최고가 계산
    const sortedPrices = [...prices].sort((a, b) => a.price - b.price)
    const lowestPrice = sortedPrices[0] || null
    const highestPrice = sortedPrices[sortedPrices.length - 1] || null

    const result: BarcodeSearchResult = {
      product,
      prices,
      lowestPrice,
      highestPrice,
      cached: productCached && pricesCached,
      fetchedAt: new Date().toISOString(),
    }

    return NextResponse.json(result)
  } catch (error) {
    console.error('[barcode API] 오류:', error)
    return NextResponse.json({ error: '서버 오류가 발생했습니다.' }, { status: 500 })
  }
}
