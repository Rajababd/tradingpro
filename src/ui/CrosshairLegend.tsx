import { useEffect, useRef } from 'react';
import type { ChartController } from '../chart/ChartController';
import { formatLegend } from './legendFormat';

const fmt = (value: number) => value.toFixed(2);
export function CrosshairLegend({ controller }: { controller: ChartController | null }) {
  const ref = useRef<HTMLDivElement>(null);
  const panesRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    const panesEl = panesRef.current;
    if (el === null || panesEl === null || controller === null || !controller.isMounted) return;
    const unsubscribe = controller.crosshair.subscribe((snapshot) => {
      const priceSmas = (snapshot.seriesValues ?? []).filter((item) => item.paneIndex === 0 && item.id.startsWith('sma:'));
      el.textContent = formatLegend(snapshot, priceSmas);
      panesEl.replaceChildren();
      if (snapshot.paneIndex === null || snapshot.paneIndex === 0) return;
      const values = (snapshot.seriesValues ?? []).filter((item) => item.paneIndex === snapshot.paneIndex);
      if (values.length === 0) return;
      const label = document.createElement('div');
      label.className = 'pane-crosshair-value';
      label.style.top = `${controller.paneTopOffset(snapshot.paneIndex) + 7}px`;
      label.textContent = values.map((item) => `${item.id.replace(':', ' ')}  ${fmt(item.value)}`).join('   ·   ');
      panesEl.append(label);
    });
    return () => { unsubscribe(); el.textContent = ''; panesEl.replaceChildren(); };
  }, [controller]);
  return <><div ref={ref} className="legend" data-testid="legend" /><div ref={panesRef} className="pane-crosshair-values" aria-live="off" /></>;
}
