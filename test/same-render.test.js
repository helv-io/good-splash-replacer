'use strict';
// The phone page and the TV editor must give the TV the same image for the same settings:
// both clean the settings with GSR.clean and render every target with GSR.renderAll, and nothing else draws an upload.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), path = require('path');
const GSR = require('../app/render.js');
const tv = fs.readFileSync(path.join(__dirname, '..', 'app', 'app.js'), 'utf8');
const phone = fs.readFileSync(path.join(__dirname, '..', 'service', 'upload.html'), 'utf8');

test('the TV and the phone render uploads only through GSR.renderAll with cleaned settings', () => {
  assert.match(phone, /var p = GSR\.clean\(o\);[\s\S]*GSR\.renderAll\(img, targets, p\)/);
  assert.match(tv, /var p = GSR\.clean\(o\)[\s\S]*GSR\.renderAll\(ed\.img, st\.targets, p\)/);
  assert.match(tv, /GSR\.renderAll\(img, st\.targets, GSR\.clean\(i\.params\)\)/);
});

test('the phone page loads the same render.js the TV app ships', () => {
  assert.match(phone, /<script src="\/render\.js"><\/script>/);
});

// A minimal canvas that records every draw call, so both callers can be compared op for op.
function fakeCanvas(log) {
  return { width: 0, height: 0, getContext() {
    const c = { set fillStyle(v) { log.push(['fill', v]); }, imageSmoothingEnabled: true, imageSmoothingQuality: '' };
    for (const f of ['setTransform', 'clearRect', 'translate', 'rotate', 'fillRect', 'drawImage']) c[f] = (...a) => log.push([f, ...a.filter(x => typeof x !== 'object')]);
    c.getImageData = (x, y, w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }); c.putImageData = () => log.push(['put']);
    return c; } };
}
test('editor-only fields change nothing in the full-size render', () => {
  global.document = { createElement: () => fakeCanvas(logs[cur]) };
  const logs = [[], []]; let cur = 0;
  const img = { naturalWidth: 1200, naturalHeight: 800 }, base = { mode: 'fill', zoom: 1.2, dx: 0.05, rotate: 90, brightness: 10, contrast: -5, bg: '#123456' };
  const phoneSide = GSR.clean(Object.assign({ rdx: 0.3, rdy: 0.1 }, base)), tvSide = GSR.clean(Object.assign({ scale: 0.5, knock: true }, base));
  assert.deepEqual(phoneSide, tvSide);
  GSR.render(img, 3840, 2160, phoneSide, fakeCanvas(logs[0])); cur = 1;
  GSR.render(img, 3840, 2160, tvSide, fakeCanvas(logs[1]));
  assert.deepEqual(logs[0], logs[1]); assert.ok(logs[0].length > 5);
  delete global.document;
});
