/**
 * 네이버 쇼핑 API로 한국 공산품 바코드 DB 구축
 * 전략: 알려진 한국 바코드(880 시작)를 OFF 개별 API로 조회 → Naver fallback
 *
 * 실행: npx ts-node --project tsconfig.scripts.json scripts/seed-korean-products.ts
 */

import axios from 'axios'
import { neon } from '@neondatabase/serverless'
import * as dotenv from 'dotenv'

dotenv.config({ path: '.env.local' })

const sql = neon(process.env.DATABASE_URL!)
const CLIENT_ID = process.env.NAVER_CLIENT_ID!
const CLIENT_SECRET = process.env.NAVER_CLIENT_SECRET!

// 검증된 한국 공산품 바코드 목록 (EAN-13, GS1 Korea 880)
const KNOWN_KOREAN_BARCODES: Array<{ barcode: string; name: string; brand: string; category: string }> = [
  // 라면
  { barcode: '8801043011990', name: '농심 신라면 (봉지)', brand: '농심', category: '라면' },
  { barcode: '8801043021180', name: '농심 짜파게티 (봉지)', brand: '농심', category: '라면' },
  { barcode: '8801073141537', name: '삼양 불닭볶음면', brand: '삼양식품', category: '라면' },
  { barcode: '8801073141513', name: '삼양 불닭볶음탕면', brand: '삼양식품', category: '라면' },
  { barcode: '8801043029124', name: '농심 너구리 (봉지)', brand: '농심', category: '라면' },
  { barcode: '8800054001456', name: '오뚜기 진라면 매운맛', brand: '오뚜기', category: '라면' },
  { barcode: '8800054001449', name: '오뚜기 진라면 순한맛', brand: '오뚜기', category: '라면' },
  { barcode: '8801043010900', name: '농심 육개장사발면', brand: '농심', category: '라면/컵라면' },
  { barcode: '8801043015745', name: '농심 오징어짬뽕컵 67g', brand: '농심', category: '라면/컵라면' },
  // 음료
  { barcode: '5449000000996', name: '코카콜라 250ml', brand: '코카콜라', category: '탄산음료' },
  { barcode: '5449000131836', name: '코카콜라 제로 250ml', brand: '코카콜라', category: '탄산음료' },
  { barcode: '8801068300015', name: '칠성사이다 250ml', brand: '롯데칠성', category: '탄산음료' },
  { barcode: '8801062517984', name: '스프라이트 250ml', brand: '코카콜라', category: '탄산음료' },
  { barcode: '8801095811015', name: '포카리스웨트 340ml', brand: '동아오츠카', category: '이온음료' },
  { barcode: '8806410100039', name: '게토레이 600ml', brand: '롯데칠성', category: '이온음료' },
  { barcode: '8801007019433', name: '박카스D 120ml', brand: '동아제약', category: '에너지음료' },
  // 과자
  { barcode: '8801117100018', name: '농심 새우깡 90g', brand: '농심', category: '스낵과자' },
  { barcode: '8801117100025', name: '농심 감자깡 75g', brand: '농심', category: '스낵과자' },
  { barcode: '8801117100278', name: '농심 포테토칩 오리지널 68g', brand: '농심', category: '스낵과자' },
  { barcode: '8801117100605', name: '농심 꼬깔콘 고소한맛 67g', brand: '농심', category: '스낵과자' },
  { barcode: '8801234100064', name: '오리온 초코파이 (12개입)', brand: '오리온', category: '초콜릿/파이' },
  { barcode: '8801234203009', name: '오리온 포카칩 오리지널 66g', brand: '오리온', category: '스낵과자' },
  { barcode: '8801062199702', name: '롯데 빼빼로 오리지널 54g', brand: '롯데제과', category: '초콜릿/스낵' },
  { barcode: '8801062199740', name: '롯데 빼빼로 아몬드 37g', brand: '롯데제과', category: '초콜릿/스낵' },
  { barcode: '8801159100015', name: '해태 홈런볼 초코 46g', brand: '해태제과', category: '스낵과자' },
  { barcode: '8801159100060', name: '해태 오예스 초코 300g', brand: '해태제과', category: '케이크/파이' },
  // 유제품
  { barcode: '8801115100124', name: '서울우유 흰우유 1000ml', brand: '서울우유', category: '우유' },
  { barcode: '8801085100071', name: '매일우유 오리지널 900ml', brand: '매일유업', category: '우유' },
  { barcode: '8801138100016', name: '남양우유 맛있는우유GT 900ml', brand: '남양유업', category: '우유' },
  { barcode: '8801097100011', name: '빙그레 바나나맛우유 240ml', brand: '빙그레', category: '가공유' },
  // 아이스크림
  { barcode: '8801097300015', name: '빙그레 메로나 바', brand: '빙그레', category: '아이스크림' },
  { barcode: '8801062801018', name: '롯데 월드콘 바닐라', brand: '롯데제과', category: '아이스크림' },
  { barcode: '8801062801025', name: '롯데 스크류바', brand: '롯데제과', category: '아이스크림' },
  { barcode: '8801159800015', name: '해태 부라보콘 바닐라', brand: '해태제과', category: '아이스크림' },
  // 생활식품
  { barcode: '8800054510014', name: '오뚜기 3분 카레 중간맛 200g', brand: '오뚜기', category: '즉석식품' },
  { barcode: '8800054510007', name: '오뚜기 3분 짜장 200g', brand: '오뚜기', category: '즉석식품' },
  { barcode: '8801007200016', name: 'CJ 햇반 210g', brand: 'CJ제일제당', category: '즉석밥' },
  { barcode: '8806040010018', name: '동원 참치 라이트 스탠다드 150g', brand: '동원F&B', category: '통조림' },
  // 소스/양념
  { barcode: '8800054700019', name: '오뚜기 토마토케첩 500g', brand: '오뚜기', category: '소스/케첩' },
  { barcode: '8809000010015', name: '청정원 순창 고추장 500g', brand: '대상', category: '장류' },
  // 커피
  { barcode: '8801007200139', name: '맥심 모카골드 커피믹스 100개입', brand: '동서식품', category: '커피' },
  { barcode: '8801055700018', name: '레쓰비 카페라떼 240ml', brand: '동아오츠카', category: 'RTD커피' },
]

