# Drawing library and application integration notes

The patched vendor bundle is `src/vendor/lightweight-charts-drawing.es.js`. This document records the current implementation and verification boundaries; it supersedes older statements in this file that described the patch as unwired or unverified.

## Stable series identity and restoration

1. `DrawingManager.attach` accepts an optional fifth callback `(seriesId) => series`. After detach, drawings can rebind using their preserved `seriesId`.
2. `importDrawings` uses `paneIndex` as a legacy fallback only when a drawing has no `seriesId`. If a stable ID cannot be resolved, the drawing is retained unattached instead of being attached to a different series.
3. Unresolved drawings can be stored and rebound when the target series becomes available.
4. Detach preserves the last known pane index as serialization metadata.
5. Pointer x coordinates use the current left price-scale width instead of a hard-coded 80-pixel offset, with a safe fallback when the API does not expose the width.

Compatibility:
- The fourth `attach` callback remains the `series => seriesId` resolver.
- The optional fifth callback is `seriesId => series`.
- `importDrawings(items, factory, paneResolver, seriesResolver)` retains its parameter order.

## Chart-layer integration

- `ChartController` owns a `DrawingController` exposed as `chart.drawings`.
- The controller provides create/remove/clear/import/export operations and connects the manager to the chart/container.
- Drawings resolve their target through stable `seriesId` values.
- Series lifecycle notifications detach drawings before their target series is removed and retry attachment when a matching series is added again.
- The React drawing toolbar exposes Trend Line, Horizontal Line, Rectangle, Fibonacci Retracement, Cancel, and Clear drawings.

## Placement and coordinates

- Placement uses a container `pointerup` handler rather than Lightweight Charts `subscribeClick`, with guards for primary-button input, chart/container/series presence, chart bounds, time-scale width, price-pane height, valid time/logical conversion, and finite price.
- One-anchor tools complete on one click/tap; two-anchor tools wait for the second click/tap.
- Newly placed anchors store both timestamp and logical bar index.
- Rendering prefers logical coordinates where available and retains timestamp fallback for legacy drawings.
- When older candles are prepended, logical anchors are shifted to keep drawings aligned with the same candles.
- Bar-span measurement uses logical-index distance where available; day-span measurement remains timestamp-based.
- Drag/edit paths preserve both logical and timestamp coordinates.

## Regression coverage

`npm run test:drawing` exercises drawing-manager lifecycle and stable series identity, unresolved/pending restoration, protection against wrong-series fallback, dynamic scale offsets, interactive one-/two-anchor placement, logical-coordinate precedence, legacy fallback, serialization round-trip, prepend shifting and measurement behavior.

The CI workflow additionally runs the full project tests, TypeScript type-check, production build, and `scripts/verify-drawing-app.py` in desktop and phone-sized Chromium contexts.

## Explicit limitations

- Indicator-pane-aware placement is not implemented; current placement targets the price series.
- There is no live preview before completing a multi-anchor drawing.
- The toolbar exposes Clear drawings, but no dedicated individual-delete control is exposed in the toolbar.
- Although manager APIs exist for selection/hit-testing and import/export, the current browser smoke test does not establish complete selection/editing/deletion UX.
- Export/import APIs exist, but persistence to durable storage and restoring drawings after a page reload are not established by the current app integration.
- Rectangle and Fibonacci Retracement are listed in the toolbar, but end-to-end browser acceptance for these specific tools remains outstanding.

These limitations are not automatically Phase 6 blockers: the README defines the original Phase 6 as the SMA system and top bar and describes drawings/persistence as later-phase work. Decide their status against the agreed product acceptance criteria rather than silently expanding Phase 6 scope.
