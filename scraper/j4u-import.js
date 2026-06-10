// Import Safeway "for U" member deals captured by YOUR OWN browser.
//
// Why: Safeway's Imperva bot-wall blocks any automated browser, even your real
// Chrome driven by a script, even from your home IP. But your everyday,
// hand-driven Chrome passes fine. So we let your browser do the fetch (it's
// logged in and trusted) and just hand the JSON to this importer.
//
// Flow:
//   1. In your normal Chrome, logged in to safeway.com with your Mill Valley
//      store selected, paste the capture snippet (see README "Member deals
//      (manual capture)") into the DevTools console.
//   2. Do the two searches it asks for; it downloads `j4u-capture.json`.
//   3. Run:  npm run j4u:import  path\to\j4u-capture.json
//      (defaults to ./j4u-capture.json and ~/Downloads/j4u-capture.json)
//
// This parses the captured pgmsearch responses with the same battle-tested
// parser the automated path used (scraper/j4u.js), folds the on-sale member
// deals into public/data/deals.json (merging with the weekly-ad deals, keeping
// the lower price), and leaves it staged for you to commit/push.

import { readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { homedir } from 'node:os'
import { STORES } from '../src/data/config.js'
import { parseJ4USearch } from './j4u.js'
import { toDeals } from './match.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')
const DEALS_OUT = join(ROOT, 'public', 'data', 'deals.json')

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

// Pull the array of pgmsearch JSON blobs out of whatever the snippet saved.
// Accepts: { responses: [{ json }] } | [{ json }] | [json] | a single json.
function captureToJsonList(capture) {
  if (Array.isArray(capture)) {
    return capture.map((e) => (e && e.json ? e.json : e)).filter(Boolean)
  }
  if (capture && Array.isArray(capture.responses)) {
    return capture.responses.map((e) => (e && e.json ? e.json : e)).filter(Boolean)
  }
  if (capture && capture.primaryProducts) return [capture] // a lone response
  return []
}

function resolveCapturePath(argPath) {
  const candidates = [
    argPath,
    join(process.cwd(), 'j4u-capture.json'),
    join(ROOT, 'j4u-capture.json'),
    join(homedir(), 'Downloads', 'j4u-capture.json'),
  ].filter(Boolean)
  return candidates.find((p) => existsSync(p)) || null
}

async function readJson(path, fallback) {
  try {
    return JSON.parse(await readFile(path, 'utf8'))
  } catch {
    return fallback
  }
}

async function main() {
  const capturePath = resolveCapturePath(process.argv[2])
  if (!capturePath) {
    console.error(
      '✗ No capture file found. Pass the path, e.g.\n' +
        '    npm run j4u:import C:\\Users\\You\\Downloads\\j4u-capture.json'
    )
    process.exit(1)
  }
  console.log(`📥 Importing member deals from ${capturePath}`)

  const capture = await readJson(capturePath, null)
  const jsonList = captureToJsonList(capture)
  if (!jsonList.length) {
    console.error('✗ Capture file had no recognizable pgmsearch responses.')
    process.exit(1)
  }

  // Parse + normalize to on-sale member deals (de-duped by product).
  const rawProducts = jsonList.flatMap((j) => parseJ4USearch(j))
  const memberDeals = toDeals(rawProducts).filter((d) => d.onSale)
  console.log(
    `   Parsed ${rawProducts.length} product(s) → ${memberDeals.length} on-sale member deal(s).`
  )
  if (!memberDeals.length) {
    console.warn('   Nothing on sale in the capture — leaving deals.json unchanged.')
    return
  }
  for (const d of memberDeals) {
    console.log(`     • ${d.name}: ${d.price != null ? '$' + d.price.toFixed(2) : '?'} ${d.dealText ? '— ' + d.dealText : ''}`)
  }

  // Member pricing is per-store/account; both Mill Valley stores share it, so
  // fold the captured deals into every configured store, keeping the lower price.
  const deals = await readJson(DEALS_OUT, { isSample: false, stores: [] })
  const byId = new Map((deals.stores || []).map((s) => [s.id, s]))
  for (const store of STORES) {
    const s =
      byId.get(store.id) ||
      { id: store.id, name: store.name, address: store.address, deals: [] }
    s.deals = mergeDeals(s.deals || [], memberDeals)
    byId.set(store.id, s)
  }
  deals.stores = STORES.map((s) => byId.get(s.id))
  deals.isSample = false
  deals.checkedAt = new Date().toISOString()

  await writeFile(DEALS_OUT, JSON.stringify(deals, null, 2))
  console.log(`\n✓ Updated ${DEALS_OUT}`)
  console.log('  Next: commit & push so the live site updates:')
  console.log('    git add public/data/deals.json')
  console.log('    git commit -m "chore: add Safeway for-U member deals"')
  console.log('    git push')
}

main().catch((err) => {
  console.error('✗ Import failed:', err.message)
  process.exit(1)
})
