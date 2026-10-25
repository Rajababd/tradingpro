import type { Candle, UnixSeconds } from '../types/marketData';
import { EventChannel, type Unsubscribe } from '../utils/eventChannel';
import { createCalculator } from './calculator';
import { IndicatorRegistry, createDefaultRegistry } from './IndicatorRegistry';
import { smaKernel } from './sma';
import type { Calculator, IndicatorDefinition, OutputDef, Params, SmaSource, Value } from './types';

/** The caller asked for something invalid (unknown indicator, bad parameters, duplicate id, ...). */
export class IndicatorConfigError extends Error {
  constructor(
    message: string,
    readonly errors: readonly string[] = [message],
  ) {
    super(message);
    this.name = 'IndicatorConfigError';
  }
}

/** The data fed to the engine does not line up with what it holds (duplicate/old/out-of-order bar). */
export class IndicatorSyncError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'IndicatorSyncError';
  }
}

export type IndicatorChange =
  /** The instance's whole output was recomputed (data reset, prepend, new instance, parameter change). Re-read it. */
  | { readonly type: 'reset'; readonly instanceId: string }
  /** One bar of the instance changed. `index` is the bar's position in the engine's candle list. */
  | {
      readonly type: 'point';
      readonly instanceId: string;
      readonly kind: 'append' | 'update';
      readonly index: number;
      readonly time: UnixSeconds;
      readonly values: Readonly<Record<string, Value>>;
    }
  | { readonly type: 'removed'; readonly instanceId: string };

export interface IndicatorInstanceInfo {
  readonly kind: 'indicator';
  readonly id: string;
  readonly definitionId: string;
  readonly params: Params;
  readonly outputs: readonly OutputDef[];
}

export interface SmaInstanceInfo {
  readonly kind: 'sma';
  readonly id: string;
  readonly source: SmaSource;
  readonly period: number;
  readonly outputs: readonly OutputDef[];
}

export type InstanceInfo = IndicatorInstanceInfo | SmaInstanceInfo;

const SMA_OUTPUT: readonly OutputDef[] = [{ key: 'sma', label: 'SMA', kind: 'line', smaEligible: false }];
export const SMA_PERIOD = { min: 1, max: 1000 } as const;
const ID_PATTERN = /^[a-z][a-z0-9_-]*$/;

/** Throws IndicatorConfigError unless `period` is a whole number SMAs support. Shared so UIs validate identically. */
export function assertSmaPeriod(period: number): void {
  if (!Number.isInteger(period) || period < SMA_PERIOD.min || period > SMA_PERIOD.max) {
    throw new IndicatorConfigError(`SMA period must be a whole number between ${SMA_PERIOD.min} and ${SMA_PERIOD.max}.`);
  }
}

interface IndicatorInstance {
  readonly kind: 'indicator';
  readonly id: string;
  readonly definition: IndicatorDefinition;
  params: Params;
  calc: Calculator<Candle>;
}

interface SmaInstance {
  readonly kind: 'sma';
  readonly id: string;
  readonly source: SmaSource;
  period: number;
  calc: Calculator<Value>;
}

type Instance = IndicatorInstance | SmaInstance;

/**
 * Holds the candle list and every configured indicator and SMA over it, and keeps them current.
 *
 *  - Instances have stable, caller-chosen ids (two RSIs with different periods are just two ids).
 *  - A live tick on the latest bar re-steps each calculator from the state that preceded that bar,
 *    so it costs O(1), not a recompute. A prepend (older history) or reset recomputes everything,
 *    because every indicator value depends on all earlier bars and every index shifts.
 *  - SMAs are computed AFTER the indicators they read from, within the same change, so they always use
 *    the new value. Listeners are notified only once every instance is up to date.
 *  - It is independent of charts and visibility: hiding a series elsewhere does not stop calculation or
 *    discard anything here.
 */
export class IndicatorEngine {
  readonly #candles: Candle[] = [];
  readonly #times: UnixSeconds[] = [];
  readonly #instances = new Map<string, Instance>();
  readonly #changes = new EventChannel<IndicatorChange>();

  constructor(readonly registry: IndicatorRegistry = createDefaultRegistry()) {}

  get length(): number {
    return this.#candles.length;
  }

  /** The candles the outputs are computed from (needed e.g. to colour volume bars by direction). Live view: do not mutate. */
  get candles(): readonly Candle[] {
    return this.#candles;
  }

  /** Bar times, aligned one-to-one with every output column. Live view: do not mutate. */
  get times(): readonly UnixSeconds[] {
    return this.#times;
  }

  subscribe(listener: (change: IndicatorChange) => void): Unsubscribe {
    return this.#changes.subscribe(listener);
  }

  // ---- configuration ---------------------------------------------------------------------------

