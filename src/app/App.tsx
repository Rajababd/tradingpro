import { useEffect, useMemo, useRef, useState } from 'react';
import { ChartController } from '../chart/ChartController';
import { drawingStorageKey, loadDrawings, saveDrawings } from '../chart/DrawingStorage';
import { DSEProvider, DSE_SYMBOLS } from '../data/DSEProvider';
import { MarketDataService, initialMarketDataState } from '../data/MarketDataService';
import { bindIndicatorsToService } from '../indicators/bindIndicatorsToService';
import { IndicatorEngine } from '../indicators/IndicatorEngine';
import { IndicatorWorkspace } from '../indicators/IndicatorWorkspace';
import { createSeriesStyles } from '../indicators/seriesStyles';
import type { Timeframe } from '../types/marketData';
import { CrosshairLegend } from '../ui/CrosshairLegend';
import { DrawingToolbar } from '../ui/DrawingToolbar';
import { describeFeed, describeHistory } from '../ui/feedStatus';
import { TopBarMenus } from '../ui/TopBarMenus';
import { useMarketDataState } from '../ui/useMarketDataState';
import { bindChartToService } from './bindChartToService';
import { config } from './config';
import { exposeDevHook } from './devHook';
import { theme } from './theme';

const TIMEFRAMES: readonly { value: Timeframe; label: string }[] = [
  { value: '1D', label: 'يومي' },
  { value: '1W', label: 'أسبوعي' },
  { value: '1M', label: 'شهري' },
];

export function App() {
  const containerRef = useRef<HTMLDivElement>(null);
  const [refreshRequest, setRefreshRequest] = useState<{ symbol: string; timeframe: Timeframe; nonce: number } | null>(null);
  const [symbol, setSymbol] = useState<string>(config.symbol);
  const [timeframe, setTimeframe] = useState<Timeframe>(config.timeframe);
  const provider = useMemo(() => new DSEProvider(), []);
  const fallback = useMemo(
    () => initialMarketDataState({ id: provider.id, displayName: provider.displayName, isSimulated: false }),
    [provider],
  );
  const [session, setSession] = useState<{ chart: ChartController; service: MarketDataService; workspace: IndicatorWorkspace } | null>(null);
  const state = useMarketDataState(session?.service ?? null, fallback);

  useEffect(() => {
    const container = containerRef.current;
    if (container === null) return;
    const chart = new ChartController(theme);
    chart.mount(container);
    const service = new MarketDataService(provider, { olderPageSize: config.olderPageBars });
    const unbind = bindChartToService(chart, service, { loadOlderWithinBars: config.loadOlderWithinBars });
    const engine = new IndicatorEngine();
    const unbindIndicators = bindIndicatorsToService(engine, service);
    const workspace = new IndicatorWorkspace(engine, { visibility: chart.visibility, series: chart.series }, createSeriesStyles(theme));
    const unexpose = exposeDevHook({ chart, service, engine, workspace });
    setSession({ chart, service, workspace });

    let cancelled = false;
    let restoringDrawings = false;
    let persistenceReady = false;
    let saveTimer: ReturnType<typeof setTimeout> | undefined;
    const storageKey = drawingStorageKey(symbol, timeframe);
    const persistDrawings = () => {
      if (cancelled || restoringDrawings || !persistenceReady) return;
      if (saveTimer !== undefined) clearTimeout(saveTimer);
      saveTimer = setTimeout(() => {
        saveTimer = undefined;
        try { saveDrawings(window.localStorage, storageKey, chart.drawings.export()); } catch { /* best-effort */ }
      }, 150);
    };
    const drawingEvents = ['drawing:added', 'drawing:removed', 'drawing:cleared', 'drawing:updated', 'drawing:edit-finished'];
    const unsubscribeDrawingEvents = drawingEvents.map((event) => chart.drawings.on(event, persistDrawings));

    const explicitRefresh = refreshRequest?.symbol === symbol && refreshRequest.timeframe === timeframe;
    // Selection changes only read cached history. Network access is reserved for the refresh button.
    if (explicitRefresh || provider.hasCachedData(symbol)) {
      void service.load({ symbol, timeframe, limit: config.initialBars, refresh: explicitRefresh }).then(() => {
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
        }
        persistenceReady = true;
      });
    }

    return () => {
      cancelled = true;
      if (saveTimer !== undefined) clearTimeout(saveTimer);
      try { if (persistenceReady) saveDrawings(window.localStorage, storageKey, chart.drawings.export()); } catch { /* storage may be disabled */ }
      unsubscribeDrawingEvents.forEach((unsubscribe) => unsubscribe());
      unexpose();
      workspace.dispose();
      unbindIndicators();
      unbind();
      service.dispose();
      chart.dispose();
      setSession(null);
    };
  }, [provider, symbol, timeframe, refreshRequest]);

  const feed = describeFeed(state);
  const statusParts = [
    state.status === 'loading' ? 'جارٍ جلب البيانات…' : '',
    state.status === 'idle' ? 'اضغط «تحديث البيانات» لجلب الأسعار' : '',
    state.status === 'ready' ? `${state.candleCount} candles` + (state.issues.length > 0 ? ` · ${state.issues.length} data issues` : '') : '',
    state.status === 'error' ? 'Failed to load' : '',
    feed.label,
    describeHistory(state),
  ].filter((part) => part !== '');
  const selectedSymbol = DSE_SYMBOLS.find((item) => item.symbol === symbol) ?? DSE_SYMBOLS[0]!;

  return (
    <div className="app">
      <header className="topbar">
        <h1 className="brand">TradingPro</h1>
        <label className="market-select-label">
          <span className="sr-only">السهم أو المؤشر</span>
          <select aria-label="السهم أو المؤشر" value={symbol} onChange={(event) => { setRefreshRequest(null); setSymbol(event.target.value); }}>
            {DSE_SYMBOLS.map((item) => <option key={item.symbol} value={item.symbol}>{item.symbol}</option>)}
          </select>
        </label>
        <span className="market-name" title={selectedSymbol.name}>{selectedSymbol.name}</span>
        <div className="timeframe-picker" role="group" aria-label="الإطار الزمني">
          {TIMEFRAMES.map((item) => (
            <button key={item.value} type="button" aria-pressed={timeframe === item.value}
              className={timeframe === item.value ? 'timeframe-button active' : 'timeframe-button'}
              onClick={() => { setRefreshRequest(null); setTimeframe(item.value); }}>{item.label}</button>
          ))}
        </div>
        <button type="button" className="refresh-button" disabled={state.status === 'loading'} onClick={() => setRefreshRequest({ symbol, timeframe, nonce: (refreshRequest?.nonce ?? 0) + 1 })}>{state.status === 'loading' ? 'جارٍ التحديث…' : 'تحديث البيانات'}</button>
        <TopBarMenus workspace={session?.workspace ?? null} />
        <DrawingToolbar controller={session?.chart.drawings ?? null} />
        {state.source.isSimulated && <span className="badge-simulated" title={state.source.displayName}>SIMULATED DATA</span>}
        <span className="status" role="status" data-tone={feed.tone}>{statusParts.join(' · ')}</span>
      </header>
      <main className="chart-area">
        <div ref={containerRef} className="chart" data-testid="chart" />
        <CrosshairLegend controller={session?.chart ?? null} />
        {state.status === 'error' && (
          <div className="overlay" role="alert">
            <p>{state.error}</p>
            <button type="button" onClick={() => setRefreshRequest({ symbol, timeframe, nonce: (refreshRequest?.nonce ?? 0) + 1 })}>إعادة المحاولة</button>
          </div>
        )}
      </main>
    </div>
  );
}
