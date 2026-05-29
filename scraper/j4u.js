// Data source: Safeway "for U" / J4U personalized product search.
//
// Unlike Flipp (the public weekly ad), this is Safeway's own authenticated
// product API, which returns PER-STORE, PER-ACCOUNT pricing — including the
// lower "Club Card" / member price that normally only shows after you log in.
//
//   GET https://www.safeway.com/abs/pub/xapi/pgmsearch/v1/search/products
//       ?q=<brand>&storeid=<locId>&includeOffer=true&banner=safeway&...
//
// The response carries products under `primaryProducts.response.docs[]`, each
// with `basePrice` (regular), `price` (member price already applied),
// `promoDescription`, and `promoEndDate` — exactly our deal shape.
//
// IMPORTANT — this endpoint sits behind login + an Imperva bot-wall:
//   * It needs your browser session, supplied via the SAFEWAY_SESSION env var
//     (the full Cookie header copied from a logged-in request).
//   * Some deployments also require an API-gateway key — set SAFEWAY_SUB_KEY
//     to the `Ocp-Apim-Subscription-Key` header value if requests 401.
//   * Sessions expire; on 401/403/timeout this adapter logs and returns [],
//     so the pipeline cleanly falls back to Flipp instead of crashing.
//
// Nothing secret is stored in the repo — the session goes in a GitHub secret.

import { BRANDS } from '../src/data/config.js'

const J4U_SEARCH =
  'https://www.safeway.com/abs/pub/xapi/pgmsearch/v1/search/products'

const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/124.0 Safari/537.36'

// Map one product doc from the search response into our raw-product shape
// (the same shape Flipp's adapter emits; match.js/toDeals does the rest).
export function mapJ4UDoc(doc) {
  if (!doc || !doc.name) return null
  return {
    id: `j4u-${doc.upc || doc.pid || doc.id}`,
    name: doc.name,
    price: doc.price, // member/club-card price, already applied
    regularPrice: doc.basePrice, // pre-discount price
    dealText: (doc.promoDescription || doc.promoText || '').trim(),
    validTo: doc.promoEndDate || null,
    aisle: doc.aisleLocation || null, // bonus: J4U tells us where it is in-store
  }
}

// Pull the product docs out of a pgmsearch response (shape-tolerant).
export function parseJ4USearch(json) {
  const docs = json?.primaryProducts?.response?.docs
  if (!Array.isArray(docs)) return []
  return docs.map(mapJ4UDoc).filter(Boolean)
}

function buildSearchUrl(query, storeId, postalCode) {
  const params = new URLSearchParams({
    'request-id': String(Math.floor(Math.random() * 1e19)),
    url: 'https://www.safeway.com',
    pageurl: 'https://www.safeway.com',
    pagename: 'search',
    rows: '30',
    start: '0',
    'search-type': 'keyword',
    storeid: String(storeId),
    featured: 'true',
    q: query,
    sort: '',
    timezone: 'America/Los_Angeles',
    dvid: 'web-4.1search',
    channel: 'instore',
    includeOffer: 'true',
    banner: 'safeway',
  })
  if (postalCode) params.set('zipcode', postalCode)
  return `${J4U_SEARCH}?${params.toString()}`
}

async function j4uGet(url, { session, subKey, timeoutMs = 12000 }) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(url, {
      headers: {
        Accept: 'application/json',
        'User-Agent': BROWSER_UA,
        Cookie: session,
        ...(subKey ? { 'Ocp-Apim-Subscription-Key': subKey } : {}),
      },
      signal: controller.signal,
    })
    if (!res.ok) throw new Error(`J4U HTTP ${res.status}`)
    return await res.json()
  } finally {
    clearTimeout(timer)
  }
}

// Public: fetch personalized deals for one store. Returns raw products (same
// shape as flipp.js). Requires SAFEWAY_SESSION; returns [] (with a warning) on
// any auth/expiry/bot-wall failure so the caller can fall back to Flipp.
export async function fetchSafewayJ4U(store, env = process.env) {
  const session = env.SAFEWAY_SESSION
  if (!session) return [] // adapter disabled until a session is provided

  const storeId = store.locId
  const opts = { session, subKey: env.SAFEWAY_SUB_KEY }

  const seen = new Set()
  const raw = []
  for (const brand of BRANDS) {
    const query = brand.query || brand.name
    try {
      const json = await j4uGet(
        buildSearchUrl(query, storeId, store.postalCode),
        opts
      )
      for (const p of parseJ4USearch(json)) {
        const key = p.id || p.name
        if (seen.has(key)) continue
        seen.add(key)
        raw.push(p)
      }
    } catch (err) {
      const expired = /\b(401|403)\b/.test(err.message)
      console.warn(
        `   ⚠️  J4U fetch for "${query}" @ ${store.id} failed: ${err.message}` +
          (expired ? ' (session likely expired — re-capture SAFEWAY_SESSION)' : '')
      )
    }
  }
  return raw
}
