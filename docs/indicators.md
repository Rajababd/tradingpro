# Indicators

Phase 4 delivered the **calculation layer** (pure incremental calculations, a registry of definitions, an engine that keeps
instances current from market-data events). Phase 6 added **display and control** (the workspace, the Indicators and SMA
menus; see the last section). Saving settings across reloads is Phase 8.

## Structure
```
Kernel (pure step function)  ->  Calculator (series + output columns)  ->  Definition (id, params, outputs, pane, warm-up)
                                                                              |
IndicatorRegistry (what exists; SMA source list derived from it)              |
                                                                              v
IndicatorEngine (named instances + SMAs, candle list, change events)  <-  bindIndicatorsToService  <-  MarketDataService
```
- A **kernel** is `step(state, input) -> { state, values }`, pure, with immutable state. The same `step` produces the first
  calculation and every later update, so incremental equals batch by construction. The `Calculator` keeps the state after
  the last bar **and the state before it**, so revising the live bar re-steps from the earlier state: O(1), no history recompute.
- A **definition** declares: stable `id`, `name`, `defaults`, `validate`, input candle fields, `outputs` (key, label,
  line/histogram, `smaEligible`), preferred `pane`, per-output `warmup`, and how to create a calculator. A test checks every
  declared warm-up against the real calculation.
- The **registry** is the only list of indicators. Menus and the SMA source list are generated from it (`smaSourceOptions()`),
  so adding an indicator is one `register` call.
- The **engine** holds instances with stable caller-chosen ids (`rsi`, `rsi-fast`, `sma-rsi-10`, ...). It computes indicators
  first and SMAs after, within the same change, and notifies listeners only when every instance is up to date.

## Conventions
`null` means "no value": warm-up, or a result that is mathematically undefined. Nothing is ever replaced by 0 or another
stand-in. All outputs are arrays aligned one-to-one with the candles (`engine.times`).

