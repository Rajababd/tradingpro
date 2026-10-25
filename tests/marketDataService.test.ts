import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FixtureProvider } from '../src/data/FixtureProvider';
import { MarketDataService, type MarketDataEvent } from '../src/data/MarketDataService';
import type { HistoricalRequest, LatestRequest, MarketDataProvider } from '../src/data/MarketDataProvider';
import type { FeedHandlers, LiveFeed } from '../src/data/PollingFeed';

const DAY = 86_400;
const T0 = 1_704_067_200;
const raw = (day: number, close = 10, extra: object = {}) => ({
  time: T0 + day * DAY,
  open: 10,
  high: 12,
  low: 9,
  close,
  volume: 100,
  ...extra,
});
const REQ = { symbol: 'SIM', timeframe: '1D' } as const;

/** A provider whose responses the test scripts. */
function scripted(initial: unknown[] = [raw(0), raw(1), raw(2)]) {
  const historical = vi.fn(async (_r: HistoricalRequest): Promise<unknown[]> => initial);
  const latest = vi.fn(async (_r: LatestRequest): Promise<unknown[]> => []);
  const provider: MarketDataProvider = {
    id: 'scripted',
    displayName: 'Scripted',
    isSimulated: false,
    fetchHistorical: historical,
    fetchLatest: latest,
  };
  return { provider, historical, latest };
}

/** A feed the test drives by hand. */
function manualFeed() {
  let handlers: FeedHandlers | null = null;
  const feed: LiveFeed & { deliver(r: readonly unknown[]): void; stopped: boolean } = {
    stopped: false,
    start: (h) => void (handlers = h),
    stop() {
      this.stopped = true;
    },
    deliver: (r) => handlers!.onRecords(r),
  };
  return { feed, handlers: () => handlers! };
}

function collect(service: MarketDataService) {
  const events: MarketDataEvent[] = [];
  service.subscribe((e) => events.push(e));
  return events;
}

describe('MarketDataService: loading', () => {
  it('loads history, emits one reset event and reaches ready', async () => {
    const { provider } = scripted();
    const s = new MarketDataService(provider);
    const events = collect(s);
    await s.load(REQ);
    expect(s.getState()).toMatchObject({ status: 'ready', error: null, candleCount: 3 });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: 'reset' });
    expect(s.candles).toHaveLength(3);
  });

  it('flags a simulated source from construction, before anything loads', () => {
    expect(new MarketDataService(new FixtureProvider()).getState().source.isSimulated).toBe(true);
    expect(new MarketDataService(scripted().provider).getState().source.isSimulated).toBe(false);
  });

  it('reports a failed load in state, without rejecting, and a retry recovers', async () => {
    const { provider, historical } = scripted();
    historical.mockRejectedValueOnce(new Error('network down'));
    const s = new MarketDataService(provider);
    const events = collect(s);
    await expect(s.load(REQ)).resolves.toBeUndefined();
    expect(s.getState().status).toBe('error');
    expect(s.getState().error).toMatch(/Could not fetch data from Scripted/);
    expect(events).toEqual([]);

    await s.load(REQ);
    expect(s.getState()).toMatchObject({ status: 'ready', error: null, candleCount: 3 });
  });

  it('reports invalid history loudly and keeps the issues when partly valid', async () => {
    const bad = { ...raw(1), high: 1 };
    const { provider } = scripted([raw(0), bad, raw(2)]);
    const s = new MarketDataService(provider);
    await s.load(REQ);
    expect(s.getState().status).toBe('ready');
    expect(s.getState().candleCount).toBe(2);
    expect(s.getState().issues).toHaveLength(1);

    const allBad = scripted([bad]);
    const s2 = new MarketDataService(allBad.provider);
    await s2.load(REQ);
    expect(s2.getState().status).toBe('error');
    expect(s2.getState().error).toMatch(/none were valid/);
  });

  it('shares one request between identical concurrent loads', async () => {
    const { provider, historical } = scripted();
    const s = new MarketDataService(provider);
    const events = collect(s);
    const a = s.load(REQ);
    const b = s.load(REQ);
    expect(a).toBe(b);
    await Promise.all([a, b]);
    expect(historical).toHaveBeenCalledTimes(1);
    expect(events).toHaveLength(1);
  });

  it('a different request supersedes the running one: it is aborted and its late result is discarded', async () => {
    const { provider, historical } = scripted();
    let releaseFirst!: (v: unknown[]) => void;
    const signals: AbortSignal[] = [];
    historical.mockImplementationOnce((r) => {
      signals.push(r.signal!);
      return new Promise((res) => (releaseFirst = res));
    });
    historical.mockImplementationOnce(async () => [raw(5), raw(6)]);

    const s = new MarketDataService(provider);
    const events = collect(s);
    const first = s.load({ ...REQ, limit: 10 });
    const second = s.load({ ...REQ, limit: 20 });
    expect(signals[0]!.aborted).toBe(true);
    await second;
    releaseFirst([raw(0), raw(1), raw(2)]); // the slow, superseded answer arrives late
    await first;
    expect(s.candles.map((c) => (c.time - T0) / DAY)).toEqual([5, 6]);
    expect(events.filter((e) => e.type === 'reset')).toHaveLength(1);
  });

  it('loads again after the previous load finished (no stale dedupe)', async () => {
    const { provider, historical } = scripted();
    const s = new MarketDataService(provider);
    await s.load(REQ);
    await s.load(REQ);
    expect(historical).toHaveBeenCalledTimes(2);
  });
});

