import type { PaneId } from '../chart/PaneManager';
import type { SeriesReader } from '../chart/SeriesManager';
import type { VisibilityController } from '../chart/VisibilityController';
import type { Candle } from '../types/marketData';
import { EventChannel, type Unsubscribe } from '../utils/eventChannel';
import { IndicatorConfigError, assertSmaPeriod, type IndicatorChange, type IndicatorEngine } from './IndicatorEngine';
import type { SmaSourceOption } from './IndicatorRegistry';
import type { OutputSeriesStyle, SeriesStyleProvider } from './seriesStyles';
import type { ParamSpecInfo } from './params';
import type { Params, SmaSource, Value } from './types';

/** What the chart layer must offer the workspace: add/show/hide/remove (visibility) and look up (series). */
export interface ChartSurface {
  readonly visibility: VisibilityController;
  readonly series: SeriesReader;
}

export const DEFAULT_SMA_PERIOD = 20;

export interface IndicatorRowState {
  readonly definitionId: string;
  readonly name: string;
  /** Derived: true while at least one output series is visible. */
  readonly displayed: boolean;
  readonly outputs: readonly { readonly key: string; readonly label: string; readonly visible: boolean }[];
  readonly params: Params;
  readonly paramSpecs: readonly ParamSpecInfo[];
}

export interface SmaRowState {
  readonly key: string;
  readonly label: string;
  readonly enabled: boolean;
  readonly period: number;
  /** Null for price (always shown); otherwise whether the source indicator itself is currently displayed. */
  readonly sourceDisplayed: boolean | null;
}

export interface WorkspaceSnapshot {
  readonly indicators: readonly IndicatorRowState[];
  readonly smas: readonly SmaRowState[];
}

interface Realized {
  readonly outputKey: string;
  readonly seriesId: string;
  readonly style: OutputSeriesStyle;
  /** Lines can bridge a gap; histograms cannot (an absent bar is just absent). */
  readonly kind: 'line' | 'histogram';
}

/**
 * Chart libraries draw a line series straight across missing points (measured: lightweight-charts 5.2.1 ignores
 * whitespace for lines). A line segment is drawn in the colour of the point it STARTS from (measured), so the last
 * point before an interior gap gets this fully transparent colour, which makes the bridge invisible: a missing value
 * shows as a gap.
 */
export const GAP_COLOR = 'rgba(0, 0, 0, 0)';

/** The chart-side series API as the workspace uses it (kept structural so tests can fake it). */
interface DataSink {
  setData(points: unknown[]): void;
  update(point: unknown): void;
}

const smaInstanceId = (key: string): string => `sma-${key.replace(':', '-')}`;
const smaSeriesId = (key: string): string => `sma:${key}`;
const outputSeriesId = (definitionId: string, outputKey: string): string => `${definitionId}:${outputKey}`;

/**
 * Connects the calculation engine to chart series and holds the user's indicator and SMA settings.
 *
 * Four things are kept apart (spec section 8): an indicator being AVAILABLE (registry), CONFIGURED (its
 * parameters / SMA period, here and in the engine), DISPLAYED (its series are visible: derived from the
 * visibility controller, never stored here) and INITIALISED (its series exist: created the first time it is
 * shown, then only ever hidden and shown). Calculations stay cached while an indicator is hidden, and series
 * keep receiving data while hidden, so showing one is instant and never stale.
 *
 * Menus call this and nothing else: they hold no indicator state of their own.
 */
export class IndicatorWorkspace {
  readonly #changes = new EventChannel<WorkspaceSnapshot>();
  readonly #sources: readonly SmaSourceOption[];
  readonly #smaConfig = new Map<string, { period: number; enabled: boolean }>();
  /** Series that exist, by engine instance id. */
  readonly #realized = new Map<string, Realized[]>();
  readonly #stops: Unsubscribe[] = [];
  #snapshot: WorkspaceSnapshot;

