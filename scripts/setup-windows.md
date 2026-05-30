# Run Scoop Alert daily on a Windows home machine

This sets up the **local** scrape (public weekly ad **+ your personalized "for U"
member deals**) to run automatically every morning at **10:00 AM Pacific** and
push the results so the live site updates. Email alerts for newly on-sale items
go out on each run.

> Why a home machine? The "for U" member pricing is behind a login + bot-wall
> that blocks cloud/datacenter IPs. A real browser on your home connection avoids
> all of that. (The public weekly-ad deals already refresh in the cloud daily;
> this run adds the member deals on top.)

## One-time setup

Do these once, in PowerShell, from the repo folder.

1. **Install dependencies and the browser** (Node 18+ and Git required):
   ```powershell
   npm install
   npx playwright install chromium
   ```

2. **Add your email secret.** Copy the example and fill in `RESEND_API_KEY`
   (and `ALERT_TO` if different). This file is gitignored:
   ```powershell
   Copy-Item .env.example .env
   notepad .env
   ```

3. **Sign in to Safeway once** (opens a real browser — log in, pick your Mill
   Valley store, press Enter). This saves a logged-in profile to `.j4u-profile\`
   (gitignored) that the daily run reuses:
   ```powershell
   npm run j4u:login
   ```

4. **Make sure you're on the deploy branch** so pushes update the site:
   ```powershell
   git checkout main
   ```

5. **Try one run by hand** to confirm it works end to end:
   ```powershell
   npm run scrape:local
   ```
   You should see Flipp items, possibly `+N J4U member deal(s)`, and
   `Wrote ...deals.json`. If you see `no search response`, re-run step 3.

## Schedule it for 10:00 AM daily

Run this **once** in PowerShell, after editing the path to where the repo lives:

```powershell
$repo   = "C:\path\to\scoop-alert"   # <-- EDIT THIS
$script = Join-Path $repo "scripts\scrape-local.ps1"

$action  = New-ScheduledTaskAction -Execute "powershell.exe" `
  -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$script`""
$trigger = New-ScheduledTaskTrigger -Daily -At 10:00am
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -WakeToRun `
  -ExecutionTimeLimit (New-TimeSpan -Minutes 30)

Register-ScheduledTask -TaskName "ScoopAlert-Daily" `
  -Action $action -Trigger $trigger -Settings $settings `
  -Description "Daily Safeway for-U + weekly-ad scrape; pushes deals.json."
```

Notes:
- The task uses your machine's **local time**, so as long as the PC is set to
  Pacific time, 10:00 AM tracks PST/PDT automatically.
- `-StartWhenAvailable` runs a missed scrape if the PC was asleep at 10; `-WakeToRun`
  asks Windows to wake the machine. The PC still needs to be powered on (not fully
  shut down) and signed in to your user for the saved browser profile to be usable.

## Check on it

- **Run it now to test:** `Start-ScheduledTask -TaskName "ScoopAlert-Daily"`
- **See the log:** open `scripts\scrape-local.log` in the repo.
- **Change the time / remove it:**
  ```powershell
  Unregister-ScheduledTask -TaskName "ScoopAlert-Daily" -Confirm:$false
  ```

## When member deals stop showing up

Your Safeway session expired. Re-run `npm run j4u:login` and you're good again.
Everything fails safe in the meantime: the daily run still publishes the public
weekly-ad deals.
