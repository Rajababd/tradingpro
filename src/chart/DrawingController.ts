import type { IChartApi, ISeriesApi, SeriesType } from 'lightweight-charts';
import { DrawingManager, getToolRegistry, type DrawingInstance, type DrawingJSON } from '../vendor/lightweight-charts-drawing.es.js';
import type { SeriesManager } from './SeriesManager';

/**
 * Owns the drawing library lifecycle and resolves drawings by stable series identity.
 * The manager is intentionally separate from React so saved drawings remain plain JSON.
 */
export class DrawingController {
  readonly #manager = new DrawingManager();
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
