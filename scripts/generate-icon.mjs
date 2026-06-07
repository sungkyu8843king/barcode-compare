import sharp from 'sharp'

const SIZE = 512

// SVG 아이콘: 바코드 + 가격비교 테마
const svg = `
<svg width="${SIZE}" height="${SIZE}" viewBox="0 0 ${SIZE} ${SIZE}" xmlns="http://www.w3.org/2000/svg">
  <!-- 배경 (둥근 사각형) -->
  <rect width="${SIZE}" height="${SIZE}" rx="100" fill="#1a1a2e"/>

  <!-- 바코드 바 (중앙) -->
  <g transform="translate(80, 160)">
    <!-- 바코드 바들 -->
    <rect x="0"   y="0" width="18" height="140" fill="white"/>
    <rect x="26"  y="0" width="8"  height="140" fill="white"/>
    <rect x="42"  y="0" width="22" height="140" fill="white"/>
    <rect x="72"  y="0" width="10" height="140" fill="white"/>
    <rect x="90"  y="0" width="18" height="140" fill="white"/>
    <rect x="116" y="0" width="6"  height="140" fill="white"/>
    <rect x="130" y="0" width="24" height="140" fill="white"/>
    <rect x="162" y="0" width="12" height="140" fill="white"/>
    <rect x="182" y="0" width="8"  height="140" fill="white"/>
    <rect x="198" y="0" width="20" height="140" fill="white"/>
    <rect x="226" y="0" width="14" height="140" fill="white"/>
    <rect x="248" y="0" width="8"  height="140" fill="white"/>
    <rect x="264" y="0" width="18" height="140" fill="white"/>
    <rect x="290" y="0" width="22" height="140" fill="white"/>
    <rect x="320" y="0" width="8"  height="140" fill="white"/>
    <rect x="336" y="0" width="16" height="140" fill="white"/>
    <!-- 바코드 숫자 -->
    <text x="175" y="175" text-anchor="middle" fill="white" font-size="28" font-family="monospace" letter-spacing="4">8 8010 43015</text>
  </g>

  <!-- 가격 비교 화살표 아이콘 -->
  <g transform="translate(176, 330)">
    <!-- 오프라인 가격 (빨간 X) -->
    <rect x="0" y="8" width="60" height="32" rx="8" fill="#e74c3c" opacity="0.9"/>
    <text x="30" y="30" text-anchor="middle" fill="white" font-size="22" font-family="Arial" font-weight="bold">₩</text>

    <!-- 화살표 -->
    <text x="80" y="34" text-anchor="middle" fill="#f39c12" font-size="28" font-family="Arial">→</text>

    <!-- 온라인 가격 (초록 체크) -->
    <rect x="100" y="8" width="60" height="32" rx="8" fill="#27ae60" opacity="0.9"/>
    <text x="130" y="30" text-anchor="middle" fill="white" font-size="22" font-family="Arial" font-weight="bold">↓</text>
  </g>

  <!-- 하단 텍스트 -->
  <text x="${SIZE/2}" y="448" text-anchor="middle" fill="#a0aec0" font-size="28" font-family="Arial" font-weight="bold" letter-spacing="1">바코드 가격비교</text>
</svg>
`

await sharp(Buffer.from(svg))
  .resize(512, 512)
  .png()
  .toFile('public/app-icon-512.png')

await sharp(Buffer.from(svg))
  .resize(192, 192)
  .png()
  .toFile('public/app-icon-192.png')

await sharp(Buffer.from(svg))
  .resize(180, 180)
  .png()
  .toFile('public/apple-touch-icon.png')

console.log('✅ 아이콘 생성 완료!')
console.log('  - public/app-icon-512.png (카카오 앱 아이콘용)')
console.log('  - public/app-icon-192.png')
console.log('  - public/apple-touch-icon.png (iOS 홈화면 추가용)')
