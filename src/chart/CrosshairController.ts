import type { ISeriesApi, MouseEventParams, SeriesType } from 'lightweight-charts';
import type { UnixSeconds } from '../types/marketData';
import { EventChannel, type Unsubscribe } from '../utils/eventChannel';
import type { ChartPort } from './ChartPort';

export interface CrosshairSeriesValue {
  readonly id: string;
  readonly paneIndex: number;
  readonly value: number;
}
export interface CrosshairSnapshot {
  readonly time: UnixSeconds | null;
  readonly logical: number | null;
  readonly paneIndex: number | null;
  readonly point: { readonly x: number; readonly y: number } | null;
  readonly candle: { readonly open: number; readonly high: number; readonly low: number; readonly close: number } | null;
  /** Numeric values of visible series at the crosshair time, grouped by their real chart pane. */
  readonly seriesValues?: readonly CrosshairSeriesValue[];
}
type CandleValues = NonNullable<CrosshairSnapshot['candle']>;
export interface CrosshairSeriesDescriptor {
  readonly id: string;
  readonly paneIndex: number;
  readonly api: ISeriesApi<SeriesType>;
}
function toCandleValues(bar: unknown): CandleValues | null {
  if (typeof bar !== 'object' || bar === null) return null;
  const { open, high, low, close } = bar as Record<string, unknown>;
  const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
  return isNum(open) && isNum(high) && isNum(low) && isNum(close) ? { open, high, low, close } : null;
}
function toNumericValue(point: unknown): number | null {
  if (typeof point !== 'object' || point === null) return null;
  const value = (point as Record<string, unknown>).value;
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}
const EMPTY: CrosshairSnapshot = Object.freeze({ time: null, logical: null, paneIndex: null, point: null, candle: null });
export class CrosshairController {
  readonly #moves: EventChannel<CrosshairSnapshot>;
  readonly #handler = (param: MouseEventParams): void => this.#moves.emit(this.#snapshot(param));
  constructor(
    private readonly chart: ChartPort,
    private readonly getPriceSeries: () => ISeriesApi<'Candlestick'> | undefined,
    private readonly getSeriesDescriptors?: () => readonly CrosshairSeriesDescriptor[],
    private readonly getCandleAtTime?: (time: number) => CandleValues | null,
  ) {
    this.#moves = new EventChannel<CrosshairSnapshot>({
      onFirstListener: () => this.chart.subscribeCrosshairMove(this.#handler),
      onNoListeners: () => this.chart.unsubscribeCrosshairMove(this.#handler),
    });
  }
  subscribe(listener: (snapshot: CrosshairSnapshot) => void): Unsubscribe { return this.#moves.subscribe(listener); }
  dispose(): void { this.#moves.clear(); }
  #snapshot(param: MouseEventParams): CrosshairSnapshot {
    if (typeof param.time !== 'number' || param.logical === undefined) return EMPTY;
    const price = this.getPriceSeries();
    const bar = price === undefined ? undefined : param.seriesData.get(price);
    const snapshot: CrosshairSnapshot = {
      time: param.time as number as UnixSeconds,
      logical: param.logical as number,
      paneIndex: param.paneIndex ?? null,
      point: param.point === undefined || param.point === null ? null : { x: param.point.x, y: param.point.y },
      candle: toCandleValues(bar) ?? this.getCandleAtTime?.(param.time) ?? null,
    };
    if (this.getSeriesDescriptors === undefined) return snapshot;
    const seriesValues = this.getSeriesDescriptors().flatMap((series) => {
      const value = toNumericValue(param.seriesData.get(series.api));
      return value === null ? [] : [{ id: series.id, paneIndex: series.paneIndex, value }];
    });
    return { ...snapshot, seriesValues };
  }
}
