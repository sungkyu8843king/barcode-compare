import { config } from 'dotenv'
import { resolve } from 'path'
import { neon } from '@neondatabase/serverless'

config({ path: resolve(process.cwd(), '.env.local') })

const sql = neon(process.env.DATABASE_URL!)

async function main() {
  await sql`
    CREATE TABLE IF NOT EXISTS barcode_catalog_map (
      barcode       VARCHAR(20) PRIMARY KEY,
      naver_product_id  VARCHAR(50),
      coupang_product_id VARCHAR(50),
      confirmed     BOOLEAN     DEFAULT FALSE,
      mapped_at     TIMESTAMPTZ DEFAULT NOW(),
      confirmed_at  TIMESTAMPTZ
    )
  `
  console.log('✅ barcode_catalog_map 테이블 생성 완료')
}

main().catch(e => { console.error(e); process.exit(1) })