describe('MarketDataService: older history', () => {
  const page = (...days: number[]) => days.map((d) => raw(d));

  async function ready(initial: unknown[] = page(10, 11, 12)) {
    const t = scripted(initial);
    const s = new MarketDataService(t.provider, { olderRetryCooldownMs: 5000, now: () => clock });
    const events = collect(s);
    await s.load(REQ);
    events.length = 0;
    return { ...t, s, events };
  }
  let clock = 1_000_000;
  beforeEach(() => void (clock = 1_000_000));

  it('requests candles before the first one and prepends them, reporting how many were added', async () => {
    const { s, historical, events } = await ready();
    historical.mockResolvedValueOnce(page(7, 8, 9));
    await s.loadOlder(3);
    expect(historical).toHaveBeenLastCalledWith(expect.objectContaining({ limit: 3, before: T0 + 10 * DAY }));
    expect(s.candles.map((c) => (c.time - T0) / DAY)).toEqual([7, 8, 9, 10, 11, 12]);
    expect(events).toEqual([expect.objectContaining({ type: 'prepend', added: 3 })]);
    expect(s.getState()).toMatchObject({ candleCount: 6, history: { loadingOlder: false, exhausted: false, error: null } });
  });

  it('shares one request between overlapping calls (safe to call on every pan frame)', async () => {
    const { s, historical } = await ready();
    historical.mockResolvedValue(page(8, 9));
    const calls = [s.loadOlder(), s.loadOlder(), s.loadOlder()];
    expect(s.getState().history.loadingOlder).toBe(true);
    await Promise.all(calls);
    expect(historical).toHaveBeenCalledTimes(2); // 1 initial load + 1 older page
  });

  it('marks history exhausted when the provider has nothing earlier, and stops asking', async () => {
    const { s, historical } = await ready();
    historical.mockResolvedValueOnce([]);
    await s.loadOlder();
    expect(s.getState().history.exhausted).toBe(true);
    await s.loadOlder();
    expect(historical).toHaveBeenCalledTimes(2);
  });

  it('treats a page that adds nothing new as exhausted instead of paging forever', async () => {
    const { s, historical } = await ready();
    historical.mockResolvedValueOnce(page(10, 11, 12)); // a provider that ignores `before`
    await s.loadOlder();
    expect(s.getState().history.exhausted).toBe(true);
    expect(s.candles).toHaveLength(3);
  });

  it('records a failure, backs off, then retries after the cooldown', async () => {
    const { s, historical, events } = await ready();
    historical.mockRejectedValueOnce(new Error('timeout'));
    await s.loadOlder();
    expect(s.getState().history).toMatchObject({ loadingOlder: false, exhausted: false });
    expect(s.getState().history.error).toMatch(/timeout/);
    expect(s.getState().status).toBe('ready'); // the chart keeps working
    expect(events).toEqual([]);

    await s.loadOlder(); // still cooling down: no request
    expect(historical).toHaveBeenCalledTimes(2);

    clock += 5001;
    historical.mockResolvedValueOnce(page(8, 9));
    await s.loadOlder();
    expect(s.candles).toHaveLength(5);
    expect(s.getState().history.error).toBeNull();
  });

  it('a page of only invalid candles is a failure, not a silent no-op', async () => {
    const { s, historical } = await ready();
    historical.mockResolvedValueOnce([{ ...raw(9), high: 1 }]);
    await s.loadOlder();
    expect(s.getState().history.error).toMatch(/none were valid/);
    expect(s.candles).toHaveLength(3);
  });

  it('discards an older page that arrives after a reload', async () => {
    const { s, historical, events } = await ready();
    let release!: (v: unknown[]) => void;
    historical.mockImplementationOnce(() => new Promise((r) => (release = r)));
    const older = s.loadOlder();
    historical.mockResolvedValueOnce(page(20, 21));
    await s.load({ ...REQ, limit: 2 });
    release(page(7, 8, 9));
    await older;
    expect(s.candles.map((c) => (c.time - T0) / DAY)).toEqual([20, 21]);
    expect(events.filter((e) => e.type === 'prepend')).toEqual([]);
  });

  it('does nothing before history is ready', async () => {
    const t = scripted();
    const s = new MarketDataService(t.provider);
    await s.loadOlder();
    expect(t.historical).not.toHaveBeenCalled();
  });
});

