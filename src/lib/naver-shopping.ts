import axios from 'axios'
import { NaverShoppingResponse, NaverShoppingItem, PriceSnapshot, Platform } from '@/types'

const CLIENT_ID = process.env.NAVER_CLIENT_ID!
const CLIENT_SECRET = process.env.NAVER_CLIENT_SECRET!
const API_URL = 'https://openapi.naver.com/v1/search/shop.json'

export async function searchNaverShopping(query: string): Promise<NaverShoppingItem[]> {
  try {
    const response = await axios.get<NaverShoppingResponse>(API_URL, {
      headers: {
        'X-Naver-Client-Id': CLIENT_ID,
        'X-Naver-Client-Secret': CLIENT_SECRET,
      },
      params: {
        query,
        display: 10,
        sort: 'asc', // 낮은 가격순
      },
    })
    return response.data.items
  } catch (error) {
    console.error('[Naver] 검색 실패:', error)
    return []
  }
}

export async function searchByBarcode(barcode: string, productName?: string): Promise<PriceSnapshot[]> {
  // 바코드로 먼저 검색, 결과 없으면 제품명으로 재검색
  let items = await searchNaverShopping(barcode)

  if (items.length === 0 && productName) {
    items = await searchNaverShopping(productName)
  }

  const now = new Date().toISOString()

  return items
    .filter(item => item.lprice && parseInt(item.lprice) > 0)
    .map((item, idx) => ({
      id: idx,
      barcode,
      platform: 'naver' as Platform,
      price: parseInt(item.lprice),
      original_price: item.hprice ? parseInt(item.hprice) : null,
      discount_rate: null,
      url: item.link,
      seller_name: item.mallName,
      in_stock: true,
      fetched_at: now,
    }))
}

// HTML 태그 제거 (네이버 API 응답에 <b> 태그 포함됨)
export function cleanNaverTitle(title: string): string {
  return title.replace(/<[^>]*>/g, '').trim()
}
