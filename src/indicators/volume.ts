import { createCalculator } from './calculator';
import { defaultsOf, paramSpecsOf, parseIntParams, type IntParamSpec } from './params';
import type { IndicatorDefinition, Kernel } from './types';
import type { Candle } from '../types/marketData';

const SPEC: Readonly<Record<string, IntParamSpec>> = {};

/**
 * Traded volume per bar, as a histogram. A bar with no volume is null (no bar drawn): a missing
 * volume is never shown as 0. A genuine volume of 0 is kept as 0.
 */
export const volumeKernel: Kernel<Candle, null> = {
  outputKeys: ['volume'],
  init: () => null,
  step: (_state, candle) => ({ state: null, values: { volume: candle.volume } }),
};

export const volumeDefinition: IndicatorDefinition = {
  id: 'volume',
  name: 'Volume',
  defaults: defaultsOf(SPEC),
  paramSpecs: paramSpecsOf(SPEC),
  validate: (input) => parseIntParams(input, SPEC),
  inputs: ['volume'],
  // An average volume is a standard, meaningful overlay, so Volume is an SMA source.
  outputs: [{ key: 'volume', label: 'Volume', kind: 'histogram', smaEligible: true }],
  pane: { kind: 'own', paneId: 'volume' },
  warmup: () => ({ volume: 0 }),
  createCalculator: () => createCalculator(volumeKernel),
};