describe('MarketDataService: live updates (Scenario H)', () => {
  async function live(initial: unknown[] = [raw(0), raw(1), raw(2, 10)]) {
    const t = scripted(initial);
    let clock = 5_000;
    const s = new MarketDataService(t.provider, { now: () => clock });
    await s.load(REQ);
    const events = collect(s);
    const m = manualFeed();
    s.startLive({ intervalMs: 1000, feed: m.feed });
    return { ...t, s, events, m, tick: (ms: number) => void (clock += ms) };
  }

  it('updates the current candle in place', async () => {
    const { s, events, m } = await live();
    m.feed.deliver([raw(2, 11.5)]);
    expect(events).toEqual([expect.objectContaining({ type: 'update', index: 2 })]);
    expect(s.candles).toHaveLength(3);
    expect(s.candles.at(-1)?.close).toBe(11.5);
    expect(s.getState().stats).toMatchObject({ updated: 1, appended: 0 });
  });

  it('appends a new candle', async () => {
    const { s, events, m } = await live();
    m.feed.deliver([raw(3, 10.2)]);
    expect(events).toEqual([expect.objectContaining({ type: 'append', index: 3 })]);
    expect(s.candles).toHaveLength(4);
    expect(s.getState()).toMatchObject({ candleCount: 4, lastCandleTime: T0 + 3 * DAY });
  });

  it('handles a rollover batch (closed bar resent unchanged + new bar) with exactly one append', async () => {
    const { s, events, m } = await live();
    m.feed.deliver([raw(2), raw(3, 10.4)]); // raw(2) equals what is stored
    expect(events.map((e) => e.type)).toEqual(['append']);
    expect(s.getState().stats).toMatchObject({ unchanged: 1, appended: 1 });
  });

  it('emits nothing for an identical re-send and does not mark the data as changed', async () => {
    const { s, events, m } = await live();
    const before = s.getState().lastUpdateAt;
    m.feed.deliver([raw(2)]);
    expect(events).toEqual([]);
    expect(s.getState().lastUpdateAt).toBe(before);
    expect(s.getState().stats.unchanged).toBe(1);
  });

  it('refuses stale (out-of-order) candles, counts them, and leaves the series alone', async () => {
    const { s, events, m } = await live();
    const snapshot = [...s.candles];
    // Valid but OLDER than the latest candle, and different from what is stored (close 11 vs 10).
    expect(() => m.feed.deliver([raw(1, 11)])).not.toThrow(); // stale is not a feed failure
    expect(events).toEqual([]);
    expect([...s.candles]).toEqual(snapshot);
    expect(s.getState().stats).toMatchObject({ stale: 1, rejected: 0, updated: 0 });
  });

  it('sorts an out-of-order batch so the newer candle still lands correctly', async () => {
    const { s, m } = await live();
    m.feed.deliver([raw(4, 10.8), raw(3, 10.1)]);
    expect(s.candles.map((c) => (c.time - T0) / DAY)).toEqual([0, 1, 2, 3, 4]);
  });

  it('applies the valid records of a partly invalid batch and counts the rest as rejected', async () => {
    const { s, m } = await live();
    m.feed.deliver([{ ...raw(3), high: 1 }, raw(4)]);
    expect(s.candles.at(-1)?.time).toBe(T0 + 4 * DAY);
    expect(s.getState().stats).toMatchObject({ appended: 1, rejected: 1 });
  });

  it('refuses a batch where nothing is valid and tells the feed, so it counts a failure (Scenario I)', async () => {
    const { s, events, m } = await live();
    expect(() => m.feed.deliver([{ ...raw(3), high: 1 }, 'garbage'])).toThrow(/none were valid/);
    expect(events).toEqual([]);
    expect(s.candles).toHaveLength(3);
    expect(s.getState().stats.rejected).toBe(2);
  });

  it('stamps lastUpdateAt only when data actually changed', async () => {
    const { s, m, tick } = await live();
    const t0 = s.getState().lastUpdateAt;
    tick(1000);
    m.feed.deliver([raw(2)]);
    expect(s.getState().lastUpdateAt).toBe(t0);
    tick(1000);
    m.feed.deliver([raw(2, 11)]);
    expect(s.getState().lastUpdateAt).toBe(7_000);
  });

  it('mirrors the feed status into state', async () => {
    const { s, m } = await live();
    const status = { connection: 'retrying', consecutiveFailures: 2, lastSuccessAt: 1, lastError: 'x', nextAttemptAt: 9 } as const;
    m.handlers().onStatus(status);
    expect(s.getState().live).toEqual(status);
  });

  it('ignores records while history is reloading', async () => {
    const { s, historical, events, m } = await live();
    let release!: (v: unknown[]) => void;
    historical.mockImplementationOnce(() => new Promise((r) => (release = r)));
    const reload = s.load({ ...REQ, limit: 5 });
    m.feed.deliver([raw(9)]);
    expect(events).toEqual([]);
    release([raw(0), raw(1)]);
    await reload;
  });

  it('startLive needs loaded history and a provider that supports it; stopLive stops the feed', async () => {
    const t = scripted();
    const s = new MarketDataService(t.provider);
    expect(() => s.startLive({ intervalMs: 1000 })).toThrow(/Load history/);

    const noLive: MarketDataProvider = { ...t.provider };
    delete (noLive as { fetchLatest?: unknown }).fetchLatest;
    const s2 = new MarketDataService(noLive);
    await s2.load(REQ);
    expect(() => s2.startLive({ intervalMs: 1000 })).toThrow(/does not support live updates/);

    await s.load(REQ);
    const m = manualFeed();
    s.startLive({ intervalMs: 1000, feed: m.feed });
    s.startLive({ intervalMs: 1000, feed: manualFeed().feed }); // second start is ignored
    s.stopLive();
    expect(m.feed.stopped).toBe(true);
  });

  it('dispose stops the feed and silences everything', async () => {
    const { s, events, m } = await live();
    const states: unknown[] = [];
    s.subscribeState((x) => states.push(x));
    s.dispose();
    expect(m.feed.stopped).toBe(true);
    m.feed.deliver([raw(3)]);
    expect(events).toEqual([]);
    expect(states).toEqual([]);
    await expect(s.load(REQ)).resolves.toBeUndefined();
  });
});

