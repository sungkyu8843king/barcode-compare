/**
 * 한국 주요 브랜드 GS1 접두사 기반 바코드 대량 검증 수집
 * OFF 개별 상품 API (검색 API와 달리 rate limit 없음) 로 유효한 제품만 저장
 *
 * 실행: npx ts-node --project tsconfig.scripts.json scripts/seed-bulk-scan.ts
 */

import axios from 'axios'
import { neon } from '@neondatabase/serverless'
import * as dotenv from 'dotenv'

dotenv.config({ path: '.env.local' })

const sql = neon(process.env.DATABASE_URL!)
const CLIENT_ID = process.env.NAVER_CLIENT_ID!
const CLIENT_SECRET = process.env.NAVER_CLIENT_SECRET!

// 주요 한국 브랜드 GS1 회사 접두사 (7자리) + 탐색 범위
const BRAND_PREFIXES = [
  { prefix: '8801043', brand: '농심',       maxItems: 500 },
  { prefix: '8801073', brand: '삼양식품',   maxItems: 300 },
  { prefix: '8800054', brand: '오뚜기',     maxItems: 500 },
  { prefix: '8801234', brand: '오리온',     maxItems: 300 },
  { prefix: '8801062', brand: '롯데제과',   maxItems: 300 },
  { prefix: '8801159', brand: '해태제과',   maxItems: 300 },
  { prefix: '8801097', brand: '빙그레',     maxItems: 200 },
  { prefix: '8801115', brand: '서울우유',   maxItems: 200 },
  { prefix: '8801085', brand: '매일유업',   maxItems: 200 },
  { prefix: '8801138', brand: '남양유업',   maxItems: 200 },
  { prefix: '8801068', brand: '롯데칠성',   maxItems: 200 },
  { prefix: '8801095', brand: '동아오츠카', maxItems: 150 },
  { prefix: '8806040', brand: '동원F&B',    maxItems: 200 },
  { prefix: '8809000', brand: '대상청정원', maxItems: 200 },
  { prefix: '8801007', brand: '동아제약',   maxItems: 150 },
  { prefix: '8801117', brand: '농심(2)',    maxItems: 200 },
  { prefix: '8806404', brand: '하이트진로', maxItems: 150 },
  { prefix: '8801049', brand: 'SPC삼립',   maxItems: 150 },
  { prefix: '8801822', brand: '롯데푸드',   maxItems: 150 },
  { prefix: '8801052', brand: '크라운제과', maxItems: 150 },
]

// EAN-13 체크 디지트 계산
function calcCheckDigit(barcode12: string): number {
  const digits = barcode12.split('').map(Number)
  const total = digits.reduce((sum, d, i) => sum + d * (i % 2 === 0 ? 1 : 3), 0)
  return (10 - (total % 10)) % 10
}

// 유효한 EAN-13 생성 (prefix 7자리 + item 5자리 + check 1자리)
function makeEAN13(prefix: string, itemNum: number): string {
  const item = String(itemNum).padStart(5, '0')
  const barcode12 = prefix + item
  const check = calcCheckDigit(barcode12)
  return barcode12 + check
}

// Open Food Facts 개별 제품 조회
async function lookupOFF(barcode: string): Promise<{ name: string; brand: string | null; category: string | null; image: string | null } | null> {
  try {
    const res = await axios.get(`https://world.openfoodfacts.org/api/v2/product/${barcode}`, {
      timeout: 8000,
      headers: { 'User-Agent': 'barcode-compare/1.0 (https://barcode-compare.vercel.app)' },
    })
    if (res.data.status !== 1 || !res.data.product) return null
    const p = res.data.product
    const name = p.product_name_ko || p.product_name
    if (!name || name.trim().length < 2) return null
    return {
      name: name.trim().slice(0, 300),
      brand: p.brands ? p.brands.split(',')[0].trim().slice(0, 100) : null,
      category: p.categories_tags?.[0]?.replace(/^[a-z]{2}:/, '').slice(0, 100) || null,
      image: p.image_front_url || p.image_url || null,
    }
  } catch {
    return null
  }
}

// 네이버 쇼핑으로 이미지/추가 정보 보완
async function lookupNaver(name: string): Promise<{ image: string | null } | null> {
  try {
    const res = await axios.get('https://openapi.naver.com/v1/search/shop.json', {
      headers: { 'X-Naver-Client-Id': CLIENT_ID, 'X-Naver-Client-Secret': CLIENT_SECRET },
      params: { query: name, display: 1 },
      timeout: 5000,
    })
    const item = res.data.items?.[0]
    return { image: item?.image || null }
  } catch {
    return null
  }
}

async function upsert(barcode: string, name: string, brand: string | null, category: string | null, image: string | null) {
  await sql`
    INSERT INTO products (barcode, name, brand, category, image_url)
    VALUES (${barcode}, ${name}, ${brand}, ${category}, ${image})
    ON CONFLICT (barcode) DO UPDATE SET
      name = EXCLUDED.name,
      brand = COALESCE(EXCLUDED.brand, products.brand),
      category = COALESCE(EXCLUDED.category, products.category),
      image_url = COALESCE(EXCLUDED.image_url, products.image_url),
      updated_at = NOW()
  `
}

async function seed() {
  console.log('🚀 한국 브랜드 바코드 대량 수집 시작\n')
  let totalFound = 0
  let totalChecked = 0

  for (const { prefix, brand, maxItems } of BRAND_PREFIXES) {
    console.log(`\n🏭 ${brand} (${prefix}*) 탐색 중...`)
    let brandFound = 0

    for (let i = 1; i <= maxItems; i++) {
      const barcode = makeEAN13(prefix, i)
      totalChecked++

      const offData = await lookupOFF(barcode)
      if (offData) {
        // 이미지 없으면 네이버에서 보완
        let image = offData.image
        if (!image) {
          const naverData = await lookupNaver(offData.name)
          image = naverData?.image || null
        }

        await upsert(barcode, offData.name, offData.brand || brand, offData.category, image)
        brandFound++
        totalFound++
        console.log(`  ✓ [${barcode}] ${offData.name}`)
      }

      // OFF API 부하 방지 (200ms 간격)
      await new Promise(r => setTimeout(r, 200))
    }

    console.log(`  → ${brand}: ${brandFound}개 발견`)
  }

  console.log(`\n✅ 완료: ${totalChecked}개 확인, ${totalFound}개 저장`)
  process.exit(0)
}

seed().catch(console.error)
