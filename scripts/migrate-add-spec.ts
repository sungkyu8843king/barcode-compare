import { config } from 'dotenv'
import { resolve } from 'path'
import { neon } from '@neondatabase/serverless'

config({ path: resolve(process.cwd(), '.env.local') })
const sql = neon(process.env.DATABASE_URL!)

async function main() {
  await sql`ALTER TABLE products ADD COLUMN IF NOT EXISTS spec VARCHAR(100)`
  console.log('✅ products.spec 컬럼 추가 완료')
}
main().catch(e => { console.error(e); process.exit(1) })
