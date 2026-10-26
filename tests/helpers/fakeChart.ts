import { vi } from 'vitest';
import type { ChartPort } from '../../src/chart/ChartPort';

/**
 * A small fake of the chart-library surface the managers use. Its pane semantics
 * mirror what was MEASURED in a real browser against lightweight-charts 5.2.1
 * (docs/lightweight-charts-notes.md): a series added past the last pane creates a
 * new pane at the end (index is clamped); removing a pane's last series deletes the
 * pane and shifts later panes down; removing an unknown series throws.
 * `scripts/verify-phase2.py` re-checks these against the real library.
 */
export interface FakePaneHandle {
  getStretchFactor(): number;
  setStretchFactor(value: number): void;
  paneIndex(): number;
}

export interface FakeSeries {
  readonly definition: { type: string };
  readonly options: Record<string, unknown>;
  applyOptions: ReturnType<typeof vi.fn>;
  getPane(): FakePaneHandle;
  /** What the chart would currently be showing for this series. */
  data: { time: number; [k: string]: unknown }[];
  setData: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
}

type Handler = (...args: never[]) => void;

export class FakeChart {
  panes: FakeSeries[][] = [];
  /** Stretch factor per pane, keyed by the pane's array so it follows the pane through swaps. LW's first pane defaults to 2, others 1. */
  stretch = new WeakMap<FakeSeries[], number>();
  /** Every setStretchFactor call, in order, as [paneIndex at the time, value]. */
  stretchCalls: [number, number][] = [];
  failNextAddSeries = false;
  failNextSwap = false;
  visibleRange: { from: number; to: number } | null = null;

  crosshairHandlers = new Set<Handler>();
  clickHandlers = new Set<Handler>();
  doubleClickHandlers = new Set<Handler>();
  rangeHandlers = new Set<Handler>();

  fitContent = vi.fn();
  scrollToRealTime = vi.fn();
  remove = vi.fn();

  addSeries = vi.fn(
    (definition: { type: string }, options: Record<string, unknown> = {}, paneIndex = 0): FakeSeries => {
      if (this.failNextAddSeries) {
        this.failNextAddSeries = false;
        throw new Error('addSeries failed');
      }
      const series: FakeSeries = {
        definition,
        options: { ...options },
        applyOptions: vi.fn(),
        data: [],
        setData: vi.fn(),
        update: vi.fn(),
        getPane: () => {
          const find = () => this.panes.find((pane) => pane.includes(series));
          return {
            getStretchFactor: () => this.stretch.get(find()!) ?? 1,
            setStretchFactor: (value: number) => {
              this.stretchCalls.push([this.paneIndexOf(series), value]);
              this.stretch.set(find()!, value);
            },
            paneIndex: () => this.paneIndexOf(series),
          };
        },
      };
      series.applyOptions.mockImplementation((o: Record<string, unknown>) => Object.assign(series.options, o));
      series.setData.mockImplementation((d: FakeSeries['data']) => void (series.data = [...d]));
      series.update.mockImplementation((point: FakeSeries['data'][number]) => {
        const last = series.data.at(-1);
        if (last !== undefined && last.time === point.time) series.data[series.data.length - 1] = point;
        else if (last === undefined || point.time > last.time) series.data.push(point);
        else throw new Error('Cannot update oldest data');
      });
      const index = Math.min(paneIndex, this.panes.length);
      if (index === this.panes.length) {
        const pane = [series];
        this.stretch.set(pane, this.panes.length === 0 ? 2 : 1);
        this.panes.push(pane);
      } else this.panes[index]!.push(series);
      return series;
    },
  );

  removeSeries = vi.fn((series: FakeSeries): void => {
    const paneIndex = this.paneIndexOf(series);
    if (paneIndex === -1) throw new Error('Value is undefined');
    const pane = this.panes[paneIndex]!;
    pane.splice(pane.indexOf(series), 1);
    if (pane.length === 0) this.panes.splice(paneIndex, 1);
  });

  swapPanes = vi.fn((first: number, second: number): void => {
    if (this.failNextSwap) {
      this.failNextSwap = false;
      throw new Error('swapPanes failed');
    }
    const a = this.panes[first];
    const b = this.panes[second];
    if (a === undefined || b === undefined) throw new Error('Invalid pane index');
    this.panes[first] = b;
    this.panes[second] = a;
  });

  subscribeCrosshairMove = vi.fn((h: Handler) => void this.crosshairHandlers.add(h));
  unsubscribeCrosshairMove = vi.fn((h: Handler) => void this.crosshairHandlers.delete(h));
  subscribeClick = vi.fn((h: Handler) => void this.clickHandlers.add(h));
  unsubscribeClick = vi.fn((h: Handler) => void this.clickHandlers.delete(h));
  subscribeDblClick = vi.fn((h: Handler) => void this.doubleClickHandlers.add(h));
  unsubscribeDblClick = vi.fn((h: Handler) => void this.doubleClickHandlers.delete(h));

  readonly #timeScale = {
    fitContent: this.fitContent,
    scrollToRealTime: this.scrollToRealTime,
    getVisibleLogicalRange: vi.fn(() => this.visibleRange),
    setVisibleLogicalRange: vi.fn((r: { from: number; to: number }) => void (this.visibleRange = r)),
    subscribeVisibleLogicalRangeChange: vi.fn((h: Handler) => void this.rangeHandlers.add(h)),
    unsubscribeVisibleLogicalRangeChange: vi.fn((h: Handler) => void this.rangeHandlers.delete(h)),
  };
  timeScale = vi.fn(() => this.#timeScale);

  paneIndexOf(series: FakeSeries): number {
    return this.panes.findIndex((pane) => pane.includes(series));
  }

  emitCrosshair(param: unknown): void {
    for (const h of [...this.crosshairHandlers]) (h as (p: unknown) => void)(param);
  }

  emitRange(range: { from: number; to: number } | null): void {
    for (const h of [...this.rangeHandlers]) (h as (r: unknown) => void)(range);
  }

  get timeScaleMock() {
    return this.#timeScale;
  }

  asPort(): ChartPort {
    return this as unknown as ChartPort;
  }
}

/** A series definition stand-in: managers only read `.type`. */
export const def = <T extends string>(type: T) => ({ type }) as never;
