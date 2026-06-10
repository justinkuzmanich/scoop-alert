// Data source: Safeway product prices via the web index (Firecrawl search).
//
// Safeway's own product pages (safeway.com/shop/product-details.*) show the
// current "Your Price / Original Price", but the site is behind Imperva +
// hCaptcha, so we can't load them directly. Google, however, has already
// crawled and indexed those pages WITH the price in the result snippet. So we
// search the index instead of scraping Safeway — no bot-wall, fully cloud-safe.
//
// Tradeoffs vs the weekly ad (Flipp): snippet prices reflect Google's last
// crawl, so they can lag the live sale by some days, and not every product has
// a price in its snippet. We therefore treat this as a SUPPLEMENT to Flipp:
// merged in, lower price wins. Requires FIRECRAWL_API_KEY; absent → returns [].
//
// Snippet caveat: a single Google snippet can mention a neighboring product, so
// the name (from the result title) and the price (from the snippet) aren't
// guaranteed to be the same item. For a regional "all pints $X" sale that's
// harmless; we label dealText so the source is always clear.

import { BRANDS } from '../src/data/config.js'

const FIRECRAWL_SEARCH = 'https://api.firecrawl.dev/v2/search'

async function firecrawlSearch(query, apiKey, limit = 10) {
  const res = await fetch(FIRECRAWL_SEARCH, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ query, limit }),
  })
  if (!res.ok) throw new Error(`Firecrawl search HTTP ${res.status}: ${await res.text()}`)
  const body = await res.json()
  // Accept a few response shapes: {data:{web:[…]}} | {web:[…]} | {data:[…]}
  return body?.data?.web || body?.web || (Array.isArray(body?.data) ? body.data : []) || []
}

// Pull "Your Price $X … Original Price $Y" out of a snippet. Returns
// { price, regularPrice } — regularPrice null if only a single price is shown.
export function parsePrices(text) {
  const s = String(text || '')
  const pair = /your price\s*\$?\s*(\d+(?:\.\d{1,2})?)[\s\S]*?original price\s*\$?\s*(\d+(?:\.\d{1,2})?)/i.exec(s)
  if (pair) {
    const price = parseFloat(pair[1])
    const regularPrice = parseFloat(pair[2])
    if (price > 0 && price < 100) return { price, regularPrice: regularPrice > 0 ? regularPrice : null }
  }
  const one = /your price\s*\$?\s*(\d+(?:\.\d{1,2})?)/i.exec(s)
  if (one) {
    const price = parseFloat(one[1])
    if (price > 0 && price < 100) return { price, regularPrice: null }
  }
  return null
}

// "Haagen-Dazs Vanilla Bean Ice Cream - 14 Oz - Safeway" -> drop the "- Safeway".
export function cleanName(title) {
  return String(title || '')
    .replace(/\s*[-|]\s*Safeway\b.*$/i, '')
    .replace(/\s+/g, ' ')
    .trim()
}

// Public: fetch tracked-brand Safeway prices from the web index (raw products,
// same shape as flipp.js). Requires FIRECRAWL_API_KEY; returns [] (never throws)
// on any failure so the caller can fall back to the weekly ad.
export async function fetchGooglePriceDeals(env = process.env) {
  const apiKey = env.FIRECRAWL_API_KEY
  if (!apiKey) return []

  const raw = []
  const seen = new Set()
  for (const brand of BRANDS) {
    const query = `${brand.query || brand.name} site:safeway.com/shop/product-details`
    let results
    try {
      results = await firecrawlSearch(query, apiKey)
    } catch (err) {
      console.warn(`   ⚠️  web-price search "${brand.name}" failed: ${err.message}`)
      continue
    }
    for (const r of results) {
      const url = r.url || r.link || ''
      if (!/safeway\.com\/shop\/product-details/i.test(url)) continue
      const name = cleanName(r.title)
      if (!name) continue
      const prices = parsePrices(`${r.title || ''} ${r.description || r.snippet || ''}`)
      if (!prices) continue
      const key = name.toLowerCase()
      if (seen.has(key)) continue
      seen.add(key)
      raw.push({
        id: `web-${url.match(/product-details\.(\d+)/)?.[1] || key.replace(/\s+/g, '-')}`,
        name,
        price: prices.price,
        regularPrice: prices.regularPrice,
        dealText: 'Safeway price (web index)',
        validTo: null,
      })
    }
  }
  return raw
}
