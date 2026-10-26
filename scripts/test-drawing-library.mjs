import assert from 'node:assert/strict';
import { DrawingManager, TrendLine } from '../src/vendor/lightweight-charts-drawing.es.js';

function makeContainer() {
  const listeners = new Map();
  return {
    clientHeight: 600,
    getBoundingClientRect: () => ({ left: 100, top: 20, width: 900, height: 600 }),
    addEventListener: (name, fn) => listeners.set(name, fn),
    removeEventListener: (name) => listeners.delete(name),
    listeners,
  };
}
function makeSeries(id, paneIndex = 0) {
  const series = {
    id,
    attached: new Set(),
    getPane: () => ({ paneIndex: () => paneIndex, getHeight: () => 600 }),
    attachPrimitive(p) {
      this.attached.add(p);
      p.attached?.({ chart, series: this, requestUpdate() {} });
    },
    detachPrimitive(p) { this.attached.delete(p); p.detached?.(); },
    width: () => 800,
    coordinateToPrice: () => 100,
    priceToCoordinate: () => 100,
    coordinateToTime: () => 10,
    timeToCoordinate: () => 10,
    logicalToCoordinate: () => 10,
  };
  return series;
}
const chart = {
  clicks: new Set(),
  doubleClicks: new Set(),
  subscribeClick(fn) { this.clicks.add(fn); },
  unsubscribeClick(fn) { this.clicks.delete(fn); },
  subscribeDblClick(fn) { this.doubleClicks.add(fn); },
  unsubscribeDblClick(fn) { this.doubleClicks.delete(fn); },
  timeScale: () => ({ width: () => 800, coordinateToTime: (x) => x / 10, timeToCoordinate: (time) => time * 10, logicalToCoordinate: (logical) => logical * 10 }),
  priceScale: (side) => ({ width: () => side === 'left' ? 37 : 70 }),
};
function createDrawing(_type, data) {
  const d = new TrendLine(data.id, data.anchors, data.style, data.options);
  d.fromJSON(data);
  return d;
}
const container = makeContainer();
const seriesA = makeSeries('A');
const seriesB = makeSeries('B', 1);
const manager = new DrawingManager();
manager.attach(chart, seriesA, container, (series) => series.id, (id) => ({ A: seriesA, B: seriesB })[id]);
const drawing = new TrendLine('line-1', [{ time: 1, price: 10 }, { time: 2, price: 20 }]);
manager.addDrawing(drawing, seriesA);
assert.equal(drawing.seriesId, 'A');
assert.equal(drawing.getSeries(), seriesA);

// A detach/reattach cycle must resolve by stable seriesId, not lose the drawing.
manager.detach();
assert.equal(drawing.getSeries(), null);
manager.attach(chart, seriesB, container, (series) => series.id, (id) => ({ A: seriesA, B: seriesB })[id]);
assert.equal(drawing.getSeries(), seriesA);
assert.equal(drawing.seriesId, 'A');
manager.detach();

// A missing stable seriesId must not fall back to paneIndex's unrelated series.
const manager2 = new DrawingManager();
manager2.attach(chart, seriesB, container, (series) => series.id, () => null);
manager2.importDrawings(manager.exportDrawings(), createDrawing, () => seriesB, () => null);
const pending = manager2.getDrawing('line-1');
assert.ok(pending, 'unresolved drawing is retained');
assert.equal(pending.seriesId, 'A');
assert.equal(pending.getSeries(), null, 'unresolved drawing remains unattached');
assert.equal(manager2.exportDrawings()[0].seriesId, 'A', 'stable identity survives export');
manager2.detach();
manager2.attach(chart, seriesB, container, (series) => series.id, (id) => id === 'A' ? seriesA : null);
assert.equal(pending.getSeries(), seriesA, 'pending drawing attaches when its series returns');

// Pointer coordinates use the actual left price-scale width (37), not a fixed 80px.
const point = manager2.getPointFromEvent({ clientX: 300, clientY: 100 });
assert.deepEqual(point, { x: 163, y: 80 });

manager.detach();
manager2.detach();

// Interactive tool placement: a trend line is committed after two chart clicks.
const manager3 = new DrawingManager();
manager3.attach(chart, seriesA, container, (series) => series.id, (id) => ({ A: seriesA, B: seriesB })[id]);
manager3.setActiveTool('trend-line');
const pointerUpAt = (x, y) => container.listeners.get('pointerup')({ clientX: x + 137, clientY: y + 20, button: 0 });
pointerUpAt(120, 90);
assert.equal(manager3.getAllDrawings().length, 0, 'multi-anchor drawing waits for its second pointer-up');
pointerUpAt(180, 130);
assert.equal(manager3.getAllDrawings().length, 1, 'drawing is registered after required anchors are placed');
const placed = manager3.getAllDrawings()[0];
assert.equal(placed.type, 'trend-line');
assert.deepEqual(placed.anchors, [{ time: 12, price: 100 }, { time: 18, price: 100 }]);
assert.equal(placed.seriesId, 'A');
assert.equal(manager3.getActiveTool(), null, 'tool exits after placement is complete');

// Single-anchor tools finish on the first click.
manager3.setActiveTool('horizontal-line');
pointerUpAt(220, 150);
assert.equal(manager3.getAllDrawings().length, 2, 'single-anchor tool completes on first click');
assert.equal(manager3.getActiveTool(), null);
manager3.detach();
console.log('Drawing library regression checks passed: lifecycle, strict series identity, pending restore, dynamic scale offset, interactive tool placement.');
