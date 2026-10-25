import { describe, expect, it } from 'vitest';
import { adDefinition } from '../src/indicators/accumulationDistribution';
import { createCalculator } from '../src/indicators/calculator';
import { macdDefinition } from '../src/indicators/macd';
import { obvDefinition } from '../src/indicators/obv';
import { rsiDefinition } from '../src/indicators/rsi';
import { smaKernel } from '../src/indicators/sma';
import type { IndicatorDefinition, Value } from '../src/indicators/types';
import type { Candle, UnixSeconds } from '../src/types/marketData';
import referenceJson from './fixtures/indicator-reference.json?raw';

/**
 * Compares the TypeScript indicators with values computed by TA-Lib (a widely used C library) and by an
 * independently written Python implementation, over a fixed 400-bar series that includes unchanged closes
 * and zero-range bars. Regenerate the fixture with scripts/generate-indicator-reference.py.
 */
interface Reference {
  meta: { talib: string; bars: number };
  candles: { time: number; open: number; high: number; low: number; close: number; volume: number }[];
  reference: {
    sma20_close: Value[]; sma5_close: Value[]; rsi14: Value[]; rsi5: Value[]; sma20_of_rsi14: Value[]; obv: Value[]; ad: Value[];
    macd_exact: Record<'macd' | 'signal' | 'histogram', Value[]>;
    macd_talib: Record<'macd' | 'signal' | 'histogram', Value[]>;
    macd_exact_5_13_4: Record<'macd' | 'signal' | 'histogram', Value[]>;
  };
}
const ref = JSON.parse(referenceJson) as Reference;
const candles: Candle[] = ref.candles.map((c) => ({ ...c, time: c.time as UnixSeconds }));
const closes = candles.map((c) => c.close);
const R = ref.reference;

function compute(def: IndicatorDefinition, params: object = {}): Record<string, Value[]> {
  const v = def.validate(params);
  if (!v.ok) throw new Error(v.errors.join('; '));
  const calc = def.createCalculator(v.params);
  calc.reset(candles);
  return Object.fromEntries(def.outputs.map((o) => [o.key, [...calc.column(o.key)]]));
}
function smaOf(values: readonly Value[], period: number): Value[] {
  const calc = createCalculator(smaKernel(period));
  calc.reset(values);
  return [...calc.column('sma')];
}

/** Largest |actual - expected| from `from` on, with identical null patterns required. Relative for big values. */
function maxDiff(actual: readonly Value[], expected: readonly Value[], from = 0): number {
  expect(actual).toHaveLength(expected.length);
  let worst = 0;
  for (let i = from; i < expected.length; i++) {
    const e = expected[i]!;
    const a = actual[i]!;
    if (e === null) {
      expect(a, `index ${i} should be null (warm-up)`).toBeNull();
      continue;
    }
    expect(a, `index ${i} should have a value`).not.toBeNull();
    worst = Math.max(worst, Math.abs(a! - e) / Math.max(1, Math.abs(e)));
  }
  return worst;
}
const firstValue = (xs: readonly Value[]) => xs.findIndex((v) => v !== null);

describe(`indicators vs TA-Lib ${ref.meta.talib} and an independent Python implementation`, () => {
  it('the fixture is the series we think it is', () => {
    expect(candles).toHaveLength(ref.meta.bars);
    expect(candles.some((c) => c.high === c.low)).toBe(true); // zero-range bars present
    expect(candles.some((c, i) => i > 0 && c.close === candles[i - 1]!.close)).toBe(true); // unchanged closes present
  });

  it('SMA(20) and SMA(5) of the close match TA-Lib', () => {
    expect(maxDiff(smaOf(closes, 20), R.sma20_close)).toBeLessThan(1e-10);
    expect(maxDiff(smaOf(closes, 5), R.sma5_close)).toBeLessThan(1e-10);
  });

  it('RSI(14) and RSI(5) match TA-Lib, including where the first value appears', () => {
    const r14 = compute(rsiDefinition, { period: 14 }).rsi!;
    expect(firstValue(r14)).toBe(firstValue(R.rsi14));
    expect(maxDiff(r14, R.rsi14)).toBeLessThan(1e-10);
    const r5 = compute(rsiDefinition, { period: 5 }).rsi!;
    expect(maxDiff(r5, R.rsi5)).toBeLessThan(1e-10);
  });

  it('SMA of the RSI output matches pandas rolling(20).mean() on TA-Lib RSI, warm-up included', () => {
    const rsi = compute(rsiDefinition).rsi!;
    const out = smaOf(rsi, 20);
    expect(firstValue(out)).toBe(firstValue(R.sma20_of_rsi14)); // 14 warm-up + 19
    expect(maxDiff(out, R.sma20_of_rsi14)).toBeLessThan(1e-10);
  });

  it('OBV matches TA-Lib (same first-bar convention, unchanged closes add nothing)', () => {
    expect(maxDiff(compute(obvDefinition).obv!, R.obv)).toBeLessThan(1e-10);
  });

  it('Accumulation/Distribution matches TA-Lib, including the zero-range bars', () => {
    expect(maxDiff(compute(adDefinition).ad!, R.ad)).toBeLessThan(1e-10);
  });

  it('MACD(12,26,9) matches an independent SMA-seeded implementation exactly, warm-up included', () => {
    const out = compute(macdDefinition);
    for (const key of ['macd', 'signal', 'histogram'] as const) {
      expect(firstValue(out[key]!), key).toBe(firstValue(R.macd_exact[key]));
      expect(maxDiff(out[key]!, R.macd_exact[key]), key).toBeLessThan(1e-10);
    }
  });

  it('MACD with other periods (5,13,4) matches the independent implementation exactly', () => {
    const out = compute(macdDefinition, { fast: 5, slow: 13, signal: 4 });
    for (const key of ['macd', 'signal', 'histogram'] as const) {
      expect(maxDiff(out[key]!, R.macd_exact_5_13_4[key]), key).toBeLessThan(1e-10);
    }
  });

  it('MACD agrees with TA-Lib once its different fast-EMA seed has faded (documented convention difference)', () => {
    // TA-Lib seeds the fast EMA at the slow EMA's first bar; we seed it at its own Nth bar. The seed
    // difference shrinks by (1 - 2/13) per bar, so after ~175 more bars it is below 1e-12.
    const out = compute(macdDefinition);
    const FADED = 200;
    for (const key of ['macd', 'signal', 'histogram'] as const) {
      expect(maxDiff(out[key]!, R.macd_talib[key], FADED), key).toBeLessThan(1e-9);
    }
    // And TA-Lib's first value is at 33 for all three, where ours exist too (just different early values).
    expect(firstValue(R.macd_talib.macd)).toBe(33);
    expect(out.macd![33]).not.toBeNull();
  });
});
