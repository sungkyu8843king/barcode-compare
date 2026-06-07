import crypto from 'crypto'
import axios from 'axios'
import { PriceSnapshot, DeliveryType } from '@/types'

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

async function fetchCoupangItems(keyword: string, barcode: string): Promise<any[]> {
  const path = '/v2/providers/affiliate_open_api/apis/openapi/products/search'
  const params = new URLSearchParams({ keyword, limit: '10', subId: barcode })
  const query = params.toString()
  const { authorization } = generateHmac('GET', path, query)
  try {
    const res = await axios.get(`${BASE_URL}${path}?${query}`, {
      headers: { Authorization: authorization },
      timeout: 5000,
    })
    return res.data?.data?.productData || []
  } catch (e: any) {
    console.error('[Coupang] 검색 실패:', e.response?.status, e.message)
    return []
  }
}

export async function searchCoupang(keyword: string, barcode: string, brand?: string): Promise<CoupangSearchResult> {
  if (!ACCESS_KEY || !SECRET_KEY) return { prices: [] }

  // 브랜드 포함 검색 먼저, 결과 없으면 제품명만으로 재검색
  const cleanedBrand = brand?.replace(/\(주\)|\(주식회사\)|㈜|주식회사\s*/gi, '').trim()
  const keywordWithBrand = (cleanedBrand && /[가-힣]/.test(keyword) && !keyword.includes(cleanedBrand))
    ? `${cleanedBrand} ${keyword}` : keyword

  let items = await fetchCoupangItems(keywordWithBrand, barcode)
  if (items.length === 0 && keywordWithBrand !== keyword) {
    items = await fetchCoupangItems(keyword, barcode)
  }

  const now = new Date().toISOString()

  try {
    const prices: PriceSnapshot[] = items
      .filter((item: any) => item.productPrice >= 100)
      .slice(0, 8)
      .map((item: any, idx: number) => {
        const rawType: string = (item.deliveryType || item.rocketType || '').toUpperCase()
        let deliveryType: DeliveryType = null
        if (rawType.includes('FRESH') || rawType.includes('ROCKET_FRESH')) deliveryType = 'ROCKET_FRESH'
        else if (rawType.includes('OVERSEAS')) deliveryType = 'ROCKET_OVERSEAS'
        else if (rawType.includes('ROCKET') || item.isRocket || item.badge === 'ROCKET') deliveryType = 'ROCKET'
        else if (rawType.includes('DAWN')) deliveryType = 'DAWN'
        // WOW membership → treat as ROCKET if no more specific type
        if (!deliveryType && (item.isWow || item.membershipType === 'WOW' || item.wowDelivery)) deliveryType = 'ROCKET'

        const isRocketType = deliveryType === 'ROCKET' || deliveryType === 'ROCKET_FRESH' || deliveryType === 'ROCKET_OVERSEAS'
        const isFreeShip = !!(item.isFreeShipping || item.freeDelivery)
        const shippingFee = (isRocketType || isFreeShip)
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
          is_rocket: isRocketType,
          delivery_type: deliveryType,
          product_title: item.productName || null,
        }
      })

    return { prices }
  } catch (e: any) {
    console.error('[Coupang] 파싱 실패:', e.message)
    return { prices: [] }
  }
}
