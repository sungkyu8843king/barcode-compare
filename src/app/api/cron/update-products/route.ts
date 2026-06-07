import { NextRequest, NextResponse } from 'next/server'
import sql from '@/lib/db'
import { searchNaverShopping } from '@/lib/naver-shopping'
import axios from 'axios'

const FOODSAFETY_KEY = process.env.FOODSAFETY_API_KEY!
const CRON_SECRET = process.env.CRON_SECRET

export async function GET(req: NextRequest) {
  // Vercel Cron 인증
  const authHeader = req.headers.get('authorization')
  if (CRON_SECRET && authHeader !== `Bearer ${CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const results: Record<string, number> = {}

  // ── 1. 이미지 없거나 카탈로그 이미지로 보강 (50개/회) ──
  try {
    const noImageProducts = await sql`
      SELECT barcode, name FROM products
      WHERE name ~ '[가-힣]'
      ORDER BY RANDOM()
      LIMIT 50
    `

    let imageUpdated = 0
    for (const product of noImageProducts) {
      try {
        // 바코드로 먼저 시도, 없으면 이름으로
        let items = await searchNaverShopping(product.barcode as string, 5)
        if (items.length === 0) items = await searchNaverShopping(product.name as string, 5)
        // 카탈로그 상품(공식 이미지) 우선
        const catalogItem = items.find(i => i.productType === '1' && i.image)
        const image = catalogItem?.image || items.find(i => i.image)?.image
        // 카탈로그 이미지가 있으면 항상 업데이트, 없으면 이미지 없는 경우만
        const needsUpdate = catalogItem || !product.image_url
        if (image && needsUpdate) {
          await sql`
            UPDATE products SET image_url = ${image}, updated_at = NOW()
            WHERE barcode = ${product.barcode}
          `
          imageUpdated++
        }
        await delay(200) // 네이버 API 레이트리밋 방지
      } catch {}
    }
    results.imageUpdated = imageUpdated
  } catch (e) {
    console.error('[cron] 이미지 보강 실패:', e)
    results.imageUpdated = 0
  }

  // ── 2. 식품안전나라 신규 제품 추가 (건강기능식품 포함) ──
  try {
    const added = await fetchFoodsafetyBatch()
    results.foodsafetyAdded = added
  } catch (e) {
    console.error('[cron] 식품안전나라 실패:', e)
    results.foodsafetyAdded = 0
  }

  // ── 3. 전체 제품 수 ──
  const countRow = await sql`SELECT COUNT(*) AS c FROM products`
  results.totalProducts = Number(countRow[0]?.c ?? 0)

  console.log('[cron] 완료:', results)
  return NextResponse.json({ ok: true, ...results })
}

async function fetchFoodsafetyBatch(): Promise<number> {
  if (!FOODSAFETY_KEY) return 0

  // 마지막으로 가져온 행 번호를 기록하는 간단한 방법:
  // product_requests 테이블에 cron 메타정보 저장 (barcode='__cron_offset__')
  const metaRows = await sql`
    SELECT image_data FROM product_requests
    WHERE barcode = '__cron_offset__'
    LIMIT 1
  `
  const lastOffset = Number(metaRows[0]?.image_data ?? 0)
  const start = lastOffset + 1
  const end = lastOffset + 500

  const url = `http://openapi.foodsafetykorea.go.kr/api/${FOODSAFETY_KEY}/C005/json/${start}/${end}`
  const res = await axios.get(url, { timeout: 15000 })
  const items: any[] = res.data?.C005?.row ?? []

  if (items.length === 0) {
    // 끝까지 다 가져왔으면 처음부터 다시
    await sql`
      INSERT INTO product_requests (barcode, image_data, status)
      VALUES ('__cron_offset__', '0', 'cron')
      ON CONFLICT DO NOTHING
    `
    await sql`
      UPDATE product_requests SET image_data = '0'
      WHERE barcode = '__cron_offset__'
    `
    return 0
  }

  // 중복 제거 후 UPSERT
  const seen = new Map<string, { barcode: string; name: string; brand: string | null }>()
  for (const item of items) {
    const barcode = (item.BAR_CD ?? '').trim().replace(/\x00/g, '')
    const name = (item.PRDLST_NM ?? '').trim().replace(/\x00/g, '')
    if (barcode && /^\d{8,14}$/.test(barcode) && name) {
      seen.set(barcode, {
        barcode,
        name,
        brand: (item.BSSH_NM ?? '').trim().replace(/\x00/g, '') || null,
      })
    }
  }

  let added = 0
  for (const p of seen.values()) {
    await sql`
      INSERT INTO products (barcode, name, brand)
      VALUES (${p.barcode}, ${p.name}, ${p.brand})
      ON CONFLICT (barcode) DO NOTHING
    `
    added++
  }

  // 오프셋 업데이트
  await sql`
    INSERT INTO product_requests (barcode, image_data, status)
    VALUES ('__cron_offset__', ${String(end)}, 'cron')
    ON CONFLICT DO NOTHING
  `
  await sql`
    UPDATE product_requests SET image_data = ${String(end)}
    WHERE barcode = '__cron_offset__'
  `

  return added
}

function delay(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms))
}
