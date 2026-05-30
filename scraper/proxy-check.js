// One-off diagnostic: is the J4U_PROXY_URL proxy working, and is safeway.com
// specifically gated? Hits several targets through the proxy and prints the
// outcome for each. Not part of the pipeline — run via the proxy-check workflow.
//
//   node scraper/proxy-check.js
//
// Reads J4U_PROXY_URL (and SAFEWAY_SESSION) from the environment.

import https from 'node:https'
import zlib from 'node:zlib'
import { makeProxyAgent } from './j4u.js'

const cleanHeader = (v) =>
  typeof v === 'string' ? v.replace(/[\r\n\t]+/g, ' ').replace(/[^\x20-\x7E]/g, '').trim() : v

// The real J4U search endpoint (same one the scraper uses), pointed at the
// Camino Alto store (locId 788, zip 94941 per config), so we test the actual
// heavy authenticated call — not just robots.txt.
const J4U_URL =
  'https://www.safeway.com/abs/pub/xapi/pgmsearch/v1/search/products' +
  '?request-id=1&url=https://www.safeway.com&pageurl=https://www.safeway.com' +
  '&pagename=search&rows=30&start=0&search-type=keyword&storeid=788' +
  '&featured=true&q=Haagen-Dazs&sort=&timezone=America/Los_Angeles' +
  '&dvid=web-4.1search&channel=instore&includeOffer=true&banner=safeway&zipcode=94941'

function probe(url, agent, { timeoutMs = 25000, cookie } = {}) {
  return new Promise((resolve) => {
    const t0 = Date.now()
    const headers = {
      Accept: 'application/json, text/plain, */*',
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
        '(KHTML, like Gecko) Chrome/124.0 Safari/537.36',
      'Accept-Encoding': 'gzip, deflate, br',
    }
    if (cookie) {
      headers.Cookie = cleanHeader(cookie)
      headers.Referer = 'https://www.safeway.com/shop/search-results.html'
      headers.Origin = 'https://www.safeway.com'
    }
    const req = https.request(
      url,
      { method: 'GET', agent: agent || undefined, timeout: timeoutMs, headers },
      (res) => {
        const enc = String(res.headers['content-encoding'] || '').toLowerCase()
        let s = res
        if (enc === 'gzip') s = res.pipe(zlib.createGunzip())
        else if (enc === 'deflate') s = res.pipe(zlib.createInflate())
        else if (enc === 'br') s = res.pipe(zlib.createBrotliDecompress())
        const chunks = []
        s.on('data', (c) => chunks.push(c))
        s.on('end', () =>
          resolve({
            url,
            status: res.statusCode,
            ms: Date.now() - t0,
            bytes: Buffer.concat(chunks).length,
          })
        )
        s.on('error', (e) => resolve({ url, error: 'decode: ' + e.message, ms: Date.now() - t0 }))
      }
    )
    req.on('error', (e) => resolve({ url, error: e.message, ms: Date.now() - t0 }))
    req.on('timeout', () => req.destroy(new Error(`timeout after ${timeoutMs}ms`)))
    req.end()
  })
}

const proxy = process.env.J4U_PROXY_URL
const cookie = process.env.SAFEWAY_SESSION
console.log(proxy ? '🔌 Using proxy from J4U_PROXY_URL' : '⚠️  No J4U_PROXY_URL set — going direct')
console.log(cookie ? `🍪 SAFEWAY_SESSION present (${cookie.length} chars)` : '⚠️  No SAFEWAY_SESSION')
const agent = makeProxyAgent(proxy)

const show = (label, r) => {
  if (r.error) console.log(`❌ ${label}\n     ${r.error} (${r.ms}ms)`)
  else console.log(`✅ ${label}\n     HTTP ${r.status} (${r.ms}ms) · ${r.bytes} bytes`)
}

// 1) sanity: trivial safeway path (we know this works)
show('safeway.com/robots.txt', await probe('https://www.safeway.com/robots.txt', agent, { timeoutMs: 25000 }))

// 2) the real J4U API, no cookie — does the endpoint itself respond in time?
show('J4U API (no cookie)', await probe(J4U_URL, agent, { timeoutMs: 60000 }))

// 3) the real J4U API, WITH cookie, generous 60s — the actual scraper call
show('J4U API (+cookie, 60s)', await probe(J4U_URL, agent, { timeoutMs: 60000, cookie }))
