import { beforeEach, describe, expect, it } from 'vitest';
import { PRICE_PANE_ID, PaneManager } from '../src/chart/PaneManager';
import { PRICE_SERIES_ID, SeriesManager } from '../src/chart/SeriesManager';
import { FakeChart, def, type FakeSeries } from './helpers/fakeChart';

let chart: FakeChart;
let panes: PaneManager;
let series: SeriesManager;

const addPrice = () =>
  series.add({ id: PRICE_SERIES_ID, definition: def('Candlestick'), paneId: PRICE_PANE_ID });
const line = (id: string, paneId: string, options?: object) =>
  series.add({ id, definition: def('Line'), paneId, ...(options ? { options: options as never } : {}) }) as unknown as FakeSeries;

beforeEach(() => {
  chart = new FakeChart();
  panes = new PaneManager();
  series = new SeriesManager(chart.asPort(), panes, new Set([PRICE_SERIES_ID]));
});

describe('SeriesManager: creation', () => {
  it('creates the price series in pane 0 and lists it', () => {
    addPrice();
    expect(chart.addSeries).toHaveBeenCalledTimes(1);
    expect(chart.addSeries.mock.calls[0]?.[2]).toBe(0);
    expect(series.list()).toEqual([{ id: 'price', paneId: 'price', type: 'Candlestick', visible: true }]);
  });

  it('refuses a duplicate id without touching the chart', () => {
    addPrice();
    expect(() => addPrice()).toThrow(/already exists/);
    expect(chart.addSeries).toHaveBeenCalledTimes(1);
    expect(chart.panes).toHaveLength(1);
  });

  it('places a series in an existing pane without creating another pane (shared pane)', () => {
    addPrice();
    line('rsi', 'rsi');
    line('rsi-sma', 'rsi');
    expect(chart.panes.map((p) => p.length)).toEqual([1, 2]);
  });

  it('honours logical pane order even when panes are created out of order', () => {
    ['volume', 'rsi', 'macd'].forEach((id) => panes.register(id));
    const price = addPrice() as unknown as FakeSeries;
    const macd = line('macd', 'macd');
    const rsi = line('rsi', 'rsi');
    const volume = line('volume', 'volume');

    expect([price, volume, rsi, macd].map((s) => chart.paneIndexOf(s))).toEqual([0, 1, 2, 3]);
    expect(['price', 'volume', 'rsi', 'macd'].map((id) => panes.indexFor(id))).toEqual([0, 1, 2, 3]);
  });

  it('records the initial visibility from options', () => {
    addPrice();
    line('hidden', 'rsi', { visible: false });
    expect(series.isVisible('hidden')).toBe(false);
  });

  it('records nothing when the chart rejects the series, and can retry', () => {
    addPrice();
    chart.failNextAddSeries = true;
    expect(() => line('rsi', 'rsi')).toThrow('addSeries failed');
    expect(series.has('rsi')).toBe(false);
    expect(panes.isMaterialized('rsi')).toBe(false);
    expect(() => line('rsi', 'rsi')).not.toThrow();
    expect(chart.panes).toHaveLength(2);
  });

  it('rolls the series back if moving its pane into place fails', () => {
    panes.register('rsi');
    panes.register('macd');
    addPrice();
    line('macd', 'macd');
    chart.failNextSwap = true;
    expect(() => line('rsi', 'rsi')).toThrow('swapPanes failed');
    expect(series.has('rsi')).toBe(false);
    expect(panes.isMaterialized('rsi')).toBe(false);
    expect(chart.panes).toHaveLength(2); // price + macd; the half-placed pane is gone
  });
});

describe('SeriesManager: hide and show (Scenario A)', () => {
  it('hiding keeps the series, its pane and its registration', () => {
    addPrice();
    const rsi = line('rsi', 'rsi');
    series.setVisible('rsi', false);

    expect(rsi.options['visible']).toBe(false);
    expect(series.isVisible('rsi')).toBe(false);
    expect(series.has('rsi')).toBe(true);
    expect(chart.panes).toHaveLength(2);
    expect(chart.removeSeries).not.toHaveBeenCalled();
  });

  it('repeated hide/show never duplicates series or panes', () => {
    addPrice();
    line('rsi', 'rsi');
    for (let i = 0; i < 50; i++) {
      series.setVisible('rsi', false);
      series.setVisible('rsi', true);
    }
    expect(series.list().filter((s) => s.id === 'rsi')).toHaveLength(1);
    expect(chart.addSeries).toHaveBeenCalledTimes(2); // price + rsi, once each
    expect(chart.panes.map((p) => p.length)).toEqual([1, 1]);
    expect(series.isVisible('rsi')).toBe(true);
  });

  it('throws for an unknown series', () => {
    expect(() => series.setVisible('nope', false)).toThrow(/unknown series/i);
  });
});

describe('SeriesManager: shared pane (Scenario B)', () => {
  it('the pane survives while any series remains, and goes with the last one', () => {
    addPrice();
    line('rsi', 'rsi');
    line('rsi-sma', 'rsi');

    series.setVisible('rsi', false);
    expect(chart.panes).toHaveLength(2);
    expect(series.isVisible('rsi-sma')).toBe(true);

    series.remove('rsi');
    expect(chart.panes).toHaveLength(2);
    expect(panes.isMaterialized('rsi')).toBe(true);

    series.remove('rsi-sma');
    expect(chart.panes).toHaveLength(1);
    expect(panes.isMaterialized('rsi')).toBe(false);
  });
});

describe('SeriesManager: removal', () => {
  it('protects the price series', () => {
    addPrice();
    expect(() => series.remove(PRICE_SERIES_ID)).toThrow(/protected/);
    expect(series.has(PRICE_SERIES_ID)).toBe(true);
    expect(chart.removeSeries).not.toHaveBeenCalled();
  });

  it('throws for unknown ids and for removing twice', () => {
    addPrice();
    line('rsi', 'rsi');
    series.remove('rsi');
    expect(() => series.remove('rsi')).toThrow(/unknown series/i);
  });

  it('a removed pane returns to its previous logical slot when re-added', () => {
    ['volume', 'rsi', 'macd'].forEach((id) => panes.register(id));
    addPrice();
    line('volume', 'volume');
    line('rsi', 'rsi');
    const macd = line('macd', 'macd');
    expect(chart.paneIndexOf(macd)).toBe(3);

    series.remove('rsi');
    expect(chart.paneIndexOf(macd)).toBe(2);

    const rsiAgain = line('rsi', 'rsi');
    expect(chart.paneIndexOf(rsiAgain)).toBe(2);
    expect(chart.paneIndexOf(macd)).toBe(3);
  });

  it('dispose forgets references but never touches the chart', () => {
    addPrice();
    series.dispose();
    expect(series.list()).toEqual([]);
    expect(chart.removeSeries).not.toHaveBeenCalled();
  });

  it('require throws for a missing series and get returns undefined', () => {
    expect(series.get('x')).toBeUndefined();
    expect(() => series.require('x')).toThrow(/unknown series/i);
  });
});
