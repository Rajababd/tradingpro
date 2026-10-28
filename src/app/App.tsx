import { useEffect, useMemo, useRef, useState } from 'react';
import { ChartController } from '../chart/ChartController';
import { drawingStorageKey, loadDrawings, saveDrawings } from '../chart/DrawingStorage';
import { FixtureProvider } from '../data/FixtureProvider';
import { MarketDataService, initialMarketDataState } from '../data/MarketDataService';
import { bindIndicatorsToService } from '../indicators/bindIndicatorsToService';
import { IndicatorEngine } from '../indicators/IndicatorEngine';
import { IndicatorWorkspace } from '../indicators/IndicatorWorkspace';
import { createSeriesStyles } from '../indicators/seriesStyles';
import { CrosshairLegend } from '../ui/CrosshairLegend';
import { DrawingToolbar } from '../ui/DrawingToolbar';
import { describeFeed, describeHistory } from '../ui/feedStatus';
import { TopBarMenus } from '../ui/TopBarMenus';
import { useMarketDataState } from '../ui/useMarketDataState';
import { bindChartToService } from './bindChartToService';
import { config } from './config';
import { exposeDevHook } from './devHook';
import { theme } from './theme';

export function App() {
  const containerRef = useRef<HTMLDivElement>(null);
  // Incrementing this re-runs the effect: a fresh provider, chart and service (Retry).
  const [attempt, setAttempt] = useState(0);
  // A new simulated market per attempt. Constructing it has no side effects.
  const provider = useMemo(() => new FixtureProvider(), [attempt]); // eslint-disable-line react-hooks/exhaustive-deps
  const fallback = useMemo(
    () =>
      initialMarketDataState({ id: provider.id, displayName: provider.displayName, isSimulated: provider.isSimulated }),
    [provider],
  );
  // Held in state only so the legend and the status line can subscribe; they change on mount/unmount.
  const [session, setSession] = useState<{ chart: ChartController; service: MarketDataService; workspace: IndicatorWorkspace } | null>(null);
  const state = useMarketDataState(session?.service ?? null, fallback);

  useEffect(() => {
    const container = containerRef.current;
    if (container === null) return;

    const chart = new ChartController(theme);
    chart.mount(container);
    const service = new MarketDataService(provider, { olderPageSize: config.olderPageBars });

    // Data reaches the chart incrementally, straight from the service, not through React.
    const unbind = bindChartToService(chart, service, { loadOlderWithinBars: config.loadOlderWithinBars });

    // Indicators: calculation follows the same data events, and the workspace connects it to chart series.
    const engine = new IndicatorEngine();
    const unbindIndicators = bindIndicatorsToService(engine, service);
    const workspace = new IndicatorWorkspace(engine, { visibility: chart.visibility, series: chart.series }, createSeriesStyles(theme));
    const unexpose = exposeDevHook({ chart, service, engine, workspace });

    setSession({ chart, service, workspace });

    let cancelled = false;
    let restoringDrawings = false;
    let persistenceReady = false;
    let saveTimer: ReturnType<typeof setTimeout> | undefined;
    const storageKey = drawingStorageKey(config.symbol, config.timeframe);
    const persistDrawings = () => {
      if (cancelled || restoringDrawings || !persistenceReady) return;
      if (saveTimer !== undefined) clearTimeout(saveTimer);
      saveTimer = setTimeout(() => {
        saveTimer = undefined;
        try {
          saveDrawings(window.localStorage, storageKey, chart.drawings.export());
        } catch {
          // Persistence is best-effort; storage availability must not affect chart use.
        }
      }, 150);
    };
    const drawingEvents = ['drawing:added', 'drawing:removed', 'drawing:cleared', 'drawing:updated', 'drawing:edit-finished'];
    const unsubscribeDrawingEvents = drawingEvents.map((event) => chart.drawings.on(event, persistDrawings));

    void service.load({ symbol: config.symbol, timeframe: config.timeframe, limit: config.initialBars }).then(() => {
      if (cancelled || service.getState().status !== 'ready') return;
      try {
        const saved = loadDrawings(window.localStorage, storageKey);
        if (saved !== null) {
          restoringDrawings = true;
          chart.drawings.import(saved);
          restoringDrawings = false;
        }
      } catch {
        restoringDrawings = false;
        // Invalid/unavailable saved drawings must not prevent the chart from loading.
      }
      persistenceReady = true;
      service.startLive({ intervalMs: config.pollIntervalMs });
    });

    return () => {
      cancelled = true;
      if (saveTimer !== undefined) clearTimeout(saveTimer);
      // Flush the final state before detaching the drawing manager.
      try {
        if (persistenceReady) saveDrawings(window.localStorage, storageKey, chart.drawings.export());
      } catch {
        // Ignore storage restrictions during teardown.
      }
      unsubscribeDrawingEvents.forEach((unsubscribe) => unsubscribe());
      unexpose();
      workspace.dispose();
      unbindIndicators();
      unbind();
      service.dispose();
      chart.dispose();
      setSession(null);
    };
  }, [attempt, provider]);

  const feed = describeFeed(state);
  const statusParts = [
    state.status === 'loading' || state.status === 'idle' ? 'Loading…' : '',
    state.status === 'ready'
      ? `${state.candleCount} candles` + (state.issues.length > 0 ? ` · ${state.issues.length} data issues` : '')
      : '',
    state.status === 'error' ? 'Failed to load' : '',
    feed.label,
    describeHistory(state),
  ].filter((part) => part !== '');

  return (
    <div className="app">
      <header className="topbar">
        <h1 className="brand">TradingPro</h1>
        <span className="symbol">{config.symbol}</span>
        <span className="timeframe">{config.timeframe}</span>
        <TopBarMenus workspace={session?.workspace ?? null} />
        <DrawingToolbar controller={session?.chart.drawings ?? null} />
        {state.source.isSimulated && (
          <span className="badge-simulated" title={state.source.displayName}>
            SIMULATED DATA
          </span>
        )}
        <span className="status" role="status" data-tone={feed.tone}>
          {statusParts.join(' · ')}
        </span>
      </header>
      <main className="chart-area">
        <div ref={containerRef} className="chart" data-testid="chart" />
        <CrosshairLegend controller={session?.chart ?? null} />
        {state.status === 'error' && (
          <div className="overlay" role="alert">
            <p>{state.error}</p>
            <button type="button" onClick={() => setAttempt((n) => n + 1)}>
              Retry
            </button>
          </div>
        )}
      </main>
    </div>
  );
}
