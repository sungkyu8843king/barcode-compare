import { Redis } from '@upstash/redis'

export const redis = Redis.fromEnv()

const PRICE_TTL = 60 * 60 // 1시간
const PRODUCT_TTL = 60 * 60 * 24 // 24시간

export const cacheKeys = {
  product: (barcode: string) => `product:${barcode}`,
  prices: (barcode: string) => `prices:${barcode}`,
}

export async function getCachedPrices(barcode: string) {
  return redis.get(cacheKeys.prices(barcode))
}

export async function setCachedPrices(barcode: string, data: unknown) {
  return redis.setex(cacheKeys.prices(barcode), PRICE_TTL, JSON.stringify(data))
}

export async function getCachedProduct(barcode: string) {
  return redis.get(cacheKeys.product(barcode))
}

export async function setCachedProduct(barcode: string, data: unknown) {
  return redis.setex(cacheKeys.product(barcode), PRODUCT_TTL, JSON.stringify(data))
}

export async function invalidateBarcode(barcode: string) {
  await Promise.all([
    redis.del(cacheKeys.product(barcode)),
    redis.del(cacheKeys.prices(barcode)),
  ])
}
