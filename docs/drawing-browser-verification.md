# Drawing browser verification

This document describes the current browser-level drawing smoke test and separates verified behavior from areas that still need acceptance testing.

## Current automated verification

The GitHub Actions workflow `.github/workflows/verify.yml` runs the following on pushes and pull requests:

1. Installs the locked Node dependencies.
2. Runs `npm run test:drawing` for drawing-library regression tests.
3. Runs `npm test` for the project test suite.
4. Runs `npm run typecheck`.
5. Runs `npm run build`.
6. Installs Python Playwright and Chromium, starts Vite, and runs `python scripts/verify-drawing-app.py`.

At the post-PR-#2 main revision, GitHub Actions passed: 28 test files / 383 tests, drawing-library regressions, TypeScript type-check, production build, and the drawing browser smoke test in desktop and phone-sized Chromium contexts. These results are CI results, not a claim that the same commands were run locally.

The browser smoke test verifies:
- The Trend Line tool is available and can be activated.
- The first click/tap does not prematurely complete a two-anchor drawing.
- The second click/tap completes the drawing.
- The exported drawing has two anchors and is attached to the price series.
- The tool exits after completion.
- A one-anchor tool completes on one click/tap and has one anchor.
- No browser page exceptions are reported during the tested flow.

## Run locally

Requirements: Node.js 22+, npm 10+, Python 3, Playwright for Python, and Chromium.

```sh
npm ci
npm run dev -- --host 127.0.0.1
# In another terminal:
python scripts/verify-drawing-app.py
```

The script expects the app at `http://127.0.0.1:5173/` and uses a development-only `window.__tradingpro` test seam. The production build checks that this seam is not included in the production bundle.

Run the drawing-library regression suite separately:

```sh
npm run test:drawing
```

## Coordinate and interaction contract

- New drawing anchors store both `logical` (bar-index) and `time` coordinates plus price.
- Rendering prefers a valid logical coordinate and falls back to timestamp conversion for legacy anchors that have no logical coordinate.
- Placement converts pointer coordinates to chart time, logical index, and price; invalid/out-of-chart coordinates are rejected.
- Prepending historical candles shifts logical anchors, including pending anchors, while preserving their time values.
- Legacy time-only anchors are normalized to logical coordinates when possible.
- Bar-span measurements use logical-index distance where available; calendar-day spans continue to use timestamps.

Regression tests cover logical-coordinate precedence, legacy fallback, serialization round-trip, edits that preserve both coordinate representations, prepend shifts, and bar/day measurement behavior.

## Known limits / not yet covered by the current smoke test

The current browser smoke test is intentionally not a complete drawing acceptance suite. It does **not** prove:
- Rectangle and Fibonacci Retracement creation end-to-end in a real browser.
- Selecting and editing an existing drawing end-to-end through the app UI.
- Individual drawing deletion through a dedicated UI control.
- Drawing save/load persistence across a full page reload.
- Drawing placement on indicator panes; placement currently targets the price series.
- A live preview while positioning the next anchor.
- Rendering correctness across multiple browser engines or a physical Android device.

The drawing manager contains lower-level APIs for removal, selection/hit testing, import/export and interaction, but those APIs alone are not proof of complete, accessible UI workflows. Treat the items above as pending acceptance tests or deferred scope, not as verified features.

## Phase 6 suite is separate

`scripts/verify-phase6.py` covers the Phase 6 indicator/SMA menus and calculation/display behavior. The current GitHub Actions workflow does not invoke that dedicated 118-check browser script. README documentation records its historical coverage, but it must be run explicitly to re-verify that suite on a given revision:

```sh
npm run dev -- --host 127.0.0.1
# In another terminal:
python scripts/verify-phase6.py
```

Do not infer that the Phase 6 browser suite passed on the current revision solely from the drawing smoke test or from its historical README entry.
