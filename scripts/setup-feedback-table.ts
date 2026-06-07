import { config } from 'dotenv'
import { resolve } from 'path'
import { neon } from '@neondatabase/serverless'

config({ path: resolve(process.cwd(), '.env.local') })
const sql = neon(process.env.DATABASE_URL!)

async function main() {
  console.log('📋 product_feedback 테이블 생성 중...')
  await sql`
    CREATE TABLE IF NOT EXISTS product_feedback (
      id           BIGSERIAL PRIMARY KEY,
      barcode      VARCHAR(20) NOT NULL,
      feedback_type VARCHAR(30) NOT NULL, -- wrong_product / wrong_price / wrong_quantity / other
      user_query   TEXT,                  -- 사용자가 직접 입력한 올바른 제품명
      note         TEXT,
      submitted_at TIMESTAMPTZ DEFAULT NOW()
    )
  `
  await sql`CREATE INDEX IF NOT EXISTS idx_product_feedback_barcode ON product_feedback(barcode)`
  console.log('✅ 완료!')
}
main().catch(e => { console.error(e); process.exit(1) })
