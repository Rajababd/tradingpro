# AI handoff prompt — TradingPro recent work and current state

You are continuing development of the TradingPro financial charting application. Read this document and the repository documentation before editing any source. Treat the current repository as the source of truth.

## Project identity and constraints

- Repository: `Rajababd/tradingpro`.
- Stack: TypeScript, React, Vite, Lightweight Charts 5, indicator engine and chart/series/pane managers.
- Official core: the Phase 6 project in this repository (originally delivered as `tradingpro-phase6.zip`). An older manually developed TradingPro is only a behavioral/reference source; do not blindly merge it or replace the current project with it.
- Preserve existing Phase 6 features and architecture. Work incrementally, audit before modifying, and do not claim tests passed unless their actual results are available.
- Requirements documented in README: indicators RSI, Volume, OBV, Accumulation/Distribution, MACD; SMA can use price or eligible indicator outputs; series visibility and pane behavior; top-bar controls. Indicator settings persistence is deferred to Phase 8. The data feed remains simulated; do not imply a real DSE feed has been integrated.

## Recent completed work

PR #2, “Fix drawing placement and logical/time coordinate consistency,” was merged into main as commit `d5ccf2a8558e481a2b11f685f317fd051ccec485`.

### 1. Interactive drawing placement
- Drawing placement now uses a container-level `pointerup` handler instead of Lightweight Charts `subscribeClick`.
- Input is guarded for primary-button interaction, missing chart/container/series, out-of-chart coordinates, invalid time/logical conversion, and invalid/non-finite prices.
- One-anchor tools complete on one click/tap. Two-anchor tools wait for the second click/tap.
- Drag/edit completion paths remain supported in the drawing manager.
- The toolbar includes Trend Line, Horizontal Line, Rectangle, Fibonacci Retracement, Cancel, and Clear drawings.

### 2. Logical/time coordinates
- New anchors preserve `logical` bar index, `time`, and `price`.
- Rendering prefers logical coordinates when present and valid, falling back to timestamp coordinates for legacy anchors without logical indices.
- Legacy time-only anchors are normalized when possible.
- Mouse/pixel conversion paths preserve both logical and timestamp values.
- When older candles are prepended, logical anchors (including pending anchors) shift so drawings stay associated with the same candles; timestamps remain unchanged.
- Bar-span measurements use logical-index distance where possible; day-span measurements remain timestamp-based.
- Regression coverage includes coordinate precedence, legacy fallback, serialization round-trip, prepend shifts, editing coordinate preservation, and bar/day measurement behavior.

### 3. Stable series identity and lifecycle
- Drawings preserve stable `seriesId` rather than depending on stale series object references.
- Reattachment resolves the current series by ID.
- Unresolved drawings are retained unattached instead of incorrectly binding to another series.
- Pending drawings can be rebound when the target series becomes available.
- Detach preserves the last known pane metadata.
- Left price-scale offset uses the actual scale width when exposed, not a fixed 80 px assumption.
- `ChartController` owns `DrawingController` and exposes create/remove/clear/import/export APIs; series lifecycle notifications detach/rebind drawings around series removal/addition.

## Verification already reported

The post-merge GitHub Actions run passed:
- Drawing-library regression suite.
- Project tests: 28 files / 383 tests passed.
- TypeScript type-check.
- Production build.
- Browser drawing smoke test in desktop and phone-sized Chromium contexts.

The browser smoke test specifically verifies one-anchor placement and two-anchor Trend Line placement, price-series attachment, tool exit, and no browser page exceptions. These are CI results, not local test results.

CI run: https://github.com/Rajababd/tradingpro/actions/runs/40493435441  
PR #2: https://github.com/Rajababd/tradingpro/pull/2

## Known gaps — do not describe these as completed

- Current CI does not run `scripts/verify-phase6.py`, the separate 118-check browser suite for indicator/SMA menus. Re-run it on the current revision before claiming Phase 6 browser acceptance is re-verified.
- Rectangle and Fibonacci Retracement exist in the toolbar but are not covered end-to-end by the current browser smoke test.
- End-to-end selection/editing/deletion workflows are not fully established by the current browser tests. Toolbar has Clear drawings but no dedicated individual-delete control.
- Drawing import/export APIs exist, but durable persistence and restore after page reload have not been established.
- Drawing placement currently targets the price series, not indicator panes.
- There is no live preview while positioning a multi-anchor drawing.
- Real Android hardware and browsers other than Chromium have not been tested.
- Build logged a nonfatal vendor source-map warning; build itself passed.

## Required workflow for future work

1. Inspect the relevant files and tests before proposing edits.
2. Clarify whether a reported issue is a regression, an acceptance requirement, or deferred scope.
3. Preserve existing Phase 6 functionality; avoid broad refactors and blind merges.
4. Make one focused change at a time and add/update regression tests.
5. Run relevant checks and report exactly which commands ran and their actual results.
6. Use GitHub Actions when local environment limitations prevent reliable verification.
7. Update the relevant docs when behavior, test coverage, known limitations, or phase scope changes.
8. Do not mark Phase 6 complete until the original Phase 6 browser suite is run against the target revision and product acceptance scope is agreed.
9. Do not claim that drawing persistence, indicator-pane drawing, live preview, individual delete UI, or full Rectangle/Fibonacci browser flows exist unless implemented and tested.

## Immediate suggested next task

Run `scripts/verify-phase6.py` against the current main revision, capture pass/fail output, then extend browser acceptance tests for Rectangle and Fibonacci Retracement. After that, decide with explicit scope whether selection/edit/delete UX, persistence, indicator-pane targeting, and live preview are required now or deferred.
