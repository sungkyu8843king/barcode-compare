import { config } from 'dotenv'
import { resolve } from 'path'
import { neon } from '@neondatabase/serverless'

config({ path: resolve(process.cwd(), '.env.local') })
const sql = neon(process.env.DATABASE_URL!)

async function main() {
  const rows = await sql`SELECT image_url FROM products WHERE image_url IS NOT NULL LIMIT 20`
  rows.forEach((r: any) => console.log(r.image_url?.substring(0, 100)))
}
main()
