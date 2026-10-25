import { useEffect, useRef } from 'react';
import type { ChartController } from '../chart/ChartController';
import { formatLegend } from './legendFormat';

/**
 * Price/time readout. It writes `textContent` straight to the DOM from the crosshair
 * callback, so pointer movement never triggers a React render (and no HTML is injected).
 */
export function CrosshairLegend({ controller }: { controller: ChartController | null }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (el === null || controller === null || !controller.isMounted) return;
    const unsubscribe = controller.crosshair.subscribe((snapshot) => {
      el.textContent = formatLegend(snapshot);
    });
    return () => {
      unsubscribe();
      el.textContent = '';
    };
  }, [controller]);

  return <div ref={ref} className="legend" data-testid="legend" />;
}
