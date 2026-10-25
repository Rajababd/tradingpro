import type { HistoricalRequest, LatestRequest, MarketDataProvider } from './MarketDataProvider';

/** Deterministic PRNG (mulberry32) so fixtures are reproducible in tests. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const round2 = (n: number): number => Math.round(n * 100) / 100;

const DAY_SECONDS = 86_400;
/** 2024-01-01T00:00:00Z, a Monday. */
const START_TIME = 1_704_067_200;

export const DEFAULT_FIXTURE_SEED = 42;
export const DEFAULT_FIXTURE_BARS = 500;

/** A raw wire-style record, deliberately NOT a branded `Candle`. */
export interface FixtureRecord {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

/**
 * SIMULATED daily bars (weekdays only) from a seeded random walk.
 * These are NOT real market prices and must never be presented as such.
 */
export function generateFixtureCandles(
  count: number,
  seed: number = DEFAULT_FIXTURE_SEED,
): FixtureRecord[] {
  const rand = mulberry32(seed);
  const bars: FixtureRecord[] = [];
  let price = 100;
  let time = START_TIME;

  while (bars.length < count) {
    const weekday = new Date(time * 1000).getUTCDay();
    if (weekday !== 0 && weekday !== 6) {
      const open = round2(price);
      const close = round2(Math.max(1, open * (1 + (rand() - 0.5) * 0.04)));
      // Wicks extend outward from the body, so high >= body >= low always holds.
      const high = round2(Math.max(open, close) * (1 + rand() * 0.01));
      const low = round2(Math.min(open, close) * (1 - rand() * 0.01));
      const volume = Math.round(100_000 + rand() * 900_000);
      bars.push({ time, open, high, low, close, volume });
      price = close;
    }
    time += DAY_SECONDS;
  }
  return bars;
}

/** Every Nth simulated poll opens a new bar; the polls in between move the current one. */
export const FIXTURE_TICKS_PER_BAR = 5;

const abortError = () => new DOMException('The request was aborted.', 'AbortError');

/**
 * Development/test provider. `isSimulated` is true and the UI shows a permanent
 * "SIMULATED DATA" badge whenever it is active.
 *
 * History and live polling share one in-memory series, so reloading history after some
 * simulated ticks returns the same bars the live feed produced. The live part is a
 * seeded random walk too: deterministic for a given seed and call count.
 */
export class FixtureProvider implements MarketDataProvider {
  readonly id = 'fixture';
  readonly displayName = 'Simulated fixture';
  readonly isSimulated = true;

  #bars: FixtureRecord[] | null = null;
  #ticks = 0;
  readonly #liveRand: () => number;

  constructor(
    private readonly seed: number = DEFAULT_FIXTURE_SEED,
    private readonly barCount: number = DEFAULT_FIXTURE_BARS,
  ) {
    this.#liveRand = mulberry32((seed ^ 0x9e3779b9) >>> 0);
  }

  async fetchHistorical(request: HistoricalRequest): Promise<unknown[]> {
    if (request.signal?.aborted) throw abortError();
    let bars = this.#series();
    if (request.before !== undefined) {
      const before = request.before as number;
      bars = bars.filter((b) => b.time < before);
    }
    // Take the most recent `limit` of what remains, so a candle's identity never depends on the limit.
    if (request.limit !== undefined) bars = request.limit <= 0 ? [] : bars.slice(-request.limit);
    return bars.map((b) => ({ ...b })); // copies: callers must not be able to mutate provider state
  }

  /** Simulated "live" tick: moves the current bar, or every few calls opens the next weekday's bar. */
  async fetchLatest(request: LatestRequest): Promise<unknown[]> {
    if (request.signal?.aborted) throw abortError();
    const bars = this.#series();
    const last = bars[bars.length - 1]!;
    this.#ticks += 1;
    const rand = this.#liveRand;

    if (this.#ticks % FIXTURE_TICKS_PER_BAR === 0) {
      let time = last.time + DAY_SECONDS;
      while ([0, 6].includes(new Date(time * 1000).getUTCDay())) time += DAY_SECONDS;
      const open = last.close;
      const close = round2(Math.max(1, open * (1 + (rand() - 0.5) * 0.01)));
      const next: FixtureRecord = {
        time,
        open,
        high: round2(Math.max(open, close)),
        low: round2(Math.min(open, close)),
        close,
        volume: Math.round(10_000 + rand() * 90_000),
      };
      bars.push(next);
      // A rollover resends the bar that just closed (unchanged) next to the new one, like many real feeds do.
      return [{ ...last }, { ...next }];
    }

    const close = round2(Math.max(1, last.close * (1 + (rand() - 0.5) * 0.006)));
    last.close = close;
    last.high = round2(Math.max(last.high, close));
    last.low = round2(Math.min(last.low, close));
    last.volume += Math.round(1_000 + rand() * 9_000);
    return [{ ...last }];
  }

  #series(): FixtureRecord[] {
    this.#bars ??= generateFixtureCandles(this.barCount, this.seed);
    return this.#bars;
  }
}
