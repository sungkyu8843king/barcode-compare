import Anthropic from '@anthropic-ai/sdk'

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

// 비용 제어: Haiku (가장 빠르고 저렴) 사용
const MODEL = 'claude-haiku-4-5-20251001'

/**
 * 네이버 검색 결과 중 바코드에 해당하는 제품과 가장 일치하는 것을 고름
 * 신뢰도가 낮을 때 (텍스트 검색 결과가 애매할 때) 호출
 * @returns 가장 일치하는 productId, 또는 확신 없으면 null
 */
export async function pickBestNaverMatch(
  barcode: string,
  productName: string,
  spec: string | null,
  candidates: Array<{ title: string; productId: string; brand: string; category: string; lprice: string }>,
): Promise<{ productId: string | null; confidence: 'high' | 'low' }> {
  if (!process.env.ANTHROPIC_API_KEY || candidates.length === 0) {
    return { productId: null, confidence: 'low' }
  }

  try {
    const list = candidates.slice(0, 8).map((c, i) =>
      `[${i + 1}] productId=${c.productId} | ${c.title} | 브랜드:${c.brand} | 카테고리:${c.category} | 가격:${c.lprice}원`
    ).join('\n')

    const msg = await client.messages.create({
      model: MODEL,
      max_tokens: 100,
      messages: [{
        role: 'user',
        content: `바코드: ${barcode}
제품명(DB): ${productName}
규격: ${spec ?? '알 수 없음'}

아래 네이버 쇼핑 검색결과 중 위 제품과 동일한 것의 번호와 productId를 반환하세요.
확신이 없으면 "없음"이라고만 답하세요.
형식: 번호|productId 또는 없음

${list}`
      }],
    })

    const text = (msg.content[0] as any).text?.trim() ?? ''
    if (text === '없음' || !text.includes('|')) {
      return { productId: null, confidence: 'low' }
    }

    const [, pid] = text.split('|')
    const matched = candidates.find(c => c.productId === pid?.trim())
    return matched
      ? { productId: matched.productId, confidence: 'high' }
      : { productId: null, confidence: 'low' }
  } catch (e) {
    console.error('[Claude] pickBestNaverMatch 실패:', e)
    return { productId: null, confidence: 'low' }
  }
}

/**
 * 검색 결과가 없거나 부정확할 때 더 나은 검색어를 생성
 */
export async function improveSearchQuery(
  barcode: string,
  productName: string,
  brand: string | null,
  spec: string | null,
): Promise<string | null> {
  if (!process.env.ANTHROPIC_API_KEY) return null

  try {
    const msg = await client.messages.create({
      model: MODEL,
      max_tokens: 80,
      messages: [{
        role: 'user',
        content: `한국 상품 바코드 검색에 쓸 최적 검색어를 만들어 주세요.
바코드: ${barcode}
제품명: ${productName}
브랜드: ${brand ?? '알 수 없음'}
규격: ${spec ?? '알 수 없음'}

네이버쇼핑에서 이 제품을 정확히 찾을 수 있는 짧은 검색어(15자 이내)만 출력하세요. 설명 없이.`
      }],
    })

    const text = (msg.content[0] as any).text?.trim() ?? ''
    return text.length > 0 && text.length <= 50 ? text : null
  } catch (e) {
    console.error('[Claude] improveSearchQuery 실패:', e)
    return null
  }
}

/**
 * 제품명에서 브랜드/제품명/규격을 파싱 (외부 API에서 이상한 이름이 올 때 정리용)
 */
export async function parseProductName(rawName: string): Promise<{
  name: string
  brand: string | null
  spec: string | null
} | null> {
  if (!process.env.ANTHROPIC_API_KEY) return null

  try {
    const msg = await client.messages.create({
      model: MODEL,
      max_tokens: 120,
      messages: [{
        role: 'user',
        content: `한국 상품명을 파싱해서 JSON으로 반환하세요.
상품명: ${rawName}

형식: {"name":"상품명(브랜드/규격 제외)","brand":"브랜드명 또는 null","spec":"용량/중량/수량 또는 null"}
JSON만 출력하세요.`
      }],
    })

    const text = (msg.content[0] as any).text?.trim() ?? ''
    const json = JSON.parse(text)
    return json
  } catch {
    return null
  }
}
