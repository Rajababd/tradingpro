# Drawing library logic patch (isolated, not yet wired into the app)

The patched vendor bundle lives at `src/vendor/lightweight-charts-drawing.es.js`. The original uploaded bundle is not overwritten.

## Fixes

1. **Stable series identity on reattach** — `DrawingManager.attach` accepts an optional fifth callback `(seriesId) => series`. After `detach()`, drawings can be rebound by their preserved `seriesId` rather than depending on the cleared series object.
2. **No wrong-series fallback** — `importDrawings` only uses `paneIndex` for legacy drawings that have no `seriesId`. If a drawing has a stable ID that cannot be resolved, it is retained unattached. The ID is preserved in subsequent exports.
3. **Pending drawings can be restored later** — `addDrawing` now allows an unresolved drawing to be stored without trying to resolve `undefined` as a series; the next `attach` can bind it when its series becomes available.
4. **Pane index survives detach** — detaching no longer resets the last known pane index to zero, preserving useful serialization metadata for pending drawings.
5. **Dynamic left-scale offset** — pointer x coordinates use the current left price-scale width instead of a hard-coded 80 pixels. If the chart API does not expose it, the code safely falls back to zero.

## Compatibility and API notes

- The original fourth `attach` callback remains the `series => seriesId` resolver. The new optional fifth argument is `seriesId => series`.
- `importDrawings(items, factory, paneResolver, seriesResolver)` keeps its existing parameter order.
- This is a logic patch only. It has **not** yet been verified in a real browser with Lightweight Charts 5.2.1, and the vendor bundle is not yet wired into `ChartController` or React UI.

## Regression checks

Run:

```sh
npm run test:drawing
```

The regression script checks detach/reattach by stable ID, unresolved drawing retention, prevention of pane fallback for known IDs, late restoration, and dynamic left-scale coordinate offset using fake chart/series objects.

## Phase 2: chart-layer integration

`ChartController` now owns a `DrawingController` and exposes it through `chart.drawings`. The controller attaches the drawing manager to the chart/container, resolves drawings by stable `seriesId`, and exposes create/remove/clear/import/export operations. `SeriesManager` emits lifecycle notifications: drawings detach before their target series is removed and unresolved drawings retry attachment when a series is added again. This keeps the saved drawing record alive while its series is temporarily absent.

This integration is an API foundation, not yet a complete drawing toolbar or persistence UI. The vendor package's active-tool method alone does not implement the full pointer-to-anchor creation flow, so the next UI step must verify the library's creation handlers before presenting tools as functional.

## Interactive placement and initial toolbar

The manager now handles click-to-place drawing tools: it collects the number of anchors declared by the selected tool, converts chart-click coordinates through the primary (price) series, creates the drawing, and exits tool mode. Unknown tools and clicks without a valid time/price are ignored safely. The `DrawingController` exposes `setActiveTool()` and a small event subscription surface; the first React toolbar exposes Trend line, Horizontal line, Rectangle, Fibonacci Retracement, Cancel, and Clear drawings.

Scope and verification limits:

- Placement currently targets the permanent price series only. Pane-aware placement for indicators is intentionally not claimed.
- Multi-anchor drawings are placed by successive clicks; there is not yet a live preview while moving the pointer.
- The drawing-specific Node regression harness covers one-anchor and two-anchor placement using a fake chart. A browser run against Lightweight Charts 5.2.1 is still required before treating this as production-ready.
- Dependency installation timed out in this environment, so TypeScript/build verification could not be completed here.
