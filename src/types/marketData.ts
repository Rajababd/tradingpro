/**
 * Normalized market-data model. All timestamps are UTC Unix seconds.
 * Optional turnover metadata is preserved when a provider supplies it.
 */
export type UnixSeconds = number & { readonly __brand: 'UnixSeconds' };

export interface Candle {
  readonly time: UnixSeconds;
  readonly open: number;
  readonly high: number;
  readonly low: number;
  readonly close: number;
  readonly volume: number | null;
  /** Total traded value for the period, when supplied by the source. */
  readonly valueTraded?: number | null;
}

/** DSE daily bars can be aggregated into calendar weeks and months by the provider. */
export type Timeframe = '1D' | '1W' | '1M';
