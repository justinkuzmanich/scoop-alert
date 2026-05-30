// J4U via a real headless browser (Playwright).
//
// Safeway's J4U product API sits behind Imperva, which tarpits raw-HTTP
// requests (even through a residential proxy) and requests made "out of
// context". The only reliable path is to drive the actual web app: load the
// search-results page so Safeway's own Angular code fires the pgmsearch XHR
// (correct headers, correct context), and intercept that response.
//
// Requires the SAFEWAY_SESSION cookie and, in CI, a residential proxy
// (J4U_PROXY_URL) plus an installed Chromium (npx playwright install chromium).
//
// Exported function returns an array of { query, json } for the caller to
// parse; it never throws — on any failure it returns what it has (possibly
// empty) so the pipeline falls back to Flipp.

import { chromium } from 'playwright'
import { parseProxy } from './j4u.js'

const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/124.0 Safari/537.36'

// "k=v; k2=v2" Cookie header → Playwright cookie objects scoped to safeway.com.
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

const SEARCH_PAGE = (q) =>
  `https://www.safeway.com/shop/search-results.html?q=${encodeURIComponent(q)}`

// Fetch raw J4U search JSON for each query at one store, driving the real UI.
// Returns [{ query, json }]; logs and returns partial/empty on failure.
export async function fetchJ4USearchJson({ store, queries, env = process.env }) {
  const session = env.SAFEWAY_SESSION
  if (!session) return []

  const proxyRaw = env.J4U_PROXY_URL
  let launchProxy
  if (proxyRaw) {
    const p = parseProxy(proxyRaw)
    launchProxy = { server: `http://${p.hostname}:${p.port}`, username: p.username, password: p.password }
  }

  let browser
  const out = []
  try {
    browser = await chromium.launch({ headless: true, proxy: launchProxy })
    const ctx = await browser.newContext({ userAgent: BROWSER_UA, locale: 'en-US' })

    await ctx.addCookies(cookiesFromHeader(session))
    // J4U is per-store; headless lands with no store selected, so pin this store
    // so the app searches against it instead of showing a store-picker.
    await ctx.addCookies([
      { name: 'storeId', value: String(store.locId), domain: '.safeway.com', path: '/' },
      { name: 'preferredStoreId', value: String(store.locId), domain: '.safeway.com', path: '/' },
    ])

    const page = await ctx.newPage()

    // Warm up so Imperva runs its JS challenge and issues clearance for the session.
    await page.goto('https://www.safeway.com/', { waitUntil: 'domcontentloaded', timeout: 60000 })
    await page.waitForTimeout(3000)

    for (const query of queries) {
      try {
        const waitForApi = page
          .waitForResponse(
            (r) => r.url().includes('/pgmsearch/') && r.request().method() === 'GET',
            { timeout: 45000 }
          )
          .then(async (r) => (r.ok() ? JSON.parse(await r.text()) : null))
          .catch(() => null)

        await page.goto(SEARCH_PAGE(query), { waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => {})
        const json = await waitForApi
        if (json) out.push({ query, json })
        else console.warn(`   ⚠️  J4U: no search response for "${query}" @ ${store.id}`)
        await page.waitForTimeout(750) // be gentle between searches
      } catch (err) {
        console.warn(`   ⚠️  J4U browser search "${query}" @ ${store.id} failed: ${err.message}`)
      }
    }
  } catch (err) {
    console.warn(`   ⚠️  J4U browser launch failed @ ${store.id}: ${err.message}`)
  } finally {
    if (browser) await browser.close().catch(() => {})
  }
  return out
}
