import { config } from 'dotenv'
import { resolve } from 'path'
import { neon } from '@neondatabase/serverless'

config({ path: resolve(process.cwd(), '.env.local') })
const sql = neon(process.env.DATABASE_URL!)

async function main() {
  await sql`ALTER TABLE product_feedback ADD COLUMN IF NOT EXISTS image_data TEXT`
  await sql`ALTER TABLE product_feedback ADD COLUMN IF NOT EXISTS status VARCHAR(20) DEFAULT 'pending'`
  await sql`CREATE INDEX IF NOT EXISTS idx_product_feedback_status ON product_feedback(status)`
  console.log('✅ product_feedback 마이그레이션 완료')
}
main().catch(e => { console.error(e); process.exit(1) })
