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

## Safeway shelf prices via the web index (automatic)

Beyond the weekly ad, Safeway's own product pages show a current "Your Price /
Original Price" — but the site is behind Imperva + hCaptcha, so it can't be
scraped directly. **Google has already indexed those pages with the price in the
snippet**, though, so we read the search index instead of the site. This runs in
the cloud cron, needs no browser, and catches sales the flyer misses (e.g. the
region-wide "all Häagen-Dazs pints $3.99").

Enable it by setting a **`FIRECRAWL_API_KEY`** secret (free tier at
[firecrawl.dev](https://firecrawl.dev)) under **Settings → Secrets and variables
→ Actions**. Unset → the source is simply skipped and the weekly ad still runs.

Source: `scraper/google-price.js`. It searches each tracked brand's Safeway
product pages, extracts the price from the result snippet, and folds on-sale
items into `deals.json` (lower price wins). Caveat: snippet prices reflect
Google's last crawl, so they can lag the live sale by a few days — it's a
supplement to the weekly ad, not a replacement.

---

## Personalized member deals (J4U) — manual capture

Most sales are caught automatically by the weekly ad (Flipp) and the web-index
source above. This optional path adds your truly **personalized** "for U" prices,
which are per-account and never published anywhere. They sit behind a login + an
Imperva bot-wall that blocks *every* automated browser — even a real Chrome
driven by a script, even from your home IP ("Access denied / Error 15"). Your
**ordinary, hand-driven Chrome passes fine**, so the reliable approach is to let
your own browser fetch the data and hand it to the importer.

**Step 1 — capture (in your normal Chrome).** Sign in to
[safeway.com](https://www.safeway.com), set your Mill Valley store, open DevTools
(`F12`) → **Console**, and paste the snippet from
[`scripts/j4u-capture.js`](scripts/j4u-capture.js). Then, in the Safeway search
box, search **Haagen-Dazs** and then **Ben & Jerry's** (each search the snippet
catches is logged `✅ captured N`). When done, run `__j4uSave()` in the console —
it downloads **`j4u-capture.json`**.

**Step 2 — import (in your repo).**

```bash
npm run j4u:import  ~/Downloads/j4u-capture.json   # path to the downloaded file
git add public/data/deals.json
git commit -m "chore: add Safeway for-U member deals" && git push
```

`j4u:import` parses the captured responses, folds the on-sale member deals into
`public/data/deals.json` alongside the weekly-ad deals (keeping the lower price),
and the push redeploys the site. Re-capture whenever you want fresh member prices
(takes ~30 seconds). Automating Safeway is against their ToS — personal use only.

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
