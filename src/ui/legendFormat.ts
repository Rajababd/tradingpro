import type { CrosshairSnapshot } from '../chart/CrosshairController';

const price = (n: number): string => n.toFixed(2);

/**
 * Text for the crosshair legend. Empty when the pointer is outside the data area.
 * The date is shown in UTC because market timestamps are UTC seconds.
 */
export function formatLegend(snapshot: CrosshairSnapshot): string {
  if (snapshot.time === null) return '';
  const date = new Date(snapshot.time * 1000).toISOString().slice(0, 10);
  const c = snapshot.candle;
  if (c === null) return date;
  return `${date}  O ${price(c.open)}  H ${price(c.high)}  L ${price(c.low)}  C ${price(c.close)}`;
}
