import type { Candle, Timeframe, UnixSeconds } from '../types/marketData';
import { EventChannel, type Unsubscribe } from '../utils/eventChannel';
import { CandleStore } from './CandleStore';
import { DataLoadError, loadHistoricalCandles } from './HistoricalDataService';
import type { MarketDataProvider } from './MarketDataProvider';
import { PollingFeed, type FeedStatus, type LiveFeed } from './PollingFeed';
import { normalizeCandles, type CandleIssue } from './validator';

export type LoadStatus = 'idle' | 'loading' | 'ready' | 'error';

export interface SourceInfo {
  readonly id: string;
  readonly displayName: string;
  readonly isSimulated: boolean;
}

export interface LiveStats {
  readonly appended: number;
  readonly updated: number;
  readonly unchanged: number;
  /** Older-than-latest candles refused by the live path. */
  readonly stale: number;
  /** Records dropped for failing validation (or being superseded duplicates). */
  readonly rejected: number;
}

export interface MarketDataState {
  readonly status: LoadStatus;
  readonly error: string | null;
  /** Known from construction, so "SIMULATED" can be shown even while loading or after a failure. */
  readonly source: SourceInfo;
  readonly candleCount: number;
  /** Validation problems found in loaded history. Non-empty does not mean failure. */
  readonly issues: readonly CandleIssue[];
  readonly history: {
    readonly loadingOlder: boolean;
    /** No earlier data exists (or the provider stopped returning any). */
    readonly exhausted: boolean;
    readonly error: string | null;
  };
  /** Null until live updates are started. */
  readonly live: FeedStatus | null;
  readonly lastCandleTime: UnixSeconds | null;
  /** Clock time (ms) the data last actually changed. Distinct from the feed's lastSuccessAt. */
  readonly lastUpdateAt: number | null;
  readonly stats: LiveStats;
}

/**
 * What changed, for incremental consumers (the chart now, indicators later).
 * `candles` on reset/prepend is the store's live read-only array: copy it to keep a snapshot.
 */
export type MarketDataEvent =
  | { readonly type: 'reset'; readonly candles: readonly Candle[] }
  | { readonly type: 'append'; readonly candle: Candle; readonly index: number }
  | { readonly type: 'update'; readonly candle: Candle; readonly index: number }
  | { readonly type: 'prepend'; readonly candles: readonly Candle[]; readonly added: number };

export interface LoadRequest {
  readonly symbol: string;
  readonly timeframe: Timeframe;
  readonly limit?: number;
  /** Bypass the provider cache only for a deliberate user refresh. */
  readonly refresh?: boolean;
}

export interface MarketDataServiceOptions {
  now?: () => number;
  /** Candles requested per older page. */
  olderPageSize?: number;
  /** After a failed older-page request, wait this long before trying again (stops request storms while panning). */
  olderRetryCooldownMs?: number;
}

const ZERO_STATS: LiveStats = { appended: 0, updated: 0, unchanged: 0, stale: 0, rejected: 0 };
/** The state before anything has loaded. Also what the UI renders before a service exists. */
export function initialMarketDataState(source: SourceInfo): MarketDataState {
  return {
    status: 'idle',
    error: null,
    source,
    candleCount: 0,
    issues: [],
    history: { loadingOlder: false, exhausted: false, error: null },
    live: null,
    lastCandleTime: null,
    lastUpdateAt: null,
    stats: ZERO_STATS,
  };
}

const message = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/**
 * Owns the candle series and everything that feeds it: history loading, paging back through
 * older history, and live updates. Framework-free. Consumers get:
 *  - `getState()` / `subscribeState` for status UI (stable snapshots, safe for useSyncExternalStore);
 *  - `subscribe` for fine-grained change events that drive incremental chart/indicator updates.
 *
 * Guarantees: identical concurrent loads share one request; a newer load supersedes (and aborts)
 * an older one; stale results from superseded requests are discarded; `load` never rejects
 * (failures land in `state.error`); simulated sources are always flagged in `state.source`.
 */
export class MarketDataService {
  readonly #store = new CandleStore();
  readonly #events = new EventChannel<MarketDataEvent>();
  readonly #stateChannel = new EventChannel<MarketDataState>();
  readonly #now: () => number;
  readonly #olderPageSize: number;
  readonly #olderCooldownMs: number;

  #state: MarketDataState;
  #request: LoadRequest | null = null;
  #generation = 0;
  #disposed = false;

  #loadKey: string | null = null;
  #loadPromise: Promise<void> | null = null;
  #loadAbort: AbortController | null = null;

