import { describe, expect, it, vi } from 'vitest';
import { IndicatorConfigError, IndicatorEngine, IndicatorSyncError, type IndicatorChange } from '../src/indicators/IndicatorEngine';
import { createCalculator } from '../src/indicators/calculator';
import { smaKernel } from '../src/indicators/sma';
import type { Value } from '../src/indicators/types';
import { mulberry32, randomCandles, revised } from './helpers/candles';
import type { Candle } from '../src/types/marketData';

const smaOver = (values: readonly Value[], period: number) => {
  const calc = createCalculator(smaKernel(period));
  calc.reset(values);
  return [...calc.column('sma')];
};

function configured(candles: readonly Candle[] = []) {
  const e = new IndicatorEngine();
  e.addIndicator({ definitionId: 'rsi' });
  e.addIndicator({ definitionId: 'rsi', id: 'rsi-fast', params: { period: 5 } });
  e.addIndicator({ definitionId: 'macd' });
  e.addIndicator({ definitionId: 'obv' });
  e.addIndicator({ definitionId: 'ad' });
  e.addIndicator({ definitionId: 'volume' });
  e.addSma({ id: 'sma-price-20', source: { kind: 'price' }, period: 20 });
  e.addSma({ id: 'sma-rsi-10', source: { kind: 'indicator', instanceId: 'rsi', output: 'rsi' }, period: 10 });
  e.addSma({ id: 'sma-signal-5', source: { kind: 'indicator', instanceId: 'macd', output: 'signal' }, period: 5 });
  if (candles.length > 0) e.reset(candles);
  return e;
}
const snapshot = (e: IndicatorEngine) =>
  Object.fromEntries(e.list().map((i) => [i.id, Object.fromEntries(i.outputs.map((o) => [o.key, [...e.values(i.id, o.key)]]))]));

describe('IndicatorEngine: configuration', () => {
  it('instances have stable ids; two RSIs with different periods coexist independently', () => {
    const e = configured(randomCandles(60, 1));
    expect(e.get('rsi')).toMatchObject({ kind: 'indicator', definitionId: 'rsi', params: { period: 14 } });
    expect(e.get('rsi-fast')).toMatchObject({ params: { period: 5 } });
    expect(e.values('rsi', 'rsi').findIndex((v) => v !== null)).toBe(14);
    expect(e.values('rsi-fast', 'rsi').findIndex((v) => v !== null)).toBe(5);
  });

  it('the id defaults to the definition id; duplicates and malformed ids are refused', () => {
    const e = new IndicatorEngine();
    expect(e.addIndicator({ definitionId: 'obv' }).id).toBe('obv');
    expect(() => e.addIndicator({ definitionId: 'obv' })).toThrow(IndicatorConfigError);
    expect(() => e.addIndicator({ definitionId: 'rsi', id: 'Bad Id' })).toThrow(/Invalid instance id/);
    expect(() => e.addIndicator({ definitionId: 'nope' })).toThrow(/Unknown indicator/);
  });

  it('invalid parameters are refused with the reasons, and nothing is created', () => {
    const e = new IndicatorEngine();
    try {
      e.addIndicator({ definitionId: 'macd', params: { fast: 30, slow: 10 } });
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(IndicatorConfigError);
      expect((error as IndicatorConfigError).errors.join()).toMatch(/shorter than the slow/);
    }
    expect(e.list()).toEqual([]);
  });

  it('SMA sources are validated: must exist, must be an indicator output that is SMA-eligible, never another SMA', () => {
    const e = configured();
    const add = (source: Parameters<IndicatorEngine['addSma']>[0]['source']) => () => e.addSma({ id: 'x', source, period: 3 });
    expect(add({ kind: 'indicator', instanceId: 'ghost', output: 'rsi' })).toThrow(/does not exist/);
    expect(add({ kind: 'indicator', instanceId: 'rsi', output: 'nope' })).toThrow(/no output "nope"/);
    expect(add({ kind: 'indicator', instanceId: 'sma-price-20', output: 'sma' })).toThrow(/cannot read another SMA/);
    for (const period of [0, -1, 1.5, Number.NaN, 1001]) {
      expect(() => e.addSma({ id: 'y', source: { kind: 'price' }, period })).toThrow(/SMA period/);
    }
  });

  it('an output that is not SMA-eligible is refused as a source', () => {
    const registry = configured().registry;
    const rsi = registry.get('rsi');
    registry.register({ ...rsi, id: 'picky', outputs: [{ key: 'v', label: 'V', kind: 'line', smaEligible: false }] });
    const e = new IndicatorEngine(registry);
    e.addIndicator({ definitionId: 'picky' });
    expect(() => e.addSma({ id: 's', source: { kind: 'indicator', instanceId: 'picky', output: 'v' }, period: 3 })).toThrow(/cannot be a source/);
  });
});

