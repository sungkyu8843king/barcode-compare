/**
 * Open Food Facts에서 한국(south-korea) 제품 전체 수집
 * 검색 API가 아니라 country 태그 필터 사용 → 수천 개 제품 수집 가능
 *
 * 실행: npx ts-node --project tsconfig.scripts.json scripts/seed-off-korea.ts
 */

import axios from 'axios'
import { neon } from '@neondatabase/serverless'
import * as dotenv from 'dotenv'

dotenv.config({ path: '.env.local' })

const sql = neon(process.env.DATABASE_URL!)
const CLIENT_ID = process.env.NAVER_CLIENT_ID!
const CLIENT_SECRET = process.env.NAVER_CLIENT_SECRET!

const PAGE_SIZE = 100
const DELAY_MS = 500
const MAX_PAGES = 100 // 최대 10,000개

interface OFFProduct {
  code: string
  product_name_ko?: string
  product_name?: string
  brands?: string
  categories_tags?: string[]
  image_front_url?: string
  image_url?: string
}

async function getOFFPage(page: number): Promise<OFFProduct[]> {
  // v2 API 시도
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await axios.get('https://world.openfoodfacts.org/api/v2/search', {
        params: {
          countries_tags: 'en:south-korea',
          page_size: PAGE_SIZE,
          page,
          fields: 'code,product_name_ko,product_name,brands,categories_tags,image_front_url,image_url',
        },
        timeout: 15000,
        headers: { 'User-Agent': 'barcode-compare/1.0 (https://barcode-compare.vercel.app)' },
      })
      return res.data.products || []
    } catch (e: any) {
      const status = e.response?.status
      console.error(`  페이지 ${page} 시도 ${attempt} 오류: ${e.message}`)
      if (status === 503 && attempt < 3) {
        console.log(`  → ${attempt * 3}초 후 재시도...`)
        await new Promise(r => setTimeout(r, attempt * 3000))
        continue
      }
      return []
    }
  }
  return []
}

async function lookupNaver(name: string): Promise<string | null> {
  try {
    const res = await axios.get('https://openapi.naver.com/v1/search/shop.json', {
      headers: { 'X-Naver-Client-Id': CLIENT_ID, 'X-Naver-Client-Secret': CLIENT_SECRET },
      params: { query: name, display: 1 },
      timeout: 5000,
    })
    return res.data.items?.[0]?.image || null
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
  console.log('🇰🇷 Open Food Facts 한국 제품 전체 수집 시작\n')
  let totalSaved = 0
  let totalSkipped = 0

  for (let page = 1; page <= MAX_PAGES; page++) {
    console.log(`📄 페이지 ${page} 조회 중...`)
    const products = await getOFFPage(page)

    if (products.length === 0) {
      console.log('  → 더 이상 제품 없음. 완료!')
      break
    }

    for (const p of products) {
      const barcode = p.code?.replace(/\D/g, '')
      if (!barcode || !/^\d{8,14}$/.test(barcode)) {
        totalSkipped++
        continue
      }

      const name = (p.product_name_ko || p.product_name || '').trim()
      if (name.length < 2) {
        totalSkipped++
        continue
      }

      const brand = p.brands ? p.brands.split(',')[0].trim().slice(0, 100) : null
      const category = p.categories_tags?.[0]?.replace(/^[a-z]{2}:/, '').slice(0, 100) || null
      let image = p.image_front_url || p.image_url || null

      // 이미지 없으면 네이버에서 보완
      if (!image) {
        image = await lookupNaver(name)
      }

      await upsert(barcode, name.slice(0, 300), brand, category, image)
      totalSaved++
      console.log(`  ✓ [${barcode}] ${name}`)
    }

    console.log(`  → 이번 페이지: ${products.length}개 처리, 누적 저장: ${totalSaved}개`)

    if (products.length < PAGE_SIZE) {
      console.log('\n  → 마지막 페이지. 완료!')
      break
    }

    await new Promise(r => setTimeout(r, DELAY_MS))
  }

  console.log(`\n✅ 완료: 저장 ${totalSaved}개, 건너뜀 ${totalSkipped}개`)
  process.exit(0)
}

seed().catch(console.error)
