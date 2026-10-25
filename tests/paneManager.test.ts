import { describe, expect, it } from 'vitest';
import { PRICE_PANE_ID, PaneManager } from '../src/chart/PaneManager';

describe('PaneManager', () => {
  it('starts with only the price pane, holding no series yet', () => {
    const panes = new PaneManager();
    expect(panes.order).toEqual([PRICE_PANE_ID]);
    expect(panes.isMaterialized(PRICE_PANE_ID)).toBe(false);
    expect(panes.materializedCount).toBe(0);
  });

  it('register is idempotent and appends to the logical order', () => {
    const panes = new PaneManager();
    panes.register('rsi');
    panes.register('rsi');
    panes.register('macd');
    expect(panes.order).toEqual([PRICE_PANE_ID, 'rsi', 'macd']);
  });

  it('indexFor counts only existing panes before it', () => {
    const panes = new PaneManager();
    ['volume', 'rsi', 'macd'].forEach((id) => panes.register(id));
    panes.noteSeriesAdded(PRICE_PANE_ID);
    panes.noteSeriesAdded('macd'); // volume and rsi do not exist yet

    expect(panes.indexFor('macd')).toBe(1);
    expect(panes.indexFor('rsi')).toBe(1); // would slot in before macd
    expect(panes.indexFor('volume')).toBe(1);

    panes.noteSeriesAdded('rsi');
    expect(panes.indexFor('macd')).toBe(2);
    expect(panes.indexFor('volume')).toBe(1);
  });

  it('a pane that loses its last series keeps its logical slot and returns to it', () => {
    const panes = new PaneManager();
    ['volume', 'rsi', 'macd'].forEach((id) => panes.register(id));
    [PRICE_PANE_ID, 'volume', 'rsi', 'macd'].forEach((id) => panes.noteSeriesAdded(id));
    expect(panes.indexFor('macd')).toBe(3);

    panes.noteSeriesRemoved('rsi');
    expect(panes.isMaterialized('rsi')).toBe(false);
    expect(panes.order).toEqual([PRICE_PANE_ID, 'volume', 'rsi', 'macd']);
    expect(panes.indexFor('macd')).toBe(2);

    panes.noteSeriesAdded('rsi');
    expect(panes.indexFor('rsi')).toBe(2);
    expect(panes.indexFor('macd')).toBe(3);
  });

  it('a shared pane stays materialized until its last series is removed', () => {
    const panes = new PaneManager();
    panes.register('rsi');
    panes.noteSeriesAdded('rsi');
    panes.noteSeriesAdded('rsi');
    panes.noteSeriesRemoved('rsi');
    expect(panes.isMaterialized('rsi')).toBe(true);
    panes.noteSeriesRemoved('rsi');
    expect(panes.isMaterialized('rsi')).toBe(false);
  });

  it('throws for unknown panes and for removing a series that was never added', () => {
    const panes = new PaneManager();
    expect(() => panes.indexFor('nope')).toThrow(/unknown pane/i);
    panes.register('rsi');
    expect(() => panes.noteSeriesRemoved('rsi')).toThrow(/no series/i);
  });

  it('forget refuses the price pane and panes that still hold series, otherwise drops the slot', () => {
    const panes = new PaneManager();
    panes.register('rsi');
    panes.noteSeriesAdded('rsi');
    expect(() => panes.forget(PRICE_PANE_ID)).toThrow(/price pane/i);
    expect(() => panes.forget('rsi')).toThrow(/still holds/i);
    panes.noteSeriesRemoved('rsi');
    panes.forget('rsi');
    expect(panes.order).toEqual([PRICE_PANE_ID]);
    expect(panes.has('rsi')).toBe(false);
  });
});
