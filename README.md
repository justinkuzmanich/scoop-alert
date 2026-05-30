# 🍦 Scoop Alert

Tracks when **Häagen-Dazs** and **Ben & Jerry's** ice cream go on sale at the
**Safeway in Mill Valley (Marin County)** — and emails you when they do.

- **Web app** (React + Vite): a fun, modern dashboard showing each brand's
  current prices and which are on sale.
- **Scraper** (Node): pulls Safeway's ice cream aisle for the Mill Valley store,
  detects sales, and emails an alert when something newly drops in price.

> ⚠️ Not affiliated with Safeway. Prices come from Safeway's public shop pages.

---

## Quick start (web app)

```bash
cd icecream-deals
npm install
npm run dev
```

Open the printed URL. The app ships with clearly-labeled **SAMPLE DATA** so you
can see the UI immediately. Running the scraper replaces it with real data.

---

## How the data works (important)

Safeway has **no public API**, and its own site (`safeway.com`) is behind an
Imperva bot-wall that returns HTTP 403 to scrapers. So instead we use **Flipp**
(`backflipp.wishabi.com`), which syndicates Safeway's weekly ad as clean JSON
with no bot-wall.

Things to know:

1. **No API key needed on a normal network.** The scraper fetches Flipp
   directly. `FIRECRAWL_API_KEY` is only needed on network-restricted hosts.
2. **The weekly ad is regional**, keyed by **postal code**. Both Mill Valley
   Safeways (94941) share the same flyer deals, so the app shows the same deals
   under each store. Per-store digital ("for U") coupons are not available from
   this public source — only the weekly ad.
3. **Stores are pre-configured** in `src/data/config.js` (Camino Alto &
   Strawberry Village, both postal code `94941`). `locId` values (788, 2718) are
   kept for reference but the Flipp source uses `postalCode`.

Endpoints used:
- `GET /flipp/flyers?postal_code=94941` → find the current Safeway flyer
- `GET /flipp/flyers/<flyer_id>?postal_code=94941` → that flyer's items

---

## Running the scraper

```bash
cp .env.example .env   # optional: only needed for email or restricted networks
npm run scrape:dry     # fetch + write deals.json, print (don't send) emails
npm run scrape         # real run: sends email if a provider is configured
```

The scraper writes `public/data/deals.json` (what the web app reads) and tracks
state in `scraper/.state.json` so it only emails about *newly* on-sale items.

> Note: `deals.json` currently holds a **real snapshot** of the Mill Valley
> weekly ad (pulled 2026-05-29) — right now **Häagen-Dazs Gelato is $5.99** and
> there's no Ben & Jerry's deal. Run `npm run scrape` on an unrestricted network
> to refresh it.

---

## Personalized member deals (J4U) — run locally

The weekly ad (Flipp) is public. Safeway's **"for U"** member/coupon pricing is
per-account and lives behind a login + an Imperva bot-wall, so it can't run from
CI reliably. The reliable way is to run it **on your own machine**, where there's
no bot-wall fight and you can sign in once in a real browser.

It's a two-step, one of which is one-time:

```bash
npm run j4u:login    # ONE TIME: opens a real browser — sign in, pick your Mill
                     # Valley store, then press Enter. Session is saved locally.
npm run scrape:local # fetches Flipp + your for-U deals, merges, writes deals.json
```

How it works: `j4u:login` saves a logged-in Chrome profile to `.j4u-profile/`
(gitignored — it holds your live session, **never commit it**). `scrape:local`
reuses that profile, drives Safeway's real search page so the app fires its own
product query, and folds any on-sale member deals into the same `deals.json` the
web app reads. If anything fails (expired session, etc.) it logs a warning and
falls back to the Flipp weekly ad — it never breaks a run. If member deals stop
showing up, your session expired: re-run `npm run j4u:login`.

> Requires the browser binary once: `npx playwright install chromium`.
> Set `J4U_HEADLESS=1` to hide the browser window once you trust the run.
> Automating Safeway is against their ToS — keep this to personal use.

---

## Email alerts

Alerts are **pluggable** (`scraper/notify.js`). Out of the box:

- **No provider configured** → "console mode": the email is printed, not sent.
- **Resend** (recommended, easy free tier): set `RESEND_API_KEY`, `ALERT_FROM`,
  `ALERT_TO` in `.env`.

Adding another provider (SendGrid, SES, Gmail API, etc.) is a single function in
`notify.js`.

The web app's "Alert me" form currently just stores the address in the browser —
connect it to your mailing list/provider when you pick one.

---

## Automating the checks (later)

When you're ready to run checks automatically, a free option is a GitHub Actions
cron job that runs `npm run scrape` daily and commits the updated
`public/data/deals.json`. (Not set up yet — you chose "web app first".)

---

## Project layout

```
icecream-deals/
├── index.html
├── package.json
├── vite.config.js
├── .env.example
├── public/data/deals.json        # data the web app reads (sample until scraped)
├── src/
│   ├── main.jsx / App.jsx / index.css
│   ├── data/config.js            # STORES + BRANDS (shared with scraper)
│   ├── lib/deals.js              # load + format helpers
│   └── components/               # StatusBanner, BrandSection, DealCard, AlertSignup
└── scraper/
    ├── flipp.js                  # Flipp (backflipp) weekly-ad data source
    ├── match.js                  # brand matching + sale detection
    ├── notify.js                 # pluggable email sender
    └── run.js                    # orchestrator (fetch → diff → write → alert)
```

---

## Note on this repo

This project currently lives in a subfolder of `blu-sky-pipeline` only because
of a tooling constraint (GitHub access was scoped to that repo). It is fully
self-contained — to move it to its own repo, copy the `icecream-deals/` folder
out, `git init`, and push.
