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
type DailyRow = { date: string; open: number; high: number; low: number; close: number; volume: number | null; valueTraded: number | null; corrected?: boolean };

const numberOrNull = (value: unknown): number | null => {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value.replace(/,/g, ''));
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
};

const firstNumber = (...values: unknown[]): number | null => {
  for (const value of values) {
    const parsed = numberOrNull(value);
    if (parsed !== null) return parsed;
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
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(`${date}T00:00:00Z`)) || new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) !== date) return null;
  const close = firstNumber(row.close, row.close_val, row.value, row.average_price);
  const open = firstNumber(row.open, row.open_val);
  const high = firstNumber(row.high, row.max_val);
  const low = firstNumber(row.low, row.min_val);
  // Do not fabricate OHLC values from a close-only index point.
  if (open === null || high === null || low === null || close === null) return null;
  if (open <= 0 || high <= 0 || low <= 0 || close <= 0) return null;
  // The DSE endpoint is the sole source of truth. Repair only OHLC relationships
  // using the source's own values; never synthesize a missing price.
  const normalizedHigh = Math.max(high, open, close);
  const normalizedLow = Math.min(low, open, close);
  const corrected = normalizedHigh !== high || normalizedLow !== low;
  const volume = firstNumber(row.volume_traded, row.traded_volume, row.volume);
  const valueTraded = firstNumber(row.value_traded, row.traded_value, row.valueTraded);
  if ((volume !== null && volume < 0) || (valueTraded !== null && valueTraded < 0)) return null;
  return {
    date,
    open,
    high: normalizedHigh,
    low: normalizedLow,
    close,
    volume,
    valueTraded,
    corrected,
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
  /** Non-fatal refresh warning shown when stale cached data is kept after a failed refresh. */
  lastRefreshWarning: string | null = null;
  lastSymbolDataWarning: string | null = null;
  /** In-memory fallback also keeps this provider usable if browser storage is unavailable/full. */
  readonly #memoryCache = new Map<string, DailyRow[]>();

  hasCachedData(symbol: string): boolean {
    getSymbol(symbol);
    return this.#readCachedDaily(symbol) !== null;
  }

  /** Refresh every configured symbol sequentially so later symbol changes can use local history. */
  async refreshAll(): Promise<{ refreshed: string[]; failed: string[] }> {
    const refreshed: string[] = [];
    const failed: string[] = [];
    const qualityWarnings: string[] = [];
    for (const item of DSE_SYMBOLS) {
      try {
        await this.#fetchBars(item.symbol, '1D', undefined, true);
        if (this.lastRefreshWarning !== null) failed.push(item.symbol);
        else refreshed.push(item.symbol);
        if (this.lastSymbolDataWarning !== null) qualityWarnings.push(item.symbol);
      } catch {
        failed.push(item.symbol);
      }
    }
    const warnings: string[] = [];
    if (failed.length > 0) warnings.push(`تعذّر تحديث بعض الرموز (${failed.join(', ')}). ستُستخدم البيانات المحفوظة حيثما توفرت.`);
    if (qualityWarnings.length > 0) warnings.push(`استُبعدت سجلات OHLC غير صالحة من: ${qualityWarnings.join(', ')}.`);
    this.lastRefreshWarning = warnings.length > 0 ? warnings.join(' ') : null;
    return { refreshed, failed };
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
    const memory = this.#memoryCache.get(symbol);
    if (memory && memory.length > 0) return [...memory];
    try {
      const raw = window.localStorage.getItem(this.#cacheKey(symbol));
      if (raw === null) return null;
      const parsed: unknown = JSON.parse(raw);
      if (!Array.isArray(parsed)) return null;
      const rows = parsed.map(parseDailyRow).filter((row): row is DailyRow => row !== null).sort((a, b) => a.date.localeCompare(b.date));
      if (rows.length === 0) return null;
      this.#memoryCache.set(symbol, rows);
      return [...rows];
    } catch {
      return null;
    }
  }

  #writeCachedDaily(symbol: string, rows: readonly DailyRow[]): void {
    const snapshot = [...rows];
    this.#memoryCache.set(symbol, snapshot);
    try {
      window.localStorage.setItem(this.#cacheKey(symbol), JSON.stringify(snapshot));
    } catch {
      // Storage can be disabled or full; in-memory charting should still work.
    }
  }

  async #fetchBars(symbol: string, timeframe: Timeframe, signal?: AbortSignal, refresh = false): Promise<Array<Record<string, unknown>>> {
    getSymbol(symbol);
    if (refresh) this.lastSymbolDataWarning = null;
    const cached = this.#readCachedDaily(symbol);
    if (!refresh && cached !== null) return aggregateDaily(cached, timeframe);
    if (!refresh) throw new Error(`No cached data for ${symbol}. Click «تحديث البيانات» to fetch history.`);
    if (refresh) this.lastRefreshWarning = null;
    try {
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
      const rawRows = rowsFromPayload(payload);
      const daily = rawRows.map(parseDailyRow).filter((row): row is DailyRow => row !== null);
      const rejectedCount = rawRows.length - daily.length;
      const correctedCount = daily.filter((row) => row.corrected === true).length;
      const qualityNotes: string[] = [];
      if (correctedCount > 0) qualityNotes.push(`${correctedCount} شمعة صُحّحت علاقات أسعارها`);
      if (rejectedCount > 0) qualityNotes.push(`${rejectedCount} سجل غير صالح من أصل ${rawRows.length}`);
      this.lastSymbolDataWarning = qualityNotes.length > 0 ? qualityNotes.join('؛ ') : null;
      if (daily.length === 0) {
        throw new Error(`DSE returned no usable OHLC rows for ${symbol}. Check the endpoint schema; close-only rows are not converted into invented candles.`);
      }
      const sortedDaily = daily.sort((a, b) => a.date.localeCompare(b.date));
      // Replace the cache only after a non-empty, parseable response is confirmed.
      this.#writeCachedDaily(symbol, sortedDaily);
      this.lastRefreshWarning = null;
      return aggregateDaily(sortedDaily, timeframe);
    } catch (error) {
      if (signal?.aborted) throw error;
      if (refresh && cached !== null) {
        const detail = error instanceof Error ? error.message : String(error);
        this.lastRefreshWarning = `تعذّر تحديث ${symbol}؛ نعرض البيانات المحفوظة. ${detail}`;
        return aggregateDaily(cached, timeframe);
      }
      throw error;
    }
  }
}
