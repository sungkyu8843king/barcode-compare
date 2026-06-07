import { neon } from '@neondatabase/serverless'

const sql = neon(process.env.DATABASE_URL!)

export default sql

// 제품 조회
export async function getProduct(barcode: string) {
  const rows = await sql`
    SELECT * FROM products WHERE barcode = ${barcode} LIMIT 1
  `
  return rows[0] || null
}

// 제품 upsert
export async function upsertProduct(product: {
  barcode: string
  name: string
  brand?: string | null
  category?: string | null
  image_url?: string | null
}) {
  const rows = await sql`
    INSERT INTO products (barcode, name, brand, category, image_url)
    VALUES (${product.barcode}, ${product.name}, ${product.brand ?? null}, ${product.category ?? null}, ${product.image_url ?? null})
    ON CONFLICT (barcode) DO UPDATE SET
      name = EXCLUDED.name,
      brand = COALESCE(EXCLUDED.brand, products.brand),
      category = COALESCE(EXCLUDED.category, products.category),
      image_url = COALESCE(EXCLUDED.image_url, products.image_url),
      updated_at = NOW()
    RETURNING *
  `
  return rows[0]
}

// 최근 가격 조회 (1시간 이내)
export async function getRecentPrices(barcode: string) {
  return sql`
    SELECT * FROM price_snapshots
    WHERE barcode = ${barcode}
      AND fetched_at > NOW() - INTERVAL '1 hour'
    ORDER BY price ASC
  `
}

// 가격 저장
export async function insertPrices(prices: Array<{
  barcode: string
  platform: string
  price: number
  original_price?: number | null
  discount_rate?: number | null
  url: string
  seller_name?: string | null
  in_stock?: boolean
}>) {
  if (prices.length === 0) return

  // Neon은 배열 INSERT를 위해 반복 실행
  for (const p of prices) {
    await sql`
      INSERT INTO price_snapshots (barcode, platform, price, original_price, discount_rate, url, seller_name, in_stock)
      VALUES (${p.barcode}, ${p.platform}, ${p.price}, ${p.original_price ?? null}, ${p.discount_rate ?? null}, ${p.url}, ${p.seller_name ?? null}, ${p.in_stock ?? true})
    `
  }
}

// 검색 기록 추가 (비차단)
export async function insertSearchLog(barcode: string, productName: string | null, productImage: string | null) {
  try {
    await sql`
      INSERT INTO search_logs (barcode, product_name, product_image)
      VALUES (${barcode}, ${productName}, ${productImage})
    `
  } catch { /* non-critical */ }
}

// 최근 검색 기록 (24시간, 바코드별 집계)
export async function getRecentSearchLogs(limit = 30) {
  try {
    return await sql`
      SELECT
        barcode,
        MAX(product_name)  AS product_name,
        MAX(product_image) AS product_image,
        MAX(searched_at)   AS searched_at,
        COUNT(*)           AS search_count
      FROM search_logs
      WHERE product_name IS NOT NULL
        AND searched_at > NOW() - INTERVAL '24 hours'
      GROUP BY barcode
      ORDER BY MAX(searched_at) DESC
      LIMIT ${limit}
    `
  } catch { return [] }
}

// 제품 등록 신청 저장
export async function insertProductRequest(barcode: string, imageData: string | null) {
  try {
    const rows = await sql`
      INSERT INTO product_requests (barcode, image_data)
      VALUES (${barcode}, ${imageData})
      RETURNING *
    `
    return rows[0]
  } catch { return null }
}

// 신규 등록 제품 (이미지 있는 것, 최근 업데이트 순)
export async function getNewProducts(limit = 12) {
  try {
    return await sql`
      SELECT barcode, name, brand, image_url, created_at
      FROM products
      WHERE image_url IS NOT NULL
      ORDER BY created_at DESC
      LIMIT ${limit}
    `
  } catch { return [] }
}

// 전체 제품 수
export async function getProductCount() {
  try {
    const rows = await sql`SELECT COUNT(*) AS count FROM products`
    return Number(rows[0]?.count ?? 0)
  } catch { return 0 }
}

// 제품 목록 검색
export async function searchProducts(q: string, limit: number, offset: number) {
  if (q) {
    return sql`
      SELECT *, COUNT(*) OVER() as total_count
      FROM products
      WHERE name ILIKE ${'%' + q + '%'}
      ORDER BY created_at DESC
      LIMIT ${limit} OFFSET ${offset}
    `
  }
  return sql`
    SELECT *, COUNT(*) OVER() as total_count
    FROM products
    ORDER BY created_at DESC
    LIMIT ${limit} OFFSET ${offset}
  `
}
