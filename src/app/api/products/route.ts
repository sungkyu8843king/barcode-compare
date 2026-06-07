import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { invalidateBarcode } from '@/lib/redis'
import { z } from 'zod'

const ProductSchema = z.object({
  barcode: z.string().regex(/^\d{8,14}$/, '바코드는 8~14자리 숫자'),
  name: z.string().min(1).max(300),
  brand: z.string().max(100).nullable().optional(),
  category: z.string().max(100).nullable().optional(),
  image_url: z.string().url().nullable().optional(),
})

// 제품 등록/수정
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

  const { data, error } = await supabaseAdmin
    .from('products')
    .upsert(parsed.data)
    .select()
    .single()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  await invalidateBarcode(parsed.data.barcode)
  return NextResponse.json(data)
}

// 제품 목록 조회 (검색)
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const q = searchParams.get('q')
  const page = parseInt(searchParams.get('page') || '1')
  const limit = Math.min(parseInt(searchParams.get('limit') || '20'), 100)
  const offset = (page - 1) * limit

  let query = supabaseAdmin
    .from('products')
    .select('*', { count: 'exact' })
    .range(offset, offset + limit - 1)
    .order('created_at', { ascending: false })

  if (q) {
    query = query.ilike('name', `%${q}%`)
  }

  const { data, error, count } = await query

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({
    data,
    total: count,
    page,
    limit,
    totalPages: Math.ceil((count || 0) / limit),
  })
}
