'use client'

import { useState } from 'react'
import Image from 'next/image'
import { BarcodeSearchResult, PLATFORMS } from '@/types'

export default function Home() {
  const [barcode, setBarcode] = useState('')
  const [result, setResult] = useState<BarcodeSearchResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSearch(e: React.FormEvent) {
    e.preventDefault()
    const code = barcode.trim()
    if (!code) return

    setLoading(true)
    setError(null)
    setResult(null)

    try {
      const res = await fetch(`/api/barcode/${code}`)
      const data = await res.json()

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
    <main className="min-h-screen bg-gray-50">
      <header className="bg-white shadow-sm">
        <div className="max-w-2xl mx-auto px-4 py-4 flex items-center gap-3">
          <span className="text-2xl">📦</span>
          <div>
            <h1 className="text-xl font-bold text-gray-900">바코드 가격 비교</h1>
            <p className="text-xs text-gray-500">오프라인 vs 온라인 최저가 비교</p>
          </div>
        </div>
      </header>

      <div className="max-w-2xl mx-auto px-4 py-8 space-y-6">
        <form onSubmit={handleSearch} className="bg-white rounded-2xl shadow-sm p-6">
          <label className="block text-sm font-medium text-gray-700 mb-2">
            바코드 번호 입력
          </label>
          <div className="flex gap-2">
            <input
              type="text"
              value={barcode}
              onChange={e => setBarcode(e.target.value.replace(/\D/g, ''))}
              placeholder="8~14자리 숫자 (예: 8801234567890)"
              className="flex-1 border border-gray-200 rounded-xl px-4 py-3 text-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              maxLength={14}
              inputMode="numeric"
            />
            <button
              type="submit"
              disabled={loading || barcode.length < 8}
              className="bg-blue-600 text-white px-6 py-3 rounded-xl font-medium disabled:opacity-50 hover:bg-blue-700 transition-colors"
            >
              {loading ? '검색 중...' : '검색'}
            </button>
          </div>
          <p className="mt-2 text-xs text-gray-400">
            * 모바일 앱에서는 카메라로 바코드를 스캔할 수 있습니다
          </p>
        </form>

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 rounded-xl p-4 text-sm">
            {error}
          </div>
        )}

        {result && (
          <div className="space-y-4">
            <div className="bg-white rounded-2xl shadow-sm p-5">
              <div className="flex gap-4">
                {result.product?.image_url && (
                  <div className="relative w-20 h-20 flex-shrink-0">
                    <Image
                      src={result.product.image_url}
                      alt={result.product.name}
                      fill
                      className="object-contain rounded-lg"
                      unoptimized
                    />
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  {result.product ? (
                    <>
                      <h2 className="font-bold text-gray-900 text-lg leading-tight">
                        {result.product.name}
                      </h2>
                      {result.product.brand && (
                        <p className="text-sm text-gray-500 mt-1">{result.product.brand}</p>
                      )}
                      {result.product.category && (
                        <span className="inline-block mt-2 text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">
                          {result.product.category}
                        </span>
                      )}
                    </>
                  ) : (
                    <p className="text-gray-500 py-4">제품 정보를 찾을 수 없습니다</p>
                  )}
                  <p className="text-xs text-gray-400 mt-2">바코드: {barcode}</p>
                </div>
              </div>
            </div>

            {result.prices.length > 0 && (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <div className="bg-green-50 border border-green-200 rounded-2xl p-4">
                    <p className="text-xs text-green-600 font-medium mb-1">온라인 최저가</p>
                    <p className="text-2xl font-bold text-green-700">
                      {result.lowestPrice!.price.toLocaleString()}원
                    </p>
                    <p className="text-xs text-green-600 mt-1 truncate">
                      {getPlatformName(result.lowestPrice!.platform)} · {result.lowestPrice!.seller_name}
                    </p>
                  </div>
                  <div className="bg-orange-50 border border-orange-200 rounded-2xl p-4">
                    <p className="text-xs text-orange-600 font-medium mb-1">온라인 최고가</p>
                    <p className="text-2xl font-bold text-orange-700">
                      {result.highestPrice!.price.toLocaleString()}원
                    </p>
                    <p className="text-xs text-orange-600 mt-1 truncate">
                      {getPlatformName(result.highestPrice!.platform)} · {result.highestPrice!.seller_name}
                    </p>
                  </div>
                </div>

                <div className="bg-white rounded-2xl shadow-sm overflow-hidden">
                  <div className="px-5 py-4 border-b border-gray-100">
                    <h3 className="font-semibold text-gray-900">
                      온라인 판매처 ({result.prices.length}개)
                    </h3>
                  </div>
                  <div className="divide-y divide-gray-50">
                    {result.prices
                      .sort((a, b) => a.price - b.price)
                      .slice(0, 10)
                      .map((price, idx) => (
                        <a
                          key={idx}
                          href={price.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center justify-between px-5 py-4 hover:bg-gray-50 transition-colors"
                        >
                          <div className="flex items-center gap-3">
                            <PlatformBadge platform={price.platform} />
                            <span className="text-sm text-gray-600 truncate max-w-[150px]">
                              {price.seller_name || '판매자 정보 없음'}
                            </span>
                          </div>
                          <div className="text-right flex-shrink-0">
                            <p className="font-bold text-gray-900">
                              {price.price.toLocaleString()}원
                            </p>
                            {idx === 0 && (
                              <span className="text-xs text-green-600 font-medium">최저가</span>
                            )}
                          </div>
                        </a>
                      ))}
                  </div>
                </div>
              </>
            )}

            {result.prices.length === 0 && (
              <div className="bg-white rounded-2xl shadow-sm p-8 text-center text-gray-400">
                <p className="text-4xl mb-3">🔍</p>
                <p>온라인 판매 정보를 찾을 수 없습니다</p>
                <p className="text-sm mt-1">제품명으로 직접 검색해 보세요</p>
              </div>
            )}

            <p className="text-xs text-center text-gray-400">
              {result.cached ? '캐시된 결과' : '실시간 조회'} ·{' '}
              {new Date(result.fetchedAt).toLocaleTimeString('ko-KR')} 기준
            </p>
          </div>
        )}
      </div>
    </main>
  )
}

function getPlatformName(platform: string) {
  return PLATFORMS.find(p => p.id === platform)?.name || platform
}

function PlatformBadge({ platform }: { platform: string }) {
  const info = PLATFORMS.find(p => p.id === platform)
  return (
    <span
      className="text-xs font-bold px-2 py-0.5 rounded-full text-white"
      style={{ backgroundColor: info?.color || '#666' }}
    >
      {info?.name || platform}
    </span>
  )
}
