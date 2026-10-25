import type { ViewportListener } from '../chart/ViewportController';
import type { MarketDataService } from '../data/MarketDataService';
import type { Candle } from '../types/marketData';
import type { Unsubscribe } from '../utils/eventChannel';

/** The slice of ChartController this wiring needs. ChartController satisfies it. */
export interface ChartSink {
  setCandles(candles: readonly Candle[]): void;
  updateCandle(candle: Candle): void;
  prependCandles(all: readonly Candle[], added: number): void;
  readonly viewport: { subscribe(listener: ViewportListener): Unsubscribe };
}

export interface BindOptions {
  /** Request older history when the user pans left and fewer than this many candles remain to the left. */
  loadOlderWithinBars: number;
}

/**
 * Connects data to the chart, in one place:
 *  - service events become incremental chart calls (never a full rebuild for a live tick);
 *  - panning left toward the start of the loaded data asks the service for older candles.
 *
 * Paging needs all three: the change came from a real user gesture, it moved LEFT, and the left edge
 * is within the threshold. The library emits its own small range events while settling after a load
 * (one of them reads as a leftward move), and fit-to-data / prepend re-anchoring are programmatic, so
 * none of those may trigger a request.
 */
export function bindChartToService(chart: ChartSink, service: MarketDataService, options: BindOptions): Unsubscribe {
  let previousFrom: number | null = null;

  const stopEvents = service.subscribe((event) => {
    switch (event.type) {
      case 'reset':
        previousFrom = null;
        chart.setCandles(event.candles);
        break;
      case 'append':
      case 'update':
        chart.updateCandle(event.candle);
        break;
      case 'prepend':
        chart.prependCandles(event.candles, event.added);
        break;
    }
  });

  const stopViewport = chart.viewport.subscribe((range, change) => {
    if (range === null) return;
    const movedLeft = previousFrom !== null && range.from < previousFrom;
    previousFrom = range.from;
    if (change.userDriven && movedLeft && range.from < options.loadOlderWithinBars) void service.loadOlder();
  });

  return () => {
    stopViewport();
    stopEvents();
  };
}
