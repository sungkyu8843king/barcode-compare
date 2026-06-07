import { config } from 'dotenv'
import { resolve } from 'path'
import { Redis } from '@upstash/redis'

config({ path: resolve(process.cwd(), '.env.local') })

async function main() {
  const redis = Redis.fromEnv()
  const barcodes = process.argv.slice(2)
  if (barcodes.length === 0) {
    console.log('사용법: npx tsx scripts/clear-cache.ts [바코드1] [바코드2] ...')
    return
  }
  const keys = barcodes.flatMap(b => [`product:${b}`, `prices:${b}`])
  const deleted = await redis.del(...keys)
  console.log(`✅ 캐시 삭제: ${barcodes.join(', ')} (${deleted}개 키 삭제)`)
}
main().catch(e => { console.error(e); process.exit(1) })
