/**
 * 기존 DB의 지저분한 제품명을 Claude로 정제
 * 실행: npx tsx scripts/refine-product-names.ts [--limit=50] [--dry-run]
 *
 * 조건: 네이버 쇼핑 제목처럼 보이는 것들 (특수문자, 광고문구, 너무 긴 이름)
 */
import { config } from 'dotenv'
import { resolve } from 'path'
import { neon } from '@neondatabase/serverless'
import Anthropic from '@anthropic-ai/sdk'

config({ path: resolve(process.cwd(), '.env.local') })

const sql = neon(process.env.DATABASE_URL!)
const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! })

const args = process.argv.slice(2)
const limit = parseInt(args.find(a => a.startsWith('--limit='))?.split('=')[1] ?? '30')
const dryRun = args.includes('--dry-run')

// 정제가 필요한 제품: 이름이 25자 초과이거나 특수문자/광고성 패턴 포함
async function getMessyProducts() {
  return sql`
    SELECT barcode, name, brand, spec
    FROM products
    WHERE
      (LENGTH(name) > 25 OR name ~ '[!?【】\[\]★☆♡♥]' OR name ILIKE '%특가%' OR name ILIKE '%무료배송%' OR name ILIKE '%묶음%' OR name ILIKE '%x%개%')
      AND name NOT SIMILAR TO '[0-9]{8,14}'
    ORDER BY updated_at DESC
    LIMIT ${limit}
  `
}

async function refineOne(barcode: string, rawName: string): Promise<{ name: string; brand: string | null; spec: string | null } | null> {
  try {
    const msg = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 150,
      messages: [{
        role: 'user',
        content: `한국 마트/편의점 소비재 상품명을 정제해 주세요.
입력: ${rawName}
바코드: ${barcode}

규칙:
- name: 브랜드·규격·광고문구 없는 순수 제품명
- brand: 제조사/브랜드명 (없으면 null)
- spec: 용량·중량·수량 (없으면 null)

JSON만 출력: {"name":"...","brand":"...또는 null","spec":"...또는 null"}`
      }],
    })
    const text = (msg.content[0] as any).text?.trim() ?? ''
    return JSON.parse(text)
  } catch {
    return null
  }
}

async function main() {
  const products = await getMessyProducts()
  console.log(`대상 제품 ${products.length}개 (limit=${limit}, dry-run=${dryRun})\n`)

  let updated = 0
  for (const p of products) {
    const result = await refineOne(p.barcode, p.name)
    if (!result?.name || result.name === p.name) {
      console.log(`  SKIP ${p.barcode}: "${p.name}"`)
      continue
    }

    console.log(`  ✅ ${p.barcode}`)
    console.log(`     전: ${p.name}`)
    console.log(`     후: ${result.name} | 브랜드: ${result.brand ?? '-'} | 규격: ${result.spec ?? '-'}`)

    if (!dryRun) {
      await sql`
        UPDATE products SET
          name = ${result.name},
          brand = COALESCE(${result.brand}, brand),
          spec  = COALESCE(${result.spec},  spec),
          updated_at = NOW()
        WHERE barcode = ${p.barcode}
      `
      updated++
    }

    // API 레이트리밋 방지
    await new Promise(r => setTimeout(r, 200))
  }

  console.log(`\n완료: ${updated}개 업데이트 (dry-run=${dryRun})`)
}

main().catch(e => { console.error(e); process.exit(1) })
