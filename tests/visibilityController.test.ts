import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PRICE_PANE_ID, PaneManager } from '../src/chart/PaneManager';
import { PRICE_SERIES_ID, SeriesManager } from '../src/chart/SeriesManager';
import { VisibilityController } from '../src/chart/VisibilityController';
import { VisibilityModel } from '../src/chart/VisibilityModel';
import { FakeChart, def, type FakeSeries } from './helpers/fakeChart';

let chart: FakeChart;
let panes: PaneManager;
let series: SeriesManager;
let vc: VisibilityController;

const add = (id: string, paneId: string, visible?: boolean) =>
  vc.addSeries({ id, definition: def('Line'), paneId, ...(visible === undefined ? {} : { visible }) }) as unknown as FakeSeries;
const stretchOf = (s: FakeSeries) => s.getPane().getStretchFactor();
const indexOf = (s: FakeSeries) => chart.paneIndexOf(s);

beforeEach(() => {
  chart = new FakeChart();
  panes = new PaneManager();
  series = new SeriesManager(chart.asPort(), panes, new Set([PRICE_SERIES_ID]));
  vc = new VisibilityController(series, panes, new VisibilityModel(panes, new Set([PRICE_SERIES_ID])));
  vc.addSeries({ id: PRICE_SERIES_ID, definition: def('Candlestick'), paneId: PRICE_PANE_ID });
});

describe('VisibilityController: hiding a series versus hiding a pane', () => {
  it('hiding one series of a shared pane only changes that series: the pane is not touched', () => {
    const macd = add('macd', 'macd');
    add('signal', 'macd');
    chart.stretchCalls.length = 0;

    vc.setSeriesVisible('macd', false);
    expect(macd.options['visible']).toBe(false);
    expect(chart.stretchCalls).toEqual([]); // no resize
    expect(stretchOf(macd)).toBe(1);
    expect(vc.isPaneVisible('macd')).toBe(true);
  });

  it('hiding the last visible series collapses the pane (stretch 0) without removing anything', () => {
    const rsi = add('rsi', 'rsi');
    vc.setSeriesVisible('rsi', false);
    expect(stretchOf(rsi)).toBe(0);
    expect(chart.removeSeries).not.toHaveBeenCalled();
    expect(chart.panes).toHaveLength(2); // the pane and its series still exist
    expect(vc.isPaneVisible('rsi')).toBe(false);
  });

  it('showing a series again restores exactly the size the pane had', () => {
    const rsi = add('rsi', 'rsi');
    vc.setSeriesVisible('rsi', false);
    vc.setSeriesVisible('rsi', true);
    expect(stretchOf(rsi)).toBe(1);
    expect(rsi.options['visible']).toBe(true);
  });

  it('a pane the user resized comes back at THEIR size, not a default (and others are untouched)', () => {
    const volume = add('volume', 'volume');
    const rsi = add('rsi', 'rsi');
    rsi.getPane().setStretchFactor(3.5); // what dragging a separator does
    chart.stretchCalls.length = 0;

    vc.setSeriesVisible('rsi', false);
    expect(stretchOf(rsi)).toBe(0);
    vc.setSeriesVisible('rsi', true);
    expect(stretchOf(rsi)).toBe(3.5);
    expect(chart.stretchCalls.every(([, v], i) => (i === 0 ? v === 0 : v === 3.5))).toBe(true);
    expect(stretchOf(volume)).toBe(1);
    expect(chart.stretchCalls.map(([index]) => index)).toEqual([2, 2]); // only the rsi pane was ever resized
  });

  it('setHeight-style resizing is never used: only stretch factors are touched', () => {
    const rsi = add('rsi', 'rsi');
    const pane = rsi.getPane() as unknown as Record<string, unknown>;
    expect(pane['setHeight']).toBeUndefined(); // the fake does not even offer it
    vc.setSeriesVisible('rsi', false);
    vc.setSeriesVisible('rsi', true);
    expect(chart.stretchCalls.length).toBe(2);
  });
});

