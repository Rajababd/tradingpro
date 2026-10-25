import { describe, expect, it, vi } from 'vitest';
import { CrosshairController, type CrosshairSnapshot } from '../src/chart/CrosshairController';
import { FakeChart } from './helpers/fakeChart';

const PRICE = { id: 'price-series' } as never;
const bar = { time: 1704931200, open: 100, high: 105, low: 99, close: 102 };

function setup() {
  const chart = new FakeChart();
  const controller = new CrosshairController(chart.asPort(), () => PRICE);
  const received: CrosshairSnapshot[] = [];
  return { chart, controller, received, listen: () => controller.subscribe((s) => received.push(s)) };
}

describe('CrosshairController', () => {
  it('does not subscribe to the chart until someone listens, and detaches after the last unsubscribe', () => {
    const { chart, listen } = setup();
    expect(chart.subscribeCrosshairMove).not.toHaveBeenCalled();
    const stop = listen();
    expect(chart.subscribeCrosshairMove).toHaveBeenCalledTimes(1);
    stop();
    expect(chart.unsubscribeCrosshairMove).toHaveBeenCalledTimes(1);
    // the same handler instance is removed that was added
    expect(chart.crosshairHandlers.size).toBe(0);
  });

  it('maps an OHLC bar under the crosshair to a snapshot', () => {
    const { chart, received, listen } = setup();
    listen();
    chart.emitCrosshair({ time: 1704931200, logical: 10, paneIndex: 1, seriesData: new Map([[PRICE, bar]]) });
    expect(received).toEqual([
      { time: 1704931200, logical: 10, paneIndex: 1, candle: { open: 100, high: 105, low: 99, close: 102 } },
    ]);
  });

  it('reports a null candle when the price series has no bar (or only line data)', () => {
    const { chart, received, listen } = setup();
    listen();
    chart.emitCrosshair({ time: 5, logical: 1, seriesData: new Map() });
    chart.emitCrosshair({ time: 5, logical: 1, seriesData: new Map([[PRICE, { time: 5, value: 3 }]]) });
    expect(received.map((s) => s.candle)).toEqual([null, null]);
    expect(received[0]?.time).toBe(5);
    expect(received[0]?.paneIndex).toBeNull();
  });

  it('rejects a bar with non-finite or missing values instead of showing garbage', () => {
    const { chart, received, listen } = setup();
    listen();
    chart.emitCrosshair({ time: 5, logical: 1, seriesData: new Map([[PRICE, { ...bar, high: Number.NaN }]]) });
    chart.emitCrosshair({ time: 5, logical: 1, seriesData: new Map([[PRICE, { open: 1, high: 2, low: 0 }]]) });
    expect(received.map((s) => s.candle)).toEqual([null, null]);
  });

  it('returns the empty snapshot when the pointer leaves the data area', () => {
    const { chart, received, listen } = setup();
    listen();
    chart.emitCrosshair({ seriesData: new Map() });
    expect(received).toEqual([{ time: null, logical: null, paneIndex: null, candle: null }]);
  });

  it('ignores non-numeric (string / business-day) times', () => {
    const { chart, received, listen } = setup();
    listen();
    chart.emitCrosshair({ time: '2024-01-01', logical: 1, seriesData: new Map() });
    expect(received[0]?.time).toBeNull();
  });

  it('dispose detaches from the chart and silences listeners', () => {
    const { chart, controller, received, listen } = setup();
    listen();
    controller.dispose();
    expect(chart.unsubscribeCrosshairMove).toHaveBeenCalledTimes(1);
    chart.emitCrosshair({ time: 5, logical: 1, seriesData: new Map() });
    expect(received).toEqual([]);
  });

  it('survives a missing price series', () => {
    const chart = new FakeChart();
    const controller = new CrosshairController(chart.asPort(), () => undefined);
    const fn = vi.fn();
    controller.subscribe(fn);
    chart.emitCrosshair({ time: 5, logical: 1, seriesData: new Map([[PRICE, bar]]) });
    expect(fn.mock.calls[0]?.[0].candle).toBeNull();
  });
});
