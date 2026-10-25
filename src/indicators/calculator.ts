import type { Calculator, Kernel, Value } from './types';

/**
 * Binds a kernel to a series. It keeps the state after the last input AND the state before it,
 * so the last bar can be revised (a live tick) without recomputing history:
 *   append     -> step(last)
 *   updateLast -> step(beforeLast)
 */
export function createCalculator<I, S>(kernel: Kernel<I, S>): Calculator<I> {
  const columns = new Map<string, Value[]>(kernel.outputKeys.map((key) => [key, []]));
  let before: S = kernel.init(); // state preceding the last input
  let last: S = before; // state after the last input
  let length = 0;

  const write = (values: Readonly<Record<string, Value>>, at: number): void => {
    for (const key of kernel.outputKeys) {
      const v = values[key];
      columns.get(key)![at] = v === undefined ? null : v;
    }
  };

  const row = (index: number): Readonly<Record<string, Value>> => {
    const out: Record<string, Value> = {};
    for (const key of kernel.outputKeys) out[key] = columns.get(key)![index] ?? null;
    return out;
  };

  const calculator: Calculator<I> = {
    outputKeys: kernel.outputKeys,
    get length() {
      return length;
    },
    reset(inputs) {
      for (const col of columns.values()) col.length = 0;
      before = kernel.init();
      last = before;
      length = 0;
      for (const input of inputs) calculator.append(input);
    },
    append(input) {
      const result = kernel.step(last, input);
      before = last;
      last = result.state;
      write(result.values, length);
      length += 1;
      return row(length - 1);
    },
    updateLast(input) {
      if (length === 0) throw new Error('Cannot update the last bar of an empty series.');
      const result = kernel.step(before, input);
      last = result.state;
      write(result.values, length - 1);
      return row(length - 1);
    },
    column(key) {
      const col = columns.get(key);
      if (col === undefined) throw new Error(`Unknown output "${key}".`);
      return col;
    },
    rowAt(index) {
      if (!Number.isInteger(index) || index < 0 || index >= length) throw new RangeError(`No bar at index ${index}.`);
      return row(index);
    },
  };
  return calculator;
}