describe('Scenario A: repeated hide/show', () => {
  it('50 cycles leave no duplicate series, no layout drift and the original configuration', () => {
    const volume = add('volume', 'volume');
    const rsi = add('rsi', 'rsi');
    const before = { v: stretchOf(volume), r: stretchOf(rsi), order: [indexOf(volume), indexOf(rsi)] };
    const created = chart.addSeries.mock.calls.length;

    for (let i = 0; i < 50; i++) {
      vc.setSeriesVisible('rsi', false);
      vc.setSeriesVisible('rsi', true);
    }
    expect(chart.addSeries.mock.calls.length).toBe(created); // nothing re-created
    expect(chart.removeSeries).not.toHaveBeenCalled();
    expect(series.list().filter((s) => s.id === 'rsi')).toHaveLength(1);
    expect({ v: stretchOf(volume), r: stretchOf(rsi), order: [indexOf(volume), indexOf(rsi)] }).toEqual(before);
    expect(rsi.options['visible']).toBe(true);
  });

  it('hiding an already hidden series, or showing a visible one, does nothing at all', () => {
    const rsi = add('rsi', 'rsi');
    chart.stretchCalls.length = 0;
    rsi.applyOptions.mockClear();
    vc.setSeriesVisible('rsi', true);
    expect(rsi.applyOptions).not.toHaveBeenCalled();
    vc.setSeriesVisible('rsi', false);
    rsi.applyOptions.mockClear();
    chart.stretchCalls.length = 0;
    vc.setSeriesVisible('rsi', false);
    expect(rsi.applyOptions).not.toHaveBeenCalled();
    expect(chart.stretchCalls).toEqual([]);
  });
});

describe('Scenario B: shared pane', () => {
  it('a pane with three series stays full size until the LAST one is hidden, and comes back at its exact size', () => {
    const macd = add('macd', 'macd');
    const signal = add('signal', 'macd');
    const hist = add('hist', 'macd');
    macd.getPane().setStretchFactor(2.25);

    vc.setSeriesVisible('macd', false);
    vc.setSeriesVisible('signal', false);
    expect(stretchOf(hist)).toBe(2.25);
    expect(vc.isPaneVisible('macd')).toBe(true);

    vc.setSeriesVisible('hist', false);
    expect(stretchOf(hist)).toBe(0);

    vc.setSeriesVisible('signal', true); // any one series brings the pane back
    expect(stretchOf(signal)).toBe(2.25);
    expect(signal.options['visible']).toBe(true);
    expect(macd.options['visible']).toBe(false); // the others stay hidden: independent
    expect(hist.options['visible']).toBe(false);
  });

  it('an SMA in the pane keeps it open when its source is hidden (SMA visibility is independent)', () => {
    const rsi = add('rsi', 'rsi');
    add('sma-rsi-10', 'rsi');
    vc.setSeriesVisible('rsi', false);
    expect(stretchOf(rsi)).toBe(1);
    expect(vc.isPaneVisible('rsi')).toBe(true);
    vc.setSeriesVisible('sma-rsi-10', false);
    expect(stretchOf(rsi)).toBe(0);
    vc.setSeriesVisible('rsi', true); // showing the source does not resurrect the SMA
    expect(vc.isSeriesVisible('sma-rsi-10')).toBe(false);
  });
});

describe('pane order and the price pane', () => {
  it('hiding and showing panes in any order never reorders them', () => {
    ['volume', 'rsi', 'macd'].forEach((p) => panes.register(p));
    const macd = add('macd-line', 'macd');
    const rsi = add('rsi-line', 'rsi');
    const volume = add('vol', 'volume');
    const order = () => [indexOf(volume), indexOf(rsi), indexOf(macd)];
    expect(order()).toEqual([1, 2, 3]);

    for (const id of ['rsi-line', 'vol', 'macd-line']) vc.setSeriesVisible(id, false);
    expect(order()).toEqual([1, 2, 3]);
    for (const id of ['macd-line', 'rsi-line', 'vol']) vc.setSeriesVisible(id, true);
    expect(order()).toEqual([1, 2, 3]);
    expect(vc.visiblePaneOrder()).toEqual(['price', 'volume', 'rsi', 'macd']);
  });

  it('with every indicator hidden only the price pane is visible and every other pane is collapsed', () => {
    const volume = add('vol', 'volume');
    const rsi = add('rsi', 'rsi');
    vc.setSeriesVisible('vol', false);
    vc.setSeriesVisible('rsi', false);
    expect(vc.visiblePaneOrder()).toEqual([PRICE_PANE_ID]);
    expect([stretchOf(volume), stretchOf(rsi)]).toEqual([0, 0]);
    expect(stretchOf(series.require(PRICE_SERIES_ID) as never)).toBe(2); // the price pane keeps its size and gets the space
  });

  it('the price series and pane cannot be hidden or removed, and a refusal changes nothing', () => {
    const before = vc.getSnapshot();
    expect(() => vc.setSeriesVisible(PRICE_SERIES_ID, false)).toThrow(/permanent/);
    expect(() => vc.removeSeries(PRICE_SERIES_ID)).toThrow(/protected/);
    expect(() => vc.addSeries({ id: 'price2', definition: def('Line'), paneId: PRICE_PANE_ID, visible: true })).not.toThrow();
    expect(vc.isSeriesVisible(PRICE_SERIES_ID)).toBe(true);
    expect(before.panes[0]!.visible).toBe(true);
    expect(chart.removeSeries).not.toHaveBeenCalled();
  });
});

