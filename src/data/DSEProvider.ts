import type { Timeframe } from '../types/marketData';
import type { HistoricalRequest, LatestRequest, MarketDataProvider } from './MarketDataProvider';

export const DSE_SYMBOLS = [
  { symbol: 'DWX', name: 'Damascus Weighted Index', kind: 'index' },
  { symbol: 'AVOC', name: 'Avoc', kind: 'equity' },
  { symbol: 'ABC', name: 'ABC', kind: 'equity' },
  { symbol: 'BBSY', name: 'BBSY', kind: 'equity' },
  { symbol: 'NIB', name: 'NIB', kind: 'equity' },
  { symbol: 'AHT', name: 'AHT', kind: 'equity' },
] as const;

type DseSymbol = (typeof DSE_SYMBOLS)[number];
type DailyRow = { date: string; open: number; high: number; low: number; close: number; volume: number | null; valueTraded: number | null };

const numberOrNull = (value: unknown): number | null => {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value.replace(/,/g, ''));
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
};

const record = (value: unknown): Record<string, unknown> | null =>
  typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null;

function rowsFromPayload(payload: unknown): unknown[] {
  if (Array.isArray(payload)) return payload;
  const root = record(payload);
  if (!root) throw new Error('DSE returned an unsupported response shape.');
  for (const key of ['data', 'value_and_date', 'values', 'rows']) {
    const value = root[key];
    if (Array.isArray(value)) return value;
    const nested = record(value);
    if (nested) {
      for (const nestedKey of ['value_and_date', 'data', 'values', 'rows']) {
        if (Array.isArray(nested[nestedKey])) return nested[nestedKey] as unknown[];
      }
    }
  }
  throw new Error('DSE response did not contain a historical data array.');
}

function parseDailyRow(raw: unknown): DailyRow | null {
  const row = record(raw);
  if (!row) return null;
  const rawDate = row.date ?? row.trading_date ?? row.timestamp;
  if (typeof rawDate !== 'string' || !/^\d{4}-\d{2}-\d{2}/.test(rawDate)) return null;
  const date = rawDate.slice(0, 10);
  const close = numberOrNull(row.close ?? row.close_val ?? row.value ?? row.average_price);
  const open = numberOrNull(row.open ?? row.open_val);
  const high = numberOrNull(row.high ?? row.max_val);
  const low = numberOrNull(row.low ?? row.min_val);
  // Do not fabricate OHLC values from a close-only index point.
  if (open === null || high === null || low === null || close === null) return null;
  return {
    date,
    open,
    high,
    low,
    close,
    volume: numberOrNull(row.volume_traded ?? row.traded_volume ?? row.volume),
    valueTraded: numberOrNull(row.value_traded ?? row.traded_value ?? row.valueTraded),
  };
}

function dateSeconds(date: string): number {
  return Math.floor(Date.parse(`${date}T00:00:00Z`) / 1000);
}

function periodKey(date: string, timeframe: Timeframe): string {
  const d = new Date(`${date}T00:00:00Z`);
  if (timeframe === '1D') return date;
  if (timeframe === '1M') return `${date.slice(0, 7)}-01`;
  // ISO-like Monday-starting trading week; the candle timestamp remains the first actual session.
  const weekday = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - weekday);
  return d.toISOString().slice(0, 10);
}

function aggregateDaily(rows: readonly DailyRow[], timeframe: Timeframe): Array<Record<string, unknown>> {
  const sorted = [...rows].sort((a, b) => a.date.localeCompare(b.date));
  if (timeframe === '1D') {
    return sorted.map((r) => ({
      time: dateSeconds(r.date), open: r.open, high: r.high, low: r.low, close: r.close,
      volume: r.volume, valueTraded: r.valueTraded,
    }));
  }

  const buckets = new Map<string, { first: DailyRow; last: DailyRow; high: number; low: number; volume: number | null; valueTraded: number | null }>();
  for (const row of sorted) {
    const key = periodKey(row.date, timeframe);
    const existing = buckets.get(key);
    if (!existing) {
      buckets.set(key, { first: row, last: row, high: row.high, low: row.low, volume: row.volume, valueTraded: row.valueTraded });
    } else {
      existing.last = row;
      existing.high = Math.max(existing.high, row.high);
      existing.low = Math.min(existing.low, row.low);
      existing.volume = existing.volume === null || row.volume === null ? null : existing.volume + row.volume;
      existing.valueTraded = existing.valueTraded === null || row.valueTraded === null ? null : existing.valueTraded + row.valueTraded;
    }
  }
  return [...buckets.values()].map((b) => ({
    // Anchor weekly/monthly bars to the first actual trading session, not a weekend/calendar date.
    time: dateSeconds(b.first.date), open: b.first.open, high: b.high, low: b.low, close: b.last.close,
    volume: b.volume, valueTraded: b.valueTraded,
  }));
}

