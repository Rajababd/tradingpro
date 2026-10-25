import { describe, expect, it } from 'vitest';
import { adDefinition } from '../src/indicators/accumulationDistribution';
import { macdDefinition } from '../src/indicators/macd';
import { obvDefinition } from '../src/indicators/obv';
import { rsiDefinition } from '../src/indicators/rsi';
import { smaKernel } from '../src/indicators/sma';
import { createCalculator } from '../src/indicators/calculator';
import { volumeDefinition } from '../src/indicators/volume';
import type { IndicatorDefinition, Value } from '../src/indicators/types';
import { bar, fromCloses, randomCandles } from './helpers/candles';
import type { Candle } from '../src/types/marketData';

function run(def: IndicatorDefinition, candles: readonly Candle[], params: object = {}) {
  const v = def.validate(params);
  if (!v.ok) throw new Error(v.errors.join('; '));
  const calc = def.createCalculator(v.params);
  calc.reset(candles);
  return Object.fromEntries(def.outputs.map((o) => [o.key, [...calc.column(o.key)]])) as Record<string, Value[]>;
}
const sma = (values: readonly Value[], period: number) => {
  const calc = createCalculator(smaKernel(period));
  calc.reset(values);
  return [...calc.column('sma')];
};
const close = (actual: readonly Value[], expected: readonly Value[], digits = 4) => {
  expect(actual).toHaveLength(expected.length);
  expected.forEach((e, i) => {
    if (e === null) expect(actual[i], `index ${i}`).toBeNull();
    else {
      expect(actual[i], `index ${i}`).not.toBeNull();
      expect(actual[i]!, `index ${i}`).toBeCloseTo(e, digits);
    }
  });
};

describe('SMA', () => {
  it('SMA(3) of 1..5 is [null, null, 2, 3, 4]: no value until 3 inputs exist', () => {
    expect(sma([1, 2, 3, 4, 5], 3)).toEqual([null, null, 2, 3, 4]);
  });

  it('SMA(1) is the input itself', () => {
    expect(sma([4, 8, 6], 1)).toEqual([4, 8, 6]);
  });

  it('matches a hand calculation on uneven data', () => {
    // windows: (10+20+60)/3=30, (20+60+30)/3=36.667, (60+30+0)/3=30
    close(sma([10, 20, 60, 30, 0], 3), [null, null, 30, 36.6667, 30]);
  });

  it('a null input empties the window: no average spans a gap or uses fewer than N real values', () => {
    expect(sma([1, 2, 3, null, 4, 5, 6], 3)).toEqual([null, null, 2, null, null, null, 5]);
  });

  it('a series that starts with nulls (an indicator warm-up) starts averaging after N real values', () => {
    expect(sma([null, null, 10, 20, 30, 40], 2)).toEqual([null, null, null, 15, 25, 35]);
  });

  it('does not drift on long series (sum is recomputed, not accumulated)', () => {
    const xs = Array.from({ length: 5000 }, (_, i) => 0.1 + (i % 7) * 1e-3);
    const out = sma(xs, 20);
    const i = 4999;
    let exact = 0;
    for (let k = 0; k < 20; k++) exact += xs[i - k]!;
    expect(out[i]).toBeCloseTo(exact / 20, 12);
  });
});

describe('RSI (Wilder)', () => {
  it('matches a hand calculation: RSI(3) on 10,11,12,11,13', () => {
    // changes +1,+1,-1,+2.  idx3: avgGain=(1+1+0)/3=0.6667 avgLoss=(0+0+1)/3=0.3333 -> RS 2 -> 66.667
    //                       idx4: avgGain=(0.6667*2+2)/3=1.1111 avgLoss=(0.3333*2+0)/3=0.2222 -> RS 5 -> 83.333
    const out = run(rsiDefinition, fromCloses([10, 11, 12, 11, 13]), { period: 3 }).rsi!;
    close(out, [null, null, null, 66.6667, 83.3333]);
  });

  it('has exactly `period` leading nulls (first value needs period + 1 closes)', () => {
    const out = run(rsiDefinition, randomCandles(40, 1), { period: 14 }).rsi!;
    expect(out.slice(0, 14).every((v) => v === null)).toBe(true);
    expect(out[14]).not.toBeNull();
  });

  it('is exactly 100 when the price only rises and 0 when it only falls', () => {
    expect(run(rsiDefinition, fromCloses([1, 2, 3, 4, 5, 6]), { period: 3 }).rsi!.slice(3)).toEqual([100, 100, 100]);
    expect(run(rsiDefinition, fromCloses([6, 5, 4, 3, 2, 1]), { period: 3 }).rsi!.slice(3)).toEqual([0, 0, 0]);
  });

  it('is undefined (null), not an invented number, while the price has never moved', () => {
    const out = run(rsiDefinition, fromCloses([5, 5, 5, 5, 5, 5]), { period: 3 }).rsi!;
    expect(out).toEqual([null, null, null, null, null, null]);
  });

  it('recovers normally once a flat stretch ends', () => {
    const out = run(rsiDefinition, fromCloses([5, 5, 5, 5, 5, 6]), { period: 3 }).rsi!;
    expect(out.slice(0, 5)).toEqual([null, null, null, null, null]);
    expect(out[5]).toBe(100); // avgGain 1/3, avgLoss 0
  });

  it('never leaves [0, 100] by even one ulp, whatever the price scale (stress)', () => {
    const rand = (seed: number) => {
      let a = seed;
      return () => ((a = (a * 1664525 + 1013904223) >>> 0) / 4294967296);
    };
    for (const [scale, seed] of [[1e-9, 1], [1, 2], [1e9, 3], [1e15, 4]] as const) {
      const r = rand(seed);
      // mostly-rising and mostly-falling runs push avgLoss / avgGain toward 0
      const closes = Array.from({ length: 400 }, (_, i) => scale * (1 + i * (i < 200 ? 0.01 : -0.004) + r() * 1e-3));
      for (const v of run(rsiDefinition, fromCloses(closes), { period: 14 }).rsi!) {
        if (v !== null) {
          expect(v).toBeGreaterThanOrEqual(0);
          expect(v).toBeLessThanOrEqual(100);
        }
      }
    }
  });

  it('stays within [0, 100] on random data', () => {
    for (const seed of [1, 2, 3]) {
      for (const v of run(rsiDefinition, randomCandles(300, seed), { period: 14 }).rsi!) {
        if (v !== null) {
          expect(v).toBeGreaterThanOrEqual(0);
          expect(v).toBeLessThanOrEqual(100);
        }
      }
    }
  });
});

