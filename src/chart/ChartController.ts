import {
  CandlestickSeries,
  ColorType,
  createChart,
  type CandlestickData,
  type IChartApi,
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

export type ChartTheme = Pick<Theme, 'ink' | 'rule' | 'muted' | 'up' | 'down'>;

const toCandlestickData = (c: Candle): CandlestickData<UTCTimestamp> => ({
  time: c.time as number as UTCTimestamp,
  open: c.open,
  high: c.high,
  low: c.low,
  close: c.close,
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
  #visibility: VisibilityController | null = null;
  #panes: PaneManager | null = null;
  #viewport: ViewportController | null = null;
  #crosshair: CrosshairController | null = null;
  #drawings: DrawingController | null = null;
  #gestures: UserGestureTracker | null = null;

  constructor(private readonly theme: ChartTheme) {}

  get isMounted(): boolean {
    return this.#chart !== null;
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
      this.#visibility = visibility;
      this.#panes = panes;
      this.#series = series;
      this.#gestures = new UserGestureTracker(container);
      this.#viewport = new ViewportController(chart, this.#gestures);
      this.#crosshair = new CrosshairController(chart, () =>
        series.get<'Candlestick'>(PRICE_SERIES_ID),
      );
      this.#drawings = new DrawingController(series);
      this.#drawings.attach(chart, container);
    } catch (error) {
      chart.remove(); // never leave a half-built chart behind
      throw error;
    }
    this.#chart = chart;
    this.#container = container;
  }

  /**
   * Replaces the whole dataset and resets the view to fit it. Expects candles already
   * validated by normalizeCandles. Incremental updates (later phase) must use a
   * separate method that does not touch the viewport.
   */
  setCandles(candles: readonly Candle[]): void {
    if (this.#chart === null || this.#series === null || this.#viewport === null) {
      throw new Error('ChartController is not mounted.');
    }
    this.#series.require<'Candlestick'>(PRICE_SERIES_ID).setData(candles.map(toCandlestickData));
    this.#viewport.fitContent();
  }

  /**
   * Applies ONE live candle: replaces the latest candle when the time matches, or adds a new
   * one at the end. Only the price series is touched; the viewport and every other series stay
   * as they are. Callers (the market-data service) guarantee the candle is not older than the latest.
   */
  updateCandle(candle: Candle): void {
    if (this.#series === null) throw new Error('ChartController is not mounted.');
    this.#series.require<'Candlestick'>(PRICE_SERIES_ID).update(toCandlestickData(candle));
  }

  /**
   * Replaces the dataset after `added` OLDER candles were put in front. Every existing candle's
   * logical index grows by `added`, so the visible logical range is shifted by the same amount:
   * the candles on screen do not move. (Anything stored by logical index, such as drawings, shifts
   * the same way: see docs/architecture.md.)
   */
  prependCandles(all: readonly Candle[], added: number): void {
    if (this.#series === null || this.#viewport === null) throw new Error('ChartController is not mounted.');
    const range = this.#viewport.getLogicalRange();
    this.#series.require<'Candlestick'>(PRICE_SERIES_ID).setData(all.map(toCandlestickData));
    if (added > 0) this.#drawings.shiftLogicalAnchors(added);
    if (range !== null && added > 0) {
      this.#viewport.setLogicalRange({ from: range.from + added, to: range.to + added });
    }
  }

  /** Idempotent. Safe before mount and after a previous dispose. */
  dispose(): void {
    this.#disposed = true;
    if (this.#chart === null) return;
    // Detach library subscriptions before the chart is destroyed.
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
    this.#visibility = null;
    this.#panes = null;
    this.#viewport = null;
    this.#crosshair = null;
    this.#drawings = null;
    this.#gestures = null;
  }

  #mounted<T>(value: T | null): T {
    if (value === null) throw new Error('ChartController is not mounted.');
    return value;
  }
}
