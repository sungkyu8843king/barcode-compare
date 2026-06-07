'use client'

import { useEffect, useRef, useState } from 'react'

interface BarcodeScannerProps {
  onScan: (barcode: string) => void
  onClose: () => void
}

export default function BarcodeScanner({ onScan, onClose }: BarcodeScannerProps) {
  const scannerRef = useRef<InstanceType<typeof import('html5-qrcode').Html5Qrcode> | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [started, setStarted] = useState(false)

  useEffect(() => {
    let stopped = false

    async function startScanner() {
      const { Html5Qrcode } = await import('html5-qrcode')
      const scanner = new Html5Qrcode('qr-reader')
      scannerRef.current = scanner

      try {
        await scanner.start(
          { facingMode: 'environment' }, // 후면 카메라
          { fps: 10, qrbox: { width: 280, height: 140 } },
          (decodedText) => {
            if (stopped) return
            // 바코드만 허용 (8~14자리 숫자)
            const cleaned = decodedText.replace(/\D/g, '')
            if (/^\d{8,14}$/.test(cleaned)) {
              stopped = true
              scanner.stop().catch(() => {})
              onScan(cleaned)
            }
          },
          () => {} // 인식 실패는 무시
        )
        setStarted(true)
      } catch (e) {
        setError('카메라 접근 권한이 필요합니다.')
        console.error(e)
      }
    }

    startScanner()

    return () => {
      stopped = true
      scannerRef.current?.stop().catch(() => {})
    }
  }, [onScan])

  return (
    <div className="fixed inset-0 bg-black z-50 flex flex-col">
      {/* 상단 바 */}
      <div className="flex items-center justify-between px-4 py-4 bg-black">
        <h2 className="text-white font-semibold text-lg">바코드 스캔</h2>
        <button
          onClick={onClose}
          className="text-white text-3xl leading-none"
        >
          ×
        </button>
      </div>

      {/* 스캐너 영역 */}
      <div className="flex-1 flex flex-col items-center justify-center relative">
        <div id="qr-reader" className="w-full max-w-md" />

        {/* 스캔 가이드 오버레이 */}
        {started && (
          <div className="absolute inset-0 pointer-events-none flex flex-col items-center justify-center">
            <div className="border-2 border-white rounded-lg w-72 h-36 relative">
              {/* 코너 강조 */}
              <div className="absolute top-0 left-0 w-6 h-6 border-t-4 border-l-4 border-blue-400 rounded-tl" />
              <div className="absolute top-0 right-0 w-6 h-6 border-t-4 border-r-4 border-blue-400 rounded-tr" />
              <div className="absolute bottom-0 left-0 w-6 h-6 border-b-4 border-l-4 border-blue-400 rounded-bl" />
              <div className="absolute bottom-0 right-0 w-6 h-6 border-b-4 border-r-4 border-blue-400 rounded-br" />
              {/* 스캔 라인 애니메이션 */}
              <div className="absolute inset-x-0 h-0.5 bg-blue-400 animate-scan" />
            </div>
            <p className="text-white text-sm mt-6 opacity-80">
              바코드를 박스 안에 맞춰주세요
            </p>
          </div>
        )}

        {error && (
          <p className="text-red-400 text-sm px-8 text-center mt-4">{error}</p>
        )}
      </div>
    </div>
  )
}
