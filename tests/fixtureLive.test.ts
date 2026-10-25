import { describe, expect, it } from 'vitest';
import { FIXTURE_TICKS_PER_BAR, FixtureProvider } from '../src/data/FixtureProvider';
import { normalizeCandles, validateCandle } from '../src/data/validator';
import type { UnixSeconds } from '../src/types/marketData';

const REQ = { symbol: 'SIM', timeframe: '1D' } as const;
const times = (raw: unknown[]) => (raw as { time: number }[]).map((r) => r.time);

describe('FixtureProvider: paging backwards', () => {
  it('returns only candles strictly before `before`, newest `limit` of them', async () => {
    const p = new FixtureProvider(42, 100);
    const all = times(await p.fetchHistorical(REQ));
    const before = all[60]! as UnixSeconds;
    const page = times(await p.fetchHistorical({ ...REQ, before, limit: 20 }));
    expect(page).toEqual(all.slice(40, 60));
    expect(page.every((t) => t < before)).toBe(true);
  });

  it('pages are contiguous with no overlap and no gap', async () => {
    const p = new FixtureProvider(42, 100);
    const all = times(await p.fetchHistorical(REQ));
    const newest = times(await p.fetchHistorical({ ...REQ, limit: 30 }));
    const older = times(await p.fetchHistorical({ ...REQ, limit: 30, before: newest[0]! as UnixSeconds }));
    expect([...older, ...newest]).toEqual(all.slice(-60));
  });

  it('returns an empty page when there is nothing earlier', async () => {
    const p = new FixtureProvider(42, 10);
    const first = times(await p.fetchHistorical(REQ))[0]!;
    expect(await p.fetchHistorical({ ...REQ, before: first as UnixSeconds })).toEqual([]);
  });

  it('hands out copies, so callers cannot corrupt provider state', async () => {
    const p = new FixtureProvider(42, 10);
    const a = (await p.fetchHistorical(REQ)) as { close: number }[];
    a[0]!.close = -1;
    const b = (await p.fetchHistorical(REQ)) as { close: number }[];
    expect(b[0]!.close).not.toBe(-1);
  });
});

describe('FixtureProvider: simulated live ticks', () => {
  it('moves the current bar on most ticks and always sends valid candles', async () => {
    const p = new FixtureProvider(42, 50);
    const lastHistorical = (await p.fetchHistorical(REQ)).at(-1) as { time: number };
    const first = (await p.fetchLatest!(REQ)) as { time: number }[];
    expect(first).toHaveLength(1);
    expect(first[0]!.time).toBe(lastHistorical.time);
    expect(validateCandle(first[0]).ok).toBe(true);
  });

  it(`opens a new weekday bar every ${FIXTURE_TICKS_PER_BAR}th tick and resends the closed bar unchanged`, async () => {
    const p = new FixtureProvider(42, 50);
    let previous: { time: number; close: number } | undefined;
    for (let i = 1; i < FIXTURE_TICKS_PER_BAR; i++) previous = ((await p.fetchLatest!(REQ)) as { time: number; close: number }[])[0];
    const rollover = (await p.fetchLatest!(REQ)) as { time: number; open: number; close: number }[];
    expect(rollover).toHaveLength(2);
    expect(rollover[0]).toEqual(previous); // the closed bar, exactly as last sent
    expect(rollover[1]!.time).toBeGreaterThan(rollover[0]!.time);
    expect([0, 6]).not.toContain(new Date(rollover[1]!.time * 1000).getUTCDay());
    expect(rollover[1]!.open).toBe(rollover[0]!.close); // continuity: opens where the last bar closed
  });

  it('keeps every OHLC invariant over many ticks and keeps time strictly increasing', async () => {
    const p = new FixtureProvider(7, 30);
    let lastTime = 0;
    for (let i = 0; i < 200; i++) {
      for (const raw of await p.fetchLatest!(REQ)) {
        const v = validateCandle(raw);
        expect(v.ok).toBe(true);
        if (v.ok) {
          expect(v.candle.time).toBeGreaterThanOrEqual(lastTime);
          lastTime = v.candle.time;
        }
      }
    }
  });

  it('within one bar the high only rises and the low only falls', async () => {
    const p = new FixtureProvider(42, 20);
    let high = -Infinity;
    let low = Infinity;
    for (let i = 1; i < FIXTURE_TICKS_PER_BAR; i++) {
      const c = ((await p.fetchLatest!(REQ)) as { high: number; low: number }[])[0]!;
      expect(c.high).toBeGreaterThanOrEqual(high);
      expect(c.low).toBeLessThanOrEqual(low);
      high = c.high;
      low = c.low;
    }
  });

  it('is deterministic for a given seed', async () => {
    const run = async () => {
      const p = new FixtureProvider(5, 20);
      const out: unknown[] = [];
      for (let i = 0; i < 12; i++) out.push(await p.fetchLatest!(REQ));
      return out;
    };
    expect(await run()).toEqual(await run());
  });

  it('later history reflects what the live ticks produced', async () => {
    const p = new FixtureProvider(42, 30);
    let latest: unknown[] = [];
    for (let i = 0; i < 12; i++) latest = await p.fetchLatest!(REQ);
    const history = normalizeCandles(await p.fetchHistorical(REQ));
    expect(history.issues).toEqual([]);
    expect(history.candles).toHaveLength(32); // 30 generated + 2 live bars
    expect(history.candles.at(-1)).toMatchObject(latest.at(-1) as object);
  });

  it('rejects an aborted latest request', async () => {
    const c = new AbortController();
    c.abort();
    await expect(new FixtureProvider().fetchLatest!({ ...REQ, signal: c.signal })).rejects.toThrow();
  });
});
