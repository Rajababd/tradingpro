import type { PaneId } from '../chart/PaneManager';
import type { ParamSpecInfo } from './params';
import type { Candle } from '../types/marketData';

/** One value of an indicator output. `null` means "no value here" (warm-up, or an undefined result). */
export type Value = number | null;

export type CandleField = 'open' | 'high' | 'low' | 'close' | 'volume';

export type Params = Readonly<Record<string, number>>;

export interface OutputDef {
  /** Stable key, e.g. `macd`, `signal`. */
  readonly key: string;
  readonly label: string;
  /** How a chart should draw it. */
  readonly kind: 'line' | 'histogram';
  /** Whether a Simple Moving Average of this output is meaningful (and so offered as an SMA source). */
  readonly smaEligible: boolean;
}

/** Where an indicator prefers to be drawn. Pane ids are stable logical ids, never chart indices. */
export type PanePlacement = { readonly kind: 'price' } | { readonly kind: 'own'; readonly paneId: PaneId };

export type ParamsResult<P> =
  | { readonly ok: true; readonly params: P }
  | { readonly ok: false; readonly errors: readonly string[] };

/**
 * A calculation expressed as a PURE step function over a growing series. Because the same
 * `step` is used for the first calculation and for every later update, incremental results
 * equal batch results by construction (and a test checks it anyway).
 *
 * `state` must be treated as immutable: `step` returns a new state and never mutates the old
 * one. That is what lets the latest bar be revised (a live tick) by re-stepping from the state
 * that preceded it.
 */
export interface Kernel<I, S> {
  readonly outputKeys: readonly string[];
  init(): S;
  step(state: S, input: I): { readonly state: S; readonly values: Readonly<Record<string, Value>> };
}

/** A kernel bound to a series, with its output columns. */
export interface Calculator<I> {
  readonly outputKeys: readonly string[];
  /** Number of inputs processed (one output row per input). */
  readonly length: number;
  /** Recomputes everything from `inputs`. */
  reset(inputs: readonly I[]): void;
  /** Adds the next input; returns its output row. */
  append(input: I): Readonly<Record<string, Value>>;
  /** Revises the LAST input (same bar, new values); returns its output row. */
  updateLast(input: I): Readonly<Record<string, Value>>;
  /** Output column, aligned one-to-one with the inputs. Live view: do not mutate. */
  column(key: string): readonly Value[];
  rowAt(index: number): Readonly<Record<string, Value>>;
}

export interface IndicatorDefinition {
  /** Stable identifier, e.g. `rsi`. Persisted settings refer to it. */
  readonly id: string;
  readonly name: string;
  readonly defaults: Params;
  /** Label and allowed range of each parameter, for settings UIs. Empty when there is nothing to configure. */
  readonly paramSpecs: readonly ParamSpecInfo[];
  /** Merges `input` over the defaults and validates. Unknown keys and out-of-range values are errors. */
  validate(input: unknown): ParamsResult<Params>;
  /** Candle fields the calculation reads. */
  readonly inputs: readonly CandleField[];
  readonly outputs: readonly OutputDef[];
  readonly pane: PanePlacement;
  /**
   * For each output key, how many leading bars have no value. Exact for a series with no gaps
   * and no undefined results; tests assert the calculation matches this.
   */
  warmup(params: Params): Readonly<Record<string, number>>;
  createCalculator(params: Params): Calculator<Candle>;
}

/** What an SMA is computed from. */
export type SmaSource =
  | { readonly kind: 'price' }
  | { readonly kind: 'indicator'; readonly instanceId: string; readonly output: string };
