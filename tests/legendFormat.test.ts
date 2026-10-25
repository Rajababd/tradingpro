import { describe, expect, it } from 'vitest';
import type { CrosshairSnapshot } from '../src/chart/CrosshairController';
import type { UnixSeconds } from '../src/types/marketData';
import { formatLegend } from '../src/ui/legendFormat';

const t = (n: number) => n as UnixSeconds;

describe('formatLegend', () => {
  it('is empty when the pointer is outside the data area', () => {
    const empty: CrosshairSnapshot = { time: null, logical: null, paneIndex: null, candle: null };
    expect(formatLegend(empty)).toBe('');
  });

  it('formats the UTC date and OHLC to two decimals', () => {
    const s: CrosshairSnapshot = {
      time: t(1704067200), // 2024-01-01T00:00:00Z
      logical: 0,
      paneIndex: 0,
      candle: { open: 100, high: 105.5, low: 99.123, close: 102.999 },
    };
    expect(formatLegend(s)).toBe('2024-01-01  O 100.00  H 105.50  L 99.12  C 103.00');
  });

  it('shows only the date when there is no candle', () => {
    const s: CrosshairSnapshot = { time: t(1704067200), logical: 0, paneIndex: 0, candle: null };
    expect(formatLegend(s)).toBe('2024-01-01');
  });

  it('uses UTC, not local time, at a day boundary', () => {
    const s: CrosshairSnapshot = { time: t(1704067199), logical: 0, paneIndex: 0, candle: null }; // 2023-12-31T23:59:59Z
    expect(formatLegend(s)).toBe('2023-12-31');
  });
});
