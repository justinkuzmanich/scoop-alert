// Cross-platform entry for the LOCAL J4U run (works on Windows, macOS, Linux).
//
// `J4U_LOCAL=1 node scraper/run.js` only works on Unix shells; Windows doesn't
// understand the inline env-var prefix. So we set the flag here in Node (which
// is portable) and then hand off to the normal orchestrator.
//
//   npm run scrape:local
//
// Fetches the Flipp weekly ad AND your personalized "for U" member deals (via a
// real browser using your saved profile — see scraper/j4u-browser-local.js),
// merges them, writes deals.json, and emails any newly on-sale items.

process.env.J4U_LOCAL = '1'
await import('./run.js')
