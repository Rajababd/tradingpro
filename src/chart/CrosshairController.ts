import type { ISeriesApi, MouseEventParams } from 'lightweight-charts';
import type { UnixSeconds } from '../types/marketData';
import { EventChannel, type Unsubscribe } from '../utils/eventChannel';
import type { ChartPort } from './ChartPort';

export interface CrosshairSnapshot {
  /** Market time under the crosshair; null when the pointer is outside the data area. */
  readonly time: UnixSeconds | null;
  /** Fractional logical index under the pointer. */
  readonly logical: number | null;
  /** Index of the pane the pointer is over (a chart index, valid only right now). */
  readonly paneIndex: number | null;
  /** The price series' bar at `time`, whichever pane the pointer is in. */
  readonly candle: {
    readonly open: number;
    readonly high: number;
    readonly low: number;
    readonly close: number;
  } | null;
}

type CandleValues = NonNullable<CrosshairSnapshot['candle']>;

/** Accepts only a complete OHLC bar of finite numbers; anything else (line points, custom data) is null. */
function toCandleValues(bar: unknown): CandleValues | null {
  if (typeof bar !== 'object' || bar === null) return null;
  const { open, high, low, close } = bar as Record<string, unknown>;
  const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
  return isNum(open) && isNum(high) && isNum(low) && isNum(close) ? { open, high, low, close } : null;
}

const EMPTY: CrosshairSnapshot = Object.freeze({
  time: null,
  logical: null,
  paneIndex: null,
  candle: null,
});

/**
 * Turns the library's crosshair events into plain snapshots. Delivery is a plain
 * callback (not React state) so high-frequency pointer moves never force renders.
 * The library subscription exists only while someone is listening.
 */
export class CrosshairController {
  readonly #moves: EventChannel<CrosshairSnapshot>;
  readonly #handler = (param: MouseEventParams): void => this.#moves.emit(this.#snapshot(param));

  constructor(
    private readonly chart: ChartPort,
    private readonly getPriceSeries: () => ISeriesApi<'Candlestick'> | undefined,
  ) {
    this.#moves = new EventChannel<CrosshairSnapshot>({
      onFirstListener: () => this.chart.subscribeCrosshairMove(this.#handler),
      onNoListeners: () => this.chart.unsubscribeCrosshairMove(this.#handler),
    });
  }

  subscribe(listener: (snapshot: CrosshairSnapshot) => void): Unsubscribe {
    return this.#moves.subscribe(listener);
  }

  dispose(): void {
    this.#moves.clear();
  }

  #snapshot(param: MouseEventParams): CrosshairSnapshot {
    if (typeof param.time !== 'number' || param.logical === undefined) return EMPTY;

    const price = this.getPriceSeries();
    const bar = price === undefined ? undefined : param.seriesData.get(price);

    return {
      time: param.time as number as UnixSeconds,
      logical: param.logical as number,
      paneIndex: param.paneIndex ?? null,
      candle: toCandleValues(bar),
    };
  }
}
