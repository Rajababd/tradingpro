# Drawing browser verification

The drawing library's unit-style regression checks do not prove that Lightweight Charts dispatches real pointer/touch interactions as expected. `scripts/verify-drawing-app.py` is the browser-level smoke test for that integration.

## Run

1. Install dependencies with `npm ci`.
2. Start the dev server: `npm run dev -- --host 127.0.0.1`.
3. In another terminal run: `python scripts/verify-drawing-app.py`.

The script expects Chromium at `/usr/bin/chromium` and Playwright's Python package. It checks desktop mouse clicks and mobile taps, verifies the exported drawings through the development-only `window.__tradingpro` test seam, and checks one-anchor/two-anchor completion and price-series identity.

## Limits

This is a smoke test, not a complete drawing QA suite. It does not yet verify rendering pixels, drag editing, drawing selection, pane-specific indicator drawings, persistence across page reload, or browser variants. The current execution environment did not complete `npm ci`, so this browser test has been added but has not been run here. Do not interpret it as a passing browser result until the script reports all checks as PASS.
