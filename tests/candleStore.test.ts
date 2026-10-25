import { describe, expect, it } from 'vitest';
import { CandleStore } from '../src/data/CandleStore';
import type { Candle, UnixSeconds } from '../src/types/marketData';

const DAY = 86_400;
const T0 = 1_704_067_200;
const c = (day: number, close = 10, extra: Partial<Candle> = {}): Candle => ({
  time: (T0 + day * DAY) as UnixSeconds,
  open: 10,
  high: 12,
  low: 9,
  close,
  volume: 100,
  ...extra,
});
const filled = (...days: number[]) => {
  const s = new CandleStore();
  s.reset(days.map((d) => c(d)));
  return s;
};

describe('CandleStore: applyUpdate', () => {
  it('appends a newer candle, allowing gaps (weekends, halts)', () => {
    const s = filled(0, 1);
    const r = s.applyUpdate(c(5));
    expect(r).toMatchObject({ kind: 'appended', index: 2 });
    expect(s.length).toBe(3);
  });

  it('appends to an empty store', () => {
    const s = new CandleStore();
    expect(s.applyUpdate(c(0))).toMatchObject({ kind: 'appended', index: 0 });
  });

  it('updates the latest candle when the time matches and values differ', () => {
    const s = filled(0, 1);
    const r = s.applyUpdate(c(1, 11));
    expect(r).toMatchObject({ kind: 'updated', index: 1 });
    expect(s.last?.close).toBe(11);
    expect(s.length).toBe(2);
  });

  it('treats an identical re-send as unchanged and does not bump the revision', () => {
    const s = filled(0, 1);
    const before = s.revision;
    expect(s.applyUpdate(c(1)).kind).toBe('unchanged');
    expect(s.revision).toBe(before);
  });

  it('treats a changed volume as an update', () => {
    const s = filled(0);
    expect(s.applyUpdate(c(0, 10, { volume: 150 })).kind).toBe('updated');
    expect(s.applyUpdate(c(0, 10, { volume: null })).kind).toBe('updated');
  });

  it('refuses stale (older) candles and leaves the series untouched', () => {
    const s = filled(0, 1, 2);
    const before = [...s.candles];
    const r = s.applyUpdate(c(1, 99));
    expect(r).toMatchObject({ kind: 'stale', latestTime: c(2).time });
    expect(s.candles).toEqual(before);
  });

  it('bumps the revision only on real changes', () => {
    const s = filled(0);
    const r0 = s.revision;
    s.applyUpdate(c(1)); // appended
    s.applyUpdate(c(1, 11)); // updated
    s.applyUpdate(c(1, 11)); // unchanged
    s.applyUpdate(c(0)); // stale
    expect(s.revision).toBe(r0 + 2);
  });
});

describe('CandleStore: applyRaw', () => {
  it('validates before applying, and rejected input never touches the store', () => {
    const s = filled(0);
    const r = s.applyRaw({ time: T0 + DAY, open: 10, high: 5, low: 9, close: 10 });
    expect(r.kind).toBe('rejected');
    expect(s.length).toBe(1);
  });

  it('rejects non-objects and millisecond timestamps', () => {
    const s = filled(0);
    expect(s.applyRaw(null).kind).toBe('rejected');
    expect(s.applyRaw({ time: (T0 + DAY) * 1000, open: 1, high: 2, low: 1, close: 1 }).kind).toBe('rejected');
  });

  it('applies a valid raw record, turning a missing volume into null', () => {
    const s = filled(0);
    const r = s.applyRaw({ time: T0 + DAY, open: 10, high: 12, low: 9, close: 11 });
    expect(r.kind).toBe('appended');
    expect(s.last?.volume).toBeNull();
  });
});

describe('CandleStore: prepend (older history)', () => {
  it('puts an older page in front and reports how many were added', () => {
    const s = filled(10, 11);
    const r = s.prepend([c(7), c(8), c(9)]);
    expect(r).toEqual({ added: 3, overlapDropped: 0 });
    expect(s.candles.map((x) => (x.time - T0) / DAY)).toEqual([7, 8, 9, 10, 11]);
  });

  it('lets existing data win on overlap and counts what it dropped', () => {
    const s = filled(10, 11);
    const r = s.prepend([c(9), c(10, 99), c(11, 99)]);
    expect(r).toEqual({ added: 1, overlapDropped: 2 });
    expect(s.candles.find((x) => x.time === c(10).time)?.close).toBe(10);
  });

  it('adding nothing changes nothing', () => {
    const s = filled(10);
    const rev = s.revision;
    expect(s.prepend([c(10), c(12)])).toEqual({ added: 0, overlapDropped: 2 });
    expect(s.revision).toBe(rev);
  });

  it('into an empty store behaves like a reset', () => {
    const s = new CandleStore();
    expect(s.prepend([c(1), c(2)])).toEqual({ added: 2, overlapDropped: 0 });
  });

  it('refuses an unsorted page', () => {
    expect(() => filled(10).prepend([c(5), c(4)])).toThrow(/strictly ascending/);
  });
});

describe('CandleStore: reset', () => {
  it('replaces the series and refuses unsorted or duplicate input', () => {
    const s = filled(0, 1, 2);
    s.reset([c(5)]);
    expect(s.length).toBe(1);
    expect(() => s.reset([c(2), c(1)])).toThrow(/strictly ascending/);
    expect(() => s.reset([c(1), c(1)])).toThrow(/strictly ascending/);
    expect(s.length).toBe(1); // failed reset left the data alone
  });

  it('exposes first and last', () => {
    const s = filled(3, 4);
    expect(s.first?.time).toBe(c(3).time);
    expect(s.last?.time).toBe(c(4).time);
    expect(new CandleStore().last).toBeUndefined();
  });
});
