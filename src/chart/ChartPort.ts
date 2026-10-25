import type { IChartApi } from 'lightweight-charts';

/**
 * The slice of the Lightweight Charts API the managers depend on. Depending on
 * this (not the whole chart) keeps managers unit-testable with a small fake, and
 * makes the supported surface explicit.
 *
 * Deliberately absent: `IPaneApi.moveTo`. In lightweight-charts 5.2.1 it only
 * works for index 0 or "no movement" and throws "Invalid pane index" otherwise
 * (observed in a real browser; see docs/lightweight-charts-notes.md).
 */
export type ChartPort = Pick<
  IChartApi,
  | 'addSeries'
  | 'removeSeries'
  | 'swapPanes'
  | 'timeScale'
  | 'subscribeCrosshairMove'
  | 'unsubscribeCrosshairMove'
>;
