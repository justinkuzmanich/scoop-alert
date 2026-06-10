// J4U via a real, VISIBLE browser on your own machine (Playwright).
//
// This is the "local" counterpart to j4u-browser.js (which runs headless in
// CI behind a residential proxy). Running on your own desktop sidesteps the two
// walls that blocked the CI path:
//
//   1. No Imperva fight  — your home IP isn't a datacenter IP, so there's no
//      residential proxy / KYC needed.
//   2. No "store not selected" problem — instead of guessing store cookies, you
//      log in and pick the Mill Valley store ONCE in a visible browser. We use a
//      PERSISTENT profile (a real user-data dir on disk), so that login and store
//      selection stick across runs. The real Safeway app then fires its own
//      pgmsearch XHR exactly as it would for a human, and we intercept it.
//
// Two entry points:
//   loginJ4U()              — opens the browser for the one-time setup login.
//   fetchJ4USearchJsonLocal — reuses the saved profile to run searches silently.
//
// The profile dir holds your live Safeway session — it's gitignored and must
// never be committed. Automating Safeway is against their ToS; personal use only.

import { chromium } from 'playwright'
import { createInterface } from 'node:readline'
import { join } from 'node:path'

// Where the persistent Chrome profile (cookies, store selection, login) lives.
// Override with J4U_PROFILE_DIR. Gitignored — see .gitignore.
export function profileDir(env = process.env) {
  return env.J4U_PROFILE_DIR || join(process.cwd(), '.j4u-profile')
}

const SEARCH_PAGE = (q) =>
  `https://www.safeway.com/shop/search-results.html?q=${encodeURIComponent(q)}`

// Launch the persistent profile in the user's REAL installed Chrome when
// possible. Imperva blocks Playwright's bundled Chromium even from a home IP
// ("Access denied / Error 15") because it fingerprints the automation build;
// real Chrome with the automation flags suppressed passes like a normal
// browser. Falls back to bundled Chromium if Chrome isn't installed.
async function launchProfile(dir, { headless }) {
  const opts = {
    headless,
    viewport: null, // use the real window size
    args: ['--start-maximized', '--disable-blink-features=AutomationControlled'],
    ignoreDefaultArgs: ['--enable-automation'],
  }
  try {
    return await chromium.launchPersistentContext(dir, { ...opts, channel: 'chrome' })
  } catch {
    return await chromium.launchPersistentContext(dir, opts)
  }
}

// Block until the user presses Enter in the terminal.
function waitForEnter(prompt) {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout })
    rl.question(prompt, () => {
      rl.close()
      resolve()
    })
  })
}

// One-time setup: open a visible browser to Safeway so you can log in and pick
// the Mill Valley store. Everything is saved into the persistent profile, so
// later fetch runs start already-authenticated with the store selected.
export async function loginJ4U(env = process.env) {
  const dir = profileDir(env)
  console.log(`\n🌐 Opening Safeway in a real browser…`)
  console.log(`   Profile: ${dir}`)
  const ctx = await launchProfile(dir, { headless: false })
  try {
    const page = ctx.pages()[0] || (await ctx.newPage())
    await page.goto('https://www.safeway.com/', { waitUntil: 'domcontentloaded', timeout: 60000 })
    console.log('\n👉 In the browser window:')
    console.log('   1. Sign in to your Safeway account.')
    console.log('   2. Set your store to the Mill Valley store you want (Camino Alto / Strawberry).')
    console.log('   3. Make sure you can see prices on a product page.')
    await waitForEnter('\n   When done, come back here and press Enter to save the session… ')
    console.log('✓ Session saved to the profile. You can now run: npm run scrape:local')
  } finally {
    await ctx.close().catch(() => {})
  }
}

// Fetch raw J4U search JSON for each query at one store, reusing the saved
// profile (logged in + store selected). Returns [{ query, json }]; logs and
// returns partial/empty on failure so the pipeline falls back to Flipp.
//
// `headful` (default true) shows the browser; set J4U_HEADLESS=1 to hide it once
// you trust the run. We drive the REAL search page so Safeway's own code fires
// the pgmsearch XHR, and we intercept that response.
export async function fetchJ4USearchJsonLocal({ store, queries, env = process.env }) {
  const dir = profileDir(env)
  const ctx = await launchProfile(dir, { headless: env.J4U_HEADLESS === '1' })
  const out = []
  try {
    const page = ctx.pages()[0] || (await ctx.newPage())

    // Warm up the homepage so any Imperva clearance / app bootstrap happens once.
    await page.goto('https://www.safeway.com/', { waitUntil: 'domcontentloaded', timeout: 60000 })
    await page.waitForTimeout(2000)

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
        if (json) {
          out.push({ query, json })
        } else {
          console.warn(`   ⚠️  J4U: no search response for "${query}" @ ${store.id}.`)
          console.warn(`       If this keeps happening, run "npm run j4u:login" to refresh your session/store.`)
        }
        await page.waitForTimeout(750) // be gentle between searches
      } catch (err) {
        console.warn(`   ⚠️  J4U local search "${query}" @ ${store.id} failed: ${err.message}`)
      }
    }
  } catch (err) {
    console.warn(`   ⚠️  J4U local browser failed @ ${store.id}: ${err.message}`)
  } finally {
    await ctx.close().catch(() => {})
  }
  return out
}
