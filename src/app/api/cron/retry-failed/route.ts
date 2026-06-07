/**
 * 6시간마다 실행: 사용자가 스캔했지만 제품을 찾지 못한 바코드 재시도
 *
 * 대상: search_logs에서 product_name IS NULL인 것들
 *       (사용자가 실제로 스캔했으나 DB/Naver 모두 실패한 경우)
 */
import { NextRequest, NextResponse } from 'next/server'
import sql, { upsertProduct, saveCatalogMap } from '@/lib/db'
import { searchByBarcode } from '@/lib/naver-shopping'
import { lookupFoodsafety, lookupOpenFoodFacts } from '@/lib/open-food-facts'
import { parseProductName } from '@/lib/claude-ai'

const CRON_SECRET = process.env.CRON_SECRET

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization')
  if (CRON_SECRET && authHeader !== `Bearer ${CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // product_name IS NULL = 검색 당시 제품 못 찾은 바코드
  // 최근 48시간 이내, 2회 이상 스캔된 것 우선 (수요 있는 것)
  const failedBarcodes = await sql`
    SELECT
      barcode,
      COUNT(*) AS scan_count,
      MAX(searched_at) AS last_tried
    FROM search_logs
    WHERE product_name IS NULL
      AND searched_at > NOW() - INTERVAL '48 hours'
      AND barcode ~ '^\d{8,14}$'
    GROUP BY barcode
    ORDER BY COUNT(*) DESC, MAX(searched_at) DESC
    LIMIT 20
  `

  const results = { tried: 0, found: 0, barcodes: [] as string[] }

  for (const row of failedBarcodes) {
    const barcode = row.barcode as string
    results.tried++

    try {
      // 이미 DB에 등록됐으면 skip
      const existing = await sql`SELECT barcode FROM products WHERE barcode = ${barcode} LIMIT 1`
      if (existing.length > 0) continue

      // 1. 식품안전나라 직접 조회 (가장 정확)
      const fsProduct = await lookupFoodsafety(barcode)
      if (fsProduct?.name) {
        let finalName = fsProduct.name
        let finalBrand = fsProduct.brand
        let finalSpec = (fsProduct as any).spec ?? null

        // Claude로 이름 정제
        if (process.env.ANTHROPIC_API_KEY) {
          const parsed = await parseProductName(fsProduct.name, barcode)
          if (parsed?.name) {
            finalName = parsed.name
            finalBrand = parsed.brand ?? finalBrand
            finalSpec = parsed.spec ?? finalSpec
          }
        }

        await upsertProduct({ barcode, name: finalName, brand: finalBrand, category: fsProduct.category, image_url: fsProduct.image_url, spec: finalSpec })

        // Naver에서 이미지 보강 (비동기)
        enrichFromNaver(barcode, finalName, finalBrand ?? null, finalSpec ?? null).catch(() => {})

        results.found++
        results.barcodes.push(barcode)
        console.log(`[retry] 식품안전나라 발견: ${barcode} → ${finalName}`)
        await delay(200)
        continue
      }

      // 2. Naver 검색
      const naverResult = await searchByBarcode(barcode)
      if (naverResult.inferredName) {
        let finalName = naverResult.inferredName
        let finalBrand = naverResult.inferredBrand
        let finalSpec = naverResult.inferredSpec

        if (process.env.ANTHROPIC_API_KEY) {
          const parsed = await parseProductName(naverResult.inferredName, barcode)
          if (parsed?.name) {
            finalName = parsed.name
            finalBrand = parsed.brand || finalBrand
            finalSpec = parsed.spec || finalSpec
          }
        }

        await upsertProduct({
          barcode,
          name: finalName,
          brand: finalBrand,
          category: naverResult.inferredCategory,
          image_url: naverResult.inferredImage,
          spec: finalSpec,
        })

        if (naverResult.naverProductId) {
          saveCatalogMap(barcode, naverResult.naverProductId).catch(() => {})
        }

        results.found++
        results.barcodes.push(barcode)
        console.log(`[retry] Naver 발견: ${barcode} → ${finalName}`)
      }

      // 3. Open Food Facts (해외 제품)
      if (!naverResult.inferredName) {
        const offProduct = await lookupOpenFoodFacts(barcode)
        if (offProduct?.name) {
          await upsertProduct({ barcode, name: offProduct.name, brand: offProduct.brand, category: offProduct.category, image_url: offProduct.image_url })
          results.found++
          results.barcodes.push(barcode)
          console.log(`[retry] OpenFoodFacts 발견: ${barcode} → ${offProduct.name}`)
        }
      }

      await delay(500)
    } catch (e) {
      console.error(`[retry] ${barcode} 오류:`, e)
    }
  }

  console.log('[cron/retry-failed] 완료:', results)
  return NextResponse.json({ ok: true, ...results, ts: new Date().toISOString() })
}

// 식품안전나라로 찾은 제품에 Naver 이미지/카탈로그ID 보강
async function enrichFromNaver(barcode: string, name: string, brand: string | null, spec: string | null) {
  try {
    const result = await searchByBarcode(barcode, name, brand ?? undefined, spec)
    if (result.inferredImage || result.naverProductId) {
      await sql`
        UPDATE products SET
          image_url  = COALESCE(image_url, ${result.inferredImage}),
          spec       = COALESCE(spec,      ${result.inferredSpec}),
          updated_at = NOW()
        WHERE barcode = ${barcode}
      `
      if (result.naverProductId) {
        saveCatalogMap(barcode, result.naverProductId).catch(() => {})
      }
    }
  } catch {}
}

function delay(ms: number) { return new Promise(r => setTimeout(r, ms)) }
