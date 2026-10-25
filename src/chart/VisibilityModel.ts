import type { PaneId, PaneManager } from './PaneManager';
import type { SeriesId } from './SeriesManager';

export interface SeriesVisibility {
  readonly id: SeriesId;
  readonly paneId: PaneId;
  readonly visible: boolean;
}

export interface PaneVisibility {
  readonly paneId: PaneId;
  /** Derived: true while at least one of the pane's series is visible. Never set directly. */
  readonly visible: boolean;
  readonly seriesIds: readonly SeriesId[];
}

export interface VisibilitySnapshot {
  readonly series: readonly SeriesVisibility[];
  /** In logical pane order, hidden panes included. */
  readonly panes: readonly PaneVisibility[];
}

/** What a transition changed: the series involved and the panes whose derived visibility flipped. */
export interface VisibilityChange {
  readonly series: readonly SeriesVisibility[];
  readonly panes: readonly { readonly paneId: PaneId; readonly visible: boolean }[];
}

export const NO_CHANGE: VisibilityChange = Object.freeze({ series: [], panes: [] });

/**
 * The single source of truth for what is shown. Pure state, no chart.
 *
 * Rules (spec section 9):
 *  - every series has its own visibility;
 *  - a pane's visibility is DERIVED: visible while any series in it is visible, hidden when all are;
 *  - a pane that holds a permanent series (the price series) is therefore always visible;
 *  - an SMA is just another series: its visibility is independent of the indicator it reads;
 *  - hiding never removes anything: configuration, series and pane slots stay.
 * Pane ORDER is not stored here; it comes from the PaneManager, which keeps it across pane deletion.
 */
export class VisibilityModel {
  readonly #series = new Map<SeriesId, { paneId: PaneId; visible: boolean }>();

  constructor(
    private readonly panes: PaneManager,
    /** Series that can never be hidden or unregistered. */
    private readonly permanent: ReadonlySet<SeriesId> = new Set(),
  ) {}

  isPermanent(id: SeriesId): boolean {
    return this.permanent.has(id);
  }

  hasSeries(id: SeriesId): boolean {
    return this.#series.has(id);
  }

  isSeriesVisible(id: SeriesId): boolean {
    return this.#entry(id).visible;
  }

  seriesInPane(paneId: PaneId): readonly SeriesId[] {
    return [...this.#series].filter(([, s]) => s.paneId === paneId).map(([id]) => id);
  }

  /** A pane with no series at all is hidden. */
  isPaneVisible(paneId: PaneId): boolean {
    for (const s of this.#series.values()) if (s.paneId === paneId && s.visible) return true;
    return false;
  }

  /** Visible panes in logical order. */
  visiblePaneOrder(): readonly PaneId[] {
    return this.panes.order.filter((p) => this.isPaneVisible(p));
  }

  registerSeries(id: SeriesId, paneId: PaneId, visible = true): VisibilityChange {
    if (this.#series.has(id)) throw new Error(`Series "${id}" is already registered.`);
    if (this.permanent.has(id) && !visible) throw new Error(`Series "${id}" is permanent and cannot be hidden.`);
    this.panes.register(paneId);
    const before = this.isPaneVisible(paneId);
    this.#series.set(id, { paneId, visible });
    return this.#change([{ id, paneId, visible }], paneId, before);
  }

  /** Forgets a series (it is being removed for good). The pane keeps its logical slot. */
  unregisterSeries(id: SeriesId): VisibilityChange {
    const entry = this.#entry(id);
    if (this.permanent.has(id)) throw new Error(`Series "${id}" is permanent and cannot be removed.`);
    const before = this.isPaneVisible(entry.paneId);
    this.#series.delete(id);
    return this.#change([{ id, paneId: entry.paneId, visible: false }], entry.paneId, before);
  }

  /** Idempotent: setting the state a series already has changes nothing and reports no change. */
  setSeriesVisible(id: SeriesId, visible: boolean): VisibilityChange {
    const entry = this.#entry(id);
    if (entry.visible === visible) return NO_CHANGE;
    if (this.permanent.has(id) && !visible) throw new Error(`Series "${id}" is permanent and cannot be hidden.`);
    const before = this.isPaneVisible(entry.paneId);
    entry.visible = visible;
    return this.#change([{ id, paneId: entry.paneId, visible }], entry.paneId, before);
  }

  snapshot(): VisibilitySnapshot {
    return {
      series: [...this.#series].map(([id, s]) => ({ id, paneId: s.paneId, visible: s.visible })),
      panes: this.panes.order.map((paneId) => ({
        paneId,
        visible: this.isPaneVisible(paneId),
        seriesIds: this.seriesInPane(paneId),
      })),
    };
  }

  #change(series: SeriesVisibility[], paneId: PaneId, paneWasVisible: boolean): VisibilityChange {
    const now = this.isPaneVisible(paneId);
    return { series, panes: now === paneWasVisible ? [] : [{ paneId, visible: now }] };
  }

  #entry(id: SeriesId): { paneId: PaneId; visible: boolean } {
    const entry = this.#series.get(id);
    if (entry === undefined) throw new Error(`Unknown series "${id}".`);
    return entry;
  }
}
