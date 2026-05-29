import { BRANDS } from '../src/data/config.js'

// Identify which tracked brand a product name belongs to (or null).
export function brandFor(name) {
  const n = (name || '').toLowerCase()
  for (const brand of BRANDS) {
    if (brand.match.some((m) => n.includes(m))) return brand
  }
  return null
}

// Parse a price-ish string ("$4.99", "2 for $7", "4.99") into a number, or null.
export function parsePrice(raw) {
  if (raw == null) return null
  if (typeof raw === 'number') return raw
  const m = String(raw).match(/\$?\s*(\d+(?:\.\d{1,2})?)/)
  return m ? parseFloat(m[1]) : null
}

// Normalize one raw product (from any scrape adapter) into our deal shape.
// A deal counts as "on sale" if a member/regular price gap exists OR an
// explicit deal/coupon string is present.
export function toDeal(raw, idx) {
  const brand = brandFor(raw.name)
  if (!brand) return null

  const price = parsePrice(raw.price)
  const regularPrice = parsePrice(raw.regularPrice) ?? price
  const dealText = (raw.dealText || '').trim()

  const hasPriceDrop = price != null && regularPrice != null && regularPrice > price
  const hasDealSignal = /member|for u|sale|% off|\$ off|coupon|save|bogo|buy one/i.test(
    dealText
  )
  // Items pulled from the weekly ad flyer are featured deals by definition.
  const onSale = Boolean(raw.fromFlyer || hasPriceDrop || (hasDealSignal && price != null))

  return {
    id: raw.id || `${brand.id}-${idx}`,
    brandId: brand.id,
    name: raw.name.trim(),
    price,
    regularPrice,
    onSale,
    dealText,
    validTo: raw.validTo || null,
  }
}

// Filter+normalize a list of raw products down to our tracked-brand deals.
export function toDeals(rawProducts) {
  return (rawProducts || [])
    .map((p, i) => toDeal(p, i))
    .filter(Boolean)
}
