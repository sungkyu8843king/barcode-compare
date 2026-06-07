/**
 * 네이버 쇼핑 카탈로그 API
 *
 * 네이버 쇼핑 파트너센터 (center.shopping.naver.com) 가입은 사업자 등록 필요.
 * 현재는 미사용 — barcode_catalog_map 테이블에 productId를 자동 누적하는 방식으로 대체.
 *
 * 향후 사업자 등록 시 .env.local에 추가:
 *   NAVER_CATALOG_CLIENT_ID=...
 *   NAVER_CATALOG_CLIENT_SECRET=...
 */

import axios from 'axios'

const CATALOG_CLIENT_ID     = process.env.NAVER_CATALOG_CLIENT_ID
const CATALOG_CLIENT_SECRET = process.env.NAVER_CATALOG_CLIENT_SECRET

// 카탈로그 API 활성화 여부
export const isCatalogApiEnabled = !!(CATALOG_CLIENT_ID && CATALOG_CLIENT_SECRET)

export interface CatalogProduct {
  productId: string
  name: string
  brand: string | null
  maker: string | null
  category1: string | null
  category2: string | null
  category3: string | null
  imageUrl: string | null
  lowestPrice: number | null
  barcode: string | null
  spec: string | null
}

export interface CatalogPriceListing {
  mallName: string
  price: number
  url: string
  isRocket?: boolean
  shippingFee?: number | null
}

/**
 * 바코드로 카탈로그 직접 조회 (정확한 1:1 매핑)
 * 카탈로그 API 미발급 시 null 반환
 */
export async function lookupCatalogByBarcode(barcode: string): Promise<CatalogProduct | null> {
  if (!isCatalogApiEnabled) return null

  try {
    // 카탈로그 API 바코드 조회 엔드포인트 (발급 후 정확한 URL 확인 필요)
    const res = await axios.get('https://openapi.naver.com/v1/catalog/barcode', {
      headers: {
        'X-Naver-Client-Id': CATALOG_CLIENT_ID!,
        'X-Naver-Client-Secret': CATALOG_CLIENT_SECRET!,
      },
      params: { barcode },
      timeout: 5000,
    })

    const item = res.data?.item
    if (!item) return null

    return {
      productId: item.productId,
      name: item.name,
      brand: item.brand || null,
      maker: item.maker || null,
      category1: item.category1 || null,
      category2: item.category2 || null,
      category3: item.category3 || null,
      imageUrl: item.image || null,
      lowestPrice: item.lowestPrice ? parseInt(item.lowestPrice) : null,
      barcode: item.barcode || barcode,
      spec: item.spec || null,
    }
  } catch (e: any) {
    if (e.response?.status !== 404) {
      console.error('[NaverCatalog] 조회 실패:', e.response?.status, e.message)
    }
    return null
  }
}

/**
 * 카탈로그 ID로 판매 목록 조회
 * 카탈로그 API 미발급 시 null 반환
 */
export async function getCatalogListings(productId: string): Promise<CatalogPriceListing[] | null> {
  if (!isCatalogApiEnabled) return null

  try {
    const res = await axios.get('https://openapi.naver.com/v1/catalog/product', {
      headers: {
        'X-Naver-Client-Id': CATALOG_CLIENT_ID!,
        'X-Naver-Client-Secret': CATALOG_CLIENT_SECRET!,
      },
      params: { productId },
      timeout: 5000,
    })

    const items: any[] = res.data?.items || []
    return items.map(item => ({
      mallName: item.mallName,
      price: parseInt(item.lprice),
      url: item.link,
      isRocket: item.isRocket,
      shippingFee: item.shippingFee ?? null,
    }))
  } catch (e: any) {
    console.error('[NaverCatalog] 목록 조회 실패:', e.response?.status, e.message)
    return null
  }
}
