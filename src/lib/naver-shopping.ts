import axios from 'axios'
import { NaverShoppingResponse, NaverShoppingItem, PriceSnapshot, Platform } from '@/types'
import { pickBestNaverMatch, improveSearchQuery } from '@/lib/claude-ai'
import { lookupCatalogByBarcode, getCatalogListings, isCatalogApiEnabled } from '@/lib/naver-catalog'

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
      params: { query, display, sort: 'sim' }, // 관련도순 - 낮은가격순은 사기업체가 상단 점령
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

// 중량/용량을 g/ml 단위로 정규화
function normalizeWeight(s: string): number {
  const m = s.match(/([\d.]+)\s*(g|kg|ml|l)/i)
  if (!m) return 0
  const val = parseFloat(m[1])
  const unit = m[2].toLowerCase()
  if (unit === 'kg' || unit === 'l') return val * 1000
  return val
}

// 알려진 spec(예: "315g")과 다른 중량이 제목에 있으면 제거
function filterConflictingSpec(items: NaverShoppingItem[], spec: string | null): NaverShoppingItem[] {
  if (!spec) return items
  const specWeights = [...spec.matchAll(/([\d.]+)\s*(g|kg|ml|l)\b/gi)].map(m => normalizeWeight(m[0]))
  if (specWeights.length === 0) return items

  return items.filter(item => {
    const title = cleanNaverTitle(item.title).toLowerCase()
    const titleWeights = [...title.matchAll(/([\d.]+)\s*(g|kg|ml|l)\b/gi)].map(m => normalizeWeight(m[0]))
    if (titleWeights.length === 0) return true // 제목에 중량 없으면 통과
    // 제목 중량 중 spec과 5% 이내로 일치하는 것이 하나라도 있으면 통과
    return titleWeights.some(tw => specWeights.some(sw => sw > 0 && Math.abs(tw - sw) / sw < 0.05))
  })
}

