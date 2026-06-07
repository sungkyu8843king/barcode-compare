import { NextRequest, NextResponse } from 'next/server'
import { getProduct, upsertProduct, insertPrices, insertProductRequest } from '@/lib/db'
import { setCachedProduct } from '@/lib/redis'
import { searchByBarcode } from '@/lib/naver-shopping'
import { lookupOpenFoodFacts, lookupUPCItemDB } from '@/lib/open-food-facts'

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}))
  const { barcode, imageData } = body as { barcode?: string; imageData?: string }

  if (!barcode || !/^\d{8,14}$/.test(barcode)) {
    return NextResponse.json({ error: '유효하지 않은 바코드' }, { status: 400 })
  }

  // 이미 등록된 제품이면 반환
  const existing = await getProduct(barcode)
  if (existing) {
    return NextResponse.json({ product: existing, message: '이미 등록된 제품입니다.', alreadyExists: true })
  }

  // 신청 저장
  await insertProductRequest(barcode, imageData || null)

  let product = null

  // OFF → UPC Item DB 자동 검색
  try {
    const offProduct = await lookupOpenFoodFacts(barcode)
    const extProduct = offProduct?.name ? offProduct : await lookupUPCItemDB(barcode)
    if (extProduct?.name) {
      product = await upsertProduct({
        barcode,
        name: extProduct.name,
        brand: extProduct.brand,
        category: extProduct.category,
        image_url: extProduct.image_url,
      })
    }
  } catch {}

  // 네이버 쇼핑 검색
  if (!product) {
    try {
      const naverResult = await searchByBarcode(barcode)
      if (naverResult.inferredName) {
        product = await upsertProduct({
          barcode,
          name: naverResult.inferredName,
          brand: naverResult.inferredBrand,
          category: naverResult.inferredCategory,
        })
        if (product && naverResult.prices.length > 0) {
          insertPrices(naverResult.prices).catch(() => {})
        }
      }
    } catch {}
  }

  if (product) await setCachedProduct(barcode, product).catch(() => {})

  return NextResponse.json({
    success: true,
    product,
    message: product
      ? `"${product.name}" 제품이 등록되었습니다!`
      : '신청이 접수되었습니다. 검토 후 등록됩니다.',
  })
}
