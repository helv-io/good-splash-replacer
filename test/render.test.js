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

test('black becomes transparent under the threshold and fades above it', () => {
  assert.equal(GSR.knockAlpha(0, 0, 0, 255, 40), 0);
  assert.equal(GSR.knockAlpha(40, 10, 10, 255, 40), 0);
  assert.equal(GSR.knockAlpha(60, 0, 0, 255, 40), 128);
  assert.equal(GSR.knockAlpha(200, 200, 200, 255, 40), 255);
});

test('defaults are fit, centered, black padding', () => {
  assert.deepEqual(GSR.defaults(), { mode: 'fit', zoom: 1, dx: 0, dy: 0, bg: '#000000', knock: false, threshold: 40 });
});
