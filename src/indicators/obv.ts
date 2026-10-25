import { createCalculator } from './calculator';
import { defaultsOf, paramSpecsOf, parseIntParams, type IntParamSpec } from './params';
import type { IndicatorDefinition, Kernel } from './types';
import type { Candle } from '../types/marketData';

const SPEC: Readonly<Record<string, IntParamSpec>> = {};

export interface ObvState {
  readonly prevClose: number | null;
  /** Running total, or null before the first bar with volume (or right after a bar without). */
  readonly total: number | null;
}

/**
 * On-Balance Volume: add the bar's volume when the close rises, subtract it when the close falls,
 * add nothing when it is unchanged.
 *
 * Conventions:
 *  - The first bar has no previous close, so it counts as +volume: OBV[0] = volume[0]
 *    (the same convention as TA-Lib and most libraries).
 *  - A bar WITHOUT volume cannot contribute and its true effect is unknown, so its output is null and
 *    the running total is dropped. The next bar that has volume STARTS A NEW SEGMENT exactly like the
 *    first bar of a series. Values on either side of a gap are therefore not comparable with each
 *    other (the line breaks there) and nothing is invented to bridge it.
 */
export const obvKernel: Kernel<Candle, ObvState> = {
  outputKeys: ['obv'],
  init: () => ({ prevClose: null, total: null }),
  step(state, candle) {
    if (candle.volume === null) return { state: { prevClose: candle.close, total: null }, values: { obv: null } };
    let total: number;
    if (state.total === null || state.prevClose === null) {
      total = candle.volume;
    } else {
      const direction = candle.close > state.prevClose ? 1 : candle.close < state.prevClose ? -1 : 0;
      total = state.total + direction * candle.volume;
    }
    return { state: { prevClose: candle.close, total }, values: { obv: total } };
  },
};

export const obvDefinition: IndicatorDefinition = {
  id: 'obv',
  name: 'OBV',
  defaults: defaultsOf(SPEC),
  paramSpecs: paramSpecsOf(SPEC),
  validate: (input) => parseIntParams(input, SPEC),
  inputs: ['close', 'volume'],
  outputs: [{ key: 'obv', label: 'OBV', kind: 'line', smaEligible: true }],
  pane: { kind: 'own', paneId: 'obv' },
  warmup: () => ({ obv: 0 }),
  createCalculator: () => createCalculator(obvKernel),
};
