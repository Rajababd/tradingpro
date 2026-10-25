import type { Params, ParamsResult } from './types';

export interface IntParamSpec {
  readonly label: string;
  readonly default: number;
  readonly min: number;
  readonly max: number;
}

/**
 * Validates integer parameters. `input` may be undefined (all defaults) or a partial object;
 * unknown keys, non-integers (including NaN/Infinity, numeric strings) and out-of-range values
 * are reported, never coerced.
 */
export function parseIntParams(
  input: unknown,
  spec: Readonly<Record<string, IntParamSpec>>,
  crossChecks: readonly ((p: Params) => string | null)[] = [],
): ParamsResult<Params> {
  if (input !== undefined && (typeof input !== 'object' || input === null || Array.isArray(input))) {
    return { ok: false, errors: ['parameters must be an object'] };
  }
  const given = (input ?? {}) as Record<string, unknown>;
  const errors: string[] = [];

  for (const key of Object.keys(given)) {
    if (!(key in spec)) errors.push(`unknown parameter "${key}"`);
  }

  const out: Record<string, number> = {};
  for (const [key, s] of Object.entries(spec)) {
    const v = key in given ? given[key] : s.default;
    if (typeof v !== 'number' || !Number.isInteger(v)) {
      errors.push(`${s.label} must be a whole number`);
    } else if (v < s.min || v > s.max) {
      errors.push(`${s.label} must be between ${s.min} and ${s.max}`);
    } else {
      out[key] = v;
    }
  }

  if (errors.length === 0) {
    for (const check of crossChecks) {
      const problem = check(out);
      if (problem !== null) errors.push(problem);
    }
  }
  return errors.length > 0 ? { ok: false, errors } : { ok: true, params: out };
}

export const defaultsOf = (spec: Readonly<Record<string, IntParamSpec>>): Params =>
  Object.fromEntries(Object.entries(spec).map(([k, s]) => [k, s.default]));

export interface ParamSpecInfo {
  readonly key: string;
  readonly label: string;
  readonly min: number;
  readonly max: number;
}

/** Metadata a settings UI needs (label and allowed range per parameter), derived from the same spec used to validate. */
export const paramSpecsOf = (spec: Readonly<Record<string, IntParamSpec>>): readonly ParamSpecInfo[] =>
  Object.entries(spec).map(([key, s]) => ({ key, label: s.label, min: s.min, max: s.max }));
