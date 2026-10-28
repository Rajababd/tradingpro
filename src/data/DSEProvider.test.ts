import { afterEach, describe, expect, it, vi } from 'vitest';
import { DSEProvider } from './DSEProvider';

const dailyRows = [
  { date: '2026-01-26', open: '10', high: '12', low: '9', close: '11', volume_traded: '100', value_traded: '1000' },
  { date: '2026-01-27', open: '11', high: '14', low: '10', close: '13', volume_traded: '200', value_traded: '2000' },
  { date: '2026-02-02', open: '13', high: '15', low: '12', close: '14', volume_traded: '300', value_traded: '3000' },
  { date: '2026-02-03', open: '14', high: '16', low: '13', close: '15', volume_traded: '400', value_traded: '4000' },
];

afterEach(() => vi.unstubAllGlobals());

describe('DSEProvider', () => {
  it('parses numeric strings and preserves daily OHLC, volume and traded value', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(dailyRows), { status: 200 })));
    const provider = new DSEProvider();
    const bars = await provider.fetchHistorical({ symbol: 'BBSY', timeframe: '1D' });
    expect(bars).toHaveLength(4);
    expect(bars[0]).toMatchObject({
      time: Math.floor(Date.parse('2026-01-26T00:00:00Z') / 1000),
      open: 10, high: 12, low: 9, close: 11, volume: 100, valueTraded: 1000,
    });
    expect(fetch).toHaveBeenCalledWith(
      'https://dse.sy/issuer-company/graph/84/all/line',
      expect.objectContaining({ headers: { Accept: 'application/json' } }),
    );
  });

  it('aggregates daily sessions into weekly OHLC candles and sums turnover', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(dailyRows), { status: 200 })));
    const bars = await new DSEProvider().fetchHistorical({ symbol: 'BBSY', timeframe: '1W' });
    expect(bars).toHaveLength(2);
    expect(bars[0]).toMatchObject({
      time: Math.floor(Date.parse('2026-01-26T00:00:00Z') / 1000),
      open: 10, high: 14, low: 9, close: 13, volume: 300, valueTraded: 3000,
    });
    expect(bars[1]).toMatchObject({ open: 13, high: 16, low: 12, close: 15, volume: 700, valueTraded: 7000 });
  });

  it('aggregates daily sessions into calendar-month candles', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(dailyRows), { status: 200 })));
    const bars = await new DSEProvider().fetchHistorical({ symbol: 'BBSY', timeframe: '1M' });
    expect(bars).toHaveLength(2);
    expect(bars[0]).toMatchObject({ open: 10, high: 14, low: 9, close: 13, volume: 300, valueTraded: 3000 });
    expect(bars[1]).toMatchObject({ open: 13, high: 16, low: 12, close: 15, volume: 700, valueTraded: 7000 });
  });

  it('supports the wrapped DWX index payload', async () => {
    const indexRows = [{ date: '2026-01-26', open_val: '100', max_val: '104', min_val: '99', close_val: '103', traded_volume: '55' }];
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ value_and_date: indexRows }), { status: 200 })));
    const bars = await new DSEProvider().fetchHistorical({ symbol: 'DWX', timeframe: '1D' });
    expect(bars).toHaveLength(1);
    expect(bars[0]).toMatchObject({ open: 100, high: 104, low: 99, close: 103, volume: 55 });
  });

  it('rejects a response with no complete OHLC rows instead of fabricating candles', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify([{ date: '2026-01-26', close: '10' }]), { status: 200 })));
    await expect(new DSEProvider().fetchHistorical({ symbol: 'DWX', timeframe: '1D' })).rejects.toThrow(/no usable OHLC rows/i);
  });

  it('returns an empty result for a zero-length page', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(dailyRows), { status: 200 })));
    expect(await new DSEProvider().fetchHistorical({ symbol: 'BBSY', timeframe: '1D', limit: 0 })).toEqual([]);
  });
});
