import { afterEach, describe, expect, it, vi } from 'vitest';
import { DSEProvider } from '../src/data/DSEProvider';

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
    const bars = await provider.fetchHistorical({ symbol: 'BBSY', timeframe: '1D', refresh: true });
    expect(bars).toHaveLength(4);
    expect(bars[0]).toMatchObject({
      time: Math.floor(Date.parse('2026-01-26T00:00:00Z') / 1000),
      open: 10, high: 12, low: 9, close: 11, volume: 100, valueTraded: 1000,
    });
    expect(fetch).toHaveBeenCalledWith(
      '/api/market-data?symbol=BBSY',
      expect.objectContaining({ headers: { Accept: 'application/json' } }),
    );
  });

  it('aggregates daily sessions into weekly OHLC candles and sums turnover', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(dailyRows), { status: 200 })));
    const bars = await new DSEProvider().fetchHistorical({ symbol: 'BBSY', timeframe: '1W', refresh: true });
    expect(bars).toHaveLength(2);
    expect(bars[0]).toMatchObject({
      time: Math.floor(Date.parse('2026-01-26T00:00:00Z') / 1000),
      open: 10, high: 14, low: 9, close: 13, volume: 300, valueTraded: 3000,
    });
    expect(bars[1]).toMatchObject({ open: 13, high: 16, low: 12, close: 15, volume: 700, valueTraded: 7000 });
  });

  it('aggregates daily sessions into calendar-month candles', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(dailyRows), { status: 200 })));
    const bars = await new DSEProvider().fetchHistorical({ symbol: 'BBSY', timeframe: '1M', refresh: true });
    expect(bars).toHaveLength(2);
    expect(bars[0]).toMatchObject({ open: 10, high: 14, low: 9, close: 13, volume: 300, valueTraded: 3000 });
    expect(bars[1]).toMatchObject({ open: 13, high: 16, low: 12, close: 15, volume: 700, valueTraded: 7000 });
  });

  it('supports the wrapped DWX index payload', async () => {
    const indexRows = [{ date: '2026-01-26', open_val: '100', max_val: '104', min_val: '99', close_val: '103', traded_volume: '55' }];
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ value_and_date: indexRows }), { status: 200 })));
    const bars = await new DSEProvider().fetchHistorical({ symbol: 'DWX', timeframe: '1D', refresh: true });
    expect(bars).toHaveLength(1);
    expect(bars[0]).toMatchObject({ open: 100, high: 104, low: 99, close: 103, volume: 55 });
  });

  it('rejects a response with no complete OHLC rows instead of fabricating candles', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify([{ date: '2026-01-26', close: '10' }]), { status: 200 })));
    await expect(new DSEProvider().fetchHistorical({ symbol: 'DWX', timeframe: '1D', refresh: true })).rejects.toThrow(/no usable OHLC rows/i);
  });

  it('returns an empty result for a zero-length page', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(dailyRows), { status: 200 })));
    expect(await new DSEProvider().fetchHistorical({ symbol: 'BBSY', timeframe: '1D', limit: 0, refresh: true })).toEqual([]);
  });
  
  it('refreshes all configured symbols on demand so symbol switching can use cached data', async () => {
    const storage = new Map<string, string>();
    vi.stubGlobal('window', { localStorage: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => { storage.set(key, value); },
    } });
    const fetchMock = vi.fn().mockImplementation(async () => new Response(JSON.stringify(dailyRows), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const provider = new DSEProvider();
    const result = await provider.refreshAll();
    expect(result.refreshed).toEqual(['DWX', 'AVOC', 'ABC', 'BBSY', 'NIB', 'AHT']);
    expect(result.failed).toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(6);
    expect(provider.hasCachedData('DWX')).toBe(true);
    expect(provider.hasCachedData('AHT')).toBe(true);
    await provider.fetchHistorical({ symbol: 'AHT', timeframe: '1M' });
    expect(fetchMock).toHaveBeenCalledTimes(6);
  });

  it('reuses cached daily history for timeframe changes without another network request', async () => {
    const storage = new Map<string, string>();
    vi.stubGlobal('window', { localStorage: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => { storage.set(key, value); },
    } });
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(dailyRows), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const provider = new DSEProvider();
    await provider.fetchHistorical({ symbol: 'BBSY', timeframe: '1D', refresh: true });
    const weekly = await provider.fetchHistorical({ symbol: 'BBSY', timeframe: '1W' });
    const monthly = await provider.fetchHistorical({ symbol: 'BBSY', timeframe: '1M' });
    expect(weekly).toHaveLength(2);
    expect(monthly).toHaveLength(2);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('keeps refreshed history in memory if localStorage is unavailable', async () => {
    vi.stubGlobal('window', { localStorage: {
      getItem: () => { throw new Error('storage disabled'); },
      setItem: () => { throw new Error('storage full'); },
    } });
    const fetchMock = vi.fn().mockImplementation(async () => new Response(JSON.stringify(dailyRows), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const provider = new DSEProvider();
    await provider.fetchHistorical({ symbol: 'BBSY', timeframe: '1D', refresh: true });
    const monthly = await provider.fetchHistorical({ symbol: 'BBSY', timeframe: '1M' });
    expect(monthly).toHaveLength(2);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('falls back to alternate DSE fields when the preferred field is an empty string', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => new Response(JSON.stringify([{
      date: '2026-01-26', open: '', open_val: '10', high: '', max_val: '12',
      low: '', min_val: '9', close: '', close_val: '11', volume_traded: '', traded_volume: '100',
    }]), { status: 200 })));
    const bars = await new DSEProvider().fetchHistorical({ symbol: 'DWX', timeframe: '1D', refresh: true });
    expect(bars).toHaveLength(1);
    expect(bars[0]).toMatchObject({ open: 10, high: 12, low: 9, close: 11, volume: 100 });
  });

  it('reports excluded malformed rows after a successful partial all-symbol refresh', async () => {
    const storage = new Map<string, string>();
    vi.stubGlobal('window', { localStorage: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => { storage.set(key, value); },
    } });
    const payload = [
      ...dailyRows,
      { date: '2026-02-04', open: '10', high: '8', low: '9', close: '11' },
    ];
    const fetchMock = vi.fn().mockImplementation(async () => new Response(JSON.stringify(payload), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const provider = new DSEProvider();
    const result = await provider.refreshAll();
    expect(result.refreshed).toHaveLength(6);
    expect(result.failed).toEqual([]);
    expect(provider.lastRefreshWarning).toMatch(/استُبعدت سجلات OHLC غير صالحة/);
  });

  it('rejects malformed OHLC relationships before caching them', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => new Response(JSON.stringify([
      { date: '2026-01-26', open: '10', high: '8', low: '9', close: '11' },
    ]), { status: 200 })));
    await expect(new DSEProvider().fetchHistorical({ symbol: 'BBSY', timeframe: '1D', refresh: true }))
      .rejects.toThrow(/no usable OHLC rows/i);
  });

  it('keeps the previous cached history if an explicit refresh fails', async () => {
    const storage = new Map<string, string>();
    vi.stubGlobal('window', { localStorage: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => { storage.set(key, value); },
    } });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(dailyRows), { status: 200 }))
      .mockResolvedValueOnce(new Response('upstream unavailable', { status: 502 }));
    vi.stubGlobal('fetch', fetchMock);
    const provider = new DSEProvider();
    const fresh = await provider.fetchHistorical({ symbol: 'BBSY', timeframe: '1D', refresh: true });
    const afterFailedRefresh = await provider.fetchHistorical({ symbol: 'BBSY', timeframe: '1D', refresh: true });
    expect(afterFailedRefresh).toEqual(fresh);
    expect(provider.lastRefreshWarning).toMatch(/تعذّر تحديث BBSY/);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
