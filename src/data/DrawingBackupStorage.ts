import type { DrawingJSON } from '../vendor/lightweight-charts-drawing.es.js';
import { drawingStorageKey, loadDrawings, saveDrawings } from '../chart/DrawingStorage';
import type { DrawingBackup } from './BackupFormat';

const PREFIX = 'tradingpro:drawings:';

export function exportDrawingDatabase(storage: Storage): DrawingBackup {
  const drawings: DrawingBackup['drawings'] = [];
  for (let index = 0; index < storage.length; index++) {
    const key = storage.key(index);
    if (!key?.startsWith(PREFIX)) continue;
    const suffix = key.slice(PREFIX.length);
    const separator = suffix.lastIndexOf(':');
    if (separator < 0) continue;
    let symbol: string, timeframe: string;
    try {
      symbol = decodeURIComponent(suffix.slice(0, separator));
      timeframe = decodeURIComponent(suffix.slice(separator + 1));
    } catch { continue; }
    if (!['1D', '1W', '1M'].includes(timeframe)) continue;
    const items = loadDrawings(storage, key);
    if (items === null) continue;
    drawings.push({ symbol, timeframe: timeframe as '1D' | '1W' | '1M', items });
  }
  drawings.sort((a, b) => a.symbol.localeCompare(b.symbol) || a.timeframe.localeCompare(b.timeframe));
  return { format: 'tradingpro-drawings', version: 1, exportedAt: new Date().toISOString(), drawings };
}

export function importDrawingDatabase(storage: Storage, groups: DrawingBackup['drawings']): void {
  // Validate every group before writing any of them.
  for (const group of groups) {
    if (!Array.isArray(group.items)) throw new Error('مجموعة رسومات غير صالحة.');
  }
  for (const group of groups) {
    const ok = saveDrawings(storage, drawingStorageKey(group.symbol, group.timeframe), group.items as readonly DrawingJSON[]);
    if (!ok) throw new Error('تعذر حفظ الرسومات المستوردة في مساحة التخزين المحلية.');
  }
}
