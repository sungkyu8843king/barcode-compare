/**
 * Open Food Facts에서 한국 제품 데이터를 수집해 Supabase에 저장
 * 실행: npx ts-node --project tsconfig.scripts.json scripts/seed-from-open-food-facts.ts
 */

import axios from 'axios'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

interface OFFSearchResponse {
  products: Array<{
    code: string
    product_name: string
    product_name_ko: string
    brands: string
    categories_tags: string[]
    image_front_url: string
    countries_tags: string[]
  }>
  page: number
  page_size: number
  count: number
}

async function fetchKoreanProducts(page = 1): Promise<OFFSearchResponse> {
  const response = await axios.get<OFFSearchResponse>(
    'https://world.openfoodfacts.org/cgi/search.pl',
    {
      params: {
        action: 'process',
        tagtype_0: 'countries',
        tag_contains_0: 'contains',
        tag_0: 'south-korea',
        json: 1,
        page,
        page_size: 100,
        fields: 'code,product_name,product_name_ko,brands,categories_tags,image_front_url',
      },
      timeout: 30000,
    }
  )
  return response.data
}

async function seed() {
  console.log('🚀 Open Food Facts에서 한국 제품 수집 시작...')

  let page = 1
  let totalInserted = 0
  let totalSkipped = 0

  while (true) {
    console.log(`📦 페이지 ${page} 수집 중...`)

    let data: OFFSearchResponse
    try {
      data = await fetchKoreanProducts(page)
    } catch (err) {
      console.error(`페이지 ${page} 수집 실패:`, err)
      break
    }

    if (!data.products || data.products.length === 0) {
      console.log('✅ 모든 데이터 수집 완료')
      break
    }

    const validProducts = data.products
      .filter(p => {
        const name = p.product_name_ko || p.product_name
        const barcode = p.code
        return (
          name &&
          barcode &&
          /^\d{8,14}$/.test(barcode.replace(/^0+/, '') || barcode)
        )
      })
      .map(p => ({
        barcode: p.code.replace(/^0+/, '') || p.code,
        name: (p.product_name_ko || p.product_name).trim().slice(0, 300),
        brand: p.brands ? p.brands.split(',')[0].trim().slice(0, 100) : null,
        category: p.categories_tags?.[0]?.replace('en:', '').slice(0, 100) || null,
        image_url: p.image_front_url || null,
      }))

    if (validProducts.length > 0) {
      const { error } = await supabase
        .from('products')
        .upsert(validProducts, { onConflict: 'barcode', ignoreDuplicates: false })

      if (error) {
        console.error('DB 저장 실패:', error.message)
      } else {
        totalInserted += validProducts.length
        console.log(`  ✓ ${validProducts.length}개 저장 (총 ${totalInserted}개)`)
      }
    }

    totalSkipped += data.products.length - validProducts.length

    if (page * data.page_size >= data.count) break
    page++

    // Rate limit 방지
    await new Promise(resolve => setTimeout(resolve, 1000))
  }

  console.log(`\n📊 완료: 저장 ${totalInserted}개, 스킵 ${totalSkipped}개`)
}

seed().catch(console.error)
