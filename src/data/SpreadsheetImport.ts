import type { BackupCandle } from './BackupFormat';
import { DSE_SYMBOLS } from './DSEProvider';
import * as XLSX from 'xlsx';

export type ImportedMarketRows = Record<string, BackupCandle[]>;

const isKnownSymbol = (value: string): boolean => DSE_SYMBOLS.some((item) => item.symbol === value);
const aliases: Record<string, string[]> = {
  symbol: ['symbol', 'ticker', 'code', 'الرمز', 'السهم'],
  date: ['date', 'tradingdate', 'trading_date', 'timestamp', 'التاريخ', 'تاريخ'],
  open: ['open', 'openprice', 'open_val', 'الافتتاح', 'سعرالافتتاح'],
  high: ['high', 'max', 'max_val', 'الاعلى', 'أعلى', 'اعلى'],
  low: ['low', 'min', 'min_val', 'الادنى', 'أدنى', 'ادنى'],
  close: ['close', 'closeprice', 'close_val', 'السعر', 'الاغلاق', 'الإغلاق'],
  volume: ['volume', 'volume_traded', 'traded_volume', 'الحجم', 'الكمية'],
  valueTraded: ['valuetraded', 'value_traded', 'traded_value', 'turnover', 'قيمةالتداول'],
};
const norm = (value: unknown) => String(value ?? '').trim().toLowerCase().replace(/[\s_\-]/g, '');
const fieldFor = (value: unknown) => Object.entries(aliases).find(([, names]) => names.some((name) => norm(name) === norm(value)))?.[0];

