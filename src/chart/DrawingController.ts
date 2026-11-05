import type { IChartApi, ISeriesApi, SeriesType } from 'lightweight-charts';
import { DrawingManager, getToolRegistry, type DrawingInstance, type DrawingJSON } from '../vendor/lightweight-charts-drawing.es.js';
import type { SeriesManager } from './SeriesManager';

type DrawingSettingsDrawing = {
  id: string;
  type: string;
  style: {
    lineColor: string;
    lineWidth: number;
    lineDash: number[];
    fillColor: string;
    fillOpacity: number;
    showLabels: boolean;
    labelFont: string;
    labelColor: string;
  };
  options: {
    visible?: boolean;
    locked?: boolean;
    zIndex?: number;
    extendLeft?: boolean;
    extendRight?: boolean;
  };
  trendLineOptions?: Record<string, boolean>;
  setTrendLineOptions?: (options: Record<string, unknown>) => void;
};

type DrawingManagerWithSettings = DrawingManager & {
  getSelectedDrawing(): DrawingSettingsDrawing | null;
  notifyDrawingUpdated(id: string): void;
  deselectAll(): void;
};

/**
 * Owns the drawing library lifecycle and resolves drawings by stable series identity.
 * The manager is intentionally separate from React so saved drawings remain plain JSON.
 */
export class DrawingController {
  // The bundled library exposes these runtime methods/properties but its shipped JS
  // declarations omit them; keep the compatibility surface local to this adapter.
  readonly #manager = new DrawingManager() as DrawingManagerWithSettings;
  readonly #registry = getToolRegistry();
  #chart: IChartApi | null = null;
  #container: HTMLElement | null = null;
  #disposed = false;
  readonly #unsubscribeLifecycle: () => void;

  constructor(private readonly series: SeriesManager) {
    this.#unsubscribeLifecycle = series.subscribeLifecycle(({ action, id }) => {
      if (action === 'removing') {
        for (const drawing of this.#manager.getAllDrawings()) {
          if (drawing.seriesId === id && drawing.isAttached()) drawing.detach();
        }
      } else {
        this.syncSeries();
      }
    });
  }

  get isAttached(): boolean {
    return this.#manager.isAttached();
  }

  get activeTool(): string | null {
    return this.#manager.getActiveTool();
  }

  /** Activates a registered tool; subsequent chart clicks place its required anchors. */
  setActiveTool(type: string | null): void {
    this.#assertAttached();
    if (type !== null && !this.#registry.getAll().some((tool) => tool.type === type)) {
      throw new Error(`Unknown drawing tool "${type}".`);
    }
    this.#manager.setActiveTool(type);
  }

  on(event: string, listener: (event: unknown) => void): () => void {
    return this.#manager.on(event, listener);
  }

  get tools(): readonly { type: string; name: string; category: string; requiredAnchors: number }[] {
    return this.#registry.getAll();
  }

  attach(chart: IChartApi, container: HTMLElement): void {
    if (this.#disposed) throw new Error('DrawingController was disposed; create a new one.');
    if (this.#chart !== null) {
      if (this.#chart === chart && this.#container === container) return;
      throw new Error('DrawingController is already attached to another chart.');
    }
    this.#chart = chart;
    this.#container = container;
    this.#manager.attach(
      chart,
      this.series.get<SeriesType>('price') ?? null,
      container,
      (api) => this.#idForSeries(api),
      (id) => this.series.get<SeriesType>(id),
      (paneIndex) => this.series.list()
        .map(({ id }) => this.series.get<SeriesType>(id))
        .find((api) => api?.getPane().paneIndex() === paneIndex),
    );
  }

  /** Create and register a drawing on an existing series. Anchors may be empty for interactive tools. */
  create(type: string, id: string, seriesId = 'price', anchors: DrawingJSON['anchors'] = []): DrawingInstance {
    this.#assertAttached();
    const api = this.series.get<SeriesType>(seriesId);
    if (!api) throw new Error(`Cannot create drawing: unknown series "${seriesId}".`);
    const drawing = this.#registry.createDrawing(type, id, anchors, {}, {});
    if (!drawing) throw new Error(`Unknown drawing tool "${type}".`);
    this.#manager.addDrawing(drawing, api);
    return drawing;
  }

  get selectedDrawing(): DrawingSettingsDrawing | null {
    return this.#manager.getSelectedDrawing();
  }

  updateSelected(patch: {
    style?: Partial<DrawingSettingsDrawing['style']>;
    options?: Partial<NonNullable<DrawingSettingsDrawing['options']>>;
    trendLineOptions?: Record<string, boolean>;
  }): void {
    const drawing = this.#manager.getSelectedDrawing();
    if (!drawing) return;
    if (patch.style) drawing.style = { ...drawing.style, ...patch.style };
    const configurable = drawing;
    if (patch.options) {
      drawing.options = { ...drawing.options, ...patch.options };
      // TrendLine serializes its extended option set separately from the base options.
      configurable.setTrendLineOptions?.(patch.options as Record<string, unknown>);
    }
    if (patch.trendLineOptions) configurable.setTrendLineOptions?.(patch.trendLineOptions);
    this.#manager.notifyDrawingUpdated(drawing.id);
  }

  deselectAll(): void {
    this.#manager.deselectAll();
  }

  removeSelected(): void {
    const drawing = this.#manager.getSelectedDrawing();
    if (drawing) this.#manager.removeDrawing(drawing.id);
  }

  remove(id: string): void {
    this.#manager.removeDrawing(id);
  }

  clear(): void {
    this.#manager.clearAll();
  }

  export(): DrawingJSON[] {
    return this.#manager.exportDrawings();
  }

  import(items: readonly DrawingJSON[]): void {
    this.#assertAttached();
    this.#manager.importDrawings(
      [...items],
      (type, item) => {
        const drawing = this.#registry.createDrawing(type, item.id, item.anchors, item.style ?? {}, item.options ?? {});
        drawing?.fromJSON(item);
        return drawing;
      },
      (paneIndex) => this.series.list().map(({ id }) => this.series.get<SeriesType>(id)).find((api) => api?.getPane().paneIndex() === paneIndex),
      (seriesId) => this.series.get<SeriesType>(seriesId),
    );
  }

  /** Reattaches previously unresolved drawings when their stable series becomes available. */
  syncSeries(): void {
    if (this.#chart === null || this.#container === null) return;
    for (const drawing of this.#manager.getAllDrawings()) {
      if (drawing.isAttached()) continue;
      const id = drawing.seriesId;
      const api = id ? this.series.get<SeriesType>(id) : this.series.get<SeriesType>('price');
      if (api) drawing.attach(api, this.#chart, this.#container);
    }
  }

  /** Recalculate logical positions from stable timestamps after the chart dataset changes. */
  rebaseLogicalAnchors(): void {
    this.#manager.rebaseLogicalAnchors();
  }

  /** Retained for callers that explicitly shift an existing logical-only viewport. */
  shiftLogicalAnchors(added: number): void {
    this.#manager.shiftLogicalAnchors(added);
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#unsubscribeLifecycle();
    this.#manager.detach();
    this.#chart = null;
    this.#container = null;
  }

  #idForSeries(api: ISeriesApi<SeriesType>): string | undefined {
    return this.series.list().find(({ id }) => this.series.get<SeriesType>(id) === api)?.id;
  }

  #assertAttached(): void {
    if (this.#chart === null || this.#container === null) throw new Error('DrawingController is not attached.');
  }
}
