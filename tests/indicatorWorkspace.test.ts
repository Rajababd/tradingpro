import { beforeEach, describe, expect, it } from 'vitest';
import { PRICE_PANE_ID, PaneManager } from '../src/chart/PaneManager';
import { PRICE_SERIES_ID, SeriesManager } from '../src/chart/SeriesManager';
import { VisibilityController } from '../src/chart/VisibilityController';
import { VisibilityModel } from '../src/chart/VisibilityModel';
import { createCalculator } from '../src/indicators/calculator';
import { IndicatorConfigError, IndicatorEngine } from '../src/indicators/IndicatorEngine';
import { GAP_COLOR, IndicatorWorkspace } from '../src/indicators/IndicatorWorkspace';
import type { SeriesStyleProvider } from '../src/indicators/seriesStyles';
import { smaKernel } from '../src/indicators/sma';
import type { Value } from '../src/indicators/types';
import { FakeChart, def, type FakeSeries } from './helpers/fakeChart';
import { randomCandles } from './helpers/candles';
import type { Candle } from '../src/types/marketData';

const styles: SeriesStyleProvider = {
  forOutput: (definitionId, output) => ({
    definition: def(output.kind === 'histogram' ? 'Histogram' : 'Line') as never,
    options: { tag: `${definitionId}:${output.key}` },
    ...(definitionId === 'volume' ? { pointColor: (_v: number, c: Candle | undefined) => (c !== undefined && c.close < c.open ? 'down' : 'up') } : {}),
    ...(definitionId === 'macd' && output.key === 'histogram' ? { pointColor: (v: number) => (v >= 0 ? 'pos' : 'neg') } : {}),
  }),
  forSma: (key, ordinal) => ({ definition: def('Line') as never, options: { tag: `sma:${key}`, ordinal } }),
};

const smaOver = (values: readonly Value[], period: number): Value[] => {
  const calc = createCalculator(smaKernel(period));
  calc.reset(values);
  return [...calc.column('sma')];
};
/** What a series shows, as values: whitespace points (no `value`) become null. */
const shown = (s: FakeSeries): Value[] => s.data.map((p) => (typeof p['value'] === 'number' ? p['value'] : null));

let chart: FakeChart;
let panes: PaneManager;
let series: SeriesManager;
let vc: VisibilityController;
let engine: IndicatorEngine;
let ws: IndicatorWorkspace;
let candles: Candle[];

const seriesOf = (id: string) => series.require(id) as unknown as FakeSeries;
const addSeriesCalls = () => chart.addSeries.mock.calls.length;
const row = (id: string) => ws.getSnapshot().indicators.find((r) => r.definitionId === id)!;
const sma = (key: string) => ws.getSnapshot().smas.find((r) => r.key === key)!;

beforeEach(() => {
  chart = new FakeChart();
  panes = new PaneManager();
  series = new SeriesManager(chart.asPort(), panes, new Set([PRICE_SERIES_ID]));
  vc = new VisibilityController(series, panes, new VisibilityModel(panes, new Set([PRICE_SERIES_ID])));
  vc.addSeries({ id: PRICE_SERIES_ID, definition: def('Candlestick'), paneId: PRICE_PANE_ID });
  engine = new IndicatorEngine();
  candles = randomCandles(80, 3);
  engine.reset(candles);
  ws = new IndicatorWorkspace(engine, { visibility: vc, series }, styles);
});

