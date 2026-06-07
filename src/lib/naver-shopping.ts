import axios from 'axios'
import { NaverShoppingResponse, NaverShoppingItem, PriceSnapshot, Platform } from '@/types'

const CLIENT_ID = process.env.NAVER_CLIENT_ID!
const CLIENT_SECRET = process.env.NAVER_CLIENT_SECRET!
const API_URL = 'https://openapi.naver.com/v1/search/shop.json'

// 한국 GS1 회사 접두사 → 브랜드명 매핑
const GS1_BRANDS: Record<string, string> = {
  '8801043': '농심', '8801117': '농심',
  '8801073': '삼양식품',
  '8800054': '오뚜기',
  '8801234': '오리온',
  '8801062': '롯데제과',
  '8801159': '해태제과',
  '8801097': '빙그레',
  '8801115': '서울우유',
  '8801085': '매일유업',
  '8801138': '남양유업',
  '8801068': '롯데칠성',
  '8801095': '동아오츠카',
  '8806040': '동원F&B',
  '8809000': '대상청정원',
  '8801007': '동아제약',
  '8806404': '하이트진로',
  '8801049': 'SPC삼립',
  '8801822': '롯데푸드',
  '8801052': '크라운제과',
  '8801056': '롯데칠성음료',
  '8801121': '매일유업',
  '8801105': '해태음료',
  '8801116': 'KT&G',
  '8801118': '크라운해태',
  '8809208': 'CJ제일제당',
  '8801155': '덴마크',
  '8801040': '풀무원',
  '8809014': '풀무원',
}

function getBrandFromBarcode(barcode: string): string | null {
  if (!barcode.startsWith('880')) return null
  const prefix7 = barcode.slice(0, 7)
  return GS1_BRANDS[prefix7] || null
}

export async function searchNaverShopping(query: string, display = 20): Promise<NaverShoppingItem[]> {
  try {
    const response = await axios.get<NaverShoppingResponse>(API_URL, {
      headers: {
        'X-Naver-Client-Id': CLIENT_ID,
        'X-Naver-Client-Secret': CLIENT_SECRET,
      },
      params: { query, display, sort: 'asc' },
      timeout: 5000,
    })
    return response.data.items
  } catch (error) {
    console.error('[Naver] 검색 실패:', error)
    return []
  }
}

export interface NaverSearchResult {
  prices: PriceSnapshot[]
  inferredName: string | null
  inferredBrand: string | null
  inferredCategory: string | null
  inferredImage: string | null
  inferredImageIsOfficial: boolean  // 카탈로그(제조사 공식) 이미지 여부
}

export async function searchByBarcode(barcode: string, productName?: string, englishNameHint?: string): Promise<NaverSearchResult> {
  let items: NaverShoppingItem[] = []

  // 1순위: 바코드로 검색 (가장 정확 - 정확한 제품 매칭)
  items = await searchNaverShopping(barcode, 20)

  // 2순위: 한국어 제품명으로 검색
  if (items.length === 0 && productName && productName !== barcode) {
    items = await searchNaverShopping(productName, 20)
  }

  // 3순위: 영어 이름 힌트로 검색
  if (items.length === 0 && englishNameHint) {
    items = await searchNaverShopping(englishNameHint, 20)
  }

  // 4순위: 한국 바코드(880*)면 브랜드명으로 fallback
  if (items.length === 0 && barcode.startsWith('880')) {
    const brand = getBrandFromBarcode(barcode)
    if (brand) {
      items = await searchNaverShopping(brand, 20)
    }
  }

  const validItems = items.filter(item => item.lprice && parseInt(item.lprice) > 0)
  const now = new Date().toISOString()

  const first = validItems[0]
  const inferredName = first ? cleanNaverTitle(first.title) : null
  const inferredBrand = first?.brand || first?.maker || null
  const inferredCategory = first?.category3 || first?.category2 || first?.category1 || null

  // 카탈로그 상품(productType=1)은 제조사 공식 이미지, 개인판매자(2)는 직찍 → 카탈로그 우선
  const catalogItem = validItems.find(item => item.productType === '1' && item.image)
  const imageSource = catalogItem || first
  const inferredImage = imageSource?.image || null
  const inferredImageIsOfficial = !!catalogItem

  const prices: PriceSnapshot[] = validItems.slice(0, 10).map((item, idx) => ({
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
    product_title: cleanNaverTitle(item.title),
  }))

  return { prices, inferredName, inferredBrand, inferredCategory, inferredImage, inferredImageIsOfficial }
}

export function cleanNaverTitle(title: string): string {
  return title.replace(/<[^>]*>/g, '').trim()
}