describe('IndicatorEngine: SMA sources', () => {
  it('SMA on price uses the closes, with N-1 warm-up nulls', () => {
    const candles = randomCandles(40, 2);
    const e = configured(candles);
    expect(e.values('sma-price-20', 'sma')).toEqual(smaOver(candles.map((c) => c.close), 20));
    expect(e.values('sma-price-20', 'sma').findIndex((v) => v !== null)).toBe(19);
  });

  it('SMA on an indicator output uses exactly that output (RSI), and the warm-up adds up', () => {
    const e = configured(randomCandles(60, 3));
    expect(e.values('sma-rsi-10', 'sma')).toEqual(smaOver(e.values('rsi', 'rsi'), 10));
    expect(e.values('sma-rsi-10', 'sma').findIndex((v) => v !== null)).toBe(14 + 10 - 1);
  });

  it('SMA on a specific MACD output line uses that line, not another one', () => {
    const e = configured(randomCandles(80, 4));
    const signal = e.values('macd', 'signal');
    expect(e.values('sma-signal-5', 'sma')).toEqual(smaOver(signal, 5));
    expect(e.values('sma-signal-5', 'sma')).not.toEqual(smaOver(e.values('macd', 'macd'), 5));
    expect(e.values('sma-signal-5', 'sma').findIndex((v) => v !== null)).toBe(33 + 5 - 1);
  });

  it('changing a period recomputes only that SMA and announces a reset for it', () => {
    const candles = randomCandles(60, 5);
    const e = configured(candles);
    const seen: IndicatorChange[] = [];
    e.subscribe((c) => seen.push(c));
    e.setSmaPeriod('sma-price-20', 5);
    expect(e.values('sma-price-20', 'sma')).toEqual(smaOver(candles.map((c) => c.close), 5));
    expect(e.get('sma-price-20')).toMatchObject({ period: 5 });
    expect(seen).toEqual([{ type: 'reset', instanceId: 'sma-price-20' }]);
    expect(() => e.setSmaPeriod('rsi', 5)).toThrow(/not an SMA/);
    expect(() => e.setSmaPeriod('sma-price-20', 0)).toThrow(/SMA period/);
    expect(e.get('sma-price-20')).toMatchObject({ period: 5 }); // the failed change left it alone
  });
});

