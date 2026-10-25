# Lightweight Charts 5.2.1: measured behaviour

Everything below was measured in headless Chromium against the installed 5.2.1 build, not
taken from memory or docs. `scripts/verify-phase2.py` re-checks the pane and series rows
against the real library; re-run it before trusting this file after any upgrade.

## Panes
| Observation | Consequence in TradingPro |
|---|---|
| `addSeries(def, opts, i)` with `i == panes.length` appends a new pane | New panes are created by adding a series at the end |
| `i > panes.length` is clamped to the next index (asking for 5 gave 1) | Never rely on the requested index; `PaneManager.indexFor` computes it |
| Removing a pane's last series deletes the pane; later panes shift down | `PaneManager` keeps the logical slot so the pane returns to its place |
| `setPreserveEmptyPane(true)` keeps an empty pane | Not used yet |
| `removeSeries` on the price series removes pane 0 (the next pane becomes index 0) | Price series is protected in `SeriesManager` |
| `removePane(i)` deletes the pane and its series; their handles then throw | Not exposed; explicit pane removal is a later feature |
| `removeSeries` twice throws | `SeriesManager.remove` throws "unknown series" first |
| **`IPaneApi.moveTo(i)` only works for `i == 0` or no movement; any other target throws "Invalid pane index"** | Never used |
| `chart.swapPanes(a, b)` works; stretch factors travel with their pane | New pane is appended, then bubbled into place with adjacent swaps |

## Visibility and sizing (for Phase 5)
- `series.applyOptions({ visible: false })` keeps the series, its data and its pane. **The pane keeps its height**; nothing collapses automatically.
- Default heights come from stretch factors (price 2, others 1): 381px / 190px in a 600px chart.
- `pane.setStretchFactor(0.01)` shrinks a pane to a ~3px sliver, not zero; the separator stays.
- Restoring means setting the previous stretch factor back, so **save it before collapsing** (setting 1 is wrong when the original was 2).
- `getHeight()` reads 0 until the chart has rendered a frame; wait two animation frames before measuring.

## Crosshair
- Real pointer events fire `subscribeCrosshairMove`; `setCrosshairPosition()` does **not** notify subscribers.
- Each event carries `time`, `logical`, `paneIndex` and `seriesData` for **every** series, whichever pane is hovered. So the OHLC legend works from any pane.
- Leaving the chart fires an event with no time/logical.
- A viewport change under an idle pointer (e.g. `fitContent`) re-emits the crosshair for the candle now under it.
- Touch: **press-and-hold** shows the crosshair, sliding while held moves it, the crosshair stays after release. A quick tap does nothing; a quick drag pans.

## Coordinates and viewport (for Phase 7)
- `logicalToCoordinate` / `coordinateToLogical` and `priceToCoordinate` / `coordinateToPrice` round-trip exactly.
- Off-screen inputs return large off-screen numbers, not `null` (e.g. logical -10000, price 1e9). Drawing code must clip itself.
- `fitContent()` on N candles yields logical range `0 .. N-1`. It does not emit if the range is unchanged.
- `scrollToRealTime()` is animated (~1s).
- The library formats axes with `navigator.language`; a malformed tag throws and the chart draws nothing.

## Live updates and paging (Phase 3, measured with `scripts/verify-phase3.py`)
- `series.update(bar)` replaces the latest bar when the time matches and appends otherwise. Used for every live tick; `setData` is called only for a load or a prepend.
- When the user has scrolled into the past (newest bar out of view), appending bars **does not move the visible range**. When the live edge is visible the library follows new bars.
- `scrollToRealTime()` animates for ~1 s toward the newest bar **as it was when it started**. Bars appended during the animation leave the view behind, and it then stops following. Do not run a fast feed during it.
- After `setData` with older bars prepended, the visible logical range is **not** shifted by the library: the same *logical* window now shows different candles. `ChartController.prependCandles` shifts the range by `added`; with that, the candle under a stationary pointer is unchanged and the range moved by exactly `added`.
- Right after a data load the library emits its own small range events, one of which can read as a leftward move. Range events carry no source, so user gestures are detected separately (`UserGestureTracker`).
- At fit-to-data zoom the whole loaded history fills the screen: dragging toward the past immediately reaches the start of the data.

## Collapsing a pane (Phase 5, measured with `scripts/verify-phase5.py` and a DOM probe)
- `pane.setStretchFactor(0)` is accepted and collapses a pane to a **2 px sliver plus a 1 px separator** (3 px per hidden pane). Zero is the floor: the library does not hide a pane entirely. With three hidden panes the price pane gets all but about 9 px, and the leftover shows as thin stacked lines above the time axis.
- Stretch operations are local: collapsing or restoring one pane leaves every other pane's factor untouched, so restoring the saved factor reproduces the original layout exactly (checked to the pixel, and over 80+ hide/show cycles).
- **`pane.setHeight(px)` rewrites the stretch factors of ALL panes** (they became 1.93 / 0.15 / 0.93 from 2 / 1 / 1). It is never used.
- Dragging a separator with the mouse really resizes panes (the user changes stretch factors), so a pane's size is not a constant: it must be read and saved when hiding, never assumed.
- Collapsing happens after `series.applyOptions({visible:false})`; hiding a series alone never changes pane size.

## Whitespace, line gaps and per-point colour (Phase 6, measured in the browser)
- `series.data()` returns only real points. Whitespace items (`{ time }`) are accepted but are **not** listed (300 sent, 286 returned
  with 14 warm-up whitespace points). Compare chart data to calculations by time, not by position.
- **A line series is drawn straight across missing points**: whitespace does not break it in 5.2.1 (an OBV with ten bars of missing
  volume was a clean diagonal across them). The typings offer no gap option.
- A line point's `color` colours the segment that **starts** at that point (the segment leaving it), not the one arriving. Giving the last point
  before a gap a transparent colour hides the bridge; giving it to the first point after the gap hides only the next segment (~1 bar).
- `series.update()` can replace the latest point or add a newer one; it cannot change an older point, so recolouring one means `setData`.
- RSI with an `autoscaleInfoProvider` of 0-100 still shows the library's margins (the axis labels reach about 120).

