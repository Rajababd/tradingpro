import type { ChartController } from '../chart/ChartController';
import type { MarketDataService } from '../data/MarketDataService';
import type { IndicatorEngine } from '../indicators/IndicatorEngine';
import type { IndicatorWorkspace } from '../indicators/IndicatorWorkspace';

export interface DevSession {
  readonly chart: ChartController;
  readonly service: MarketDataService;
  readonly engine: IndicatorEngine;
  readonly workspace: IndicatorWorkspace;
}

declare global {
  interface Window {
    __tradingpro?: DevSession;
  }
}

/**
 * A TEST SEAM for the browser checks (`scripts/verify-*.py`): in development only, the live objects are reachable as
 * `window.__tradingpro`, so a check can drive the real UI and then assert on the real chart. The `import.meta.env.DEV`
 * guard is replaced by `false` in production builds, which removes this code entirely (checked at build time).
 */
export function exposeDevHook(session: DevSession): () => void {
  if (!import.meta.env.DEV) return () => {};
  window.__tradingpro = session;
  return () => {
    if (window.__tradingpro === session) delete window.__tradingpro;
  };
}
