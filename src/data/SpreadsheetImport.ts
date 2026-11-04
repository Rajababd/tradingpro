import type { BackupCandle } from './BackupFormat';
import { DSE_SYMBOLS } from './DSEProvider';

export type ImportedMarketRows = Record<string, BackupCandle[]>;

const SYMBOLS = new Set<string>(DSE_SYMBOLS.map((item) => item.symbol));
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
  if (!SYMBOLS.has(symbol) || !date || open === null || high === null || low === null || close === null ||
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
  addRows(out, records, sheetSymbol && SYMBOLS.has(sheetSymbol) ? sheetSymbol : undefined);
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
async function unzip(buffer: ArrayBuffer): Promise<Map<string, Uint8Array>> {
  const bytes = new Uint8Array(buffer), view = new DataView(buffer);
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65558); i--) {
    if (view.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('ملف XLSX ليس أرشيفاً صالحاً.');
  const count = view.getUint16(eocd + 10, true), central = view.getUint32(eocd + 16, true);
  const files = new Map<string, Uint8Array>();
  let offset = central;
  for (let i = 0; i < count; i++) {
    if (view.getUint32(offset, true) !== 0x02014b50) throw new Error('بنية XLSX غير صالحة.');
    const method = view.getUint16(offset + 10, true), compressed = view.getUint32(offset + 20, true);
    const nameLen = view.getUint16(offset + 28, true), extraLen = view.getUint16(offset + 30, true);
    const commentLen = view.getUint16(offset + 32, true), local = view.getUint32(offset + 42, true);
    const name = new TextDecoder().decode(bytes.slice(offset + 46, offset + 46 + nameLen));
    const localName = view.getUint16(local + 26, true), localExtra = view.getUint16(local + 28, true);
    const start = local + 30 + localName + localExtra;
    const compressedBytes = bytes.slice(start, start + compressed);
    let data: Uint8Array;
    if (method === 0) data = compressedBytes;
    else if (method === 8) {
      const stream = new Blob([compressedBytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
      data = new Uint8Array(await new Response(stream).arrayBuffer());
    } else throw new Error('طريقة ضغط XLSX غير مدعومة.');
    files.set(name, data);
    offset += 46 + nameLen + extraLen + commentLen;
  }
  return files;
}
function xml(files: Map<string, Uint8Array>, path: string): Document {
  const bytes = files.get(path);
  if (!bytes) throw new Error('ملف XLSX لا يحتوي على ' + path);
  const doc = new DOMParser().parseFromString(new TextDecoder().decode(bytes), 'application/xml');
  if (doc.querySelector('parsererror')) throw new Error('تعذر قراءة بنية XML داخل ملف XLSX.');
  return doc;
}
function colIndex(ref: string): number {
  let n = 0;
  for (const c of ref.replace(/[0-9]/g, '')) n = n * 26 + c.charCodeAt(0) - 64;
  return n - 1;
}
async function parseXlsx(buffer: ArrayBuffer): Promise<ImportedMarketRows> {
  const files = await unzip(buffer);
  const workbook = xml(files, 'xl/workbook.xml');
  const rels = xml(files, 'xl/_rels/workbook.xml.rels');
  const targets = new Map([...rels.querySelectorAll('Relationship')].map((r) => [r.getAttribute('Id')!, r.getAttribute('Target')!]));
  const shared = files.has('xl/sharedStrings.xml')
    ? [...xml(files, 'xl/sharedStrings.xml').querySelectorAll('si')].map((si) => [...si.querySelectorAll('t')].map((t) => t.textContent ?? '').join(''))
    : [];
  const out: ImportedMarketRows = {};
  for (const sheet of [...workbook.querySelectorAll('sheets > sheet')]) {
    const name = sheet.getAttribute('name') ?? '';
    const relId = sheet.getAttribute('r:id') ?? '';
    const target = targets.get(relId);
    if (!target) continue;
    const path = target.startsWith('/') ? target.slice(1) : 'xl/' + target.replace(/^\.\//, '');
    const doc = xml(files, path);
    const rows: unknown[][] = [];
    for (const row of [...doc.querySelectorAll('sheetData > row')]) {
      const cells: unknown[] = [];
      for (const cell of [...row.querySelectorAll(':scope > c')]) {
        const index = colIndex(cell.getAttribute('r') ?? 'A1');
        const type = cell.getAttribute('t');
        const v = cell.querySelector('v')?.textContent ?? '';
        let value: unknown = v;
        if (type === 's') value = shared[Number(v)] ?? '';
        else if (type === 'inlineStr') value = cell.querySelector('is t')?.textContent ?? '';
        else if (type === 'b') value = v === '1';
        cells[index] = value;
      }
      rows.push(cells);
    }
    const parsed = parseTabularRows(rows, name);
    for (const [symbol, candles] of Object.entries(parsed)) (out[symbol] ??= []).push(...candles);
  }
  return out;
}
function parseSpreadsheetXml(text: string): ImportedMarketRows {
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  if (doc.querySelector('parsererror')) throw new Error('ملف Excel XML غير صالح.');
  const out: ImportedMarketRows = {};
  for (const sheet of [...doc.getElementsByTagName('Worksheet')]) {
    const name = sheet.getAttribute('ss:Name') ?? '';
    const rows = [...sheet.getElementsByTagName('Row')].map((row) => [...row.getElementsByTagName('Cell')].map((cell) => {
      const data = cell.getElementsByTagName('Data')[0];
      return data?.textContent ?? '';
    }));
    const parsed = parseTabularRows(rows, name);
    for (const [symbol, candles] of Object.entries(parsed)) (out[symbol] ??= []).push(...candles);
  }
  return out;
}
