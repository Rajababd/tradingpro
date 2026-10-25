import { describe, expect, it, vi } from 'vitest';
import { bindChartToService, type ChartSink } from '../src/app/bindChartToService';
import type { ViewportListener } from '../src/chart/ViewportController';
import type { MarketDataEvent } from '../src/data/MarketDataService';

/** Just enough of MarketDataService for the wiring. */
function fakeService() {
  let listener: ((e: MarketDataEvent) => void) | null = null;
  return {
    subscribe: vi.fn((l: (e: MarketDataEvent) => void) => {
      listener = l;
      return () => void (listener = null);
    }),
    loadOlder: vi.fn(async () => {}),
    emit: (e: MarketDataEvent) => listener?.(e),
    get subscribed() {
      return listener !== null;
    },
  };
}

function fakeChart() {
  let viewportListener: ViewportListener | null = null;
  const chart = {
    setCandles: vi.fn(),
    updateCandle: vi.fn(),
    prependCandles: vi.fn(),
    viewport: {
      subscribe: vi.fn((l: ViewportListener) => {
        viewportListener = l;
        return () => void (viewportListener = null);
      }),
    },
  } satisfies ChartSink;
  return { chart, pan: (from: number, userDriven = true) => viewportListener?.({ from, to: from + 100 }, { userDriven }), panNothing: () => viewportListener?.(null, { userDriven: true }), get bound() { return viewportListener !== null; } };
}

const candle = { time: 1 as never, open: 1, high: 2, low: 1, close: 1.5, volume: null };
const setup = () => {
  const service = fakeService();
  const c = fakeChart();
  const unbind = bindChartToService(c.chart, service as never, { loadOlderWithinBars: 20 });
  return { service, c, unbind };
};

describe('bindChartToService: data to chart', () => {
  it('maps reset, append, update and prepend to the matching incremental chart calls', () => {
    const { service, c } = setup();
    const all = [candle];
    service.emit({ type: 'reset', candles: all });
    service.emit({ type: 'append', candle, index: 1 });
    service.emit({ type: 'update', candle, index: 1 });
    service.emit({ type: 'prepend', candles: all, added: 4 });
    expect(c.chart.setCandles).toHaveBeenCalledWith(all);
    expect(c.chart.updateCandle).toHaveBeenCalledTimes(2);
    expect(c.chart.prependCandles).toHaveBeenCalledWith(all, 4);
  });

  it('a live tick never causes a full rebuild', () => {
    const { service, c } = setup();
    service.emit({ type: 'update', candle, index: 0 });
    service.emit({ type: 'append', candle, index: 1 });
    expect(c.chart.setCandles).not.toHaveBeenCalled();
    expect(c.chart.prependCandles).not.toHaveBeenCalled();
  });
});

describe('bindChartToService: paging when panning left', () => {
  it('asks for older candles when the user pans left into the threshold', () => {
    const { service, c } = setup();
    c.pan(50);
    c.pan(30);
    expect(service.loadOlder).not.toHaveBeenCalled(); // moved left but still far from the edge
    c.pan(15);
    expect(service.loadOlder).toHaveBeenCalledTimes(1);
  });

  it('never pages for a programmatic or settling range change, even a leftward one near the edge', () => {
    const { service, c } = setup();
    c.pan(0, false);
    c.pan(-0.5, false); // the library's own post-load settling reads as a small leftward move
    c.pan(-40, false);
    expect(service.loadOlder).not.toHaveBeenCalled();
  });

  it('a programmatic move still updates the reference position for the next user move', () => {
    const { service, c } = setup();
    c.pan(30, false);
    c.pan(15, true); // a user move left of the (programmatic) 30 and inside the threshold of 20
    expect(service.loadOlder).toHaveBeenCalledTimes(1);
  });

  it('does not page on the first range it sees (fit-to-data), even at the very left', () => {
    const { service, c } = setup();
    c.pan(0);
    expect(service.loadOlder).not.toHaveBeenCalled();
  });

  it('does not page when the range moves right (e.g. re-anchoring after a prepend)', () => {
    const { service, c } = setup();
    c.pan(10);
    c.pan(160);
    c.pan(15); // left move from 160 to 15 pages; the right move above did not
    expect(service.loadOlder).toHaveBeenCalledTimes(1);
  });

  it('forgets the previous position after a reload so the first range is again just a fit', () => {
    const { service, c } = setup();
    c.pan(50);
    service.emit({ type: 'reset', candles: [candle] });
    c.pan(0);
    expect(service.loadOlder).not.toHaveBeenCalled();
    c.pan(-5);
    expect(service.loadOlder).toHaveBeenCalledTimes(1);
  });

  it('ignores a null range (no data yet) without losing track of the last position', () => {
    const { service, c } = setup();
    c.pan(50);
    c.panNothing();
    expect(service.loadOlder).not.toHaveBeenCalled();
    c.pan(10); // still compared against 50, so this is a leftward move into the threshold
    expect(service.loadOlder).toHaveBeenCalledTimes(1);
  });
});

describe('bindChartToService: cleanup', () => {
  it('unbinding detaches both subscriptions', () => {
    const { service, c, unbind } = setup();
    expect(service.subscribed && c.bound).toBe(true);
    unbind();
    expect(service.subscribed || c.bound).toBe(false);
  });
});
