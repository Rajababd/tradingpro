export type FeedConnection = 'idle' | 'connected' | 'retrying' | 'stopped';

export interface FeedStatus {
  readonly connection: FeedConnection;
  /** Failed attempts in a row; 0 after any success. */
  readonly consecutiveFailures: number;
  /** Clock time (ms) of the last successful poll, or null if none yet. */
  readonly lastSuccessAt: number | null;
  readonly lastError: string | null;
  /** Clock time (ms) the next attempt is due, or null when not scheduled. */
  readonly nextAttemptAt: number | null;
}

export interface FeedHandlers {
  /** Receives each poll's raw records. THROWING marks the attempt as failed (e.g. all records invalid). */
  onRecords(raw: readonly unknown[]): void;
  onStatus(status: FeedStatus): void;
}

/**
 * Transport-agnostic source of live records. A WebSocket transport can implement this
 * later without any change to the chart or the service.
 */
export interface LiveFeed {
  start(handlers: FeedHandlers): void;
  stop(): void;
}

export interface PollingFeedOptions {
  fetch(signal: AbortSignal): Promise<readonly unknown[]>;
  /** Delay between the END of one request and the start of the next. Provider-specific; there is no global default. */
  intervalMs: number;
  /** Ceiling for the failure backoff. Defaults to max(intervalMs, 30s). */
  maxBackoffMs?: number;
  now?: () => number;
}

const message = (e: unknown): string => (e instanceof Error ? e.message : String(e));

const IDLE: FeedStatus = {
  connection: 'idle',
  consecutiveFailures: 0,
  lastSuccessAt: null,
  lastError: null,
  nextAttemptAt: null,
};

/**
 * Polls on a timer.
 *  - The interval runs from the END of each request, so requests can never overlap or pile up.
 *  - A failure backs off exponentially (interval, 2x, 4x ...) up to `maxBackoffMs` and recovers on the first success.
 *  - `stop()` aborts the in-flight request; its late result is ignored and is not counted as a failure.
 */
export class PollingFeed implements LiveFeed {
  #status: FeedStatus = IDLE;
  #handlers: FeedHandlers | null = null;
  #timer: ReturnType<typeof setTimeout> | null = null;
  #abort: AbortController | null = null;
  #generation = 0;
  readonly #now: () => number;
  readonly #maxBackoffMs: number;

  constructor(private readonly options: PollingFeedOptions) {
    if (!Number.isFinite(options.intervalMs) || options.intervalMs <= 0) {
      throw new RangeError('PollingFeed intervalMs must be a positive finite number.');
    }
    this.#now = options.now ?? Date.now;
    this.#maxBackoffMs = Math.max(options.maxBackoffMs ?? 30_000, options.intervalMs);
  }

  get status(): FeedStatus {
    return this.#status;
  }

  get running(): boolean {
    return this.#handlers !== null;
  }

  start(handlers: FeedHandlers): void {
    if (this.#handlers !== null) return; // idempotent
    this.#handlers = handlers;
    this.#generation += 1;
    this.#setStatus(IDLE);
    void this.#poll(this.#generation);
  }

  stop(): void {
    if (this.#handlers === null) return;
    this.#generation += 1; // orphans any in-flight poll
    if (this.#timer !== null) clearTimeout(this.#timer);
    this.#timer = null;
    this.#abort?.abort();
    this.#abort = null;
    this.#setStatus({ ...this.#status, connection: 'stopped', nextAttemptAt: null });
    this.#handlers = null;
  }

  async #poll(generation: number): Promise<void> {
    this.#timer = null;
    const abort = new AbortController();
    this.#abort = abort;

    let failure: unknown = null;
    try {
      const raw = await this.options.fetch(abort.signal);
      if (generation !== this.#generation) return;
      if (!Array.isArray(raw)) throw new Error('Feed returned an unexpected response shape.');
      this.#handlers?.onRecords(raw);
    } catch (error) {
      if (generation !== this.#generation || abort.signal.aborted) return; // cancelled, not failed
      failure = error;
    }
    if (generation !== this.#generation) return;
    this.#abort = null;

    const now = this.#now();
    if (failure === null) {
      const delay = this.options.intervalMs;
      this.#setStatus({
        connection: 'connected',
        consecutiveFailures: 0,
        lastSuccessAt: now,
        lastError: null,
        nextAttemptAt: now + delay,
      });
      this.#schedule(delay, generation);
    } else {
      const failures = this.#status.consecutiveFailures + 1;
      const delay = Math.min(this.#maxBackoffMs, this.options.intervalMs * 2 ** (failures - 1));
      this.#setStatus({
        connection: 'retrying',
        consecutiveFailures: failures,
        lastSuccessAt: this.#status.lastSuccessAt,
        lastError: message(failure),
        nextAttemptAt: now + delay,
      });
      this.#schedule(delay, generation);
    }
  }

  #schedule(delay: number, generation: number): void {
    this.#timer = setTimeout(() => void this.#poll(generation), delay);
  }

  #setStatus(status: FeedStatus): void {
    this.#status = status;
    try {
      this.#handlers?.onStatus(status);
    } catch (error) {
      console.error('PollingFeed onStatus handler threw', error);
    }
  }
}
