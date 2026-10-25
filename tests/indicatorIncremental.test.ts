import { describe, expect, it } from 'vitest';
import { adDefinition } from '../src/indicators/accumulationDistribution';
import { createCalculator } from '../src/indicators/calculator';
import { macdDefinition } from '../src/indicators/macd';
import { obvDefinition } from '../src/indicators/obv';
import { rsiDefinition } from '../src/indicators/rsi';
import { smaKernel } from '../src/indicators/sma';
import type { IndicatorDefinition, Value } from '../src/indicators/types';
import { volumeDefinition } from '../src/indicators/volume';
import type { Candle } from '../src/types/marketData';
import { fromCloses, mulberry32, randomCandles, revised } from './helpers/candles';

const DEFINITIONS: IndicatorDefinition[] = [rsiDefinition, volumeDefinition, obvDefinition, adDefinition, macdDefinition];
const paramsOf = (def: IndicatorDefinition) => (def.validate(undefined) as { ok: true; params: Record<string, number> }).params;

/**
 * Streams candles in the way a live feed does: each bar is appended, then (often) revised a few times as
 * ticks arrive, then the next bar is appended. Returns the FINAL candle list the stream converged on.
 */
function stream(
  base: readonly Candle[],
  seed: number,
  onAppend: (c: Candle) => void,
  onRevise: (c: Candle) => void,
): Candle[] {
  const rand = mulberry32(seed);
  const final: Candle[] = [];
  for (const candle of base) {
    let current = candle;
    onAppend(current);
    const revisions = rand() < 0.6 ? 1 + Math.floor(rand() * 3) : 0;
    for (let r = 0; r < revisions; r++) {
      current = revised(current, rand);
      onRevise(current);
    }
    final.push(current);
  }
  return final;
}

describe('incremental == batch (exactly), including repeated revisions of the live bar', () => {
  for (const def of DEFINITIONS) {
    for (const missingVolumeRate of [0, 0.25]) {
      it(`${def.id}${missingVolumeRate > 0 ? ' with missing volumes' : ''}`, () => {
        for (const seed of [1, 2, 3, 4, 5]) {
          const live = def.createCalculator(paramsOf(def));
          const final = stream(randomCandles(150, seed, missingVolumeRate), seed * 31, (c) => live.append(c), (c) => live.updateLast(c));

          const batch = def.createCalculator(paramsOf(def));
          batch.reset(final);

          expect(live.length).toBe(batch.length);
          for (const o of def.outputs) {
            expect([...live.column(o.key)], `${def.id}.${o.key} seed ${seed}`).toEqual([...batch.column(o.key)]);
          }
        }
      });
    }
  }

  it('SMA of price', () => {
    for (const seed of [1, 2, 3]) {
      const live = createCalculator(smaKernel(10));
      const final = stream(randomCandles(120, seed), seed, (c) => live.append(c.close), (c) => live.updateLast(c.close));
      const batch = createCalculator(smaKernel(10));
      batch.reset(final.map((c) => c.close));
      expect([...live.column('sma')]).toEqual([...batch.column('sma')]);
    }
  });

  it('SMA of an indicator output (RSI, with its warm-up nulls feeding the SMA)', () => {
    for (const seed of [1, 2, 3]) {
      const rsi = rsiDefinition.createCalculator(paramsOf(rsiDefinition));
      const sma = createCalculator(smaKernel(7));
      const final = stream(
        randomCandles(120, seed),
        seed,
        (c) => sma.append(rsi.append(c)['rsi']!),
        (c) => sma.updateLast(rsi.updateLast(c)['rsi']!),
      );
      const rsiBatch = rsiDefinition.createCalculator(paramsOf(rsiDefinition));
      rsiBatch.reset(final);
      const smaBatch = createCalculator(smaKernel(7));
      smaBatch.reset(rsiBatch.column('rsi'));
      expect([...sma.column('sma')]).toEqual([...smaBatch.column('sma')]);
    }
  });

  it('revising the latest bar and then reverting it restores the exact original values', () => {
    for (const def of DEFINITIONS) {
      const candles = randomCandles(60, 7);
      const calc = def.createCalculator(paramsOf(def));
      calc.reset(candles);
      const before = def.outputs.map((o) => [...calc.column(o.key)]);
      const rand = mulberry32(1);
      calc.updateLast(revised(candles.at(-1)!, rand));
      calc.updateLast(candles.at(-1)!);
      expect(def.outputs.map((o) => [...calc.column(o.key)]), def.id).toEqual(before);
    }
  });
});

describe('calculator mechanics', () => {
  it('updateLast on an empty series throws', () => {
    const calc = rsiDefinition.createCalculator(paramsOf(rsiDefinition));
    expect(() => calc.updateLast(randomCandles(1, 1)[0]!)).toThrow(/empty series/);
  });

  it('updateLast right after the first bar revises it (the state before it is the initial state)', () => {
    const calc = obvDefinition.createCalculator({});
    const [a] = fromCloses([10], [100]);
    calc.append(a!);
    calc.updateLast({ ...a!, volume: 250 });
    expect([...calc.column('obv')]).toEqual([250]);
  });

  it('reset clears previous data and state completely', () => {
    const calc = macdDefinition.createCalculator(paramsOf(macdDefinition));
    calc.reset(randomCandles(80, 1));
    const fresh = macdDefinition.createCalculator(paramsOf(macdDefinition));
    const candles = randomCandles(50, 2);
    calc.reset(candles);
    fresh.reset(candles);
    expect([...calc.column('macd')]).toEqual([...fresh.column('macd')]);
    expect(calc.length).toBe(50);
  });

  it('rowAt returns one value per output and rejects bad indices; column rejects unknown outputs', () => {
    const calc = macdDefinition.createCalculator(paramsOf(macdDefinition));
    calc.reset(randomCandles(40, 3));
    expect(Object.keys(calc.rowAt(39))).toEqual(['macd', 'signal', 'histogram']);
    expect(() => calc.rowAt(40)).toThrow(RangeError);
    expect(() => calc.rowAt(-1)).toThrow(RangeError);
    expect(() => calc.rowAt(1.5)).toThrow(RangeError);
    expect(() => calc.column('nope')).toThrow(/unknown output/i);
  });

  it('kernel steps are pure: stepping twice from one state gives equal results and leaves the state untouched', () => {
    const candles = randomCandles(30, 4);
    const calc = rsiDefinition.createCalculator(paramsOf(rsiDefinition));
    calc.reset(candles.slice(0, 29));
    const a = calc.append(candles[29]!);
    calc.updateLast(candles[29]!);
    const b = calc.rowAt(29);
    expect(b).toEqual(a);
  });
});

describe('cost of a live tick does not grow with history', () => {
  it('one updateLast on a 50,000-bar series is far cheaper than recomputing it', () => {
    const candles = randomCandles(50_000, 11);
    const calc = macdDefinition.createCalculator(paramsOf(macdDefinition));
    const t0 = performance.now();
    calc.reset(candles);
    const full = performance.now() - t0;

    const rand = mulberry32(3);
    const tick = revised(candles.at(-1)!, rand);
    const t1 = performance.now();
    for (let i = 0; i < 1000; i++) calc.updateLast(tick);
    const perTick = (performance.now() - t1) / 1000;

    expect(calc.length).toBe(50_000);
    expect(perTick).toBeLessThan(full / 100); // measured: ~1000x cheaper; the bound is deliberately loose
  });
});
