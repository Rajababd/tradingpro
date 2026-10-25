import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PollingFeed, type FeedStatus } from '../src/data/PollingFeed';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

function setup(fetchImpl: (signal: AbortSignal, call: number) => Promise<readonly unknown[]>, intervalMs = 1000, maxBackoffMs?: number) {
  let calls = 0;
  const signals: AbortSignal[] = [];
  const fetch = vi.fn((signal: AbortSignal) => {
    signals.push(signal);
    return fetchImpl(signal, ++calls);
  });
  const feed = new PollingFeed({ fetch, intervalMs, ...(maxBackoffMs !== undefined ? { maxBackoffMs } : {}), now: () => Date.now() });
  const records: (readonly unknown[])[] = [];
  const statuses: FeedStatus[] = [];
  const onRecords = vi.fn((r: readonly unknown[]) => void records.push(r));
  const start = () => feed.start({ onRecords, onStatus: (s) => statuses.push(s) });
  return { feed, fetch, records, statuses, onRecords, start, signals };
}

describe('PollingFeed: polling', () => {
  it('polls immediately, then every interval after each completion', async () => {
    const t = setup(async (_s, n) => [n]);
    t.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(t.fetch).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(999);
    expect(t.fetch).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(t.fetch).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(3000);
    expect(t.fetch).toHaveBeenCalledTimes(5);
    expect(t.records).toEqual([[1], [2], [3], [4], [5]]);
  });

  it('never overlaps requests: a slow request delays the next poll instead of stacking another', async () => {
    let release!: () => void;
    const t = setup((_s, n) => (n === 1 ? new Promise((r) => (release = () => r([1]))) : Promise.resolve([n])));
    t.start();
    await vi.advanceTimersByTimeAsync(3500); // 3.5 intervals while request 1 is still pending
    expect(t.fetch).toHaveBeenCalledTimes(1);
    release();
    await vi.advanceTimersByTimeAsync(0);
    expect(t.fetch).toHaveBeenCalledTimes(1); // the next poll is a full interval after completion
    await vi.advanceTimersByTimeAsync(1000);
    expect(t.fetch).toHaveBeenCalledTimes(2);
  });

  it('start is idempotent', async () => {
    const t = setup(async () => []);
    t.start();
    t.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(t.fetch).toHaveBeenCalledTimes(1);
  });

  it('reports connected with lastSuccessAt and the next due time', async () => {
    const t = setup(async () => []);
    t.start();
    await vi.advanceTimersByTimeAsync(0);
    const s = t.feed.status;
    expect(s.connection).toBe('connected');
    expect(s.consecutiveFailures).toBe(0);
    expect(s.lastSuccessAt).toBe(Date.now());
    expect(s.nextAttemptAt).toBe(Date.now() + 1000);
  });

  it('rejects an invalid interval', () => {
    for (const bad of [0, -5, Number.NaN, Infinity]) {
      expect(() => new PollingFeed({ fetch: async () => [], intervalMs: bad })).toThrow(RangeError);
    }
  });
});

