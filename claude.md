# Scoop Alert — Project Memory (CLAUDE.md)

> Read this first. It captures the full state of the project so a fresh session
> can continue without losing context.

## What this is
A web app that tracks when **Häagen-Dazs** and **Ben & Jerry's** ice cream go on
sale at the **Safeway in Mill Valley (Marin County, CA)**, with email alerts when
they do. Built for personal use by the repo owner.

- **Live site:** https://justinkuzmanich.github.io/scoop-alert/
- **Repo:** https://github.com/justinkuzmanich/scoop-alert
- **Design vibe:** fun + modern (bouncing cone, pink/cream gradients, playful
  fonts). Keep it playful; this is intentional.

## Tech stack
- **React 18 + Vite** (web app)
- **Node (ESM) scraper** — plain `fetch`, no framework
- **GitHub Pages** for hosting, **GitHub Actions** for build/deploy + scheduled refresh
- No backend server; the web app reads a static `public/data/deals.json`

## How it works (data flow)
```
Flipp API ──(scraper/run.js)──> public/data/deals.json ──(web app reads)──> UI
                                         ▲
                          GitHub Action (daily) refreshes & commits it
```

### Data source: Flipp (IMPORTANT)
Safeway has **no public API**, and `safeway.com` itself is behind an **Imperva
bot-wall (HTTP 403)** — do NOT try to scrape safeway.com directly; it will fail.
Instead we use **Flipp** (`backflipp.wishabi.com`), which syndicates Safeway's
weekly ad as clean JSON with no bot-wall and **no API key needed** on an open
network (works on GitHub Actions runners; does NOT work from sandboxes with a
network allowlist).

Endpoints used (`scraper/flipp.js`):
- `GET /flipp/flyers?locale=en-us&postal_code=94941` → find the current Safeway flyer
- `GET /flipp/flyers/<flyer_id>?locale=en-us&postal_code=94941` → that flyer's items

Notes / gotchas learned the hard way:
- The Flipp **item-search** endpoint (`/flipp/items/search?q=`) is INCOMPLETE —
  it misses some Safeway items. Always use the **flyer-detail** endpoint to get
  the full item list.
- Safeway's weekly ad is **regional, keyed by postal code** — both Mill Valley
  stores (94941) share the same flyer. The two-store selector shows the same
  deals under each; per-store digital coupons are NOT in this public source.
- Brand matching is by **name substring** (see `BRANDS` in `src/data/config.js`),
  because items may say "Gelato"/"Bars"/etc., not "ice cream". e.g. the current
  real deal is "Haagen-Dazs Gelato 14-oz. 4-ct." $5.99.
- When using LLM extraction on scraped pages, VERIFY against raw output — models
  will fabricate plausible product/price data if the page is blocked. Trust only
  HTTP 200 + real JSON.

## Stores & brands (`src/data/config.js`)
- Stores: Camino Alto (`locId 788`) and Strawberry Village (`locId 2718`), both
  `postalCode: '94941'`. `locId` is the safeway.com store number (kept for
  reference / future per-store work); the Flipp source uses `postalCode`.
- Brands: `haagen-dazs` and `ben-jerrys`, each with `match` substrings, emoji, color.

## File map
```
src/
  main.jsx, App.jsx, index.css
  data/config.js          STORES + BRANDS (shared with scraper)
  lib/deals.js            load + format helpers (fetches BASE_URL + data/deals.json)
  components/             StatusBanner, BrandSection, DealCard, AlertSignup
scraper/
  flipp.js                Flipp data source (direct fetch; optional Firecrawl routing)
  match.js                brand matching + sale detection (flyer items => onSale)
  notify.js               pluggable email sender (Resend or console dry-run)
  run.js                  orchestrator: fetch -> diff -> write deals.json -> alert
public/data/deals.json    data the web app reads (real snapshot committed)
.github/workflows/        deploy.yml (Pages), refresh-deals.yml (daily scrape)
```

## Commands
```bash
npm install
npm run dev        # local dev server
npm run build      # production build -> dist/
npm run scrape     # fetch live Safeway weekly ad, rewrite public/data/deals.json
npm run scrape:dry # same but DRY_RUN=1 (print emails instead of sending)
```

## Deployment
- **Pages build/deploy:** `.github/workflows/deploy.yml` builds on push to `main`
  and deploys `dist/` to Pages. Pages "Source" is set to **GitHub Actions**.
- Vite `base: './'` (relative asset paths) so it works under the
  `/scoop-alert/` subpath — do not change without testing on Pages.
- `deals.json` is fetched via `import.meta.env.BASE_URL + 'data/deals.json'`.

## Status — DONE
- [x] Web app (UI, store selector, brand sections, sale badges, alert signup)
- [x] Flipp scraper + brand matching + sale detection
- [x] Pluggable email module (console fallback works; provider not wired)
- [x] Real data snapshot committed
- [x] Deployed to GitHub Pages (live link above)

## Status — TODO (in priority order)
1. **Daily auto-refresh** — `.github/workflows/refresh-deals.yml` runs
   `npm run scrape` on a cron and commits the updated `deals.json` (which
   re-triggers deploy). May already be added; verify it exists and the run is green.
2. **Email alerts (Resend).** Wire `scraper/notify.js` to a real provider.
   - Add repo **secrets**: `RESEND_API_KEY`, and vars `ALERT_FROM`, `ALERT_TO`.
   - Pass them into the refresh workflow's `npm run scrape` step as env.
   - **State bug to fix:** "newly on sale" is currently diffed against
     `scraper/.state.json`, which is gitignored and therefore absent on each CI
     run → it would email every run. Fix by diffing against the previously
     committed `deals.json` (or commit a small state file). Do this when wiring email.
3. **Safeway "for U" (J4U) coupon adapter** — owner HAS a Safeway login and wants
   personalized coupons (richer than the public weekly ad).
   - API family: `https://www.safeway.com/abs/pub/web/j4u/api/offers/...` (returns
     JSON when authenticated; sits behind login + Imperva).
   - Approach: DON'T store the password. Capture the logged-in **session
     token/cookie** from the browser, store as secret `SAFEWAY_SESSION`, call the
     J4U API with it. Token expires → design for refresh/expiry.
   - Build as a second adapter beside `flipp.js`; map offers into the same deal
     shape so UI/alerts work unchanged. Keep tokens out of the repo. (Automating
     this is against Safeway ToS — fine for personal use; keep it personal.)

## Constraints / conventions
- Never commit secrets/tokens (`.env` is gitignored; use GitHub Actions secrets).
- Keep the scraper dependency-free (plain `fetch`) and ESM.
- The deal shape is: `{ id, brandId, name, price, regularPrice, onSale, dealText, validTo }`.
- Weekly-ad (flyer) items are treated as on-sale by definition (`fromFlyer`).
