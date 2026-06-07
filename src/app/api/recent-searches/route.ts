import { NextResponse } from 'next/server'
import { getRecentSearchLogs } from '@/lib/db'

export async function GET() {
  const logs = await getRecentSearchLogs(30)
  // 최근 검색순 정렬 후 반환
  const sorted = [...logs].sort(
    (a: any, b: any) => new Date(b.searched_at).getTime() - new Date(a.searched_at).getTime()
  )
  return NextResponse.json(sorted)
}
