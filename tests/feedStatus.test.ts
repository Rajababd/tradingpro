import { describe, expect, it } from 'vitest';
import { initialMarketDataState, type MarketDataState } from '../src/data/MarketDataService';
import type { FeedStatus } from '../src/data/PollingFeed';
import { describeFeed, describeHistory } from '../src/ui/feedStatus';

const fmt = (ms: number) => `t${ms}`;
const base = (isSimulated: boolean): MarketDataState =>
  initialMarketDataState({ id: 'x', displayName: 'X', isSimulated });
const withLive = (s: MarketDataState, live: Partial<FeedStatus>): MarketDataState => ({
  ...s,
  live: { connection: 'connected', consecutiveFailures: 0, lastSuccessAt: 42, lastError: null, nextAttemptAt: null, ...live },
});

describe('describeFeed', () => {
  it('says nothing before live updates start or after they stop', () => {
    expect(describeFeed(base(true), fmt)).toEqual({ label: '', tone: 'muted' });
    expect(describeFeed(withLive(base(true), { connection: 'stopped' }), fmt).label).toBe('');
    expect(describeFeed(withLive(base(true), { connection: 'idle' }), fmt).label).toBe('');
  });

  it('never calls simulated data "Live"', () => {
    const d = describeFeed(withLive(base(true), {}), fmt);
    expect(d).toEqual({ label: 'Simulated feed · updated t42', tone: 'ok' });
    expect(d.label).not.toMatch(/^Live/);
  });

  it('reserves "Live" for a real connected source', () => {
    expect(describeFeed(withLive(base(false), {}), fmt)).toEqual({ label: 'Live · updated t42', tone: 'ok' });
  });

  it('shows reconnecting with the attempt count, as a warning, for either kind of source', () => {
    for (const sim of [true, false]) {
      const d = describeFeed(withLive(base(sim), { connection: 'retrying', consecutiveFailures: 3 }), fmt);
      expect(d).toEqual({ label: 'Reconnecting… (attempt 3)', tone: 'warn' });
    }
  });

  it('omits the time when there has been no successful poll yet', () => {
    expect(describeFeed(withLive(base(true), { lastSuccessAt: null }), fmt).label).toBe('Simulated feed');
  });
});

describe('describeHistory', () => {
  it('reports loading and failure of older candles, otherwise nothing', () => {
    const s = base(true);
    expect(describeHistory(s)).toBe('');
    expect(describeHistory({ ...s, history: { loadingOlder: true, exhausted: false, error: null } })).toBe('Loading older candles…');
    expect(describeHistory({ ...s, history: { loadingOlder: false, exhausted: false, error: 'x' } })).toBe('Could not load older candles');
  });
});
