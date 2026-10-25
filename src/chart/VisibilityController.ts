import type { ISeriesApi, SeriesType } from 'lightweight-charts';
import { EventChannel, type Unsubscribe } from '../utils/eventChannel';
import type { PaneId, PaneManager } from './PaneManager';
import type { AddSeriesSpec, SeriesId, SeriesManager } from './SeriesManager';
import type { VisibilityModel, VisibilitySnapshot } from './VisibilityModel';

export interface ManagedSeriesSpec<T extends SeriesType> extends AddSeriesSpec<T> {
  /** Initial visibility (default true). A series can be created hidden. */
  readonly visible?: boolean;
}

/**
 * The single door for showing, hiding, adding and removing chart series. UI code (menus, SMA
 * dropdown, indicator controller) calls this and never decides anything about panes itself.
 *
 * It keeps the VisibilityModel (the state) and the chart (the effect) in step, using the right library
 * operation for each behaviour:
 *  - hide / show a SERIES          -> series `visible` option (data, options and pane all stay);
 *  - the last visible series of a pane is hidden -> the PANE is collapsed (stretch factor 0) after saving
 *    its current stretch factor, and restored to exactly that factor when a series is shown again;
 *  - removal (explicit, for good)  -> the series is removed; the library deletes a pane that empties,
 *    and the logical slot (and remembered size) stay for when it returns.
 * `IPaneApi.setHeight` is never used: it rewrites every pane's stretch factor. See
 * docs/lightweight-charts-notes.md for the measurements behind this.
 */
export class VisibilityController {
  readonly #changes = new EventChannel<VisibilitySnapshot>();
  /** Panes currently collapsed in the chart. */
  readonly #collapsed = new Set<PaneId>();
  /** Last expanded stretch factor of a pane, kept even while the library has no such pane. */
  readonly #savedStretch = new Map<PaneId, number>();
  #snapshot: VisibilitySnapshot;

  constructor(
    private readonly series: SeriesManager,
    private readonly panes: PaneManager,
    private readonly model: VisibilityModel,
  ) {
    this.#snapshot = model.snapshot();
  }

  // ---- reading ---------------------------------------------------------------------------------

  /** Stable between changes, so it can back `useSyncExternalStore` directly. */
  getSnapshot = (): VisibilitySnapshot => this.#snapshot;

  subscribe = (listener: (snapshot: VisibilitySnapshot) => void): Unsubscribe => this.#changes.subscribe(listener);

  hasSeries(id: SeriesId): boolean {
    return this.model.hasSeries(id);
  }

  isSeriesVisible(id: SeriesId): boolean {
    return this.model.isSeriesVisible(id);
  }

  isPaneVisible(paneId: PaneId): boolean {
    return this.model.isPaneVisible(paneId);
  }

  visiblePaneOrder(): readonly PaneId[] {
    return this.model.visiblePaneOrder();
  }

  // ---- changing --------------------------------------------------------------------------------

  addSeries<T extends SeriesType>(spec: ManagedSeriesSpec<T>): ISeriesApi<T> {
    const visible = spec.visible ?? true;
    if (!visible && this.model.isPermanent(spec.id)) throw new Error(`Series "${spec.id}" is permanent and cannot be hidden.`);
    const paneExisted = this.panes.isMaterialized(spec.paneId);

    // Create it already in its final visibility (no flash of a series that should be hidden).
    // `visible` is only passed when false: true is the library default, and this keeps the options minimal.
    const options = visible ? spec.options : ({ ...spec.options, visible: false } as NonNullable<typeof spec.options>);
    const api = this.series.add({
      id: spec.id,
      definition: spec.definition,
      paneId: spec.paneId,
      ...(options === undefined ? {} : { options }),
    });
    this.model.registerSeries(spec.id, spec.paneId, visible);
    this.#syncPane(spec.paneId, !paneExisted);
    this.#publish();
    return api;
  }

  setSeriesVisible(id: SeriesId, visible: boolean): void {
    const change = this.model.setSeriesVisible(id, visible); // throws for unknown or permanent series
    if (change.series.length === 0) return; // already in that state
    try {
      this.series.setVisible(id, visible);
    } catch (error) {
      this.model.setSeriesVisible(id, !visible); // the chart refused: keep state and chart in agreement
      throw error;
    }
    for (const pane of change.panes) this.#syncPane(pane.paneId, false);
    this.#publish();
  }

  toggleSeries(id: SeriesId): boolean {
    const next = !this.model.isSeriesVisible(id);
    this.setSeriesVisible(id, next);
    return next;
  }

  /** Removes a series for good (not hiding). The price series cannot be removed. */
  removeSeries(id: SeriesId): void {
    const paneId = this.series.list().find((s) => s.id === id)?.paneId;
    // The library deletes a pane when its last series goes. Remember the size it had (unless it is
    // collapsed, in which case the size saved at collapse time is the real one) for when it returns.
    if (paneId !== undefined && this.model.seriesInPane(paneId).length === 1 && !this.#collapsed.has(paneId)) {
      const current = this.series.require(id).getPane().getStretchFactor();
      if (current > 0 && !this.series.isProtected(id)) this.#savedStretch.set(paneId, current);
    }
    this.series.remove(id); // throws for unknown or protected ids, before anything changes
    this.model.unregisterSeries(id);
    if (paneId !== undefined) this.#syncPane(paneId, false);
    this.#publish();
  }

  dispose(): void {
    this.#changes.clear();
    this.#collapsed.clear();
  }

  // ---- applying the state to the chart ---------------------------------------------------------

  /**
   * Makes the chart's pane match the model: collapsed when the pane is derived-hidden, at its saved size
   * when visible. Idempotent. `created` is true when the library just made this pane, so a size
   * remembered from an earlier life of the pane is applied.
   */
  #syncPane(paneId: PaneId, created: boolean): void {
    if (!this.panes.isMaterialized(paneId)) {
      this.#collapsed.delete(paneId); // the library deleted the empty pane; its saved size is kept
      return;
    }
    if (created) this.#collapsed.delete(paneId);

    const visible = this.model.isPaneVisible(paneId);
    const isCollapsed = this.#collapsed.has(paneId);
    const remembered = created ? this.#savedStretch.get(paneId) : undefined;
    const collapse = !visible && !isCollapsed;
    const restore = visible && isCollapsed;
    // Most calls (e.g. the very first series of the price pane) need no pane change: do not touch the pane API.
    if (remembered === undefined && !collapse && !restore) return;

    const member = this.series.list().find((s) => s.paneId === paneId);
    if (member === undefined) return;
    const pane = this.series.require(member.id).getPane();

    if (remembered !== undefined) pane.setStretchFactor(remembered); // a pane the library re-created: its old size
    if (collapse) {
      const current = pane.getStretchFactor();
      if (current > 0) this.#savedStretch.set(paneId, current); // what the user (or default) had
      pane.setStretchFactor(0);
      this.#collapsed.add(paneId);
    } else if (restore) {
      pane.setStretchFactor(this.#savedStretch.get(paneId) ?? 1);
      this.#collapsed.delete(paneId);
    }
  }

  #publish(): void {
    this.#snapshot = this.model.snapshot();
    this.#changes.emit(this.#snapshot);
  }
}