describe('PollingFeed: failure and recovery (Scenario I)', () => {
  it('backs off exponentially, caps at the ceiling, and recovers on the first success', async () => {
    const outcome = ['fail', 'fail', 'fail', 'fail', 'ok'];
    const t = setup(async (_s, n) => {
      if (outcome[n - 1] === 'fail') throw new Error(`down ${n}`);
      return [n];
    }, 1000, 3000);
    t.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(t.feed.status).toMatchObject({ connection: 'retrying', consecutiveFailures: 1, lastError: 'down 1' });
    expect(t.feed.status.nextAttemptAt).toBe(Date.now() + 1000);

    await vi.advanceTimersByTimeAsync(1000); // attempt 2 fails
    expect(t.feed.status.consecutiveFailures).toBe(2);
    expect(t.feed.status.nextAttemptAt).toBe(Date.now() + 2000);

    await vi.advanceTimersByTimeAsync(2000); // attempt 3 fails: 4000 would exceed the 3000 ceiling
    expect(t.feed.status.consecutiveFailures).toBe(3);
    expect(t.feed.status.nextAttemptAt).toBe(Date.now() + 3000);

    await vi.advanceTimersByTimeAsync(3000); // attempt 4 fails, still capped
    expect(t.feed.status.nextAttemptAt).toBe(Date.now() + 3000);

    await vi.advanceTimersByTimeAsync(3000); // attempt 5 succeeds
    expect(t.feed.status).toMatchObject({ connection: 'connected', consecutiveFailures: 0, lastError: null });
    expect(t.records).toEqual([[5]]);
    expect(t.feed.status.nextAttemptAt).toBe(Date.now() + 1000); // back to the normal interval
  });

  it('keeps the last good timestamp while retrying', async () => {
    const t = setup(async (_s, n) => {
      if (n === 1) return [];
      throw new Error('x');
    });
    t.start();
    await vi.advanceTimersByTimeAsync(0);
    const good = t.feed.status.lastSuccessAt;
    await vi.advanceTimersByTimeAsync(1000);
    expect(t.feed.status.connection).toBe('retrying');
    expect(t.feed.status.lastSuccessAt).toBe(good);
  });

  it('treats a throwing onRecords (e.g. all records invalid) as a failed attempt', async () => {
    const t = setup(async () => [1]);
    t.onRecords.mockImplementation(() => {
      throw new Error('none of the records were valid');
    });
    t.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(t.feed.status).toMatchObject({ connection: 'retrying', lastError: 'none of the records were valid' });
  });

  it('treats a non-array response as a failed attempt', async () => {
    const t = setup(async () => ({ oops: true }) as unknown as unknown[]);
    t.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(t.feed.status.connection).toBe('retrying');
    expect(t.onRecords).not.toHaveBeenCalled();
  });
});

describe('PollingFeed: stop', () => {
  it('aborts the in-flight request, ignores its late result, and schedules nothing more', async () => {
    let finish!: (v: unknown[]) => void;
    const t = setup(() => new Promise((r) => (finish = r)));
    t.start();
    await vi.advanceTimersByTimeAsync(0);
    t.feed.stop();
    expect(t.signals[0]!.aborted).toBe(true);
    finish([1]);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(t.onRecords).not.toHaveBeenCalled();
    expect(t.fetch).toHaveBeenCalledTimes(1);
    expect(t.feed.status.connection).toBe('stopped');
  });

  it('an abort error caused by stop is not counted as a failure', async () => {
    const t = setup((signal) => new Promise((_r, reject) => signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))));
    t.start();
    await vi.advanceTimersByTimeAsync(0);
    t.feed.stop();
    await vi.advanceTimersByTimeAsync(5000);
    expect(t.feed.status.consecutiveFailures).toBe(0);
    expect(t.feed.status.connection).toBe('stopped');
  });

  it('stop cancels a pending retry timer', async () => {
    const t = setup(async () => {
      throw new Error('down');
    });
    t.start();
    await vi.advanceTimersByTimeAsync(0);
    t.feed.stop();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(t.fetch).toHaveBeenCalledTimes(1);
  });

  it('stop is safe when never started or already stopped, and the feed can restart cleanly', async () => {
    const t = setup(async (_s, n) => [n]);
    t.feed.stop();
    t.start();
    await vi.advanceTimersByTimeAsync(0);
    t.feed.stop();
    t.feed.stop();
    t.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(t.feed.status).toMatchObject({ connection: 'connected', consecutiveFailures: 0 });
    expect(t.fetch).toHaveBeenCalledTimes(2);
  });

  it('emits a status for each change, ending in stopped', async () => {
    const t = setup(async () => []);
    t.start();
    await vi.advanceTimersByTimeAsync(0);
    t.feed.stop();
    expect(t.statuses.map((s) => s.connection)).toEqual(['idle', 'connected', 'stopped']);
  });
});
