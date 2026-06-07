/**
 * Open Food Facts 전체 덤프 스트리밍 다운로드 → 유효 제품만 Neon에 저장
 * 약 300만 제품 중 바코드+이름 있는 것만 필터 → 100만개 이상 기대
 *
 * 실행: npx ts-node --project tsconfig.scripts.json scripts/seed-off-dump.ts
 */

import axios from 'axios'
import zlib from 'zlib'
import readline from 'readline'
import { neon } from '@neondatabase/serverless'
import * as dotenv from 'dotenv'

dotenv.config({ path: '.env.local' })

const sql = neon(process.env.DATABASE_URL!)
const BATCH_SIZE = 500
const LOG_EVERY = 10000

// PostgreSQL은 null byte(0x00) 허용 안 함
function clean(s: string | null | undefined): string | null {
  if (!s) return null
  return s.replace(/\x00/g, '').trim() || null
}

// UNNEST 방식 대량 INSERT (한번에 500개)
async function batchInsert(batch: { barcode: string; name: string; brand: string | null; category: string | null; image: string | null }[]) {
  if (batch.length === 0) return

  const barcodes  = batch.map(p => p.barcode)
  const names     = batch.map(p => p.name)
  const brands    = batch.map(p => p.brand)
  const cats      = batch.map(p => p.category)
  const images    = batch.map(p => p.image)

  await sql`
    INSERT INTO products (barcode, name, brand, category, image_url)
    SELECT * FROM UNNEST(
      ${barcodes}::text[],
      ${names}::text[],
      ${brands}::text[],
      ${cats}::text[],
      ${images}::text[]
    ) AS t(barcode, name, brand, category, image_url)
    ON CONFLICT (barcode) DO NOTHING
  `
}

async function seed() {
  console.log('📦 Open Food Facts 전체 덤프 스트리밍 시작...')
  console.log('   URL: https://world.openfoodfacts.org/data/openfoodfacts-products.jsonl.gz')
  console.log('   (파일 크기 ~3GB, 다운로드+처리에 수십분 소요)\n')

  const response = await axios({
    method: 'GET',
    url: 'https://world.openfoodfacts.org/data/openfoodfacts-products.jsonl.gz',
    responseType: 'stream',
    timeout: 0, // 무제한
    headers: { 'User-Agent': 'barcode-compare/1.0 (https://barcode-compare.vercel.app)' },
  })

  const gunzip = zlib.createGunzip()
  const rl = readline.createInterface({ input: response.data.pipe(gunzip), crlfDelay: Infinity })

  let batch: { barcode: string; name: string; brand: string | null; category: string | null; image: string | null }[] = []
  let totalSaved = 0
  let totalScanned = 0
  let startTime = Date.now()

  for await (const line of rl) {
    if (!line.trim()) continue

    totalScanned++

    let p: any
    try {
      p = JSON.parse(line)
    } catch {
      continue
    }

    const barcode = (p.code || '').replace(/\D/g, '')
    if (!barcode || !/^\d{8,14}$/.test(barcode)) continue

    const rawName = clean(p.product_name_ko || p.product_name)
    if (!rawName || rawName.length < 2) continue

    batch.push({
      barcode,
      name: rawName.slice(0, 300),
      brand: clean(p.brands ? p.brands.split(',')[0] : null)?.slice(0, 100) ?? null,
      category: clean(p.categories_tags?.[0]?.replace(/^[a-z]{2}:/, ''))?.slice(0, 100) ?? null,
      image: clean(p.image_front_url || p.image_url),
    })

    if (batch.length >= BATCH_SIZE) {
      await batchInsert(batch)
      totalSaved += batch.length
      batch = []

      if (totalSaved % LOG_EVERY === 0) {
        const elapsed = Math.round((Date.now() - startTime) / 1000)
        const rate = Math.round(totalSaved / elapsed)
        console.log(`  ✓ 저장 ${totalSaved.toLocaleString()}개 | 스캔 ${totalScanned.toLocaleString()}개 | ${elapsed}초 경과 | ${rate}개/초`)
      }
    }
  }

  // 나머지 처리
  if (batch.length > 0) {
    await batchInsert(batch)
    totalSaved += batch.length
  }

  const elapsed = Math.round((Date.now() - startTime) / 1000)
  console.log(`\n✅ 완료!`)
  console.log(`   저장: ${totalSaved.toLocaleString()}개`)
  console.log(`   스캔: ${totalScanned.toLocaleString()}개`)
  console.log(`   소요: ${Math.round(elapsed / 60)}분 ${elapsed % 60}초`)
  process.exit(0)
}

seed().catch(e => {
  console.error('오류:', e.message)
  process.exit(1)
})
