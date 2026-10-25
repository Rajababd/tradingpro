// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChartController as ChartControllerType } from '../src/chart/ChartController';
import { FakeChart, def } from './helpers/fakeChart';

const h = vi.hoisted(() => ({ chart: null as unknown }));

vi.mock('lightweight-charts', () => ({
  createChart: vi.fn(() => h.chart),
  CandlestickSeries: { type: 'Candlestick' },
  ColorType: { Solid: 'solid' },
}));

import { ChartController } from '../src/chart/ChartController';
import { theme } from '../src/app/theme';

let fake: FakeChart;
let controller: ChartControllerType;
let container: HTMLElement;

beforeEach(() => {
  fake = new FakeChart();
  h.chart = fake;
  controller = new ChartController(theme);
  container = document.createElement('div');
});

describe('ChartController managers', () => {
  it('exposes managers only while mounted', () => {
    expect(() => controller.series).toThrow(/not mounted/);
    expect(() => controller.crosshair).toThrow(/not mounted/);
    controller.mount(container);
    expect(controller.series.list()).toEqual([{ id: 'price', paneId: 'price', type: 'Candlestick', visible: true }]);
    expect(controller.panes.order).toEqual(['price']);
    controller.dispose();
    expect(() => controller.series).toThrow(/not mounted/);
    expect(() => controller.viewport).toThrow(/not mounted/);
  });

  it('creates exactly one price series at mount and protects it from removal', () => {
    controller.mount(container);
    expect(fake.addSeries).toHaveBeenCalledTimes(1);
    expect(() => controller.visibility.removeSeries('price')).toThrow(/protected/);
  });

  it('indicator series share the one chart: no second chart, no duplicate price series', () => {
    controller.mount(container);
    controller.mount(container); // idempotent
    controller.visibility.addSeries({ id: 'rsi', definition: def('Line'), paneId: 'rsi' });
    expect(fake.panes).toHaveLength(2);
    expect(fake.addSeries).toHaveBeenCalledTimes(2);
  });

  it('dispose detaches crosshair and viewport subscriptions before removing the chart', () => {
    controller.mount(container);
    controller.crosshair.subscribe(() => {});
    controller.viewport.subscribe(() => {});
    expect(fake.crosshairHandlers.size).toBe(1);
    expect(fake.rangeHandlers.size).toBe(1);

    const order: string[] = [];
    fake.unsubscribeCrosshairMove.mockImplementation(() => void order.push('unsubscribe-crosshair'));
    fake.remove.mockImplementation(() => void order.push('remove'));
    controller.dispose();

    expect(order).toEqual(['unsubscribe-crosshair', 'remove']);
    expect(fake.rangeHandlers.size).toBe(0);
  });

  it('removes the half-built chart and stays unmounted if setup fails', () => {
    fake.failNextAddSeries = true;
    expect(() => controller.mount(container)).toThrow('addSeries failed');
    expect(fake.remove).toHaveBeenCalledTimes(1);
    expect(controller.isMounted).toBe(false);
  });

  it('setCandles feeds the price series and fits the view', () => {
    controller.mount(container);
    const setData = vi.fn();
    const price = controller.series.require<'Candlestick'>('price');
    (price as unknown as { setData: typeof setData }).setData = setData;
    controller.setCandles([{ time: 1704067200 as never, open: 1, high: 2, low: 0.5, close: 1.5, volume: null }]);
    expect(setData).toHaveBeenCalledTimes(1);
    expect(fake.fitContent).toHaveBeenCalledTimes(1);
  });

  describe('incremental updates', () => {
    const candle = (day: number, close = 1.5) =>
      ({ time: (1704067200 + day * 86400) as never, open: 1, high: 2, low: 0.5, close, volume: null }) as const;

    function priceSeries() {
      controller.mount(container);
      const api = controller.series.require<'Candlestick'>('price') as unknown as { update: ReturnType<typeof vi.fn>; setData: ReturnType<typeof vi.fn> };
      api.update = vi.fn();
      api.setData = vi.fn();
      return api;
    }

    it('updateCandle sends one candle to the price series and never touches the viewport', () => {
      const api = priceSeries();
      controller.updateCandle(candle(3, 1.7));
      expect(api.update).toHaveBeenCalledTimes(1);
      expect(api.update).toHaveBeenCalledWith({ time: 1704067200 + 3 * 86400, open: 1, high: 2, low: 0.5, close: 1.7 });
      expect(api.setData).not.toHaveBeenCalled();
      expect(fake.fitContent).not.toHaveBeenCalled();
      expect(fake.timeScaleMock.setVisibleLogicalRange).not.toHaveBeenCalled();
    });

    it('prependCandles replaces the data and shifts the visible range by the number added', () => {
      const api = priceSeries();
      fake.visibleRange = { from: 10.5, to: 60.25 };
      controller.prependCandles([candle(0), candle(1), candle(2)], 2);
      expect(api.setData).toHaveBeenCalledTimes(1);
      expect(api.setData.mock.calls[0]![0]).toHaveLength(3);
      expect(fake.timeScaleMock.setVisibleLogicalRange).toHaveBeenCalledWith({ from: 12.5, to: 62.25 });
      expect(fake.fitContent).not.toHaveBeenCalled();
    });

    it('prependCandles leaves the view alone when nothing was added or there is no range yet', () => {
      priceSeries();
      fake.visibleRange = { from: 1, to: 5 };
      controller.prependCandles([candle(0)], 0);
      fake.visibleRange = null;
      controller.prependCandles([candle(0), candle(1)], 1);
      expect(fake.timeScaleMock.setVisibleLogicalRange).not.toHaveBeenCalled();
    });

    it('both throw when not mounted', () => {
      expect(() => controller.updateCandle(candle(0))).toThrow(/not mounted/);
      expect(() => controller.prependCandles([candle(0)], 1)).toThrow(/not mounted/);
    });
  });
});
