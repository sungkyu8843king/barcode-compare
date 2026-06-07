export interface Product {
  barcode: string
  name: string
  brand: string | null
  category: string | null
  image_url: string | null
  created_at: string
  updated_at: string
}

export interface PriceSnapshot {
  id: number
  barcode: string
  platform: Platform
  price: number
  original_price: number | null
  discount_rate: number | null
  url: string
  seller_name: string | null
  in_stock: boolean
  fetched_at: string
}

export type Platform = 'naver' | 'coupang' | '11st' | 'gmarket' | 'auction'

export interface PlatformInfo {
  id: Platform
  name: string
  color: string
}

export const PLATFORMS: PlatformInfo[] = [
  { id: 'naver', name: '네이버쇼핑', color: '#03C75A' },
  { id: 'coupang', name: '쿠팡', color: '#E8322B' },
  { id: '11st', name: '11번가', color: '#FF0000' },
  { id: 'gmarket', name: 'G마켓', color: '#FF6600' },
]

export interface BarcodeSearchResult {
  product: Product | null
  prices: PriceSnapshot[]
  lowestPrice: PriceSnapshot | null
  highestPrice: PriceSnapshot | null
  cached: boolean
  fetchedAt: string
}

export interface NaverShoppingItem {
  title: string
  link: string
  image: string
  lprice: string
  hprice: string
  mallName: string
  productId: string
  productType: string
  brand: string
  maker: string
  category1: string
  category2: string
  category3: string
  category4: string
}

export interface NaverShoppingResponse {
  lastBuildDate: string
  total: number
  start: number
  display: number
  items: NaverShoppingItem[]
}
