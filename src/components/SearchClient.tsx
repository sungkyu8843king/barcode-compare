'use client'

import { useState, lazy, Suspense, useEffect, useRef, useCallback } from 'react'
import Image from 'next/image'
import { BarcodeSearchResult, PLATFORMS } from '@/types'

const BarcodeScanner = lazy(() => import('./BarcodeScanner'))

interface SearchLog {
  barcode: string
  product_name: string
  product_image: string | null
  searched_at: string
  search_count: string
}

interface NewProduct {
  barcode: string
  name: string
  brand: string | null
  image_url: string | null
  created_at: string
}

interface SearchClientProps {
  userEmail?: string
  tier: string
}

export default function SearchClient({ tier }: SearchClientProps) {
  const [barcode, setBarcode] = useState('')
  const [result, setResult] = useState<BarcodeSearchResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [limitExceeded, setLimitExceeded] = useState(false)
  const [scanning, setScanning] = useState(false)

  const [recentSearches, setRecentSearches] = useState<SearchLog[]>([])
  const [newProducts, setNewProducts] = useState<NewProduct[]>([])

  const [showRegistration, setShowRegistration] = useState(false)
  const [registrationImage, setRegistrationImage] = useState<string | null>(null)
  const [registering, setRegistering] = useState(false)
  const [registrationResult, setRegistrationResult] = useState<{ message: string; product: any } | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [showFeedback, setShowFeedback] = useState(false)
  const [feedbackType, setFeedbackType] = useState('wrong_product')
  const [feedbackQuery, setFeedbackQuery] = useState('')
  const [feedbackImage, setFeedbackImage] = useState<string | null>(null)
  const [feedbackSubmitting, setFeedbackSubmitting] = useState(false)
  const [feedbackDone, setFeedbackDone] = useState<string | null>(null)
  const feedbackFileRef = useRef<HTMLInputElement>(null)

  const fetchRecentSearches = useCallback(async () => {
    try {
      const res = await fetch('/api/recent-searches')
      if (res.ok) setRecentSearches(await res.json())
    } catch {}
  }, [])

  const fetchNewProducts = useCallback(async () => {
    try {
      const res = await fetch('/api/new-products')
      if (res.ok) setNewProducts(await res.json())
    } catch {}
  }, [])

  useEffect(() => {
    fetchRecentSearches()
    fetchNewProducts()
  }, [fetchRecentSearches, fetchNewProducts])

  async function handleScanResult(code: string) {
    setScanning(false)
    setBarcode(code)
    await search(code)
  }

  async function handleSearch(e: React.FormEvent) {
    e.preventDefault()
    await search(barcode.trim())
  }

  async function search(code: string) {
    if (!code) return
    setLoading(true)
    setError(null)
    setResult(null)
    setLimitExceeded(false)
    setShowRegistration(false)
    setRegistrationResult(null)
    setRegistrationImage(null)
    setShowFeedback(false)
    setFeedbackDone(null)
    setFeedbackQuery('')
    setFeedbackImage(null)

    try {
      const res = await fetch(`/api/barcode/${code}`)
      const data = await res.json()

      if (res.status === 429) {
        setLimitExceeded(true)
        setError(data.error)
        return
      }

      if (!res.ok) {
        setError(data.error || '검색 중 오류가 발생했습니다.')
        return
      }

      setResult(data)
      // 검색 후 최근검색/신규제품 갱신
      fetchRecentSearches()
      if (!data.product) fetchNewProducts()
    } catch {
      setError('네트워크 오류가 발생했습니다.')
    } finally {
      setLoading(false)
    }
  }

  async function handleImageSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    const compressed = await compressImage(file)
    setRegistrationImage(compressed)
  }

  async function handleRegister() {
    if (!barcode) return
    setRegistering(true)
    try {
      const res = await fetch('/api/product-request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ barcode, imageData: registrationImage }),
      })
      const data = await res.json()
      setRegistrationResult(data)
      if (data.product) {
        // 제품 등록됐으면 바로 검색 결과 갱신
        await search(barcode)
        fetchNewProducts()
      }
    } catch {
      setRegistrationResult({ message: '오류가 발생했습니다.', product: null })
    } finally {
      setRegistering(false)
    }
  }

  async function handleFeedback(retrySearch: boolean) {
    if (!barcode) return
    setFeedbackSubmitting(true)
    try {
      const res = await fetch('/api/product-feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          barcode,
          feedbackType,
          userQuery: retrySearch ? feedbackQuery.trim() : undefined,
          note: null,
          imageData: feedbackImage || undefined,
        }),
      })
      const data = await res.json()
      if (data.retried && data.prices?.length > 0) {
        setResult(prev => prev ? { ...prev, prices: data.prices } : prev)
        setFeedbackDone(data.message)
        setShowFeedback(false)
      } else {
        setFeedbackDone(data.message || '신고가 접수되었습니다. 감사합니다!')
        setShowFeedback(false)
      }
    } catch {
      setFeedbackDone('오류가 발생했습니다.')
    } finally {
      setFeedbackSubmitting(false)
    }
  }

  const hasResult = result !== null
  const showNewProducts = !loading && !hasResult && newProducts.length > 0

  return (
    <>
      {scanning && (
        <Suspense fallback={null}>
          <BarcodeScanner onScan={handleScanResult} onClose={() => setScanning(false)} />
        </Suspense>
      )}

      <div className="max-w-2xl mx-auto px-4 py-4 space-y-4">

        {/* ── 최근 검색 롤링 티커 ── */}
        {recentSearches.length > 0 && (
          <div className="bg-white rounded-2xl shadow-sm overflow-hidden">
            <div className="flex items-center">
              <div className="bg-blue-600 text-white text-xs font-bold px-3 py-3 shrink-0 flex items-center gap-1">
                <span className="inline-block w-1.5 h-1.5 rounded-full bg-white animate-pulse" />
                실시간
              </div>
              <div className="overflow-hidden flex-1">
                <div
                  className="flex animate-ticker"
                  style={{ animationDuration: `${Math.max(20, recentSearches.length * 4)}s` }}
                >
                  {[...recentSearches, ...recentSearches].map((log, idx) => (
                    <button
                      key={idx}
                      onClick={() => { setBarcode(log.barcode); search(log.barcode) }}
                      className="flex items-center gap-2 px-4 py-2.5 hover:bg-blue-50 transition-colors shrink-0 border-r border-gray-100"
                    >
                      {log.product_image ? (
                        <img
                          src={log.product_image}
                          alt=""
                          className="w-8 h-8 rounded object-contain bg-gray-50"
                          onError={e => { (e.target as HTMLImageElement).style.display = 'none' }}
                        />
                      ) : (
                        <div className="w-8 h-8 rounded bg-gray-100 flex items-center justify-center text-gray-400 text-xs">
                          📦
                        </div>
                      )}
                      <div className="text-left">
                        <p className="text-xs font-medium text-gray-800 max-w-[100px] truncate">
                          {log.product_name}
                        </p>
                        <p className="text-[10px] text-blue-500">
                          {Number(log.search_count)}명 검색
                        </p>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ── 검색 폼 ── */}
        <form onSubmit={handleSearch} className="bg-white rounded-2xl shadow-sm p-5">
          <label className="block text-sm font-medium text-gray-700 mb-2">바코드 번호 입력</label>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setScanning(true)}
              className="bg-gray-900 text-white px-4 py-3 rounded-xl hover:bg-gray-700 transition-colors flex items-center gap-1.5 shrink-0"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
              <span className="text-sm font-medium hidden sm:block">스캔</span>
            </button>
            <input
              type="text"
              value={barcode}
              onChange={e => setBarcode(e.target.value.replace(/\D/g, ''))}
              placeholder="8~14자리 숫자"
              className="flex-1 border border-gray-200 rounded-xl px-4 py-3 text-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              maxLength={14}
              inputMode="numeric"
            />
            <button
              type="submit"
              disabled={loading || barcode.length < 8}
              className="bg-blue-600 text-white px-5 py-3 rounded-xl font-medium disabled:opacity-50 hover:bg-blue-700 transition-colors shrink-0"
            >
              {loading ? '...' : '검색'}
            </button>
          </div>
          <p className="mt-2 text-xs text-gray-400">카메라 버튼으로 바코드 스캔하거나 번호를 직접 입력하세요</p>
        </form>

        {/* ── 로딩 상태 ── */}
        {loading && (
          <div className="bg-white rounded-2xl shadow-sm p-8 animate-fade-in-up">
            <div className="flex flex-col items-center gap-4">
              {/* 스피너 링 */}
              <div className="relative w-16 h-16">
                <div className="absolute inset-0 rounded-full border-4 border-blue-100" />
                <div className="absolute inset-0 rounded-full border-4 border-blue-600 border-t-transparent animate-spin" />
                <div className="absolute inset-2 flex items-center justify-center text-xl">🔍</div>
              </div>
              <div className="text-center">
                <p className="font-semibold text-gray-800">가격 비교 중...</p>
                <p className="text-sm text-gray-500 mt-1">바코드 {barcode}</p>
              </div>
              {/* 플랫폼 순차 애니메이션 */}
              <div className="flex items-center gap-3">
                {['네이버쇼핑', '쿠팡', '여러 쇼핑몰'].map((name, i) => (
                  <div
                    key={name}
                    className="text-xs text-gray-500 flex items-center gap-1"
                    style={{ opacity: 0, animation: `fadeInUp 0.4s ease-out ${i * 0.3}s forwards` }}
                  >
                    <span className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse" style={{ animationDelay: `${i * 0.3}s` }} />
                    {name}
                  </div>
                ))}
              </div>
              <div className="w-full bg-gray-100 rounded-full h-1.5 overflow-hidden">
                <div className="h-full bg-blue-500 rounded-full animate-pulse" style={{ width: '70%' }} />
              </div>
            </div>
          </div>
        )}

        {/* ── 에러 / 한도 초과 ── */}
        {error && !loading && (
          <div className={`rounded-xl p-4 text-sm ${limitExceeded ? 'bg-orange-50 border border-orange-200 text-orange-700' : 'bg-red-50 border border-red-200 text-red-700'}`}>
            {error}
            {limitExceeded && tier === 'guest' && (
              <p className="mt-2 font-medium">👆 위 카카오 로그인 버튼을 누르면 하루 200회 무료!</p>
            )}
            {limitExceeded && tier === 'free' && (
              <p className="mt-2 font-medium">💛 기부하시면 하루 1,000회 검색 가능합니다</p>
            )}
          </div>
        )}

        {/* ── 검색 결과 ── */}
        {result && !loading && (
          <div className="space-y-4 animate-fade-in-up">

            {/* 제품 정보 */}
            <div className="bg-white rounded-2xl shadow-sm p-5">
              <div className="flex gap-4">
                {result.product?.image_url && (
                  <div className="relative w-20 h-20 shrink-0">
                    <Image src={result.product.image_url} alt={result.product.name} fill className="object-contain rounded-lg" unoptimized />
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  {result.product ? (
                    <>
                      <h2 className="font-bold text-gray-900 text-lg leading-tight">{result.product.name}</h2>
                      {result.product.brand && <p className="text-sm text-gray-500 mt-1">{result.product.brand}</p>}
                      {result.product.category && (
                        <span className="inline-block mt-2 text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">{result.product.category}</span>
                      )}
                    </>
                  ) : (
                    <div>
                      <p className="text-gray-500 py-2 font-medium">제품 정보를 찾을 수 없습니다</p>
                      <p className="text-xs text-gray-400">새로 출시된 제품이거나 해외 제품일 수 있습니다</p>
                    </div>
                  )}
                  <p className="text-xs text-gray-400 mt-2">바코드: {barcode}</p>
                </div>
              </div>

              {/* 제품 정보 없을 때 등록 신청 */}
              {!result.product && !registrationResult && (
                <div className="mt-4 pt-4 border-t border-gray-100">
                  {!showRegistration ? (
                    <button
                      onClick={() => setShowRegistration(true)}
                      className="w-full py-3 rounded-xl border-2 border-dashed border-blue-300 text-blue-600 font-medium text-sm hover:bg-blue-50 transition-colors flex items-center justify-center gap-2"
                    >
                      <span className="text-lg">📸</span>
                      제품 등록 신청하기
                    </button>
                  ) : (
                    <div className="space-y-3">
                      <p className="text-sm font-medium text-gray-700">제품 사진을 찍어 등록 신청하세요</p>

                      {/* 이미지 업로드 */}
                      <div
                        onClick={() => fileInputRef.current?.click()}
                        className="cursor-pointer"
                      >
                        {registrationImage ? (
                          <div className="relative w-full h-40 rounded-xl overflow-hidden bg-gray-50 border border-gray-200">
                            <img src={registrationImage} alt="제품 사진" className="w-full h-full object-contain" />
                            <div className="absolute bottom-2 right-2 bg-black/50 text-white text-xs px-2 py-1 rounded-full">
                              다시 찍기
                            </div>
                          </div>
                        ) : (
                          <div className="w-full h-32 rounded-xl border-2 border-dashed border-gray-300 flex flex-col items-center justify-center gap-2 hover:bg-gray-50 transition-colors">
                            <span className="text-3xl">📷</span>
                            <p className="text-sm text-gray-500">제품 앞면 사진 촬영</p>
                            <p className="text-xs text-gray-400">탭하여 카메라 열기</p>
                          </div>
                        )}
                      </div>
                      <input
                        ref={fileInputRef}
                        type="file"
                        accept="image/*"
                        capture="environment"
                        className="hidden"
                        onChange={handleImageSelect}
                      />

                      <button
                        onClick={handleRegister}
                        disabled={registering}
                        className="w-full py-3 bg-blue-600 text-white rounded-xl font-medium disabled:opacity-50 hover:bg-blue-700 transition-colors flex items-center justify-center gap-2"
                      >
                        {registering ? (
                          <>
                            <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
                              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                            </svg>
                            자동 검색 중...
                          </>
                        ) : '등록 신청하기'}
                      </button>
                    </div>
                  )}
                </div>
              )}

              {/* 등록 결과 */}
              {registrationResult && !registrationResult.product && (
                <div className="mt-4 pt-4 border-t border-gray-100 bg-green-50 rounded-xl p-3 text-sm text-green-700 flex items-center gap-2">
                  <span>✅</span>
                  {registrationResult.message}
                </div>
              )}
            </div>

            {/* 가격 비교 */}
            {result.prices.length > 0 ? (
              <PriceComparison prices={result.prices} />
            ) : (
              result.product && (
                <div className="bg-white rounded-2xl shadow-sm p-8 text-center text-gray-400">
                  <p className="text-4xl mb-3">🔍</p>
                  <p>온라인 판매 정보를 찾을 수 없습니다</p>
                </div>
              )
            )}

            {/* ── 검색 결과 신고 ── */}
            {feedbackDone ? (
              <div className="bg-green-50 border border-green-200 rounded-xl p-3 text-sm text-green-700 flex items-center gap-2">
                <span>✅</span> {feedbackDone}
              </div>
            ) : !showFeedback ? (
              <button
                onClick={() => setShowFeedback(true)}
                className="w-full py-2.5 text-xs text-gray-400 hover:text-gray-600 border border-dashed border-gray-200 rounded-xl hover:border-gray-300 transition-colors"
              >
                검색 결과가 맞지 않나요? 신고하기
              </button>
            ) : (
              <div className="bg-white rounded-2xl shadow-sm p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-semibold text-gray-800">검색 결과 개선 신고</p>
                  <button onClick={() => setShowFeedback(false)} className="text-gray-400 hover:text-gray-600 text-lg leading-none">×</button>
                </div>

                {/* 신고 유형 선택 */}
                <div className="flex flex-wrap gap-2">
                  {[
                    { value: 'wrong_product', label: '다른 제품' },
                    { value: 'wrong_quantity', label: '수량 오류' },
                    { value: 'wrong_price', label: '가격 오류' },
                    { value: 'other', label: '기타' },
                  ].map(opt => (
                    <button
                      key={opt.value}
                      onClick={() => setFeedbackType(opt.value)}
                      className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${feedbackType === opt.value ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>

                {/* 제품 사진 촬영 */}
                <div>
                  <label className="block text-xs text-gray-500 mb-1">제품 사진 (선택)</label>
                  <div
                    onClick={() => feedbackFileRef.current?.click()}
                    className="cursor-pointer"
                  >
                    {feedbackImage ? (
                      <div className="relative h-28 rounded-xl overflow-hidden bg-gray-50 border border-gray-200">
                        <img src={feedbackImage} alt="신고 사진" className="w-full h-full object-contain" />
                        <div className="absolute bottom-2 right-2 bg-black/50 text-white text-xs px-2 py-0.5 rounded-full">다시 찍기</div>
                      </div>
                    ) : (
                      <div className="h-20 rounded-xl border-2 border-dashed border-gray-200 flex items-center justify-center gap-2 text-gray-400 hover:bg-gray-50 transition-colors">
                        <span className="text-xl">📷</span>
                        <span className="text-xs">올바른 제품 사진 첨부</span>
                      </div>
                    )}
                  </div>
                  <input
                    ref={feedbackFileRef}
                    type="file"
                    accept="image/*"
                    capture="environment"
                    className="hidden"
                    onChange={async e => {
                      const file = e.target.files?.[0]
                      if (file) setFeedbackImage(await compressImage(file))
                    }}
                  />
                </div>

                {/* 올바른 제품명 입력 (재검색용) */}
                <div>
                  <label className="block text-xs text-gray-500 mb-1">올바른 제품명 입력 시 즉시 재검색</label>
                  <input
                    type="text"
                    value={feedbackQuery}
                    onChange={e => setFeedbackQuery(e.target.value)}
                    placeholder="예: 농심 신라면 120g 5개입"
                    className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>

                {/* 버튼 */}
                <div className="flex gap-2">
                  {feedbackQuery.trim() && (
                    <button
                      onClick={() => handleFeedback(true)}
                      disabled={feedbackSubmitting}
                      className="flex-1 py-2.5 bg-blue-600 text-white rounded-xl text-sm font-medium disabled:opacity-50 hover:bg-blue-700 transition-colors flex items-center justify-center gap-1.5"
                    >
                      {feedbackSubmitting ? (
                        <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                        </svg>
                      ) : '🔍'}
                      재검색
                    </button>
                  )}
                  <button
                    onClick={() => handleFeedback(false)}
                    disabled={feedbackSubmitting}
                    className="flex-1 py-2.5 bg-gray-100 text-gray-700 rounded-xl text-sm font-medium disabled:opacity-50 hover:bg-gray-200 transition-colors"
                  >
                    신고만 하기
                  </button>
                </div>
              </div>
            )}

            <p className="text-xs text-center text-gray-400">
              {result.cached ? '캐시된 결과' : '실시간 조회'} · {new Date(result.fetchedAt).toLocaleTimeString('ko-KR')} 기준
            </p>
          </div>
        )}

        {/* ── 신규 등록 제품 ── */}
        {showNewProducts && (
          <div className="animate-fade-in-up">
            <div className="flex items-center justify-between mb-3 px-1">
              <h3 className="font-semibold text-gray-800 flex items-center gap-2">
                <span className="text-base">🆕</span> 신규 등록 제품
              </h3>
              <span className="text-xs text-gray-400">{newProducts.length}개</span>
            </div>
            <div className="grid grid-cols-3 gap-2">
              {newProducts.slice(0, 9).map(product => (
                <button
                  key={product.barcode}
                  onClick={() => { setBarcode(product.barcode); search(product.barcode) }}
                  className="bg-white rounded-xl shadow-sm p-3 text-left hover:shadow-md transition-shadow active:scale-95 transition-transform"
                >
                  <div className="w-full aspect-square rounded-lg bg-gray-50 mb-2 overflow-hidden flex items-center justify-center">
                    {product.image_url ? (
                      <img
                        src={product.image_url}
                        alt={product.name}
                        className="w-full h-full object-contain"
                        onError={e => { (e.target as HTMLImageElement).src = '' }}
                      />
                    ) : (
                      <span className="text-2xl">📦</span>
                    )}
                  </div>
                  <p className="text-xs font-medium text-gray-800 line-clamp-2 leading-tight">{product.name}</p>
                  {product.brand && <p className="text-[10px] text-gray-400 mt-0.5 truncate">{product.brand}</p>}
                </button>
              ))}
            </div>
          </div>
        )}

      </div>
    </>
  )
}

function getPlatformName(platform: string) {
  return PLATFORMS.find(p => p.id === platform)?.name || platform
}

function PlatformBadge({ platform }: { platform: string }) {
  const info = PLATFORMS.find(p => p.id === platform)
  return (
    <span className="text-xs font-bold px-2 py-0.5 rounded-full text-white shrink-0" style={{ backgroundColor: info?.color || '#666' }}>
      {info?.name || platform}
    </span>
  )
}

function ShippingBadge({ fee, isRocket }: { fee?: number | null; isRocket?: boolean }) {
  if (isRocket) return (
    <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-[#E8322B] text-white">🚀 와우 무료</span>
  )
  if (fee === 0) return (
    <span className="text-[10px] font-medium text-green-600 bg-green-50 px-1.5 py-0.5 rounded">무료배송</span>
  )
  if (fee !== null && fee !== undefined && fee > 0) return (
    <span className="text-[10px] text-orange-500 bg-orange-50 px-1.5 py-0.5 rounded">배송 {fee.toLocaleString()}원</span>
  )
  // null = 네이버 배송비 미제공
  return <span className="text-[10px] text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded">배송비 별도</span>
}

function extractQuantity(title: string): number {
  const m = title.match(/(\d+)\s*개/)
  const qty = m ? parseInt(m[1]) : 1
  return qty >= 2 && qty <= 500 ? qty : 1
}

import type { PriceSnapshot } from '@/types'

function PriceSection({
  title,
  color,
  bgColor,
  prices,
  showCoupangNotice,
}: {
  title: string
  color: string
  bgColor: string
  prices: PriceSnapshot[]
  showCoupangNotice?: boolean
}) {
  if (prices.length === 0) return null

  // 총액(상품가 + 알려진 배송비) 기준 정렬
  const sorted = [...prices].sort((a, b) => {
    const aTotal = a.price + (a.shipping_fee ?? 0)
    const bTotal = b.price + (b.shipping_fee ?? 0)
    return aTotal - bTotal
  })

  const cheapest = sorted[0]
  const cheapestTotal = cheapest.price + (cheapest.shipping_fee ?? 0)
  const cheapestHasShipping = cheapest.shipping_fee !== null && cheapest.shipping_fee !== undefined && cheapest.shipping_fee > 0

  return (
    <div className="bg-white rounded-2xl shadow-sm overflow-hidden">
      {/* 섹션 헤더 */}
      <div className={`px-5 py-3 flex items-center justify-between ${bgColor}`}>
        <div className="flex items-center gap-2">
          <span className={`text-sm font-bold ${color}`}>{title}</span>
          <span className="text-xs text-gray-500">{prices.length}개</span>
        </div>
        <div className="text-right">
          <span className="text-xs text-gray-500">최저 </span>
          <span className={`text-sm font-bold ${color}`}>
            {cheapestHasShipping ? cheapestTotal.toLocaleString() : cheapest.price.toLocaleString()}원
          </span>
          {cheapestHasShipping && (
            <span className="text-xs text-gray-400 ml-1">
              ({cheapest.price.toLocaleString()}+배송{cheapest.shipping_fee!.toLocaleString()})
            </span>
          )}
          {cheapest.shipping_fee === 0 && !cheapest.is_rocket && (
            <span className="text-xs text-green-600 ml-1">무료배송</span>
          )}
        </div>
      </div>

      {/* 상품 목록 */}
      <div className="divide-y divide-gray-50">
        {sorted.slice(0, 8).map((price, idx) => {
          const hasShipping = price.shipping_fee !== null && price.shipping_fee !== undefined && price.shipping_fee > 0
          const totalPrice = price.price + (hasShipping ? price.shipping_fee! : 0)
          const titleText = price.product_title || price.seller_name || ''
          const qty = extractQuantity(titleText)
          const perUnit = qty > 1 ? Math.round(totalPrice / qty) : null

          return (
            <a
              key={idx}
              href={price.url}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-3 px-5 py-3.5 hover:bg-gray-50 transition-colors"
            >
              {/* 순위 */}
              <span className={`text-xs font-bold w-5 shrink-0 ${idx === 0 ? color : 'text-gray-300'}`}>
                {idx + 1}
              </span>

              {/* 판매자명 + 실제 판매 제품명 */}
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-gray-800 truncate">{price.seller_name || '판매자 정보 없음'}</p>
                {price.product_title && price.product_title !== price.seller_name && (
                  <p className="text-[11px] text-gray-500 truncate mt-0.5">{price.product_title}</p>
                )}
                <div className="flex items-center gap-1 mt-0.5 flex-wrap">
                  <ShippingBadge fee={price.shipping_fee} isRocket={price.is_rocket} />
                  {perUnit && (
                    <span className="text-[10px] font-medium text-purple-600 bg-purple-50 px-1.5 py-0.5 rounded">
                      {qty}개입 · 개당 {perUnit.toLocaleString()}원
                    </span>
                  )}
                </div>
              </div>

              {/* 가격 */}
              <div className="text-right shrink-0 min-w-[80px]">
                {hasShipping ? (
                  // 배송비 있음 → 총액 표시
                  <>
                    <p className={`font-bold ${idx === 0 ? color : 'text-gray-900'}`}>
                      {totalPrice.toLocaleString()}원
                    </p>
                    <p className="text-[10px] text-gray-400">
                      상품 {price.price.toLocaleString()}+배송 {price.shipping_fee!.toLocaleString()}
                    </p>
                  </>
                ) : price.is_rocket ? (
                  // 쿠팡 로켓 → 와우/일반 두 가지 표시
                  <>
                    <p className={`font-bold ${idx === 0 ? color : 'text-gray-900'}`}>
                      {price.price.toLocaleString()}원
                    </p>
                    <p className="text-[10px] text-[#E8322B] font-medium">와우 무료배송</p>
                    <p className="text-[10px] text-gray-400">일반 ~{(price.price + 3000).toLocaleString()}원</p>
                  </>
                ) : price.shipping_fee === 0 ? (
                  // 무료배송
                  <>
                    <p className={`font-bold ${idx === 0 ? color : 'text-gray-900'}`}>
                      {price.price.toLocaleString()}원
                    </p>
                    <p className="text-[10px] text-green-600 font-medium">무료배송 포함</p>
                  </>
                ) : (
                  // 배송비 미제공 (네이버 등)
                  <>
                    <p className={`font-bold ${idx === 0 ? color : 'text-gray-900'}`}>
                      {price.price.toLocaleString()}원
                    </p>
                    <p className="text-[10px] text-gray-400">+ 배송비 별도</p>
                  </>
                )}
              </div>
            </a>
          )
        })}
      </div>

      {/* 네이버 배송비 안내 */}
      {!showCoupangNotice && prices.some(p => p.shipping_fee === null || p.shipping_fee === undefined) && (
        <div className="flex items-start gap-2 bg-blue-50 border-t border-blue-100 px-5 py-3">
          <span className="text-blue-400 text-xs mt-0.5 shrink-0">ℹ</span>
          <p className="text-[11px] text-blue-600 leading-relaxed">
            네이버쇼핑 배송비는 판매자마다 다릅니다 (보통 2,500~3,000원, 일정 금액 이상 무료).
            <span className="font-medium"> 네이버플러스 회원</span>은 구매 금액의 최대 5% 적립 혜택이 있습니다.
          </p>
        </div>
      )}

      {showCoupangNotice && (
        <div className="flex items-start gap-2 bg-yellow-50 border-t border-yellow-100 px-5 py-3">
          <span className="text-yellow-500 text-xs mt-0.5 shrink-0">⚠</span>
          <p className="text-[11px] text-yellow-700 leading-relaxed">
            쿠팡 링크를 통해 구매하시면 쿠팡 파트너스 활동의 일환으로 일정액의 수수료를 제공받을 수 있습니다.
            <span className="font-medium"> 🚀 로켓배송</span> 상품은 쿠팡 와우 회원 기준 무료배송이며, 일반 회원은 3,000원 또는 19,800원 이상 무료입니다.
          </p>
        </div>
      )}
    </div>
  )
}

type ShippingFilter = 'all' | 'free' | 'paid'

function isFreeShipping(p: PriceSnapshot) {
  return p.is_rocket || p.shipping_fee === 0
}
function isPaidShipping(p: PriceSnapshot) {
  return !p.is_rocket && p.shipping_fee !== null && p.shipping_fee !== undefined && p.shipping_fee > 0
}

function applyShippingFilter(prices: PriceSnapshot[], filter: ShippingFilter) {
  if (filter === 'free') return prices.filter(isFreeShipping)
  if (filter === 'paid') return prices.filter(isPaidShipping)
  return prices
}

function PriceComparison({ prices }: { prices: PriceSnapshot[] }) {
  const [shippingFilter, setShippingFilter] = useState<ShippingFilter>('all')

  const filteredPrices = applyShippingFilter(prices, shippingFilter)
  const naverPrices = filteredPrices.filter(p => p.platform === 'naver')
  const coupangPrices = filteredPrices.filter(p => p.platform === 'coupang')
  const otherPrices = filteredPrices.filter(p => p.platform !== 'naver' && p.platform !== 'coupang')

  // 무료/유료 개수 (버튼 카운트용, 필터 전 전체 기준)
  const freeCount = prices.filter(isFreeShipping).length
  const paidCount = prices.filter(isPaidShipping).length

  // 총액(상품가+배송비) 기준 최저/최고
  const basePrices = filteredPrices.length > 0 ? filteredPrices : prices
  const allSorted = [...basePrices].sort((a, b) => {
    const aTotal = a.price + (a.shipping_fee ?? 0)
    const bTotal = b.price + (b.shipping_fee ?? 0)
    return aTotal - bTotal
  })
  const lowest = allSorted[0]
  const highest = allSorted[allSorted.length - 1]
  const lowestTotal = lowest.price + (lowest.shipping_fee ?? 0)
  const highestTotal = highest.price + (highest.shipping_fee ?? 0)
  const lowestHasShip = lowest.shipping_fee !== null && lowest.shipping_fee !== undefined && lowest.shipping_fee > 0
  const highestHasShip = highest.shipping_fee !== null && highest.shipping_fee !== undefined && highest.shipping_fee > 0

  return (
    <div className="space-y-3">
      {/* 배송비 필터 */}
      <div className="flex gap-2">
        {([
          { value: 'all',  label: '전체',     count: prices.length },
          { value: 'free', label: '무료배송만', count: freeCount },
          { value: 'paid', label: '유료배송만', count: paidCount },
        ] as { value: ShippingFilter; label: string; count: number }[]).map(opt => (
          <button
            key={opt.value}
            onClick={() => setShippingFilter(opt.value)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
              shippingFilter === opt.value
                ? 'bg-blue-600 text-white'
                : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-50'
            }`}
          >
            {opt.value === 'free' && '🚚'}
            {opt.label}
            <span className={`text-[10px] ${shippingFilter === opt.value ? 'text-blue-200' : 'text-gray-400'}`}>
              {opt.count}
            </span>
          </button>
        ))}
      </div>

      {filteredPrices.length === 0 && (
        <div className="bg-white rounded-2xl shadow-sm p-6 text-center text-gray-400 text-sm">
          해당 조건의 상품이 없습니다
        </div>
      )}

      {/* 요약 카드 */}
      {filteredPrices.length > 0 && <div className="grid grid-cols-2 gap-3">
        <div className="bg-green-50 border border-green-200 rounded-2xl p-4">
          <p className="text-xs text-green-600 font-medium mb-1">최저가</p>
          <p className="text-2xl font-bold text-green-700">
            {lowestHasShip ? lowestTotal.toLocaleString() : lowest.price.toLocaleString()}원
          </p>
          {lowestHasShip ? (
            <p className="text-[11px] text-green-600 mt-0.5">
              상품 {lowest.price.toLocaleString()} + 배송 {lowest.shipping_fee!.toLocaleString()}원
            </p>
          ) : lowest.is_rocket ? (
            <p className="text-[11px] text-red-500 font-medium mt-0.5">🚀 와우회원 무료배송</p>
          ) : lowest.shipping_fee === 0 ? (
            <p className="text-[11px] text-green-600 font-medium mt-0.5">무료배송 포함</p>
          ) : (
            <p className="text-[11px] text-gray-400 mt-0.5">+ 배송비 별도</p>
          )}
          <p className="text-xs text-green-600 mt-1">{getPlatformName(lowest.platform)}</p>
        </div>
        <div className="bg-orange-50 border border-orange-200 rounded-2xl p-4">
          <p className="text-xs text-orange-600 font-medium mb-1">최고가</p>
          <p className="text-2xl font-bold text-orange-700">
            {highestHasShip ? highestTotal.toLocaleString() : highest.price.toLocaleString()}원
          </p>
          {highestHasShip ? (
            <p className="text-[11px] text-orange-600 mt-0.5">
              상품 {highest.price.toLocaleString()} + 배송 {highest.shipping_fee!.toLocaleString()}원
            </p>
          ) : highest.is_rocket ? (
            <p className="text-[11px] text-red-500 font-medium mt-0.5">🚀 와우회원 무료배송</p>
          ) : highest.shipping_fee === 0 ? (
            <p className="text-[11px] text-green-600 font-medium mt-0.5">무료배송 포함</p>
          ) : (
            <p className="text-[11px] text-gray-400 mt-0.5">+ 배송비 별도</p>
          )}
          <p className="text-xs text-orange-600 mt-1">{getPlatformName(highest.platform)}</p>
        </div>
      </div>}

      {/* 네이버쇼핑 */}
      <PriceSection
        title="네이버쇼핑"
        color="text-[#03C75A]"
        bgColor="bg-[#f0fdf4]"
        prices={naverPrices}
      />

      {/* 쿠팡 */}
      <PriceSection
        title="쿠팡"
        color="text-[#E8322B]"
        bgColor="bg-[#fff5f5]"
        prices={coupangPrices}
        showCoupangNotice={coupangPrices.length > 0}
      />

      {/* 기타 플랫폼 */}
      {otherPrices.length > 0 && (
        <PriceSection
          title="기타"
          color="text-gray-600"
          bgColor="bg-gray-50"
          prices={otherPrices}
        />
      )}
    </div>
  )
}

function ShippingNotice({ fee, isRocket }: { fee?: number | null; isRocket?: boolean }) {
  if (isRocket) return <p className="text-[10px] text-red-500 font-bold mt-1">🚀 쿠팡 와우 무료배송</p>
  if (fee === 0) return <p className="text-[10px] text-green-600 font-medium mt-1">무료배송</p>
  return null
}

async function compressImage(file: File, maxWidth = 400, quality = 0.65): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new window.Image()
    const url = URL.createObjectURL(file)
    img.onload = () => {
      const scale = Math.min(1, maxWidth / img.width)
      const canvas = document.createElement('canvas')
      canvas.width = Math.round(img.width * scale)
      canvas.height = Math.round(img.height * scale)
      const ctx = canvas.getContext('2d')!
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
      URL.revokeObjectURL(url)
      resolve(canvas.toDataURL('image/jpeg', quality))
    }
    img.onerror = reject
    img.src = url
  })
}
