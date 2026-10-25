import { describe, expect, it, vi } from 'vitest';
import { MarketDataService } from '../src/data/MarketDataService';
import type { HistoricalRequest, MarketDataProvider } from '../src/data/MarketDataProvider';
import type { FeedHandlers, LiveFeed } from '../src/data/PollingFeed';
import { bindIndicatorsToService } from '../src/indicators/bindIndicatorsToService';
import { IndicatorEngine } from '../src/indicators/IndicatorEngine';
import { randomCandles } from './helpers/candles';
import type { Candle } from '../src/types/marketData';

const REQ = { symbol: 'SIM', timeframe: '1D' } as const;
const asRaw = (c: Candle) => ({ ...c });

function setup(all: readonly Candle[], initial = 60) {
  const history = vi.fn(async (r: HistoricalRequest): Promise<unknown[]> => {
    const before = r.before === undefined ? all : all.filter((c) => c.time < r.before!);
    return before.slice(-(r.limit ?? before.length)).map(asRaw);
  });
  const provider: MarketDataProvider = { id: 't', displayName: 'T', isSimulated: false, fetchHistorical: history, fetchLatest: async () => [] };
  const service = new MarketDataService(provider);
  let handlers: FeedHandlers | null = null;
  const feed: LiveFeed = { start: (h) => void (handlers = h), stop: () => {} };
  const engine = new IndicatorEngine();
  engine.addIndicator({ definitionId: 'rsi' });
  engine.addIndicator({ definitionId: 'macd' });
  engine.addSma({ id: 'sma-close', source: { kind: 'price' }, period: 10 });
  engine.addSma({ id: 'sma-rsi', source: { kind: 'indicator', instanceId: 'rsi', output: 'rsi' }, period: 5 });
  return { service, engine, feed, deliver: (r: unknown[]) => handlers!.onRecords(r), initial };
}

const expectInSync = (engine: IndicatorEngine, candles: readonly Candle[]) => {
  const fresh = new IndicatorEngine();
  fresh.addIndicator({ definitionId: 'rsi' });
  fresh.addIndicator({ definitionId: 'macd' });
  fresh.addSma({ id: 'sma-close', source: { kind: 'price' }, period: 10 });
  fresh.addSma({ id: 'sma-rsi', source: { kind: 'indicator', instanceId: 'rsi', output: 'rsi' }, period: 5 });
  fresh.reset(candles);
  for (const i of engine.list()) for (const o of i.outputs) expect([...engine.values(i.id, o.key)], `${i.id}.${o.key}`).toEqual([...fresh.values(i.id, o.key)]);
};

describe('bindIndicatorsToService', () => {
  it('computes on load, then follows live updates, new bars and older history, always matching a recompute', async () => {
    const all = randomCandles(200, 21);
    const t = setup(all);
    const stop = bindIndicatorsToService(t.engine, t.service);
    await t.service.load({ ...REQ, limit: 60 });
    expect(t.engine.length).toBe(60);
    expectInSync(t.engine, t.service.candles);

    t.service.startLive({ intervalMs: 1000, feed: t.feed });
    const last = t.service.candles.at(-1)!;
    t.deliver([asRaw({ ...last, close: last.close + 0.4, high: last.high + 0.6 })]); // live tick on the current bar
    expect(t.engine.length).toBe(60);
    expectInSync(t.engine, t.service.candles);

    const next = randomCandles(62, 21)[61]!; // a bar after the last one
    t.deliver([asRaw({ ...next, time: (last.time + 86_400) as never })]);
    expect(t.engine.length).toBe(61);
    expectInSync(t.engine, t.service.candles);

    await t.service.loadOlder(50);
    expect(t.engine.length).toBe(111);
    expectInSync(t.engine, t.service.candles);
    stop();
  });

  it('syncs immediately if the service already holds data when bound', async () => {
    const t = setup(randomCandles(80, 22));
    await t.service.load({ ...REQ, limit: 80 });
    bindIndicatorsToService(t.engine, t.service);
    expect(t.engine.length).toBe(80);
    expectInSync(t.engine, t.service.candles);
  });

  it('recovers by recomputing from the service if the engine falls out of step, and says so', async () => {
    const all = randomCandles(100, 23);
    const t = setup(all);
    bindIndicatorsToService(t.engine, t.service);
    await t.service.load({ ...REQ, limit: 60 });
    t.service.startLive({ intervalMs: 1000, feed: t.feed });

    const rogue = randomCandles(1, 99)[0]!;
    t.engine.append({ ...rogue, time: (t.service.candles.at(-1)!.time + 86_400 * 7) as never }); // someone else pushed a bar
    expect(t.engine.length).toBe(61);

    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const last = t.service.candles.at(-1)!;
    t.deliver([asRaw({ ...last, close: last.close + 1, high: last.high + 1 })]);
    expect(log).toHaveBeenCalledWith(expect.stringContaining('out of sync'), expect.anything());
    expect(t.engine.length).toBe(60);
    expectInSync(t.engine, t.service.candles);
    log.mockRestore();
  });

  it('does not swallow unrelated errors', async () => {
    const t = setup(randomCandles(80, 24));
    bindIndicatorsToService(t.engine, t.service);
    vi.spyOn(t.engine, 'reset').mockImplementation(() => {
      throw new TypeError('real bug');
    });
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    await t.service.load({ ...REQ, limit: 60 }); // the 'reset' event hits the broken engine
    expect(log).toHaveBeenCalledWith('EventChannel listener threw', expect.any(TypeError)); // surfaced, not hidden
    log.mockRestore();
  });

  it('unbinding stops updates', async () => {
    const t = setup(randomCandles(80, 25));
    const stop = bindIndicatorsToService(t.engine, t.service);
    await t.service.load({ ...REQ, limit: 60 });
    stop();
    await t.service.load({ ...REQ, limit: 30 });
    expect(t.engine.length).toBe(60);
  });
});
