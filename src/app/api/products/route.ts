import { NextRequest, NextResponse } from 'next/server'
import { upsertProduct, searchProducts } from '@/lib/db'
import { invalidateBarcode } from '@/lib/redis'
import { z } from 'zod'

const ProductSchema = z.object({
  barcode: z.string().regex(/^\d{8,14}$/, '바코드는 8~14자리 숫자'),
  name: z.string().min(1).max(300),
  brand: z.string().max(100).nullable().optional(),
  category: z.string().max(100).nullable().optional(),
  image_url: z.string().url().nullable().optional(),
})

export async function POST(req: NextRequest) {
  const apiKey = req.headers.get('x-api-key')
  if (apiKey !== process.env.ADMIN_API_KEY) {
    return NextResponse.json({ error: '인증 실패' }, { status: 401 })
  }

  const body = await req.json()
  const parsed = ProductSchema.safeParse(body)

  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })
  }

  const product = await upsertProduct(parsed.data)
  await invalidateBarcode(parsed.data.barcode)

  return NextResponse.json(product)
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const q = searchParams.get('q') || ''
  const page = parseInt(searchParams.get('page') || '1')
  const limit = Math.min(parseInt(searchParams.get('limit') || '20'), 100)
  const offset = (page - 1) * limit

  const rows = await searchProducts(q, limit, offset)
  const total = rows.length > 0 ? Number((rows[0] as { total_count: string }).total_count) : 0

  return NextResponse.json({
    data: rows,
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit),
  })
}