describe('Volume', () => {
  it('passes volume through, keeps a real 0, and shows a missing volume as null (never 0)', () => {
    const candles = [bar(0, { c: 1, v: 500 }), bar(1, { c: 1, v: 0 }), bar(2, { c: 1, v: null })];
    expect(run(volumeDefinition, candles).volume).toEqual([500, 0, null]);
  });
});

describe('OBV', () => {
  it('matches a hand calculation: up adds, down subtracts, unchanged adds nothing, first bar = its volume', () => {
    const candles = fromCloses([10, 11, 11, 10, 12], [100, 200, 150, 300, 250]);
    // 100, +200 -> 300, +0 -> 300, -300 -> 0, +250 -> 250
    expect(run(obvDefinition, candles).obv).toEqual([100, 300, 300, 0, 250]);
  });

  it('a bar without volume is null and the next bar with volume starts a new segment', () => {
    const candles = fromCloses([10, 11, 12, 11], [100, null, 200, 300]);
    // 100, null, restart at 200, then close 11 < 12 -> 200 - 300 = -100
    expect(run(obvDefinition, candles).obv).toEqual([100, null, 200, -100]);
  });

  it('is all null when no bar has volume', () => {
    expect(run(obvDefinition, fromCloses([1, 2, 3], [null, null, null])).obv).toEqual([null, null, null]);
  });

  it('a genuine zero volume is a real bar that adds nothing', () => {
    expect(run(obvDefinition, fromCloses([10, 11, 12], [100, 0, 50])).obv).toEqual([100, 100, 150]);
  });
});

describe('Accumulation/Distribution', () => {
  it('matches a hand calculation, including a zero-range bar', () => {
    const candles = [
      bar(0, { o: 10, h: 12, l: 8, c: 11, v: 100 }), // mfm = ((11-8)-(12-11))/4 = 0.5   -> +50
      bar(1, { o: 10, h: 10, l: 10, c: 10, v: 50 }), // zero range -> mfm 0              -> +0
      bar(2, { o: 12, h: 15, l: 10, c: 10, v: 200 }), // mfm = ((0)-(5))/5 = -1           -> -200
    ];
    expect(run(adDefinition, candles).ad).toEqual([50, 50, -150]);
  });

  it('a close at the high adds the full volume, at the low subtracts it', () => {
    const candles = [bar(0, { o: 5, h: 10, l: 0, c: 10, v: 100 }), bar(1, { o: 5, h: 10, l: 0, c: 0, v: 40 })];
    expect(run(adDefinition, candles).ad).toEqual([100, 60]);
  });

  it('a bar without volume is null and starts a new segment after it', () => {
    const candles = [
      bar(0, { o: 5, h: 10, l: 0, c: 10, v: 100 }),
      bar(1, { o: 5, h: 10, l: 0, c: 10, v: null }),
      bar(2, { o: 5, h: 10, l: 0, c: 0, v: 30 }),
    ];
    expect(run(adDefinition, candles).ad).toEqual([100, null, -30]);
  });

  it('never produces NaN or Infinity, even for many zero-range bars', () => {
    const candles = Array.from({ length: 20 }, (_, i) => bar(i, { o: 7, h: 7, l: 7, c: 7, v: 100 }));
    expect(run(adDefinition, candles).ad!.every((v) => v === 0)).toBe(true);
  });
});