describe('indicators: lazy creation and display', () => {
  it('nothing is calculated or created until something is shown', () => {
    expect(engine.list()).toEqual([]);
    expect(chart.panes).toHaveLength(1);
    expect(addSeriesCalls()).toBe(1); // just the price series
    expect(ws.getSnapshot().indicators.every((r) => !r.displayed)).toBe(true);
    expect(ws.getSnapshot().smas.every((r) => !r.enabled)).toBe(true);
  });

  it('showing RSI the first time creates its calculation and a series in its own pane, filled with the data', () => {
    ws.setIndicatorDisplayed('rsi', true);
    expect(engine.has('rsi')).toBe(true);
    const rsi = seriesOf('rsi:rsi');
    expect(chart.paneIndexOf(rsi)).toBe(1);
    expect(rsi.options['visible']).not.toBe(false);
    expect(rsi.data).toHaveLength(80);
    expect(shown(rsi)).toEqual([...engine.values('rsi', 'rsi')]);
    expect(shown(rsi).slice(0, 14).every((v) => v === null)).toBe(true); // warm-up is whitespace, not zeros
    expect(row('rsi').displayed).toBe(true);
  });

  it('hiding keeps the calculation and series; showing again reuses the very same series (Scenario A)', () => {
    ws.setIndicatorDisplayed('rsi', true);
    const original = seriesOf('rsi:rsi');
    const created = addSeriesCalls();

    ws.setIndicatorDisplayed('rsi', false);
    expect(row('rsi').displayed).toBe(false);
    expect(original.options['visible']).toBe(false);
    expect(engine.has('rsi')).toBe(true);
    expect(chart.stretch.get(chart.panes[1]!)).toBe(0); // its pane collapsed

    ws.setIndicatorDisplayed('rsi', true);
    expect(seriesOf('rsi:rsi')).toBe(original);
    expect(addSeriesCalls()).toBe(created);
    expect(chart.stretch.get(chart.panes[1]!)).toBe(1);
    expect(row('rsi').displayed).toBe(true);
  });

  it('50 hide/show cycles create nothing new and lose nothing', () => {
    ws.setIndicatorDisplayed('macd', true);
    ws.setIndicatorDisplayed('rsi', true);
    const before = { created: addSeriesCalls(), instances: engine.list().length, panes: chart.panes.length };
    for (let i = 0; i < 50; i++) {
      ws.setIndicatorDisplayed('rsi', false);
      ws.setIndicatorDisplayed('rsi', true);
      ws.toggleIndicator('macd');
      ws.toggleIndicator('macd');
    }
    expect({ created: addSeriesCalls(), instances: engine.list().length, panes: chart.panes.length }).toEqual(before);
    expect(row('rsi').displayed && row('macd').displayed).toBe(true);
    expect(shown(seriesOf('rsi:rsi'))).toEqual([...engine.values('rsi', 'rsi')]);
  });

  it('a hidden indicator keeps receiving live data, so showing it is instant and never stale', () => {
    ws.setIndicatorDisplayed('rsi', true);
    ws.setIndicatorDisplayed('rsi', false);
    const more = randomCandles(82, 3);
    engine.append(more[80]!);
    engine.update({ ...more[80]!, close: more[80]!.close + 1, high: more[80]!.high + 1 });
    engine.append(more[81]!);

    const rsi = seriesOf('rsi:rsi');
    expect(rsi.data).toHaveLength(82);
    expect(shown(rsi)).toEqual([...engine.values('rsi', 'rsi')]);
    ws.setIndicatorDisplayed('rsi', true);
    expect(shown(rsi)).toEqual([...engine.values('rsi', 'rsi')]);
  });

  it('a data reset or prepend rewrites every series from the engine', () => {
    ws.setIndicatorDisplayed('rsi', true);
    ws.setIndicatorDisplayed('obv', true);
    ws.setIndicatorDisplayed('obv', false);
    const fresh = randomCandles(120, 9);
    engine.prepend(fresh);
    expect(shown(seriesOf('rsi:rsi'))).toEqual([...engine.values('rsi', 'rsi')]);
    expect(shown(seriesOf('obv:obv'))).toEqual([...engine.values('obv', 'obv')]);
    expect(seriesOf('rsi:rsi').data).toHaveLength(120);
  });

  it('a missing volume is a gap in the OBV line: whitespace for the bars, and no bridge across them', () => {
    const gappy = randomCandles(40, 5).map((c, i) => (i >= 20 && i < 23 ? { ...c, volume: null } : c));
    engine.reset(gappy);
    ws.setIndicatorDisplayed('obv', true);
    const data = seriesOf('obv:obv').data;
    for (const i of [20, 21, 22]) {
      expect(data[i]!['value']).toBeUndefined(); // no value, never 0
      expect(data[i]!.time).toBe(gappy[i]!.time);
    }
    expect(typeof data[23]!['value']).toBe('number'); // a new segment starts after the gap
    // The library bridges missing points, so the segment leaving the last point before the gap is made invisible.
    expect(data[19]!['color']).toBe(GAP_COLOR);
    for (const i of [0, 5, 18, 23, 30, 39]) expect(data[i]!['color'], `index ${i}`).toBeUndefined();
  });

  it('leading warm-up nulls and a trailing null are not interior gaps: nothing is made transparent', () => {
    ws.setIndicatorDisplayed('rsi', true); // 14 leading nulls
    expect(seriesOf('rsi:rsi').data.some((p) => p['color'] === GAP_COLOR)).toBe(false);
    const trailing = randomCandles(40, 6).map((c, i) => (i === 39 ? { ...c, volume: null } : c));
    engine.reset(trailing);
    ws.setIndicatorDisplayed('obv', true);
    expect(seriesOf('obv:obv').data.some((p) => p['color'] === GAP_COLOR)).toBe(false);
  });

  it('a gap that opens on a live bar is plain whitespace; closing it rewrites the series so the bridge is hidden', () => {
    const base = randomCandles(60, 7);
    engine.reset(base.slice(0, 50));
    ws.setIndicatorDisplayed('obv', true);
    const obv = seriesOf('obv:obv');

    engine.append({ ...base[50]!, volume: null }); // volume goes missing on a new bar
    expect(obv.update).toHaveBeenLastCalledWith({ time: base[50]!.time });
    obv.setData.mockClear();
    obv.update.mockClear();

    engine.append({ ...base[51]!, volume: null }); // still missing: just another gap bar
    expect(obv.setData).not.toHaveBeenCalled();

    engine.append(base[52]!); // volume returns: the gap is now interior
    expect(obv.setData).toHaveBeenCalledTimes(1); // update() cannot recolour an older point, so the series is rewritten
    expect(obv.data[49]!['color']).toBe(GAP_COLOR);
    expect(obv.data[52]!['color']).toBeUndefined();
    expect(shown(obv)).toEqual([...engine.values('obv', 'obv')]);

    obv.setData.mockClear();
    engine.append(base[53]!); // an ordinary live bar after the gap is a cheap update again
    expect(obv.setData).not.toHaveBeenCalled();
    expect(obv.update).toHaveBeenCalled();
  });

  it('gaps in an SMA line (its window empties across a gap) are broken the same way', () => {
    const gappy = randomCandles(70, 8).map((c, i) => (i === 35 ? { ...c, volume: null } : c));
    engine.reset(gappy);
    ws.setSmaEnabled('obv:obv', true);
    const line = seriesOf('sma:obv:obv');
    const column = engine.values('sma-obv-obv', 'sma');
    const lastBeforeGap = column.findIndex((v, i) => v === null && i > 20 && column[i - 1] !== null) - 1;
    expect(line.data[lastBeforeGap]!['color']).toBe(GAP_COLOR);
  });

  it('histogram bars are coloured per bar: volume by candle direction, MACD histogram by sign', () => {
    ws.setIndicatorDisplayed('volume', true);
    seriesOf('volume:volume').data.forEach((p, i) => expect(p['color']).toBe(candles[i]!.close < candles[i]!.open ? 'down' : 'up'));
    ws.setIndicatorDisplayed('macd', true);
    for (const p of seriesOf('macd:histogram').data) if (p['value'] !== undefined) expect(p['color']).toBe((p['value'] as number) >= 0 ? 'pos' : 'neg');
  });

  it('refuses unknown indicators and outputs', () => {
    expect(() => ws.setIndicatorDisplayed('nope', true)).toThrow(/Unknown indicator/);
    expect(() => ws.setOutputVisible('macd', 'nope', true)).toThrow(/no output/);
    expect(() => ws.setSmaEnabled('nope', true)).toThrow(/Unknown SMA source/);
    expect(() => ws.setSmaPeriod('nope', 5)).toThrow(/Unknown SMA source/);
  });
});

