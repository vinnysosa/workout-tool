# Workout Buddy — Project Context

*Last Updated: 2026-11-25*

## Project Goal
Deliver Workout Buddy v2.0 as a fast, mobile-first PWA at `vsworkout.sosa-life.com` tailored to 7–9 AM ET hypertrophy & muscle-refinement training — while keeping Classic v1 live side-by-side at `/v1/` against untouched backup tabs for zero-risk gym testing.

## Current Status
- **Spreadsheet Timezone Fixed (`America/New_York`)**: Updated `1wKA_jCCdKhNKkqk1LNaVhY_z3NduDU6Wbcxo6Vwok-k` from `America/Los_Angeles` to `America/New_York`.
- **Clean 3-Tab v2 Schema Created & Backfilled**:
  - `Exercises_v2` (32 active movements across interleaved Muscle Slots, including pre-added **Forearms → EZ-Bar Forearm Curl @ 40 lbs** and separated Smith/TRX/EZ-Bar/Free-weight variants with independent working weights & sticky notes).
  - `Log_v2` (all 439 historical entries shifted `+3 hours` to 7–9 AM ET and mapped to `SlotId` + `Muscle` + `Exercise`).
  - `Cardio_v2` (structured columns for **Arm Crank** `Mins / Avg Watts / Peak Watts / Miles / Calories` and **StairMaster** `Floors / Mins / Level` + sticky notes).
  - Original v1 tabs (`Plan`, `Latest`, `Log`, `Cardio`) remain **100% untouched**.
- **v2.0 Frontend Built (`/`)**:
  - Edge-to-edge full-width Muscle Slot bars (zero wasted horizontal margins).
  - Blue-only palette with 1-tap Light / Dark mode (`color-scheme` + `light-dark()`).
  - Touch + keyboard drag-and-drop slot reordering persisted to `Exercises_v2`.
  - Per-slot exercise variant dropdown + in-app `+ Add Exercise / Variant` modal.
  - 10-foot full-screen circular SVG rest timer (`<dialog>`) with huge countdown numerals + Screen Wake Lock API (`navigator.wakeLock`).
  - Redesigned Progress dashboard combining **Literal Movement Chips (`lbs` + `+lb` gain)** AND **Plain Total Pounds Moved % (`Sets × Reps × Weight` vs. Day 1)** + inline SVG sparklines.
- **Classic v1 Parachute (`/v1/`)**: Preserved at `/v1/` (`⋯ → Switch to Classic v1`) talking to the original 4 tabs under the same login token.

## Next Steps
1. Test v2.0 in your next real morning workout (`Chest & Shoulders` auto-selected next!).
2. Once v2 passes 1–2 live gym sessions, optionally archive/hide the old v1 tabs (`Plan`, `Latest`, `Log`, `Cardio`) and remove `/v1/`.
3. Optional: Backfill the dates for the 3 Arm Crank Constant Work photo sessions into `Cardio_v2` if desired.

## Key Decisions
- **Side-by-Side v2 Tabs + `/v1/` Escape Hatch**: Zero risk of getting stuck mid-workout if any UX detail needs tweaking.
- **Slot + Variant Model in `Exercises_v2`**: Eliminates the separate `Latest` tab by storing each movement's working weight, reps, sets, clean streak, and sticky note directly on its `Exercises_v2` row.
- **Two-Layer Transparent Progress Math**: Combines literal working weights (`50 lb (+15 lb)`) and plain total pounds moved (`Sets × Reps × Weight` vs. Day 1, `+XX%`) — no opaque 1RM formulas.

## File Inventory

| File | Description |
|---|---|
| `index.html` | Workout Buddy v2.0 PWA markup (Log, Progress, Circular Timer `<dialog>`, `+ Add Exercise` `<dialog>`) |
| `styles.css` | Edge-to-edge Blue Light/Dark design system (`color-scheme`, `light-dark()`, full-bleed bars) |
| `app.js` | v2 state, pointer/keyboard drag-and-drop, variant switcher, Wake Lock circular timer, Progress rollup |
| `v1/` | Preserved Classic v1 app (`v1/index.html`, `v1/styles.css`, `v1/app.js`) backed by original Sheet tabs |
| `config.js` | Public endpoint config (`GAS_API_URL`, `APP_VERSION: '2.0.0'`) |
| `sw.js` | Service worker (`workout-buddy-shell-v2`) caching both v2 and `/v1/` shells |
| `icons/` | Blue dumbbell home-screen icons (`favicon.svg`, `180`, `192`, `512`, `512-maskable`) |
| `gas/code.js` | Authenticated GAS JSON API serving both `v2_*` endpoints and legacy `v1` endpoints |
| `archive/` | Gitignored local backups of July CSV/XLSX exports and original GAS HTML files |