function getSymbol(symbol: string): DseSymbol {
  const found = DSE_SYMBOLS.find((item) => item.symbol === symbol);
  if (!found) throw new Error(`Unsupported DSE symbol "${symbol}".`);
  return found;
}

export class DSEProvider implements MarketDataProvider {
  readonly id = 'dse';
  readonly displayName = 'Damascus Securities Exchange';
  readonly isSimulated = false;

  hasCachedData(symbol: string): boolean {
    getSymbol(symbol);
    return this.#readCachedDaily(symbol) !== null;
  }

  async fetchHistorical(request: HistoricalRequest): Promise<unknown[]> {
    const bars = await this.#fetchBars(request.symbol, request.timeframe, request.signal, request.refresh === true);
    const filtered = request.before === undefined ? bars : bars.filter((bar) => Number(bar.time) < request.before!);
    if (request.limit === undefined) return filtered;
    if (request.limit <= 0) return [];
    return filtered.slice(-request.limit);
  }

  async fetchLatest(request: LatestRequest): Promise<unknown[]> {
    const bars = await this.#fetchBars(request.symbol, request.timeframe, request.signal, false);
    return bars.slice(-1);
  }

  #cacheKey(symbol: string): string {
    return `tradingpro:dse:daily:v1:${symbol}`;
  }

  #readCachedDaily(symbol: string): DailyRow[] | null {
    try {
      const raw = window.localStorage.getItem(this.#cacheKey(symbol));
      if (raw === null) return null;
      const parsed: unknown = JSON.parse(raw);
      if (!Array.isArray(parsed)) return null;
      const rows = parsed.map(parseDailyRow).filter((row): row is DailyRow => row !== null);
      return rows.length > 0 ? rows.sort((a, b) => a.date.localeCompare(b.date)) : null;
    } catch {
      return null;
    }
  }

  #writeCachedDaily(symbol: string, rows: readonly DailyRow[]): void {
    try {
      window.localStorage.setItem(this.#cacheKey(symbol), JSON.stringify(rows));
    } catch {
      // Storage can be disabled or full; in-memory charting should still work.
    }
  }

  async #fetchBars(symbol: string, timeframe: Timeframe, signal?: AbortSignal, refresh = false): Promise<Array<Record<string, unknown>>> {
    getSymbol(symbol);
    const cached = this.#readCachedDaily(symbol);
    if (!refresh && cached !== null) return aggregateDaily(cached, timeframe);
    if (!refresh) throw new Error(`No cached data for ${symbol}. Click «تحديث البيانات» to fetch history.`);
    const configuredBase = (import.meta as unknown as { env?: { VITE_DSE_API_BASE_URL?: string } }).env?.VITE_DSE_API_BASE_URL?.trim();
    const apiBase = configuredBase || '/api/market-data';
    const separator = apiBase.includes('?') ? '&' : '?';
    const endpoint = `${apiBase}${separator}symbol=${encodeURIComponent(symbol)}`;
    let response: Response;
    try {
      response = await fetch(endpoint, { method: 'GET', headers: { Accept: 'application/json' }, ...(signal === undefined ? {} : { signal }) });
    } catch (error) {
      if (signal?.aborted) throw error;
      throw new Error(`Cannot reach the TradingPro market-data API for ${symbol}. Check that the proxy backend is running and VITE_DSE_API_BASE_URL is configured for deployment.`);
    }
    if (!response.ok) {
      let detail = '';
      try { detail = (await response.text()).slice(0, 180); } catch { /* response body may be unavailable */ }
      throw new Error(`Market-data API request for ${symbol} failed with HTTP ${response.status}${detail ? `: ${detail}` : ''}.`);
    }
    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw new Error(`DSE returned non-JSON data for ${symbol}.`);
    }
    const daily = rowsFromPayload(payload).map(parseDailyRow).filter((row): row is DailyRow => row !== null);
    if (daily.length === 0) {
      throw new Error(`DSE returned no usable OHLC rows for ${symbol}. Check the endpoint schema; close-only rows are not converted into invented candles.`);
    }
    const sortedDaily = daily.sort((a, b) => a.date.localeCompare(b.date));
    // Commit to cache only after a non-empty, parseable history response is confirmed.
    this.#writeCachedDaily(symbol, sortedDaily);
    return aggregateDaily(sortedDaily, timeframe);
  }
}
