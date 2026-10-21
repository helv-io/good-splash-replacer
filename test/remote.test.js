'use strict';
// The TV app must work with a remote that has only arrows, OK and Back: no color or number keys.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), path = require('path');
const app = fs.readFileSync(path.join(__dirname, '..', 'app', 'app.js'), 'utf8');
const html = fs.readFileSync(path.join(__dirname, '..', 'app', 'index.html'), 'utf8');

test('only arrows, OK and Back key codes are handled', () => {
  const codes = [...app.matchAll(/\bk == (\d+)/g)].map(m => Number(m[1]));
  const allowed = [37, 38, 39, 40, 13, 461, 8, 27];
  assert.ok(codes.length >= 6);
  for (const c of codes) assert.ok(allowed.includes(c), 'unexpected key code ' + c);
});

test('no hint mentions a color button', () => {
  assert.doesNotMatch(html + app, /\b(red|green|yellow|blue) (button|key)/i);
});

test('every overlay has its own focus set so arrows never leave it', () => {
  for (const v of ['editor', 'adjust', 'unsaved', 'report', 'menu', 'confirm']) assert.match(app, new RegExp(v + ": '#"));
});

test('delete asks first and focuses Cancel', () => {
  assert.match(app, /#confirm \[data-c="cancel"\]'\)\.focus\(\)/);
  assert.match(html, /data-m="delete"/);
});

test('the Magic Remote pointer can do everything the arrows can', () => {
  assert.match(app, /addEventListener\('mouseover'/);
  assert.match(app, /addEventListener\('click'/);
  assert.match(app, /contains\('modal'\)\) \{ closeOverlay\(\)/);
  assert.match(app, /\$\('grid'\)\.addEventListener\('wheel'/);
  // pointer targets are limited to the open view, so a click never reaches the screen behind a dialog
  assert.match(app, /focusables\(\)\.indexOf\(el\) >= 0/);
});

test('the editor is driven by arrows and OK: move mode pans with arrows and OK ends it', () => {
  assert.match(app, /ed\.moving\) \{\n    if \(k == 37\) nudge\(-1, 0/);
  assert.match(app, /else if \(k == 13 \|\| k == 461 \|\| k == 8 \|\| k == 27\) endMove\(\)/);
  assert.match(html, /Arrows move the image/);
});

test('Back closes the Adjust sheet first, then asks before dropping edits, with Keep editing focused', () => {
  const b = app.slice(app.indexOf('function back()'));
  assert.ok(b.indexOf("view == 'adjust'") < b.indexOf("view == 'editor'"));
  assert.match(app, /if \(!isDirty\(\)\) return closeOverlay\(\)/);
  assert.match(app, /#unsaved \[data-u="keep"\]'\)\.focus\(\)/);
});

test('the editor has every control as a focusable button', () => {
  for (const a of ['fit', 'fill', 'bg', 'zin', 'zout', 'move', 'adjust', 'rot', 'safe', 'reset', 'br-', 'br+', 'ct-', 'ct+', 'cancel', 'save', 'apply'])
    assert.match(html, new RegExp('class="e btn[^"]*" data-a="' + a.replace('+', '\\+') + '"'));
});
