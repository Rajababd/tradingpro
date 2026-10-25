// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Candle, UnixSeconds } from '../src/types/marketData';
import { theme } from '../src/app/theme';

// These tests verify ChartController's own lifecycle logic against a mocked chart library.
// They do NOT prove rendering; that is verified separately in a real browser.
const mocks = vi.hoisted(() => {
  const series = { setData: vi.fn() };
  const timeScale = { fitContent: vi.fn() };
  const chart = {
    addSeries: vi.fn((..._args: unknown[]) => series),
    timeScale: vi.fn(() => timeScale),
    remove: vi.fn(),
  };
  return { series, timeScale, chart, createChart: vi.fn(() => chart) };
});

vi.mock('lightweight-charts', () => ({
  createChart: mocks.createChart,
  CandlestickSeries: { type: 'Candlestick' },
  ColorType: { Solid: 'solid' },
}));

import { ChartController, PRICE_PANE_INDEX } from '../src/chart/ChartController';

const candle = (time: number, close = 11): Candle => ({
  time: time as UnixSeconds,
  open: 10,
  high: 12,
  low: 9,
  close,
  volume: 100,
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe('ChartController', () => {
  it('creates one chart and one candlestick series in the price pane on mount', () => {
    const c = new ChartController(theme);
    c.mount(document.createElement('div'));
    expect(mocks.createChart).toHaveBeenCalledTimes(1);
    expect(mocks.chart.addSeries).toHaveBeenCalledTimes(1);
    expect(mocks.chart.addSeries.mock.calls[0]?.[2]).toBe(PRICE_PANE_INDEX);
    expect(c.isMounted).toBe(true);
  });

  it('enables library auto-sizing for responsive resizing', () => {
    new ChartController(theme).mount(document.createElement('div'));
    const options = (mocks.createChart.mock.calls[0] as unknown[])[1] as { autoSize: boolean };
    expect(options.autoSize).toBe(true);
  });

  it('mounting the same container twice does not create a second chart', () => {
    const c = new ChartController(theme);
    const el = document.createElement('div');
    c.mount(el);
    c.mount(el);
    expect(mocks.createChart).toHaveBeenCalledTimes(1);
    expect(mocks.chart.addSeries).toHaveBeenCalledTimes(1);
  });

  it('refuses to mount to a different container while mounted', () => {
    const c = new ChartController(theme);
    c.mount(document.createElement('div'));
    expect(() => c.mount(document.createElement('div'))).toThrow(/different container/);
    expect(mocks.createChart).toHaveBeenCalledTimes(1);
  });

  it('maps candles to chart data (time in seconds, OHLC only) and fits content', () => {
    const c = new ChartController(theme);
    c.mount(document.createElement('div'));
    c.setCandles([candle(100, 11), candle(200, 12)]);
    expect(mocks.series.setData).toHaveBeenCalledWith([
      { time: 100, open: 10, high: 12, low: 9, close: 11 },
      { time: 200, open: 10, high: 12, low: 9, close: 12 },
    ]);
    expect(mocks.timeScale.fitContent).toHaveBeenCalledTimes(1);
  });

  it('replaces data in place on repeated setCandles without creating series', () => {
    const c = new ChartController(theme);
    c.mount(document.createElement('div'));
    c.setCandles([candle(100)]);
    c.setCandles([candle(100), candle(200)]);
    expect(mocks.series.setData).toHaveBeenCalledTimes(2);
    expect(mocks.chart.addSeries).toHaveBeenCalledTimes(1);
  });

  it('throws if setCandles is called before mount', () => {
    expect(() => new ChartController(theme).setCandles([candle(1)])).toThrow(/not mounted/);
  });

  it('disposes the chart exactly once, even when dispose is called repeatedly', () => {
    const c = new ChartController(theme);
    c.mount(document.createElement('div'));
    c.dispose();
    c.dispose();
    expect(mocks.chart.remove).toHaveBeenCalledTimes(1);
    expect(c.isMounted).toBe(false);
  });

  it('cannot be re-mounted or fed data after dispose', () => {
    const c = new ChartController(theme);
    c.mount(document.createElement('div'));
    c.dispose();
    expect(() => c.mount(document.createElement('div'))).toThrow(/disposed/);
    expect(() => c.setCandles([candle(1)])).toThrow(/not mounted/);
  });

  it('dispose before mount is safe and does not touch the chart library', () => {
    const c = new ChartController(theme);
    c.dispose();
    expect(mocks.chart.remove).not.toHaveBeenCalled();
  });
});
