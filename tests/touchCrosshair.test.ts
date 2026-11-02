// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TouchCrosshairOverlay } from '../src/chart/TouchCrosshairOverlay';

const pointer = (type: string, pointerType: string, pointerId: number, x: number, y: number, buttons = 1): Event => {
  const event = new Event(type, { bubbles: true }) as Event & Record<string, unknown>;
  Object.defineProperties(event, {
    pointerType: { value: pointerType }, pointerId: { value: pointerId },
    clientX: { value: x }, clientY: { value: y }, buttons: { value: buttons },
  });
  return event;
};

describe('TouchCrosshairOverlay', () => {
  let overlay: TouchCrosshairOverlay | undefined;
  afterEach(() => { overlay?.dispose(); overlay = undefined; });

  const setup = () => {
    const chart = {
      options: () => ({ crosshair: { vertLine: { visible: true }, horzLine: { visible: true } } }),
      applyOptions: vi.fn(),
    };
    const container = document.createElement('div');
    document.body.append(container);
    Object.defineProperty(container, 'getBoundingClientRect', { value: () => ({
      left: 10, top: 20, width: 400, height: 300, right: 410, bottom: 320, x: 10, y: 20, toJSON: () => ({}),
    }) });
    overlay = new TouchCrosshairOverlay(chart as never, container);
    return { chart, container };
  };

  it('tracks exact touch coordinates rather than snapping to a candle', () => {
    const { chart, container } = setup();
    container.dispatchEvent(pointer('pointerdown', 'touch', 1, 111, 142));
    container.dispatchEvent(pointer('pointermove', 'touch', 1, 147, 179));
    const layer = container.querySelector<HTMLElement>('.touch-crosshair')!;
    expect(layer.dataset.visible).toBe('true');
    expect(layer.querySelector<HTMLElement>('.touch-crosshair__vertical')!.style.left).toBe('137px');
    expect(layer.querySelector<HTMLElement>('.touch-crosshair__horizontal')!.style.top).toBe('159px');
    expect(chart.applyOptions).toHaveBeenCalledWith({ crosshair: { vertLine: { visible: false }, horzLine: { visible: false } } });
  });

  it('keeps the last touch position after release and restores native crosshair on mouse movement', () => {
    const { chart, container } = setup();
    container.dispatchEvent(pointer('pointerdown', 'touch', 1, 111, 142));
    container.dispatchEvent(pointer('pointerup', 'touch', 1, 111, 142, 0));
    expect(container.querySelector<HTMLElement>('.touch-crosshair')!.dataset.visible).toBe('true');
    container.dispatchEvent(pointer('pointermove', 'mouse', 0, 200, 200, 0));
    expect(container.querySelector<HTMLElement>('.touch-crosshair')!.dataset.visible).toBe('false');
    expect(chart.applyOptions).toHaveBeenLastCalledWith({ crosshair: { vertLine: { visible: true }, horzLine: { visible: true } } });
  });

  it('does not hold a crosshair during a multi-touch pinch', () => {
    const { chart, container } = setup();
    container.dispatchEvent(pointer('pointerdown', 'touch', 1, 111, 142));
    container.dispatchEvent(pointer('pointerdown', 'touch', 2, 211, 242));
    expect(container.querySelector<HTMLElement>('.touch-crosshair')!.dataset.visible).toBe('false');
    container.dispatchEvent(pointer('pointerup', 'touch', 2, 211, 242, 0));
    container.dispatchEvent(pointer('pointerup', 'touch', 1, 111, 142, 0));
    expect(chart.applyOptions).toHaveBeenLastCalledWith({ crosshair: { vertLine: { visible: true }, horzLine: { visible: true } } });
  });
});
