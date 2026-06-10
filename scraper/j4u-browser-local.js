// J4U via your OWN real Chrome on your own machine.
//
// Background: Safeway sits behind Imperva, which blocks not just datacenter IPs
// but any *automation-controlled* browser — Playwright launching Chrome (even
// the real Chrome binary, even from a home IP) gets "Access denied / Error 15".
// Your everyday Chrome works because nothing is driving it.
//
// So instead of launching a browser, we launch your real Chrome as an ORDINARY
// process (with a remote-debugging port, no automation flags) and ATTACH to it
// over CDP. Imperva sees a normal Chrome; once it clears the Imperva challenge,
// the clearance cookie rides in the dedicated profile for later runs.
//
// A dedicated user-data dir (.j4u-chrome, gitignored) keeps this separate from
// your personal Chrome profile and persists the Safeway login + store choice.
//
// Entry points:
//   loginJ4U()              — opens Chrome so you log in + pick the store once.
//   fetchJ4USearchJsonLocal — attaches, runs the searches, intercepts the JSON.
//
// Automating Safeway is against their ToS; personal use only.

import { chromium } from 'playwright'
import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

const DEBUG_PORT = 9222

// Dedicated Chrome profile dir (login + store selection persist here).
// Override with J4U_PROFILE_DIR. Gitignored — see .gitignore.
export function profileDir(env = process.env) {
  return env.J4U_PROFILE_DIR || join(process.cwd(), '.j4u-chrome')
}

const SEARCH_PAGE = (q) =>
  `https://www.safeway.com/shop/search-results.html?q=${encodeURIComponent(q)}`

// Locate the installed Chrome executable across platforms. Override with
// J4U_CHROME_PATH if Chrome lives somewhere unusual.
function chromePath(env = process.env) {
  if (env.J4U_CHROME_PATH && existsSync(env.J4U_CHROME_PATH)) return env.J4U_CHROME_PATH
  const candidates =
    process.platform === 'win32'
      ? [
          'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
          'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
          join(env.LOCALAPPDATA || '', 'Google\\Chrome\\Application\\chrome.exe'),
        ]
      : process.platform === 'darwin'
        ? ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome']
        : ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium-browser']
  return candidates.find((p) => p && existsSync(p)) || null
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

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

// Spawn real Chrome as a normal browser with a debugging port, then attach over
// CDP. Returns { browser, context, page, kill }. `headless` uses Chrome's own
// headless mode (still a real Chrome, not Playwright's Chromium).
async function openRealChrome(env = process.env, { headless = false } = {}) {
  const exe = chromePath(env)
  if (!exe) {
    throw new Error(
      'Google Chrome not found. Install Chrome, or set J4U_CHROME_PATH to chrome.exe.'
    )
  }
  const dir = profileDir(env)
  const args = [
    `--remote-debugging-port=${DEBUG_PORT}`,
    `--user-data-dir=${dir}`,
    '--no-first-run',
    '--no-default-browser-check',
    'https://www.safeway.com/',
  ]
  if (headless) args.unshift('--headless=new')

  const proc = spawn(exe, args, { detached: false, stdio: 'ignore' })
  const kill = () => {
    try {
      proc.kill()
    } catch {
      /* already gone */
    }
  }

  // Wait for the debugging endpoint, then attach.
  let browser
  for (let i = 0; i < 30; i++) {
    try {
      browser = await chromium.connectOverCDP(`http://127.0.0.1:${DEBUG_PORT}`)
      break
    } catch {
      await sleep(500)
    }
  }
  if (!browser) {
    kill()
    throw new Error('Could not attach to Chrome on the debugging port.')
  }
  const context = browser.contexts()[0]
  const page = context.pages()[0] || (await context.newPage())
  return { browser, context, page, kill }
}

// One-time setup: open Chrome so you can log in and pick the Mill Valley store.
// The dedicated profile persists it, so later fetch runs start authenticated.
export async function loginJ4U(env = process.env) {
  console.log(`\n🌐 Launching your real Chrome (profile: ${profileDir(env)})…`)
  const { page, browser, kill } = await openRealChrome(env, { headless: false })
  try {
    await page.goto('https://www.safeway.com/', { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {})
    console.log('\n👉 In the Chrome window that opened:')
    console.log('   1. Sign in to your Safeway account.')
    console.log('   2. Set your store to the Mill Valley store you want (Camino Alto / Strawberry).')
    console.log('   3. Make sure you can see prices on a product page.')
    await waitForEnter('\n   When done, come back here and press Enter to save the session… ')
    console.log('✓ Session saved. You can now run: npm run scrape:local')
  } finally {
    await browser.close().catch(() => {})
    kill()
  }
}

// Fetch raw J4U search JSON for each query at one store by driving your real,
// already-logged-in Chrome. Returns [{ query, json }]; logs and returns
// partial/empty on failure so the pipeline falls back to Flipp.
export async function fetchJ4USearchJsonLocal({ store, queries, env = process.env }) {
  const out = []
  let browser, kill
  try {
    ;({ browser, kill } = await openRealChrome(env, { headless: env.J4U_HEADLESS === '1' }))
    const context = browser.contexts()[0]
    const page = context.pages()[0] || (await context.newPage())

    // Warm up so Imperva runs its challenge and issues clearance for the session.
    await page.goto('https://www.safeway.com/', { waitUntil: 'domcontentloaded', timeout: 60000 })
    await page.waitForTimeout(2500)

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
    if (browser) await browser.close().catch(() => {})
    if (kill) kill()
  }
  return out
}
