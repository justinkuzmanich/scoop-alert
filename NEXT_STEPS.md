# Next Steps — Scoop Alert

Handoff notes for the next session.

## Current state — working & fully automated

Standalone `scoop-alert` repo: React+Vite web app + Node scraper + pluggable
email. The daily cron (`.github/workflows/refresh-deals.yml`, ~7am PT + manual
`workflow_dispatch`) scrapes, commits `public/data/deals.json`, and the site
redeploys. Runs in ~15s. Three price sources, all merged (lower price wins):

1. **Flipp weekly ad** (`scraper/flipp.js`) — Safeway's regional flyer for ZIP
   94941 via `backflipp.wishabi.com`, plain HTTP. Primary source.
2. **Web index** (`scraper/google-price.js`) — Safeway's own product-page prices,
   read from Google's search index via Firecrawl (the site itself is Imperva +
   hCaptcha walled, so we never touch it directly). Catches sales the flyer
   misses, e.g. the region-wide Häagen-Dazs pints $3.99. Needs the
   `FIRECRAWL_API_KEY` secret; unset → skipped.
3. **Personalized "for U" member deals** (`scraper/j4u-import.js`) — MANUAL,
   optional. See below.

Email alerts via Resend (`scraper/notify.js`, `RESEND_API_KEY` secret); diffs
against the committed `deals.json` so it only emails newly on-sale items.

### Per-brand price ceiling
`src/data/config.js` BRANDS can set `maxPrice`. Enforced in `scraper/match.js`
`toDeal()`: a brand deal above its cap is dropped entirely (not shown, not
emailed). Currently **Ben & Jerry's is capped at $4.50** (their pints aren't a
deal above that); Häagen-Dazs has no cap. One-number change to adjust.

### Product images
Deal cards show a product photo (`src/components/DealCard.jsx`):
- Web-index items derive it from the public Albertsons Scene7 CDN
  (`images.albertsons-media.com/is/image/ABS/<id>`), keyed by the product-details
  id (`scraper/google-price.js`).
- Flipp items use the flyer `cutout_image_url` (`scraper/flipp.js`).
- `match.js` passes an `image` field through; the card lazy-loads it and an
  `onError` handler hides the thumb if it 404s (card stays clean).
- NOTE: the CDN is blocked by the dev sandbox's network allowlist, so images
  can't be verified in-sandbox — they load in normal browsers (confirmed the CDN
  returns real webp via Firecrawl).

## Web app UI

React+Vite, deployed to GitHub Pages (`.github/workflows/deploy.yml`). Playful
design with a **light/dark toggle** (`src/App.jsx`, persisted in localStorage,
defaults to dark). Dark theme adds a candy-glow background, floating emoji +
CSS sprinkles, a shimmering title, gradient sale prices, and a **rotating
ice-cream-cone video** in the hero (`public/media/cone.webm` — a transparent
VP9-alpha WebM made by keying the grey out of an uploaded clip with ffmpeg).
All decorative motion respects `prefers-reduced-motion`. The "Check deals"
button only re-fetches the published `deals.json` (no backend — see future work).

## Personalized "for U" member deals — manual capture (by design)

Truly personalized member prices are per-account and published nowhere, and the
J4U API is behind a login + Imperva/hCaptcha that blocks EVERY automated browser
(bundled Chromium, real Chrome via Playwright, real Chrome via CDP — all return
"Access denied / Error 15", even headed from a residential IP; hammering it also
got the home IP temporarily flagged). The user's ordinary hand-driven Chrome
passes fine, so the working path is manual:

1. In normal Chrome (logged in, Mill Valley store set), paste
   `scripts/j4u-capture.js` into the DevTools console, search the brands, run
   `__j4uSave()` → downloads `j4u-capture.json`.
2. `npm run j4u:import <path>` → parses it (parser lives in `scraper/j4u.js`),
   folds on-sale member deals into `deals.json`; commit + push.

This was the conclusion after exhausting every automation angle — don't re-spend
time trying to automate the J4U fetch; the bot-wall is the wall.

## Possible future work (optional)

- **"Check deals" button triggers a live scrape.** Today the pink button only
  re-fetches the published `deals.json` (static site, no backend). To make it run
  a real scrape, add a tiny serverless function (Cloudflare Worker / Vercel) that
  holds a token and triggers the `refresh-deals` workflow; the button calls it.
- **Web-index freshness.** Snippet prices reflect Google's last crawl, so they
  can lag the live sale a few days. Acceptable for a weekly grocery sale; no fix
  needed unless staleness becomes a problem.

## Housekeeping the user may still want to do

- Delete now-unused GitHub secrets: `SAFEWAY_SESSION`, `J4U_PROXY_URL` (the old
  automated-J4U path that was removed).
- Refund the unused IPRoyal residential proxy (~1 GB, ~$7) bought for that path.
