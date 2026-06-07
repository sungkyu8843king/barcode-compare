import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'

export async function GET(req: NextRequest) {
  if (req.nextUrl.searchParams.get('key') !== process.env.ADMIN_API_KEY) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  const key = process.env.ANTHROPIC_API_KEY || ''
  const out: any = {
    keyPresent: !!key,
    keyPrefix: key ? key.slice(0, 7) : null,
    keyLen: key.length,
  }
  try {
    const client = new Anthropic({ apiKey: key })
    const msg = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 50,
      messages: [{ role: 'user', content: '한국어로 "테스트 성공"이라고만 답하세요.' }],
    })
    out.ok = true
    out.text = (msg.content[0] as any)?.text ?? null
  } catch (e: any) {
    out.ok = false
    out.errorName = e?.name || null
    out.errorStatus = e?.status || null
    out.errorMessage = e?.message || String(e)
  }
  return NextResponse.json(out, { headers: { 'Cache-Control': 'no-store' } })
}