  #olderPromise: Promise<void> | null = null;
  #olderAbort: AbortController | null = null;
  #olderRetryAfter = 0;

  #feed: LiveFeed | null = null;

  constructor(
    private readonly provider: MarketDataProvider,
    options: MarketDataServiceOptions = {},
  ) {
    this.#now = options.now ?? Date.now;
    this.#olderPageSize = options.olderPageSize ?? 200;
    this.#olderCooldownMs = options.olderRetryCooldownMs ?? 5000;
    this.#state = initialMarketDataState({
      id: provider.id,
      displayName: provider.displayName,
      isSimulated: provider.isSimulated,
    });
  }

  /** Read-only view of the current series. */
  get candles(): readonly Candle[] {
    return this.#store.candles;
  }

  getState = (): MarketDataState => this.#state;

  subscribeState = (listener: (state: MarketDataState) => void): Unsubscribe =>
    this.#stateChannel.subscribe(listener);

  subscribe(listener: (event: MarketDataEvent) => void): Unsubscribe {
    return this.#events.subscribe(listener);
  }

  /** Loads (or reloads) history. Never rejects: check `state.status` / `state.error`. */
  load(request: LoadRequest): Promise<void> {
    if (this.#disposed) return Promise.resolve();
    const key = JSON.stringify([request.symbol, request.timeframe, request.limit ?? null]);
    if (this.#loadPromise !== null && this.#loadKey === key) return this.#loadPromise; // dedupe

    this.#loadAbort?.abort(); // a different request supersedes the running one
    this.#abortOlder();
    const generation = ++this.#generation;
    const abort = new AbortController();
    this.#loadAbort = abort;
    this.#loadKey = key;
    this.#setState({ status: 'loading', error: null, history: { ...this.#state.history, loadingOlder: false } });

    const promise: Promise<void> = this.#runLoad(request, abort, generation).finally(() => {
      if (this.#loadPromise === promise) {
        this.#loadPromise = null;
        this.#loadKey = null;
        this.#loadAbort = null;
      }
    });
    this.#loadPromise = promise;
    return promise;
  }

  /**
   * Pages backwards: fetches candles older than the first one and prepends them. Safe to call on
   * every viewport change: it does nothing unless history is ready, not exhausted, not already
   * loading, and not cooling down after a failure.
   */
  loadOlder(count: number = this.#olderPageSize): Promise<void> {
    const s = this.#state;
    const first = this.#store.first;
    if (this.#disposed || s.status !== 'ready' || s.history.exhausted || first === undefined || this.#request === null) {
      return Promise.resolve();
    }
    if (this.#olderPromise !== null) return this.#olderPromise;
    if (this.#now() < this.#olderRetryAfter) return Promise.resolve();

    const generation = this.#generation;
    const abort = new AbortController();
    this.#olderAbort = abort;
    this.#setState({ history: { ...s.history, loadingOlder: true, error: null } });

    const promise: Promise<void> = this.#runLoadOlder(this.#request, first.time, count, abort, generation).finally(() => {
      if (this.#olderPromise === promise) {
        this.#olderPromise = null;
        this.#olderAbort = null;
      }
    });
    this.#olderPromise = promise;
    return promise;
  }

  /**
   * Starts live updates for the loaded series. Pass `feed` to use another transport (e.g. a
   * WebSocket); by default the provider's `fetchLatest` is polled every `intervalMs`.
   */
  startLive(options: { intervalMs: number; feed?: LiveFeed }): void {
    if (this.#disposed || this.#feed !== null) return;
    const request = this.#request;
    if (request === null) throw new Error('Load history before starting live updates.');

    let feed = options.feed;
    if (feed === undefined) {
      const fetchLatest = this.provider.fetchLatest?.bind(this.provider);
      if (fetchLatest === undefined) throw new Error(`${this.provider.displayName} does not support live updates.`);
      feed = new PollingFeed({
        fetch: (signal) => fetchLatest({ symbol: request.symbol, timeframe: request.timeframe, signal }),
        intervalMs: options.intervalMs,
        now: this.#now,
      });
    }
    this.#feed = feed;
    feed.start({
      onRecords: (raw) => this.#applyLive(raw),
      onStatus: (live) => this.#setState({ live }),
    });
  }

  stopLive(): void {
    this.#feed?.stop();
    this.#feed = null;
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#generation += 1;
    this.#loadAbort?.abort();
    this.#abortOlder();
    this.stopLive();
    this.#events.clear();
    this.#stateChannel.clear();
  }

  async #runLoad(request: LoadRequest, abort: AbortController, generation: number): Promise<void> {
    try {
      const result = await loadHistoricalCandles(this.provider, { ...request, signal: abort.signal });
      if (generation !== this.#generation) return; // superseded or disposed
      this.#request = request;
      this.#store.reset(result.candles);
      this.#emit({ type: 'reset', candles: this.#store.candles });
      this.#setState({
        status: 'ready',
        error: null,
        source: result.source,
        candleCount: this.#store.length,
        issues: result.issues,
        history: { loadingOlder: false, exhausted: false, error: null },
        lastCandleTime: this.#store.last?.time ?? null,
        lastUpdateAt: this.#now(),
        stats: ZERO_STATS,
      });
    } catch (error) {
      if (generation !== this.#generation || abort.signal.aborted) return;
      // Existing data (if any) is left alone; the status carries the failure.
      this.#setState({ status: 'error', error: message(error) });
    }
  }

  async #runLoadOlder(
    request: LoadRequest,
    before: UnixSeconds,
    count: number,
    abort: AbortController,
    generation: number,
  ): Promise<void> {
    try {
      const raw = await this.provider.fetchHistorical({
        symbol: request.symbol,
        timeframe: request.timeframe,
        limit: count,
        before,
        signal: abort.signal,
      });
      if (generation !== this.#generation) return;
      if (!Array.isArray(raw)) throw new DataLoadError(`${this.provider.displayName} returned an unexpected response shape.`);

      if (raw.length === 0) return this.#markExhausted();

      const { candles, issues } = normalizeCandles(raw);
      if (candles.length === 0) {
        throw new DataLoadError(`${this.provider.displayName} returned ${raw.length} older candles but none were valid.`, issues);
      }
      const { added } = this.#store.prepend(candles);
      // A provider that ignores `before` would otherwise make us page forever.
      if (added === 0) return this.#markExhausted();

      this.#emit({ type: 'prepend', candles: this.#store.candles, added });
      this.#setState({
        candleCount: this.#store.length,
        issues: [...this.#state.issues, ...issues],
        history: { loadingOlder: false, exhausted: false, error: null },
      });
    } catch (error) {
      if (generation !== this.#generation || abort.signal.aborted) return;
      this.#olderRetryAfter = this.#now() + this.#olderCooldownMs;
      this.#setState({ history: { loadingOlder: false, exhausted: false, error: message(error) } });
    }
  }

  #markExhausted(): void {
    this.#setState({ history: { loadingOlder: false, exhausted: true, error: null } });
  }

  #abortOlder(): void {
    this.#olderAbort?.abort();
    this.#olderAbort = null;
    this.#olderPromise = null;
  }

  /** Applies one poll's records. Throws only when the poll was unusable (so the feed counts a failure). */
  #applyLive(raw: readonly unknown[]): void {
    if (this.#disposed || this.#state.status !== 'ready') return; // history is (re)loading; the next poll catches up
    if (raw.length === 0) return;

    const { candles, issues, droppedCount } = normalizeCandles(raw);
    if (candles.length === 0) {
      this.#setState({ stats: { ...this.#state.stats, rejected: this.#state.stats.rejected + raw.length } });
      throw new DataLoadError(`${this.provider.displayName} sent ${raw.length} live records but none were valid.`, issues);
    }

    const stats = { ...this.#state.stats, rejected: this.#state.stats.rejected + droppedCount };
    let changed = false;
    for (const candle of candles) {
      const outcome = this.#store.applyUpdate(candle);
      switch (outcome.kind) {
        case 'appended':
          stats.appended += 1;
          changed = true;
          this.#emit({ type: 'append', candle: outcome.candle, index: outcome.index });
          break;
        case 'updated':
          stats.updated += 1;
          changed = true;
          this.#emit({ type: 'update', candle: outcome.candle, index: outcome.index });
          break;
        case 'unchanged':
          stats.unchanged += 1;
          break;
        case 'stale':
          stats.stale += 1;
          break;
        case 'rejected':
          stats.rejected += 1;
          break;
      }
    }

    this.#setState({
      stats,
      candleCount: this.#store.length,
      lastCandleTime: this.#store.last?.time ?? null,
      ...(changed ? { lastUpdateAt: this.#now() } : {}),
    });
  }

  #emit(event: MarketDataEvent): void {
    if (!this.#disposed) this.#events.emit(event);
  }

  #setState(patch: Partial<MarketDataState>): void {
    if (this.#disposed) return;
    this.#state = { ...this.#state, ...patch };
    this.#stateChannel.emit(this.#state);
  }
}
