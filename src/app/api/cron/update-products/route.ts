import { NextRequest, NextResponse } from 'next/server'
import sql from '@/lib/db'
import { searchNaverShopping, cleanNaverTitle, extractSpec } from '@/lib/naver-shopping'
import { parseProductName } from '@/lib/claude-ai'
import axios from 'axios'

const FOODSAFETY_KEY = process.env.FOODSAFETY_API_KEY!
const CRON_SECRET = process.env.CRON_SECRET

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization')
  if (CRON_SECRET && authHeader !== `Bearer ${CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const results: Record<string, number> = {}

  // ── 1. 식품안전나라 C005 신규 제품 추가 ──
  try {
    results.c005Added = await fetchFoodsafetyBatch('C005', 'c005_offset', 500)
  } catch (e) {
    console.error('[cron] C005 실패:', e)
    results.c005Added = 0
  }

  // ── 2. 건강기능식품 DB (HFDB) ──
  try {
    results.hfdbAdded = await fetchFoodsafetyBatch('HFDB_04_01', 'hfdb_offset', 300)
  } catch (e) {
    console.error('[cron] HFDB 실패:', e)
    results.hfdbAdded = 0
  }

  // ── 3. 이미지 없는 제품 → Naver 카탈로그 이미지 보강 (30개) ──
  try {
    results.imageEnriched = await enrichMissingImages(30)
  } catch (e) {
    console.error('[cron] 이미지 보강 실패:', e)
    results.imageEnriched = 0
  }

  // ── 4. 제품명 Claude 정제 (이름이 지저분한 것 20개) ──
  try {
    results.namesRefined = await refineMessyNames(20)
  } catch (e) {
    console.error('[cron] 이름 정제 실패:', e)
    results.namesRefined = 0
  }

  const countRow = await sql`SELECT COUNT(*) AS c FROM products`
  results.totalProducts = Number(countRow[0]?.c ?? 0)

  console.log('[cron/update-products] 완료:', results)
  return NextResponse.json({ ok: true, ...results, ts: new Date().toISOString() })
}

// ── 식품안전나라 API 배치 (C005 / HFDB 공통) ──
async function fetchFoodsafetyBatch(apiId: string, offsetKey: string, batchSize: number): Promise<number> {
  if (!FOODSAFETY_KEY) return 0

  const metaRows = await sql`
    SELECT image_data FROM product_requests WHERE barcode = ${`__${offsetKey}__`} LIMIT 1
  `
  const lastOffset = Number(metaRows[0]?.image_data ?? 0)
  const start = lastOffset + 1
  const end = lastOffset + batchSize

  const url = `http://openapi.foodsafetykorea.go.kr/api/${FOODSAFETY_KEY}/${apiId}/json/${start}/${end}`
  const res = await axios.get(url, { timeout: 20000 })
  const rows: any[] = res.data?.[apiId]?.row ?? []

  // 끝에 도달하면 오프셋 리셋
  if (rows.length === 0) {
    await upsertMeta(`__${offsetKey}__`, '0')
    return 0
  }

  const seen = new Map<string, { barcode: string; name: string; brand: string | null; spec: string | null }>()
  for (const item of rows) {
    const barcode = (item.BAR_CD ?? item.BARCODE ?? '').trim().replace(/\x00/g, '')
    const name = (item.PRDLST_NM ?? item.PRDT_NM ?? item.PRDLST_DCNM ?? '').trim().replace(/\x00/g, '')
    if (barcode && /^\d{8,14}$/.test(barcode) && name) {
      const rawSpec = (item.CAPACITY ?? item.NET_WT ?? item.CONTENT ?? item.SERVING_SIZE ?? '').trim().replace(/\x00/g, '')
      seen.set(barcode, {
        barcode,
        name,
        brand: (item.BSSH_NM ?? item.ENTRPS_NM ?? '').trim().replace(/\x00/g, '') || null,
        spec: rawSpec || null,
      })
    }
  }

  let added = 0
  for (const p of seen.values()) {
    await sql`
      INSERT INTO products (barcode, name, brand, spec)
      VALUES (${p.barcode}, ${p.name}, ${p.brand}, ${p.spec})
      ON CONFLICT (barcode) DO UPDATE SET
        spec  = COALESCE(EXCLUDED.spec,  products.spec),
        brand = COALESCE(EXCLUDED.brand, products.brand)
    `
    added++
  }

  await upsertMeta(`__${offsetKey}__`, String(end))
  return added
}

// ── 이미지 없는 제품에 Naver 카탈로그 이미지 보강 ──
async function enrichMissingImages(limit: number): Promise<number> {
  const products = await sql`
    SELECT barcode, name, brand FROM products
    WHERE image_url IS NULL
      AND name ~ '[가-힣]'
      AND LENGTH(name) >= 2
    ORDER BY created_at DESC
    LIMIT ${limit}
  `

  let enriched = 0
  for (const p of products) {
    try {
      const query = p.brand ? `${p.brand} ${p.name}` : p.name as string
      const items = await searchNaverShopping(query as string, 10)
      const catalogItem = items.find(i => i.productType === '1' && i.image)
      const anyItem = items.find(i => i.image)
      const image = catalogItem?.image || anyItem?.image
      const spec = catalogItem ? extractSpec(cleanNaverTitle(catalogItem.title)) : null

      if (image) {
        await sql`
          UPDATE products SET
            image_url  = ${image},
            spec       = COALESCE(${spec}, spec),
            updated_at = NOW()
          WHERE barcode = ${p.barcode} AND image_url IS NULL
        `
        enriched++
      }
      await delay(300)
    } catch {}
  }
  return enriched
}

// ── 지저분한 이름을 Claude로 정제 ──
async function refineMessyNames(limit: number): Promise<number> {
  if (!process.env.ANTHROPIC_API_KEY) return 0

  const products = await sql`
    SELECT barcode, name FROM products
    WHERE (
      LENGTH(name) > 30
      OR name ~ '[!?【】★☆♥【]'
      OR name ILIKE '%특가%'
      OR name ILIKE '%무료배송%'
      OR name ILIKE '%묶음%'
    )
    AND name ~ '[가-힣]'
    ORDER BY updated_at ASC
    LIMIT ${limit}
  `

  let refined = 0
  for (const p of products) {
    try {
      const parsed = await parseProductName(p.name as string, p.barcode as string)
      if (parsed?.name && parsed.name !== p.name) {
        await sql`
          UPDATE products SET
            name       = ${parsed.name},
            brand      = COALESCE(${parsed.brand}, brand),
            spec       = COALESCE(${parsed.spec},  spec),
            updated_at = NOW()
          WHERE barcode = ${p.barcode}
        `
        refined++
      }
      await delay(150)
    } catch {}
  }
  return refined
}

async function upsertMeta(key: string, value: string) {
  await sql`
    INSERT INTO product_requests (barcode, image_data, status) VALUES (${key}, ${value}, 'cron')
    ON CONFLICT (barcode) DO UPDATE SET image_data = ${value}
  `
}

function delay(ms: number) { return new Promise(r => setTimeout(r, ms)) }
