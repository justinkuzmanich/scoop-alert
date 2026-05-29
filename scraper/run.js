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
import { toDeals } from './match.js'
import { notify } from './notify.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')
const DEALS_OUT = join(ROOT, 'public', 'data', 'deals.json')

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

  const storesOut = []

  for (const store of STORES) {
    const deals = toDeals(rawByPostal[store.postalCode])
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
