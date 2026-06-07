/**
 * 식품안전나라 바코드연계제품정보(C005) → Neon 저장
 * 한국 식품 바코드 + 제품명 + 제조사 + 식품유형
 *
 * 실행: npx ts-node --project tsconfig.scripts.json scripts/seed-foodsafety.ts
 */

import axios from 'axios'
import { neon } from '@neondatabase/serverless'
import * as dotenv from 'dotenv'

dotenv.config({ path: '.env.local' })

const sql = neon(process.env.DATABASE_URL!)
const API_KEY = process.env.FOODSAFETY_API_KEY!
const PAGE_SIZE = 1000
const BASE_URL = 'http://openapi.foodsafetykorea.go.kr/api'

if (!API_KEY) {
  console.error('❌ FOODSAFETY_API_KEY가 없습니다')
  process.exit(1)
}

interface C005Row {
  BAR_CD: string       // 바코드
  PRDLST_NM: string   // 제품명
  BSSH_NM: string     // 제조사명
  PRDLST_DCNM: string // 식품유형
  CLSBIZ_DT: string   // 폐업일자
}

async function fetchPage(start: number): Promise<C005Row[]> {
  const end = start + PAGE_SIZE - 1
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await axios.get(
        `${BASE_URL}/${API_KEY}/C005/json/${start}/${end}`,
        { timeout: 15000 }
      )
      return res.data?.C005?.row || []
    } catch (e: any) {
      if (attempt < 3) {
        await new Promise(r => setTimeout(r, 2000 * attempt))
        continue
      }
      console.error(`  페이지 ${start}-${end} 오류:`, e.message)
      return []
    }
  }
  return []
}

async function batchInsert(batch: { barcode: string; name: string; brand: string | null; category: string | null }[]) {
  if (!batch.length) return
  await sql`
    INSERT INTO products (barcode, name, brand, category, image_url)
    SELECT * FROM UNNEST(
      ${batch.map(p => p.barcode)}::text[],
      ${batch.map(p => p.name)}::text[],
      ${batch.map(p => p.brand)}::text[],
      ${batch.map(p => p.category)}::text[],
      ${batch.map(() => null as null)}::text[]
    ) AS t(barcode, name, brand, category, image_url)
    ON CONFLICT (barcode) DO UPDATE SET
      name  = EXCLUDED.name,
      brand = COALESCE(EXCLUDED.brand, products.brand),
      category = COALESCE(EXCLUDED.category, products.category)
  `
}

async function seed() {
  console.log('🇰🇷 식품안전나라 바코드연계제품정보(C005) 수집 시작\n')

  let totalSaved = 0
  let totalSkipped = 0
  let start = 1

  while (true) {
    console.log(`  📄 ${start}~${start + PAGE_SIZE - 1} 조회 중...`)
    const rows = await fetchPage(start)

    if (rows.length === 0) {
      console.log('  → 데이터 끝. 완료!')
      break
    }

    // Map으로 배치 내 중복 바코드 제거
    const seen = new Map<string, { barcode: string; name: string; brand: string | null; category: string | null }>()

    for (const row of rows) {
      const barcode = (row.BAR_CD || '').replace(/\D/g, '')
      if (!barcode || !/^\d{8,14}$/.test(barcode)) { totalSkipped++; continue }

      const name = (row.PRDLST_NM || '').replace(/\x00/g, '').trim()
      if (name.length < 2) { totalSkipped++; continue }

      seen.set(barcode, {
        barcode,
        name: name.slice(0, 300),
        brand: row.BSSH_NM?.replace(/\x00/g, '').trim().slice(0, 100) || null,
        category: row.PRDLST_DCNM?.replace(/\x00/g, '').trim().slice(0, 100) || null,
      })
    }

    const batch = [...seen.values()]

    if (batch.length > 0) {
      await batchInsert(batch)
      totalSaved += batch.length
    }

    console.log(`  ✓ 저장 ${totalSaved.toLocaleString()}개 (이번 배치 ${batch.length}개)`)

    if (rows.length < PAGE_SIZE) {
      console.log('  → 마지막 페이지. 완료!')
      break
    }

    start += PAGE_SIZE
    await new Promise(r => setTimeout(r, 300))
  }

  console.log(`\n✅ 완료: 저장 ${totalSaved.toLocaleString()}개, 건너뜀 ${totalSkipped.toLocaleString()}개`)
  process.exit(0)
}

seed().catch(e => {
  console.error('오류:', e.message)
  process.exit(1)
})
