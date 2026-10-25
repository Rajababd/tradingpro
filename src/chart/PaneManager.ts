/** Stable logical identity of a pane. Never a chart-library index. */
export type PaneId = string;

export const PRICE_PANE_ID: PaneId = 'price';

/**
 * Bookkeeping for panes: logical order plus which panes currently hold series.
 *
 * Why this exists: the chart library identifies panes by a shifting index. It
 * creates a pane when a series is added after the last pane, and silently deletes
 * a pane when its last series is removed (later panes shift down). This class keeps
 * a stable logical order that survives those events, so a pane that disappears
 * and comes back returns to its previous slot (spec section 9, rule 6).
 *
 * It has no dependency on the chart library; SeriesManager keeps it in sync.
 */
export class PaneManager {
  readonly #order: PaneId[] = [PRICE_PANE_ID];
  readonly #seriesCount = new Map<PaneId, number>();

  /** Logical order, including panes that currently hold no series. */
  get order(): readonly PaneId[] {
    return [...this.#order];
  }

  has(id: PaneId): boolean {
    return this.#order.includes(id);
  }

  /** Adds a logical slot at the end of the order. Idempotent. */
  register(id: PaneId): void {
    if (!this.has(id)) this.#order.push(id);
  }

  /** True while the pane holds at least one series (so the chart has a real pane for it). */
  isMaterialized(id: PaneId): boolean {
    return (this.#seriesCount.get(id) ?? 0) > 0;
  }

  /** Number of panes that currently exist in the chart. */
  get materializedCount(): number {
    return this.#order.filter((id) => this.isMaterialized(id)).length;
  }

  /**
   * The chart index this pane has, or would get if created now, in a layout that
   * honours the logical order: the number of existing panes that come before it.
   */
  indexFor(id: PaneId): number {
    const position = this.#order.indexOf(id);
    if (position === -1) throw new Error(`Unknown pane "${id}".`);
    return this.#order.slice(0, position).filter((p) => this.isMaterialized(p)).length;
  }

  seriesCount(id: PaneId): number {
    return this.#seriesCount.get(id) ?? 0;
  }

  noteSeriesAdded(id: PaneId): void {
    this.#seriesCount.set(id, this.seriesCount(id) + 1);
  }

  noteSeriesRemoved(id: PaneId): void {
    const next = this.seriesCount(id) - 1;
    if (next < 0) throw new Error(`Pane "${id}" has no series to remove.`);
    this.#seriesCount.set(id, next);
  }

  /**
   * Permanently drops a pane's logical slot (a future "remove indicator for good"
   * action). The price pane can never be forgotten, and a pane that still holds
   * series cannot be forgotten.
   */
  forget(id: PaneId): void {
    if (id === PRICE_PANE_ID) throw new Error('The price pane cannot be removed.');
    if (this.seriesCount(id) > 0) throw new Error(`Pane "${id}" still holds series.`);
    const position = this.#order.indexOf(id);
    if (position !== -1) this.#order.splice(position, 1);
    this.#seriesCount.delete(id);
  }
}
