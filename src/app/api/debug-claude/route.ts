import { NextRequest, NextResponse } from 'next/server'
import { parseProductName } from '@/lib/claude-ai'

export async function GET(req: NextRequest) {
  if (req.nextUrl.searchParams.get('key') !== process.env.ADMIN_API_KEY) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  const keyPresent = !!process.env.ANTHROPIC_API_KEY
  let result: any = null
  let error: string | null = null
  try {
    result = await parseProductName('농심 신라면 120g x5개 묶음팩 특가!!! 무료배송')
  } catch (e: any) {
    error = e?.message || String(e)
  }
  return NextResponse.json(
    { keyPresent, parsed: result, error },
    { headers: { 'Cache-Control': 'no-store' } },
  )
}
