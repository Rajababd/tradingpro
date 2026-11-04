import type { Timeframe, UnixSeconds } from '../types/marketData';

export interface HistoricalRequest {
  readonly symbol: string;
  readonly timeframe: Timeframe;
  /** Maximum number of most-recent candles wanted (counted back from `before` when given). */
  readonly limit?: number;
  /** Bypass provider cache and fetch fresh history only for an explicit user refresh. */
  readonly refresh?: boolean;
  /** Only candles strictly earlier than this time. Used to page backwards through history. */
  readonly before?: UnixSeconds;
  /** Lets the caller cancel an in-flight request. */
  readonly signal?: AbortSignal;
}

export interface LatestRequest {
  readonly symbol: string;
  readonly timeframe: Timeframe;
  readonly signal?: AbortSignal;
}

/**
 * Source of market data.
 *
 * Providers return RAW records (`unknown[]`) on purpose: everything crossing this
 * boundary must pass through `normalizeCandles`, so no provider can bypass
 * validation. Providers must parse their own wire formats; the validator does not
 * coerce numeric strings.
 */
export interface MarketDataProvider {
  readonly id: string;
  readonly displayName: string;
  /** True for fixture/mock providers. The UI must always surface this. */
  readonly isSimulated: boolean;
  fetchHistorical(request: HistoricalRequest): Promise<unknown[]>;
  /**
   * Optional. The most recent candle(s): the one currently forming and, when a bar has
   * just rolled over, the one that just closed. Re-sending an unchanged candle is fine
   * (updates are idempotent). Providers without it simply have no live updates.
   */
  fetchLatest?(request: LatestRequest): Promise<unknown[]>;
}
