import { auth } from '@/lib/auth'
import { signIn, signOut } from '@/lib/auth'
import SearchClient from '@/components/SearchClient'
import { DAILY_LIMITS } from '@/lib/rate-limit'
import { getProductCount } from '@/lib/db'

export default async function Home() {
  const session = await auth()
  const user = session?.user as { name?: string; image?: string; email?: string; tier?: string } | undefined
  const tier = user?.tier || 'guest'
  const limit = DAILY_LIMITS[tier as keyof typeof DAILY_LIMITS] ?? DAILY_LIMITS.guest
  const productCount = await getProductCount()

  return (
    <main className="min-h-screen bg-gray-50">
      {/* 헤더 */}
      <header className="bg-white shadow-sm sticky top-0 z-40">
        <div className="max-w-2xl mx-auto px-4 py-3 flex items-center justify-between">
          <a href="/" className="flex items-center gap-2 hover:opacity-80 transition-opacity">
            <span className="text-xl">📦</span>
            <div>
              <h1 className="text-lg font-bold text-gray-900">바코드 가격 비교</h1>
              <p className="text-xs text-gray-400">
                오프라인 vs 온라인 최저가
                <span className="ml-1.5 text-blue-500 font-medium">
                  {productCount.toLocaleString()}개 상품
                </span>
              </p>
            </div>
          </a>

          {/* 로그인/유저 영역 */}
          {user ? (
            <div className="flex items-center gap-2">
              <div className="text-right">
                <p className="text-xs font-medium text-gray-700">{user.name}</p>
                <p className="text-xs text-gray-400">
                  {tier === 'donor' ? '기부회원' : '일반회원'} · 일 {limit}회
                </p>
              </div>
              <form action={async () => { 'use server'; await signOut({ redirectTo: '/' }) }}>
                <button className="text-xs text-gray-400 hover:text-gray-600 px-2 py-1">로그아웃</button>
              </form>
            </div>
          ) : (
            <form action={async () => { 'use server'; await signIn('kakao', { redirectTo: '/' }) }}>
              <button
                type="submit"
                className="flex items-center gap-1.5 bg-[#FEE500] text-[#191919] px-3 py-2 rounded-xl text-sm font-semibold hover:bg-[#F5DC00] transition-colors"
              >
                <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
                  <path fillRule="evenodd" clipRule="evenodd" d="M9 1C4.582 1 1 3.896 1 7.455c0 2.268 1.504 4.26 3.784 5.388l-.964 3.592c-.085.317.271.574.549.39L8.49 14.44a9.77 9.77 0 00.51.028c4.418 0 8-2.896 8-6.455C17 3.896 13.418 1 9 1z" fill="#191919"/>
                </svg>
                카카오 로그인
              </button>
            </form>
          )}
        </div>
      </header>

      {/* 검색 한도 안내 배너 */}
      {!user && (
        <div className="bg-yellow-50 border-b border-yellow-200">
          <p className="max-w-2xl mx-auto px-4 py-2 text-xs text-yellow-700 text-center">
            비회원은 하루 {DAILY_LIMITS.guest}회 무료 · 카카오 로그인 시 {DAILY_LIMITS.free}회 · 기부 시 {DAILY_LIMITS.donor}회
          </p>
        </div>
      )}

      {/* 광고 배너 (상단) */}
      <div className="max-w-2xl mx-auto px-4 pt-4">
        <div className="bg-gray-200 rounded-xl h-16 flex items-center justify-center text-gray-400 text-xs">
          광고 영역 (Google AdSense)
        </div>
      </div>

      {/* 검색 클라이언트 컴포넌트 */}
      <SearchClient userEmail={user?.email} tier={tier} />

      {/* 하단 광고 */}
      <div className="max-w-2xl mx-auto px-4 pb-8">
        <div className="bg-gray-200 rounded-xl h-24 flex items-center justify-center text-gray-400 text-xs">
          광고 영역 (Google AdSense)
        </div>
      </div>
    </main>
  )
}
