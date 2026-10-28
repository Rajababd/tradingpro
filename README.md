# TradingPro

Mobile-first financial charting app (TypeScript, React, Vite, Lightweight Charts 5).
Status: **Phase 6 (SMA system and top bar)**. The Indicators and SMA dropdowns work end to end: RSI, Volume, OBV, Accumulation/Distribution and MACD, and an SMA on price or on any indicator output, shown in their own panes, with visibility and settings controls. Settings are **not saved across reloads yet** (Phase 8). The app supports DSE historical daily OHLC data via an allowlisted proxy, with user-triggered refresh, weekly/monthly aggregation, paging through older history, failure reporting, series/pane managers, viewport and crosshair inspection. Indicator conventions and the display rules are in `docs/indicators.md`.
See `docs/architecture.md` for design decisions and the data-validation policy.

## Requirements
Node 22+ and npm 10+.

## Commands
| Command | What it does |
|---|---|
| `npm install` | Install pinned dependencies |
| `npm run dev` | Dev server at http://127.0.0.1:5173 |
| `npm test` | Run the Vitest suite |
| `npm run typecheck` | Strict TypeScript check (no emit) |
| `npm run build` | Typecheck, then production build to `dist/` |

## What is verified (2026-10-14, Linux dev sandbox)
- `npm run typecheck` passes (strict, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`).
- `npm test`: 28 files, 382 tests pass (the four Phase 1 suites pass unmodified).
- **Indicators** (calculation layer, no browser involved): hand-calculated examples; exact agreement with TA-Lib 0.8.2 (SMA, RSI, OBV, A/D to 1e-10; MACD after the documented seed difference fades) and with an independent Python implementation (MACD, SMA of RSI); incremental results bit-identical to batch over random streams with repeated live-bar revisions; mutation checks. Details and conventions: `docs/indicators.md`.
- `npm run build` succeeds (and its last step fails the build if the development-only test seam is ever found in the bundle); assets are bundled locally (no CDN).
- **Real library, headless Chromium** (dev server on :5173):
  - `scripts/verify-phase2.py` (32 checks): pane order, hide/show, shared panes, removal and return, protections, viewport, crosshair, dispose.
  - `scripts/verify-phase3.py` (33 checks): chart equals store field-for-field after live ticks, ticks use `update()` never `setData()`, viewport untouched while scrolled into the past and following at the live edge, prepend keeps the candle under a stationary pointer, paging to the very start then stopping, network outage and recovery, invalid data, dispose stops requests.
  - `scripts/verify-phase5.py` (37 checks): hiding a series versus collapsing a pane, shared panes, SMA independence, only-price layout, a pane the user resizes with a real mouse drag returning at their size, 80+ hide/show cycles without drift or re-creation, created-hidden, removal and return to the logical slot, price-pane protection.
  - `scripts/verify-phase6.py` (118 checks): the real menus driven by mouse and by emulated touch: opening changes nothing, panels stay on screen on 320x480 to 1280x800 including landscape and scroll inside themselves, switches show/hide and recreate nothing over 25 cycles, per-line MACD chips, settings validation, SMA on price and on a hidden source, SMA of MACD's signal vs MACD line never mixed up, every series equals its calculation after live ticks, a missing volume is a visible gap in the OBV line (checked in pixels), dragging inside a menu does not pan the chart, Close / Escape / outside press close it.
  - `scripts/verify-app.py`: startup loads exactly 300 candles, one chart under StrictMode, the feed label advances and never says "Live" for simulated data, the candle count grows as simulated bars roll over, dragging pages in older history, legend on hover; on an emulated touch phone a drag pans and pages history, a tap does nothing, press-and-hold inspects.

### Running the browser checks
They need Python 3 with Playwright and Chromium, and the dev server running:
```
npm run dev &            # http://127.0.0.1:5173
python3 scripts/verify-phase2.py
python3 scripts/verify-phase3.py
python3 scripts/verify-phase5.py
python3 scripts/verify-phase6.py
python3 scripts/verify-app.py
```
They are sandbox tooling, not part of `npm test` or any CI yet.

## Not verified / known limitations
- Unit tests of the managers use a **fake** chart modelled on measured library behaviour; the browser scripts keep that fake honest.
- Touch was exercised with emulated touch events in desktop Chromium, **not on a real Android device**.
- On touch, the crosshair needs press-and-hold (library behaviour); a quick tap shows nothing. There is no on-screen hint yet.
- **No real data source.** The feed is a simulated random walk; there is no Damascus Securities Exchange integration and no endpoint is assumed. The 2 s poll interval is for the simulation only.
- Polling does not pause when the tab is hidden and has no separate offline detection beyond request failures.
- Corrections to already-closed candles are refused on the live path (counted as stale); they need a reload.
- Paging triggers only on user gestures, so changing the window size alone does not load more history.
- The legend shows price-series OHLC only; indicator values come with the indicator phase.
- A hidden pane cannot be made fully invisible by the chart library: each leaves about 3 px (a sliver and its separator, thin stacked lines above the time axis). Documented in `docs/lightweight-charts-notes.md`.
- The market-data error overlay and manual retry path are exercised through the real UI in the browser acceptance workflow.
- A malformed browser locale tag makes the chart library throw and draw nothing (seen in a headless sandbox). Real browsers send valid tags.
- **Settings are not saved.** Which indicators are shown, their parameters and the SMA settings reset on reload (Phase 8). Nothing is displayed by default.
- One SMA per source (stable identity per source), and Price means the close.
- The browser checks use a development-only seam (`window.__tradingpro`); it is compiled out of production builds and the build checks that.
- On a phone a tall menu covers most of the chart; it has a Close button and closes on any press outside it (including the top bar).
- RSI's axis shows the library's margins around 0-100 (labels reach about 120).
- Indicator conventions to be aware of: RSI is `null` (not 0/50/100) while the price has never moved; OBV and A/D restart after a bar with no volume; MACD seeds EMAs with an SMA (TA-Lib differs in its first ~200 bars). All documented in `docs/indicators.md`.
- Drawings, persistence and the backend are later phases.
