import { describe, expect, it } from 'vitest';
import { PRICE_PANE_ID, PaneManager } from '../src/chart/PaneManager';
import { NO_CHANGE, VisibilityModel } from '../src/chart/VisibilityModel';
import { mulberry32 } from './helpers/candles';

function setup() {
  const panes = new PaneManager();
  const model = new VisibilityModel(panes, new Set(['price']));
  model.registerSeries('price', PRICE_PANE_ID);
  return { panes, model };
}

describe('VisibilityModel: independent series, derived panes', () => {
  it('every series has its own visibility', () => {
    const { model } = setup();
    model.registerSeries('rsi', 'rsi');
    model.registerSeries('obv', 'obv');
    model.setSeriesVisible('rsi', false);
    expect(model.isSeriesVisible('rsi')).toBe(false);
    expect(model.isSeriesVisible('obv')).toBe(true);
  });

  it('a pane is visible exactly while one of its series is (rule 3, 4)', () => {
    const { model } = setup();
    model.registerSeries('macd', 'macd');
    model.registerSeries('signal', 'macd');
    model.registerSeries('hist', 'macd');

    model.setSeriesVisible('macd', false);
    model.setSeriesVisible('signal', false);
    expect(model.isPaneVisible('macd')).toBe(true); // histogram still visible (rule 10)

    const last = model.setSeriesVisible('hist', false);
    expect(model.isPaneVisible('macd')).toBe(false);
    expect(last.panes).toEqual([{ paneId: 'macd', visible: false }]);

    const back = model.setSeriesVisible('signal', true);
    expect(model.isPaneVisible('macd')).toBe(true);
    expect(back.panes).toEqual([{ paneId: 'macd', visible: true }]);
  });

  it('only the transitions that flip a pane report a pane change', () => {
    const { model } = setup();
    model.registerSeries('a', 'p');
    model.registerSeries('b', 'p');
    expect(model.setSeriesVisible('a', false).panes).toEqual([]); // b keeps it visible
    expect(model.setSeriesVisible('b', false).panes).toEqual([{ paneId: 'p', visible: false }]);
    expect(model.setSeriesVisible('a', true).panes).toEqual([{ paneId: 'p', visible: true }]);
    expect(model.setSeriesVisible('b', true).panes).toEqual([]); // already visible
  });

  it('setting the state a series already has is a no-op', () => {
    const { model } = setup();
    model.registerSeries('a', 'p');
    expect(model.setSeriesVisible('a', true)).toBe(NO_CHANGE);
    model.setSeriesVisible('a', false);
    expect(model.setSeriesVisible('a', false)).toBe(NO_CHANGE);
  });

  it('an SMA is independent of its source (rule 9): hiding the source leaves the SMA, and the pane, visible', () => {
    const { model } = setup();
    model.registerSeries('rsi', 'rsi');
    model.registerSeries('sma-rsi-10', 'rsi');
    model.setSeriesVisible('rsi', false);
    expect(model.isSeriesVisible('sma-rsi-10')).toBe(true);
    expect(model.isPaneVisible('rsi')).toBe(true);
    model.setSeriesVisible('sma-rsi-10', false);
    expect(model.isPaneVisible('rsi')).toBe(false);
    model.setSeriesVisible('rsi', true); // showing the source does not turn the SMA back on
    expect(model.isSeriesVisible('sma-rsi-10')).toBe(false);
    expect(model.isPaneVisible('rsi')).toBe(true);
  });

  it('the price pane can never be hidden: its series is permanent', () => {
    const { model } = setup();
    expect(() => model.setSeriesVisible('price', false)).toThrow(/permanent/);
    expect(() => model.unregisterSeries('price')).toThrow(/permanent/);
    expect(model.isPaneVisible(PRICE_PANE_ID)).toBe(true);
    expect(() => new VisibilityModel(new PaneManager(), new Set(['x'])).registerSeries('x', 'p', false)).toThrow(/permanent/);
  });

  it('overlays in the price pane do not affect it: it stays visible whatever they do', () => {
    const { model } = setup();
    model.registerSeries('sma-price-20', PRICE_PANE_ID);
    model.setSeriesVisible('sma-price-20', false);
    expect(model.isPaneVisible(PRICE_PANE_ID)).toBe(true);
  });
});

