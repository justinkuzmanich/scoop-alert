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
//   * Imperva tarpits raw-HTTP requests to this API even through a residential
//     proxy, so the fetch is driven through a real headless browser (Playwright)
//     in scraper/j4u-browser.js — see fetchSafewayJ4U below. In CI, set
//     J4U_PROXY_URL to a residential proxy so the browser exits from a trusted
//     IP; unset → goes direct (works locally / from a home IP).
//   * Sessions expire; on any auth/expiry/bot-wall failure this adapter logs
//     and returns [], so the pipeline cleanly falls back to Flipp.
//
// Nothing secret is stored in the repo — the session and proxy URL both live
// in GitHub secrets.

import { BRANDS } from '../src/data/config.js'

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

// Accept either a URL form (http://user:pass@host:port) or IPRoyal's
// "Copy list" form (host:port:user:pass) — the latter lets you paste the
// credential verbatim with no hand-editing, avoiding l/I/O/0 transcription
// bugs. Returns { hostname, port, username, password }.
export function parseProxy(raw) {
  const s = String(raw).trim()
  if (/^https?:\/\//i.test(s)) {
    const u = new URL(s)
    return {
      hostname: u.hostname,
      port: u.port || '80',
      username: decodeURIComponent(u.username),
      password: decodeURIComponent(u.password),
    }
  }
  // host:port:user:pass — split into at most 4 parts so a ':' inside the
  // password (rare, but possible) stays intact.
  const m = s.match(/^([^:]+):([^:]+):([^:]+):(.+)$/)
  if (!m) throw new Error('J4U_PROXY_URL: unrecognized proxy format')
  return { hostname: m[1], port: m[2], username: m[3], password: m[4] }
}

// Public: fetch personalized deals for one store. Returns raw products (same
// shape as flipp.js). Requires SAFEWAY_SESSION; returns [] (never throws) on
// any auth/expiry/bot-wall failure so the caller can fall back to Flipp.
//
// Imperva tarpits raw-HTTP requests to the J4U API even through a residential
// proxy, so we drive the real web app in a headless browser and intercept the
// pgmsearch XHR it fires. The browser is dynamically imported so environments
// without Playwright (and runs without SAFEWAY_SESSION) pay no cost.
export async function fetchSafewayJ4U(store, env = process.env) {
  // Two ways to enable J4U:
  //   * J4U_LOCAL=1     — run a real browser on your own machine using a saved,
  //                       logged-in profile (see j4u-browser-local.js). No cookie
  //                       or proxy needed; this is the recommended local path.
  //   * SAFEWAY_SESSION — headless/CI path: drive a headless browser with a
  //                       copied session cookie (and a residential proxy in CI).
  // Disabled (returns []) unless one is set, so the pipeline falls back to Flipp.
  const local = env.J4U_LOCAL === '1'
  if (!local && !env.SAFEWAY_SESSION) return []

  const queries = BRANDS.map((b) => b.query || b.name)

  let results
  try {
    if (local) {
      const { fetchJ4USearchJsonLocal } = await import('./j4u-browser-local.js')
      results = await fetchJ4USearchJsonLocal({ store, queries, env })
    } else {
      const { fetchJ4USearchJson } = await import('./j4u-browser.js')
      results = await fetchJ4USearchJson({ store, queries, env })
    }
  } catch (err) {
    console.warn(`   ⚠️  J4U browser unavailable @ ${store.id}: ${err.message}`)
    return []
  }

  const seen = new Set()
  const raw = []
  for (const { json } of results) {
    for (const p of parseJ4USearch(json)) {
      const key = p.id || p.name
      if (seen.has(key)) continue
      seen.add(key)
      raw.push(p)
    }
  }
  return raw
}
