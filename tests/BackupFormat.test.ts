import { describe, expect, it } from 'vitest';
import { validateDrawingBackup, validateMarketDatabase } from '../src/data/BackupFormat';
import { parseTabularRows, parseWorkbookBuffer } from '../src/data/SpreadsheetImport';
import * as XLSX from 'xlsx';

describe('portable backup formats', () => {
  it('validates and preserves the exported market database format', () => {
    const backup = validateMarketDatabase({
      format: 'tradingpro-market-database', version: 1, exportedAt: '2026-11-04T00:00:00.000Z',
      symbols: { BBSY: [{ date: '2026-01-01', open: 10, high: 12, low: 9, close: 11, volume: 100, valueTraded: 1000 }] },
    });
    expect(backup.symbols.BBSY).toHaveLength(1);
    expect(() => validateMarketDatabase({
      format: 'tradingpro-market-database', version: 1,
      symbols: { BBSY: [
        { date: '2026-01-01', open: 10, high: 12, low: 9, close: 11, volume: null, valueTraded: null },
        { date: '2026-01-01', open: 10, high: 12, low: 9, close: 11, volume: null, valueTraded: null },
      ] },
    })).toThrow(/تاريخ مكرر/);
  });

  it('validates drawing groups by symbol, timeframe and drawing structure', () => {
    const backup = validateDrawingBackup({
      format: 'tradingpro-drawings', version: 1, drawings: [{
        symbol: 'BBSY', timeframe: '1D', items: [{
          id: 'trend-1', type: 'trend-line', paneIndex: 0, seriesId: 'price',
          anchors: [{ time: 1700000000, price: 10 }, { time: 1700001000, price: 12 }],
        }],
      }],
    });
    expect(backup.drawings[0]?.items).toHaveLength(1);
    expect(() => validateDrawingBackup({ format: 'tradingpro-drawings', version: 9, drawings: [] })).toThrow();
  });

  it('imports tabular Excel/CSV rows with either a symbol column or symbol-named sheet', () => {
    const rows = parseTabularRows([
      ['Symbol', 'Date', 'Open', 'High', 'Low', 'Close', 'Volume Traded', 'Value Traded'],
      ['BBSY', '2026-01-01', '10', '8', '9', '11', '100', '1000'],
    ]);
    expect(rows.BBSY).toEqual([{
      date: '2026-01-01', open: 10, high: 11, low: 9, close: 11, volume: 100, valueTraded: 1000,
    }]);
    const namedSheet = parseTabularRows([
      ['Date', 'Open', 'High', 'Low', 'Close'],
      ['2026-01-02', 11, 13, 10, 12],
    ], 'ABC');
    expect(namedSheet.ABC).toHaveLength(1);
  });

  it.each(['xls', 'xlsx', 'xlsm'] as const)('imports %s workbooks with date cells and symbol-named sheets', (bookType) => {
    const workbook = XLSX.utils.book_new();
    const worksheet = XLSX.utils.aoa_to_sheet([
      ['Date', 'Open', 'High', 'Low', 'Close', 'Volume Traded', 'Value Traded'],
      [new Date('2026-03-17T00:00:00.000Z'), 10, 12, 9, 11, 120, 1320],
    ]);
    XLSX.utils.book_append_sheet(workbook, worksheet, 'BBSY');
    const bytes = XLSX.write(workbook, { bookType, type: 'array', cellDates: true }) as ArrayBuffer;
    const imported = parseWorkbookBuffer(bytes);
    expect(imported.BBSY).toEqual([{
      date: '2026-03-17', open: 10, high: 12, low: 9, close: 11, volume: 120, valueTraded: 1320,
    }]);
  });
});
