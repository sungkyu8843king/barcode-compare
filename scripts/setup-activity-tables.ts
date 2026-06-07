import { config } from 'dotenv'
import { resolve } from 'path'
import { neon } from '@neondatabase/serverless'

config({ path: resolve(process.cwd(), '.env.local') })

const sql = neon(process.env.DATABASE_URL!)

async function main() {
  console.log('📋 activity 테이블 생성 중...')

  await sql`
    CREATE TABLE IF NOT EXISTS search_logs (
      id           BIGSERIAL PRIMARY KEY,
      barcode      VARCHAR(20) NOT NULL,
      product_name VARCHAR(300),
      product_image TEXT,
      searched_at  TIMESTAMPTZ DEFAULT NOW()
    )
  `
  await sql`CREATE INDEX IF NOT EXISTS idx_search_logs_searched_at ON search_logs(searched_at DESC)`
  await sql`CREATE INDEX IF NOT EXISTS idx_search_logs_barcode ON search_logs(barcode)`

  await sql`
    CREATE TABLE IF NOT EXISTS product_requests (
      id           BIGSERIAL PRIMARY KEY,
      barcode      VARCHAR(20) NOT NULL,
      image_data   TEXT,
      status       VARCHAR(20) DEFAULT 'pending',
      submitted_at TIMESTAMPTZ DEFAULT NOW()
    )
  `
  await sql`CREATE INDEX IF NOT EXISTS idx_product_requests_barcode ON product_requests(barcode)`
  await sql`CREATE INDEX IF NOT EXISTS idx_product_requests_status ON product_requests(status)`

  console.log('✅ 테이블 생성 완료!')
}

main().catch(e => { console.error(e); process.exit(1) })
