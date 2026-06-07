import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })
import { neon } from '@neondatabase/serverless'

const sql = neon(process.env.DATABASE_URL!)
const barcode = '8809695257919'

async function main() {
  // 잘못된 카탈로그 매핑 삭제 (다음 검색 시 올바른 productId로 재매핑됨)
  await sql`DELETE FROM barcode_catalog_map WHERE barcode = ${barcode}`
  console.log('카탈로그 매핑 삭제 완료')

  const row = await sql`SELECT barcode, name, brand, category, spec, image_url FROM products WHERE barcode = ${barcode}`
  console.log('현재 DB 상태:', JSON.stringify(row[0], null, 2))
}
main().catch(e => { console.error(e); process.exit(1) })
