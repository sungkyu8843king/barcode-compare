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
      const { Html5Qrcode, Html5QrcodeSupportedFormats } = await import('html5-qrcode')

      const scanner = new Html5Qrcode('qr-reader', {
        verbose: false,
        formatsToSupport: [
          Html5QrcodeSupportedFormats.EAN_13,
          Html5QrcodeSupportedFormats.EAN_8,
          Html5QrcodeSupportedFormats.UPC_A,
          Html5QrcodeSupportedFormats.UPC_E,
          Html5QrcodeSupportedFormats.CODE_128,
          Html5QrcodeSupportedFormats.CODE_39,
        ],
      })
      scannerRef.current = scanner

      try {
        await scanner.start(
          { facingMode: 'environment' },
          {
            fps: 15,
            // 화면 전체 폭의 80% 사용 (바코드가 가로로 길어서 넓게)
            qrbox: (viewfinderWidth: number, viewfinderHeight: number) => ({
              width: Math.floor(viewfinderWidth * 0.85),
              height: Math.floor(viewfinderHeight * 0.25),
            }),
            aspectRatio: 1.7,
          },
          (decodedText) => {
            if (stopped) return
            const cleaned = decodedText.replace(/\D/g, '')
            if (/^\d{8,14}$/.test(cleaned)) {
              stopped = true
              scanner.stop().catch(() => {})
              onScan(cleaned)
            }
          },
          () => {}
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
      <div className="flex items-center justify-between px-4 py-4 bg-black">
        <h2 className="text-white font-semibold text-lg">바코드 스캔</h2>
        <button onClick={onClose} className="text-white text-3xl leading-none">×</button>
      </div>

      <div className="flex-1 relative overflow-hidden">
        <div id="qr-reader" className="w-full h-full" />

        {started && (
          <div className="absolute inset-0 pointer-events-none">
            {/* 어두운 상단 */}
            <div className="absolute top-0 left-0 right-0 bg-black/50" style={{ height: '37%' }} />
            {/* 어두운 하단 */}
            <div className="absolute bottom-0 left-0 right-0 bg-black/50" style={{ height: '37%' }} />
            {/* 스캔 영역 가이드 */}
            <div className="absolute left-[7.5%] right-[7.5%] border-2 border-white" style={{ top: '37%', height: '26%' }}>
              <div className="absolute top-0 left-0 w-8 h-8 border-t-4 border-l-4 border-blue-400" />
              <div className="absolute top-0 right-0 w-8 h-8 border-t-4 border-r-4 border-blue-400" />
              <div className="absolute bottom-0 left-0 w-8 h-8 border-b-4 border-l-4 border-blue-400" />
              <div className="absolute bottom-0 right-0 w-8 h-8 border-b-4 border-r-4 border-blue-400" />
              <div className="absolute inset-x-0 h-0.5 bg-blue-400 opacity-80 animate-scan" />
            </div>
            <p className="absolute bottom-[30%] left-0 right-0 text-center text-white text-sm opacity-80">
              바코드를 가로로 맞춰주세요
            </p>
          </div>
        )}

        {error && (
          <div className="absolute inset-0 flex items-center justify-center">
            <p className="text-red-400 text-sm px-8 text-center bg-black/80 py-4 rounded-xl">{error}</p>
          </div>
        )}
      </div>
    </div>
  )
}
