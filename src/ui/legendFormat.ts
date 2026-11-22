import type { CrosshairSeriesValue, CrosshairSnapshot } from '../chart/CrosshairController';
const price = (n: number): string => n.toFixed(2);
export function formatLegend(snapshot: CrosshairSnapshot, priceSmas: readonly CrosshairSeriesValue[] = []): string {
  if (snapshot.time === null) return '';
  const date = new Date(snapshot.time * 1000).toISOString().slice(0, 10);
  const c = snapshot.candle;
  const ohlc = c === null ? date : `${date}  O ${price(c.open)}  H ${price(c.high)}  L ${price(c.low)}  C ${price(c.close)}`;
  if (priceSmas.length === 0) return ohlc;
  return `${ohlc}\n${priceSmas.map((item) => `SMA ${item.id.slice(4)}: ${price(item.value)}`).join('   ·   ')}`;
}
