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
  for (const v of ['editor', 'report', 'menu', 'confirm']) assert.match(app, new RegExp(v + ": '#"));
});

test('delete asks first and focuses Cancel', () => {
  assert.match(app, /#confirm \[data-c="cancel"\]'\)\.focus\(\)/);
  assert.match(html, /data-m="delete"/);
});
