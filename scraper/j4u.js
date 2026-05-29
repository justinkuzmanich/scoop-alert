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

// ---------------------------------------------------------------------------
// Coupon tier (the "$4.48 each" clippable offer — an extra discount BELOW the
// member price). These live in `offersData.upcs[<upc>].offers`. The exact field
// names vary by offer program, so parsing here is DEFENSIVE and conservative:
// we only ever promote a coupon to the headline price when it's an unambiguous
// ABSOLUTE price below the member price. Discount-style offers ("SAVE $1.00",
// "20% off") are noted in dealText but never used to fabricate a price, so a
// mis-parse can't show a wrong number. Validate the exact fields on the first
// real authenticated run and tighten as needed.
// ---------------------------------------------------------------------------

const round2 = (n) => Math.round(n * 100) / 100
function numOrNull(v) {
  const n = typeof v === 'number' ? v : parseFloat(v)
  return Number.isFinite(n) ? n : null
}

// Classify a money-ish value as an absolute price vs. a discount.
function parseMoney(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? { value: v, kind: 'absolute' } : null
  if (typeof v !== 'string') return null
  const s = v.trim()
  const pct = s.match(/(\d+(?:\.\d+)?)\s*%/)
  if (pct) return { value: parseFloat(pct[1]), kind: 'discount-pct' }
  const m = s.match(/\$?\s*(\d+(?:\.\d{1,2})?)/)
  if (!m) return null
  const value = parseFloat(m[1])
  if (/\b(save|off)\b/i.test(s)) return { value, kind: 'discount-amount' }
  return { value, kind: 'absolute' }
}

function offersToArray(offers) {
  if (Array.isArray(offers)) return offers
  if (offers && typeof offers === 'object') return Object.values(offers)
  return []
}

function toIso(v) {
  if (v == null) return null
  if (typeof v === 'number') {
    const d = new Date(v)
    return isNaN(d.getTime()) ? null : d.toISOString()
  }
  const s = String(v)
  const dotnet = s.match(/\/Date\((\d+)\)\//) // legacy "/Date(168...)/" form
  if (dotnet) return toIso(Number(dotnet[1]))
  if (/^\d{13}$/.test(s)) return toIso(Number(s))
  const d = new Date(s)
  return isNaN(d.getTime()) ? null : d.toISOString()
}

function detectExpiry(offer) {
  for (const [k, v] of Object.entries(offer)) {
    if (/(expir|enddate|end_date|expires|validto|valid_to)/i.test(k)) {
      const iso = toIso(v)
      if (iso) return iso
    }
  }
  return null
}

// true = clipped, false = available-but-unclipped, null = unknown.
function detectClipped(offer) {
  for (const [k, v] of Object.entries(offer)) {
    if (/clip|added|redeemed/i.test(k)) {
      if (typeof v === 'boolean') return v
      if (typeof v === 'string') return /^(y|true|clipped|added|c)$/i.test(v.trim())
    }
    if (/^status$/i.test(k) && typeof v === 'string') {
      if (/^C$/i.test(v)) return true
      if (/^U$/i.test(v)) return false
    }
  }
  return null
}

// Summarize the coupons for one UPC. Returns { count, bestPrice, expires,
// clipped } — bestPrice is only set for a confident absolute price < basePrice.
export function summarizeCoupons(offers, basePrice) {
  const list = offersToArray(offers)
  if (!list.length) return null
  let bestPrice = null
  let expires = null
  let clipped = null
  for (const offer of list) {
    if (!offer || typeof offer !== 'object') continue
    for (const [k, val] of Object.entries(offer)) {
      if (!/price|each|youpay|netprice|finalprice/i.test(k)) continue
      const money = parseMoney(val)
      if (!money || money.kind !== 'absolute') continue // discounts: never fabricate
      const p = round2(money.value)
      if (p <= 0 || (basePrice != null && p > basePrice)) continue // sanity bounds
      if (bestPrice == null || p < bestPrice) bestPrice = p
    }
    const e = detectExpiry(offer)
    if (e && (!expires || e < expires)) expires = e
    const c = detectClipped(offer)
    if (c === true) clipped = true
    else if (clipped == null) clipped = c
  }
  return { count: list.length, bestPrice, expires, clipped }
}

// Map one product doc (+ its coupons) into our raw-product shape (the same
// shape Flipp's adapter emits; match.js/toDeals does the rest).
export function mapJ4UDoc(doc, offersByUpc = {}) {
  if (!doc || !doc.name) return null
  const memberPrice = numOrNull(doc.price) // club-card price, already applied
  const basePrice = numOrNull(doc.basePrice) // regular price
  const coupons = summarizeCoupons(offersByUpc[doc.upc] || offersByUpc[String(doc.upc)], basePrice)

  let price = memberPrice
  const parts = []
  const promo = (doc.promoDescription || doc.promoText || '').trim()
  if (promo) parts.push(promo)

  if (coupons) {
    const expTxt = coupons.expires ? ` · exp ${coupons.expires.slice(0, 10)}` : ''
    if (coupons.bestPrice != null && (memberPrice == null || coupons.bestPrice < memberPrice)) {
      // Confident absolute coupon price that beats the member price → headline.
      price = coupons.bestPrice
      const clip = coupons.clipped === false ? ' (clip to activate)' : ''
      parts.push(`for-U coupon: $${coupons.bestPrice.toFixed(2)} ea${clip}${expTxt}`)
    } else {
      // Coupon exists but price wasn't confidently absolute — note, don't guess.
      const clip = coupons.clipped === false ? ' — clip for more savings' : ''
      parts.push(`${coupons.count} for-U coupon(s) available${clip}${expTxt}`)
    }
  }

  return {
    id: `j4u-${doc.upc || doc.pid || doc.id}`,
    name: doc.name,
    price,
    regularPrice: basePrice,
    dealText: parts.join(' · '),
    validTo: coupons?.expires || doc.promoEndDate || null,
    aisle: doc.aisleLocation || null, // bonus: J4U tells us where it is in-store
  }
}

// Build a { upc: offers } map from the search response's offersData block.
export function parseOffersByUpc(json) {
  const upcs = json?.offersData?.upcs
  const out = {}
  if (upcs && typeof upcs === 'object') {
    for (const [upc, entry] of Object.entries(upcs)) {
      out[upc] = entry?.offers
    }
  }
  return out
}

// Pull the product docs out of a pgmsearch response and enrich with coupons.
export function parseJ4USearch(json) {
  const docs = json?.primaryProducts?.response?.docs
  if (!Array.isArray(docs)) return []
  const offersByUpc = parseOffersByUpc(json)
  return docs.map((d) => mapJ4UDoc(d, offersByUpc)).filter(Boolean)
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