describe('VisibilityModel: registration and removal', () => {
  it('a new pane starts hidden-by-derivation until a visible series arrives', () => {
    const { model } = setup();
    const hiddenFirst = model.registerSeries('a', 'p', false);
    expect(hiddenFirst.panes).toEqual([]); // pane was never visible, still isn't
    expect(model.isPaneVisible('p')).toBe(false);
    expect(model.registerSeries('b', 'p', true).panes).toEqual([{ paneId: 'p', visible: true }]);
  });

  it('refuses duplicate ids and unknown ids', () => {
    const { model } = setup();
    model.registerSeries('a', 'p');
    expect(() => model.registerSeries('a', 'q')).toThrow(/already registered/);
    expect(() => model.setSeriesVisible('nope', true)).toThrow(/Unknown series/);
    expect(() => model.unregisterSeries('nope')).toThrow(/Unknown series/);
    expect(() => model.isSeriesVisible('nope')).toThrow(/Unknown series/);
  });

  it('unregistering the last series hides the pane but the pane keeps its logical slot', () => {
    const { model, panes } = setup();
    model.registerSeries('a', 'p');
    model.registerSeries('b', 'q');
    const change = model.unregisterSeries('a');
    expect(change.panes).toEqual([{ paneId: 'p', visible: false }]);
    expect(panes.order).toEqual([PRICE_PANE_ID, 'p', 'q']);
    expect(model.visiblePaneOrder()).toEqual([PRICE_PANE_ID, 'q']);
  });

  it('unregistering one of two series keeps the pane visible', () => {
    const { model } = setup();
    model.registerSeries('a', 'p');
    model.registerSeries('b', 'p');
    expect(model.unregisterSeries('a').panes).toEqual([]);
    expect(model.isPaneVisible('p')).toBe(true);
  });
});

describe('VisibilityModel: order and snapshots', () => {
  it('visiblePaneOrder follows the logical order and skips hidden panes; hiding never reorders', () => {
    const { model, panes } = setup();
    ['volume', 'rsi', 'macd'].forEach((p) => panes.register(p));
    model.registerSeries('macd-line', 'macd');
    model.registerSeries('rsi-line', 'rsi');
    model.registerSeries('vol', 'volume');
    expect(model.visiblePaneOrder()).toEqual([PRICE_PANE_ID, 'volume', 'rsi', 'macd']);
    model.setSeriesVisible('rsi-line', false);
    expect(model.visiblePaneOrder()).toEqual([PRICE_PANE_ID, 'volume', 'macd']);
    expect(panes.order).toEqual([PRICE_PANE_ID, 'volume', 'rsi', 'macd']);
    model.setSeriesVisible('rsi-line', true);
    expect(model.visiblePaneOrder()).toEqual([PRICE_PANE_ID, 'volume', 'rsi', 'macd']);
  });

  it('snapshot lists every series and every pane (hidden ones too) with derived visibility', () => {
    const { model } = setup();
    model.registerSeries('a', 'p');
    model.setSeriesVisible('a', false);
    const snap = model.snapshot();
    expect(snap.series).toEqual([
      { id: 'price', paneId: 'price', visible: true },
      { id: 'a', paneId: 'p', visible: false },
    ]);
    expect(snap.panes).toEqual([
      { paneId: 'price', visible: true, seriesIds: ['price'] },
      { paneId: 'p', visible: false, seriesIds: ['a'] },
    ]);
  });

  it('random operation sequences always agree with a from-scratch derivation (property test)', () => {
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const rand = mulberry32(seed);
      const { model } = setup();
      const paneIds = ['price', 'p1', 'p2', 'p3'];
      const ids: string[] = [];
      let n = 0;
      for (let step = 0; step < 400; step++) {
        const r = rand();
        if (r < 0.25 || ids.length === 0) {
          const id = `s${n++}`;
          model.registerSeries(id, paneIds[Math.floor(rand() * paneIds.length)]!, rand() < 0.7);
          ids.push(id);
        } else if (r < 0.85) {
          model.setSeriesVisible(ids[Math.floor(rand() * ids.length)]!, rand() < 0.5);
        } else {
          const at = Math.floor(rand() * ids.length);
          model.unregisterSeries(ids[at]!);
          ids.splice(at, 1);
        }
        const snap = model.snapshot();
        for (const pane of snap.panes) {
          const mine = snap.series.filter((s) => s.paneId === pane.paneId);
          const expected = pane.paneId === PRICE_PANE_ID ? true : mine.some((s) => s.visible);
          expect(pane.visible, `seed ${seed} step ${step} pane ${pane.paneId}`).toBe(expected);
        }
      }
    }
  });
});
