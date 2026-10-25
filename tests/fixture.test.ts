import { describe, expect, it } from 'vitest';
import { FixtureProvider, generateFixtureCandles } from '../src/data/FixtureProvider';
import { normalizeCandles } from '../src/data/validator';

describe('fixture data', () => {
  it('is labelled simulated', () => {
    expect(new FixtureProvider().isSimulated).toBe(true);
  });

  it('is deterministic for the same seed and differs for another seed', () => {
    expect(generateFixtureCandles(50, 7)).toEqual(generateFixtureCandles(50, 7));
    expect(generateFixtureCandles(50, 7)).not.toEqual(generateFixtureCandles(50, 8));
  });

  it('produces exactly the requested number of candles, all passing validation', () => {
    const raw = generateFixtureCandles(400);
    const r = normalizeCandles(raw);
    expect(raw).toHaveLength(400);
    expect(r.candles).toHaveLength(400);
    expect(r.issues).toEqual([]);
  });

  it('contains only weekdays and strictly ascending times', () => {
    const { candles } = normalizeCandles(generateFixtureCandles(120));
    for (const c of candles) {
      const day = new Date(c.time * 1000).getUTCDay();
      expect(day).not.toBe(0);
      expect(day).not.toBe(6);
    }
    for (let i = 1; i < candles.length; i++) {
      expect(candles[i]!.time).toBeGreaterThan(candles[i - 1]!.time);
    }
  });

  it('includes volume on every candle', () => {
    const { candles } = normalizeCandles(generateFixtureCandles(60));
    expect(candles.every((c) => c.volume !== null && c.volume > 0)).toBe(true);
  });

  it('rejects an already-aborted request', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      new FixtureProvider().fetchHistorical({ symbol: 'X', timeframe: '1D', signal: controller.signal }),
    ).rejects.toThrow();
  });
});