  addIndicator(spec: { definitionId: string; id?: string; params?: unknown }): IndicatorInstanceInfo {
    const id = spec.id ?? spec.definitionId;
    this.#assertNewId(id);
    const definition = this.#definition(spec.definitionId);
    const params = this.#validated(definition, spec.params);

    const calc = definition.createCalculator(params);
    calc.reset(this.#candles);
    this.#instances.set(id, { kind: 'indicator', id, definition, params, calc });
    this.#changes.emit({ type: 'reset', instanceId: id });
    return this.#info(this.#instances.get(id)!) as IndicatorInstanceInfo;
  }

  addSma(spec: { id: string; source: SmaSource; period: number }): SmaInstanceInfo {
    this.#assertNewId(spec.id);
    assertSmaPeriod(spec.period);
    this.#assertSmaSource(spec.source);

    const calc = createCalculator(smaKernel(spec.period));
    calc.reset(this.#sourceColumn(spec.source));
    this.#instances.set(spec.id, { kind: 'sma', id: spec.id, source: spec.source, period: spec.period, calc });
    this.#changes.emit({ type: 'reset', instanceId: spec.id });
    return this.#info(this.#instances.get(spec.id)!) as SmaInstanceInfo;
  }

  /** Changes some parameters of an indicator (others keep their current value) and recomputes it and its SMAs. */
  setParams(id: string, patch: unknown): IndicatorInstanceInfo {
    const instance = this.#instance(id);
    if (instance.kind !== 'indicator') throw new IndicatorConfigError(`"${id}" is an SMA; use setSmaPeriod.`);
    if (typeof patch !== 'object' || patch === null || Array.isArray(patch)) {
      throw new IndicatorConfigError('parameters must be an object');
    }
    instance.params = this.#validated(instance.definition, { ...instance.params, ...patch });
    instance.calc = instance.definition.createCalculator(instance.params);
    instance.calc.reset(this.#candles);
    this.#changes.emit({ type: 'reset', instanceId: id });
    this.#rebuildDependents(id);
    return this.#info(instance) as IndicatorInstanceInfo;
  }

  setSmaPeriod(id: string, period: number): SmaInstanceInfo {
    const instance = this.#instance(id);
    if (instance.kind !== 'sma') throw new IndicatorConfigError(`"${id}" is not an SMA.`);
    assertSmaPeriod(period);
    instance.period = period;
    this.#rebuildSma(instance);
    return this.#info(instance) as SmaInstanceInfo;
  }

  /** Removes an instance. Refused while an SMA still reads from it: remove those first. */
  remove(id: string): void {
    this.#instance(id);
    const dependents = this.dependentsOf(id);
    if (dependents.length > 0) {
      throw new IndicatorConfigError(`Cannot remove "${id}": SMA instances depend on it (${dependents.join(', ')}).`);
    }
    this.#instances.delete(id);
    this.#changes.emit({ type: 'removed', instanceId: id });
  }

  has(id: string): boolean {
    return this.#instances.has(id);
  }

  get(id: string): InstanceInfo {
    return this.#info(this.#instance(id));
  }

  list(): readonly InstanceInfo[] {
    return [...this.#instances.values()].map((i) => this.#info(i));
  }

  /** Ids of the SMA instances that read from `id`. */
  dependentsOf(id: string): readonly string[] {
    return [...this.#instances.values()]
      .filter((i): i is SmaInstance => i.kind === 'sma' && i.source.kind === 'indicator' && i.source.instanceId === id)
      .map((i) => i.id);
  }

  /** An output column aligned with `times`. Live view: do not mutate. SMAs have the single output `sma`. */
  values(id: string, output: string): readonly Value[] {
    return this.#instance(id).calc.column(output);
  }

  // ---- data ------------------------------------------------------------------------------------

  /** Replaces all data and recomputes every instance. */
  reset(candles: readonly Candle[]): void {
    for (let i = 1; i < candles.length; i++) {
      if (candles[i]!.time <= candles[i - 1]!.time) {
        throw new IndicatorSyncError(`Candles must be strictly ascending by time (index ${i}).`);
      }
    }
    this.#candles.length = 0;
    this.#candles.push(...candles);
    this.#times.length = 0;
    this.#times.push(...candles.map((c) => c.time));

    for (const inst of this.#instances.values()) if (inst.kind === 'indicator') inst.calc.reset(this.#candles);
    for (const inst of this.#instances.values()) if (inst.kind === 'sma') inst.calc.reset(this.#sourceColumn(inst.source));
    for (const id of this.#instances.keys()) this.#changes.emit({ type: 'reset', instanceId: id });
  }

  /**
   * Older candles were added in front. Every value depends on all earlier bars and every index shifts,
   * so this is a full recompute (same as `reset`). `all` is the complete list, oldest first.
   */
  prepend(all: readonly Candle[]): void {
    this.reset(all);
  }

  /** A new bar after the latest. */
  append(candle: Candle): void {
    const last = this.#candles.at(-1);
    if (last !== undefined && candle.time <= last.time) {
      throw new IndicatorSyncError(`Cannot append a bar at ${candle.time}: the latest bar is at ${last.time}.`);
    }
    this.#candles.push(candle);
    this.#times.push(candle.time);
    this.#advance(candle, 'append');
  }

  /** New values for the latest bar (a live tick). */
  update(candle: Candle): void {
    const last = this.#candles.at(-1);
    if (last === undefined) throw new IndicatorSyncError('Cannot update: there are no bars yet.');
    if (candle.time !== last.time) {
      throw new IndicatorSyncError(`Cannot update the bar at ${candle.time}: the latest bar is at ${last.time}.`);
    }
    this.#candles[this.#candles.length - 1] = candle;
    this.#advance(candle, 'update');
  }

  // ---- internals -------------------------------------------------------------------------------

  #advance(candle: Candle, kind: 'append' | 'update'): void {
    const index = this.#candles.length - 1;
    const changes: IndicatorChange[] = [];

    // Indicators first, so an SMA reading one of them sees the value for THIS bar.
    for (const inst of this.#instances.values()) {
      if (inst.kind !== 'indicator') continue;
      const values = kind === 'append' ? inst.calc.append(candle) : inst.calc.updateLast(candle);
      changes.push({ type: 'point', instanceId: inst.id, kind, index, time: candle.time, values });
    }
    for (const inst of this.#instances.values()) {
      if (inst.kind !== 'sma') continue;
      const input = this.#sourceValueAt(inst.source, candle, index);
      const values = kind === 'append' ? inst.calc.append(input) : inst.calc.updateLast(input);
      changes.push({ type: 'point', instanceId: inst.id, kind, index, time: candle.time, values });
    }
    // Notify only now, when every instance is consistent.
    for (const change of changes) this.#changes.emit(change);
  }

  #sourceColumn(source: SmaSource): readonly Value[] {
    if (source.kind === 'price') return this.#candles.map((c) => c.close);
    return this.#instance(source.instanceId).calc.column(source.output);
  }

  #sourceValueAt(source: SmaSource, candle: Candle, index: number): Value {
    if (source.kind === 'price') return candle.close;
    return this.#instance(source.instanceId).calc.column(source.output)[index] ?? null;
  }

  #rebuildSma(instance: SmaInstance): void {
    instance.calc = createCalculator(smaKernel(instance.period));
    instance.calc.reset(this.#sourceColumn(instance.source));
    this.#changes.emit({ type: 'reset', instanceId: instance.id });
  }

  #rebuildDependents(id: string): void {
    for (const dependentId of this.dependentsOf(id)) this.#rebuildSma(this.#instance(dependentId) as SmaInstance);
  }

  #instance(id: string): Instance {
    const instance = this.#instances.get(id);
    if (instance === undefined) throw new IndicatorConfigError(`Unknown instance "${id}".`);
    return instance;
  }

  #definition(id: string): IndicatorDefinition {
    if (!this.registry.has(id)) throw new IndicatorConfigError(`Unknown indicator "${id}".`);
    return this.registry.get(id);
  }

  #validated(definition: IndicatorDefinition, input: unknown): Params {
    const result = definition.validate(input);
    if (!result.ok) throw new IndicatorConfigError(`Invalid ${definition.name} parameters: ${result.errors.join('; ')}`, result.errors);
    return result.params;
  }

  #assertNewId(id: string): void {
    if (!ID_PATTERN.test(id)) throw new IndicatorConfigError(`Invalid instance id "${id}" (lowercase letters, digits, - and _).`);
    if (this.#instances.has(id)) throw new IndicatorConfigError(`Instance "${id}" already exists.`);
  }

  /** An SMA may read price, or an SMA-eligible output of an existing indicator (never another SMA). */
  #assertSmaSource(source: SmaSource): void {
    if (source.kind === 'price') return;
    const instance = this.#instances.get(source.instanceId);
    if (instance === undefined) throw new IndicatorConfigError(`SMA source "${source.instanceId}" does not exist.`);
    if (instance.kind !== 'indicator') throw new IndicatorConfigError(`SMA source "${source.instanceId}" is an SMA; an SMA cannot read another SMA.`);
    const output = instance.definition.outputs.find((o) => o.key === source.output);
    if (output === undefined) throw new IndicatorConfigError(`"${source.instanceId}" has no output "${source.output}".`);
    if (!output.smaEligible) throw new IndicatorConfigError(`Output "${source.output}" of "${source.instanceId}" cannot be a source for an SMA.`);
  }

  #info(instance: Instance): InstanceInfo {
    return instance.kind === 'indicator'
      ? { kind: 'indicator', id: instance.id, definitionId: instance.definition.id, params: instance.params, outputs: instance.definition.outputs }
      : { kind: 'sma', id: instance.id, source: instance.source, period: instance.period, outputs: SMA_OUTPUT };
  }
}
