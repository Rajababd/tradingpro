// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { UserGestureTracker } from '../src/chart/UserGestureTracker';

function setup(graceMs = 1000) {
  const el = document.createElement('div');
  let clock = 10_000;
  const tracker = new UserGestureTracker(el, () => clock, graceMs);
  return { el, tracker, advance: (ms: number) => void (clock += ms) };
}
const fire = (el: Element, type: string, init: Record<string, unknown> = {}) => {
  const e = new Event(type, { bubbles: true });
  Object.assign(e, init);
  el.dispatchEvent(e);
};

describe('UserGestureTracker', () => {
  it('is inactive until the user does something', () => {
    expect(setup().tracker.active).toBe(false);
  });

  it('counts a press, a drag, a wheel tick and touch events as interaction', () => {
    for (const [type, init] of [['pointerdown', {}], ['pointermove', { buttons: 1 }], ['wheel', {}], ['touchstart', {}], ['touchmove', {}]] as const) {
      const { el, tracker } = setup();
      fire(el, type, init);
      expect(tracker.active, type).toBe(true);
    }
  });

  it('does not count hovering (pointer move with no button)', () => {
    const { el, tracker } = setup();
    fire(el, 'pointermove', { buttons: 0 });
    expect(tracker.active).toBe(false);
  });

  it('stays active for the grace period after the last event, then goes quiet', () => {
    const { el, tracker, advance } = setup(1000);
    fire(el, 'pointerup');
    advance(999);
    expect(tracker.active).toBe(true);
    advance(2);
    expect(tracker.active).toBe(false);
  });

  it('every new event restarts the grace period (a long drag stays active)', () => {
    const { el, tracker, advance } = setup(1000);
    fire(el, 'pointerdown');
    for (let i = 0; i < 5; i++) {
      advance(800);
      fire(el, 'pointermove', { buttons: 1 });
    }
    expect(tracker.active).toBe(true);
  });

  it('listens without blocking: passive, and never prevents default', () => {
    const { el } = setup();
    const e = new Event('wheel', { cancelable: true });
    el.dispatchEvent(e);
    expect(e.defaultPrevented).toBe(false);
  });

  it('dispose removes the listeners and reports inactive', () => {
    const { el, tracker } = setup();
    tracker.dispose();
    fire(el, 'pointerdown');
    expect(tracker.active).toBe(false);
    tracker.dispose(); // safe twice
  });
});
