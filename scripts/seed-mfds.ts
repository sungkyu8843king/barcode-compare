/**
 * 식품의약품안전처 식품 영양성분 데이터베이스 → Neon 저장
 * 한국 식품 바코드(FOOD_BAR_CD) + 제품명(FOOD_NM) + 제조사(MAKER_NM) 포함
 *
 * 사전 준비:
 *   1. https://www.data.go.kr 회원가입 (무료)
 *   2. "식품의약품안전처 식품 영양성분 데이터베이스" 검색 → 활용신청 (즉시 승인)
 *   3. 마이페이지 → 인증키 복사 → .env.local 에 추가:
 *      MFDS_SERVICE_KEY=발급받은키
 *
 * 실행: npx ts-node --project tsconfig.scripts.json scripts/seed-mfds.ts
 */

import axios from 'axios'
import { neon } from '@neondatabase/serverless'
import * as dotenv from 'dotenv'

dotenv.config({ path: '.env.local' })

const sql = neon(process.env.DATABASE_URL!)
const SERVICE_KEY = process.env.MFDS_SERVICE_KEY

if (!SERVICE_KEY) {
  console.error('❌ MFDS_SERVICE_KEY가 .env.local에 없습니다.')
  console.error('   data.go.kr에서 "식품영양성분데이터베이스" API 키를 발급받아 추가하세요.')
  process.exit(1)
}

const PAGE_SIZE = 1000
const API_URL = 'https://apis.data.go.kr/1471000/FoodNtrCpntDbInfo02/getFoodNtrCpntDbInq02'

interface MfdsItem {
  FOOD_NM: string        // 식품명
  FOOD_BAR_CD?: string   // 바코드
  MAKER_NM?: string      // 제조사
  Z10_CLSF_NM?: string   // 식품군
  SERVING_SIZE?: string
}

async function fetchPage(pageNo: number): Promise<{ items: MfdsItem[]; total: number }> {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await axios.get(API_URL, {
        params: {
          serviceKey: SERVICE_KEY,
          pageNo,
          numOfRows: PAGE_SIZE,
          type: 'json',
        },
        timeout: 15000,
      })

      const body = res.data?.body
      if (!body) throw new Error('응답 body 없음')

      return {
        items: body.items || [],
        total: body.totalCount || 0,
      }
    } catch (e: any) {
      if (attempt < 3) {
        await new Promise(r => setTimeout(r, 2000 * attempt))
        continue
      }
      throw e
    }
  }
  return { items: [], total: 0 }
}

async function batchInsert(batch: { barcode: string; name: string; brand: string | null; category: string | null }[]) {
  if (!batch.length) return
  const barcodes  = batch.map(p => p.barcode)
  const names     = batch.map(p => p.name)
  const brands    = batch.map(p => p.brand)
  const cats      = batch.map(p => p.category)
  const images    = batch.map(() => null as null)

  await sql`
    INSERT INTO products (barcode, name, brand, category, image_url)
    SELECT * FROM UNNEST(
      ${barcodes}::text[],
      ${names}::text[],
      ${brands}::text[],
      ${cats}::text[],
      ${images}::text[]
    ) AS t(barcode, name, brand, category, image_url)
    ON CONFLICT (barcode) DO UPDATE SET
      name = EXCLUDED.name,
      brand = COALESCE(EXCLUDED.brand, products.brand),
      category = COALESCE(EXCLUDED.category, products.category)
  `
}

async function seed() {
  console.log('🇰🇷 식품의약품안전처 식품 영양성분 DB 수집 시작\n')

  // 첫 페이지로 총 건수 파악
  const { items: firstItems, total } = await fetchPage(1)
  const totalPages = Math.ceil(total / PAGE_SIZE)
  console.log(`  총 ${total.toLocaleString()}개 | ${totalPages}페이지\n`)

  let totalSaved = 0
  let totalSkipped = 0

  async function processItems(items: MfdsItem[]) {
    const batch: { barcode: string; name: string; brand: string | null; category: string | null }[] = []

    for (const item of items) {
      const barcode = (item.FOOD_BAR_CD || '').replace(/\D/g, '')
      if (!barcode || !/^\d{8,14}$/.test(barcode)) {
        totalSkipped++
        continue
      }

      const name = (item.FOOD_NM || '').replace(/\x00/g, '').trim()
      if (name.length < 2) {
        totalSkipped++
        continue
      }

      batch.push({
        barcode,
        name: name.slice(0, 300),
        brand: item.MAKER_NM?.replace(/\x00/g, '').trim().slice(0, 100) || null,
        category: item.Z10_CLSF_NM?.replace(/\x00/g, '').trim().slice(0, 100) || null,
      })
    }

    if (batch.length > 0) {
      await batchInsert(batch)
      totalSaved += batch.length
      console.log(`  ✓ 저장 ${totalSaved.toLocaleString()}개`)
    }
  }

  await processItems(firstItems)

  for (let page = 2; page <= totalPages; page++) {
    console.log(`  📄 페이지 ${page}/${totalPages}...`)
    const { items } = await fetchPage(page)
    await processItems(items)
    await new Promise(r => setTimeout(r, 200))
  }

  console.log(`\n✅ 완료: 저장 ${totalSaved.toLocaleString()}개, 건너뜀 ${totalSkipped.toLocaleString()}개`)
  process.exit(0)
}

seed().catch(e => {
  console.error('오류:', e.message)
  process.exit(1)
})
