# Next Steps — Scoop Alert

Handoff notes for the next session.

## Current state
- Standalone `scoop-alert` repo (this repo). Web app (React+Vite) + scraper
  (`scraper/flipp.js`, `run.js`) + pluggable email (`notify.js`) all working.
- **Primary data source: Flipp** (`backflipp.wishabi.com`) — Safeway's regional
  weekly ad for ZIP 94941, no key needed on a normal network. (`safeway.com`
  itself is Imperva bot-walled — see J4U notes below.)
- Daily refresh runs via `.github/workflows/refresh-deals.yml` (cron + manual),
  committing `public/data/deals.json`; Resend email alerts wired in `notify.js`.
- **J4U (Safeway "for U") member deals: built but dormant**, fails safe to Flipp.
  See section 2 below for exactly where it stands and how to resume.

## TODO

### Done since earlier handoffs
- ✅ Moved to its own `scoop-alert` repo.
- ✅ GitHub Actions daily cron runs `npm run scrape` + commits `deals.json`.
- ✅ Resend wired up in `notify.js` for real alert emails.

### Safeway "for U" personalized member deals (J4U) — ATTEMPTED, PARKED

Goal: fold each store's personalized member/coupon pricing (richer than the
public weekly ad) into the same deal shape as Flipp.

**Status: built but dormant.** The adapter (`scraper/j4u.js` +
`scraper/j4u-browser.js`) is wired in and *fails safe* — on any problem it logs
a warning and returns `[]`, so the pipeline always falls back to Flipp. It is
enabled only when the `SAFEWAY_SESSION` secret is set. The site and email
alerts run entirely on Flipp today; J4U currently contributes nothing.

**What works (verified):**
- Residential proxy (IPRoyal, `J4U_PROXY_URL` secret) — reaches `safeway.com`
  after completing IPRoyal identity verification (KYC). Required because GitHub
  Actions datacenter IPs are blocked by Imperva.
- Headless Chrome (Playwright) launches through the proxy and loads the Safeway
  homepage (HTTP 200), clearing Imperva's JS challenge.
- The whole CI pipeline: Chromium install, scrape, safe Flipp fallback.

**The wall we stopped at:** Safeway's Angular app never fires its product-search
XHR (`/abs/pub/xapi/pgmsearch/...`) in headless Chrome, so there's no JSON to
intercept. Symptom in logs: `⚠️ J4U: no search response for "<brand>"`.
- Ruled out: raw HTTP (Imperva tarpits it — 60s hang even with a cookie);
  direct `page.goto` to the API URL (navigate-mode is tarpitted); in-page
  `fetch` (Safeway monkey-patches `window.fetch`).
- Leading hypothesis: **the store isn't actually "selected" in the app's eyes.**
  J4U is per-store; pinning `storeId`/`preferredStoreId` cookies (a guess) wasn't
  enough. The real app sets the store via a specific flow — likely a `pem_jwe`
  (JWT-ish) cookie and/or an API call triggered by choosing a store in the UI.

**To resume (in rough order):**
1. With a real logged-in browser, pick the Mill Valley store, then dump ALL
   safeway.com cookies + the exact requests fired on store selection (devtools
   → Network). Replicate those cookies/calls in `j4u-browser.js` before loading
   the search page.
2. If cookies alone don't do it, drive the store-picker UI by clicking
   (Playwright) instead of pre-seeding cookies.
3. Confirm the `pgmsearch` XHR then fires and returns `primaryProducts.response.docs`.

**Cheaper alternative:** run `j4u-browser.js` on a personal machine (real
logged-in Chrome, home IP — no Imperva fight, no proxy/KYC) on demand and commit
the resulting data. Sidesteps the entire CI bot-wall problem; semi-manual.

**Notes:** `SAFEWAY_SESSION` (the logged-in Cookie header) expires and must be
re-captured periodically. Never commit it — it's a GitHub secret. Automating
Safeway is against their ToS; keep it personal-use only.
