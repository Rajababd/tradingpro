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
import { BackupRestorePanel } from '../ui/BackupRestorePanel';
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
  const [isRefreshingAll, setIsRefreshingAll] = useState(false);
  const [symbol, setSymbol] = useState<string>(config.symbol);
  const [timeframe, setTimeframe] = useState<Timeframe>(config.timeframe);
  const [priceChartType, setPriceChartType] = useState<'candles' | 'line'>('candles');
  const provider = useMemo(() => new DSEProvider(), []);
  const fallback = useMemo(
    () => initialMarketDataState({ id: provider.id, displayName: provider.displayName, isSimulated: false }),
    [provider],
  );
  const [session, setSession] = useState<{ chart: ChartController; service: MarketDataService; workspace: IndicatorWorkspace } | null>(null);
  const state = useMarketDataState(session?.service ?? null, fallback);

  useEffect(() => { session?.chart.setPriceChartType(priceChartType); }, [session, priceChartType]);

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
    const persistDrawingsNow = () => {
      if (cancelled || restoringDrawings || !persistenceReady) return;
      if (saveTimer !== undefined) {
        clearTimeout(saveTimer);
        saveTimer = undefined;
      }
      try { saveDrawings(window.localStorage, storageKey, chart.drawings.export()); } catch { /* best-effort */ }
    };
    const persistDrawings = () => {
      if (cancelled || restoringDrawings || !persistenceReady) return;
      if (saveTimer !== undefined) clearTimeout(saveTimer);
      saveTimer = setTimeout(() => {
        saveTimer = undefined;
        try { saveDrawings(window.localStorage, storageKey, chart.drawings.export()); } catch { /* best-effort */ }
      }, 150);
    };
    // Structural changes are written synchronously: closing the Android app immediately
    // after placing a drawing must not lose it before a debounce timer fires.
    const unsubscribeDrawingEvents = [
      chart.drawings.on('drawing:added', persistDrawingsNow),
      chart.drawings.on('drawing:removed', persistDrawingsNow),
      chart.drawings.on('drawing:cleared', persistDrawingsNow),
      chart.drawings.on('drawing:updated', persistDrawings),
      chart.drawings.on('drawing:edit-finished', persistDrawingsNow),
    ];

    const explicitRefresh = refreshRequest?.symbol === symbol && refreshRequest.timeframe === timeframe;
    const restoreSavedDrawings = () => {
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
    };
    // Network access is reserved for the button. One press refreshes all symbols,
    // so subsequent symbol/timeframe changes use the local daily-history cache.
    if (explicitRefresh) {
      setIsRefreshingAll(true);
      void (async () => {
        try {
          await provider.refreshAll();
          if (cancelled) return;
          await service.load({ symbol, timeframe, limit: config.initialBars });
          restoreSavedDrawings();
        } finally {
          setIsRefreshingAll(false);
        }
      })();
    } else if (provider.hasCachedData(symbol)) {
      void service.load({ symbol, timeframe, limit: config.initialBars }).then(restoreSavedDrawings);
    } else {
      setIsRefreshingAll(false);
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
    isRefreshingAll ? 'جارٍ تحديث بيانات السوق…' : state.status === 'loading' ? 'جارٍ جلب البيانات…' : '',
    state.status === 'idle' && !isRefreshingAll ? 'اضغط «تحديث البيانات» لجلب الأسعار' : '',
    state.status === 'ready' ? `${state.candleCount} candles` + (state.issues.length > 0 ? ` · ${state.issues.length} data issues` : '') : '',
    state.status === 'error' ? 'Failed to load' : '',
    provider.lastRefreshWarning ?? '',
    feed.label,
    describeHistory(state),
  ].filter((part) => part !== '');
  const selectedSymbol = DSE_SYMBOLS.find((item) => item.symbol === symbol) ?? DSE_SYMBOLS[0]!;

  return (
    <div className="app">
      <header className="app-header">
        <div className="topbar" aria-label="Market controls">
          <h1 className="brand">TradingPro</h1>
          <label className="market-select-label">
            <span className="sr-only">السهم أو المؤشر</span>
            <select aria-label="السهم أو المؤشر" disabled={isRefreshingAll} value={symbol} onChange={(event) => { setRefreshRequest(null); setSymbol(event.target.value); }}>
              {DSE_SYMBOLS.map((item) => <option key={item.symbol} value={item.symbol}>{item.symbol}</option>)}
            </select>
          </label>
          <span className="market-name" title={selectedSymbol.name}>{selectedSymbol.name}</span>
          <label className="chart-type-picker"><span className="sr-only">نوع الرسم</span><select aria-label="نوع الرسم" value={priceChartType} onChange={(event) => setPriceChartType(event.target.value as 'candles' | 'line')}><option value="candles">شموع</option><option value="line">خط بياني</option></select></label>
          <button type="button" className="refresh-button" disabled={state.status === 'loading' || isRefreshingAll} onClick={() => setRefreshRequest({ symbol, timeframe, nonce: (refreshRequest?.nonce ?? 0) + 1 })}>
            {isRefreshingAll || state.status === 'loading' ? 'جارٍ التحديث…' : 'تحديث البيانات'}
          </button>
        </div>
        <div className="toolbar-row" aria-label="Chart controls">
          <TopBarMenus workspace={session?.workspace ?? null} />
          <div className="timeframe-picker" role="group" aria-label="الإطار الزمني">
            {TIMEFRAMES.map((item) => (
              <button key={item.value} type="button" disabled={isRefreshingAll} aria-pressed={timeframe === item.value}
                className={timeframe === item.value ? 'timeframe-button active' : 'timeframe-button'}
                onClick={() => { setRefreshRequest(null); setTimeframe(item.value); }}>{item.label}</button>
            ))}
          </div>
        </div>
      </header>
      <main className="workspace">
        <aside className="side-toolbar" aria-label="Drawing and data tools">
          <DrawingToolbar controller={session?.chart.drawings ?? null} />
          <BackupRestorePanel
            provider={provider}
            controller={session?.chart.drawings ?? null}
            symbol={symbol}
            timeframe={timeframe}
            onMarketDataImported={async (importedSymbols) => {
              if (session === null) return;
              if (!provider.hasCachedData(symbol)) {
                const nextSymbol = importedSymbols.find((candidate) => provider.hasCachedData(candidate));
                if (nextSymbol) {
                  setSymbol(nextSymbol);
                  return;
                }
              }
              if (provider.hasCachedData(symbol)) {
                await session.service.load({ symbol, timeframe, limit: config.initialBars });
              }
            }}
          />
        </aside>
        <section className="chart-area">
          <div ref={containerRef} className="chart" data-testid="chart" />
          <CrosshairLegend controller={session?.chart ?? null} />
          {state.source.isSimulated && <span className="badge-simulated" title={state.source.displayName}>SIMULATED DATA</span>}
          <div className="status" role="status" data-tone={feed.tone}>{statusParts.join(' · ')}</div>
          {state.status === 'error' && (
            <div className="overlay" role="alert">
              <p>{state.error}</p>
              <button type="button" onClick={() => setRefreshRequest({ symbol, timeframe, nonce: (refreshRequest?.nonce ?? 0) + 1 })}>إعادة المحاولة</button>
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