| Indicator | Definition | Parameters | First value at index |
|---|---|---|---|
| **SMA** | mean of the last N non-null inputs; a null input empties the window | period 1..1000 | N-1 (+ the source's own warm-up) |
| **RSI** (Wilder) | seed: mean of first N gains/losses; then `avg = (prev*(N-1)+x)/N`; `RSI = 100*avgGain/(avgGain+avgLoss)` | period 2..500 (14) | N |
| **Volume** | the bar's volume (histogram) | none | 0 |
| **OBV** | `+volume` if close rose, `-volume` if it fell, `0` if unchanged; first bar = its volume | none | 0 |
| **A/D** | `MFM = ((C-L)-(H-C))/(H-L)`, `MFV = MFM*volume`, running sum; zero-range bar: MFM = 0 | none | 0 |
| **MACD** | `EMA(fast) - EMA(slow)`; signal = EMA of MACD; histogram = MACD - signal | fast 1..500 (12), slow 2..500 (26), signal 1..500 (9); fast < slow | MACD: slow-1; signal & histogram: slow+signal-2 |

Details worth knowing:
- **EMA seed:** each EMA starts with the plain mean of its first N inputs (at its own Nth bar), then `k*x + (1-k)*prev`, `k = 2/(N+1)`.
  This is the TradingView/StockCharts convention. TA-Lib seeds the fast EMA differently at the start (see validation below).
- **RSI edge cases:** only gains gives exactly 100, only losses gives exactly 0 (computed as `100 * (avgGain/(avgGain+avgLoss))`
  so rounding can never push it outside [0, 100]). If the price has never moved (both averages 0) RSI is 0/0: **null**,
  not an invented value. It resumes normally on the first move.
- **Missing volume (OBV, A/D):** a bar without volume gives `null` and drops the running total; the next bar with volume
  **starts a new segment** (like the first bar of a series). Values on either side of a gap are not comparable and the line
  breaks there; nothing is invented to bridge it. A real volume of 0 is a real bar. **Volume** shows a missing volume as no bar, never 0.
- **SMA sources:** Price (the close), or an output marked `smaEligible` of an existing indicator instance. An SMA never reads
  another SMA. In the default registry every output (RSI, Volume, OBV, A/D, and MACD's macd/signal/histogram) is eligible.
- **SMA on a source with nulls:** averages only appear after N consecutive real values, so SMA(10) of RSI(14) first has a
  value at index 14+10-1 = 23, and SMA(5) of the MACD signal at 33+5-1 = 37.

## Engine behaviour
- `append(bar)` / `update(bar)` cost O(1) per instance (one kernel step). `reset` and `prepend` recompute everything, because every
  value depends on all earlier bars and prepending shifts every index. Measured: one live update on a 50,000-bar series is
  roughly 1000x cheaper than a full recompute (the test asserts at least 100x).
- Changes are announced as `reset` (re-read the whole output: new instance, parameter change, data reset/prepend),
  `point` (one bar appended or updated) and `removed`.
- `setParams` patches parameters, recomputes the instance and any SMA that reads it. Invalid input throws and changes nothing.
  `remove` is refused while an SMA reads from the instance.
- Bad data fails loudly: an append that is not newer, an update to a different bar, or unsorted input throws `IndicatorSyncError`.
  `bindIndicatorsToService` catches that, logs it, and recomputes from the service's current candles, so the engine cannot stay wrong.
- Calculation is independent of display: nothing here knows about series or panes, so hiding an indicator later cannot lose
  its configuration or values.

## Validation
- **Hand-calculated** examples in `tests/indicatorKernels.test.ts` (each worked out in a comment).
- **Reference implementations** (`tests/indicatorReference.test.ts`, data from `scripts/generate-indicator-reference.py`,
  TA-Lib 0.8.2 + an independent Python implementation, 400 bars incl. unchanged closes and zero-range bars):
  SMA, RSI(14/5), OBV and A/D match TA-Lib to within 1e-10; SMA of RSI matches pandas `rolling().mean()`; MACD (two parameter sets)
  matches the independent SMA-seeded implementation to 1e-10; MACD matches TA-Lib after ~200 bars (below 1e-9), because TA-Lib's
  different fast-EMA seed has faded by then (the difference shrinks by a factor of `1 - 2/13` per bar). Regenerate with
  `python3 scripts/generate-indicator-reference.py` (needs numpy, pandas, TA-Lib).
- **Incremental == batch**, bit for bit, over random streams with repeated revisions of the live bar and missing volumes
  (`tests/indicatorIncremental.test.ts`, `tests/indicatorEngine.test.ts`).
- **Mutation checks** done by hand while building this phase: deliberately breaking the SMA window, OBV comparison, EMA seed,
  update-from-wrong-state, A/D zero-range handling, and engine ordering each made the suite fail.
- Found and fixed by the tests: RSI returned 99.99999999999999 instead of 100 when there were no losses.

## Display and control (Phase 6)
`IndicatorWorkspace` (`src/indicators/IndicatorWorkspace.ts`) is the only thing the menus talk to. It connects the engine to chart
series and holds the user's settings. Spec section 8 distinguishes five states, which are kept apart:

| State | Where it lives |
|---|---|
| **available** | the registry (what exists) |
| **configured** | parameters in the engine instance; each SMA's period in the workspace |
| **initialised** | the chart series exist: created the first time something is shown, then only hidden and shown |
| **displayed** | *derived* from the visibility controller (any output series visible); never stored, so the menus cannot disagree with the chart |
| **cached** | calculations stay in the engine while hidden; hidden series keep receiving data, so showing one is instant and never stale |

- **Series ids:** indicator outputs are `<indicator>:<output>` (`rsi:rsi`, `macd:signal`); an SMA is `sma:<source key>` (`sma:price`,
  `sma:macd:signal`), with engine instance `sma-<source key>`. One SMA per source, with a stable identity; multiple SMAs per
  source are a later extension.
- **Which pane:** an indicator goes in its own pane (MACD's three lines share one); **an SMA goes in its source's pane**, on the same
  scale (price SMA in the price pane, an indicator's SMA in that indicator's pane). An SMA on a source that is not displayed works:
  the source is calculated but not drawn, and its pane shows just the SMA (the row says "source not shown").
- **Toggles:** an indicator's switch shows or hides all its outputs. A multi-output indicator also has per-line chips (Scenario B in the UI).
  Showing a source never switches its SMA on, and hiding it never switches its SMA off.
- **Defaults:** nothing is displayed and no SMA is on at start (a clean chart); every SMA starts at period 20; Price is first in the SMA list.
- **Source list:** the SMA menu is generated from `registry.smaSourceOptions()`: Price, then every eligible output.
- **Settings:** integer fields commit on Enter or blur, revert on Escape, and show the engine's reason for a refusal; a refusal changes nothing.
  A period set while an SMA is off is remembered and used when it is turned on.
- **Gaps in lines:** the chart library bridges missing points in a line (measured; it ignores whitespace for lines), which would draw a
  continuous OBV straight through bars with no volume. Each line segment takes the colour of the point it starts from, so the last point
  before an interior gap is given a fully transparent colour: the bridge becomes invisible (checked pixel by pixel in the browser).
  The library's `update()` cannot change an older point, so when a live bar ends a gap the series is rewritten with `setData` (rare).
  Histograms need none of this: an absent bar is simply absent.
- **Colours:** RSI and OBV use the accent colour, A/D violet, MACD accent and signal amber, MACD histogram and volume bars by sign or candle
  direction (teal/orange, readable with red-green colour blindness). SMAs cycle through five colours by their position in the source list,
  so a source keeps its colour.

## Not done (later phases)
- Persisting indicator and SMA settings (Phase 8).
- Price SMA uses the close only; other price fields (open, high/low, typical price) are not offered yet.
- Settings are lost on reload (they are not persisted until Phase 8).
- One SMA per source; only the close for Price.
