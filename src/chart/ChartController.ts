import {
  CandlestickSeries,
  LineSeries,
  ColorType,
  CrosshairMode,
  TrackingModeExitMode,
  createChart,
  type CandlestickData,
  type LineData,
  type IChartApi,
  type ISeriesApi,
  type UTCTimestamp,
} from 'lightweight-charts';
import type { Theme } from '../app/theme';
import type { Candle } from '../types/marketData';
import { CrosshairController } from './CrosshairController';
import { DrawingController } from './DrawingController';
import { PRICE_PANE_ID, PaneManager } from './PaneManager';
import { PRICE_SERIES_ID, SeriesManager, type SeriesReader } from './SeriesManager';
import { UserGestureTracker } from './UserGestureTracker';
import { ViewportController } from './ViewportController';
import { VisibilityController } from './VisibilityController';
import { VisibilityModel } from './VisibilityModel';

/** The permanent base (price) pane. Indicator panes come after it. */
export const PRICE_PANE_INDEX = 0;
export const PRICE_LINE_SERIES_ID = 'price-line';

export type ChartTheme = Pick<Theme, 'ink' | 'rule' | 'muted' | 'up' | 'down'>;

const toLineData = (c: Candle): LineData<UTCTimestamp> => ({ time: c.time as number as UTCTimestamp, value: c.close });

const toCandlestickData = (c: Candle): CandlestickData<UTCTimestamp> => ({
  time: c.time as number as UTCTimestamp,
  open: c.open,
  high: c.high,
  low: c.low,
  close: c.close,
});

/** Syrian currency redenomination: historical reference prices before 2026-01-04
 * are expressed in the old unit and must be converted to the new unit. Use UTC
 * because Candle.time is a UTC Unix timestamp, avoiding device-timezone drift. */
export const getAdjustedReferencePrice = (c: Candle): number | null => {
  const referencePrice = c.referencePrice;
  if (referencePrice == null || !Number.isFinite(referencePrice) || referencePrice <= 0) return null;
  const candleDate = new Date(Number(c.time) * 1000).toISOString().slice(0, 10);
  return candleDate < '2026-01-04' ? referencePrice / 100 : referencePrice;
};

export type CandleDisplayMode = 'opening' | 'reference' | 'both';

/** Reference-price candles use the adjusted reference as their open and retain natural H/L/C. */
export const toReferenceCandlestickData = (c: Candle): CandlestickData<UTCTimestamp> | null => {
  const referencePrice = getAdjustedReferencePrice(c);
  if (referencePrice === null) return null;
  return {
    time: c.time as number as UTCTimestamp,
    open: referencePrice,
    high: Math.max(c.high, referencePrice, c.close),
    low: Math.min(c.low, referencePrice, c.close),
    close: c.close,
    borderColor: c.close > referencePrice ? '#26a69a' : c.close < referencePrice ? '#ef5350' : '#f2c14e',
  };
};

/** Opening-price candles in combined mode: transparent body with direction-colored outline. */
const toOpeningOutlineCandlestickData = (c: Candle): CandlestickData<UTCTimestamp> => ({
  time: c.time as number as UTCTimestamp,
  open: c.open,
  high: c.high,
  low: c.low,
  close: c.close,
  borderColor: c.close > c.open ? '#26a69a' : c.close < c.open ? '#ef5350' : '#f2c14e',
});

const toReferenceCandlestickDataList = (candles: readonly Candle[]) => candles.flatMap((candle) => {
  const item = toReferenceCandlestickData(candle);
  return item === null ? [] : [item];
});

/**
 * Sole owner of the Lightweight Charts instance. UI code never touches the chart.
 *
 * Lifecycle (single use): `mount` creates exactly one chart and one price series;
 * mounting the same container again is a no-op, a different container throws;
 * `dispose` releases the chart and is idempotent. A disposed controller cannot be
 * reused: create a new one (React effects do exactly that, which also keeps
 * StrictMode's mount/unmount/mount cycle safe).
 */
