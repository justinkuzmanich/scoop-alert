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

### Safeway "for U" personalized member deals (J4U)

Goal: fold each store's personalized member/coupon pricing (richer than the
public weekly ad) into the same deal shape as Flipp.

**Two paths, both fail safe (any problem → logs a warning, returns `[]`, falls
back to Flipp). The site/cron run on Flipp; J4U only adds to it.**

**A) LOCAL — built, ready to use (recommended).** Run on your own machine, where
there's no Imperva fight (home IP) and you sign in once in a real browser:
- `npm run j4u:login` — one time: opens a visible browser, you sign in + pick the
  Mill Valley store, press Enter. Saves a logged-in Chrome profile to
  `.j4u-profile/` (gitignored — holds a live session, never commit).
- `npm run scrape:local` — reuses that profile, drives Safeway's real search page
  so the app fires its own `pgmsearch` XHR, intercepts it, merges member deals
  into `deals.json`. Re-run `j4u:login` when the session expires.
- Files: `scraper/j4u-browser-local.js` (headed persistent-profile browser) +
  `scraper/j4u-login.js` (the setup entry). Enabled by `J4U_LOCAL=1`.
- This is the path that sidesteps BOTH walls below (datacenter IP + store not
  selected), because it's a real logged-in browser on a home IP.
- Still TODO on this path: actually run it on Justin's desktop and verify the
  `pgmsearch` JSON parses into real member prices; tighten coupon-field parsing
  in `j4u.js` against the first real response (see the DEFENSIVE note there).

**B) HEADLESS / CI — built but dormant, blocked.** The adapter (`scraper/j4u.js`
+ `scraper/j4u-browser.js`) runs headless behind a residential proxy, enabled by
the `SAFEWAY_SESSION` secret. Contributes nothing today — it hits the wall below.

**What works on the CI path (verified):**
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

**Why the CI path is blocked → use path A.** The local path (A) was built
*because* of this wall: a real logged-in browser on a home IP both selects the
store properly and dodges Imperva, so the `pgmsearch` XHR fires. If you ever want
to revive the headless/CI path, the open task is replicating the store-selection
flow (dump the cookies/requests fired when picking a store in a real browser and
replay them in `j4u-browser.js`, or drive the store-picker UI by clicking).

**Notes:** the IPRoyal residential proxy (~1 GB, ~$7) bought for the CI path is
unused while path A is the plan — consider refunding. `SAFEWAY_SESSION` (the CI
path's cookie) expires and is a GitHub secret — never commit it. Path A's
`.j4u-profile/` likewise holds a live session and is gitignored. Automating
Safeway is against their ToS; keep it personal-use only.
