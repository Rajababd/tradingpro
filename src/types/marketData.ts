/**
 * Normalized market-data model.
 *
 * `UnixSeconds` is a market timestamp in SECONDS since the Unix epoch (UTC). It is a
 * branded type so it cannot be confused with chart logical indices, millisecond
 * timestamps, or pixel coordinates. Only the validator mints it.
 *
 * `volume` is `null` when the source supplied none. Missing volume is never
 * replaced with 0 or any other invented value.
 */
export type UnixSeconds = number & { readonly __brand: 'UnixSeconds' };

export interface Candle {
  readonly time: UnixSeconds;
  readonly open: number;
  readonly high: number;
  readonly low: number;
  readonly close: number;
  readonly volume: number | null;
}

/** Widened as timeframe support is added; only daily bars exist today. */
export type Timeframe = '1D';
