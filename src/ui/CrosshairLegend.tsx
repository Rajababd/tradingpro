import { useEffect, useRef } from 'react';
import type { ChartController } from '../chart/ChartController';
import { formatLegend } from './legendFormat';

const fmt = (value: number) => value.toFixed(2);
const seriesLabel = (id: string) => ({ 'rsi:rsi': 'RSI', 'volume:volume': 'Volume', 'obv:obv': 'OBV', 'ad:ad': 'A/D', 'macd:macd': 'MACD', 'macd:signal': 'Signal', 'macd:histogram': 'Histogram' }[id] ?? (id.startsWith('sma:') ? `SMA ${id.slice(4)}` : id.toUpperCase()));
export function CrosshairLegend({ controller }: { controller: ChartController | null }) {
  const ref = useRef<HTMLDivElement>(null);
  const panesRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    const panesEl = panesRef.current;
    if (el === null || panesEl === null || controller === null || !controller.isMounted) return;
    const unsubscribe = controller.crosshair.subscribe((snapshot) => {
      const priceSmas = (snapshot.seriesValues ?? []).filter((item) => item.paneIndex === 0 && item.id.startsWith('sma:'));
      el.replaceChildren();
      const priceLine = document.createElement('div');
      priceLine.textContent = formatLegend(snapshot);
      el.append(priceLine);
      if (priceSmas.length > 0) {
        const smaLine = document.createElement('div');
        smaLine.className = 'legend-sma';
        smaLine.textContent = priceSmas.map((item) => `SMA ${item.id.slice(4)}: ${fmt(item.value)}`).join('   ·   ');
        el.append(smaLine);
      }
      panesEl.replaceChildren();
      if (snapshot.paneIndex === null || snapshot.paneIndex === 0) return;
      const values = (snapshot.seriesValues ?? []).filter((item) => item.paneIndex === snapshot.paneIndex);
      if (values.length === 0) return;
      const label = document.createElement('div');
      label.className = 'pane-crosshair-value';
      label.style.top = `${controller.paneTopOffset(snapshot.paneIndex) + 7}px`;
      label.textContent = values.map((item) => `${seriesLabel(item.id)}  ${fmt(item.value)}`).join('   ·   ');
      panesEl.append(label);
    });
    return () => { unsubscribe(); el.textContent = ''; panesEl.replaceChildren(); };
  }, [controller]);
  return <><div ref={ref} className="legend" data-testid="legend" /><div ref={panesRef} className="pane-crosshair-values" aria-live="off" /></>;
}
