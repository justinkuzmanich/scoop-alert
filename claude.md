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
npm run test:email # TEST_ALERT=1: send ONE sample alert (no scrape, no file
                   # changes) to verify Resend delivery. Also exposed as the
                   # "test_email" toggle on the refresh-deals workflow_dispatch.
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
- [x] Pluggable email module (console fallback works; Resend wired in workflow)
- [x] Real data snapshot committed
- [x] Deployed to GitHub Pages (live link above)
- [x] **Daily auto-refresh** — `.github/workflows/refresh-deals.yml` runs
      `npm run scrape` on a daily cron (14:00 UTC) + manual dispatch, and commits
      the updated `deals.json` (re-triggers deploy). A failed scrape exits
      non-zero so no empty data is committed.
- [x] **"Check deals" button** (App.jsx) re-fetches `deals.json` (cache-busted)
      in place. NOTE: the static site can't run the scraper in-browser (no
      backend; Flipp is bot-walled + CORS), so this pulls the freshest committed
      file rather than scraping live.
- [x] **Email alerts (Resend) wired.** `notify.js` sends via Resend when
      `RESEND_API_KEY` is set; the refresh workflow passes it plus `ALERT_FROM`/
      `ALERT_TO` (vars, with sensible defaults) as env to the scrape step.
- [x] **State-diff bug fixed.** "Newly on sale" now diffs against the previously
      committed `public/data/deals.json` (read at the start of `run.js`), not the
      old gitignored `scraper/.state.json` — so CI only emails on genuinely new
      deals. `.state.json` and its gitignore entry are removed.
- [x] **Email alerts verified end-to-end.** `RESEND_API_KEY` secret added; a
      `TEST_ALERT` run delivered to the owner's inbox (landed in spam first —
      may need allow-listing / a verified `ALERT_FROM` domain for reliability).
- [~] **Safeway "for U" (J4U) personalized adapter — BUILT (read-only), needs a
      live session to finish.** `scraper/j4u.js` calls the real product-search
      endpoint and maps results into the existing deal shape; wired into `run.js`
      and merged with Flipp (lower price wins). See its own section below.

## Safeway "for U" (J4U) adapter — state & how it works
- **Endpoint (verified by capturing a logged-in request):**
  `GET https://www.safeway.com/abs/pub/xapi/pgmsearch/v1/search/products`
  `?q=<brand>&storeid=<locId>&includeOffer=true&banner=safeway&channel=instore&...`
- **Response shape:** products live in `primaryProducts.response.docs[]`. Each doc
  has `basePrice` (regular), `price` (member/Club-Card price ALREADY applied),
  `promoDescription`/`promoText`, `promoEndDate`, `upc`, `pid`, `aisleLocation`.
  So the lower member price is readable directly — no clip/compute needed.
  Parsing verified against a real captured doc.
- **Coupon tier (3rd, lowest price):** extra clippable coupons (e.g. "$4.48 ea")
  live in `offersData.upcs[<upc>].offers`. `j4u.js` reads them DEFENSIVELY:
  it only promotes a coupon to the headline `price` when it parses an
  unambiguous ABSOLUTE price below the member price; discount strings
  ("SAVE $1.00", "20% off") are noted in `dealText` but NEVER turned into a
  price (so a mis-parse can't show a wrong number). Field names are heuristic —
  VALIDATE against real `offersData` on the first authenticated run. Also tracks
  coupon expiry + clip status ("clip to activate" when unclipped).
- **Mapping:** `price`→price, `basePrice`→regularPrice, `promoDescription`→dealText,
  `promoEndDate`→validTo. `toDeals()` flags onSale when price < basePrice. In
  `run.js` we include only on-sale J4U items, merged with Flipp by name (lowest
  price wins). Disabled unless `SAFEWAY_SESSION` is set → zero impact otherwise.
- **Auth (the unfinished part):** send the logged-in **Cookie** header via the
  `SAFEWAY_SESSION` env/secret (+ optional `SAFEWAY_SUB_KEY` =
  `Ocp-Apim-Subscription-Key` if requests 401). DON'T store the password.
  On 401/403/timeout the adapter logs and returns [] → falls back to Flipp.
- **Two open risks to resolve with a real token:**
  1. **Imperva bot-wall** — sandbox fetches to this endpoint time out; it may also
     block GitHub Actions (datacenter IP). If so, run the J4U fetch locally
     (residential IP) and push, instead of in CI.
  2. **Session expiry** — the SSO token is short-lived (~45 min in older
     captures). A daily cron needs either a long-lived refresh token (the
     `refresh` XHR seen on the site) or manual re-capture. Design pending the
     real token's contents.
- **Next step:** owner captures the logged-in Cookie → store as `SAFEWAY_SESSION`
  secret → test a run to see if Imperva allows it from CI; pick runtime + expiry
  strategy from there. (Automating this is against Safeway ToS — personal use only.)

## Constraints / conventions
- Never commit secrets/tokens (`.env` is gitignored; use GitHub Actions secrets).
- Keep the scraper dependency-free (plain `fetch`) and ESM.
- The deal shape is: `{ id, brandId, name, price, regularPrice, onSale, dealText, validTo }`.
- Weekly-ad (flyer) items are treated as on-sale by definition (`fromFlyer`).
