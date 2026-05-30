// Diagnostic: can a REAL headless Chrome (via Playwright), through the proxy,
// reach the J4U API that raw-HTTP can't (Imperva tarpits the raw request)?
//
//   node scraper/pw-check.js
//
// Strategy: launch Chromium through J4U_PROXY_URL, inject SAFEWAY_SESSION as
// cookies, warm up on the homepage so Imperva issues its clearance, then fetch
// the J4U JSON from inside the page context (real Chrome TLS + cleared cookies).

import { chromium } from 'playwright'
import { parseProxy } from './j4u.js'

const J4U_URL =
  'https://www.safeway.com/abs/pub/xapi/pgmsearch/v1/search/products' +
  '?request-id=1&url=https://www.safeway.com&pageurl=https://www.safeway.com' +
  '&pagename=search&rows=30&start=0&search-type=keyword&storeid=788' +
  '&featured=true&q=Haagen-Dazs&sort=&timezone=America/Los_Angeles' +
  '&dvid=web-4.1search&channel=instore&includeOffer=true&banner=safeway&zipcode=94941'

// Turn a "k=v; k2=v2" Cookie header into Playwright cookie objects for safeway.com.
function cookiesFromHeader(header) {
  return String(header)
    .split(';')
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => {
      const i = p.indexOf('=')
      return { name: p.slice(0, i).trim(), value: p.slice(i + 1), domain: '.safeway.com', path: '/' }
    })
    .filter((c) => c.name && c.value)
}

const proxyRaw = process.env.J4U_PROXY_URL
const session = process.env.SAFEWAY_SESSION
console.log(proxyRaw ? '🔌 proxy set' : '⚠️  no proxy')
console.log(session ? `🍪 session present (${session.length} chars)` : '⚠️  no session')

const p = proxyRaw ? parseProxy(proxyRaw) : null
const launchProxy = p
  ? { server: `http://${p.hostname}:${p.port}`, username: p.username, password: p.password }
  : undefined

const t0 = Date.now()
const browser = await chromium.launch({ headless: true, proxy: launchProxy })
try {
  const ctx = await browser.newContext({
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
      '(KHTML, like Gecko) Chrome/124.0 Safari/537.36',
    locale: 'en-US',
  })
  if (session) await ctx.addCookies(cookiesFromHeader(session))

  const page = await ctx.newPage()

  // 1) Warm up: load the homepage so Imperva runs its JS challenge / sets clearance.
  console.log('→ warming up on safeway.com homepage…')
  const home = await page.goto('https://www.safeway.com/', {
    waitUntil: 'domcontentloaded',
    timeout: 60000,
  })
  console.log(`   homepage HTTP ${home?.status()} (${Date.now() - t0}ms)`)
  await page.waitForTimeout(3000) // let challenge scripts settle

  // 2) Navigate DIRECTLY to the API URL instead of fetch()-ing inside the page.
  // Safeway's Angular bundle monkey-patches window.fetch (the earlier "Failed
  // to fetch" came from THEIR clientlib, not the network), so page.goto uses
  // Chrome's real network stack + our cleared cookies and just renders the JSON.
  console.log('→ navigating directly to J4U API (real browser nav)…')
  try {
    const resp = await page.goto(J4U_URL, { waitUntil: 'domcontentloaded', timeout: 45000 })
    const status = resp?.status()
    const body = await resp.text()
    let docs = -1
    try {
      docs = JSON.parse(body)?.primaryProducts?.response?.docs?.length ?? -1
    } catch {}
    console.log(`   J4U API HTTP ${status} · ${body.length} bytes (${Date.now() - t0}ms)`)
    console.log(`   product docs found: ${docs}`)
    console.log(`   body head: ${body.slice(0, 200).replace(/\s+/g, ' ')}`)
  } catch (e) {
    console.log(`   ❌ J4U API nav: ${e.message} (${Date.now() - t0}ms)`)
  }
} catch (e) {
  console.log(`❌ ${e.message} (${Date.now() - t0}ms)`)
} finally {
  await browser.close()
}
