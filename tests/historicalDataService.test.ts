import { describe, expect, it } from 'vitest';
import { DataLoadError, loadHistoricalCandles } from '../src/data/HistoricalDataService';
import { FixtureProvider } from '../src/data/FixtureProvider';
import type { MarketDataProvider } from '../src/data/MarketDataProvider';

const req = { symbol: 'T', timeframe: '1D' as const };
const good = { time: 1_704_067_200, open: 1, high: 2, low: 1, close: 2, volume: 5 };

function fakeProvider(fetchHistorical: MarketDataProvider['fetchHistorical']): MarketDataProvider {
  return { id: 'fake', displayName: 'Fake', isSimulated: false, fetchHistorical };
}

describe('loadHistoricalCandles', () => {
  it('returns normalized candles and source info from the fixture provider', async () => {
    const r = await loadHistoricalCandles(new FixtureProvider(), { ...req, limit: 30 });
    expect(r.candles).toHaveLength(30);
    expect(r.source).toEqual({ id: 'fixture', displayName: 'Simulated fixture', isSimulated: true });
  });

  it('wraps network failures in DataLoadError and keeps the cause', async () => {
    const cause = new Error('network down');
    const p = fakeProvider(async () => {
      throw cause;
    });
    const err = await loadHistoricalCandles(p, req).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(DataLoadError);
    expect((err as DataLoadError).cause).toBe(cause);
  });

  it('fails on an empty response instead of returning an empty series', async () => {
    await expect(loadHistoricalCandles(fakeProvider(async () => []), req)).rejects.toThrow(/no candles/);
  });

  it('fails when every candle is invalid and surfaces the issues', async () => {
    const p = fakeProvider(async () => [{ time: 1, open: NaN }, null]);
    const err = (await loadHistoricalCandles(p, req).catch((e: unknown) => e)) as DataLoadError;
    expect(err).toBeInstanceOf(DataLoadError);
    expect(err.issues).toHaveLength(2);
  });

  it('succeeds with partial data and reports issues instead of hiding them', async () => {
    const p = fakeProvider(async () => [good, { ...good, time: 1_704_153_600, high: -1 }]);
    const r = await loadHistoricalCandles(p, req);
    expect(r.candles).toHaveLength(1);
    expect(r.issues).toHaveLength(1);
  });

  it('rejects a non-array response', async () => {
    const p = fakeProvider(async () => ({ not: 'an array' }) as unknown as unknown[]);
    await expect(loadHistoricalCandles(p, req)).rejects.toThrow(/unexpected response shape/);
  });

  it('rethrows cancellation as-is rather than as a data error', async () => {
    const ac = new AbortController();
    const p = fakeProvider(async () => {
      ac.abort();
      throw new DOMException('aborted', 'AbortError');
    });
    const err = await loadHistoricalCandles(p, { ...req, signal: ac.signal }).catch((e: unknown) => e);
    expect(err).not.toBeInstanceOf(DataLoadError);
  });
});
