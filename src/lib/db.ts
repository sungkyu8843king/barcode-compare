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