describe('MACD: three outputs in one pane (Scenario B)', () => {
  it('shows three series in one shared pane, and each output can be toggled independently', () => {
    ws.setIndicatorDisplayed('macd', true);
    expect(chart.panes).toHaveLength(2);
    expect(chart.panes[1]).toHaveLength(3);

    ws.setOutputVisible('macd', 'signal', false);
    expect(row('macd').displayed).toBe(true);
    expect(row('macd').outputs.map((o) => o.visible)).toEqual([true, false, true]);
    expect(chart.stretch.get(chart.panes[1]!)).toBe(1); // pane untouched

    ws.setOutputVisible('macd', 'macd', false);
    ws.setOutputVisible('macd', 'histogram', false);
    expect(row('macd').displayed).toBe(false);
    expect(chart.stretch.get(chart.panes[1]!)).toBe(0);

    ws.setOutputVisible('macd', 'signal', true);
    expect(row('macd').displayed).toBe(true);
    expect(row('macd').outputs.map((o) => o.visible)).toEqual([false, true, false]);
    expect(chart.stretch.get(chart.panes[1]!)).toBe(1);
  });

  it('the main switch shows all outputs, whatever their individual state, and hides them all', () => {
    ws.setIndicatorDisplayed('macd', true);
    ws.setOutputVisible('macd', 'signal', false);
    ws.setIndicatorDisplayed('macd', true);
    expect(row('macd').outputs.every((o) => o.visible)).toBe(true);
    ws.setIndicatorDisplayed('macd', false);
    expect(row('macd').outputs.every((o) => !o.visible)).toBe(true);
  });

  it('showing a single output of a never-shown indicator creates only that series', () => {
    ws.setOutputVisible('macd', 'signal', true);
    expect(vc.hasSeries('macd:signal')).toBe(true);
    expect(vc.hasSeries('macd:macd')).toBe(false);
    expect(row('macd').outputs.map((o) => o.visible)).toEqual([false, true, false]);
  });
});