  constructor(
    private readonly engine: IndicatorEngine,
    private readonly chart: ChartSurface,
    private readonly styles: SeriesStyleProvider,
  ) {
    this.#sources = engine.registry.smaSourceOptions();
    for (const source of this.#sources) this.#smaConfig.set(source.key, { period: DEFAULT_SMA_PERIOD, enabled: false });
    this.#snapshot = this.#buildSnapshot();
    this.#stops.push(engine.subscribe((change) => this.#onEngineChange(change)));
    // Anything that changes visibility (including a caller that is not this class) is reflected in the snapshot.
    this.#stops.push(chart.visibility.subscribe(() => this.#refresh()));
  }

  // ---- reading ---------------------------------------------------------------------------------

  /** Stable between changes, so it can back `useSyncExternalStore` directly. */
  getSnapshot = (): WorkspaceSnapshot => this.#snapshot;

  subscribe = (listener: (snapshot: WorkspaceSnapshot) => void): Unsubscribe => this.#changes.subscribe(listener);

  // ---- indicators ------------------------------------------------------------------------------

  /** Shows (all outputs) or hides an indicator. Showing creates its calculation and series on first use only. */
  setIndicatorDisplayed(definitionId: string, displayed: boolean): void {
    const definition = this.engine.registry.get(definitionId);
    if (displayed) {
      this.#ensureIndicator(definitionId);
      for (const output of definition.outputs) this.chart.visibility.setSeriesVisible(this.#ensureOutputSeries(definitionId, output.key), true);
    } else {
      for (const output of definition.outputs) {
        const id = outputSeriesId(definitionId, output.key);
        if (this.chart.visibility.hasSeries(id)) this.chart.visibility.setSeriesVisible(id, false);
      }
    }
    this.#refresh();
  }

  toggleIndicator(definitionId: string): boolean {
    const next = !this.#isDisplayed(definitionId);
    this.setIndicatorDisplayed(definitionId, next);
    return next;
  }

  /** Shows or hides one output line of a multi-output indicator (e.g. MACD's signal) independently. */
  setOutputVisible(definitionId: string, outputKey: string, visible: boolean): void {
    this.engine.registry.outputOf(definitionId, outputKey); // throws for an unknown output
    if (visible) {
      this.#ensureIndicator(definitionId);
      this.chart.visibility.setSeriesVisible(this.#ensureOutputSeries(definitionId, outputKey), true);
    } else {
      const id = outputSeriesId(definitionId, outputKey);
      if (this.chart.visibility.hasSeries(id)) this.chart.visibility.setSeriesVisible(id, false);
    }
    this.#refresh();
  }

  /** Changes some parameters. Invalid values throw IndicatorConfigError and change nothing. */
  setIndicatorParams(definitionId: string, patch: Record<string, number>): void {
    this.#ensureIndicator(definitionId);
    this.engine.setParams(definitionId, patch); // recomputes it and any SMA that reads it; series follow via engine events
    this.#refresh();
  }

  // ---- SMA -------------------------------------------------------------------------------------

  /** Turns the SMA of one source on or off. Off keeps its period and calculation; it only hides the line. */
  setSmaEnabled(sourceKey: string, enabled: boolean): void {
    const config = this.#smaConfigOf(sourceKey);
    if (enabled) {
      this.#ensureSma(sourceKey);
      this.chart.visibility.setSeriesVisible(smaSeriesId(sourceKey), true);
    } else if (this.chart.visibility.hasSeries(smaSeriesId(sourceKey))) {
      this.chart.visibility.setSeriesVisible(smaSeriesId(sourceKey), false);
    }
    config.enabled = enabled;
    this.#refresh();
  }

  /** Changes an SMA's period, whether or not it is currently shown. Invalid values throw and change nothing. */
  setSmaPeriod(sourceKey: string, period: number): void {
    const config = this.#smaConfigOf(sourceKey);
    assertSmaPeriod(period);
    if (this.engine.has(smaInstanceId(sourceKey))) this.engine.setSmaPeriod(smaInstanceId(sourceKey), period);
    config.period = period; // applied at creation time otherwise
    this.#refresh();
  }

  dispose(): void {
    for (const stop of this.#stops) stop();
    this.#stops.length = 0;
    this.#changes.clear();
  }

  // ---- creating what is needed, once -----------------------------------------------------------

  #ensureIndicator(definitionId: string): void {
    if (!this.engine.has(definitionId)) this.engine.addIndicator({ definitionId });
  }

  /** Creates the series for one output if it does not exist yet (hidden state is decided by the caller). */
  #ensureOutputSeries(definitionId: string, outputKey: string): string {
    const id = outputSeriesId(definitionId, outputKey);
    if (this.chart.visibility.hasSeries(id)) return id;

    const definition = this.engine.registry.get(definitionId);
    const output = this.engine.registry.outputOf(definitionId, outputKey);
    const style = this.styles.forOutput(definitionId, output);
    const paneId: PaneId = definition.pane.kind === 'own' ? definition.pane.paneId : 'price';
    this.#realize(definitionId, { outputKey, seriesId: id, style, kind: output.kind }, paneId);
    return id;
  }

  #ensureSma(sourceKey: string): void {
    const config = this.#smaConfigOf(sourceKey);
    const source = this.#sources.find((s) => s.key === sourceKey)!;
    const instanceId = smaInstanceId(sourceKey);

    if (!this.engine.has(instanceId)) {
      let smaSource: SmaSource = { kind: 'price' };
      if (source.definitionId !== null) {
        this.#ensureIndicator(source.definitionId); // its calculation is needed even if it is not displayed
        smaSource = { kind: 'indicator', instanceId: source.definitionId, output: source.output! };
      }
      this.engine.addSma({ id: instanceId, source: smaSource, period: config.period });
    }

    const seriesId = smaSeriesId(sourceKey);
    if (!this.chart.visibility.hasSeries(seriesId)) {
      // The SMA lives in its SOURCE's pane, on the same scale: price -> price pane, an indicator -> that indicator's pane.
      let paneId: PaneId = 'price';
      if (source.definitionId !== null) {
        const pane = this.engine.registry.get(source.definitionId).pane;
        paneId = pane.kind === 'own' ? pane.paneId : 'price';
      }
      const ordinal = this.#sources.findIndex((s) => s.key === sourceKey);
      this.#realize(instanceId, { outputKey: 'sma', seriesId, style: this.styles.forSma(sourceKey, ordinal), kind: 'line' }, paneId);
    }
  }

  /** Adds the chart series (created visible, data loaded) and remembers it as belonging to its engine instance. */
  #realize(instanceId: string, realized: Realized, paneId: PaneId): void {
    this.chart.visibility.addSeries({
      id: realized.seriesId,
      definition: realized.style.definition as never,
      options: realized.style.options as never,
      paneId,
    });
    const list = this.#realized.get(instanceId) ?? [];
    list.push(realized);
    this.#realized.set(instanceId, list);
    this.#resetSeriesData(instanceId, realized);
  }

