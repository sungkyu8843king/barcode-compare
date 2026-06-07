/**
 * 네이버 쇼핑 API로 카테고리별 한국 공산품 바코드 수집
 * 실행: npx ts-node --project tsconfig.scripts.json scripts/seed-naver-products.ts
 *
 * 바코드가 포함된 제품명을 검색해서 DB에 적재
 * 하루 25,000건 무료 제한 있으므로 카테고리별로 나눠서 실행
 */

import axios from 'axios'
import { neon } from '@neondatabase/serverless'
import * as dotenv from 'dotenv'

dotenv.config({ path: '.env.local' })

const sql = neon(process.env.DATABASE_URL!)
const CLIENT_ID = process.env.NAVER_CLIENT_ID!
const CLIENT_SECRET = process.env.NAVER_CLIENT_SECRET!

// 한국 공산품 주요 검색어 (바코드가 있는 제품들)
const SEED_QUERIES = [
  // 라면/면류
  '신라면', '짜파게티', '너구리', '진라면', '불닭볶음면', '삼양라면', '팔도비빔면', '농심사리곰탕',
  // 과자/스낵
  '오리온초코파이', '롯데빼빼로', '해태홈런볼', '농심새우깡', '오리온포카칩', '크라운산도', '오징어집',
  '꼬깔콘', '프링글스', '레이즈', '도리토스', '허니버터칩', '수미칩',
  // 음료
  '코카콜라', '펩시콜라', '칠성사이다', '스프라이트', '환타', '제로콜라', '맥콜',
  '롯데칠성음료', '포카리스웨트', '게토레이', '파워에이드', '비타500',
  // 아이스크림
  '빙그레바나나맛우유', '서울우유', '매일우유', '남양우유', '파스퇴르',
  '롯데월드콘', '빙그레메로나', '해태부라보콘', '롯데스크류바', '빙그레투게더',
  // 통조림/레토르트
  '동원참치', '사조참치', '오뚜기3분카레', '오뚜기3분짜장', 'CJ햇반',
  // 소스/양념
  '오뚜기케첩', '청정원고추장', '해찬들고추장', 'CJ백설설탕', '대상미원',
  // 커피/차
  '맥심모카골드', '카누아메리카노', '스타벅스RTD', '레쓰비', '조지아커피',
  // 생활용품
  '박카스', '비타민C', '판피린', '게보린',
  // 유제품
  '서울우유200ml', '매일두유', '삼육두유', '야쿠르트',
]

interface NaverItem {
  title: string
  link: string
  image: string
  lprice: string
  brand: string
  maker: string
  category1: string
  category2: string
  category3: string
  productId: string
}

function cleanTitle(title: string): string {
  return title.replace(/<[^>]*>/g, '').trim()
}

// 제품명에서 바코드 추출 시도 (일부 제품은 제품명에 바코드 포함)
function extractBarcode(text: string): string | null {
  const match = text.match(/\b\d{13}\b|\b\d{12}\b|\b\d{8}\b/)
  return match ? match[0] : null
}

async function searchNaver(query: string, start = 1): Promise<NaverItem[]> {
  try {
    const res = await axios.get('https://openapi.naver.com/v1/search/shop.json', {
      headers: {
        'X-Naver-Client-Id': CLIENT_ID,
        'X-Naver-Client-Secret': CLIENT_SECRET,
      },
      params: { query, display: 100, start, sort: 'sim' },
      timeout: 10000,
    })
    return res.data.items || []
  } catch {
    return []
  }
}

async function upsertProduct(barcode: string, name: string, brand: string | null, category: string | null, image: string | null) {
  try {
    await sql`
      INSERT INTO products (barcode, name, brand, category, image_url)
      VALUES (${barcode}, ${name}, ${brand}, ${category}, ${image})
      ON CONFLICT (barcode) DO UPDATE SET
        name = EXCLUDED.name,
        brand = COALESCE(EXCLUDED.brand, products.brand),
        category = COALESCE(EXCLUDED.category, products.category),
        image_url = COALESCE(EXCLUDED.image_url, products.image_url),
        updated_at = NOW()
    `
    return true
  } catch {
    return false
  }
}

async function seed() {
  console.log('🚀 네이버 쇼핑 제품 수집 시작...')
  let total = 0

  for (const query of SEED_QUERIES) {
    console.log(`\n🔍 "${query}" 검색 중...`)
    const items = await searchNaver(query)

    for (const item of items) {
      const name = cleanTitle(item.title)
      // productId를 바코드 대용으로 사용 (네이버 고유 ID)
      // 실제 바코드는 없으므로 네이버 productId 기반으로 저장
      // productId는 숫자이므로 barcode 형식과 맞지 않을 수 있어 스킵

      // 제품명이나 링크에서 바코드 추출 시도
      const barcode = extractBarcode(name) || extractBarcode(item.link)
      if (!barcode) continue

      const brand = item.brand || item.maker || null
      const category = item.category3 || item.category2 || item.category1 || null
      const image = item.image || null

      const ok = await upsertProduct(barcode, name.slice(0, 300), brand?.slice(0, 100) || null, category?.slice(0, 100) || null, image)
      if (ok) total++
    }

    await new Promise(r => setTimeout(r, 500))
  }

  console.log(`\n✅ 완료: ${total}개 저장`)
  process.exit(0)
}

seed().catch(console.error)
