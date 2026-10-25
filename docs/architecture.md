# Architecture (through Phase 6)

## Layers
- `src/types` — domain types. `UnixSeconds` (branded) keeps market timestamps distinct from
  chart logical indices and pixels.
- `src/data` — provider interface, validator/normalizer, `CandleStore`, `PollingFeed`, `MarketDataService`, historical loader, simulated fixture. See `docs/market-data.md`.
- `src/chart` — `ChartController` (sole owner of the chart) and the managers it composes:
  `SeriesManager` (series by stable id), `PaneManager` (logical pane order), `ViewportController`
  (logical range), `CrosshairController` (pointer inspection). `ChartPort` is the narrow slice of
  the library API they use, so they are testable with a small fake.
- `src/indicators` — pure indicator kernels, the registry, and `IndicatorEngine` (calculation only; nothing is drawn yet). See `docs/indicators.md`.
- `src/ui` — React components and pure formatters (crosshair legend).
- `src/utils` — `EventChannel`, a listener set with lazy upstream subscription.
- `src/app` — React shell, config, theme, styles, and `bindChartToService` (the one place data events become chart calls). React never touches the chart API directly.

## Decisions
1. **One chart instance, owned by `ChartController`.** Single-use lifecycle: `mount` is idempotent
   for the same container and throws for a different one; `dispose` is idempotent; a disposed
   controller cannot be reused. React effects create a fresh controller each run, which makes
   StrictMode's mount/unmount/mount safe.
2. **Price series lives in pane 0** (`PRICE_PANE_INDEX`). Verified against installed
   lightweight-charts 5.2.1 typings: `addSeries(def, options, paneIndex)`, `panes()`,
   `removePane()`, and `IPaneApi.setHeight/setStretchFactor/setPreserveEmptyPane` exist.
3. **Providers return raw `unknown[]`.** Everything passes through `normalizeCandles`, so no provider
   can bypass validation. Providers parse their own wire formats; numeric strings are not coerced.
4. **`setCandles` replaces the dataset and refits the view.** Incremental updates (Phase 3) will use a
   separate method that does not touch the viewport.

## Series, panes and visibility (Phase 2)
- **Series have stable string ids; panes have stable string ids.** Chart indices are derived, never stored.
- **Logical pane order survives the library's pane deletion.** `PaneManager` keeps the order and a per-pane series count; a pane that loses its last series disappears from the chart but keeps its slot, and returns there when a series is added again.
- **New panes are appended, then swapped into place** with adjacent `swapPanes` (the library's `moveTo` is broken in 5.2.1; see `docs/lightweight-charts-notes.md`).
- **Hiding is `visible:false`**, never removal. The series, data and pane stay. Removal is a separate explicit call, and the price series is protected.
- **Atomicity:** nothing is recorded unless the chart accepted the operation; a failed pane swap rolls the new series back.
- **Subscriptions are lazy and owned.** Crosshair and viewport events attach to the chart only while a listener exists, are detached on `dispose` before the chart is destroyed, and are delivered as plain callbacks, so pointer moves never cause React renders (the legend writes `textContent`).
- **Not yet built:** collapsing a pane whose series are all hidden, and derived pane visibility (Phase 5). The measurements it needs are already in the notes file.

## Data flow (Phase 3)
`MarketDataService` owns the candle series and publishes two things: **state snapshots** (status, errors, feed
health; consumed by React through `useSyncExternalStore`) and **change events** (`reset | append | update | prepend`;
consumed imperatively by the chart, and by indicators in Phase 4). A live tick therefore costs one `series.update()`
and one small state update, never a chart rebuild or a React render per candle. The service is framework-free and
fully unit-tested with scripted providers and fake timers.

## Visibility and panes (Phase 5)
**One state, one door.** `VisibilityModel` (pure) is the only record of what is shown: every series has its own visibility, and a
pane's visibility is *derived* (visible while any of its series is). `VisibilityController` is the only code that adds, shows, hides
or removes chart series; `ChartController.series` is a read-only view, so a menu handler cannot bypass it (the compiler refuses).
Pane order stays in `PaneManager` and is never touched by hiding.

| User action | Library operation |
|---|---|
| hide / show one series (others remain in its pane) | series `visible` option only |
| hide the last visible series of a pane | save the pane's stretch factor, then `setStretchFactor(0)` |
| show any series of a collapsed pane | restore the saved stretch factor (the user's own size if they resized it) |
| remove a series (explicit, for good) | `removeSeries`; the library deletes a pane that empties, the logical slot and last size are remembered |

Consequences, all verified against the real library: nothing is re-created when toggling (the same series object lives on, no duplicates);
configuration, data and (later) drawings are untouched by hiding; pane order never changes; only the price pane left means it
gets the space; an SMA's visibility is independent of its source's; the price series and pane can never be hidden or removed.
Limit: the library cannot hide a pane entirely, so each hidden pane leaves about 3 px (see `docs/lightweight-charts-notes.md`).
Creating, removing and layout restore are atomic: if the chart refuses a change, the state is rolled back.

## The menus (Phase 6)
`TopBarMenus` renders two `Dropdown`s (Indicators, SMA) whose rows come from the workspace snapshot, which is generated from the
registry. The menus keep **no** indicator state: a switch shows what the chart currently shows and a click calls the workspace, which
calls the visibility controller. A `Dropdown` is only a view: opening or closing it changes nothing; it closes on Escape, its Close
button or any press outside (including on the chart, so it never blocks chart gestures), is placed in viewport coordinates
(`placePanel`, unit-tested to never leave the screen) and scrolls inside itself when content is taller than the room. Touch targets are
40-44 px, switch rows are tappable across their whole width, and number fields use 16 px text so phones do not zoom on focus.

A development-only seam (`window.__tradingpro`, `src/app/devHook.ts`) exposes the live chart, service, engine and workspace so the browser
checks can drive the real UI and assert on the real chart. It is guarded by `import.meta.env.DEV`, and `npm run build` ends with `scripts/check-bundle.mjs`, which fails the build if the seam
ever appears in `dist`.

## Indicators (Phase 4)
Indicators are pure step functions folded over the candle series; the engine keeps named instances current from the same
`MarketDataService` events the chart uses, recomputing only the latest bar on a tick. Calculation is deliberately unaware of
charts, panes and visibility, so those can be added (Phases 5-6) without touching it, and hiding an indicator cannot lose data.

## Data-validation policy (`src/data/validator.ts`)
- Invalid candles are rejected and reported with their raw input index; never repaired.
- Valid: positive integer `time` in seconds (millisecond values get a distinct error), finite OHLC,
  `high >= open, close, low`, `low <= open, close, high`.
- Volume: missing or `null` becomes `null` (never 0); an explicit 0 is kept; negative or non-finite is rejected.
- Out-of-order input is sorted ascending and reported once (`OUT_OF_ORDER`).
- Duplicate timestamps: the last occurrence in the input wins; each replaced candle is reported (`DUPLICATE_TIME`).
- `loadHistoricalCandles` fails loudly (`DataLoadError`) on fetch failure, empty or non-array
  response, or when no candle is valid. Partial success returns candles plus the issue list.
- Zero or negative prices are currently accepted if the OHLC relations hold. Equity feeds may want to
  reject them; decide when a real provider is added.

## Simulated data
`FixtureProvider` has `isSimulated = true`; the UI shows a permanent SIMULATED DATA badge.
