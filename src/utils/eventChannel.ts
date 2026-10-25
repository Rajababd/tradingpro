export type Unsubscribe = () => void;

export interface ChannelHooks {
  /** Called when the listener count goes 0 -> 1 (e.g. attach the underlying library subscription). */
  onFirstListener(): void;
  /** Called when the listener count goes 1 -> 0 (e.g. detach it). */
  onNoListeners(): void;
}

const NO_HOOKS: ChannelHooks = { onFirstListener() {}, onNoListeners() {} };

/**
 * Tiny listener set with lazy upstream subscription: the expensive underlying
 * subscription exists only while at least one listener does. A throwing listener
 * is logged and does not stop the others.
 */
export class EventChannel<T> {
  readonly #entries = new Set<{ readonly fn: (value: T) => void }>();

  constructor(private readonly hooks: ChannelHooks = NO_HOOKS) {}

  get size(): number {
    return this.#entries.size;
  }

  subscribe(fn: (value: T) => void): Unsubscribe {
    const entry = { fn };
    this.#entries.add(entry);
    if (this.#entries.size === 1) this.hooks.onFirstListener();
    return () => {
      if (!this.#entries.delete(entry)) return; // idempotent
      if (this.#entries.size === 0) this.hooks.onNoListeners();
    };
  }

  emit(value: T): void {
    for (const { fn } of [...this.#entries]) {
      try {
        fn(value);
      } catch (error) {
        console.error('EventChannel listener threw', error);
      }
    }
  }

  /** Removes every listener (and detaches upstream). Safe to call repeatedly. */
  clear(): void {
    if (this.#entries.size === 0) return;
    this.#entries.clear();
    this.hooks.onNoListeners();
  }
}
