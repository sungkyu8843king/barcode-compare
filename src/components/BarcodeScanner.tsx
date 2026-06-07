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
    let reader: import('@zxing/browser').BrowserMultiFormatReader | null = null

    async function start() {
      try {
        const { BrowserMultiFormatReader } = await import('@zxing/browser')
        const { DecodeHintType, BarcodeFormat } = await import('@zxing/library')

        const hints = new Map()
        hints.set(DecodeHintType.POSSIBLE_FORMATS, [
          BarcodeFormat.EAN_13,
          BarcodeFormat.EAN_8,
          BarcodeFormat.UPC_A,
          BarcodeFormat.UPC_E,
          BarcodeFormat.CODE_128,
          BarcodeFormat.CODE_39,
        ])
        hints.set(DecodeHintType.TRY_HARDER, true)

        reader = new BrowserMultiFormatReader(hints, {
          delayBetweenScanAttempts: 100,
        })

        const devices = await BrowserMultiFormatReader.listVideoInputDevices()
        // 후면 카메라 선택 (environment 포함된 것, 없으면 마지막 카메라)
        const back = devices.find(d =>
          d.label.toLowerCase().includes('back') ||
          d.label.toLowerCase().includes('rear') ||
          d.label.toLowerCase().includes('environment') ||
          d.label.toLowerCase().includes('후면')
        ) || devices[devices.length - 1]

        if (!back) {
          setError('카메라를 찾을 수 없습니다.')
          return
        }

        setHint('바코드를 가로로 맞춰주세요')

        await reader.decodeFromVideoDevice(
          back.deviceId,
          videoRef.current!,
          (result, err) => {
            if (!activeRef.current) return
            if (result) {
              const text = result.getText().replace(/\D/g, '')
              if (/^\d{8,14}$/.test(text)) {
                activeRef.current = false
                onScan(text)
              }
            }
          }
        )
      } catch (e) {
        console.error(e)
        setError('카메라 접근 권한을 허용해 주세요.')
      }
    }

    start()

    return () => {
      activeRef.current = false
      if (videoRef.current?.srcObject) {
        const stream = videoRef.current.srcObject as MediaStream
        stream.getTracks().forEach(t => t.stop())
      }
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
        {/* 상/하 어두운 영역 */}
        <div className="absolute inset-x-0 top-0 bg-black/50" style={{ height: '30%' }} />
        <div className="absolute inset-x-0 bottom-0 bg-black/50" style={{ height: '30%' }} />

        {/* 스캔 박스 */}
        <div
          className="absolute left-4 right-4 border-2 border-white/80"
          style={{ top: '30%', height: '40%' }}
        >
          {/* 코너 마커 */}
          <div className="absolute top-0 left-0 w-8 h-8 border-t-4 border-l-4 border-blue-400" />
          <div className="absolute top-0 right-0 w-8 h-8 border-t-4 border-r-4 border-blue-400" />
          <div className="absolute bottom-0 left-0 w-8 h-8 border-b-4 border-l-4 border-blue-400" />
          <div className="absolute bottom-0 right-0 w-8 h-8 border-b-4 border-r-4 border-blue-400" />
          {/* 스캔 라인 */}
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
