import type { Candle, UnixSeconds } from '../../src/types/marketData';

export const DAY = 86_400;
export const T0 = 1_704_067_200;

export function bar(
  i: number,
  p: { o?: number; h?: number; l?: number; c: number; v?: number | null },
): Candle {
  const o = p.o ?? p.c;
  return {
    time: (T0 + i * DAY) as UnixSeconds,
    open: o,
    high: p.h ?? Math.max(o, p.c),
    low: p.l ?? Math.min(o, p.c),
    close: p.c,
    volume: p.v === undefined ? 1000 : p.v,
  };
}

/** Candles from a list of closes (open = previous close, wicks = body). */
export function fromCloses(closes: readonly number[], volumes?: readonly (number | null)[]): Candle[] {
  return closes.map((c, i) => bar(i, { o: i === 0 ? c : closes[i - 1]!, c, v: volumes ? volumes[i]! : 1000 }));
}

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A valid random OHLCV walk. `missingVolumeRate` of bars have `volume: null`. */
export function randomCandles(n: number, seed: number, missingVolumeRate = 0): Candle[] {
  const rand = mulberry32(seed);
  const out: Candle[] = [];
  let price = 100;
  for (let i = 0; i < n; i++) {
    const o = price;
    const c = Math.max(1, o + (rand() - 0.5) * 4);
    const h = Math.max(o, c) + rand() * 1.5;
    const l = Math.max(0.5, Math.min(o, c) - rand() * 1.5);
    out.push({
      time: (T0 + i * DAY) as UnixSeconds,
      open: o,
      high: h,
      low: Math.min(l, o, c),
      close: c,
      volume: rand() < missingVolumeRate ? null : Math.round(1000 + rand() * 9000),
    });
    price = c;
  }
  return out;
}

/** The same bar with different (still valid) values: what a live tick does to the latest candle. */
export function revised(candle: Candle, rand: () => number): Candle {
  const close = Math.max(0.5, candle.close + (rand() - 0.5) * 2);
  const high = Math.max(candle.high, close, candle.open);
  const low = Math.min(candle.low, close, candle.open);
  return { ...candle, close, high, low, volume: candle.volume === null ? null : candle.volume + Math.round(rand() * 500) };
}
