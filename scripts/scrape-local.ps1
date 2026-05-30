# Scoop Alert — daily LOCAL scrape for Windows (run by Task Scheduler).
#
# What it does, in order:
#   1. cd to the repo and load secrets from .env (RESEND_API_KEY, ALERT_TO, ...).
#   2. Sync the `main` branch (the one the live site deploys from).
#   3. Run the local scrape: Flipp weekly ad + your "for U" member deals (via a
#      real browser using the profile saved by `npm run j4u:login`).
#   4. If deals.json changed, commit & push so the deployed site updates. Email
#      alerts for newly on-sale items are sent during the scrape itself.
#
# Everything is logged to scripts\scrape-local.log (gitignored). The scrape
# fails safe: if the Safeway session is expired/blocked it just falls back to
# the Flipp weekly ad — it never errors out the run. Re-run `npm run j4u:login`
# if member deals stop appearing.
#
# Set up the schedule with scripts\setup-windows.md.

$ErrorActionPreference = 'Stop'
$Branch = 'main'

# Repo root = the folder containing this script's parent (scripts\ -> repo).
$RepoRoot = Split-Path -Parent $PSScriptRoot
Set-Location $RepoRoot

# --- logging -------------------------------------------------------------
$LogFile = Join-Path $PSScriptRoot 'scrape-local.log'
function Log($msg) {
  $line = "[{0}] {1}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $msg
  Write-Host $line
  Add-Content -Path $LogFile -Value $line
}

try {
  Log "=== Scoop Alert daily local scrape starting ==="

  # --- load .env into the environment (KEY=VALUE lines; # comments ignored) --
  $envFile = Join-Path $RepoRoot '.env'
  if (Test-Path $envFile) {
    foreach ($raw in Get-Content $envFile) {
      $line = $raw.Trim()
      if ($line -eq '' -or $line.StartsWith('#')) { continue }
      $eq = $line.IndexOf('=')
      if ($eq -lt 1) { continue }
      $key = $line.Substring(0, $eq).Trim()
      $val = $line.Substring($eq + 1).Trim().Trim('"').Trim("'")
      Set-Item -Path "Env:$key" -Value $val
    }
    Log "Loaded .env"
  } else {
    Log "No .env found — emails will print to console only (scrape still runs)."
  }

  # Run the J4U browser hidden so no window pops up during the scheduled run.
  # If member deals stop coming through headless, comment this out to run headed.
  $env:J4U_HEADLESS = '1'

  # --- sync the deploy branch ---------------------------------------------
  Log "Syncing branch '$Branch'…"
  git checkout $Branch
  git pull --rebase --autostash origin $Branch
  if ($LASTEXITCODE -ne 0) { throw "git pull failed (exit $LASTEXITCODE)" }

  # --- scrape (Flipp + for-U member deals) --------------------------------
  Log "Scraping (Flipp + for-U member deals)…"
  npm run scrape:local
  if ($LASTEXITCODE -ne 0) { throw "scrape failed (exit $LASTEXITCODE)" }

  # --- commit & push deals.json if it changed -----------------------------
  git diff --quiet -- public/data/deals.json
  if ($LASTEXITCODE -eq 0) {
    Log "No deal changes — nothing to push."
  } else {
    Log "Deals changed — committing & pushing…"
    git add public/data/deals.json
    git commit -m "chore: refresh deals.json (local for-U scrape)"

    # Push, retrying after a rebase in case the cloud cron pushed meanwhile.
    $pushed = $false
    for ($i = 1; $i -le 4; $i++) {
      git push origin $Branch
      if ($LASTEXITCODE -eq 0) { $pushed = $true; break }
      Log "Push attempt $i failed — rebasing on latest and retrying…"
      git pull --rebase --autostash origin $Branch
      Start-Sleep -Seconds ([math]::Pow(2, $i))
    }
    if (-not $pushed) { throw "git push failed after retries" }
    Log "Pushed updated deals.json — the live site will redeploy."
  }

  Log "=== Done ==="
}
catch {
  Log "ERROR: $($_.Exception.Message)"
  exit 1
}
