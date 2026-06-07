import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })
import { neon } from '@neondatabase/serverless'

const sql = neon(process.env.DATABASE_URL!)

async function main() {
  // source 컬럼 추가
  await sql`ALTER TABLE products ADD COLUMN IF NOT EXISTS source VARCHAR(20) DEFAULT 'unknown'`
  console.log('✅ source 컬럼 추가')

  // 식품안전나라 C005 배치로 들어온 것들은 foodsafety로 마킹
  // (C005는 name에 한글만 있고, brand에 BSSH_NM 형태 들어가 있음)
  // 정확한 판별은 어려우니 일단 모두 unknown으로 두고 검증 스크립트가 채움
  console.log('✅ 마이그레이션 완료')
}
main().catch(e => { console.error(e); process.exit(1) })
