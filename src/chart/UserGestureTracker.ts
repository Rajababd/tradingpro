/**
 * Tells "the user is moving the chart" apart from "the library is re-laying itself out".
 *
 * The chart library gives no hint about why the visible range changed, and it emits small
 * range events on its own while settling after data loads. Anything that must react to a real
 * pan (like paging older history) has to ask this.
 *
 * Activity = a press, a drag (move with a button down), a wheel tick or any touch event on the
 * chart element. Activity stays "recent" for `graceMs` afterwards, which also covers kinetic
 * scrolling after a touch fling. There is deliberately no "button is held" state: a lost
 * pointer-up could otherwise leave it stuck on forever.
 *
 * Listeners are passive and never prevent default, so they cannot interfere with chart gestures.
 */
const EVENTS = ['pointerdown', 'pointermove', 'pointerup', 'pointercancel', 'wheel', 'touchstart', 'touchmove', 'touchend', 'touchcancel'] as const;

export class UserGestureTracker {
  #lastActivity = -Infinity;
  #disposed = false;

  constructor(
    private readonly target: EventTarget,
    private readonly now: () => number = () => performance.now(),
    private readonly graceMs: number = 1200,
  ) {
    for (const type of EVENTS) target.addEventListener(type, this.#onEvent, { passive: true, capture: true });
  }

  /** True while the user is, or very recently was, interacting with the chart. */
  get active(): boolean {
    return !this.#disposed && this.now() - this.#lastActivity < this.graceMs;
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    for (const type of EVENTS) this.target.removeEventListener(type, this.#onEvent, { capture: true });
  }

  #onEvent = (event: Event): void => {
    // Hovering is not interacting: only count a move when a button is pressed.
    if (event.type === 'pointermove' && (event as PointerEvent).buttons === 0) return;
    this.#lastActivity = this.now();
  };
}
