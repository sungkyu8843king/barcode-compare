import axios from 'axios'
import { Product } from '@/types'

interface OFFProduct {
  code: string
  product?: {
    product_name: string
    product_name_ko: string
    brands: string
    categories: string
    image_url: string
    image_front_url: string
  }
  status: number
  status_verbose: string
}

// UPC Item DB - 무료 100회/일, 한국 제품 일부 커버
export async function lookupUPCItemDB(barcode: string): Promise<Partial<Product> | null> {
  try {
    const res = await axios.get(`https://api.upcitemdb.com/prod/trial/lookup?upc=${barcode}`, {
      timeout: 5000,
      headers: { 'Accept': 'application/json' },
    })
    const item = res.data?.items?.[0]
    if (!item?.title) return null
    return {
      barcode,
      name: item.title,
      brand: item.brand || null,
      category: item.category || null,
      image_url: item.images?.[0] || null,
    }
  } catch {
    return null
  }
}

// Open Food Facts - 무료 오픈 바코드 DB
export async function lookupOpenFoodFacts(barcode: string): Promise<Partial<Product> | null> {
  try {
    const response = await axios.get<OFFProduct>(
      `https://world.openfoodfacts.org/api/v2/product/${barcode}`,
      { timeout: 5000 }
    )

    if (response.data.status !== 1 || !response.data.product) {
      return null
    }

    const p = response.data.product
    const name = p.product_name_ko || p.product_name

    if (!name) return null

    return {
      barcode,
      name: name.trim(),
      brand: p.brands ? p.brands.split(',')[0].trim() : null,
      category: p.categories ? p.categories.split(',')[0].trim() : null,
      image_url: p.image_front_url || p.image_url || null,
    }
  } catch {
    return null
  }
}
