import type { Candle, UnixSeconds } from '../types/marketData';
import { validateCandle, type CandleIssueCode } from './validator';

/**
 * What happened when a candle was applied to the store.
 *  - appended:  newer than the latest candle; added at the end (gaps are allowed: weekends, halts).
 *  - updated:   same time as the latest candle with different values; the latest candle was replaced.
 *  - unchanged: same time and identical values (a harmless re-send); nothing changed.
 *  - stale:     older than the latest candle; NOT applied. The live path never rewrites closed bars;
 *               a correction to history needs a reload.
 *  - rejected:  failed validation (raw input only); NOT applied.
 */
export type UpdateOutcome =
  | { readonly kind: 'appended' | 'updated'; readonly candle: Candle; readonly index: number }
  | { readonly kind: 'unchanged'; readonly candle: Candle; readonly index: number }
  | { readonly kind: 'stale'; readonly candle: Candle; readonly latestTime: UnixSeconds }
  | { readonly kind: 'rejected'; readonly code: CandleIssueCode; readonly message: string };

export interface PrependResult {
  readonly added: number;
  /** Older-page candles dropped because they were not strictly earlier than the existing first candle. */
  readonly overlapDropped: number;
}

const sameValues = (a: Candle, b: Candle): boolean =>
  a.open === b.open && a.high === b.high && a.low === b.low && a.close === b.close && a.volume === b.volume;

function assertStrictlyAscending(candles: readonly Candle[], what: string): void {
  for (let i = 1; i < candles.length; i++) {
    if (candles[i]!.time <= candles[i - 1]!.time) {
      throw new Error(`${what} must be strictly ascending by time (index ${i}); normalize it first.`);
    }
  }
}

/**
 * The single in-memory candle series. Pure data logic with no chart or network knowledge,
 * so every rule below is unit-testable. Invariant: strictly ascending times, no duplicates.
 *
 * `candles` is a live read-only view: it reflects later appends/updates. Take a copy if a
 * stable snapshot is needed. `revision` increments on every real change.
 */
export class CandleStore {
  #candles: Candle[] = [];
  #revision = 0;

  get candles(): readonly Candle[] {
    return this.#candles;
  }

  get length(): number {
    return this.#candles.length;
  }

  get first(): Candle | undefined {
    return this.#candles[0];
  }

  get last(): Candle | undefined {
    return this.#candles[this.#candles.length - 1];
  }

  get revision(): number {
    return this.#revision;
  }

  /** Replaces everything. Input must already be normalized (strictly ascending). */
  reset(candles: readonly Candle[]): void {
    assertStrictlyAscending(candles, 'reset input');
    this.#candles = [...candles];
    this.#revision += 1;
  }

  /** Validates a raw record, then applies it. Invalid input never touches the store. */
  applyRaw(raw: unknown): UpdateOutcome {
    const result = validateCandle(raw);
    if (!result.ok) return { kind: 'rejected', code: result.code, message: result.message };
    return this.applyUpdate(result.candle);
  }

  /** Applies an already-validated candle to the live end of the series. */
  applyUpdate(candle: Candle): UpdateOutcome {
    const last = this.last;
    if (last === undefined || candle.time > last.time) {
      this.#candles.push(candle);
      this.#revision += 1;
      return { kind: 'appended', candle, index: this.#candles.length - 1 };
    }
    if (candle.time < last.time) {
      return { kind: 'stale', candle, latestTime: last.time };
    }
    const index = this.#candles.length - 1;
    if (sameValues(last, candle)) return { kind: 'unchanged', candle: last, index };
    this.#candles[index] = candle;
    this.#revision += 1;
    return { kind: 'updated', candle, index };
  }

  /**
   * Adds an OLDER page in front. Existing data wins on overlap: any page candle that is
   * not strictly earlier than the current first candle is dropped and counted.
   * Logical indices of every existing candle shift by `added`.
   */
  prepend(older: readonly Candle[]): PrependResult {
    assertStrictlyAscending(older, 'older page');
    const firstTime = this.first?.time;
    const kept = firstTime === undefined ? older : older.filter((c) => c.time < firstTime);
    if (kept.length > 0) {
      this.#candles = [...kept, ...this.#candles];
      this.#revision += 1;
    }
    return { added: kept.length, overlapDropped: older.length - kept.length };
  }
}
