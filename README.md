# Workout Buddy (`vsworkout.sosa-life.com`)

Mobile-first Progressive Web App (PWA) for logging strength & cardio sessions at Planet Fitness, backed by Google Apps Script and Google Sheets.

- **Live App (PWA)**: `https://vsworkout.sosa-life.com`
- **Google Sheet**: `1wKA_jCCdKhNKkqk1LNaVhY_z3NduDU6Wbcxo6Vwok-k`
- **Apps Script Project**: `1Afn725LN5kGbByjCZHe02uhrRkwrGYDiPazmrwHSjSFac-I48-3HQx9o`

---

## Security & Authentication (No Secrets in Git)

Because this repository is public (for GitHub Pages hosting), **zero credentials or session secrets live in git**:

1. **Where credentials live**: `AUTH_USER` and your password hash (`AUTH_SALT` + `AUTH_PASS_HASH`) are stored strictly inside **Google Apps Script > Project Settings (⚙️) > Script Properties**.
2. **One-time credential setup (or password reset)**:
   - Open the Apps Script project (`npm run clasp:open`).
   - Go to **Project Settings (⚙️) > Script Properties** and add two properties:
     - `AUTH_USER` = your chosen username (e.g. `vsosa`)
     - `AUTH_PASS` = your chosen password
   - Click **Save script properties**.
   - On your first sign-in from the PWA, [`gas/code.js`](./gas/code.js) automatically hashes `AUTH_PASS` with a random salt (`AUTH_SALT` + `AUTH_PASS_HASH`), deletes plaintext `AUTH_PASS`, and issues a 90-day session token. To rotate your password later, just add a new `AUTH_PASS` property — existing sessions are invalidated automatically.
3. **Brute-force protection**: After 5 failed login attempts within 15 minutes, `CacheService` locks out login attempts for 15 minutes (run `clearLoginLockout()` in the GAS editor to clear manually).
4. **Direct `/exec` protection**: `doGet()` returns only a health JSON stub — it never renders workout data without a valid session token.

---

## Clasp Commands (`vinny.sosa@gmail.com` Personal Profile)

All `npm run clasp:*` commands use `-u personal` so they never collide with work credentials:

```bash
# Verify personal clasp login
npm run clasp:user

# Pull latest files from Apps Script into ./gas
npm run clasp:pull

# Push ./gas/code.js and ./gas/appsscript.json to Apps Script
npm run clasp:push

# Update the existing Web App deployment in place (keeps the same /exec URL)
npm run clasp:deploy
```

---

## Custom Domain (`vsworkout.sosa-life.com`) & PWA Install

1. **DNS (`sosa-life.com`)**:
   - Add a `CNAME` record for host `vsworkout` pointing to `vinnysosa.github.io.` (DNS Only / grey cloud during TLS cert provisioning).
2. **GitHub Pages**:
   - **Settings > Pages**: Deploy from branch `main` / `/ (root)`, Custom domain `vsworkout.sosa-life.com`, check **Enforce HTTPS**.
3. **Install on Phone**:
   - **iOS (Safari)**: Open `https://vsworkout.sosa-life.com` → tap **Share** → **Add to Home Screen**.
   - **Android (Chrome)**: Open `https://vsworkout.sosa-life.com` → tap **⚙️ → Install App** (or browser install prompt).
