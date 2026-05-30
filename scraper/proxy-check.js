// One-off diagnostic: is the J4U_PROXY_URL proxy working, and is safeway.com
// specifically gated? Hits several targets through the proxy and prints the
// outcome for each. Not part of the pipeline — run via the proxy-check workflow.
//
//   node scraper/proxy-check.js
//
// Reads J4U_PROXY_URL from the environment (same secret the scraper uses).

import https from 'node:https'
import { makeProxyAgent } from './j4u.js'

const TARGETS = [
  'https://ipv4.icanhazip.com', // trivial, always-allowed echo
  'https://example.com', // generic allowed site
  'https://www.safeway.com/robots.txt', // our real target (small path)
]

function probe(url, agent) {
  return new Promise((resolve) => {
    const t0 = Date.now()
    const req = https.request(
      url,
      { method: 'GET', agent: agent || undefined, timeout: 25000 },
      (res) => {
        let body = ''
        res.on('data', (c) => (body += c.length < 1 ? '' : c))
        res.on('end', () =>
          resolve({
            url,
            status: res.statusCode,
            ms: Date.now() - t0,
            sample: String(body).replace(/\s+/g, ' ').trim().slice(0, 60),
          })
        )
        res.resume()
      }
    )
    req.on('error', (e) => resolve({ url, error: e.message, ms: Date.now() - t0 }))
    req.on('timeout', () => req.destroy(new Error('timeout')))
    req.end()
  })
}

const proxy = process.env.J4U_PROXY_URL
console.log(proxy ? '🔌 Using proxy from J4U_PROXY_URL' : '⚠️  No J4U_PROXY_URL set — going direct')
const agent = makeProxyAgent(proxy)

for (const url of TARGETS) {
  const r = await probe(url, agent)
  if (r.error) console.log(`❌ ${url}\n     ${r.error} (${r.ms}ms)`)
  else console.log(`✅ ${url}\n     HTTP ${r.status} (${r.ms}ms) ${r.sample ? '· ' + r.sample : ''}`)
}