describe('indicator parameters', () => {
  it('changing the period recomputes the SAME series in place', () => {
    ws.setIndicatorDisplayed('rsi', true);
    const original = seriesOf('rsi:rsi');
    const created = addSeriesCalls();
    ws.setIndicatorParams('rsi', { period: 7 });
    expect(row('rsi').params).toEqual({ period: 7 });
    expect(seriesOf('rsi:rsi')).toBe(original);
    expect(addSeriesCalls()).toBe(created);
    expect(shown(original)).toEqual([...engine.values('rsi', 'rsi')]);
    expect(shown(original).findIndex((v) => v !== null)).toBe(7);
  });

  it('invalid parameters throw with the reason and change nothing', () => {
    ws.setIndicatorDisplayed('macd', true);
    const before = shown(seriesOf('macd:macd'));
    expect(() => ws.setIndicatorParams('macd', { fast: 40 })).toThrow(IndicatorConfigError);
    expect(() => ws.setIndicatorParams('rsi', { period: 1 })).toThrow(/between 2 and 500/);
    expect(row('macd').params).toEqual({ fast: 12, slow: 26, signal: 9 });
    expect(shown(seriesOf('macd:macd'))).toEqual(before);
  });

  it('parameters set before an indicator is first shown are used when it is', () => {
    ws.setIndicatorParams('rsi', { period: 5 });
    expect(vc.hasSeries('rsi:rsi')).toBe(false); // configuring does not display
    ws.setIndicatorDisplayed('rsi', true);
    expect(shown(seriesOf('rsi:rsi')).findIndex((v) => v !== null)).toBe(5);
  });

  it('the row exposes the settings metadata a UI needs', () => {
    expect(row('rsi').paramSpecs).toEqual([{ key: 'period', label: 'RSI period', min: 2, max: 500 }]);
    expect(row('macd').paramSpecs.map((p) => p.key)).toEqual(['fast', 'slow', 'signal']);
    expect(row('volume').paramSpecs).toEqual([]);
  });
});

