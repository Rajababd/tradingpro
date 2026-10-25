import { describe, expect, it } from 'vitest';
import { placePanel } from '../src/ui/placement';

const trigger = (left: number, top = 8, bottom = 48) => ({ left, top, bottom });
const inside = (p: ReturnType<typeof placePanel>, vw: number, vh: number) =>
  p.left >= 0 && p.left + p.width <= vw && p.top >= 0 && p.top + p.maxHeight <= vh;

describe('placePanel', () => {
  it('opens below the trigger, left-aligned, when there is room', () => {
    expect(placePanel(trigger(100), 320, { width: 1280, height: 800 })).toEqual({ left: 100, top: 52, width: 320, maxHeight: 740 });
  });

  it('is pulled back inside the viewport when the trigger is near the right edge', () => {
    const p = placePanel(trigger(300), 320, { width: 390, height: 844 });
    expect(p.left + p.width).toBeLessThanOrEqual(382);
    expect(p.left).toBeGreaterThanOrEqual(8);
  });

  it('shrinks to the viewport width on a narrow screen', () => {
    const p = placePanel(trigger(200), 320, { width: 300, height: 600 });
    expect(p.width).toBe(284);
    expect(p.left).toBe(8);
  });

  it('limits its height to the room below, so tall content scrolls inside', () => {
    const p = placePanel(trigger(10, 8, 48), 320, { width: 360, height: 640 });
    expect(p.maxHeight).toBe(640 - 8 - 52);
  });

  it('moves up on a short viewport (phone in landscape) instead of being squeezed to nothing', () => {
    const p = placePanel(trigger(10, 8, 80), 320, { width: 640, height: 200 });
    expect(p.maxHeight).toBeGreaterThanOrEqual(160);
    expect(p.top).toBeGreaterThanOrEqual(8);
  });

  it('never leaves the viewport, for a grid of awkward sizes and trigger positions', () => {
    for (const [vw, vh] of [[320, 480], [360, 640], [390, 844], [640, 360], [844, 390], [768, 1024], [1280, 800], [200, 150]] as const) {
      for (const left of [0, 5, 100, vw - 40, vw - 1, vw + 50]) {
        const p = placePanel(trigger(left, 8, 52), 320, { width: vw, height: vh });
        expect(inside(p, vw, vh), `${vw}x${vh} trigger@${left}: ${JSON.stringify(p)}`).toBe(true);
      }
    }
  });
});
