// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TouchCrosshairController } from '../src/chart/TouchCrosshairController';

const pointer = (type: string, pointerType: string, pointerId: number, x: number, y: number): Event => {
  const event = new Event(type, { bubbles: true }) as Event & Record<string, unknown>;
  Object.defineProperties(event, {
    pointerType: { value: pointerType }, pointerId: { value: pointerId },
    clientX: { value: x }, clientY: { value: y },
  });
  return event;
};

describe('TouchCrosshairController', () => {
  let controller: TouchCrosshairController | undefined;
  afterEach(() => { controller?.dispose(); controller = undefined; });

  const setup = () => {
    const series = { coordinateToPrice: vi.fn((y: number) => 200 - y) };
    const timeScale = { coordinateToTime: vi.fn((x: number) => Math.round(x / 10)) };
    const chart = {
      timeScale: () => timeScale,
      setCrosshairPosition: vi.fn(),
      clearCrosshairPosition: vi.fn(),
    };
    const container = document.createElement('div');
    document.body.append(container);
    Object.defineProperty(container, 'getBoundingClientRect', { value: () => ({
      left: 10, top: 20, width: 400, height: 300, right: 410, bottom: 320, x: 10, y: 20, toJSON: () => ({}),
    }) });
    controller = new TouchCrosshairController(chart as never, series as never, container);
    return { chart, series, timeScale, container };
  };

  it('uses Lightweight Charts native crosshair API at the touch-derived price and time', () => {
    const { chart, series, timeScale, container } = setup();
    container.dispatchEvent(pointer('pointerdown', 'touch', 1, 111, 142));
    expect(series.coordinateToPrice).toHaveBeenCalledWith(122);
    expect(timeScale.coordinateToTime).toHaveBeenCalledWith(101);
    expect(chart.setCrosshairPosition).toHaveBeenCalledWith(78, 10, series);
    expect(container.querySelector('.touch-crosshair')).toBeNull();
  });

  it('updates the native crosshair while the finger moves and clears it on release', () => {
    const { chart, container } = setup();
    container.dispatchEvent(pointer('pointerdown', 'touch', 1, 111, 142));
    container.dispatchEvent(pointer('pointermove', 'touch', 1, 147, 179));
    expect(chart.setCrosshairPosition).toHaveBeenLastCalledWith(41, 14, expect.anything());
    container.dispatchEvent(pointer('pointerup', 'touch', 1, 147, 179));
    expect(chart.clearCrosshairPosition).toHaveBeenCalled();
  });

  it('does not interfere with mouse crosshair events', () => {
    const { chart, container } = setup();
    container.dispatchEvent(pointer('pointerdown', 'mouse', 0, 111, 142));
    expect(chart.setCrosshairPosition).not.toHaveBeenCalled();
    expect(chart.clearCrosshairPosition).not.toHaveBeenCalled();
  });

  it('clears the native crosshair and yields to multi-touch pinch', () => {
    const { chart, container } = setup();
    container.dispatchEvent(pointer('pointerdown', 'touch', 1, 111, 142));
    container.dispatchEvent(pointer('pointerdown', 'touch', 2, 211, 242));
    const callsAfterPinchStarts = chart.setCrosshairPosition.mock.calls.length;
    container.dispatchEvent(pointer('pointermove', 'touch', 1, 150, 180));
    expect(chart.setCrosshairPosition).toHaveBeenCalledTimes(callsAfterPinchStarts);
    expect(chart.clearCrosshairPosition).toHaveBeenCalled();
    container.dispatchEvent(pointer('pointerup', 'touch', 2, 211, 242));
    container.dispatchEvent(pointer('pointerup', 'touch', 1, 111, 142));
  });
});
