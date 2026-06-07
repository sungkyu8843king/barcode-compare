import { NextRequest, NextResponse } from 'next/server'
import crypto from 'crypto'
import axios from 'axios'

const ACCESS_KEY = process.env.COUPANG_ACCESS_KEY!
const SECRET_KEY = process.env.COUPANG_SECRET_KEY!
const BASE_URL = 'https://api-gateway.coupang.com'

function generateHmac(method: string, path: string, query: string) {
  const timestamp = Date.now().toString()
  const message = `${timestamp}${method}${path}${query ? '?' + query : ''}`
  const signature = crypto.createHmac('sha256', SECRET_KEY).update(message).digest('hex')
  return `CEA algorithm=HmacSHA256, access-key=${ACCESS_KEY}, signed-date=${timestamp}, signature=${signature}`
}

async function rawSearch(keyword: string) {
  if (!ACCESS_KEY || !SECRET_KEY) return { keyword, error: 'NO_KEYS' }
  const path = '/v2/providers/affiliate_open_api/apis/openapi/products/search'
  const params = new URLSearchParams({ keyword, limit: '10' })
  const query = params.toString()
  try {
    const authorization = generateHmac('GET', path, query)
    const res = await axios.get(`${BASE_URL}${path}?${query}`, {
      headers: { Authorization: authorization },
      timeout: 8000,
    })
    const products = res.data?.data?.productData || []
    return {
      keyword,
      count: products.length,
      titles: products.map((p: any) => ({ name: p.productName, price: p.productPrice, isRocket: p.isRocket, deliveryType: p.deliveryType })),
    }
  } catch (e: any) {
    return { keyword, error: e.response?.status || e.message, data: e.response?.data }
  }
}

export async function GET(req: NextRequest) {
  const debugKey = req.nextUrl.searchParams.get('key')
  if (debugKey !== process.env.ADMIN_API_KEY) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  const keysPresent = { access: !!ACCESS_KEY, secret: !!SECRET_KEY }
  const keywords = req.nextUrl.searchParams.get('q')?.split('|') || ['옥수수크림빵', '샤니 옥수수크림빵', '삼립 옥수수크림빵', '초당옥수수크림빵']
  const results = []
  for (const kw of keywords) {
    results.push(await rawSearch(kw))
  }
  return NextResponse.json({ keysPresent, results }, { headers: { 'Cache-Control': 'no-store' } })
}
