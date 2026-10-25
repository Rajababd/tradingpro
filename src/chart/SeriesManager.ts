import type {
  ISeriesApi,
  SeriesDefinition,
  SeriesPartialOptionsMap,
  SeriesType,
} from 'lightweight-charts';
import type { ChartPort } from './ChartPort';
import type { PaneId, PaneManager } from './PaneManager';

export type SeriesId = string;

/** The permanent base candlestick series. It can never be removed. */
export const PRICE_SERIES_ID: SeriesId = 'price';

export interface AddSeriesSpec<T extends SeriesType> {
  readonly id: SeriesId;
  readonly definition: SeriesDefinition<T>;
  readonly options?: SeriesPartialOptionsMap[T];
  readonly paneId: PaneId;
}

/**
 * What code outside the chart layer may do with series: look at them. Creating, hiding and removing go
 * through the VisibilityController, so the visibility state and pane layout can never be bypassed.
 */
export type SeriesReader = Pick<SeriesManager, 'has' | 'get' | 'require' | 'list' | 'isVisible'>;

export type SeriesLifecycleEvent = { readonly action: 'added' | 'removing'; readonly id: SeriesId };

export interface SeriesInfo {
  readonly id: SeriesId;
  readonly paneId: PaneId;
  readonly type: SeriesType;
  readonly visible: boolean;
}

interface Entry {
  readonly id: SeriesId;
  readonly paneId: PaneId;
  readonly type: SeriesType;
  readonly api: ISeriesApi<SeriesType>;
  visible: boolean;
}

/**
 * Creates, finds, hides and removes chart series by stable id, and keeps the
 * PaneManager in sync. Rules:
 *  - one series per id (duplicates throw instead of silently stacking);
 *  - hiding is `visible: false`: the series, its data and its pane remain;
 *  - removal is explicit, and protected ids (the price series) cannot be removed;
 *  - nothing is recorded unless the chart accepted the operation.
 */
export class SeriesManager {
  readonly #entries = new Map<SeriesId, Entry>();
  readonly #listeners = new Set<(event: SeriesLifecycleEvent) => void>();

  subscribeLifecycle(listener: (event: SeriesLifecycleEvent) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  constructor(
    private readonly chart: ChartPort,
    private readonly panes: PaneManager,
    private readonly protectedIds: ReadonlySet<SeriesId> = new Set(),
  ) {}

  has(id: SeriesId): boolean {
    return this.#entries.has(id);
  }

  /** The series API, or undefined. The caller asserts the series type `T`. */
  get<T extends SeriesType>(id: SeriesId): ISeriesApi<T> | undefined {
    return this.#entries.get(id)?.api as ISeriesApi<T> | undefined;
  }

  require<T extends SeriesType>(id: SeriesId): ISeriesApi<T> {
    const api = this.get<T>(id);
    if (api === undefined) throw new Error(`Unknown series "${id}".`);
    return api;
  }

  list(): readonly SeriesInfo[] {
    return [...this.#entries.values()].map(({ id, paneId, type, visible }) => ({
      id,
      paneId,
      type,
      visible,
    }));
  }

  add<T extends SeriesType>(spec: AddSeriesSpec<T>): ISeriesApi<T> {
    const { id, definition, options, paneId } = spec;
    if (this.#entries.has(id)) throw new Error(`Series "${id}" already exists.`);

    this.panes.register(paneId);
    const wasMaterialized = this.panes.isMaterialized(paneId);
    const target = this.panes.indexFor(paneId);
    // A new pane can only be created at the end; an existing pane is addressed by its index.
    const insertAt = wasMaterialized ? target : this.panes.materializedCount;

    const api = this.chart.addSeries(definition, options, insertAt);

    if (!wasMaterialized && insertAt !== target) {
      // moveTo is unreliable in 5.2.1; bubble the new pane into its logical slot with adjacent swaps.
      try {
        for (let i = insertAt; i > target; i--) this.chart.swapPanes(i, i - 1);
      } catch (error) {
        try {
          this.chart.removeSeries(api);
        } catch {
          /* best effort: the original error matters more */
        }
        throw error;
      }
    }

    this.#entries.set(id, {
      id,
      paneId,
      type: definition.type,
      api: api as ISeriesApi<SeriesType>,
      visible: options?.visible ?? true,
    });
    this.panes.noteSeriesAdded(paneId);
    this.#emitLifecycle({ action: 'added', id });
    return api;
  }

  isProtected(id: SeriesId): boolean {
    return this.protectedIds.has(id);
  }

  isVisible(id: SeriesId): boolean {
    return this.#entry(id).visible;
  }

  /** Shows or hides a series. Never removes it, its data, or its pane. */
  setVisible(id: SeriesId, visible: boolean): void {
    const entry = this.#entry(id);
    entry.api.applyOptions({ visible });
    entry.visible = visible;
  }

  remove(id: SeriesId): void {
    if (this.protectedIds.has(id)) throw new Error(`Series "${id}" is protected and cannot be removed.`);
    const entry = this.#entry(id);
    this.#emitLifecycle({ action: 'removing', id });
    this.chart.removeSeries(entry.api);
    this.#entries.delete(id);
    // The chart deletes a pane when its last series goes; the logical slot is kept.
    this.panes.noteSeriesRemoved(entry.paneId);
  }

  /** Drops references only. The chart itself is destroyed separately. */
  dispose(): void {
    this.#entries.clear();
    this.#listeners.clear();
  }

  #emitLifecycle(event: SeriesLifecycleEvent): void {
    for (const listener of this.#listeners) listener(event);
  }

  #entry(id: SeriesId): Entry {
    const entry = this.#entries.get(id);
    if (entry === undefined) throw new Error(`Unknown series "${id}".`);
    return entry;
  }
}
