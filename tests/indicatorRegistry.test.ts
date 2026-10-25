import { describe, expect, it } from 'vitest';
import { IndicatorRegistry, createDefaultRegistry } from '../src/indicators/IndicatorRegistry';
import { rsiDefinition } from '../src/indicators/rsi';
import type { IndicatorDefinition } from '../src/indicators/types';

describe('IndicatorRegistry', () => {
  const registry = createDefaultRegistry();

  it('lists the five indicators in a stable order with stable ids', () => {
    expect(registry.list().map((d) => d.id)).toEqual(['rsi', 'volume', 'obv', 'ad', 'macd']);
  });

  it('every definition is complete: defaults validate, outputs declared, a pane placement, warm-up per output', () => {
    for (const def of registry.list()) {
      expect(def.name.length).toBeGreaterThan(0);
      expect(def.validate(def.defaults)).toEqual({ ok: true, params: def.defaults });
      expect(def.inputs.length).toBeGreaterThan(0);
      expect(def.pane.kind).toBe('own');
      const warmup = def.warmup(def.defaults);
      for (const o of def.outputs) expect(warmup[o.key], `${def.id}.${o.key}`).toBeGreaterThanOrEqual(0);
    }
  });

  it('MACD shares one pane across its three outputs, and the others each have their own pane', () => {
    const panes = registry.list().map((d) => (d.pane.kind === 'own' ? d.pane.paneId : 'price'));
    expect(new Set(panes).size).toBe(panes.length);
    expect(registry.get('macd').outputs.map((o) => o.key)).toEqual(['macd', 'signal', 'histogram']);
  });

  it('derives the SMA source list from the registry: Price first, then every eligible output', () => {
    const options = registry.smaSourceOptions();
    expect(options[0]).toEqual({ key: 'price', label: 'Price', definitionId: null, output: null });
    expect(options.map((o) => o.key)).toEqual([
      'price', 'rsi:rsi', 'volume:volume', 'obv:obv', 'ad:ad', 'macd:macd', 'macd:signal', 'macd:histogram',
    ]);
    expect(options.find((o) => o.key === 'rsi:rsi')!.label).toBe('RSI'); // single output: just the name
    expect(options.find((o) => o.key === 'macd:signal')!.label).toBe('MACD · Signal'); // multi output: name · output
  });

  it('an output marked ineligible is left out of the SMA list, and a newly registered indicator appears with no UI change', () => {
    const r = new IndicatorRegistry();
    const custom: IndicatorDefinition = {
      ...rsiDefinition,
      id: 'custom',
      name: 'Custom',
      outputs: [
        { key: 'a', label: 'A', kind: 'line', smaEligible: true },
        { key: 'b', label: 'B', kind: 'line', smaEligible: false },
      ],
    };
    r.register(custom);
    expect(r.smaSourceOptions().map((o) => o.key)).toEqual(['price', 'custom:a']);
  });

  it('rejects duplicate ids, malformed ids, and definitions without (or with repeated) outputs', () => {
    const r = new IndicatorRegistry();
    r.register(rsiDefinition);
    expect(() => r.register(rsiDefinition)).toThrow(/already registered/);
    expect(() => r.register({ ...rsiDefinition, id: 'Bad Id' })).toThrow(/Invalid indicator id/);
    expect(() => r.register({ ...rsiDefinition, id: 'x', outputs: [] })).toThrow(/no outputs/);
    const dup = { key: 'k', label: 'K', kind: 'line', smaEligible: true } as const;
    expect(() => r.register({ ...rsiDefinition, id: 'y', outputs: [dup, dup] })).toThrow(/duplicate output keys/);
  });

  it('get and outputOf throw clearly for unknown ids and outputs', () => {
    expect(() => registry.get('nope')).toThrow(/unknown indicator/i);
    expect(() => registry.outputOf('macd', 'nope')).toThrow(/no output/);
    expect(registry.outputOf('macd', 'signal').label).toBe('Signal');
    expect(registry.has('rsi')).toBe(true);
    expect(registry.has('sma')).toBe(false); // SMA is a transform of a source, not a registered indicator
  });
});
