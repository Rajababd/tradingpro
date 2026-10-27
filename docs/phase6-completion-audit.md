# TradingPro — Phase 6 and drawing changes acceptance audit

**Audited revision:** `d5ccf2a8558e481a2b11f685f317fd051ccec485` (PR #2 merged into `main`).  
**Purpose:** record the recent drawing changes and distinguish verified results from deferred or unverified behavior.

## 1. Repository and scope

The official core is the Phase 6 project in this repository. Preserve its existing indicator/SMA behavior; do not replace it with an older independently developed version. The repository README defines original Phase 6 primarily as the SMA system, Indicators/SMA dropdowns, and top bar. Drawing support is an additional extension, while persistence and backend work are documented as later-phase scope.

## 2. Changes completed

### A. Pointer placement
- Replaced drawing placement through Lightweight Charts `subscribeClick` with a container-level `pointerup` path.
- Added guards for primary-button interaction, chart/container/series availability, chart bounds, time-scale and price-pane dimensions, valid time/logical conversions, and finite price values.
- Preserved the intended interaction contract: one-anchor tools finish after one click/tap; two-anchor tools wait for the second click/tap.
- Kept drag/edit completion paths in the manager.

### B. Logical/time coordinate consistency
- Added a coordinate helper that prefers `logicalToCoordinate(anchor.logical)` when a finite logical index exists, with timestamp-based fallback for legacy anchors that have no logical value.
- New anchors store both logical bar index and timestamp, along with price.
- Mouse-move and pixel-to-anchor paths preserve/update both coordinate representations.
- Legacy time-only anchors are normalized to logical coordinates when possible.
- Prepending older candles shifts logical indices for completed and pending anchors while leaving timestamps stable.
- Bar-span measurement uses logical-index distance where available; calendar-day measurement remains timestamp-based.

### C. Drawing library and series lifecycle
- Kept drawing records associated with stable `seriesId` values.
- Reattachment resolves the current series from `seriesId` rather than relying on stale object references.
- Unresolved drawings remain unattached instead of falling back to a different series.
- Pending drawings can bind when the target series becomes available.
- Detach preserves pane metadata.
- Replaced the hard-coded left price-scale offset with the current scale width when available.
- Connected the manager through `DrawingController` owned by `ChartController`, with create/remove/clear/import/export APIs and series lifecycle notifications.
- The toolbar offers Trend Line, Horizontal Line, Rectangle, Fibonacci Retracement, Cancel, and Clear drawings.

## 3. Verification evidence

The post-merge GitHub Actions run reported success for:
- Drawing-library regression tests.
- Project test suite: 28 test files and 383 passing tests.
- TypeScript type-check.
- Production build.
- Browser drawing smoke test on desktop and phone-sized Chromium contexts.

The browser smoke test verifies Trend Line two-anchor placement, one-anchor placement, price-series identity, tool exit, and absence of browser page exceptions in the tested flows. These are CI results; they do not mean the same commands were executed locally.

The current workflow does **not** run `scripts/verify-phase6.py`, the separate 118-check Phase 6 indicator/SMA browser suite. README describes that suite's historical coverage, but it must be explicitly run against the target revision before claiming that it has been re-verified.

## 4. Acceptance matrix

| Area | Current evidence | Status |
|---|---|---|
| Drawing-library lifecycle and stable series identity | Regression suite in CI | Verified by tests |
| One-anchor placement | Desktop/phone browser smoke | Verified for tested tool |
| Two-anchor Trend Line placement | Desktop/phone browser smoke | Verified |
| Logical/time coordinate behavior | Regression tests | Verified by tests |
| Logical-anchor shift after prepending candles | Regression tests | Verified by tests |
| TypeScript and production build | Post-merge CI | Passed |
| Phase 6 indicator/SMA UI suite | Dedicated script not in current workflow | Re-run required for current revision |
| Rectangle/Fibonacci in real browser | Not in current smoke test | Not yet verified end-to-end |
| Selection/editing existing drawings through app UI | Not covered by current smoke test | Not yet accepted end-to-end |
| Individual deletion UI | Toolbar exposes Clear, no dedicated individual-delete control | Not exposed in current toolbar |
| Save/restore across page reload | No durable-storage integration established | Deferred/unverified |
| Indicator-pane drawing placement | Price-series target only | Known limitation |
| Live multi-anchor preview | Not implemented | Known limitation |
| Real Android device / non-Chromium browsers | Not tested by current workflow | Not verified |

## 5. Known non-blocking build note

The production build emitted a source-map warning for `src/vendor/lightweight-charts-drawing.es.js`, while the build job still passed. This warning should be revisited if source-level debugging of the bundled vendor file becomes necessary; it was not a CI failure.

## 6. Recommended next steps

1. Run `python scripts/verify-phase6.py` against the current revision and record its actual pass/fail output.
2. Add browser acceptance tests for Rectangle and Fibonacci Retracement.
3. Define and test the expected selection/edit/delete workflow if it is part of the agreed scope.
4. Decide explicitly whether drawing persistence, indicator-pane placement, and live preview belong to this phase or a later phase.
5. Only mark Phase 6 complete after the original Phase 6 acceptance suite and product scope are confirmed. Do not classify deferred features as regressions without acceptance criteria.

## References

- Drawing browser verification: `docs/drawing-browser-verification.md`
- Drawing library integration notes: `docs/drawing-library-patch.md`
- Original Phase 6 behavior: `scripts/verify-phase6.py`
- CI workflow: `.github/workflows/verify.yml`
- PR #2: https://github.com/Rajababd/tradingpro/pull/2
- Post-merge CI run: https://github.com/Rajababd/tradingpro/actions/runs/40493435441