// 카탈로그(productType=1) 우선, 그 다음 가격 오름차순
function sortCatalogFirst(items: NaverShoppingItem[]): NaverShoppingItem[] {
  return [...items].sort((a, b) => {
    const aCat = a.productType === '1' ? 0 : 1
    const bCat = b.productType === '1' ? 0 : 1
    if (aCat !== bCat) return aCat - bCat
    return parseInt(a.lprice) - parseInt(b.lprice)
  })
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

// 제품 제목에서 용량/중량/수량 추출
export function extractSpec(title: string): string | null {
  // 예: "315g", "1kg", "500ml", "1.5L", "12개입", "6매", "10팩"
  const m = title.match(/\d+(?:\.\d+)?\s*(?:ml|ML|l|L|g|G|kg|KG|mg|개입|개|매|팩|입|box|BOX)\b/g)
  if (!m || m.length === 0) return null
  // 숫자가 너무 크면 수량이 아닌 가격일 수 있음 - 10000 이하만
  const valid = m.filter(s => {
    const num = parseFloat(s)
    return num > 0 && num <= 10000
  })
  return valid.slice(0, 2).join(' ') || null
}

export interface NaverSearchResult {
  prices: PriceSnapshot[]
  inferredName: string | null
  inferredBrand: string | null
  inferredCategory: string | null
  inferredImage: string | null
  inferredImageIsOfficial: boolean
  inferredSpec: string | null
  naverProductId: string | null   // 카탈로그 ID (누적 캐시용)
}

export async function searchByBarcode(
  barcode: string,
  productName?: string,
  brand?: string,
  spec?: string | null,
  knownNaverProductId?: string | null,   // DB에 저장된 카탈로그 ID
): Promise<NaverSearchResult> {
  let items: NaverShoppingItem[] = []
  const hasKoreanName = productName && /[가-힣]/.test(productName)

  // ── 0순위: 네이버 카탈로그 API (발급 시 바코드 직접 조회) ──
  if (isCatalogApiEnabled) {
    const catalog = await lookupCatalogByBarcode(barcode)
    if (catalog?.productId) {
      const listings = await getCatalogListings(catalog.productId)
      if (listings && listings.length > 0) {
        // 카탈로그 API 결과를 NaverShoppingItem 형식으로 변환
        items = listings.map(l => ({
          title: catalog.name,
          link: l.url,
          image: catalog.imageUrl || '',
          lprice: l.price.toString(),
          hprice: '',
          mallName: l.mallName,
          productId: catalog.productId,
          productType: '1',
          brand: catalog.brand || '',
          maker: catalog.maker || '',
          category1: catalog.category1 || '',
          category2: catalog.category2 || '',
          category3: catalog.category3 || '',
          category4: '',
        }))
      }
    }
  }

  // ── 1순위: 기존에 확인된 카탈로그 productId가 있으면 그걸로 필터 ──
  if (items.length === 0 && knownNaverProductId) {
    const query = productName || barcode
    const allItems = await searchNaverShopping(query, 40)
    const matched = allItems.filter(item => item.productId === knownNaverProductId)
    if (matched.length > 0) {
      items = matched
    }
  }

  if (items.length === 0 && hasKoreanName) {
    // ── 2순위: 브랜드 + 제품명 + 용량 조합 검색 ──
    const cleanedBrand = brand ? cleanBrand(brand) : null
    const nameWithSpec = spec ? `${productName} ${spec}` : productName!
    const fullQuery = cleanedBrand ? `${cleanedBrand} ${nameWithSpec}` : nameWithSpec
    const fullItems = await searchNaverShopping(fullQuery, 20)
    const validated = filterByProductName(fullItems, productName!)
    if (validated.length >= 2) {
      items = validated
    } else if (fullItems.length > 0) {
      items = fullItems
    }

    // ── 3순위: 제품명+용량만 검색 ──
    if (items.length === 0) {
      const nameItems = await searchNaverShopping(nameWithSpec, 20)
      const validated2 = filterByProductName(nameItems, productName!)
      items = validated2.length > 0 ? validated2 : nameItems
    }

    // ── 4순위: 줄인 제품명 검색 ──
    if (items.length === 0) {
      const short = shortenProductName(productName!)
      if (short && short !== productName) {
        items = await searchNaverShopping(short, 20)
      }
    }

    // ── 5순위: Claude가 더 나은 검색어 생성 (결과 없을 때) ──
    if (items.length === 0 && process.env.ANTHROPIC_API_KEY) {
      const betterQuery = await improveSearchQuery(barcode, productName!, brand || null, spec || null)
      if (betterQuery) {
        console.log(`[Claude] 개선된 쿼리: "${betterQuery}"`)
        items = await searchNaverShopping(betterQuery, 20)
      }
    }
  }

  // ── 6순위: 바코드 검색 ──
  if (items.length === 0) {
    const barcodeItems = await searchNaverShopping(barcode, 20)
    if (hasKoreanName && barcodeItems.length > 0) {
      const validated3 = filterByProductName(barcodeItems, productName!)
      items = validated3.length > 0 ? validated3 : []
    } else {
      items = barcodeItems
    }
  }

  // ── 7순위: GS1 브랜드 fallback ──
  if (items.length === 0) {
    const gs1Brand = brand || getBrandFromBarcode(barcode)
    if (gs1Brand) {
      items = await searchNaverShopping(gs1Brand, 20)
    }
  }

  // ── Claude 결과 검증: productId 매핑 없이 텍스트 검색만으로 찾은 경우 ──
  // 결과가 있지만 카탈로그(productType=1)가 없거나 productName과 불일치 의심될 때
  const hasCatalogItem = items.some(i => i.productType === '1')
  const shouldValidateWithClaude =
    !knownNaverProductId &&
    !isCatalogApiEnabled &&
    items.length > 0 &&
    !hasCatalogItem &&
    hasKoreanName &&
    process.env.ANTHROPIC_API_KEY

  if (shouldValidateWithClaude) {
    const candidates = items.slice(0, 8).map(i => ({
      title: cleanNaverTitle(i.title),
      productId: i.productId,
      brand: i.brand,
      category: i.category3 || i.category2 || '',
      lprice: i.lprice,
    }))
    const { productId: validatedId, confidence } = await pickBestNaverMatch(
      barcode, productName!, spec || null, candidates
    )
    if (validatedId && confidence === 'high') {
      console.log(`[Claude] 검증된 productId: ${validatedId}`)
      const confirmed = items.filter(i => i.productId === validatedId)
      // 2개 이상일 때만 좁히기 — 1개면 다른 묶음/판매처도 보여줌
      if (confirmed.length >= 2) items = confirmed
      else if (confirmed.length === 1) {
        items = [...confirmed, ...items.filter(i => i.productId !== validatedId)]
      }
    }
  }

  const rawValid = items.filter(item => item.lprice && parseInt(item.lprice) >= 100)
  const specFiltered = filterConflictingSpec(rawValid, spec || null)
  const validItems = sortCatalogFirst(specFiltered.length > 0 ? specFiltered : rawValid)
  const now = new Date().toISOString()

  const first = validItems[0]
  const inferredName = first ? cleanNaverTitle(first.title) : null
  const inferredBrand = first?.brand || first?.maker || brand || null
  const inferredCategory = first?.category3 || first?.category2 || first?.category1 || null

  const catalogItem = validItems.find(item => item.productType === '1' && item.image)
  const imageSource = catalogItem || first
  const inferredImage = imageSource?.image || null
  const inferredImageIsOfficial = !!catalogItem

  // 처음 확인된 카탈로그 productId 추출 (누적 저장용)
  const detectedProductId = catalogItem?.productId || validItems.find(i => i.productType === '1')?.productId || null

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

  const inferredSpec = inferredName ? extractSpec(inferredName) : null

  return { prices, inferredName, inferredBrand, inferredCategory, inferredImage, inferredImageIsOfficial, inferredSpec, naverProductId: detectedProductId }
}

export function cleanNaverTitle(title: string): string {
  return title.replace(/<[^>]*>/g, '').trim()
}
