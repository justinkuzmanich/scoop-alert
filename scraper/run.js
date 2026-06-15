// Orchestrates one check across all configured stores:
//   fetch Safeway weekly ad (via Flipp) -> normalize -> diff against last run
//   -> write deals.json for the web app -> email alerts for newly-on-sale items.
//
// Safeway's weekly ad is regional (keyed by postal code), so stores that share
// a postal code share a flyer; we fetch each postal code only once.
//
// Usage:
//   node scraper/run.js            # real run (sends email if configured)
//   DRY_RUN=1 node scraper/run.js  # fetch + write, but only print emails

import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { STORES } from '../src/data/config.js'
import { fetchSafewayDeals } from './flipp.js'
import { fetchGooglePriceDeals } from './google-price.js'
import { toDeals } from './match.js'
import { notify } from './notify.js'

// Merge deals from multiple sources, de-duping by product name and keeping the
// lower-priced entry (e.g. a J4U member price that beats the weekly-ad price).
function dealKey(d) {
  return (d.name || '').toLowerCase().replace(/\s+/g, ' ').trim()
}
function mergeDeals(...lists) {
  const byKey = new Map()
  for (const d of lists.flat()) {
    const k = dealKey(d)
    const cur = byKey.get(k)
    if (!cur || (d.price ?? Infinity) < (cur.price ?? Infinity)) byKey.set(k, d)
  }
  return [...byKey.values()]
}

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')
const DEALS_OUT = join(ROOT, 'public', 'data', 'deals.json')
const MANUAL_IN = join(ROOT, 'scraper', 'manual-deals.json')

// Convert a hand-curated manual-deals.json entry into a deal object. These are
// always shown (onSale) and bypass the per-brand maxPrice cap — they're
// explicitly curated, e.g. in-store "buy 2+" promos the public sources miss.
function manualToDeal(m) {
  const slug = (m.name || m.brandId || 'deal')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
  return {
    id: m.id || `manual-${slug}`,
    brandId: m.brandId,
    name: m.name,
    price: m.price ?? null,
    regularPrice: m.regularPrice ?? m.price ?? null,
    onSale: true,
    dealText: m.dealText || 'In-store deal',
    validTo: m.validTo || null,
    image: m.image || null,
  }
}

async function readJson(path, fallback) {
  try {
    return JSON.parse(await readFile(path, 'utf8'))
  } catch {
    return fallback
  }
}

async function main() {
  // One-time delivery test: TEST_ALERT=1 sends a single sample alert through
  // the normal notify() path (real email if RESEND_API_KEY is set, console
  // otherwise) without scraping or touching deals.json. Used to confirm the
  // email pipeline works before a real deal ever lands.
  if (process.env.TEST_ALERT === '1') {
    const store = STORES[0]
    const sample = [
      {
        id: 'test-alert',
        brandId: 'haagen-dazs',
        name: 'TEST — Häagen-Dazs Gelato 14-oz. 4-ct.',
        price: 5.99,
        regularPrice: 7.99,
        onSale: true,
        dealText: 'One-time Scoop Alert delivery test — not a real deal',
        validTo: null,
      },
    ]
    console.log('🧪 TEST_ALERT set — sending one sample alert email…')
    await notify(store, sample)
    console.log('✓ Test alert sent (no scrape, deals.json untouched).')
    return
  }

  // "Newly on sale" is diffed against the previously committed deals.json
  // (not a gitignored state file): on CI the repo checkout always carries the
  // last run's data, so we only email on genuinely new deals — never on every
  // run just because a local state file was missing.
  const prevDeals = await readJson(DEALS_OUT, { stores: [] })
  const prevOnSaleByStore = {}
  for (const s of prevDeals.stores || []) {
    prevOnSaleByStore[s.id] = (s.deals || [])
      .filter((d) => d.onSale)
      .map((d) => d.id)
  }

  // Fetch each unique postal code once.
  const rawByPostal = {}
  for (const store of STORES) {
    if (rawByPostal[store.postalCode]) continue
    console.log(`\n🍦 Fetching Safeway weekly ad for ${store.postalCode}…`)
    rawByPostal[store.postalCode] = await fetchSafewayDeals(store.postalCode)
    console.log(`   ${rawByPostal[store.postalCode].length} flyer items.`)
  }

  // Safeway shelf prices via the web index (Firecrawl). Regional, not per-store,
  // so fetch once and fold into every store. Supplements the weekly ad — catches
  // sales the flyer misses (e.g. the all-pints Häagen-Dazs price). On-sale only.
  let webDeals = []
  if (process.env.FIRECRAWL_API_KEY) {
    console.log(`\n🌐 Fetching Safeway prices via web index…`)
    webDeals = toDeals(await fetchGooglePriceDeals()).filter((d) => d.onSale)
    console.log(`   ${webDeals.length} web-index deal(s).`)
  }

  // Hand-curated deals (scraper/manual-deals.json) — in-store/member promos the
  // automated sources miss. Always overlaid; expired entries are dropped.
  const now = Date.now()
  const activeManual = ((await readJson(MANUAL_IN, { deals: [] })).deals || []).filter(
    (m) => m && m.brandId && (!m.expires || Date.parse(m.expires) >= now)
  )
  if (activeManual.length) console.log(`\n📝 ${activeManual.length} manual deal(s) overlaid.`)

  const storesOut = []

  for (const store of STORES) {
    // Weekly ad (Flipp) + web-index shelf prices + manual overlay (lower price
    // wins). Personalized "for U" member deals come from npm run j4u:import.
    const manualForStore = activeManual
      .filter((m) => !m.stores || m.stores.includes(store.id))
      .map(manualToDeal)
    const deals = mergeDeals(
      toDeals(rawByPostal[store.postalCode]),
      webDeals,
      manualForStore
    )

    const nowOnSale = deals.filter((d) => d.onSale)
    console.log(
      `   ${store.name}: ${deals.length} tracked-brand items, ${nowOnSale.length} on sale.`
    )

    const prev = new Set(prevOnSaleByStore[store.id] || [])
    const newlyOnSale = nowOnSale.filter((d) => !prev.has(d.id))

    storesOut.push({
      id: store.id,
      name: store.name,
      address: store.address,
      deals,
    })

    if (newlyOnSale.length) {
      console.log(`   🎉 ${newlyOnSale.length} newly on sale — alerting.`)
      await notify(store, newlyOnSale)
    }
  }

  await mkdir(dirname(DEALS_OUT), { recursive: true })
  await writeFile(
    DEALS_OUT,
    JSON.stringify(
      { isSample: false, checkedAt: new Date().toISOString(), stores: storesOut },
      null,
      2
    )
  )
  console.log(`\n✓ Wrote ${DEALS_OUT} (${storesOut.length} store(s))`)
}

main().catch((err) => {
  console.error('✗ Run failed:', err.message)
  process.exit(1)
})
