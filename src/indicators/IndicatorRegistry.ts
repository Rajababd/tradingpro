import { adDefinition } from './accumulationDistribution';
import { macdDefinition } from './macd';
import { obvDefinition } from './obv';
import { rsiDefinition } from './rsi';
import type { IndicatorDefinition, OutputDef } from './types';
import { volumeDefinition } from './volume';

/** One entry of the SMA source list (derived from the registry, never hand-written in the UI). */
export interface SmaSourceOption {
  /** Stable key: `price`, or `<definitionId>:<outputKey>`. */
  readonly key: string;
  readonly label: string;
  readonly definitionId: string | null; // null = the price series
  readonly output: string | null;
}

const ID_PATTERN = /^[a-z][a-z0-9-]*$/;

/**
 * The list of indicators the app knows about. UI menus and the SMA source list are generated from it,
 * so adding an indicator is one `register` call and touches no menu code.
 */
export class IndicatorRegistry {
  readonly #definitions = new Map<string, IndicatorDefinition>();

  register(definition: IndicatorDefinition): void {
    if (!ID_PATTERN.test(definition.id)) throw new Error(`Invalid indicator id "${definition.id}".`);
    if (this.#definitions.has(definition.id)) throw new Error(`Indicator "${definition.id}" is already registered.`);
    if (definition.outputs.length === 0) throw new Error(`Indicator "${definition.id}" has no outputs.`);
    const keys = definition.outputs.map((o) => o.key);
    if (new Set(keys).size !== keys.length) throw new Error(`Indicator "${definition.id}" has duplicate output keys.`);
    this.#definitions.set(definition.id, definition);
  }

  has(id: string): boolean {
    return this.#definitions.has(id);
  }

  get(id: string): IndicatorDefinition {
    const definition = this.#definitions.get(id);
    if (definition === undefined) throw new Error(`Unknown indicator "${id}".`);
    return definition;
  }

  /** In registration order. */
  list(): readonly IndicatorDefinition[] {
    return [...this.#definitions.values()];
  }

  outputOf(definitionId: string, key: string): OutputDef {
    const output = this.get(definitionId).outputs.find((o) => o.key === key);
    if (output === undefined) throw new Error(`Indicator "${definitionId}" has no output "${key}".`);
    return output;
  }

  /** Price first, then every SMA-eligible output of every registered indicator. */
  smaSourceOptions(): readonly SmaSourceOption[] {
    const options: SmaSourceOption[] = [{ key: 'price', label: 'Price', definitionId: null, output: null }];
    for (const def of this.#definitions.values()) {
      for (const output of def.outputs) {
        if (!output.smaEligible) continue;
        options.push({
          key: `${def.id}:${output.key}`,
          label: def.outputs.length === 1 ? def.name : `${def.name} · ${output.label}`,
          definitionId: def.id,
          output: output.key,
        });
      }
    }
    return options;
  }
}

export function createDefaultRegistry(): IndicatorRegistry {
  const registry = new IndicatorRegistry();
  for (const def of [rsiDefinition, volumeDefinition, obvDefinition, adDefinition, macdDefinition]) registry.register(def);
  return registry;
}
