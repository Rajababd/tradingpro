import { describe, expect, it } from 'vitest';
import { normalizeCandles, validateCandle } from '../src/data/validator';

const good = { time: 1_704_067_200, open: 10, high: 12, low: 9, close: 11, volume: 1000 };

describe('validateCandle', () => {
  it('accepts a valid candle', () => {
    const r = validateCandle(good);
    expect(r).toEqual({ ok: true, candle: good });
  });

  it('represents missing volume as null, never 0', () => {
    const { volume: _v, ...noVolume } = good;
    const r = validateCandle(noVolume);
    expect(r.ok && r.candle.volume).toBeNull();
    const explicitNull = validateCandle({ ...good, volume: null });
    expect(explicitNull.ok && explicitNull.candle.volume).toBeNull();
  });

  it('keeps an explicit volume of 0', () => {
    const r = validateCandle({ ...good, volume: 0 });
    expect(r.ok && r.candle.volume).toBe(0);
  });

  it.each([
    ['null', null],
    ['a string', 'x'],
    ['an array item of wrong type', 42],
  ])('rejects %s', (_label, value) => {
    const r = validateCandle(value);
    expect(!r.ok && r.code).toBe('NOT_AN_OBJECT');
  });

  it.each([
    ['NaN', NaN],
    ['Infinity', Infinity],
    ['a numeric string', '11'],
    ['undefined', undefined],
  ])('rejects close = %s', (_label, close) => {
    const r = validateCandle({ ...good, close });
    expect(!r.ok && r.code).toBe('INVALID_PRICE');
  });

  it('rejects high below close', () => {
    const r = validateCandle({ ...good, high: 10.5, close: 11 });
    expect(!r.ok && r.code).toBe('INVALID_OHLC_RELATION');
  });

  it('rejects high below open', () => {
    const r = validateCandle({ ...good, high: 9.5, open: 10, low: 9 });
    expect(!r.ok && r.code).toBe('INVALID_OHLC_RELATION');
  });

  it('rejects low above open or close', () => {
    expect(!validateCandle({ ...good, low: 10.5 }).ok).toBe(true); // low > open (10)
    expect(!validateCandle({ ...good, low: 11.5, high: 12 }).ok).toBe(true); // low > close (11)
  });

  it('rejects high below low', () => {
    const r = validateCandle({ time: good.time, open: 5, high: 4, low: 6, close: 5 });
    expect(!r.ok && r.code).toBe('INVALID_OHLC_RELATION');
  });

  it('accepts a flat candle (all equal)', () => {
    expect(validateCandle({ time: good.time, open: 5, high: 5, low: 5, close: 5 }).ok).toBe(true);
  });

  it.each([
    ['zero', 0],
    ['negative', -5],
    ['fractional', 1_704_067_200.5],
    ['NaN', NaN],
    ['a string', '1704067200'],
  ])('rejects time = %s', (_label, time) => {
    const r = validateCandle({ ...good, time });
    expect(!r.ok && r.code).toBe('INVALID_TIME');
  });

  it('rejects millisecond timestamps with a specific code', () => {
    const r = validateCandle({ ...good, time: 1_704_067_200_000 });
    expect(!r.ok && r.code).toBe('TIME_IN_MILLISECONDS');
  });

  it.each([
    ['negative', -1],
    ['NaN', NaN],
    ['a string', '100'],
  ])('rejects volume = %s', (_label, volume) => {
    const r = validateCandle({ ...good, volume });
    expect(!r.ok && r.code).toBe('INVALID_VOLUME');
  });
});

describe('normalizeCandles', () => {
  const c = (time: number, close = 11) => ({ ...good, time, close });

  it('returns an empty result for empty input', () => {
    expect(normalizeCandles([])).toEqual({ candles: [], issues: [], droppedCount: 0 });
  });

  it('keeps valid ascending input untouched with no issues', () => {
    const r = normalizeCandles([c(100), c(200), c(300)]);
    expect(r.candles.map((x) => x.time)).toEqual([100, 200, 300]);
    expect(r.issues).toEqual([]);
    expect(r.droppedCount).toBe(0);
  });

  it('rejects invalid candles, reports their raw index, and keeps the rest', () => {
    const r = normalizeCandles([c(100), { ...good, time: 200, high: 1 }, c(300), null]);
    expect(r.candles.map((x) => x.time)).toEqual([100, 300]);
    expect(r.issues.map((i) => [i.index, i.code])).toEqual([
      [1, 'INVALID_OHLC_RELATION'],
      [3, 'NOT_AN_OBJECT'],
    ]);
    expect(r.droppedCount).toBe(2);
  });

  it('sorts out-of-order input and reports it exactly once', () => {
    const r = normalizeCandles([c(300), c(100), c(200), c(50)]);
    expect(r.candles.map((x) => x.time)).toEqual([50, 100, 200, 300]);
    expect(r.issues.filter((i) => i.code === 'OUT_OF_ORDER')).toHaveLength(1);
  });

  it('resolves duplicate timestamps with last-write-wins and reports the replaced one', () => {
    const r = normalizeCandles([c(100, 10.5), c(200), c(100, 11.5)]);
    expect(r.candles.map((x) => x.time)).toEqual([100, 200]);
    expect(r.candles[0]?.close).toBe(11.5);
    const dup = r.issues.find((i) => i.code === 'DUPLICATE_TIME');
    expect(dup?.index).toBe(0);
    expect(r.droppedCount).toBe(1);
  });

  it('does not mutate its input', () => {
    const input = [c(300), c(100)];
    const snapshot = JSON.parse(JSON.stringify(input));
    normalizeCandles(input);
    expect(input).toEqual(snapshot);
  });

  it('produces strictly ascending times even with several duplicates and disorder', () => {
    const r = normalizeCandles([c(5), c(3), c(5), c(1), c(3), c(4)]);
    const times = r.candles.map((x) => x.time);
    expect(times).toEqual([1, 3, 4, 5]);
  });
});
