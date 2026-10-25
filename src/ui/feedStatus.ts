import type { MarketDataState } from '../data/MarketDataService';

export type FeedTone = 'ok' | 'warn' | 'muted';

export interface FeedDescription {
  readonly label: string;
  readonly tone: FeedTone;
}

const clock = (ms: number): string => new Date(ms).toTimeString().slice(0, 8);

/**
 * What the status area says about the live feed. Simulated data is NEVER called "Live":
 * the word is reserved for a real source that is actually connected.
 */
export function describeFeed(state: MarketDataState, formatTime: (ms: number) => string = clock): FeedDescription {
  const live = state.live;
  if (live === null || live.connection === 'idle' || live.connection === 'stopped') {
    return { label: '', tone: 'muted' };
  }
  if (live.connection === 'retrying') {
    return { label: `Reconnecting… (attempt ${live.consecutiveFailures})`, tone: 'warn' };
  }
  const when = live.lastSuccessAt === null ? '' : ` · updated ${formatTime(live.lastSuccessAt)}`;
  return { label: `${state.source.isSimulated ? 'Simulated feed' : 'Live'}${when}`, tone: 'ok' };
}

/** Short note for the older-history loader, or '' when nothing is going on. */
export function describeHistory(state: MarketDataState): string {
  const h = state.history;
  if (h.loadingOlder) return 'Loading older candles…';
  if (h.error !== null) return 'Could not load older candles';
  return '';
}
