// Data source: Flipp (backflipp.wishabi.com), which syndicates Safeway's
// weekly ad as clean JSON — no Imperva bot-wall (unlike safeway.com itself).
//
// Flipp is keyed by POSTAL CODE, so Safeway's weekly ad is regional: both
// Mill Valley stores (94941) share the same flyer deals. Per-store digital
// coupons are not available from this public source.
//
// On a normal network this works with a plain fetch (no API key). In a
// network-restricted environment, set FIRECRAWL_API_KEY to route requests
// through Firecrawl instead.

const FLIPP_BASE = 'https://backflipp.wishabi.com/flipp'

async function flippGet(url) {
  const apiKey = process.env.FIRECRAWL_API_KEY
  if (apiKey) return flippViaFirecrawl(url, apiKey)
  const res = await fetch(url, { headers: { Accept: 'application/json' } })
  if (!res.ok) throw new Error(`Flipp HTTP ${res.status} for ${url}`)
  return res.json()
}

async function flippViaFirecrawl(url, apiKey) {
  const res = await fetch('https://api.firecrawl.dev/v2/scrape', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ url, formats: ['rawHtml'], proxy: 'basic' }),
  })
  if (!res.ok) throw new Error(`Firecrawl HTTP ${res.status}: ${await res.text()}`)
  const body = await res.json()
  const raw = body?.data?.rawHtml
  if (!raw) throw new Error('Firecrawl returned no body for Flipp request')
  return JSON.parse(raw)
}

// The flyers/flyer-detail responses vary in shape; find the array of items.
function findItemsArray(json) {
  for (const key of ['flyer_items', 'items', 'ecom_items']) {
    if (Array.isArray(json?.[key]) && json[key].length) return json[key]
  }
  for (const v of Object.values(json || {})) {
    if (
      Array.isArray(v) &&
      v.some((x) => x && typeof x === 'object' && 'name' in x)
    ) {
      return v
    }
  }
  return []
}

function currentSafewayFlyers(flyersJson) {
  const flyers = Array.isArray(flyersJson)
    ? flyersJson
    : flyersJson?.flyers || []
  const now = Date.now()
  return flyers
    .filter((f) => /safeway/i.test(f.merchant_name || ''))
    .filter((f) => {
      const from = f.valid_from ? Date.parse(f.valid_from) : -Infinity
      const to = f.valid_to ? Date.parse(f.valid_to) : Infinity
      return from <= now && now <= to
    })
}

function mapFlyerItem(it) {
  const dealText =
    (it.sale_story && it.sale_story.trim()) ||
    [it.pre_price_text, it.post_price_text].filter(Boolean).join(' ').trim() ||
    'Weekly ad price'
  return {
    id: `flyer-${it.flyer_item_id || it.id}`,
    name: it.name,
    price: it.current_price, // number or null (e.g. BOGO deals)
    regularPrice: it.original_price, // number or null
    dealText,
    validTo: it.valid_to || null,
    fromFlyer: true, // present in the weekly ad => it's a featured deal
  }
}

// Public: fetch all Safeway weekly-ad items for a postal code (raw products).
export async function fetchSafewayDeals(postalCode) {
  const flyersJson = await flippGet(
    `${FLIPP_BASE}/flyers?locale=en-us&postal_code=${encodeURIComponent(postalCode)}`
  )
  const flyers = currentSafewayFlyers(flyersJson)

  const seen = new Set()
  const raw = []
  for (const f of flyers) {
    const id = f.id || f.flyer_id
    const detail = await flippGet(
      `${FLIPP_BASE}/flyers/${id}?locale=en-us&postal_code=${encodeURIComponent(postalCode)}`
    )
    for (const it of findItemsArray(detail)) {
      const key = it.flyer_item_id || it.id || it.name
      if (seen.has(key)) continue
      seen.add(key)
      raw.push(mapFlyerItem(it))
    }
  }
  return raw
}
