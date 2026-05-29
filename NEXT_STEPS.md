# Next Steps — Scoop Alert

Handoff notes for the next session.

## Current state
- App lives in `icecream-deals/` on branch `claude/fervent-goldberg-tMDQ7`.
- Data source: **Flipp** (`backflipp.wishabi.com`) — Safeway's regional weekly ad
  for ZIP 94941, no key needed on a normal network. (`safeway.com` itself is
  Imperva bot-walled.)
- `public/data/deals.json` holds a real snapshot (2026-05-29): Häagen-Dazs
  Gelato $5.99, no Ben & Jerry's deal.
- Web app (React+Vite) + scraper (`scraper/flipp.js`, `run.js`) + pluggable
  email (`notify.js`) all working; build passes.

## TODO

### 1. Move to its own GitHub repo
Tooling note: this session's GitHub access was scoped to `blu-sky-pipeline`,
so the new repo must be created by the user (or with broader access).
Plan:
- User creates an empty `scoop-alert` repo on GitHub.
- Export `icecream-deals/` into it. Simplest: copy the folder out, `git init`,
  initial commit, add remote, push. (History from this branch is optional —
  a fresh init is cleanest since it was developed in a subfolder.)
- Then remove `icecream-deals/` from `blu-sky-pipeline`.

### 2. Pull personalized coupons from the Safeway "for U" app (J4U)
User HAS a Safeway login and wants their own digital coupons (richer than the
public weekly ad).
- Endpoint family: `https://www.safeway.com/abs/pub/web/j4u/api/offers/...`
  (gallery/clipped offers). Returns JSON when authenticated.
- Blockers: requires auth + sits behind Imperva. Automating the login itself is
  hard (bot detection).
- Recommended approach: DON'T store the password. Have the user log in via
  browser, grab the session token/cookie (e.g. from devtools), store it as a
  secret (`SAFEWAY_SESSION` env/CI secret), and call the J4U API with it.
  Token will expire periodically and need refreshing — design for that.
- Security: never commit tokens/cookies; treat as secrets. Note this is against
  Safeway ToS to automate — fine for personal use, but keep it personal.
- Build as a second adapter alongside `flipp.js`; merge its offers into the
  same deal shape so the UI/alerts work unchanged.

### Also still pending (offered, not yet built)
- GitHub Actions daily cron to run `npm run scrape` + commit deals.json.
- Wire up Resend (or chosen provider) in `notify.js` for real alert emails.