describe('SMA', () => {
  it('lists every source from the registry, Price first, none enabled, period 20', () => {
    const keys = ws.getSnapshot().smas.map((r) => r.key);
    expect(keys).toEqual(engine.registry.smaSourceOptions().map((o) => o.key));
    expect(keys[0]).toBe('price');
    expect(ws.getSnapshot().smas.every((r) => r.period === 20 && !r.enabled)).toBe(true);
  });

  it('SMA on price: a line in the PRICE pane (no new pane), equal to SMA(20) of the closes', () => {
    ws.setSmaEnabled('price', true);
    const line = seriesOf('sma:price');
    expect(chart.panes).toHaveLength(1);
    expect(chart.paneIndexOf(line)).toBe(0);
    expect(shown(line)).toEqual(smaOver(candles.map((c) => c.close), 20));
    expect(shown(line).findIndex((v) => v !== null)).toBe(19);
    expect(sma('price')).toMatchObject({ enabled: true, period: 20, sourceDisplayed: null });
  });

  it('disabling only hides the line: calculation, series and period stay; re-enabling reuses them', () => {
    ws.setSmaEnabled('price', true);
    const line = seriesOf('sma:price');
    const created = addSeriesCalls();
    ws.setSmaEnabled('price', false);
    expect(line.options['visible']).toBe(false);
    expect(engine.has('sma-price')).toBe(true);
    expect(sma('price')).toMatchObject({ enabled: false, period: 20 });
    ws.setSmaEnabled('price', true);
    expect(seriesOf('sma:price')).toBe(line);
    expect(addSeriesCalls()).toBe(created);
  });

  it('changing the period recalculates correctly, both while shown and while off (Scenario C)', () => {
    ws.setSmaEnabled('price', true);
    const line = seriesOf('sma:price');
    ws.setSmaPeriod('price', 50);
    expect(shown(line)).toEqual(smaOver(candles.map((c) => c.close), 50));
    expect(shown(line).findIndex((v) => v !== null)).toBe(49);

    ws.setSmaEnabled('price', false);
    ws.setSmaPeriod('price', 10);
    expect(sma('price')).toMatchObject({ enabled: false, period: 10 });
    ws.setSmaEnabled('price', true);
    expect(sma('price')).toMatchObject({ enabled: true, period: 10 });
    expect(shown(line)).toEqual(smaOver(candles.map((c) => c.close), 10));
  });

  it('a period chosen before the SMA was ever enabled is used on first enable', () => {
    ws.setSmaPeriod('obv:obv', 7);
    expect(engine.has('sma-obv-obv')).toBe(false);
    ws.setSmaEnabled('obv:obv', true);
    expect(engine.get('sma-obv-obv')).toMatchObject({ period: 7 });
  });

  it('invalid periods throw and change nothing', () => {
    ws.setSmaEnabled('price', true);
    const before = shown(seriesOf('sma:price'));
    for (const bad of [0, -3, 2.5, Number.NaN, 1001]) expect(() => ws.setSmaPeriod('price', bad)).toThrow(/SMA period/);
    expect(sma('price').period).toBe(20);
    expect(shown(seriesOf('sma:price'))).toEqual(before);
  });

  it('SMA on an indicator output lives in THAT indicator\'s pane and uses exactly that output (Scenario D)', () => {
    ws.setIndicatorDisplayed('rsi', true);
    ws.setSmaEnabled('rsi:rsi', true);
    expect(chart.panes).toHaveLength(2); // shares the RSI pane, no extra pane
    const line = seriesOf('sma:rsi:rsi');
    expect(chart.paneIndexOf(line)).toBe(chart.paneIndexOf(seriesOf('rsi:rsi')));
    expect(shown(line)).toEqual(smaOver([...engine.values('rsi', 'rsi')], 20));
    expect(shown(line).findIndex((v) => v !== null)).toBe(14 + 19);
  });

  it('SMA of MACD\'s signal and of its MACD line are separate, correct and never mixed up', () => {
    ws.setIndicatorDisplayed('macd', true);
    ws.setSmaEnabled('macd:signal', true);
    ws.setSmaEnabled('macd:macd', true);
    const onSignal = shown(seriesOf('sma:macd:signal'));
    const onMacd = shown(seriesOf('sma:macd:macd'));
    expect(onSignal).toEqual(smaOver([...engine.values('macd', 'signal')], 20));
    expect(onMacd).toEqual(smaOver([...engine.values('macd', 'macd')], 20));
    expect(onSignal).not.toEqual(onMacd);
    expect(chart.paneIndexOf(seriesOf('sma:macd:signal'))).toBe(chart.paneIndexOf(seriesOf('macd:signal')));
    expect((seriesOf('sma:macd:signal') as unknown as { options: { ordinal: number } }).options.ordinal)
      .not.toBe((seriesOf('sma:macd:macd') as unknown as { options: { ordinal: number } }).options.ordinal); // distinct colours
    expect(engine.get('sma-macd-signal')).toMatchObject({ source: { instanceId: 'macd', output: 'signal' } });
    expect(engine.get('sma-macd-macd')).toMatchObject({ source: { instanceId: 'macd', output: 'macd' } });
  });

  it('an SMA on a HIDDEN indicator works: the source is calculated but not drawn, and the pane shows only the SMA', () => {
    ws.setSmaEnabled('rsi:rsi', true);
    expect(engine.has('rsi')).toBe(true);
    expect(vc.hasSeries('rsi:rsi')).toBe(false); // the RSI line itself was never created
    expect(row('rsi').displayed).toBe(false);
    expect(sma('rsi:rsi')).toMatchObject({ enabled: true, sourceDisplayed: false });
    expect(vc.isPaneVisible('rsi')).toBe(true);
    expect(shown(seriesOf('sma:rsi:rsi'))).toEqual(smaOver([...engine.values('rsi', 'rsi')], 20));

    ws.setIndicatorDisplayed('rsi', true);
    expect(sma('rsi:rsi').sourceDisplayed).toBe(true);
    expect(chart.panes).toHaveLength(2);
  });

  it('SMA visibility and source visibility are independent in both directions (rule 9)', () => {
    ws.setIndicatorDisplayed('rsi', true);
    ws.setSmaEnabled('rsi:rsi', true);
    ws.setIndicatorDisplayed('rsi', false);
    expect(sma('rsi:rsi').enabled).toBe(true);
    expect(chart.stretch.get(chart.panes[1]!)).toBe(1); // the SMA keeps the pane open
    ws.setSmaEnabled('rsi:rsi', false);
    expect(chart.stretch.get(chart.panes[1]!)).toBe(0);
    ws.setIndicatorDisplayed('rsi', true);
    expect(sma('rsi:rsi').enabled).toBe(false); // showing the source does not switch the SMA back on
  });

  it('changing the source indicator\'s parameters recomputes its SMA', () => {
    ws.setIndicatorDisplayed('rsi', true);
    ws.setSmaEnabled('rsi:rsi', true);
    ws.setIndicatorParams('rsi', { period: 5 });
    expect(shown(seriesOf('sma:rsi:rsi'))).toEqual(smaOver([...engine.values('rsi', 'rsi')], 20));
    expect(shown(seriesOf('sma:rsi:rsi')).findIndex((v) => v !== null)).toBe(5 + 19);
  });

  it('live ticks update both the indicator and its SMA', () => {
    ws.setIndicatorDisplayed('rsi', true);
    ws.setSmaEnabled('rsi:rsi', true);
    ws.setSmaEnabled('price', true);
    const more = randomCandles(83, 3);
    for (let i = 80; i < 83; i++) {
      engine.append(more[i]!);
      engine.update({ ...more[i]!, close: more[i]!.close + 0.5, high: more[i]!.high + 0.5 });
    }
    expect(shown(seriesOf('rsi:rsi'))).toEqual([...engine.values('rsi', 'rsi')]);
    expect(shown(seriesOf('sma:rsi:rsi'))).toEqual([...engine.values('sma-rsi-rsi', 'sma')]);
    expect(shown(seriesOf('sma:price'))).toEqual([...engine.values('sma-price', 'sma')]);
  });

  it('repeated SMA toggles create no duplicates', () => {
    ws.setSmaEnabled('price', true);
    ws.setSmaEnabled('obv:obv', true);
    const before = { created: addSeriesCalls(), instances: engine.list().length };
    for (let i = 0; i < 40; i++) {
      ws.setSmaEnabled('price', false);
      ws.setSmaEnabled('price', true);
      ws.setSmaEnabled('obv:obv', false);
      ws.setSmaEnabled('obv:obv', true);
    }
    expect({ created: addSeriesCalls(), instances: engine.list().length }).toEqual(before);
  });
});

