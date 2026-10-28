import { describe, expect, it } from 'vitest';
import { drawingStorageKey, loadDrawings, saveDrawings, validateDrawings } from '../src/chart/DrawingStorage';
import type { DrawingJSON } from '../src/vendor/lightweight-charts-drawing.es.js';

const sample: DrawingJSON[] = [{
  id: 'line-1',
  type: 'TrendLine',
  seriesId: 'price',
  paneIndex: 0,
  anchors: [{ time: 1700000000, logical: 12, price: 42.5 }, { time: '2024-01-02', price: 45 }],
  style: { lineColor: '#fff' },
  options: { visible: true, locked: false },
}];

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
  };
}

describe('drawing storage', () => {
  it('uses a separate encoded key for each symbol and timeframe', () => {
    expect(drawingStorageKey('ABC/DEF', '1D')).not.toBe(drawingStorageKey('ABC/DEF', '1W'));
    expect(drawingStorageKey('ABC/DEF', '1D')).toContain('ABC%2FDEF');
  });

  it('round-trips a versioned drawing payload', () => {
    const storage = memoryStorage();
    const key = drawingStorageKey('SIM', '1D');
    expect(saveDrawings(storage, key, sample)).toBe(true);
    expect(loadDrawings(storage, key)).toEqual(sample);
  });

  it('rejects malformed payloads, duplicate ids and unsupported versions', () => {
    expect(validateDrawings([{ ...sample[0], anchors: [{ time: 1, price: Number.NaN }] }])).toBeNull();
    expect(validateDrawings([sample[0], sample[0]])).toBeNull();
    const storage = memoryStorage();
    const key = 'drawings';
    storage.setItem(key, JSON.stringify({ version: 99, drawings: sample }));
    expect(loadDrawings(storage, key)).toBeNull();
    storage.setItem(key, '{broken json');
    expect(loadDrawings(storage, key)).toBeNull();
  });

  it('fails safely when storage throws', () => {
    const storage = {
      getItem: () => { throw new Error('blocked'); },
      setItem: () => { throw new Error('quota'); },
    };
    expect(loadDrawings(storage, 'x')).toBeNull();
    expect(saveDrawings(storage, 'x', sample)).toBe(false);
  });
});
