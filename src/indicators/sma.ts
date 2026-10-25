import type { Kernel, Value } from './types';

export interface SmaState {
  /** The most recent consecutive non-null inputs (at most `period` of them). */
  readonly window: readonly number[];
}

/**
 * Simple Moving Average: SMA(t) = (x(t) + x(t-1) + ... + x(t-N+1)) / N.
 *
 * - No value until N inputs exist: the first N-1 outputs are null (no partial averages).
 * - A null input (e.g. an indicator's warm-up, or a missing volume) EMPTIES the window, so an
 *   average never spans a gap and is never computed from fewer than N real values; it resumes
 *   after N consecutive valid inputs.
 * - The sum is recomputed over the window each step (not kept as a running total) so rounding
 *   error cannot accumulate over long series.
 */
export function smaKernel(period: number): Kernel<Value, SmaState> {
  return {
    outputKeys: ['sma'],
    init: () => ({ window: [] }),
    step(state, input) {
      if (input === null) return { state: { window: [] }, values: { sma: null } };
      const window = state.window.length >= period ? [...state.window.slice(1), input] : [...state.window, input];
      if (window.length < period) return { state: { window }, values: { sma: null } };
      let sum = 0;
      for (const v of window) sum += v;
      return { state: { window }, values: { sma: sum / period } };
    },
  };
}
