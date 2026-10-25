import type { Candle } from '../types/marketData';
import type { HistoricalRequest, MarketDataProvider } from './MarketDataProvider';
import { normalizeCandles, type CandleIssue } from './validator';

export class DataLoadError extends Error {
  constructor(
    message: string,
    readonly issues: readonly CandleIssue[] = [],
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = 'DataLoadError';
  }
}

export interface HistoricalLoadResult {
  readonly candles: Candle[];
  /** Problems found while normalizing. Non-empty does not mean failure. */
  readonly issues: readonly CandleIssue[];
  readonly source: { readonly id: string; readonly displayName: string; readonly isSimulated: boolean };
}

/**
 * Fetches history from a provider and normalizes it.
 * Fails loudly (DataLoadError) rather than returning an empty or fabricated series.
 */
export async function loadHistoricalCandles(
  provider: MarketDataProvider,
  request: HistoricalRequest,
): Promise<HistoricalLoadResult> {
  let raw: unknown[];
  try {
    raw = await provider.fetchHistorical(request);
  } catch (cause) {
    if (request.signal?.aborted) throw cause; // cancellation is not a data error
    throw new DataLoadError(`Could not fetch data from ${provider.displayName}.`, [], { cause });
  }

  if (!Array.isArray(raw)) {
    throw new DataLoadError(`${provider.displayName} returned an unexpected response shape.`);
  }
  if (raw.length === 0) {
    throw new DataLoadError(`${provider.displayName} returned no candles for ${request.symbol}.`);
  }

  const { candles, issues } = normalizeCandles(raw);
  if (candles.length === 0) {
    throw new DataLoadError(
      `${provider.displayName} returned ${raw.length} candles but none were valid.`,
      issues,
    );
  }

  return {
    candles,
    issues,
    source: { id: provider.id, displayName: provider.displayName, isSimulated: provider.isSimulated },
  };
}