function excelDate(value: unknown): string | null {
  if (value instanceof Date && Number.isFinite(value.getTime())) {
    return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate())).toISOString().slice(0, 10);
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    const d = new Date(Date.UTC(1899, 11, 30) + Math.floor(value) * 86400000);
    return d.toISOString().slice(0, 10);
  }
  if (typeof value === 'string') {
    const s = value.trim();
    if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
    const m = s.match(/^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{4})$/);
    if (m) return new Date(Date.UTC(Number(m[3]), Number(m[2]) - 1, Number(m[1]))).toISOString().slice(0, 10);
  }
  return null;
}
function number(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const n = Number(value.replace(/,/g, '').trim());
    return Number.isFinite(n) ? n : null;
  }
  return null;
}
function normalizeRow(row: Record<string, unknown>, symbol: string): BackupCandle | null {
  const date = excelDate(row.date);
  const open = number(row.open), high = number(row.high), low = number(row.low), close = number(row.close);
  const volume = row.volume === undefined || row.volume === '' ? null : number(row.volume);
  const valueTraded = row.valueTraded === undefined || row.valueTraded === '' ? null : number(row.valueTraded);
  if (!isKnownSymbol(symbol) || !date || open === null || high === null || low === null || close === null ||
      open <= 0 || high <= 0 || low <= 0 || close <= 0 ||
      (volume !== null && volume < 0) || (valueTraded !== null && valueTraded < 0)) return null;
  return { date, open, high: Math.max(high, open, close), low: Math.min(low, open, close),
    close, volume, valueTraded };
}
function addRows(out: ImportedMarketRows, rows: Record<string, unknown>[], sheetSymbol?: string) {
  if (!rows.length) return;
  const first = rows[0]!;
  const columns: Record<string, string> = {};
  for (const key of Object.keys(first)) {
    const field = fieldFor(key);
    if (field) columns[field] = key;
  }
  for (const raw of rows) {
    const row: Record<string, unknown> = {};
    for (const [field, key] of Object.entries(columns)) row[field] = raw[key];
    const symbol = String(row.symbol ?? sheetSymbol ?? '').trim().toUpperCase();
    const candle = normalizeRow(row, symbol);
    if (!candle) continue;
    (out[symbol] ??= []).push(candle);
  }
}
export function parseTabularRows(rows: unknown[][], sheetName?: string): ImportedMarketRows {
  if (rows.length < 2) return {};
  const headers = rows[0]!.map((value) => String(value ?? '').trim());
  const records = rows.slice(1).map((cells) => Object.fromEntries(headers.map((header, index) => [header, cells[index]])));
  const sheetSymbol = sheetName?.toUpperCase();
  const out: ImportedMarketRows = {};
  addRows(out, records, sheetSymbol && isKnownSymbol(sheetSymbol) ? sheetSymbol : undefined);
  return out;
}
export async function parseSpreadsheet(file: File): Promise<ImportedMarketRows> {
  const extension = file.name.toLowerCase().split('.').pop();
  if (extension === 'csv' || extension === 'tsv' || extension === 'txt') {
    const text = await file.text();
    const delimiter = extension === 'tsv' ? '\t' : (text.split('\n', 1)[0]?.includes(';') ? ';' : ',');
    return parseTabularRows(parseDelimited(text, delimiter));
  }
  if (extension === 'xlsx' || extension === 'xlsm') return parseXlsx(await file.arrayBuffer());
  if (extension === 'xls' || extension === 'xml') {
    const text = await file.text();
    if (text.trimStart().startsWith('<')) return parseSpreadsheetXml(text);
    throw new Error('ملفات Excel الثنائية القديمة بصيغة .xls غير مدعومة حالياً. افتح الملف في Excel واحفظه بصيغة .xlsx أو CSV.');
  }
  throw new Error('صيغة الملف غير مدعومة. استخدم JSON أو XLSX أو XLS أو CSV.');
}
function parseDelimited(text: string, delimiter: string): unknown[][] {
  const rows: unknown[][] = [];
  let row: string[] = [], cell = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (ch === '"') {
      if (quoted && text[i + 1] === '"') { cell += '"'; i++; }
      else quoted = !quoted;
    } else if (ch === delimiter && !quoted) { row.push(cell); cell = ''; }
    else if ((ch === '\n' || ch === '\r') && !quoted) {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); if (row.some((v) => v.trim())) rows.push(row);
      row = []; cell = '';
    } else cell += ch;
  }
  row.push(cell); if (row.some((v) => v.trim())) rows.push(row);
  return rows;
}
export function parseWorkbookBuffer(buffer: ArrayBuffer): ImportedMarketRows {
  let workbook: XLSX.WorkBook;
  try {
    workbook = XLSX.read(buffer, { type: 'array', cellDates: true, raw: true });
  } catch {
    throw new Error('تعذر قراءة ملف Excel. تأكد أن الملف غير تالف ومحفوظ بصيغة مدعومة.');
  }
  const out: ImportedMarketRows = {};
  for (const name of workbook.SheetNames) {
    const sheet = workbook.Sheets[name];
    if (!sheet) continue;
    const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: true, defval: '' });
    const parsed = parseTabularRows(rows, name);
    for (const [symbol, candles] of Object.entries(parsed)) (out[symbol] ??= []).push(...candles);
  }
  return out;
}

export async function parseSpreadsheet(file: File): Promise<ImportedMarketRows> {
  const extension = file.name.toLowerCase().split('.').pop();
  if (extension === 'csv' || extension === 'tsv' || extension === 'txt') {
    const text = await file.text();
    const delimiter = extension === 'tsv' ? '\\t' : (text.split('\\n', 1)[0]?.includes(';') ? ';' : ',');
    return parseTabularRows(parseDelimited(text, delimiter));
  }
  if (['xlsx', 'xlsm', 'xls', 'xlsb'].includes(extension ?? '')) {
    return parseWorkbookBuffer(await file.arrayBuffer());
  }
  if (extension === 'xml') {
    const text = await file.text();
    const workbook = XLSX.read(text, { type: 'string', cellDates: true, raw: true });
    const out: ImportedMarketRows = {};
    for (const name of workbook.SheetNames) {
      const sheet = workbook.Sheets[name];
      if (!sheet) continue;
      const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: true, defval: '' });
      const parsed = parseTabularRows(rows, name);
      for (const [symbol, candles] of Object.entries(parsed)) (out[symbol] ??= []).push(...candles);
    }
    return out;
  }
  throw new Error('صيغة الملف غير مدعومة. استخدم JSON أو XLS/XLSX/XLSM أو CSV.');
}
