// Parser for Safeway "for U" / J4U personalized product-search responses.
//
// This is Safeway's own authenticated product API, which returns PER-ACCOUNT
// pricing — including the lower "Club Card" / member price. The response carries
// products under `primaryProducts.response.docs[]`, each with `basePrice`
// (regular), `price` (member price already applied), `promoDescription`, and
// `promoEndDate` — exactly our deal shape.
//
// We can't fetch this endpoint automatically: it sits behind a login + an
// Imperva/hCaptcha bot-wall that blocks every automated browser, even a real
// one from a home IP. So the data is captured by hand in your own logged-in
// browser (scripts/j4u-capture.js) and fed to scraper/j4u-import.js, which uses
// the parser below. See the README "Personalized member deals" section.

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

