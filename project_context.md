# Workout Buddy — Project Context

*Last Updated: 2026-11-25*

## Project Goal
Straighten out the Workout Buddy repository (`workout-tool`), connect the bound Google Apps Script via `clasp`, verify direct Google Sheet access (`gsheets`), publish a public GitHub repository (`vinnysosa/workout-tool`) serving an installable mobile PWA at `vsworkout.sosa-life.com` protected by server-side username/password authentication, and analyze workout logs to plan app enhancements.

## Current Status
- **Google Sheet Access**: Verified via `gsheets` (`vinny.sosa@gmail.com`) on `1wKA_jCCdKhNKkqk1LNaVhY_z3NduDU6Wbcxo6Vwok-k` (4 tabs: `Plan` 10×26, `Cardio` 5×26, `Latest` 7×26, `Log` 7×440).
- **Clasp Connected & Deployed**: Bound to Apps Script `1Afn725LN5kGbByjCZHe02uhrRkwrGYDiPazmrwHSjSFac-I48-3HQx9o` (`rootDir: "gas"`). Verified 0 diff against July files, pushed hardened `gas/code.js`, and redeployed existing Web App deployment (`AKfycbxqJVQPEjbOibIY2HUJBkyq_gwlJqGlA5jTy_GsoLlWWMWe6kWNyqfKYh-oWiZtw_35` `@19`).
- **GitHub Repo & Pages Live**: Created public repo `https://github.com/vinnysosa/workout-tool` (`main` branch, repo-local git identity & credential pinned to `vinnysosa`), vendored Chart.js 4.4.8 locally (`vendor/chart.umd.min.js`), and enabled GitHub Pages with custom domain `vsworkout.sosa-life.com`.
- **Native Static PWA Built**: Unified single-page PWA (`index.html`, `styles.css`, `app.js`, `sw.js`, `manifest.webmanifest`, `icons/`) with sign-in gate, instant Workout ↔ Progress switching, offline app-shell caching, and home-screen icons.
- **Snapshots Archived**: July CSV/XLSX exports and pre-PWA GAS HTML backups moved into gitignored `archive/`.

## Next Steps
1. **Vinny one-time setup (2 mins)**:
   - In Apps Script **Project Settings > Script Properties**, add `AUTH_USER` and `AUTH_PASS` (auto-hashes to salted SHA-256 on first sign-in).
   - In DNS for `sosa-life.com`, add `CNAME` record `vsworkout` → `vinnysosa.github.io.`, then check **Enforce HTTPS** in GitHub Repo **Settings > Pages** once TLS cert provisions.
2. **Next session / phase**: Analyze the 439 workout rows in `Log` + `Cardio` via `gsheets` and design enhancements for Workout Buddy.

## Key Decisions
- **Native Static PWA + GAS JSON API (Option 1B)** over iframe wrapper: Eliminates GAS's slow double-iframe load at the gym, avoids iOS standalone iframe cookie issues, and consolidates duplicate theme/nav code into a single codebase.
- **Server-Side Auth in `ScriptProperties`**: Zero credentials touch git. `AUTH_PASS` entered in GAS Script Properties auto-upgrades to salted SHA-256 (`AUTH_SALT` + `AUTH_PASS_HASH`) on first login, 5-attempt rate limiting runs via `CacheService`, and `doGet` no longer serves unauthenticated HTML.
- **Self-Hosted Chart.js (`vendor/chart.umd.min.js`)**: Zero runtime third-party CDN requests; 100% offline-cached in `sw.js`.
- **POST `text/plain;charset=utf-8` Transport + Batched `bootstrap`/`history`**: Avoids GAS CORS preflight, keeps session tokens out of URLs, and cuts cold-start round-trips from 3 down to 1.

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
| `vendor/chart.umd.min.js` | Self-hosted Chart.js 4.4.8 UMD bundle for Progress charts |
| `CNAME` | Custom domain (`vsworkout.sosa-life.com`) for GitHub Pages |
| `robots.txt` / `.nojekyll` | Search crawler disallow + static asset serving on GitHub Pages |
| `gas/code.js` | Google Apps Script backend (auth, rate limiting, Sheet read/write API) |
| `gas/appsscript.json` | GAS manifest (`America/New_York`, V8, `USER_DEPLOYING` / `ANYONE_ANONYMOUS`) |
| `.clasp.json` / `.claspignore` | Clasp connection config (`rootDir: "gas"`) |
| `package.json` | Convenience npm scripts (`clasp:pull`, `clasp:push`, `clasp:deploy`, `serve`) |
| `archive/` | Gitignored backup of July CSV/XLSX snapshots and pre-PWA GAS HTML templates |
