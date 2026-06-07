import { NextResponse } from 'next/server'
import { getNewProducts } from '@/lib/db'

export async function GET() {
  const products = await getNewProducts(12)
  return NextResponse.json(products)
}
