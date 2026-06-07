import { NextRequest, NextResponse } from 'next/server'
import sql from '@/lib/db'
import { upsertProduct } from '@/lib/db'
import { invalidateBarcode } from '@/lib/redis'
import { searchNaverShopping, cleanNaverTitle } from '@/lib/naver-shopping'
import { auth } from '@/lib/auth'

const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'tjdrb8423@gmail.com'

async function checkAdmin() {
  const session = await auth()
  return session?.user?.email === ADMIN_EMAIL
}

// GET: 신고 목록 조회
export async function GET(req: NextRequest) {
  if (!await checkAdmin()) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const status = searchParams.get('status') || 'pending'

  const rows = await sql`
    SELECT
      f.id, f.barcode, f.feedback_type, f.user_query, f.note, f.image_data,
      f.status, f.submitted_at,
      p.name AS product_name, p.brand, p.image_url AS product_image
    FROM product_feedback f
    LEFT JOIN products p ON p.barcode = f.barcode
    WHERE f.status = ${status}
    ORDER BY f.submitted_at DESC
    LIMIT 100
  `
  return NextResponse.json(rows)
}

// POST: 신고 처리 (적용 or 닫기)
export async function POST(req: NextRequest) {
  if (!await checkAdmin()) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id, action, newName } = await req.json() as {
    id: number
    action: 'apply' | 'close'
    newName?: string
  }

  // 신고 정보 조회
  const rows = await sql`SELECT * FROM product_feedback WHERE id = ${id}`
  const fb = rows[0]
  if (!fb) return NextResponse.json({ error: '신고를 찾을 수 없습니다.' }, { status: 404 })

  const barcode = fb.barcode as string
  let message = ''

  if (action === 'apply' && newName?.trim()) {
    // 제품명 업데이트 + 네이버에서 카탈로그 이미지 재조회
    let newImage: string | null = null
    try {
      const items = await searchNaverShopping(newName.trim(), 20)
      const catalogItem = items.find(i => i.productType === '1' && i.image)
      newImage = catalogItem?.image || items[0]?.image || null
    } catch {}

    await upsertProduct({ barcode, name: newName.trim(), image_url: newImage || undefined })
    await invalidateBarcode(barcode)
    message = `"${newName}" 으로 업데이트 완료`
  }

  // 상태 변경
  await sql`UPDATE product_feedback SET status = 'resolved' WHERE id = ${id}`

  return NextResponse.json({ success: true, message })
}
