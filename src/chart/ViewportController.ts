import type { LogicalRange } from 'lightweight-charts';
import { EventChannel, type Unsubscribe } from '../utils/eventChannel';
import type { ChartPort } from './ChartPort';

export interface LogicalViewport {
  readonly from: number;
  readonly to: number;
}

export interface ViewportChange {
  /** True when the range changed during (or just after) a real user gesture, not a programmatic or settling change. */
  readonly userDriven: boolean;
}

export type ViewportListener = (range: LogicalViewport | null, change: ViewportChange) => void;

const toViewport = (range: LogicalRange | null): LogicalViewport | null =>
  range === null ? null : { from: range.from, to: range.to };

/**
 * Horizontal viewport of the shared time scale (all panes share one). Positions are
 * LOGICAL coordinates (fractional candle indices), the primary horizontal system
 * for drawings. The library subscription exists only while someone is listening.
 */
export class ViewportController {
  readonly #changes: EventChannel<{ range: LogicalViewport | null; userDriven: boolean }>;
  readonly #handler = (range: LogicalRange | null): void =>
    this.#changes.emit({ range: toViewport(range), userDriven: this.gestures?.active ?? false });

  readonly #timeScale: ReturnType<ChartPort['timeScale']>;

  constructor(
    private readonly chart: ChartPort,
    private readonly gestures?: { readonly active: boolean },
    timeScale: ReturnType<ChartPort['timeScale']> = chart.timeScale(),
  ) {
    this.#timeScale = timeScale;
    this.#changes = new EventChannel({
      onFirstListener: () => this.#timeScale.subscribeVisibleLogicalRangeChange(this.#handler),
      onNoListeners: () => this.#timeScale.unsubscribeVisibleLogicalRangeChange(this.#handler),
    });
  }

  /** The visible logical range, or null when there is no data yet. */
  getLogicalRange(): LogicalViewport | null {
    return toViewport(this.#timeScale.getVisibleLogicalRange());
  }

  /** Sets the visible logical range. Used to keep the same candles on screen after history is prepended. */
  setLogicalRange(range: LogicalViewport): void {
    this.#timeScale.setVisibleLogicalRange(range);
  }

  fitContent(): void {
    this.#timeScale.fitContent();
  }

  /** Scrolls so the newest candle is at the right edge. */
  scrollToLatest(): void {
    this.#timeScale.scrollToRealTime();
  }

  /** Fires on scroll, zoom, resize and data changes. Returns an unsubscribe function. */
  subscribe(listener: ViewportListener): Unsubscribe {
    return this.#changes.subscribe(({ range, userDriven }) => listener(range, { userDriven }));
  }

  dispose(): void {
    this.#changes.clear();
  }
}