  // ---- engine -> chart data --------------------------------------------------------------------

  #onEngineChange(change: IndicatorChange): void {
    if (change.type === 'removed') {
      this.#realized.delete(change.instanceId);
      return;
    }
    for (const realized of this.#realized.get(change.instanceId) ?? []) {
      if (change.type === 'reset' || this.#closesGap(realized, this.engine.values(change.instanceId, realized.outputKey), change.index)) {
        // A point that ends an interior gap changes the colour of an OLDER point, which the library's update() cannot do.
        this.#resetSeriesData(change.instanceId, realized);
        continue;
      }
      const value = change.values[realized.outputKey] ?? null;
      this.#sink(realized).update(this.#point(change.time, value, realized, this.engine.candles[change.index], false));
    }
  }

  #resetSeriesData(instanceId: string, realized: Realized): void {
    const times = this.engine.times;
    const values = this.engine.values(instanceId, realized.outputKey);
    const candles = this.engine.candles;
    let lastValid = -1;
    for (let i = values.length - 1; i >= 0; i--) {
      if (values[i] !== null) {
        lastValid = i;
        break;
      }
    }
    // A valid point followed by a missing one, with another valid point later: the line must not bridge that gap.
    const points = values.map((value, i) => this.#point(times[i]!, value, realized, candles[i], i < lastValid && values[i + 1] === null));
    this.#sink(realized).setData(points);
  }

  /** True when a new line point ends an interior gap (its predecessor is missing but an earlier value exists). */
  #closesGap(realized: Realized, column: readonly Value[], index: number): boolean {
    if (realized.kind !== 'line' || index === 0 || column[index] === null || column[index - 1] !== null) return false;
    for (let i = index - 2; i >= 0; i--) if (column[i] !== null) return true;
    return false;
  }

  /**
   * One chart point. A missing value is a whitespace point (time only). A line point just before an interior gap carries
   * the transparent GAP_COLOR so the line is not bridged across the gap.
   */
  #point(time: number, value: Value, realized: Realized, candle: Candle | undefined, breaksAfter: boolean): unknown {
    if (value === null) return { time };
    if (breaksAfter && realized.kind === 'line') return { time, value, color: GAP_COLOR };
    const color = realized.style.pointColor?.(value, candle);
    return color === undefined ? { time, value } : { time, value, color };
  }

  #sink(realized: Realized): DataSink {
    return this.chart.series.require(realized.seriesId) as unknown as DataSink;
  }

  // ---- derived state ---------------------------------------------------------------------------

  #isDisplayed(definitionId: string): boolean {
    return this.engine.registry
      .get(definitionId)
      .outputs.some((o) => {
        const id = outputSeriesId(definitionId, o.key);
        return this.chart.visibility.hasSeries(id) && this.chart.visibility.isSeriesVisible(id);
      });
  }

  #smaConfigOf(key: string): { period: number; enabled: boolean } {
    const config = this.#smaConfig.get(key);
    if (config === undefined) throw new IndicatorConfigError(`Unknown SMA source "${key}".`);
    return config;
  }

  #refresh(): void {
    this.#snapshot = this.#buildSnapshot();
    this.#changes.emit(this.#snapshot);
  }

  #buildSnapshot(): WorkspaceSnapshot {
    const visibility = this.chart.visibility;
    const indicators = this.engine.registry.list().map((def): IndicatorRowState => ({
      definitionId: def.id,
      name: def.name,
      displayed: this.#isDisplayed(def.id),
      outputs: def.outputs.map((o) => {
        const id = outputSeriesId(def.id, o.key);
        return { key: o.key, label: o.label, visible: visibility.hasSeries(id) && visibility.isSeriesVisible(id) };
      }),
      params: this.engine.has(def.id) ? (this.engine.get(def.id) as { params: Params }).params : def.defaults,
      paramSpecs: def.paramSpecs,
    }));
    const smas = this.#sources.map((source): SmaRowState => {
      const config = this.#smaConfig.get(source.key)!;
      const seriesId = smaSeriesId(source.key);
      return {
        key: source.key,
        label: source.label,
        // Derived from the real series when it exists; the stored flag covers "enabled but not realised yet".
        enabled: visibility.hasSeries(seriesId) ? visibility.isSeriesVisible(seriesId) : config.enabled,
        period: config.period,
        sourceDisplayed: source.definitionId === null ? null : this.#isDisplayed(source.definitionId),
      };
    });
    return { indicators, smas };
  }
}
