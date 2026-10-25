import { createCalculator } from './calculator';
import { defaultsOf, paramSpecsOf, parseIntParams, type IntParamSpec } from './params';
import type { IndicatorDefinition, Kernel } from './types';
import type { Candle } from '../types/marketData';

const SPEC: Readonly<Record<string, IntParamSpec>> = {
  fast: { label: 'Fast EMA period', default: 12, min: 1, max: 500 },
  slow: { label: 'Slow EMA period', default: 26, min: 2, max: 500 },
  signal: { label: 'Signal EMA period', default: 9, min: 1, max: 500 },
};

interface EmaState {
  /** Inputs consumed so far. */
  readonly count: number;
  readonly seedSum: number;
  readonly value: number | null;
}

const EMA_INIT: EmaState = { count: 0, seedSum: 0, value: null };

/**
 * Exponential moving average with an SMA seed: the first value (at the Nth input) is the plain mean of
 * the first N inputs, then EMA = k * x + (1 - k) * previous with k = 2 / (N + 1). Null before that.
 */
function emaStep(state: EmaState, x: number, period: number): EmaState {
  const count = state.count + 1;
  if (count < period) return { count, seedSum: state.seedSum + x, value: null };
  if (count === period) return { count, seedSum: state.seedSum + x, value: (state.seedSum + x) / period };
  const k = 2 / (period + 1);
  return { count, seedSum: state.seedSum, value: k * x + (1 - k) * (state.value as number) };
}

export interface MacdState {
  readonly fast: EmaState;
  readonly slow: EmaState;
  readonly signal: EmaState;
}

/**
 * MACD.
 *  - MACD line = EMA(close, fast) - EMA(close, slow). Each EMA is seeded with an SMA at its own Nth bar,
 *    so the MACD line first has a value at index slow - 1.
 *  - Signal = EMA of the MACD line, seeded with the mean of its first `signal` values, so it first has a
 *    value at index slow + signal - 2.
 *  - Histogram = MACD line - signal, same warm-up as the signal.
 * This is the common (TradingView / StockCharts) convention. TA-Lib seeds the fast EMA differently at the
 * start; the two agree to within rounding once the fast EMA's memory has faded (checked in the tests).
 */
export function macdKernel(fast: number, slow: number, signal: number): Kernel<Candle, MacdState> {
  return {
    outputKeys: ['macd', 'signal', 'histogram'],
    init: () => ({ fast: EMA_INIT, slow: EMA_INIT, signal: EMA_INIT }),
    step(state, candle) {
      const fastState = emaStep(state.fast, candle.close, fast);
      const slowState = emaStep(state.slow, candle.close, slow);
      const macd = fastState.value !== null && slowState.value !== null ? fastState.value - slowState.value : null;
      const signalState = macd === null ? state.signal : emaStep(state.signal, macd, signal);
      const signalValue = signalState.value;
      return {
        state: { fast: fastState, slow: slowState, signal: signalState },
        values: {
          macd,
          signal: signalValue,
          histogram: macd !== null && signalValue !== null ? macd - signalValue : null,
        },
      };
    },
  };
}

export const macdDefinition: IndicatorDefinition = {
  id: 'macd',
  name: 'MACD',
  defaults: defaultsOf(SPEC),
  paramSpecs: paramSpecsOf(SPEC),
  validate: (input) =>
    parseIntParams(input, SPEC, [(p) => (p['fast']! < p['slow']! ? null : 'Fast EMA period must be shorter than the slow EMA period')]),
  inputs: ['close'],
  // All three lines are plain numbers on one scale, so each can be a source for an SMA.
  outputs: [
    { key: 'macd', label: 'MACD', kind: 'line', smaEligible: true },
    { key: 'signal', label: 'Signal', kind: 'line', smaEligible: true },
    { key: 'histogram', label: 'Histogram', kind: 'histogram', smaEligible: true },
  ],
  pane: { kind: 'own', paneId: 'macd' }, // one shared pane for all three outputs
  warmup: (p) => ({
    macd: p['slow']! - 1,
    signal: p['slow']! + p['signal']! - 2,
    histogram: p['slow']! + p['signal']! - 2,
  }),
  createCalculator: (p) => createCalculator(macdKernel(p['fast']!, p['slow']!, p['signal']!)),
};
