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
    getPane: () => ({ paneIndex: () => paneIndex }),
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
  subscribeClick(fn) { this.clicks.add(fn); },
  unsubscribeClick(fn) { this.clicks.delete(fn); },
  timeScale: () => ({ width: () => 800, coordinateToTime: (x) => x / 100, coordinateToLogical: (x) => x / 10, timeToCoordinate: (time) => time * 100, logicalToCoordinate: (logical) => logical * 10 }),
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
assert.deepEqual(drawing.anchors.map((anchor) => anchor.logical), [10, 20], 'legacy time anchors are normalized to logical indices when resolvable');

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
for (const listener of chart.clicks) listener({ point: { x: 120, y: 90 }, time: 11 });
assert.equal(manager3.getAllDrawings().length, 0, 'multi-anchor drawing waits for its second click');
for (const listener of chart.clicks) listener({ point: { x: 180, y: 130 }, time: 12 });
assert.equal(manager3.getAllDrawings().length, 1, 'drawing is registered after required anchors are placed');
const placed = manager3.getAllDrawings()[0];
assert.equal(placed.type, 'trend-line');
assert.deepEqual(placed.anchors, [{ time: 11, logical: 12, price: 100 }, { time: 12, logical: 18, price: 100 }]);
assert.equal(placed.seriesId, 'A');
manager3.shiftLogicalAnchors(5);
assert.deepEqual(placed.anchors, [{ time: 11, logical: 17, price: 100 }, { time: 12, logical: 23, price: 100 }], 'prepending older candles shifts logical anchors but preserves timestamp identity');
assert.equal(manager3.getActiveTool(), null, 'tool exits after placement is complete');

// Logical coordinates are the primary geometry; timestamps are a legacy fallback.
const coordinateViewport = {
  timeScale: {
    timeToCoordinate: () => 999,
    logicalToCoordinate: (logical) => logical * 7,
    coordinateToTime: (x) => x / 100,
    coordinateToLogical: (x) => x / 7,
  },
  priceScale: { priceToCoordinate: (price) => price * 2, coordinateToPrice: (y) => y / 2 },
};
const logicalTrend = new TrendLine('logical-line', [{ time: 42, logical: 3, price: 5 }]);
assert.deepEqual(logicalTrend.anchorToPixel(logicalTrend.anchors[0], coordinateViewport), { x: 21, y: 10 }, 'logical index wins over timestamp when projecting an anchor');
const legacyTrend = new TrendLine('legacy-line', [{ time: 42, price: 5 }]);
assert.deepEqual(legacyTrend.anchorToPixel(legacyTrend.anchors[0], coordinateViewport), { x: 999, y: 10 }, 'legacy time-only anchors still render through the timestamp fallback');
assert.deepEqual(logicalTrend.pixelToAnchor({ x: 21, y: 10 }, coordinateViewport), { time: 0.21, logical: 3, price: 5 }, 'editing an anchor preserves both logical and time coordinates');

// Single-anchor tools finish on the first click.
manager3.setActiveTool('horizontal-line');
for (const listener of chart.clicks) listener({ point: { x: 220, y: 150 }, time: 13 });
assert.equal(manager3.getAllDrawings().length, 2, 'single-anchor tool completes on first click');
assert.equal(manager3.getActiveTool(), null);
manager3.detach();
console.log('Drawing library regression checks passed: lifecycle, strict series identity, pending restore, dynamic scale offset, interactive tool placement.');
