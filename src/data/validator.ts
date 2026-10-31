import type { Candle, UnixSeconds } from '../types/marketData';

export type CandleIssueCode =
  | 'NOT_AN_OBJECT' | 'INVALID_TIME' | 'TIME_IN_MILLISECONDS' | 'INVALID_PRICE'
  | 'INVALID_OHLC_RELATION' | 'INVALID_VOLUME' | 'INVALID_VALUE_TRADED'
  | 'DUPLICATE_TIME' | 'OUT_OF_ORDER';

export interface CandleIssue {
  readonly index: number;
  readonly code: CandleIssueCode;
  readonly message: string;
}
export type CandleValidation =
  | { readonly ok: true; readonly candle: Candle }
  | { readonly ok: false; readonly code: CandleIssueCode; readonly message: string };
export interface NormalizeResult {
  readonly candles: Candle[];
  readonly issues: CandleIssue[];
  readonly droppedCount: number;
}
const MILLISECOND_THRESHOLD = 1e11;
const fail = (code: CandleIssueCode, message: string): CandleValidation => ({ ok: false, code, message });
const isFiniteNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

export function validateCandle(raw: unknown): CandleValidation {
  if (typeof raw !== 'object' || raw === null) return fail('NOT_AN_OBJECT', 'Candle must be an object.');
  const r = raw as Record<string, unknown>;
  const { time, open, high, low, close } = r;
  if (!isFiniteNumber(time) || !Number.isInteger(time) || time <= 0) {
    return fail('INVALID_TIME', 'time must be a positive integer number of seconds since the Unix epoch.');
  }
  if (time > MILLISECOND_THRESHOLD) return fail('TIME_IN_MILLISECONDS', 'time looks like milliseconds; expected seconds since the Unix epoch.');
  if (!isFiniteNumber(open) || !isFiniteNumber(high) || !isFiniteNumber(low) || !isFiniteNumber(close)) {
    return fail('INVALID_PRICE', 'open, high, low and close must all be finite numbers.');
  }
  if (high < low || high < open || high < close || low > open || low > close) {
    return fail('INVALID_OHLC_RELATION', 'high must be >= open, close and low; low must be <= open, close and high.');
  }
  const { volume, valueTraded } = r;
  let normalizedVolume: number | null;
  if (volume === undefined || volume === null) normalizedVolume = null;
  else if (isFiniteNumber(volume) && volume >= 0) normalizedVolume = volume;
  else return fail('INVALID_VOLUME', 'volume must be a finite number >= 0 when present.');
  let normalizedValueTraded: number | null | undefined;
  if (valueTraded === undefined) normalizedValueTraded = undefined;
  else if (valueTraded === null) normalizedValueTraded = null;
  else if (isFiniteNumber(valueTraded) && valueTraded >= 0) normalizedValueTraded = valueTraded;
  else return fail('INVALID_VALUE_TRADED', 'valueTraded must be a finite number >= 0 when present.');
  return {
    ok: true,
    candle: {
      time: time as UnixSeconds, open, high, low, close, volume: normalizedVolume,
      ...(normalizedValueTraded === undefined ? {} : { valueTraded: normalizedValueTraded }),
    },
  };
}

export function normalizeCandles(raw: readonly unknown[]): NormalizeResult {
  const issues: CandleIssue[] = [];
  const byTime = new Map<number, { candle: Candle; index: number }>();
  let previousTime = -Infinity;
  let reportedOutOfOrder = false;
  let droppedCount = 0;
  raw.forEach((item, index) => {
    const result = validateCandle(item);
    if (!result.ok) {
      issues.push({ index, code: result.code, message: result.message });
      droppedCount += 1;
      return;
    }
    const { candle } = result;
    if (candle.time < previousTime && !reportedOutOfOrder) {
      reportedOutOfOrder = true;
      issues.push({ index, code: 'OUT_OF_ORDER', message: 'Input was not in ascending time order and has been sorted.' });
    }
    previousTime = Math.max(previousTime, candle.time);
    const existing = byTime.get(candle.time);
    if (existing) {
      issues.push({
        index: existing.index, code: 'DUPLICATE_TIME',
        message: `Duplicate timestamp ${candle.time}; the later candle (input index ${index}) was kept.`,
      });
      droppedCount += 1;
    }
    byTime.set(candle.time, { candle, index });
  });
  const candles = [...byTime.values()].map((e) => e.candle).sort((a, b) => a.time - b.time);
  return { candles, issues, droppedCount };
}