describe('creating hidden, removing, and re-adding', () => {
  it('a series created hidden is hidden from the start, and its new pane starts collapsed', () => {
    const rsi = add('rsi', 'rsi', false);
    expect(rsi.options['visible']).toBe(false);
    expect(stretchOf(rsi)).toBe(0);
    expect(vc.isPaneVisible('rsi')).toBe(false);
    vc.setSeriesVisible('rsi', true);
    expect(stretchOf(rsi)).toBe(1); // restored to the size it had before it was collapsed
  });

  it('a hidden series can join a visible pane without disturbing it', () => {
    const a = add('a', 'p');
    chart.stretchCalls.length = 0;
    const b = add('b', 'p', false);
    expect(b.options['visible']).toBe(false);
    expect(stretchOf(a)).toBe(1);
    expect(chart.stretchCalls).toEqual([]);
  });

  it('removing the last series deletes the pane; re-adding puts it back in its slot at its remembered size', () => {
    ['volume', 'rsi', 'macd'].forEach((p) => panes.register(p));
    add('vol', 'volume');
    const rsi = add('rsi-line', 'rsi');
    const macd = add('macd-line', 'macd');
    rsi.getPane().setStretchFactor(4);

    vc.removeSeries('rsi-line');
    expect(chart.panes).toHaveLength(3);
    expect(vc.isPaneVisible('rsi')).toBe(false);
    expect(panes.order).toEqual(['price', 'volume', 'rsi', 'macd']); // slot kept

    const again = add('rsi-line', 'rsi');
    expect(indexOf(again)).toBe(2);
    expect(indexOf(macd)).toBe(3);
    expect(stretchOf(again)).toBe(4); // the size the user had before it was removed
  });

  it('removing the last series of a COLLAPSED pane does not leave it stuck at size 0 when it returns', () => {
    const rsi = add('rsi', 'rsi');
    rsi.getPane().setStretchFactor(3);
    vc.setSeriesVisible('rsi', false);
    vc.removeSeries('rsi');

    const again = add('rsi', 'rsi');
    expect(stretchOf(again)).toBe(3);
    expect(vc.isPaneVisible('rsi')).toBe(true);
  });

  it('removing one of two series leaves the pane and its size alone', () => {
    add('a', 'p');
    const b = add('b', 'p');
    chart.stretchCalls.length = 0;
    vc.removeSeries('a');
    expect(chart.stretchCalls).toEqual([]);
    expect(stretchOf(b)).toBe(1);
    expect(vc.isPaneVisible('p')).toBe(true);
  });

  it('removing the last visible series while a hidden one remains collapses the pane', () => {
    const a = add('a', 'p');
    add('b', 'p', false);
    vc.removeSeries('a');
    const b = series.require('b') as unknown as FakeSeries;
    expect(stretchOf(b)).toBe(0);
    expect(vc.isPaneVisible('p')).toBe(false);
  });
});

