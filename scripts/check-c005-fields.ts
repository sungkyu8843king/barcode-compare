import { config } from 'dotenv'
import { resolve } from 'path'
import axios from 'axios'

config({ path: resolve(process.cwd(), '.env.local') })

async function main() {
  const KEY = process.env.FOODSAFETY_API_KEY
  const res = await axios.get(
    `http://openapi.foodsafetykorea.go.kr/api/${KEY}/C005/json/1/3`,
    { timeout: 10000 }
  )
  const rows = res.data?.C005?.row ?? []
  if (rows.length === 0) { console.log('결과 없음'); return }
  console.log('필드목록:', Object.keys(rows[0]).join(', '))
  console.log('\n첫번째 레코드:')
  console.log(JSON.stringify(rows[0], null, 2))
}
main().catch(e => { console.error(e.message); process.exit(1) })
