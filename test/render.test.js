'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const GSR = require('../app/render.js');

test('fit centers a smaller image at native size', () => {
  assert.deepEqual(GSR.layout(200, 100, 1000, 500, {}), { x: 400, y: 200, width: 200, height: 100 });
});

test('fit never upscales when the source is smaller in both dimensions', () => {
  const l = GSR.layout(999, 499, 1000, 500, { mode: 'fit' });
  assert.equal(l.width, 999); assert.equal(l.height, 499);
});

test('fit scales a wider image down uniformly and centers it', () => {
  const l = GSR.layout(3000, 1000, 1000, 500, {});
  assert.equal(l.width, 1000); assert.ok(Math.abs(l.height - 1000 / 3) < 1e-9);
  assert.equal(l.x, 0); assert.ok(Math.abs(l.y - (500 - 1000 / 3) / 2) < 1e-9);
});

test('fit scales when only one dimension is bigger', () => {
  const l = GSR.layout(400, 1000, 1000, 500, {});
  assert.equal(l.height, 500); assert.equal(l.width, 200); assert.equal(l.x, 400);
});

test('fill covers the target with a centered crop', () => {
  const l = GSR.layout(3000, 1000, 1000, 500, { mode: 'fill' });
  assert.deepEqual(l, { x: -250, y: 0, width: 1500, height: 500 });
});

test('fill keeps the aspect ratio for small sources', () => {
  const l = GSR.layout(100, 100, 1000, 500, { mode: 'fill' });
  assert.equal(l.width, l.height); assert.equal(l.width, 1000);
});

test('zoom and move override the defaults', () => {
  const l = GSR.layout(200, 100, 1000, 500, { zoom: 2, dx: 0.1, dy: -0.1 });
  assert.deepEqual(l, { x: 300 + 100, y: 150 - 50, width: 400, height: 200 });
});

test('the same rules apply to every target size', () => {
  const big = GSR.layout(2000, 1000, 1000, 500, {}), small = GSR.layout(2000, 1000, 500, 250, {});
  assert.equal(big.width / 2, small.width); assert.equal(big.height / 2, small.height);
});

test('defaults are fit, centered, black padding', () => {
  assert.deepEqual(GSR.defaults(), { mode: 'fit', zoom: 1, dx: 0, dy: 0, rotate: 0, brightness: 0, contrast: 0, bg: '#000000' });
});

test('rotate 90 sizes the turned image', () => {
  assert.deepEqual(GSR.layout(400, 1000, 1000, 500, { rotate: 90 }), GSR.layout(1000, 400, 1000, 500, {}));
  assert.deepEqual(GSR.layout(400, 1000, 1000, 500, { rotate: 180 }), GSR.layout(400, 1000, 1000, 500, {}));
  assert.deepEqual(GSR.layout(400, 1000, 1000, 500, { rotate: -90 }), GSR.layout(1000, 400, 1000, 500, {}));
});

test('a smaller turned image still stays at its own size', () => {
  assert.deepEqual(GSR.layout(100, 300, 3840, 2160, { rotate: 270 }), { x: 1770, y: 1030, width: 300, height: 100 });
});

test('the preview scale never changes the layout', () => {
  const full = GSR.layout(5000, 1000, 3840, 2160, { zoom: 1.3, dx: 0.1 }), again = GSR.layout(5000, 1000, 3840, 2160, { zoom: 1.3, dx: 0.1, scale: 0.1 });
  assert.deepEqual(full, again);
});

test('offsets near center snap to it', () => {
  assert.equal(GSR.snap(0.01), 0); assert.equal(GSR.snap(-0.01), 0); assert.equal(GSR.snap(0.2), 0.2); assert.equal(GSR.snap(0.05, 0.1), 0);
});

test('tone is a no-op at zero and clamps', () => {
  for (let v = 0; v < 256; v += 17) assert.equal(GSR.tone(v, 0, 0), v);
  assert.equal(GSR.tone(250, 100, 0), 255); assert.equal(GSR.tone(5, -100, 0), 0);
  assert.ok(GSR.tone(200, 0, 50) > 200); assert.ok(GSR.tone(50, 0, 50) < 50);
});

test('edge color picks the most common border color', () => {
  const w = 4, h = 3, d = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) d.set([20, 40, 200, 255], i * 4);
  d.set([255, 0, 0, 255], 0); d.set([255, 255, 255, 255], (1 * w + 1) * 4);
  assert.equal(GSR.edgeColor(d, w, h), '#1428c8');
  assert.equal(GSR.edgeColor(new Uint8ClampedArray(16), 2, 2), '#000000');
});

test('old settings with removed fields still load, and the fields are ignored', () => {
  const old = { mode: 'fill', zoom: 1.5, dx: 0.1, dy: 0, bg: '#FFFFFF', knock: true, threshold: 40 };
  assert.deepEqual(GSR.clean(old), { mode: 'fill', zoom: 1.5, dx: 0.1, dy: 0, rotate: 0, brightness: 0, contrast: 0, bg: '#ffffff' });
  assert.equal(GSR.clean({ bg: 'transparent' }).bg, '#000000');
});

test('bad or missing settings fall back to the defaults', () => {
  assert.deepEqual(GSR.clean(null), GSR.defaults());
  assert.deepEqual(GSR.clean({ mode: 'x', zoom: 'big', rotate: 45, brightness: 900 }), Object.assign(GSR.defaults(), { brightness: 100 }));
});

test('editor-only fields never reach a render', () => {
  assert.deepEqual(Object.keys(GSR.clean({ scale: 0.25, rdx: 1, rdy: 1 })).sort(), Object.keys(GSR.defaults()).sort());
});
