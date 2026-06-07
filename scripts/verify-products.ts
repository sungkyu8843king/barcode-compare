/**
 * 식품안전나라 C005를 바코드로 직접 조회해서 DB 제품명 교정
 *
 * 실행: npx tsx scripts/verify-products.ts [--limit=500] [--dry-run] [--offset=0]
 *
 * 동작:
 * 1. DB의 모든 880* 한국 바코드를 가져옴
 * 2. 식품안전나라 C005 API에 바코드로 직접 조회
 * 3. 이름이 다르면 교정, source='foodsafety' 마킹
 * 4. 식품안전나라에 없으면 source='naver' 마킹 (신뢰도 낮음으로 표시)
 */
import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })
import { neon } from '@neondatabase/serverless'
import axios from 'axios'

const sql = neon(process.env.DATABASE_URL!)
const FOODSAFETY_KEY = process.env.FOODSAFETY_API_KEY!

const args = process.argv.slice(2)
const limit = parseInt(args.find(a => a.startsWith('--limit='))?.split('=')[1] ?? '200')
const offset = parseInt(args.find(a => a.startsWith('--offset='))?.split('=')[1] ?? '0')
const dryRun = args.includes('--dry-run')

async function lookupByBarcode(barcode: string): Promise<{ name: string; brand: string | null } | null> {
  try {
    const url = `http://openapi.foodsafetykorea.go.kr/api/${FOODSAFETY_KEY}/C005/json/1/5`
    const res = await axios.get(url, {
      params: { BAR_CD: barcode },
      timeout: 8000,
    })
    const rows: any[] = res.data?.C005?.row ?? []
    // 반드시 BAR_CD가 정확히 일치하는 것만 사용
    const item = rows.find((r: any) => (r.BAR_CD ?? '').trim() === barcode)
    if (!item?.PRDLST_NM) return null
    return {
      name: (item.PRDLST_NM ?? '').trim().replace(/\x00/g, ''),
      brand: (item.BSSH_NM ?? '').trim().replace(/\x00/g, '') || null,
    }
  } catch {
    return null
  }
}

async function main() {
  // 검증 대상: 한국 바코드 (880으로 시작) + source가 unknown이거나 naver인 것 우선
  const products = await sql`
    SELECT barcode, name, brand, source
    FROM products
    WHERE barcode LIKE '880%'
    ORDER BY
      CASE WHEN source = 'unknown' OR source IS NULL THEN 0
           WHEN source = 'naver' THEN 1
           ELSE 2 END,
      created_at DESC
    LIMIT ${limit} OFFSET ${offset}
  `

  console.log(`검증 대상: ${products.length}개 (limit=${limit}, offset=${offset}, dry-run=${dryRun})\n`)

  let verified = 0, corrected = 0, notFound = 0

  for (let i = 0; i < products.length; i++) {
    const p = products[i]
    const barcode = p.barcode as string

    const found = await lookupByBarcode(barcode)

    if (!found) {
      // 식품안전나라에 없음 → source=naver 마킹
      notFound++
      if (!dryRun && p.source !== 'naver') {
        await sql`UPDATE products SET source='naver' WHERE barcode = ${barcode}`
      }
      if (i % 50 === 0) process.stdout.write(`  [${i}/${products.length}] ⬜ ${barcode}: 식품안전나라 없음\n`)
      await delay(100)
      continue
    }

    verified++
    const nameChanged = found.name && found.name !== p.name
    const brandChanged = found.brand && found.brand !== p.brand

    if (nameChanged || brandChanged) {
      corrected++
      console.log(`  ✏️  ${barcode}`)
      if (nameChanged) console.log(`     이름: "${p.name}" → "${found.name}"`)
      if (brandChanged) console.log(`     브랜드: "${p.brand}" → "${found.brand}"`)

      if (!dryRun) {
        await sql`
          UPDATE products SET
            name       = ${found.name || p.name},
            brand      = COALESCE(${found.brand}, brand),
            source     = 'foodsafety',
            updated_at = NOW()
          WHERE barcode = ${barcode}
        `
      }
    } else {
      // 일치 → source=foodsafety 마킹
      if (!dryRun && p.source !== 'foodsafety') {
        await sql`UPDATE products SET source='foodsafety' WHERE barcode = ${barcode}`
      }
    }

    if (i % 20 === 0) process.stdout.write(`  [${i}/${products.length}] ✅ ${barcode}: OK\n`)
    await delay(200) // API 레이트리밋
  }

  console.log(`\n완료`)
  console.log(`  식품안전나라 확인: ${verified}개`)
  console.log(`  교정됨: ${corrected}개`)
  console.log(`  미등록(naver추론): ${notFound}개`)
  console.log(`  dry-run: ${dryRun}`)
}

function delay(ms: number) { return new Promise(r => setTimeout(r, ms)) }
main().catch(e => { console.error(e); process.exit(1) })
