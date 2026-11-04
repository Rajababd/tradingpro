import { describe, expect, it } from 'vitest';
import { drawingStorageKey, loadDrawings, saveDrawings } from '../src/chart/DrawingStorage';
import { exportDrawingDatabase, importDrawingDatabase } from '../src/data/DrawingBackupStorage';

function memoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() { return values.size; },
    clear: () => values.clear(),
    getItem: (key: string) => values.get(key) ?? null,
    key: (index: number) => [...values.keys()][index] ?? null,
    removeItem: (key: string) => { values.delete(key); },
    setItem: (key: string, value: string) => { values.set(key, value); },
  } as Storage;
}

const line = (id: string) => [{
  id, type: 'trend-line', seriesId: 'price', paneIndex: 0,
  anchors: [{ time: 1700000000, price: 10 }, { time: 1700003600, price: 12 }],
  style: { lineColor: '#ffffff' }, options: {},
}];

describe('portable drawing database', () => {
  it('exports and restores drawings across symbols and timeframes', () => {
    const source = memoryStorage();
    saveDrawings(source, drawingStorageKey('BBSY', '1D'), line('daily-line'));
    saveDrawings(source, drawingStorageKey('ABC', '1W'), line('weekly-line'));

    const backup = exportDrawingDatabase(source);
    expect(backup.format).toBe('tradingpro-drawings');
    expect(backup.drawings).toHaveLength(2);

    const restored = memoryStorage();
    importDrawingDatabase(restored, backup.drawings);
    expect(loadDrawings(restored, drawingStorageKey('BBSY', '1D'))).toEqual(line('daily-line'));
    expect(loadDrawings(restored, drawingStorageKey('ABC', '1W'))).toEqual(line('weekly-line'));
  });
});
