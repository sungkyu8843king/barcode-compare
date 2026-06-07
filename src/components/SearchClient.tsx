'use client'

import { useState, lazy, Suspense } from 'react'
import Image from 'next/image'
import { BarcodeSearchResult, PLATFORMS } from '@/types'

const BarcodeScanner = lazy(() => import('./BarcodeScanner'))

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
    } catch {
      setError('네트워크 오류가 발생했습니다.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <>
      {scanning && (
        <Suspense fallback={null}>
          <BarcodeScanner onScan={handleScanResult} onClose={() => setScanning(false)} />
        </Suspense>
      )}

      <div className="max-w-2xl mx-auto px-4 py-4 space-y-4">
        {/* 검색 폼 */}
        <form onSubmit={handleSearch} className="bg-white rounded-2xl shadow-sm p-5">
          <label className="block text-sm font-medium text-gray-700 mb-2">바코드 번호 입력</label>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setScanning(true)}
              className="bg-gray-900 text-white px-4 py-3 rounded-xl hover:bg-gray-700 transition-colors flex items-center gap-1.5 flex-shrink-0"
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
              className="bg-blue-600 text-white px-5 py-3 rounded-xl font-medium disabled:opacity-50 hover:bg-blue-700 transition-colors flex-shrink-0"
            >
              {loading ? '...' : '검색'}
            </button>
          </div>
          <p className="mt-2 text-xs text-gray-400">카메라 버튼으로 바코드 스캔하거나 번호를 직접 입력하세요</p>
        </form>

        {/* 에러 / 한도 초과 */}
        {error && (
          <div className={`rounded-xl p-4 text-sm ${limitExceeded ? 'bg-orange-50 border border-orange-200 text-orange-700' : 'bg-red-50 border border-red-200 text-red-700'}`}>
            {error}
            {limitExceeded && tier === 'guest' && (
              <p className="mt-2 font-medium">
                👆 위 카카오 로그인 버튼을 누르면 하루 10회 무료!
              </p>
            )}
            {limitExceeded && tier === 'free' && (
              <p className="mt-2 font-medium">
                💛 기부하시면 하루 100회 검색 가능합니다
              </p>
            )}
          </div>
        )}

        {/* 결과 */}
        {result && (
          <div className="space-y-4">
            {/* 제품 정보 */}
            <div className="bg-white rounded-2xl shadow-sm p-5">
              <div className="flex gap-4">
                {result.product?.image_url && (
                  <div className="relative w-20 h-20 flex-shrink-0">
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
                    <p className="text-gray-500 py-4">제품 정보를 찾을 수 없습니다</p>
                  )}
                  <p className="text-xs text-gray-400 mt-2">바코드: {barcode}</p>
                </div>
              </div>
            </div>

            {/* 가격 비교 */}
            {result.prices.length > 0 ? (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <div className="bg-green-50 border border-green-200 rounded-2xl p-4">
                    <p className="text-xs text-green-600 font-medium mb-1">온라인 최저가</p>
                    <p className="text-2xl font-bold text-green-700">{result.lowestPrice!.price.toLocaleString()}원</p>
                    <p className="text-xs text-green-600 mt-1 truncate">{getPlatformName(result.lowestPrice!.platform)}</p>
                  </div>
                  <div className="bg-orange-50 border border-orange-200 rounded-2xl p-4">
                    <p className="text-xs text-orange-600 font-medium mb-1">온라인 최고가</p>
                    <p className="text-2xl font-bold text-orange-700">{result.highestPrice!.price.toLocaleString()}원</p>
                    <p className="text-xs text-orange-600 mt-1 truncate">{getPlatformName(result.highestPrice!.platform)}</p>
                  </div>
                </div>

                <div className="bg-white rounded-2xl shadow-sm overflow-hidden">
                  <div className="px-5 py-4 border-b border-gray-100">
                    <h3 className="font-semibold text-gray-900">온라인 판매처 ({result.prices.length}개)</h3>
                  </div>
                  <div className="divide-y divide-gray-50">
                    {[...result.prices].sort((a, b) => a.price - b.price).slice(0, 10).map((price, idx) => (
                      <a key={idx} href={price.url} target="_blank" rel="noopener noreferrer"
                        className="flex items-center justify-between px-5 py-4 hover:bg-gray-50 transition-colors">
                        <div className="flex items-center gap-3">
                          <PlatformBadge platform={price.platform} />
                          <span className="text-sm text-gray-600 truncate max-w-[150px]">{price.seller_name || '판매자 정보 없음'}</span>
                        </div>
                        <div className="text-right flex-shrink-0">
                          <p className="font-bold text-gray-900">{price.price.toLocaleString()}원</p>
                          {idx === 0 && <span className="text-xs text-green-600 font-medium">최저가</span>}
                        </div>
                      </a>
                    ))}
                  </div>
                </div>

                {/* 쿠팡 파트너스 고지 */}
                {result.prices.some(p => p.platform === 'coupang') && (
                  <div className="flex items-start gap-2 bg-yellow-50 border border-yellow-200 rounded-xl px-4 py-3">
                    <span className="text-yellow-500 text-sm mt-0.5">⚠</span>
                    <p className="text-xs text-yellow-700 leading-relaxed">
                      이 페이지의 쿠팡 링크를 통해 구매하시면 쿠팡 파트너스 활동의 일환으로 일정액의 수수료를 제공받을 수 있습니다.
                    </p>
                  </div>
                )}
              </>
            ) : (
              <div className="bg-white rounded-2xl shadow-sm p-8 text-center text-gray-400">
                <p className="text-4xl mb-3">🔍</p>
                <p>온라인 판매 정보를 찾을 수 없습니다</p>
              </div>
            )}

            <p className="text-xs text-center text-gray-400">
              {result.cached ? '캐시된 결과' : '실시간 조회'} · {new Date(result.fetchedAt).toLocaleTimeString('ko-KR')} 기준
            </p>
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
    <span className="text-xs font-bold px-2 py-0.5 rounded-full text-white" style={{ backgroundColor: info?.color || '#666' }}>
      {info?.name || platform}
    </span>
  )
}
