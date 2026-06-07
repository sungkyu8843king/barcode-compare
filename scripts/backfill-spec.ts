/**
 * 식품안전나라 C005 API에서 CAPACITY 필드를 가져와 기존 products.spec을 채우는 스크립트
 * spec이 NULL인 제품 대상으로 500개씩 배치 처리
 */
import { config } from 'dotenv'
import { resolve } from 'path'
import { neon } from '@neondatabase/serverless'
import axios from 'axios'

config({ path: resolve(process.cwd(), '.env.local') })

const sql = neon(process.env.DATABASE_URL!)
const KEY = process.env.FOODSAFETY_API_KEY!

async function delay(ms: number) { return new Promise(r => setTimeout(r, ms)) }

async function main() {
  if (!KEY) { console.error('FOODSAFETY_API_KEY 없음'); process.exit(1) }

  // spec NULL인 제품 수
  const [{ count }] = await sql`SELECT COUNT(*) AS count FROM products WHERE spec IS NULL AND name ~ '[가-힣]'`
  console.log(`📊 spec 없는 한국 제품: ${count}개`)

  // 전체 C005 데이터에서 바코드→용량 매핑 구축 (페이지 단위로 가져와서 한번에 처리)
  let start = 1
  const batchSize = 1000
  let totalUpdated = 0
  let page = 0

  while (true) {
    page++
    const end = start + batchSize - 1
    console.log(`\n📥 C005 ${start}~${end} 조회 중...`)

    try {
      const res = await axios.get(
        `http://openapi.foodsafetykorea.go.kr/api/${KEY}/C005/json/${start}/${end}`,
        { timeout: 15000 }
      )
      const items: any[] = res.data?.C005?.row ?? []
      if (items.length === 0) {
        console.log('✅ 끝까지 처리 완료')
        break
      }

      // 바코드→용량 맵 구성
      const specMap = new Map<string, string>()
      for (const item of items) {
        const barcode = (item.BAR_CD ?? '').trim().replace(/\x00/g, '')
        const spec = (item.CAPACITY ?? item.NET_WT ?? '').trim().replace(/\x00/g, '')
        if (barcode && spec && /^\d{8,14}$/.test(barcode)) {
          specMap.set(barcode, spec)
        }
      }

      if (specMap.size === 0) { start += batchSize; continue }

      // DB에서 이 바코드들 중 spec NULL인 것만 업데이트
      let batchUpdated = 0
      for (const [barcode, spec] of specMap) {
        const rows = await sql`
          UPDATE products SET spec = ${spec}
          WHERE barcode = ${barcode} AND spec IS NULL
          RETURNING barcode
        `
        if (rows.length > 0) batchUpdated++
      }

      totalUpdated += batchUpdated
      console.log(`  → ${specMap.size}개 용량 데이터, DB 업데이트 ${batchUpdated}개 (누적 ${totalUpdated}개)`)

      start += batchSize
      await delay(300) // API 레이트리밋
    } catch (e: any) {
      console.error(`  ❌ 오류: ${e.message}`)
      await delay(2000)
      start += batchSize // 오류 시 다음 배치로
    }

    // 최대 50페이지 (50,000개) 처리 후 중단 (너무 오래 걸리면)
    if (page >= 50) {
      console.log('\n⏸ 50페이지 처리 완료, 이후는 cron으로 자동 처리됩니다')
      break
    }
  }

  console.log(`\n✅ 완료: 총 ${totalUpdated}개 제품에 용량 정보 추가`)
}

main().catch(e => { console.error(e); process.exit(1) })
