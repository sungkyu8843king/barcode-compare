import { NextRequest, NextResponse } from 'next/server'
import sql from '@/lib/db'
import { invalidateBarcode } from '@/lib/redis'
import { searchNaverShopping, cleanNaverTitle } from '@/lib/naver-shopping'
import { PriceSnapshot, Platform } from '@/types'

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}))
  const { barcode, feedbackType, userQuery, note } = body as {
    barcode?: string
    feedbackType?: string
    userQuery?: string
    note?: string
  }

  if (!barcode || !/^\d{8,14}$/.test(barcode)) {
    return NextResponse.json({ error: '유효하지 않은 바코드' }, { status: 400 })
  }

  // 피드백 저장
  await sql`
    INSERT INTO product_feedback (barcode, feedback_type, user_query, note)
    VALUES (${barcode}, ${feedbackType || 'wrong_product'}, ${userQuery || null}, ${note || null})
  `.catch(() => {})

  // 캐시 무효화 (다음 검색 시 새로 조회)
  await invalidateBarcode(barcode).catch(() => {})

  // 사용자가 올바른 제품명을 입력한 경우 → 즉시 재검색
  if (userQuery?.trim()) {
    try {
      const items = await searchNaverShopping(userQuery.trim(), 20)
      const validItems = items.filter(i => i.lprice && parseInt(i.lprice) >= 100)
      const now = new Date().toISOString()

      const prices: PriceSnapshot[] = validItems.slice(0, 10).map((item, idx) => ({
        id: idx,
        barcode,
        platform: 'naver' as Platform,
        price: parseInt(item.lprice),
        original_price: item.hprice ? parseInt(item.hprice) : null,
        discount_rate: null,
        url: item.link,
        seller_name: item.mallName,
        in_stock: true,
        fetched_at: now,
        product_title: cleanNaverTitle(item.title),
        shipping_fee: null,
      }))

      return NextResponse.json({
        success: true,
        retried: true,
        prices,
        message: prices.length > 0
          ? `"${userQuery}" 로 ${prices.length}개 결과를 찾았습니다.`
          : `"${userQuery}" 로 검색했지만 결과가 없습니다.`,
      })
    } catch {
      // 재검색 실패해도 피드백은 접수됨
    }
  }

  return NextResponse.json({ success: true, retried: false, message: '신고가 접수되었습니다. 감사합니다!' })
}