export class ChartController {
  #chart: IChartApi | null = null;
  #container: HTMLElement | null = null;
  #disposed = false;
  #series: SeriesManager | null = null;
  #referenceSeries: ISeriesApi<'Candlestick'> | null = null;
  #visibility: VisibilityController | null = null;
  #panes: PaneManager | null = null;
  #viewport: ViewportController | null = null;
  #crosshair: CrosshairController | null = null;
  #drawings: DrawingController | null = null;
  #gestures: UserGestureTracker | null = null;
  #priceScaleRangeHandler: (() => void) | null = null;
  #priceScaleWidth = 64;
  #priceCandles: Candle[] = [];
  #priceChartType: 'candles' | 'line' = 'candles';
  #candleDisplayMode: CandleDisplayMode = 'both';
  #verticalPinch: { distance: number; range: { from: number; to: number }; focalPrice: number; focalRatio: number } | null = null;

  /** Current minimum width reserved for right-axis labels. */
  get priceScaleMinimumWidth(): number {
    return this.#priceScaleWidth;
  }

  /**
   * Measure the longest formatted price in the visible candle range and reserve enough
   * room for it. Re-evaluated after data changes and horizontal zoom/scroll.
   */
  #updatePriceScaleWidth(): void {
    if (this.#chart === null || this.#series === null) return;
    const data = this.#priceCandles;
    if (data.length === 0) return;
    const timeScale = this.#chart.timeScale();
    const range = typeof timeScale.getVisibleLogicalRange === 'function' ? timeScale.getVisibleLogicalRange() : null;
    const from = range === null ? 0 : Math.max(0, Math.floor(range.from));
    const to = range === null ? data.length - 1 : Math.min(data.length - 1, Math.ceil(range.to));
    const visible = data.slice(from, to + 1);
    const formatter = new Intl.NumberFormat('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
    const labels = visible.flatMap((point) => [point.open, point.high, point.low, point.close]);
    const longest = labels.reduce((best, value) => {
      const label = formatter.format(value);
      return label.length > best.length ? label : best;
    }, '');
    let measured = longest.length * 7.2;
    if (typeof document !== 'undefined') {
      const canvas = document.createElement('canvas');
      const context = canvas.getContext('2d');
      if (context !== null) {
        context.font = '12px Arial, sans-serif';
        measured = context.measureText(longest).width;
      }
    }
    const nextWidth = Math.max(56, Math.min(132, Math.ceil(measured + 26)));
    if (nextWidth === this.#priceScaleWidth) return;
    this.#priceScaleWidth = nextWidth;
    const priceScale = typeof this.#chart.priceScale === 'function' ? this.#chart.priceScale('right') : null;
    priceScale?.applyOptions({ minimumWidth: nextWidth });
  }

  constructor(private readonly theme: ChartTheme) {}

  get isMounted(): boolean {
    return this.#chart !== null;
  }

  /** Actual Lightweight Charts pane count, not inferred from DOM separators. */
  get paneCount(): number {
    return this.#chart?.panes().length ?? 0;
  }

  /** Number of real series in each actual chart pane, in visual order. */
  get paneSeriesCounts(): readonly number[] {
    return this.#chart?.panes().map((pane) => pane.getSeries().length) ?? [];
  }

  /** Read-only view of the chart's series. To add, hide, show or remove, use `visibility`. Available after mount. */
  get series(): SeriesReader {
    return this.#mounted(this.#series);
  }

  /**
   * The only way to add, show, hide and remove series. It owns the visibility state and keeps pane
   * layout in step (collapse and restore), so nothing else decides those things. Available after mount.
   */
  get visibility(): VisibilityController {
    return this.#mounted(this.#visibility);
  }

  /** Logical pane order and bookkeeping. Available after mount. */
  get panes(): PaneManager {
    return this.#mounted(this.#panes);
  }

  /** Horizontal viewport in logical coordinates. Available after mount. */
  get viewport(): ViewportController {
    return this.#mounted(this.#viewport);
  }

  /** Crosshair snapshots for price inspection. Available after mount. */
  get crosshair(): CrosshairController {
    return this.#mounted(this.#crosshair);
  }

  /** Drawing library lifecycle and JSON persistence API. Available after mount. */
  get drawings(): DrawingController {
    return this.#mounted(this.#drawings);
  }

  mount(container: HTMLElement): void {
    if (this.#disposed) throw new Error('ChartController was disposed; create a new one.');
    if (this.#chart !== null) {
      if (this.#container === container) return;
      throw new Error('ChartController is already mounted to a different container.');
    }

    const t = this.theme;
    const chart = createChart(container, {
      // The library observes the container and removes the observer in chart.remove().
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: t.ink },
        textColor: t.muted,
      },
      grid: { vertLines: { color: t.rule }, horzLines: { color: t.rule } },
      rightPriceScale: { borderColor: t.rule },
      timeScale: { borderColor: t.rule },
      crosshair: { mode: CrosshairMode.Normal },
      handleScale: { pinch: true },
      trackingMode: { exitMode: TrackingModeExitMode.OnNextTap },
    });

    try {
      const panes = new PaneManager();
      const series = new SeriesManager(chart, panes, new Set([PRICE_SERIES_ID]));
      const visibility = new VisibilityController(series, panes, new VisibilityModel(panes, new Set([PRICE_SERIES_ID])));
      visibility.addSeries({
        id: PRICE_SERIES_ID,
        definition: CandlestickSeries,
        options: {
          upColor: t.up,
          downColor: t.down,
          wickUpColor: t.up,
          wickDownColor: t.down,
          borderVisible: false,
        },
        paneId: PRICE_PANE_ID,
      });
      visibility.addSeries({ id: PRICE_LINE_SERIES_ID, definition: LineSeries, options: { color: '#5aa9e6', lineWidth: 2, priceLineVisible: false, visible: false }, paneId: PRICE_PANE_ID, visible: false });
      this.#referenceSeries = chart.addSeries(CandlestickSeries, {
        upColor: t.up, downColor: t.down,
        wickUpColor: t.up, wickDownColor: t.down,
        wickVisible: true, borderVisible: false,
        priceLineVisible: false, lastValueVisible: false, priceScaleId: 'right', zOrder: 'normal',
      } as never, PRICE_PANE_INDEX);
      panes.noteSeriesAdded(PRICE_PANE_ID); // keep pane bookkeeping aligned with the internal overlay series
      this.#visibility = visibility;
      this.#panes = panes;
      this.#series = series;
      this.#gestures = new UserGestureTracker(container);
      this.#viewport = new ViewportController(chart, this.#gestures, chart.timeScale());
      this.#crosshair = new CrosshairController(
        chart,
        () => series.get<'Candlestick'>(PRICE_SERIES_ID),
        () => series.list().flatMap((info) => {
          const api = series.get(info.id);
          return api === undefined ? [] : [{ id: info.id, paneIndex: panes.indexFor(info.paneId), api }];
        }),
        (time) => { const candle = this.#priceCandles.find((item) => item.time === time); return candle === undefined ? null : { open: candle.open, high: candle.high, low: candle.low, close: candle.close }; },
      );
      const timeScale = chart.timeScale();
      if (
        typeof timeScale.subscribeVisibleLogicalRangeChange === 'function' &&
        typeof timeScale.unsubscribeVisibleLogicalRangeChange === 'function'
      ) {
        this.#priceScaleRangeHandler = this.#viewport.subscribe(() => this.#updatePriceScaleWidth());
      }
      this.#drawings = new DrawingController(series);
      this.#drawings.attach(chart, container);
    } catch (error) {
      chart.remove(); // never leave a half-built chart behind
      throw error;
    }
    this.#chart = chart;
    this.#container = container;
    container.addEventListener('touchstart', this.#onVerticalPinchStart, { capture: true, passive: false });
    container.addEventListener('touchmove', this.#onVerticalPinchMove, { capture: true, passive: false });
    container.addEventListener('touchend', this.#onVerticalPinchEnd, { capture: true, passive: false });
    container.addEventListener('touchcancel', this.#onVerticalPinchEnd, { capture: true, passive: false });
  }

  setPriceChartType(type: 'candles' | 'line'): void {
    if (this.#series === null) throw new Error('ChartController is not mounted.');
    if (type === this.#priceChartType) return;
    this.#priceChartType = type;
    this.#series.setVisible(PRICE_SERIES_ID, type === 'candles');
    this.#series.setVisible(PRICE_LINE_SERIES_ID, type === 'line');
    this.#referenceSeries?.applyOptions({ visible: type === 'candles' && this.#candleDisplayMode === 'both' } as never);
  }

  get priceChartType(): 'candles' | 'line' { return this.#priceChartType; }

  get candleDisplayMode(): CandleDisplayMode { return this.#candleDisplayMode; }

  /** Select opening-price candles, reference-price candles, or both visual layers. */
  setCandleDisplayMode(mode: CandleDisplayMode): void {
    if (mode !== 'opening' && mode !== 'reference' && mode !== 'both') throw new Error('Unsupported candle display mode.');
    if (mode === this.#candleDisplayMode) return;
    this.#candleDisplayMode = mode;
    if (this.#priceCandles.length > 0) this.#renderCandleData(this.#priceCandles);
  }

  #renderCandleData(candles: readonly Candle[]): void {
    if (this.#series === null) return;
    const base = this.#series.require<'Candlestick'>(PRICE_SERIES_ID);
    const references = toReferenceCandlestickDataList(candles);
    if (this.#candleDisplayMode === 'opening') {
      base.applyOptions({ upColor: this.theme.up, downColor: this.theme.down, wickUpColor: this.theme.up, wickDownColor: this.theme.down, wickVisible: true, borderVisible: false, zOrder: 'normal' } as never);
      base.setData(candles.map(toCandlestickData));
      this.#referenceSeries?.setData([]);
      this.#referenceSeries?.applyOptions({ visible: false } as never);
      return;
    }
    if (this.#candleDisplayMode === 'reference') {
      base.applyOptions({ upColor: this.theme.up, downColor: this.theme.down, wickUpColor: this.theme.up, wickDownColor: this.theme.down, wickVisible: true, borderVisible: false, zOrder: 'normal' } as never);
      base.setData(references);
      this.#referenceSeries?.setData([]);
      return;
    }
    base.applyOptions({ upColor: 'rgba(0,0,0,0)', downColor: 'rgba(0,0,0,0)', wickUpColor: this.theme.up, wickDownColor: this.theme.down, wickVisible: true, borderVisible: true, zOrder: 'top' } as never);
    base.setData(candles.map(toOpeningOutlineCandlestickData));
    this.#referenceSeries?.setData(references);
    this.#referenceSeries?.applyOptions({ visible: this.#priceChartType === 'candles' } as never);
  }

  /** Restore all series styling to application defaults without changing data or visibility. */
  resetAppearance(): void {
    if (this.#series === null) return;
    for (const item of this.#series.list()) {
      const api = this.#series.get(item.id);
      if (api === undefined) continue;
      if (item.type === 'Candlestick') {
        api.applyOptions({ upColor: '#26a69a', downColor: '#ef5350', wickUpColor: '#26a69a', wickDownColor: '#ef5350', wickVisible: true, priceLineVisible: false, lastValueVisible: true } as never);
      } else if (item.type === 'Line') {
        const color = item.id === PRICE_LINE_SERIES_ID ? '#5aa9e6' : item.id.startsWith('sma:') ? '#f2c14e' : '#d6b25e';
        api.applyOptions({ color, lineWidth: 2, lineStyle: 0, lineType: 0, lineVisible: true, title: '', lastPriceAnimation: 0, crosshairMarkerVisible: true, pointMarkersVisible: false, crosshairMarkerBackgroundColor: color, crosshairMarkerBorderColor: '#ffffff', crosshairMarkerRadius: 4, pointMarkersRadius: 3, pointMarkersUpColor: color, pointMarkersDownColor: color, priceLineVisible: false, lastValueVisible: true, priceLineColor: '#9aa0a6', priceLineWidth: 1, priceLineStyle: 2 } as never);
      }
    }
    this.#renderCandleData(this.#priceCandles);
  }

  /**
   * Replaces the whole dataset and resets the view to fit it. Expects candles already
   * validated by normalizeCandles. Incremental updates (later phase) must use a
   * separate method that does not touch the viewport.
   */
  setCandles(candles: readonly Candle[]): void {
    if (this.#chart === null || this.#series === null || this.#viewport === null || this.#drawings === null) {
      throw new Error('ChartController is not mounted.');
    }
    this.#priceCandles = [...candles];
    this.#renderCandleData(candles);
    this.#series.require<'Line'>(PRICE_LINE_SERIES_ID).setData(candles.map(toLineData));
    this.#drawings.rebaseLogicalAnchors();
    this.#viewport.fitContent();
    this.#updatePriceScaleWidth();
  }

  /**
   * Applies ONE live candle: replaces the latest candle when the time matches, or adds a new
   * one at the end. Only the price series is touched; the viewport and every other series stay
   * as they are. Callers (the market-data service) guarantee the candle is not older than the latest.
   */
  updateCandle(candle: Candle): void {
    if (this.#series === null) throw new Error('ChartController is not mounted.');
    const last = this.#priceCandles.at(-1);
    const replacesLast = last?.time === candle.time;
    if (replacesLast) this.#priceCandles[this.#priceCandles.length - 1] = candle;
    else this.#priceCandles.push(candle);
    const priceSeries = this.#series.require<'Candlestick'>(PRICE_SERIES_ID);
    const reference = toReferenceCandlestickData(candle);
    if (this.#candleDisplayMode === 'opening') {
      priceSeries.update(toCandlestickData(candle));
    } else if (this.#candleDisplayMode === 'reference') {
      if (reference !== null) priceSeries.update(reference);
      else if (replacesLast) priceSeries.setData(toReferenceCandlestickDataList(this.#priceCandles));
    } else {
      priceSeries.update(toOpeningOutlineCandlestickData(candle));
      if (reference !== null) this.#referenceSeries?.update(reference);
      else if (replacesLast) this.#referenceSeries?.setData(toReferenceCandlestickDataList(this.#priceCandles));
    }
    this.#series.require<'Line'>(PRICE_LINE_SERIES_ID).update(toLineData(candle));
    this.#updatePriceScaleWidth();
  }

  /**
   * Replaces the dataset after `added` OLDER candles were put in front. Every existing candle's
   * logical index grows by `added`, so the visible logical range is shifted by the same amount:
   * the candles on screen do not move. (Anything stored by logical index, such as drawings, shifts
   * the same way: see docs/architecture.md.)
   */
  prependCandles(all: readonly Candle[], added: number): void {
    if (this.#series === null || this.#viewport === null || this.#drawings === null) throw new Error('ChartController is not mounted.');
    const range = this.#viewport.getLogicalRange();
    this.#priceCandles = [...all];
    this.#renderCandleData(all);
    this.#series.require<'Line'>(PRICE_LINE_SERIES_ID).setData(all.map(toLineData));
    this.#drawings.rebaseLogicalAnchors();
    if (range !== null && added > 0) {
      this.#viewport.setLogicalRange({ from: range.from + added, to: range.to + added });
    }
    this.#updatePriceScaleWidth();
  }

  /** Vertical offset of a pane inside the chart, used to anchor its crosshair value readout. */
  paneTopOffset(paneIndex: number): number {
    if (this.#chart === null || paneIndex <= 0) return 0;
    return this.#chart.panes().slice(0, paneIndex).reduce((height, pane) => height + pane.getHeight() + 6, 0);
  }

  /** Idempotent. Safe before mount and after a previous dispose. */
  dispose(): void {
    this.#disposed = true;
    if (this.#chart === null) return;
    // Detach library subscriptions before the chart is destroyed.
    this.#priceScaleRangeHandler?.();
    this.#priceScaleRangeHandler = null;
    this.#container?.removeEventListener('touchstart', this.#onVerticalPinchStart, { capture: true });
    this.#container?.removeEventListener('touchmove', this.#onVerticalPinchMove, { capture: true });
    this.#container?.removeEventListener('touchend', this.#onVerticalPinchEnd, { capture: true });
    this.#container?.removeEventListener('touchcancel', this.#onVerticalPinchEnd, { capture: true });
    this.#verticalPinch = null;
    this.#drawings?.dispose();
    this.#crosshair?.dispose();
    this.#viewport?.dispose();
    this.#gestures?.dispose();
    this.#visibility?.dispose();
    this.#series?.dispose();
    this.#chart.remove();
    this.#chart = null;
    this.#container = null;
    this.#series = null;
    this.#referenceSeries = null;
    this.#visibility = null;
    this.#panes = null;
    this.#viewport = null;
    this.#crosshair = null;
    this.#drawings = null;
    this.#gestures = null;
    this.#priceCandles = [];
  }


  /**
   * Lightweight Charts' built-in pinch gesture zooms the shared time scale.
   * Capture a vertically aligned two-finger pinch first so it can zoom the main
   * price scale independently, without changing the horizontal time range.
   */
  #onVerticalPinchStart = (event: TouchEvent): void => {
    if (event.touches.length !== 2 || this.#chart === null || this.#series === null) return;
    const first = event.touches[0];
    const second = event.touches[1];
    if (first === undefined || second === undefined) return;
    const deltaX = Math.abs(second.clientX - first.clientX);
    const deltaY = Math.abs(second.clientY - first.clientY);
    if (deltaY < Math.max(24, deltaX * 1.15)) return;
    const paneElement = this.#chart.panes()[0]?.getHTMLElement();
    const paneRect = paneElement?.getBoundingClientRect();
    if (paneRect === undefined || paneRect === null) return;
    const centerX = (first.clientX + second.clientX) / 2;
    const centerY = (first.clientY + second.clientY) / 2;
    if (centerX < paneRect.left || centerX > paneRect.right || centerY < paneRect.top || centerY > paneRect.bottom) return;
    const priceSeries = this.#series.get<'Candlestick'>(PRICE_SERIES_ID);
    if (priceSeries === undefined) return;
    const priceScale = this.#chart.priceScale('right');
    const visible = priceScale.getVisibleRange();
    const topPrice = priceSeries.coordinateToPrice(0);
    const bottomPrice = priceSeries.coordinateToPrice(paneRect.height);
    const range = visible ?? (topPrice !== null && bottomPrice !== null
      ? { from: Math.min(topPrice, bottomPrice), to: Math.max(topPrice, bottomPrice) }
      : null);
    const focalPrice = priceSeries.coordinateToPrice(centerY - paneRect.top);
    if (range === null || focalPrice === null || !Number.isFinite(range.from) || !Number.isFinite(range.to) || range.to <= range.from) return;
    const distance = deltaY;
    if (distance < 24) return;
    this.#verticalPinch = { distance, range: { from: range.from, to: range.to }, focalPrice, focalRatio: (focalPrice - range.from) / (range.to - range.from) };
    event.preventDefault();
    event.stopImmediatePropagation();
  };

  #onVerticalPinchMove = (event: TouchEvent): void => {
    const pinch = this.#verticalPinch;
    if (pinch === null) return;
    if (event.touches.length !== 2) { this.#verticalPinch = null; return; }
    const first = event.touches[0];
    const second = event.touches[1];
    if (first === undefined || second === undefined) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    const distance = Math.abs(second.clientY - first.clientY);
    if (distance < 12 || this.#chart === null) return;
    const initialSpan = pinch.range.to - pinch.range.from;
    const nextSpan = Math.max(initialSpan / 100, Math.min(initialSpan * 100, initialSpan * pinch.distance / distance));
    const nextFrom = pinch.focalPrice - pinch.focalRatio * nextSpan;
    const priceScale = this.#chart.priceScale('right');
    priceScale.setAutoScale(false);
    priceScale.setVisibleRange({ from: nextFrom, to: nextFrom + nextSpan });
  };

  #onVerticalPinchEnd = (event: TouchEvent): void => {
    if (this.#verticalPinch === null) return;
    if (event.touches.length < 2) this.#verticalPinch = null;
  };

  #mounted<T>(value: T | null): T {
    if (value === null) throw new Error('ChartController is not mounted.');
    return value;
  }
}
