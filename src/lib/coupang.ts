import crypto from 'crypto'
import axios from 'axios'
import { PriceSnapshot } from '@/types'

const ACCESS_KEY = process.env.COUPANG_ACCESS_KEY!
const SECRET_KEY = process.env.COUPANG_SECRET_KEY!
const BASE_URL = 'https://api-gateway.coupang.com'

function generateHmac(method: string, path: string, query: string): { authorization: string; timestamp: string } {
  const timestamp = Date.now().toString()
  const message = `${timestamp}${method}${path}${query ? '?' + query : ''}`
  const signature = crypto.createHmac('sha256', SECRET_KEY).update(message).digest('hex')
  const authorization = `CEA algorithm=HmacSHA256, access-key=${ACCESS_KEY}, signed-date=${timestamp}, signature=${signature}`
  return { authorization, timestamp }
}

export interface CoupangSearchResult {
  prices: PriceSnapshot[]
}

export async function searchCoupang(keyword: string, barcode: string, brand?: string): Promise<CoupangSearchResult> {
  // 브랜드가 제품명에 없으면 앞에 붙여서 정확도 향상
  if (brand && /[가-힣]/.test(keyword) && !keyword.includes(brand)) {
    keyword = `${brand} ${keyword}`
  }
  if (!ACCESS_KEY || !SECRET_KEY) return { prices: [] }

  const path = '/v2/providers/affiliate_open_api/apis/openapi/products/search'
  const params = new URLSearchParams({ keyword, limit: '10', subId: barcode })
  const query = params.toString()

  const { authorization } = generateHmac('GET', path, query)

  try {
    const res = await axios.get(`${BASE_URL}${path}?${query}`, {
      headers: { Authorization: authorization },
      timeout: 5000,
    })

    const items = res.data?.data?.productData || []
    const now = new Date().toISOString()

    const prices: PriceSnapshot[] = items
      .filter((item: any) => item.productPrice >= 100)
      .slice(0, 8)
      .map((item: any, idx: number) => {
        const isRocket = !!(item.isRocket || item.badge === 'ROCKET' || item.deliveryType === 'ROCKET')
        const isWow = !!(item.isWow || item.membershipType === 'WOW' || item.wowDelivery)
        const isFreeShip = !!(item.isFreeShipping || item.freeDelivery)
        const shippingFee = (isRocket || isWow || isFreeShip)
          ? 0
          : (typeof item.deliveryFee === 'number' ? item.deliveryFee : null)
        return {
          id: idx + 100,
          barcode,
          platform: 'coupang' as const,
          price: item.productPrice,
          original_price: typeof item.salePrice === 'number' && item.salePrice !== item.productPrice ? item.salePrice : null,
          discount_rate: null,
          url: item.productUrl,
          seller_name: item.productName?.slice(0, 80) || '쿠팡',
          in_stock: true,
          fetched_at: now,
          shipping_fee: shippingFee,
          is_rocket: isRocket || isWow,
          product_title: item.productName || null,
        }
      })

    return { prices }
  } catch (e: any) {
    console.error('[Coupang] 검색 실패:', e.response?.status, e.message)
    return { prices: [] }
  }
}
