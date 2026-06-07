import { config } from 'dotenv'
import { resolve } from 'path'
import { neon } from '@neondatabase/serverless'
import axios from 'axios'

config({ path: resolve(process.cwd(), '.env.local') })

const sql = neon(process.env.DATABASE_URL!)
const CLIENT_ID = process.env.NAVER_CLIENT_ID!
const CLIENT_SECRET = process.env.NAVER_CLIENT_SECRET!

async function searchNaver(query: string) {
  const res = await axios.get('https://openapi.naver.com/v1/search/shop.json', {
    headers: { 'X-Naver-Client-Id': CLIENT_ID, 'X-Naver-Client-Secret': CLIENT_SECRET },
    params: { query, display: 20, sort: 'asc' },
    timeout: 5000,
  })
  return res.data?.items ?? []
}

function pickCatalogImage(items: any[]): { image: string | null; isCatalog: boolean } {
  const catalog = items.find((i: any) => i.productType === '1' && i.image)
  if (catalog) return { image: catalog.image, isCatalog: true }
  const any = items.find((i: any) => i.image)
  return { image: any?.image ?? null, isCatalog: false }
}

async function delay(ms: number) { return new Promise(r => setTimeout(r, ms)) }

async function main() {
  // 최신 20개 가져와서 이미지 업데이트 (이미지 없거나 비공식인 것 포함)
  const products = await sql`
    SELECT barcode, name, brand, image_url
    FROM products
    WHERE name ~ '[가-힣]'
    ORDER BY updated_at DESC
    LIMIT 20
  `

  console.log(`🔍 ${products.length}개 제품 이미지 업데이트 시작`)
  let updated = 0

  for (const product of products) {
    try {
      // 바코드로 먼저, 없으면 이름으로
      let items = await searchNaver(product.barcode as string)
      if (items.length === 0) items = await searchNaver(product.name as string)

      const { image, isCatalog } = pickCatalogImage(items)

      if (image && (isCatalog || !product.image_url)) {
        await sql`
          UPDATE products SET image_url = ${image}, updated_at = NOW()
          WHERE barcode = ${product.barcode}
        `
        const tag = isCatalog ? '✅ 카탈로그' : '📷 일반'
        console.log(`${tag} | ${product.name} → 이미지 업데이트`)
        updated++
      } else {
        console.log(`⏭  스킵 | ${product.name} (이미 카탈로그 이미지이거나 없음)`)
      }

      await delay(250) // 네이버 레이트리밋
    } catch (e: any) {
      console.error(`❌ ${product.name}:`, e.message)
    }
  }

  console.log(`\n✅ 완료 - ${updated}/${products.length}개 업데이트`)
}

main().catch(e => { console.error(e); process.exit(1) })