describe('IndicatorEngine: parameters and removal', () => {
  it('setParams patches some parameters, recomputes the indicator AND the SMAs that read it', () => {
    const candles = randomCandles(80, 6);
    const e = configured(candles);
    const seen: IndicatorChange[] = [];
    e.subscribe((c) => seen.push(c));
    e.setParams('rsi', { period: 7 });

    const fresh = configured(candles);
    fresh.setParams('rsi', { period: 7 });
    expect(e.values('rsi', 'rsi')).toEqual(fresh.values('rsi', 'rsi'));
    expect(e.values('sma-rsi-10', 'sma')).toEqual(smaOver(e.values('rsi', 'rsi'), 10));
    expect(seen.map((c) => (c.type === 'reset' ? c.instanceId : '?'))).toEqual(['rsi', 'sma-rsi-10']);

    e.setParams('macd', { fast: 8 });
    expect(e.get('macd')).toMatchObject({ params: { fast: 8, slow: 26, signal: 9 } }); // others kept
  });

  it('an invalid change throws and leaves the instance exactly as it was', () => {
    const e = configured(randomCandles(60, 7));
    const before = snapshot(e);
    expect(() => e.setParams('macd', { fast: 40 })).toThrow(/shorter than the slow/);
    expect(() => e.setParams('rsi', { period: 'x' })).toThrow(IndicatorConfigError);
    expect(() => e.setParams('rsi', 5 as never)).toThrow(/must be an object/);
    expect(() => e.setParams('sma-price-20', {})).toThrow(/is an SMA/);
    expect(snapshot(e)).toEqual(before);
  });

  it('an indicator cannot be removed while an SMA reads from it; after that it can', () => {
    const e = configured(randomCandles(40, 8));
    expect(e.dependentsOf('rsi')).toEqual(['sma-rsi-10']);
    expect(() => e.remove('rsi')).toThrow(/sma-rsi-10/);
    expect(e.has('rsi')).toBe(true);

    const seen: IndicatorChange[] = [];
    e.subscribe((c) => seen.push(c));
    e.remove('sma-rsi-10');
    e.remove('rsi');
    expect(e.has('rsi')).toBe(false);
    expect(seen).toEqual([
      { type: 'removed', instanceId: 'sma-rsi-10' },
      { type: 'removed', instanceId: 'rsi' },
    ]);
    expect(() => e.remove('rsi')).toThrow(/Unknown instance/);
    expect(() => e.values('rsi', 'rsi')).toThrow(/Unknown instance/);
  });

  it('removing one instance does not disturb the others', () => {
    const candles = randomCandles(60, 9);
    const e = configured(candles);
    const keep = [...e.values('macd', 'macd')];
    e.remove('obv');
    expect([...e.values('macd', 'macd')]).toEqual(keep);
  });
});

