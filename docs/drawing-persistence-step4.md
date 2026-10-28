# Step 4 — Drawing persistence and recovery

## Changes
- Added `src/chart/DrawingStorage.ts` for versioned local storage (`version: 1`), symbol/timeframe-specific keys, structural validation, and safe handling of malformed JSON or unavailable/quota-limited storage.
- Wired drawing lifecycle events in `src/app/App.tsx` to a debounced autosave.
- Restores saved drawings only after initial market data has loaded, so chart series and candle data exist before import.
- Flushes the final drawing state on teardown only after persistence initialization, avoiding an early React/StrictMode cleanup from overwriting saved drawings with an empty list.
- Added `tests/DrawingStorage.test.ts` for round-trip, isolated keys, invalid payloads, duplicate IDs, unsupported versions, and storage exceptions.

## Verification status
- Source and event names were inspected against the bundled drawing library.
- Local install/build/browser verification was not completed in the available environment. Do not treat this step as fully verified until GitHub Actions passes typecheck, tests, build, and browser checks for add/edit/delete/reload and symbol/timeframe separation.
