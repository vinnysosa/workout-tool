# Workout Buddy — Project Context

*Last Updated: 2026-11-25*

## Project Goal
Straighten out the Workout Buddy repository (`workout-tool`), connect the bound Google Apps Script via `clasp`, verify direct Google Sheet access (`gsheets`), publish a public GitHub repository (`vinnysosa/workout-tool`) serving an installable mobile PWA at `vsworkout.sosa-life.com` protected by server-side username/password authentication, and prepare for analyzing workout logs and building app enhancements.

## Current Status
- **Google Sheet Access**: Verified via `gsheets` (`vinny.sosa@gmail.com`) on `1wKA_jCCdKhNKkqk1LNaVhY_z3NduDU6Wbcxo6Vwok-k` (4 tabs: `Plan` 10×26, `Cardio` 5×26, `Latest` 7×26, `Log` 7×440).
- **Clasp Connected**: Bound to Apps Script `1Afn725LN5kGbByjCZHe02uhrRkwrGYDiPazmrwHSjSFac-I48-3HQx9o` (`rootDir: "gas"`). Pulled live GAS files and confirmed 0 drift against July local files before refactoring.
- **Native Static PWA Built**: Unified single-page PWA (`index.html`, `styles.css`, `app.js`, `sw.js`, `manifest.webmanifest`, `icons/`, `CNAME` for `vsworkout.sosa-life.com`) with sign-in gate, instant Workout ↔ Progress switching, offline app-shell caching, and home-screen icons.
- **Authenticated GAS JSON API Built**: `gas/code.js` exposes `doPost` JSON RPC (`login`, `logout`, `bootstrap`, `history`, `logWorkout`, `logCardio`, `saveTheme`) gated by salted SHA-256 credentials (`AUTH_USER` / `AUTH_PASS` -> `AUTH_SALT` + `AUTH_PASS_HASH` in `ScriptProperties`), 90-day session tokens, and 5-attempt `CacheService` rate limiting. Old unauthenticated `HtmlService` routes removed.
- **Snapshots Archived**: Old July CSV/XLSX exports and pre-PWA GAS HTML backups moved into gitignored `archive/`.

## Next Steps
1. Vendor `chart.umd.min.js` into `vendor/` so Charts work with zero external CDN dependencies.
2. Push `gas/` via `clasp push` and update existing web app deployment (`AKfycbxqJVQPEjbOibIY2HUJBkyq_gwlJqGlA5jTy_GsoLlWWMWe6kWNyqfKYh-oWiZtw_35`).
3. Set `AUTH_USER` and `AUTH_PASS` in Apps Script **Project Settings > Script Properties**.
4. Re-authenticate `gh` (`vinnysosa`), create public GitHub repo `vinnysosa/workout-tool`, push `main`, and enable GitHub Pages for `vsworkout.sosa-life.com` (plus DNS `CNAME` `vsworkout` -> `vinnysosa.github.io`).
5. Analyze the 439 rows in `Log` + `Cardio` and design next-phase app enhancements.

## Key Decisions
- **Native Static PWA + GAS JSON API (Option 1B)** over iframe wrapper: Eliminates GAS's slow double-iframe load at the gym, avoids iOS standalone iframe cookie issues, and consolidates duplicate theme/nav code into a single codebase.
- **Server-Side Auth in `ScriptProperties`**: Since GitHub Free requires a public repo for GitHub Pages, zero credentials touch git. `AUTH_PASS` entered in GAS Script Properties auto-upgrades to salted SHA-256 on first login, and `doGet` no longer serves unauthenticated HTML.
- **POST `text/plain;charset=utf-8` Transport**: Avoids CORS `OPTIONS` preflight (unsupported by GAS `/exec`) while keeping session tokens out of URL query strings.
- **Batched `bootstrap` & `history` Calls**: Reduced initial load from 3 separate GAS round-trips down to 1.

## File Inventory

| File | Description |
|---|---|
| `index.html` | Single-page PWA markup (Sign-In gate, Workout logger, Progress history) |
| `styles.css` | Theme CSS variables (7 themes), responsive mobile styles, safe-area insets |
| `app.js` | Auth flow, fetch RPC client, Workout/Cardio/Timer/Progress/Chart UI, PWA install |
| `config.js` | Public endpoint config (`GAS_API_URL`, `APP_VERSION`) — never stores secrets |
| `manifest.webmanifest` | Standalone PWA manifest (`id: "/"`, 192/512 + maskable icons) |
| `sw.js` | Service worker caching static app shell (`GET` same-origin only) |
| `icons/` | Generated dumbbell icons (`favicon.svg`, `icon-180.png`, `icon-192.png`, `icon-512.png`, `icon-512-maskable.png`) |
| `vendor/chart.umd.min.js` | Self-hosted Chart.js v4 UMD bundle for Progress charts |
| `CNAME` | Custom domain (`vsworkout.sosa-life.com`) for GitHub Pages |
| `robots.txt` / `.nojekyll` | Search crawler disallow + static asset serving on GitHub Pages |
| `gas/code.js` | Google Apps Script backend (auth, rate limiting, Sheet read/write API) |
| `gas/appsscript.json` | GAS manifest (`America/New_York`, V8, `USER_DEPLOYING` / `ANYONE_ANONYMOUS`) |
| `.clasp.json` / `.claspignore` | Clasp connection config (`rootDir: "gas"`) |
| `package.json` | Convenience npm scripts (`clasp:pull`, `clasp:push`, `clasp:deploy`, `serve`) |
| `archive/` | Gitignored backup of July CSV/XLSX snapshots and pre-PWA GAS HTML templates |