describe('snapshot and subscriptions', () => {
  it('is referentially stable until something changes, and notifies subscribers once per change', () => {
    const seen: unknown[] = [];
    ws.subscribe((s) => seen.push(s));
    const s0 = ws.getSnapshot();
    expect(ws.getSnapshot()).toBe(s0);
    ws.setIndicatorDisplayed('rsi', true);
    expect(ws.getSnapshot()).not.toBe(s0);
    expect(seen.length).toBeGreaterThan(0);
  });

  it('reflects visibility changed by anyone else: the menus hold no state of their own', () => {
    ws.setIndicatorDisplayed('rsi', true);
    vc.setSeriesVisible('rsi:rsi', false); // not through the workspace
    expect(row('rsi').displayed).toBe(false);
    vc.setSeriesVisible('rsi:rsi', true);
    expect(row('rsi').displayed).toBe(true);
  });

  it('dispose stops it reacting to the engine and the chart', () => {
    ws.setIndicatorDisplayed('rsi', true);
    const rsi = seriesOf('rsi:rsi');
    ws.dispose();
    rsi.setData.mockClear();
    rsi.update.mockClear();
    engine.append(randomCandles(81, 3)[80]!);
    expect(rsi.update).not.toHaveBeenCalled();
    expect(rsi.setData).not.toHaveBeenCalled();
  });
});
