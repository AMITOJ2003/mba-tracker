# MBA Tracker

A personal GMAT / MBA-application tracker that installs on your iPhone like a native app.
Plain HTML + CSS + vanilla JS, no build step, no backend of its own. Works fully offline;
data is stored on the device (IndexedDB), with optional sync to your laptop.

**Tabs**
- **Today** — days to the next deadline, this week's study hours, latest mock, streak, current phase, "Log study".
- **Plan** — Phases (checklists), Dates (countdowns, calendar export), Months (monthly checkpoints).
- **Mocks** — log practice tests and see the analysis: total and section charts (tap for details),
  insights (pace vs. what you need, weakest section, timing, mistake patterns, official vs.
  third-party, consistency, next checkpoint), a section table and mistake breakdown.
  Tap **Add accuracy, timing & mistakes** when logging a mock for the deeper analysis.
- **Settings** — targets, score checkpoints, custom goals, sync, backup, reset.

## Run locally

Requires [Node.js](https://nodejs.org) (any recent version).

```bash
node dev-server.mjs
```

Open http://localhost:5173. Any static server works too (e.g. `python -m http.server 5173`).

> The service worker serves files from its cache first and refreshes them in the background,
> so after editing a file **reload twice** to see the change (or use DevTools → Application →
> "Update on reload"). Bump `CACHE` in `sw.js` when you add or rename files.

## Deploy free on GitHub Pages

1. Create an empty **public** repo on github.com, e.g. `mba-tracker` (no README).
2. In this folder:

   ```bash
   git init
   git add .
   git commit -m "MBA Tracker"
   git branch -M main
   git remote add origin https://github.com/<your-username>/mba-tracker.git
   git push -u origin main
   ```

3. On GitHub: repo **Settings → Pages → Build and deployment → Source: Deploy from a branch**,
   Branch: `main`, folder: `/ (root)` → **Save**.
4. Wait ~1 minute. Your app is at `https://<your-username>.github.io/mba-tracker/`.

All paths are relative, so it works from a sub-folder URL like this.

**Updating later:** edit files, bump `CACHE` in `sw.js` (e.g. `mba-tracker-v2`), then
`git commit -am "update" && git push`. The phone picks up the new version on the next
launch or two. Your data is not affected.

### Alternative: Vercel

```bash
npx vercel --prod
```

Accept the defaults (no framework, no build command, output directory `.`).

## Install on iPhone

1. Open the GitHub Pages URL in **Safari** (it has to be Safari).
2. Tap the **Share** button (square with an up arrow).
3. Scroll down and tap **Add to Home Screen** → keep the name "MBA Tracker" → **Add**.
4. Launch it from the home-screen icon. It opens full-screen with no Safari bars.
5. Open it once while online; after that it works in airplane mode.

## Back up your data (important)

Without sync, the data lives only in this app on this phone. iOS can delete website storage
(e.g. if the app goes unused for a long time, or if you clear Safari data), and the
home-screen app's storage is separate from Safari's.

- **Export:** Settings → **Export**. On iPhone the share sheet opens: choose
  **Save to Files** → iCloud Drive. Settings shows when you last exported and
  nudges you after 14 days.
- **Import:** Settings → **Import** → choose the `.json` backup. This replaces all current data.
- **Reset to default plan:** Settings → bottom button (asks twice).

## Sync between laptop and phone (optional)

Your data is stored as a single file in a **private** GitHub repository that only you can see.
Each device talks to GitHub directly, so there is still no server to run or pay for.

One-time setup (about 3 minutes):

1. On github.com: **+ → New repository** → name it `mba-tracker-data` → choose **Private** → Create.
   (Keep it separate from the public repo that hosts the app.)
2. Profile picture → **Settings → Developer settings → Personal access tokens → Fine-grained tokens
   → Generate new token**.
   - Expiration: the longest it allows (you'll paste a new one when it expires).
   - Repository access: **Only select repositories** → `mba-tracker-data`.
   - Permissions → Repository permissions → **Contents: Read and write**. Nothing else.
   - Generate, and copy the token (starts with `github_pat_`).
3. On your **phone**: MBA Tracker → Settings → **Set up sync** → repository
   `your-username/mba-tracker-data` + the token → **Connect**.
4. On your **laptop**: open the same app URL in any browser → Settings → Set up sync → same repo and
   token. When asked "Found data synced from another device", tap **OK** to load your phone's data.

After that it syncs by itself: when the app opens, comes back to the foreground, goes back
online, and a few seconds after each change. **Sync now** forces it. Changes made offline on both
devices are merged item by item (the most recent edit to the same item wins; deletions carry over).

Notes
- The token is stored only on that device and is never included in exports or in the synced file.
  It can only touch that one repo. If a device is lost, delete the token on GitHub.
- The app refuses to sync to a public repository.
- Each sync is a small commit in `mba-tracker-data`; that's expected.

## Calendar reminders

Plan → Dates: open a date and tap **Add to Calendar**, or use **Add all to Calendar** below the list.
Each event is all-day and has two alerts: 7 days before and 1 day before, both at 9:00.
On iPhone, open the downloaded `.ics` file (if it lands in Files/Downloads, tap it) and
choose **Add All** / **Add to Calendar**. Re-exporting the same date updates it rather
than duplicating it in most calendar apps, because each date keeps a stable ID.

## Files

```
index.html       app shell + tab bar
styles.css       iOS styling, safe areas, light/dark
manifest.json    PWA manifest
sw.js            offline cache
js/app.js        screens, forms, actions
js/analyze.js    mock analysis & insights
js/sync.js       GitHub sync + merge
js/db.js         IndexedDB storage (localStorage fallback)
js/seed.js       default plan
js/dates.js      date helpers
js/chart.js      SVG score chart
js/ics.js        calendar export
icons/           app icons (180 apple-touch, 192, 512, maskable)
dev-server.mjs   local static server
```