describe('MACD', () => {
  it('matches a hand calculation: fast 2, slow 3, signal 2 on 1,2,4,7,11', () => {
    // EMA2 (k=2/3, seed SMA(1,2)=1.5 at idx1): 3.1667, 5.7222, 9.2407 at idx2..4
    // EMA3 (k=1/2, seed SMA(1,2,4)=2.3333 at idx2): 4.6667, 7.8333 at idx3..4
    // MACD idx2..4 = 0.8333, 1.0556, 1.4074 ; signal (k=2/3, seed mean of first 2 = 0.9444 at idx3): 1.2531 at idx4
    const out = run(macdDefinition, fromCloses([1, 2, 4, 7, 11]), { fast: 2, slow: 3, signal: 2 });
    close(out.macd!, [null, null, 0.8333, 1.0556, 1.4074]);
    close(out.signal!, [null, null, null, 0.9444, 1.2531]);
    close(out.histogram!, [null, null, null, 0.1111, 0.1543]);
  });

  it('has the documented warm-up for the default 12/26/9: MACD at index 25, signal and histogram at 33', () => {
    const out = run(macdDefinition, randomCandles(80, 4));
    expect(out.macd!.findIndex((v) => v !== null)).toBe(25);
    expect(out.signal!.findIndex((v) => v !== null)).toBe(33);
    expect(out.histogram!.findIndex((v) => v !== null)).toBe(33);
    expect(out.macd!.slice(25).every((v) => v !== null)).toBe(true);
  });

  it('histogram is always MACD minus signal', () => {
    const out = run(macdDefinition, randomCandles(120, 5));
    out.histogram!.forEach((h, i) => {
      if (h === null) return;
      expect(h).toBeCloseTo(out.macd![i]! - out.signal![i]!, 12);
    });
  });

  it('is exactly 0 on a constant price', () => {
    const out = run(macdDefinition, fromCloses(Array.from({ length: 60 }, () => 50)));
    expect(out.macd!.filter((v) => v !== null).every((v) => v === 0)).toBe(true);
    expect(out.histogram!.filter((v) => v !== null).every((v) => v === 0)).toBe(true);
  });

  it('is positive when price has been rising and negative when falling', () => {
    const up = run(macdDefinition, fromCloses(Array.from({ length: 60 }, (_, i) => 100 + i)));
    const down = run(macdDefinition, fromCloses(Array.from({ length: 60 }, (_, i) => 200 - i)));
    expect(up.macd!.at(-1)!).toBeGreaterThan(0);
    expect(down.macd!.at(-1)!).toBeLessThan(0);
  });
});

describe('parameter validation', () => {
  const rejects = (def: IndicatorDefinition, input: unknown, fragment: RegExp) => {
    const r = def.validate(input);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join(' | ')).toMatch(fragment);
  };

  it('undefined or an empty object gives the defaults', () => {
    for (const def of [rsiDefinition, macdDefinition, volumeDefinition, obvDefinition, adDefinition]) {
      for (const input of [undefined, {}]) {
        const r = def.validate(input);
        expect(r).toEqual({ ok: true, params: def.defaults });
      }
    }
  });

  it('a partial object keeps the other defaults', () => {
    expect(macdDefinition.validate({ fast: 8 })).toEqual({ ok: true, params: { fast: 8, slow: 26, signal: 9 } });
  });

  it('rejects non-integers, NaN, Infinity, numeric strings and nulls instead of coercing them', () => {
    for (const bad of [1.5, Number.NaN, Infinity, '14', null, true]) rejects(rsiDefinition, { period: bad }, /whole number/);
  });

  it('rejects out-of-range values with the allowed range', () => {
    rejects(rsiDefinition, { period: 1 }, /between 2 and 500/);
    rejects(rsiDefinition, { period: 501 }, /between 2 and 500/);
    rejects(rsiDefinition, { period: -3 }, /between 2 and 500/);
  });

  it('rejects unknown parameters (typos are not silently ignored) and non-objects', () => {
    rejects(rsiDefinition, { perod: 14 }, /unknown parameter "perod"/);
    rejects(obvDefinition, { period: 3 }, /unknown parameter/);
    rejects(rsiDefinition, 14, /must be an object/);
    rejects(rsiDefinition, [14], /must be an object/);
  });

  it('MACD requires fast < slow', () => {
    rejects(macdDefinition, { fast: 26, slow: 12 }, /shorter than the slow/);
    rejects(macdDefinition, { fast: 12, slow: 12 }, /shorter than the slow/);
    expect(macdDefinition.validate({ fast: 5, slow: 6, signal: 1 }).ok).toBe(true);
  });
});

describe('warm-up declarations match the calculation', () => {
  it('each output has exactly the declared number of leading nulls and no nulls afterwards', () => {
    const candles = randomCandles(120, 9);
    for (const def of [rsiDefinition, volumeDefinition, obvDefinition, adDefinition, macdDefinition]) {
      const params = (def.validate(undefined) as { ok: true; params: Record<string, number> }).params;
      const declared = def.warmup(params);
      const out = run(def, candles);
      for (const o of def.outputs) {
        const column = out[o.key]!;
        const firstValue = column.findIndex((v) => v !== null);
        expect(firstValue, `${def.id}.${o.key}`).toBe(declared[o.key]);
        expect(column.slice(firstValue).every((v) => v !== null), `${def.id}.${o.key} has no gaps`).toBe(true);
      }
    }
  });
});
