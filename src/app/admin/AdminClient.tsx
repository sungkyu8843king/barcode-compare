'use client'

import { useState, useEffect, useCallback } from 'react'
import Image from 'next/image'

interface FeedbackRow {
  id: number
  barcode: string
  feedback_type: string
  user_query: string | null
  note: string | null
  image_data: string | null
  status: string
  submitted_at: string
  product_name: string | null
  brand: string | null
  product_image: string | null
}

const FEEDBACK_LABELS: Record<string, string> = {
  wrong_product: '다른 제품',
  wrong_quantity: '수량 오류',
  wrong_price: '가격 오류',
  other: '기타',
}

export default function AdminClient() {
  const [rows, setRows] = useState<FeedbackRow[]>([])
  const [loading, setLoading] = useState(true)
  const [statusFilter, setStatusFilter] = useState('pending')
  const [processing, setProcessing] = useState<number | null>(null)
  const [editNames, setEditNames] = useState<Record<number, string>>({})

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/admin/feedback?status=${statusFilter}`)
      if (res.ok) setRows(await res.json())
    } finally {
      setLoading(false)
    }
  }, [statusFilter])

  useEffect(() => { load() }, [load])

  async function handleAction(id: number, action: 'apply' | 'close') {
    setProcessing(id)
    try {
      const res = await fetch('/api/admin/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, action, newName: editNames[id] }),
      })
      const data = await res.json()
      if (data.success) {
        setRows(prev => prev.filter(r => r.id !== id))
        if (data.message) alert(data.message)
      }
    } finally {
      setProcessing(null)
    }
  }

  return (
    <div className="max-w-4xl mx-auto px-4 py-6 space-y-4">
      {/* 필터 탭 */}
      <div className="flex gap-2">
        {['pending', 'resolved'].map(s => (
          <button
            key={s}
            onClick={() => setStatusFilter(s)}
            className={`px-4 py-2 rounded-xl text-sm font-medium transition-colors ${statusFilter === s ? 'bg-blue-600 text-white' : 'bg-white text-gray-600 border border-gray-200 hover:bg-gray-50'}`}
          >
            {s === 'pending' ? '⏳ 대기 중' : '✅ 처리 완료'}
          </button>
        ))}
        <button onClick={load} className="ml-auto px-3 py-2 rounded-xl text-sm text-gray-500 border border-gray-200 bg-white hover:bg-gray-50">
          새로고침
        </button>
      </div>

      {loading ? (
        <div className="text-center py-12 text-gray-400">불러오는 중...</div>
      ) : rows.length === 0 ? (
        <div className="text-center py-12 bg-white rounded-2xl text-gray-400">신고 내역이 없습니다</div>
      ) : (
        <div className="space-y-3">
          {rows.map(row => (
            <div key={row.id} className="bg-white rounded-2xl shadow-sm p-5 space-y-4">
              {/* 상단: 신고 유형 + 날짜 */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-bold px-2.5 py-1 rounded-full bg-red-100 text-red-700">
                    {FEEDBACK_LABELS[row.feedback_type] || row.feedback_type}
                  </span>
                  <span className="text-xs text-gray-400 font-mono">{row.barcode}</span>
                </div>
                <span className="text-xs text-gray-400">
                  {new Date(row.submitted_at).toLocaleString('ko-KR')}
                </span>
              </div>

              {/* 제품 정보 */}
              <div className="flex gap-4">
                {/* 현재 DB 이미지 */}
                <div className="shrink-0">
                  <p className="text-[10px] text-gray-400 mb-1">현재 DB 이미지</p>
                  <div className="w-20 h-20 bg-gray-100 rounded-xl overflow-hidden flex items-center justify-center">
                    {row.product_image ? (
                      <img src={row.product_image} alt="" className="w-full h-full object-contain" />
                    ) : (
                      <span className="text-2xl">📦</span>
                    )}
                  </div>
                </div>

                {/* 신고 사진 (있을 때) */}
                {row.image_data && (
                  <div className="shrink-0">
                    <p className="text-[10px] text-gray-400 mb-1">신고 사진</p>
                    <div className="w-20 h-20 bg-gray-100 rounded-xl overflow-hidden">
                      <img src={row.image_data} alt="신고 사진" className="w-full h-full object-contain" />
                    </div>
                  </div>
                )}

                {/* 제품 정보 텍스트 */}
                <div className="flex-1 min-w-0">
                  <p className="text-[10px] text-gray-400">현재 DB 제품명</p>
                  <p className="text-sm font-semibold text-gray-800 mt-0.5">{row.product_name || '(등록 안됨)'}</p>
                  {row.brand && <p className="text-xs text-gray-500 mt-0.5">{row.brand}</p>}

                  {row.user_query && (
                    <div className="mt-2">
                      <p className="text-[10px] text-gray-400">사용자 입력 제품명</p>
                      <p className="text-sm text-blue-600 font-medium mt-0.5">"{row.user_query}"</p>
                    </div>
                  )}
                  {row.note && (
                    <p className="text-xs text-gray-500 mt-1 italic">메모: {row.note}</p>
                  )}
                </div>
              </div>

              {/* 처리 영역 (pending만) */}
              {row.status === 'pending' && (
                <div className="border-t border-gray-100 pt-4 space-y-3">
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">적용할 제품명 (비우면 현재 유지)</label>
                    <input
                      type="text"
                      value={editNames[row.id] ?? (row.user_query || '')}
                      onChange={e => setEditNames(prev => ({ ...prev, [row.id]: e.target.value }))}
                      placeholder={row.product_name || '제품명 입력'}
                      className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => handleAction(row.id, 'apply')}
                      disabled={processing === row.id}
                      className="flex-1 py-2.5 bg-blue-600 text-white rounded-xl text-sm font-medium hover:bg-blue-700 disabled:opacity-50 transition-colors"
                    >
                      {processing === row.id ? '처리 중...' : '✅ 제품명 적용 + 이미지 갱신'}
                    </button>
                    <button
                      onClick={() => handleAction(row.id, 'close')}
                      disabled={processing === row.id}
                      className="px-4 py-2.5 bg-gray-100 text-gray-600 rounded-xl text-sm hover:bg-gray-200 disabled:opacity-50 transition-colors"
                    >
                      닫기
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