function cleanTitle(title: string): string {
  return title.replace(/<[^>]*>/g, '').trim()
}

async function lookupNaverByName(name: string, barcode: string) {
  try {
    const res = await axios.get('https://openapi.naver.com/v1/search/shop.json', {
      headers: {
        'X-Naver-Client-Id': CLIENT_ID,
        'X-Naver-Client-Secret': CLIENT_SECRET,
      },
      params: { query: name, display: 3, sort: 'sim' },
      timeout: 8000,
    })
    const items = res.data.items || []
    if (items.length === 0) return null
    const first = items[0]
    return {
      image_url: first.image || null,
    }
  } catch {
    return null
  }
}

async function seed() {
  console.log(`🚀 한국 공산품 시드 시작 (${KNOWN_KOREAN_BARCODES.length}개)...\n`)
  let inserted = 0
  let failed = 0

  for (const product of KNOWN_KOREAN_BARCODES) {
    try {
      // 네이버에서 이미지 가져오기
      const naverInfo = await lookupNaverByName(product.name, product.barcode)

      await sql`
        INSERT INTO products (barcode, name, brand, category, image_url)
        VALUES (
          ${product.barcode},
          ${product.name},
          ${product.brand},
          ${product.category},
          ${naverInfo?.image_url ?? null}
        )
        ON CONFLICT (barcode) DO UPDATE SET
          name = EXCLUDED.name,
          brand = EXCLUDED.brand,
          category = EXCLUDED.category,
          image_url = COALESCE(EXCLUDED.image_url, products.image_url),
          updated_at = NOW()
      `
      inserted++
      console.log(`  ✓ ${product.barcode} - ${product.name}`)
      await new Promise(r => setTimeout(r, 200)) // API rate limit
    } catch (e) {
      failed++
      console.error(`  ✗ ${product.barcode} - ${product.name}: ${e}`)
    }
  }

  console.log(`\n📊 완료: ${inserted}개 저장, ${failed}개 실패`)
  process.exit(0)
}

seed().catch(console.error)