describe('MarketDataService: end to end with the simulated provider and the real PollingFeed', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('keeps the series valid and matches the provider after many ticks', async () => {
    const provider = new FixtureProvider(42, 60);
    const s = new MarketDataService(provider);
    await s.load({ ...REQ, limit: 30 });
    const events = collect(s);
    s.startLive({ intervalMs: 1000 });
    await vi.advanceTimersByTimeAsync(30_000);
    s.stopLive();

    expect(s.getState().live?.connection).toBe('stopped');
    expect(s.getState().stats.appended).toBeGreaterThan(3); // several simulated bars rolled over
    expect(events.some((e) => e.type === 'update')).toBe(true);
    const times = s.candles.map((c) => c.time);
    expect(times).toEqual([...times].sort((a, b) => a - b));
    expect(new Set(times).size).toBe(times.length);

    const full = (await provider.fetchHistorical({ ...REQ, limit: s.candles.length })) as { time: number; close: number }[];
    expect(s.candles.map((c) => [c.time, c.close])).toEqual(full.map((c) => [c.time, c.close]));
  });

  it('survives a network outage mid-stream and recovers without losing or duplicating candles', async () => {
    const provider = new FixtureProvider(42, 60);
    const realLatest = provider.fetchLatest.bind(provider);
    let down = false;
    provider.fetchLatest = async (r: LatestRequest) => {
      if (down) throw new Error('connection reset');
      return realLatest(r);
    };
    const s = new MarketDataService(provider);
    await s.load({ ...REQ, limit: 30 });
    s.startLive({ intervalMs: 1000 });
    await vi.advanceTimersByTimeAsync(3000);
    const countBefore = s.candles.length;

    down = true;
    await vi.advanceTimersByTimeAsync(10_000);
    expect(s.getState().live).toMatchObject({ connection: 'retrying' });
    expect(s.getState().live!.consecutiveFailures).toBeGreaterThan(1);
    expect(s.candles).toHaveLength(countBefore); // nothing invented while offline
    expect(s.getState().status).toBe('ready');

    down = false;
    await vi.advanceTimersByTimeAsync(20_000);
    expect(s.getState().live).toMatchObject({ connection: 'connected', consecutiveFailures: 0 });
    const times = s.candles.map((c) => c.time);
    expect(new Set(times).size).toBe(times.length);
    s.dispose();
  });
});