describe('failures leave state and chart in agreement', () => {
  it('if the chart refuses a visibility change, the state is rolled back and the error surfaces', () => {
    const rsi = add('rsi', 'rsi');
    rsi.applyOptions.mockImplementationOnce(() => {
      throw new Error('chart said no');
    });
    chart.stretchCalls.length = 0;
    expect(() => vc.setSeriesVisible('rsi', false)).toThrow('chart said no');
    expect(vc.isSeriesVisible('rsi')).toBe(true);
    expect(vc.isPaneVisible('rsi')).toBe(true);
    expect(chart.stretchCalls).toEqual([]);
  });

  it('if the chart refuses a new series, nothing is registered and the pane is not touched', () => {
    chart.failNextAddSeries = true;
    expect(() => add('rsi', 'rsi')).toThrow('addSeries failed');
    expect(vc.hasSeries('rsi')).toBe(false);
    expect(vc.isPaneVisible('rsi')).toBe(false);
    expect(() => add('rsi', 'rsi')).not.toThrow();
  });

  it('duplicate ids, unknown ids and bad calls are refused', () => {
    add('rsi', 'rsi');
    expect(() => add('rsi', 'rsi')).toThrow(/already exists/);
    expect(() => vc.setSeriesVisible('ghost', true)).toThrow(/Unknown series/);
    expect(() => vc.removeSeries('ghost')).toThrow(/Unknown series/);
    expect(() => vc.isSeriesVisible('ghost')).toThrow(/Unknown series/);
  });
});

describe('snapshots and notifications', () => {
  it('publishes one stable snapshot per real change, and nothing for no-ops', () => {
    const seen: unknown[] = [];
    vc.subscribe((s) => seen.push(s));
    const s0 = vc.getSnapshot();
    expect(vc.getSnapshot()).toBe(s0); // referentially stable

    add('rsi', 'rsi');
    vc.setSeriesVisible('rsi', false);
    vc.setSeriesVisible('rsi', false); // no-op
    vc.setSeriesVisible('rsi', true);
    expect(seen).toHaveLength(3);
    expect(vc.getSnapshot()).not.toBe(s0);
    expect(vc.getSnapshot().panes.find((p) => p.paneId === 'rsi')).toEqual({ paneId: 'rsi', visible: true, seriesIds: ['rsi'] });
  });

  it('toggleSeries flips and reports the new state; unsubscribe and dispose stop notifications', () => {
    add('rsi', 'rsi');
    const seen: unknown[] = [];
    const stop = vc.subscribe((s) => seen.push(s));
    expect(vc.toggleSeries('rsi')).toBe(false);
    expect(vc.toggleSeries('rsi')).toBe(true);
    stop();
    vc.toggleSeries('rsi');
    expect(seen).toHaveLength(2);
    vc.subscribe((s) => seen.push(s));
    vc.dispose();
    vc.toggleSeries('rsi');
    expect(seen).toHaveLength(2);
  });

  it('the snapshot is accurate to the chart after a random sequence of operations (property test)', () => {
    const spy = vi.spyOn(Math, 'random');
    let seed = 7;
    spy.mockImplementation(() => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296));
    ['volume', 'rsi', 'macd'].forEach((p) => panes.register(p));
    const ids = ['v1', 'r1', 'r2', 'm1', 'm2', 'm3'];
    const paneOf: Record<string, string> = { v1: 'volume', r1: 'rsi', r2: 'rsi', m1: 'macd', m2: 'macd', m3: 'macd' };
    for (const id of ids) add(id, paneOf[id]!);

    for (let step = 0; step < 600; step++) {
      const id = ids[Math.floor(Math.random() * ids.length)]!;
      vc.setSeriesVisible(id, Math.random() < 0.5);
      for (const pane of vc.getSnapshot().panes) {
        if (pane.paneId === 'price') continue;
        const members = pane.seriesIds.map((sid) => series.require(sid) as unknown as FakeSeries);
        const anyVisible = members.some((m) => m.options['visible'] !== false);
        const stretch = members[0]!.getPane().getStretchFactor();
        expect(pane.visible, `step ${step} ${pane.paneId}`).toBe(anyVisible);
        expect(stretch === 0, `step ${step} ${pane.paneId} collapsed iff hidden`).toBe(!anyVisible);
      }
      // pane order never changes, whatever is hidden: one representative series per pane
      expect(['v1', 'r1', 'm1'].map((sid) => indexOf(series.require(sid) as never))).toEqual([1, 2, 3]);
    }
    spy.mockRestore();
    // after all that, every pane that ended visible is back at its original size
    for (const id of ids) vc.setSeriesVisible(id, true);
    for (const id of ['v1', 'r1', 'm1']) expect(stretchOf(series.require(id) as never)).toBe(1);
  });
});
