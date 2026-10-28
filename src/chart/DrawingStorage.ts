import type { DrawingJSON } from '../vendor/lightweight-charts-drawing.es.js';

const STORAGE_VERSION = 1;
const KEY_PREFIX = 'tradingpro:drawings';

interface StoredDrawings {
  version: typeof STORAGE_VERSION;
  drawings: DrawingJSON[];
}

export function drawingStorageKey(symbol: string, timeframe: string): string {
  return `${KEY_PREFIX}:${encodeURIComponent(symbol)}:${encodeURIComponent(timeframe)}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isAnchor(value: unknown): boolean {
  if (!isRecord(value)) return false;
  const timeValid = typeof value.time === 'string' || (typeof value.time === 'number' && Number.isFinite(value.time));
  return timeValid &&
    Number.isFinite(value.price) &&
    (value.logical === undefined || (typeof value.logical === 'number' && Number.isFinite(value.logical)));
}

export function validateDrawings(value: unknown): DrawingJSON[] | null {
  if (!Array.isArray(value)) return null;
  const result: DrawingJSON[] = [];
  const ids = new Set<string>();
  for (const item of value) {
    if (!isRecord(item) ||
      typeof item.id !== 'string' || item.id.length === 0 || ids.has(item.id) ||
      typeof item.type !== 'string' || item.type.length === 0 ||
      !Number.isInteger(item.paneIndex) || (item.paneIndex as number) < 0 ||
      !Array.isArray(item.anchors) || !item.anchors.every(isAnchor) ||
      (item.seriesId !== undefined && typeof item.seriesId !== 'string') ||
      (item.style !== undefined && !isRecord(item.style)) ||
      (item.options !== undefined && !isRecord(item.options))) return null;
    ids.add(item.id);
    result.push(item as unknown as DrawingJSON);
  }
  return result;
}

export function loadDrawings(storage: Pick<Storage, 'getItem'>, key: string): DrawingJSON[] | null {
  try {
    const raw = storage.getItem(key);
    if (raw === null) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed) || parsed.version !== STORAGE_VERSION) return null;
    return validateDrawings(parsed.drawings);
  } catch {
    // Storage may be disabled/corrupt or JSON may be malformed; the chart must still work.
    return null;
  }
}

export function saveDrawings(storage: Pick<Storage, 'setItem'>, key: string, drawings: readonly DrawingJSON[]): boolean {
  const validated = validateDrawings(drawings);
  if (validated === null) return false;
  try {
    const payload: StoredDrawings = { version: STORAGE_VERSION, drawings: validated };
    storage.setItem(key, JSON.stringify(payload));
    return true;
  } catch {
    // Quota/security errors should not interrupt drawing interactions.
    return false;
  }
}