describe('IndicatorEngine: live data', () => {
  it('append and update emit one point per instance, indicators before the SMAs that read them', () => {
    const candles = randomCandles(50, 10);
    const e = configured(candles.slice(0, 49));
    const seen: IndicatorChange[] = [];
    e.subscribe((c) => seen.push(c));

    e.append(candles[49]!);
    const points = seen.filter((c): c is Extract<IndicatorChange, { type: 'point' }> => c.type === 'point');
    expect(points).toHaveLength(e.list().length);
    expect(points.every((p) => p.kind === 'append' && p.index === 49 && p.time === candles[49]!.time)).toBe(true);
    const order = points.map((p) => p.instanceId);
    expect(order.indexOf('rsi')).toBeLessThan(order.indexOf('sma-rsi-10'));
    expect(order.indexOf('macd')).toBeLessThan(order.indexOf('sma-signal-5'));
    expect(points.find((p) => p.instanceId === 'rsi')!.values['rsi']).toBe(e.values('rsi', 'rsi')[49]);

    seen.length = 0;
    e.update({ ...candles[49]!, close: candles[49]!.close + 0.3, high: candles[49]!.high + 0.5 });
    expect(seen.every((c) => c.type === 'point' && c.kind === 'update' && c.index === 49)).toBe(true);
    expect(e.length).toBe(50);
  });

  it('listeners are notified only when EVERY instance already reflects the new bar', () => {
    const candles = randomCandles(60, 11);
    const e = configured(candles.slice(0, 59));
    const consistent: boolean[] = [];
    e.subscribe(() => {
      consistent.push(e.list().every((i) => i.outputs.every((o) => e.values(i.id, o.key).length === e.length)));
    });
    e.append(candles[59]!);
    expect(consistent.length).toBeGreaterThan(0);
    expect(consistent.every(Boolean)).toBe(true);
  });

  it('the SMA of an indicator uses that indicator\'s NEW value when the live bar changes', () => {
    const candles = randomCandles(60, 12);
    const e = configured(candles);
    const rand = mulberry32(5);
    e.update(revised(candles.at(-1)!, rand));
    expect(e.values('sma-rsi-10', 'sma')).toEqual(smaOver(e.values('rsi', 'rsi'), 10));
    expect(e.values('sma-signal-5', 'sma')).toEqual(smaOver(e.values('macd', 'signal'), 5));
  });

  it('streaming with live revisions gives exactly what a fresh recompute of the final candles gives (all instances)', () => {
    for (const [seed, missing] of [[1, 0], [2, 0.2]] as const) {
      const base = randomCandles(140, seed, missing);
      const rand = mulberry32(seed + 100);
      const streamed = configured();
      const final: Candle[] = [];
      for (const candle of base) {
        let current = candle;
        streamed.append(current);
        for (let r = rand() < 0.6 ? 1 + Math.floor(rand() * 3) : 0; r > 0; r--) {
          current = revised(current, rand);
          streamed.update(current);
        }
        final.push(current);
      }
      const batch = configured(final);
      expect(snapshot(streamed), `seed ${seed}`).toEqual(snapshot(batch));
      expect([...streamed.times]).toEqual(final.map((c) => c.time));
    }
  });

  it('instances added before any data fill in as bars arrive; instances added later catch up from the existing bars', () => {
    const candles = randomCandles(60, 13);
    const early = configured();
    for (const c of candles) early.append(c);
    const late = configured(candles);
    expect(snapshot(early)).toEqual(snapshot(late));

    const added = new IndicatorEngine();
    added.reset(candles);
    added.addIndicator({ definitionId: 'rsi' });
    expect([...added.values('rsi', 'rsi')]).toEqual([...late.values('rsi', 'rsi')]);
  });

  it('prepending older history recomputes everything and shifts every index', () => {
    const all = randomCandles(120, 14);
    const e = configured(all.slice(40));
    const firstBefore = e.values('rsi', 'rsi').findIndex((v) => v !== null);
    e.prepend(all);
    expect(snapshot(e)).toEqual(snapshot(configured(all)));
    expect(e.length).toBe(120);
    expect(firstBefore).toBe(14);
    expect(e.values('rsi', 'rsi').findIndex((v) => v !== null)).toBe(14); // warm-up is relative to the new first bar
  });
});

describe('IndicatorEngine: sync errors are loud, not silent', () => {
  it('refuses a bar that is not newer, a mismatched update, an update with no bars, and unsorted data', () => {
    const candles = randomCandles(20, 15);
    const e = configured(candles);
    expect(() => e.append(candles[19]!)).toThrow(IndicatorSyncError);
    expect(() => e.append(candles[5]!)).toThrow(IndicatorSyncError);
    expect(() => e.update(candles[5]!)).toThrow(IndicatorSyncError);
    expect(() => new IndicatorEngine().update(candles[0]!)).toThrow(/no bars yet/);
    expect(() => e.reset([candles[3]!, candles[2]!])).toThrow(IndicatorSyncError);
    expect(e.length).toBe(20); // every refusal left the data untouched
  });

  it('a refused bar leaves every output unchanged', () => {
    const candles = randomCandles(30, 16);
    const e = configured(candles);
    const before = snapshot(e);
    expect(() => e.append(candles[10]!)).toThrow();
    expect(snapshot(e)).toEqual(before);
  });
});

describe('IndicatorEngine: errors thrown by listeners do not corrupt calculation', () => {
  it('a throwing listener is logged by the channel and the data is still correct', () => {
    const candles = randomCandles(40, 17);
    const e = configured(candles.slice(0, 39));
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    e.subscribe(() => {
      throw new Error('listener bug');
    });
    e.append(candles[39]!);
    expect(snapshot(e)).toEqual(snapshot(configured(candles)));
    log.mockRestore();
  });
});
