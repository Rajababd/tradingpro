# Market data

## Layers
```
MarketDataProvider  (raw records, one per source)
      │  raw unknown[]
validator.normalizeCandles / CandleStore.applyUpdate     <- every record is validated here
      │
MarketDataService   (state + events)  ── PollingFeed / any LiveFeed (transport)
      │ events: reset | append | update | prepend
bindChartToService  ── ChartController (setCandles | updateCandle | prependCandles)
```
Indicators (Phase 4) will subscribe to the same events, so they update incrementally too.

## Provider contract (`src/data/MarketDataProvider.ts`)
| Member | Meaning |
|---|---|
| `id`, `displayName` | Identity shown in errors and the UI |
| `isSimulated` | `true` for fixtures. The UI shows SIMULATED DATA and never labels such a feed "Live" |
| `fetchHistorical({symbol, timeframe, limit?, before?, signal?})` | Newest `limit` candles strictly earlier than `before` (or the newest overall). Must honour `signal` |
| `fetchLatest({symbol, timeframe, signal?})` *(optional)* | The forming candle, plus the just-closed one on rollover. Re-sending an unchanged candle is fine. No `fetchLatest` means no live updates |

Providers return **raw `unknown[]`**. They parse their own wire format (numeric strings are not coerced) and
may not skip validation: the service always validates. Provider-specific details (auth, rate limits, the
right polling interval) belong in the provider and `src/app/config.ts`, never in the chart or service.

**Damascus Securities Exchange (`src/data/DSEProvider.ts`):** the app is configured for the DSE endpoints currently mapped in
the provider: DWX, AVOC, ABC, BBSY, NIB and AHT. The provider fetches historical **daily** records and converts numeric
strings and date fields at the source boundary. The index endpoint may use a wrapped payload (`value_and_date`), while
issuer endpoints may return a direct array or a `data` array. Unsupported payloads and rows without a full OHLC tuple
fail clearly; the provider does not fabricate open/high/low values from a close-only point.

The chart's **1D / 1W / 1M** selector is a display aggregation, not a request for intraday/weekly/monthly source data:
weekly bars combine daily sessions into Monday-starting trading weeks; monthly bars combine sessions by calendar month.
For each bucket, open is the first session's open, close the last session's close, high/low are extrema, and volume and
traded value are summed only when every contributing daily value is present. The candle timestamp is the first actual
trading session in the bucket, avoiding synthetic weekend timestamps. Selecting a different symbol or timeframe reloads
the series and restores drawings from that symbol/timeframe's separate storage key.

The DSE feed is polled every five minutes because the wired source is historical daily data, not an intraday stream.
Direct browser access depends on DSE allowing cross-origin requests (CORS). If the browser blocks these requests, a
same-origin server/proxy is required; this client-only change does not silently bypass that browser security boundary.
The endpoint schemas and live CORS behavior must be verified in the deployed browser before considering the integration
production-ready.

## Update policy (`CandleStore`)
| Incoming candle | Result |
|---|---|
| newer than the latest | **appended** (gaps are allowed: weekends, halts; nothing is invented to fill them) |
| same time as the latest, values differ | **updated** (latest replaced) |
| same time, identical values | **unchanged** (no event, no chart work, counted) |
| older than the latest | **stale**: refused and counted. The live path never rewrites closed bars; a correction to history needs a reload |
| invalid | **rejected**: never applied, counted |

Batches are sorted and de-duplicated first (last duplicate wins). A batch where *nothing* is valid is a
**failed poll** (it throws to the feed, which backs off); a batch that is only stale is *not* a failure.

## Loading and paging
- Identical concurrent `load()` calls share one request. A different request aborts the running one and its
  late result is discarded. `load()` never rejects: read `state.status` / `state.error`.
- `loadOlder()` pages backwards with `before = first candle's time`. It does nothing unless history is ready,
  not exhausted, not already loading, and not cooling down. Overlap with existing data is dropped (existing wins).
  An empty page, or a page that adds nothing, marks history **exhausted**, so a provider that ignores `before`
  cannot cause endless paging. A failed page backs off for `olderRetryCooldownMs` (default 5 s).
- Paging is triggered by the app only on a **real user gesture** moving **left** near the start of the data
  (`bindChartToService`, `UserGestureTracker`). The library emits its own range events while settling after a load;
  those must not trigger requests.

## Live updates
- `PollingFeed`: first poll immediately, then `intervalMs` after each request **completes** (requests can never
  overlap). Failure backs off `interval, 2x, 4x...` up to `max(interval, 30 s)` and recovers on the first success.
  `stop()` aborts the in-flight request and ignores its late result. Interval is a required, provider-specific option.
- Any other transport (WebSocket) implements `LiveFeed { start(handlers); stop() }` and plugs into
  `MarketDataService.startLive({ feed })` with no change to the chart.
- Freshness is exposed in `state.live` (`lastSuccessAt`, `consecutiveFailures`, `lastError`, `nextAttemptAt`) and
  `state.lastUpdateAt` (when data last actually changed).

## Logical indices and history changes
Candles are addressed on the chart by logical index. **Prepending `n` older candles shifts every existing
candle's index by `+n`.** The `prepend` event carries `added`; `ChartController.prependCandles` shifts the visible
range by the same amount so the screen does not move. Anything keyed by logical index (drawings, Phase 7) must
apply the same shift on that event. Live appends and updates never change existing indices. A full reload
(`reset`) invalidates logical positions entirely.

## Simulated provider
`FixtureProvider` (seeded random walk, weekdays only, 500 bars) also simulates live ticks: most polls move the
current bar, every 5th opens the next weekday's bar and resends the closed one unchanged. History and ticks share
one series, so reloading history after ticks returns the same bars. It is never real market data.
