import { createCalculator } from './calculator';
import { defaultsOf, paramSpecsOf, parseIntParams, type IntParamSpec } from './params';
import type { IndicatorDefinition, Kernel } from './types';
import type { Candle } from '../types/marketData';

const SPEC: Readonly<Record<string, IntParamSpec>> = {};

export interface AdState {
  /** Running total, or null before the first bar with volume (or right after a bar without). */
  readonly total: number | null;
}

/**
 * Accumulation/Distribution Line.
 *  - Money-flow multiplier = ((close - low) - (high - close)) / (high - low), in [-1, 1].
 *  - A zero-range bar (high == low) has no close location, so its multiplier is 0 (it adds nothing).
 *  - Money-flow volume = multiplier * volume; the line is the running sum, starting from the first
 *    bar's own money-flow volume.
 *  - A bar without volume gives null and starts a new segment afterwards (see OBV for the reasoning).
 */
export const adKernel: Kernel<Candle, AdState> = {
  outputKeys: ['ad'],
  init: () => ({ total: null }),
  step(state, candle) {
    if (candle.volume === null) return { state: { total: null }, values: { ad: null } };
    const range = candle.high - candle.low;
    const multiplier = range === 0 ? 0 : (candle.close - candle.low - (candle.high - candle.close)) / range;
    const flow = multiplier * candle.volume;
    const total = state.total === null ? flow : state.total + flow;
    return { state: { total }, values: { ad: total } };
  },
};

export const adDefinition: IndicatorDefinition = {
  id: 'ad',
  name: 'Accumulation/Distribution',
  defaults: defaultsOf(SPEC),
  paramSpecs: paramSpecsOf(SPEC),
  validate: (input) => parseIntParams(input, SPEC),
  inputs: ['high', 'low', 'close', 'volume'],
  outputs: [{ key: 'ad', label: 'A/D', kind: 'line', smaEligible: true }],
  pane: { kind: 'own', paneId: 'ad' },
  warmup: () => ({ ad: 0 }),
  createCalculator: () => createCalculator(adKernel),
};
