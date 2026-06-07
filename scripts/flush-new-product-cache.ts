import { config } from 'dotenv'
import { resolve } from 'path'
import { neon } from '@neondatabase/serverless'
import { Redis } from '@upstash/redis'

config({ path: resolve(process.cwd(), '.env.local') })

const sql = neon(process.env.DATABASE_URL!)
const redis = Redis.fromEnv()

async function main() {
  const products = await sql`
    SELECT barcode FROM products
    WHERE name ~ '[가-힣]'
    ORDER BY updated_at DESC
    LIMIT 20
  `

  const keys = products.flatMap((p: any) => [
    `product:${p.barcode}`,
    `prices:${p.barcode}`,
  ])

  if (keys.length > 0) {
    await redis.del(...keys)
    console.log(`✅ ${products.length}개 제품 캐시 삭제 완료`)
  }
}

main().catch(e => { console.error(e); process.exit(1) })
