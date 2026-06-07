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
