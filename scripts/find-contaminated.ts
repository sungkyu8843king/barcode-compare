import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })
import { neon } from '@neondatabase/serverless'
const sql = neon(process.env.DATABASE_URL!)

async function main() {
  const r1 = await sql`SELECT COUNT(*) c FROM products WHERE brand ILIKE '%사조동아원%'`
  const r2 = await sql`SELECT COUNT(*) c FROM products WHERE name ILIKE '%유기농 부침가루%'`
  const r3 = await sql`SELECT COUNT(*) c FROM products WHERE name ILIKE '%좋은상품%'`

  console.log('사조동아원 브랜드:', r1[0].c)
  console.log('유기농 부침가루 이름:', r2[0].c)
  console.log('좋은상품 이름:', r3[0].c)

  const sample = await sql`SELECT barcode, name, brand FROM products WHERE brand ILIKE '%사조동아원%' LIMIT 10`
  console.log('\n샘플:', JSON.stringify(sample, null, 2))
}
main().catch(e => { console.error(e); process.exit(1) })
