'use client'

import { useEffect, useRef, useState } from 'react'

interface BarcodeScannerProps {
  onScan: (barcode: string) => void
  onClose: () => void
}

export default function BarcodeScanner({ onScan, onClose }: BarcodeScannerProps) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [error, setError] = useState<string | null>(null)
  const [hint, setHint] = useState('카메라 시작 중...')
  const activeRef = useRef(true)

  useEffect(() => {
    activeRef.current = true
    let stream: MediaStream | null = null
    let animId: number | null = null
    let zxingTimer: ReturnType<typeof setTimeout> | null = null

    async function start() {
      try {
        // 고해상도 + 자동초점 요청
        stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: 'environment' },
            width:  { ideal: 1920 },
            height: { ideal: 1080 },
          },
        })

        const video = videoRef.current
        if (!video || !activeRef.current) return
        video.srcObject = stream
        await video.play()

        // 카메라가 안정되길 잠깐 기다림
        await new Promise(r => setTimeout(r, 800))
        if (!activeRef.current) return

        setHint('바코드를 가로로 맞춰주세요')

        if ('BarcodeDetector' in window) {
          runNativeDetector()
        } else {
          runZxing()
        }
      } catch {
        setError('카메라 접근 권한을 허용해 주세요.')
      }
    }

    // ── Android Chrome: 네이티브 BarcodeDetector (하드웨어 가속) ──
    function runNativeDetector() {
      const detector = new (window as any).BarcodeDetector({
        formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39'],
      })

      async function detect() {
        if (!activeRef.current || !videoRef.current) return
        const video = videoRef.current
        if (video.readyState < 2) {
          animId = requestAnimationFrame(detect)
          return
        }

        try {
          const results: any[] = await detector.detect(video)
          for (const r of results) {
            const text = r.rawValue.replace(/\D/g, '')
            if (/^\d{8,14}$/.test(text)) {
              activeRef.current = false
              onScan(text)
              return
            }
          }
        } catch { /* 인식 안 됨 */ }

        if (activeRef.current) animId = requestAnimationFrame(detect)
      }

      detect()
    }

    // ── iOS Safari 등: @zxing/browser 폴백 (스캔 영역만 크롭) ──
    async function runZxing() {
      const { BrowserMultiFormatReader } = await import('@zxing/browser')
      const { DecodeHintType, BarcodeFormat } = await import('@zxing/library')

      const hints = new Map()
      hints.set(DecodeHintType.POSSIBLE_FORMATS, [
        BarcodeFormat.EAN_13,
        BarcodeFormat.EAN_8,
        BarcodeFormat.UPC_A,
        BarcodeFormat.UPC_E,
      ])
      hints.set(DecodeHintType.TRY_HARDER, true)

      const reader = new BrowserMultiFormatReader(hints)
      const canvas = document.createElement('canvas')
      const ctx = canvas.getContext('2d')!

      function decodeFrame() {
        if (!activeRef.current || !videoRef.current) return
        const video = videoRef.current
        if (video.readyState < 2) {
          zxingTimer = setTimeout(decodeFrame, 100)
          return
        }

        // 화면 중앙 40% 영역만 크롭해서 디코딩 (노이즈 감소)
        const vw = video.videoWidth
        const vh = video.videoHeight
        const cropH = Math.round(vh * 0.4)
        const cropY = Math.round(vh * 0.3)

        canvas.width = vw
        canvas.height = cropH
        ctx.drawImage(video, 0, cropY, vw, cropH, 0, 0, vw, cropH)

        try {
          const result = (reader as any).decodeFromCanvas(canvas)
          const text = result.getText().replace(/\D/g, '')
          if (/^\d{8,14}$/.test(text)) {
            activeRef.current = false
            onScan(text)
            return
          }
        } catch { /* NotFoundException → 계속 */ }

        zxingTimer = setTimeout(decodeFrame, 60)
      }

      decodeFrame()
    }

    start()

    return () => {
      activeRef.current = false
      if (animId !== null) cancelAnimationFrame(animId)
      if (zxingTimer !== null) clearTimeout(zxingTimer)
      stream?.getTracks().forEach(t => t.stop())
    }
  }, [onScan])

  return (
    <div className="fixed inset-0 bg-black z-50 flex flex-col">
      {/* 헤더 */}
      <div className="flex items-center justify-between px-4 py-4 bg-black/80 absolute top-0 left-0 right-0 z-10">
        <h2 className="text-white font-semibold text-lg">바코드 스캔</h2>
        <button onClick={onClose} className="text-white text-4xl leading-none w-10 h-10 flex items-center justify-center">
          ×
        </button>
      </div>

      {/* 카메라 영상 */}
      <video
        ref={videoRef}
        className="w-full h-full object-cover"
        autoPlay
        muted
        playsInline
      />

      {/* 오버레이 */}
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute inset-x-0 top-0 bg-black/50" style={{ height: '30%' }} />
        <div className="absolute inset-x-0 bottom-0 bg-black/50" style={{ height: '30%' }} />

        {/* 스캔 박스 */}
        <div className="absolute left-4 right-4 border-2 border-white/80" style={{ top: '30%', height: '40%' }}>
          <div className="absolute top-0 left-0 w-8 h-8 border-t-4 border-l-4 border-blue-400" />
          <div className="absolute top-0 right-0 w-8 h-8 border-t-4 border-r-4 border-blue-400" />
          <div className="absolute bottom-0 left-0 w-8 h-8 border-b-4 border-l-4 border-blue-400" />
          <div className="absolute bottom-0 right-0 w-8 h-8 border-b-4 border-r-4 border-blue-400" />
          <div className="absolute inset-x-0 h-0.5 bg-blue-400 animate-scan" />
        </div>

        {/* 안내 텍스트 */}
        <div className="absolute left-0 right-0 text-center" style={{ top: '73%' }}>
          <p className="text-white text-sm drop-shadow">{hint}</p>
        </div>
      </div>

      {/* 에러 */}
      {error && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/70">
          <div className="bg-white rounded-2xl p-6 mx-8 text-center">
            <p className="text-red-600 font-medium">{error}</p>
            <button onClick={onClose} className="mt-4 bg-gray-900 text-white px-6 py-2 rounded-xl text-sm">닫기</button>
          </div>
        </div>
      )}
    </div>
  )
}
