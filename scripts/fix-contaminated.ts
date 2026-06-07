/**
 * 오염된 제품 수정 + Claude로 브랜드-바코드 불일치 검사
 * 실행: npx tsx scripts/fix-contaminated.ts [--dry-run]
 */
import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })
import { neon } from '@neondatabase/serverless'
import Anthropic from '@anthropic-ai/sdk'
import { Redis } from '@upstash/redis'

const sql = neon(process.env.DATABASE_URL!)
const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! })
const redis = new Redis({ url: process.env.UPSTASH_REDIS_REST_URL!, token: process.env.UPSTASH_REDIS_REST_TOKEN! })
const dryRun = process.argv.includes('--dry-run')

async function main() {
  // ── 1. 명확한 오염: "유기농 부침가루" 이름 → 삭제 (Naver 재검색이 더 정확)
  const obvious = await sql`
    SELECT barcode, name, brand FROM products
    WHERE name ILIKE '%유기농 부침가루%'
       OR name ILIKE '%좋은상품 유기농%'
  `
  console.log(`\n명확 오염 제품: ${obvious.length}개`)
  for (const p of obvious) {
    console.log(`  ❌ ${p.barcode}: ${p.name} (${p.brand})`)
    if (!dryRun) {
      await sql`DELETE FROM products WHERE barcode = ${p.barcode}`
      await sql`DELETE FROM barcode_catalog_map WHERE barcode = ${p.barcode}`
      await redis.del(`product:${p.barcode}`)
      await redis.del(`prices:${p.barcode}`)
    }
  }

  // ── 2. Claude로 브랜드-바코드 불일치 검사 (880으로 시작하는 것 중 의심스러운 것)
  // GS1 한국 바코드: 앞 7자리가 회사 코드 → 브랜드와 매칭 여부 확인
  const suspicious = await sql`
    SELECT barcode, name, brand
    FROM products
    WHERE barcode LIKE '880%'
      AND brand IS NOT NULL
      AND source IS DISTINCT FROM 'foodsafety'
    ORDER BY created_at DESC
    LIMIT 100
  `

  console.log(`\nClaude 검증 대상: ${suspicious.length}개`)

  // 10개씩 묶어서 Claude에게 물어봄 (비용 절약)
  const batchSize = 10
  let wrongCount = 0

  for (let i = 0; i < suspicious.length; i += batchSize) {
    const batch = suspicious.slice(i, i + batchSize)
    const list = batch.map(p =>
      `바코드:${p.barcode} | 이름:${p.name} | 브랜드:${p.brand}`
    ).join('\n')

    try {
      const msg = await client.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 300,
        messages: [{
          role: 'user',
          content: `아래 한국 상품 목록에서 바코드 앞자리(GS1 회사 코드)와 브랜드가 명백히 불일치하는 것을 찾아주세요.
예: 바코드 8809695xxxxx는 팔도 제품인데 브랜드가 '농심'이면 불일치.
확실히 틀린 것만 바코드 번호를 쉼표로 나열하세요. 확실하지 않으면 포함하지 마세요.
없으면 "없음"이라고만 답하세요.

${list}`
        }]
      })

      const text = (msg.content[0] as any).text?.trim() ?? ''
      if (text !== '없음' && text.length > 0) {
        const wrongBarcodes = text.split(/[,\s]+/).filter((s: string) => /^\d{8,14}$/.test(s))
        for (const bc of wrongBarcodes) {
          const prod = batch.find(p => p.barcode === bc)
          if (prod) {
            wrongCount++
            console.log(`  ⚠️  ${bc}: "${prod.name}" (브랜드: ${prod.brand}) → 삭제`)
            if (!dryRun) {
              await sql`DELETE FROM products WHERE barcode = ${bc}`
              await sql`DELETE FROM barcode_catalog_map WHERE barcode = ${bc}`
              await redis.del(`product:${bc}`)
              await redis.del(`prices:${bc}`)
            }
          }
        }
      }
    } catch (e) {
      console.error('Claude 오류:', e)
    }

    await delay(300)
  }

  console.log(`\n완료`)
  console.log(`  명확 오염 삭제: ${obvious.length}개`)
  console.log(`  Claude 검출 불일치: ${wrongCount}개`)
  console.log(`  dry-run: ${dryRun}`)
}

function delay(ms: number) { return new Promise(r => setTimeout(r, ms)) }
main().catch(e => { console.error(e); process.exit(1) })
