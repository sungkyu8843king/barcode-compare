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
  return GS1_BRANDS[barcode.slice(0, 7)] || null
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

// 제품명에서 핵심 키워드 추출 (한국어 2자 이상 단어)
function extractKeyTerms(name: string): string[] {
  // 괄호 안 제거, 특수문자 정리
  const cleaned = name.replace(/\([^)]*\)/g, '').replace(/[^\w가-힣\s]/g, ' ').trim()
  const words = cleaned.split(/\s+/).filter(w => w.length >= 2)
  // 첫 3개 단어를 핵심어로 (가장 식별력 높은 앞부분)
  return [...new Set(words.slice(0, 4))]
}

// Naver 결과가 기대 제품과 일치하는지 검증
function filterByProductName(items: NaverShoppingItem[], productName: string): NaverShoppingItem[] {
  const terms = extractKeyTerms(productName)
  if (terms.length === 0) return items

  return items.filter(item => {
    const title = cleanNaverTitle(item.title).toLowerCase()
    // 키워드 중 하나라도 제목에 포함되면 통과
    return terms.some(term => title.includes(term.toLowerCase()))
  })
}

// 브랜드명에서 회사 법인 표기 제거 ("씨제이제일제당(주)" → "씨제이제일제당")
function cleanBrand(brand: string): string {
  return brand
    .replace(/\(주\)|\(주식회사\)|㈜|주식회사\s*/gi, '')
    .replace(/\s*(co\.,?\s*ltd\.?|inc\.?|corp\.?)\s*$/gi, '')
    .trim()
}

// 불필요한 단어 제거한 짧은 쿼리 (재검색용)
function shortenProductName(name: string): string {
  // 용량/중량 표기 제거, 앞 2단어만
  const words = name
    .replace(/\d+\s*(ml|g|kg|l|개|입|팩|병|캔|박스|box|ea)\b/gi, '')
    .split(/\s+/).filter(Boolean)
  return words.slice(0, 2).join(' ')
}

export interface NaverSearchResult {
  prices: PriceSnapshot[]
  inferredName: string | null
  inferredBrand: string | null
  inferredCategory: string | null
  inferredImage: string | null
  inferredImageIsOfficial: boolean
}

export async function searchByBarcode(
  barcode: string,
  productName?: string,
  brand?: string,
  spec?: string | null,
): Promise<NaverSearchResult> {
  let items: NaverShoppingItem[] = []
  const hasKoreanName = productName && /[가-힣]/.test(productName)

  if (hasKoreanName) {
    // ── 1순위: 브랜드 + 제품명 + 용량 조합 검색 (가장 정확) ──
    const cleanedBrand = brand ? cleanBrand(brand) : null
    const nameWithSpec = spec ? `${productName} ${spec}` : productName!
    const fullQuery = cleanedBrand ? `${cleanedBrand} ${nameWithSpec}` : nameWithSpec
    const fullItems = await searchNaverShopping(fullQuery, 20)
    const validated = filterByProductName(fullItems, productName!)
    if (validated.length >= 2) {
      items = validated
    } else if (fullItems.length > 0) {
      items = fullItems // 검증 통과 못해도 결과 있으면 사용
    }

    // ── 2순위: 제품명+용량만 검색 (브랜드 없이) ──
    if (items.length === 0) {
      const nameItems = await searchNaverShopping(nameWithSpec, 20)
      const validated2 = filterByProductName(nameItems, productName!)
      items = validated2.length > 0 ? validated2 : nameItems
    }

    // ── 3순위: 줄인 제품명 검색 (제품명이 너무 길거나 특수한 경우) ──
    if (items.length === 0) {
      const short = shortenProductName(productName!)
      if (short && short !== productName) {
        items = await searchNaverShopping(short, 20)
      }
    }
  }

  // ── 4순위: 바코드 검색 (한국 바코드 880*는 간혹 네이버에 등록됨) ──
  if (items.length === 0) {
    const barcodeItems = await searchNaverShopping(barcode, 20)
    // 한국어 제품명 알고 있으면 검증, 모르면 그대로 사용
    if (hasKoreanName && barcodeItems.length > 0) {
      const validated3 = filterByProductName(barcodeItems, productName!)
      items = validated3.length > 0 ? validated3 : []
    } else {
      items = barcodeItems
    }
  }

  // ── 5순위: GS1 브랜드 fallback ──
  if (items.length === 0) {
    const gs1Brand = brand || getBrandFromBarcode(barcode)
    if (gs1Brand) {
      items = await searchNaverShopping(gs1Brand, 20)
    }
  }

  const validItems = items.filter(item => item.lprice && parseInt(item.lprice) >= 100)
  const now = new Date().toISOString()

  const first = validItems[0]
  const inferredName = first ? cleanNaverTitle(first.title) : null
  const inferredBrand = first?.brand || first?.maker || brand || null
  const inferredCategory = first?.category3 || first?.category2 || first?.category1 || null

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
