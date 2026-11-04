import type { DrawingJSON } from '../vendor/lightweight-charts-drawing.es.js';
import { DSE_SYMBOLS } from './DSEProvider';

export const BACKUP_VERSION = 1 as const;
export type BackupCandle = {
  date: string; open: number; high: number; low: number; close: number;
  volume: number | null; valueTraded: number | null;
};
export type MarketDatabaseBackup = {
  format: 'tradingpro-market-database'; version: typeof BACKUP_VERSION;
  exportedAt: string; symbols: Record<string, BackupCandle[]>;
};
export type DrawingBackup = {
  format: 'tradingpro-drawings'; version: typeof BACKUP_VERSION;
  exportedAt: string;
  drawings: Array<{ symbol: string; timeframe: '1D' | '1W' | '1M'; items: DrawingJSON[] }>;
};

const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const validDate = (value: unknown): value is string =>
  typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) &&
  Number.isFinite(Date.parse(value + 'T00:00:00Z')) &&
  new Date(value + 'T00:00:00Z').toISOString().slice(0, 10) === value;

export function validateBackupCandle(value: unknown): BackupCandle | null {
  if (!record(value) || !validDate(value.date) ||
      !finite(value.open) || !finite(value.high) || !finite(value.low) || !finite(value.close) ||
      value.open <= 0 || value.high <= 0 || value.low <= 0 || value.close <= 0 ||
      value.high < Math.max(value.open, value.close, value.low) ||
      value.low > Math.min(value.open, value.close, value.high) ||
      !(value.volume === null || (finite(value.volume) && value.volume >= 0)) ||
      !(value.valueTraded === null || (finite(value.valueTraded) && value.valueTraded >= 0))) return null;
  return { date: value.date, open: value.open, high: value.high, low: value.low, close: value.close,
    volume: value.volume, valueTraded: value.valueTraded };
}

export function validateMarketDatabase(value: unknown): MarketDatabaseBackup {
  if (!record(value) || value.format !== 'tradingpro-market-database' || value.version !== BACKUP_VERSION ||
      !record(value.symbols)) throw new Error('ملف قاعدة البيانات ليس نسخة TradingPro صالحة.');
  const symbols: Record<string, BackupCandle[]> = {};
  for (const symbol of DSE_SYMBOLS.map((item) => item.symbol)) {
    const rows = value.symbols[symbol];
    if (rows === undefined) continue;
    if (!Array.isArray(rows)) throw new Error(`بيانات الرمز ${symbol} غير صالحة.`);
    const parsed = rows.map(validateBackupCandle);
    if (parsed.some((row) => row === null)) throw new Error(`توجد شموع غير صالحة في بيانات ${symbol}.`);
    const seen = new Set<string>();
    for (const row of parsed as BackupCandle[]) {
      if (seen.has(row.date)) throw new Error(`تاريخ مكرر في ملف ${symbol}: ${row.date}`);
      seen.add(row.date);
    }
    symbols[symbol] = (parsed as BackupCandle[]).sort((a, b) => a.date.localeCompare(b.date));
  }
  const candleCount = Object.values(symbols).reduce((total, rows) => total + rows.length, 0);
  if (Object.keys(symbols).length === 0 || candleCount === 0) {
    throw new Error('لا يحتوي الملف على شموع صالحة لأي سهم معروف؛ لم يتم استبدال قاعدة البيانات الحالية.');
  }
  return { format: 'tradingpro-market-database', version: BACKUP_VERSION,
    exportedAt: typeof value.exportedAt === 'string' ? value.exportedAt : new Date().toISOString(), symbols };
}

export function validateDrawingBackup(value: unknown): DrawingBackup {
  if (!record(value) || value.format !== 'tradingpro-drawings' || value.version !== BACKUP_VERSION ||
      !Array.isArray(value.drawings)) throw new Error('ملف الرسومات ليس نسخة TradingPro صالحة.');
  const allowed = new Set<string>(DSE_SYMBOLS.map((item) => item.symbol));
  const groups: DrawingBackup['drawings'] = [];
  const seen = new Set<string>();
  for (const group of value.drawings) {
    if (!record(group) || typeof group.symbol !== 'string' || !allowed.has(group.symbol) ||
        !['1D', '1W', '1M'].includes(String(group.timeframe)) || !Array.isArray(group.items)) {
      throw new Error('توجد مجموعة رسومات غير صالحة في الملف.');
    }
    const key = group.symbol + ':' + group.timeframe;
    if (seen.has(key)) throw new Error('توجد مجموعة رسومات مكررة في الملف.');
    seen.add(key);
    // Reuse the strict local drawing validator to ensure imports match the drawing engine schema.
    const items = validateDrawingItems(group.items);
    groups.push({ symbol: group.symbol, timeframe: group.timeframe as '1D' | '1W' | '1M', items });
  }
  return { format: 'tradingpro-drawings', version: BACKUP_VERSION,
    exportedAt: typeof value.exportedAt === 'string' ? value.exportedAt : new Date().toISOString(), drawings: groups };
}

function validateDrawingItems(value: unknown[]): DrawingJSON[] {
  const ids = new Set<string>();
  for (const item of value) {
    if (!record(item) || typeof item.id !== 'string' || !item.id ||
        typeof item.type !== 'string' || !Number.isInteger(item.paneIndex) || (item.paneIndex as number) < 0 ||
        !Array.isArray(item.anchors) || item.anchors.some((anchor) => !record(anchor) ||
          !(typeof anchor.time === 'string' || finite(anchor.time)) || !finite(anchor.price) ||
          (anchor.logical !== undefined && !finite(anchor.logical))) ||
        (item.seriesId !== undefined && typeof item.seriesId !== 'string') ||
        (item.style !== undefined && !record(item.style)) || (item.options !== undefined && !record(item.options))) {
      throw new Error('يحتوي ملف الرسومات على رسم غير صالح.');
    }
    if (ids.has(item.id)) throw new Error('توجد معرفات رسومات مكررة ضمن المجموعة نفسها.');
    ids.add(item.id);
  }
  return value as DrawingJSON[];
}
