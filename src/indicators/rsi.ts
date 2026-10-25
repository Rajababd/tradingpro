import { createCalculator } from './calculator';
import { defaultsOf, paramSpecsOf, parseIntParams, type IntParamSpec } from './params';
import type { IndicatorDefinition, Kernel } from './types';
import type { Candle } from '../types/marketData';

const SPEC: Readonly<Record<string, IntParamSpec>> = {
  period: { label: 'RSI period', default: 14, min: 2, max: 500 },
};

export interface RsiState {
  readonly prevClose: number | null;
  /** Price changes seen so far. */
  readonly changes: number;
  readonly sumGain: number;
  readonly sumLoss: number;
  readonly avgGain: number;
  readonly avgLoss: number;
}

/**
 * Relative Strength Index with Wilder's smoothing.
 *  - change(t) = close(t) - close(t-1); gain = max(change, 0); loss = max(-change, 0).
 *  - The first average gain/loss is the plain mean of the first N gains/losses, so the first RSI
 *    is at index N (N+1 closes are needed): N leading nulls.
 *  - After that: avg = (previous avg * (N - 1) + current) / N.
 *  - RSI = 100 * (avgGain / (avgGain + avgLoss)), identical to 100 - 100 / (1 + avgGain / avgLoss)
 *    but without dividing by zero when avgLoss is 0 (that case is exactly 100).
 *  - If both averages are 0 (no price movement in the whole smoothed history) RSI is mathematically
 *    0/0 and is reported as null rather than an invented 0, 50 or 100.
 * Output range is [0, 100].
 */
export function rsiKernel(period: number): Kernel<Candle, RsiState> {
  return {
    outputKeys: ['rsi'],
    init: () => ({ prevClose: null, changes: 0, sumGain: 0, sumLoss: 0, avgGain: 0, avgLoss: 0 }),
    step(state, candle) {
      if (state.prevClose === null) {
        return { state: { ...state, prevClose: candle.close }, values: { rsi: null } };
      }
      const change = candle.close - state.prevClose;
      const gain = change > 0 ? change : 0;
      const loss = change < 0 ? -change : 0;
      const changes = state.changes + 1;

      if (changes < period) {
        return {
          state: { ...state, prevClose: candle.close, changes, sumGain: state.sumGain + gain, sumLoss: state.sumLoss + loss },
          values: { rsi: null },
        };
      }

      const avgGain = changes === period ? (state.sumGain + gain) / period : (state.avgGain * (period - 1) + gain) / period;
      const avgLoss = changes === period ? (state.sumLoss + loss) / period : (state.avgLoss * (period - 1) + loss) / period;
      const denominator = avgGain + avgLoss;
      return {
        state: { prevClose: candle.close, changes, sumGain: state.sumGain + gain, sumLoss: state.sumLoss + loss, avgGain, avgLoss },
        // Divide BEFORE multiplying: the ratio is exactly 1 with no losses and exactly 0 with no gains, and can
        // never exceed 1, so the result is exactly 100 / 0 at the extremes and always within [0, 100].
        values: { rsi: denominator === 0 ? null : 100 * (avgGain / denominator) },
      };
    },
  };
}

export const rsiDefinition: IndicatorDefinition = {
  id: 'rsi',
  name: 'RSI',
  defaults: defaultsOf(SPEC),
  paramSpecs: paramSpecsOf(SPEC),
  validate: (input) => parseIntParams(input, SPEC),
  inputs: ['close'],
  outputs: [{ key: 'rsi', label: 'RSI', kind: 'line', smaEligible: true }],
  pane: { kind: 'own', paneId: 'rsi' },
  warmup: (p) => ({ rsi: p['period']! }),
  createCalculator: (p) => createCalculator(rsiKernel(p['period']!)),
};
