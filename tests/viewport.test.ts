import { describe, expect, it, vi } from 'vitest';
import { ViewportController } from '../src/chart/ViewportController';
import { FakeChart } from './helpers/fakeChart';

describe('ViewportController', () => {
  it('reads the logical range, or null when there is no data', () => {
    const chart = new FakeChart();
    const viewport = new ViewportController(chart.asPort());
    expect(viewport.getLogicalRange()).toBeNull();
    chart.visibleRange = { from: -2.5, to: 40.25 };
    expect(viewport.getLogicalRange()).toEqual({ from: -2.5, to: 40.25 });
  });

  it('sets the logical range through the time scale', () => {
    const chart = new FakeChart();
    new ViewportController(chart.asPort()).setLogicalRange({ from: 3, to: 9.5 });
    expect(chart.timeScaleMock.setVisibleLogicalRange).toHaveBeenCalledWith({ from: 3, to: 9.5 });
  });

  it('delegates fit and scroll-to-latest to the time scale', () => {
    const chart = new FakeChart();
    const viewport = new ViewportController(chart.asPort());
    viewport.fitContent();
    viewport.scrollToLatest();
    expect(chart.fitContent).toHaveBeenCalledTimes(1);
    expect(chart.scrollToRealTime).toHaveBeenCalledTimes(1);
  });

  it('subscribes upstream lazily and emits plain range objects', () => {
    const chart = new FakeChart();
    const viewport = new ViewportController(chart.asPort());
    expect(chart.timeScaleMock.subscribeVisibleLogicalRangeChange).not.toHaveBeenCalled();

    const fn = vi.fn();
    const stop = viewport.subscribe(fn);
    expect(chart.timeScaleMock.subscribeVisibleLogicalRangeChange).toHaveBeenCalledTimes(1);

    chart.emitRange({ from: 1, to: 9 });
    chart.emitRange(null);
    expect(fn.mock.calls).toEqual([
      [{ from: 1, to: 9 }, { userDriven: false }],
      [null, { userDriven: false }],
    ]);

    stop();
    expect(chart.timeScaleMock.unsubscribeVisibleLogicalRangeChange).toHaveBeenCalledTimes(1);
    expect(chart.rangeHandlers.size).toBe(0);
  });

  it('flags changes made during a user gesture, and only those', () => {
    const chart = new FakeChart();
    const gestures = { active: false };
    const viewport = new ViewportController(chart.asPort(), gestures);
    const fn = vi.fn();
    viewport.subscribe(fn);
    chart.emitRange({ from: 0, to: 5 });
    gestures.active = true;
    chart.emitRange({ from: -3, to: 2 });
    expect(fn.mock.calls.map((c) => c[1].userDriven)).toEqual([false, true]);
  });

  it('dispose detaches and silences listeners', () => {
    const chart = new FakeChart();
    const viewport = new ViewportController(chart.asPort());
    const fn = vi.fn();
    viewport.subscribe(fn);
    viewport.dispose();
    chart.emitRange({ from: 0, to: 1 });
    expect(fn).not.toHaveBeenCalled();
    expect(chart.rangeHandlers.size).toBe(0);
  });
});
