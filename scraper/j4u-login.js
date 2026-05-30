// One-time setup for local J4U scraping.
//
// Opens a real, visible browser to Safeway so you can log in and pick your Mill
// Valley store. The session is saved into a persistent profile on disk (see
// j4u-browser-local.js), so later `npm run scrape:local` runs start already
// authenticated with the store selected — no cookie copying required.
//
//   npm run j4u:login
//
// Re-run this whenever your Safeway session expires and scrape:local stops
// finding member deals.

import { loginJ4U } from './j4u-browser-local.js'

loginJ4U().catch((err) => {
  console.error('✗ J4U login failed:', err.message)
  process.exit(1)
})
