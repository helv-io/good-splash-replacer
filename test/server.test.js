'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), os = require('os'), path = require('path'), http = require('http');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gsr-'));
const qmlDir = path.join(tmp, 'MasterBrand'), base = path.join(tmp, 'custom-logo');
fs.mkdirSync(qmlDir);

// A PNG that is only a valid header: enough for the size checks.
function png(w, h) {
  const b = Buffer.alloc(45);
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(b, 0);
  b.writeUInt32BE(13, 8); b.write('IHDR', 12, 'ascii'); b.writeUInt32BE(w, 16); b.writeUInt32BE(h, 20);
  return b;
}
fs.writeFileSync(path.join(qmlDir, 'MasterBrand.qml'),
  'return (hiRes ? Qt.resolvedUrl("./power_off_starwars_4k.png") : x);\n' +
  'return (hiRes ? Qt.resolvedUrl("./LG_logo_4k.png") : Qt.resolvedUrl("./LG_logo_2k.png"));\n');
fs.writeFileSync(path.join(qmlDir, 'LG_logo_4k.png'), png(1000, 500));
fs.writeFileSync(path.join(qmlDir, 'LG_logo_2k.png'), png(500, 250));

Object.assign(process.env, { GSR_BASE: base, GSR_QML_DIRS: qmlDir, GSR_DRY_MOUNT: '1', GSR_PORT: '0', GSR_HOST: '127.0.0.1' });
const S = require('../service/server.js');

let srv, port;
test.before(() => new Promise(r => { srv = S.start(); srv.on('listening', () => { port = srv.address().port; r(); }); }));
test.after(() => { srv.close(); fs.rmSync(tmp, { recursive: true, force: true }); });

function call(method, p, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const req = http.request({ host: '127.0.0.1', port, method, path: p, headers: data ? { 'Content-Type': 'application/json' } : {} }, res => {
      const c = []; res.on('data', d => c.push(d)); res.on('end', () => { let j = null; try { j = JSON.parse(Buffer.concat(c)); } catch (e) {} resolve({ status: res.statusCode, body: j }); });
    });
    req.on('error', reject); if (data) req.write(data); req.end();
  });
}
const b64 = b => b.toString('base64');
const good = () => ({ 'LG_logo_4k.png': b64(png(1000, 500)), 'LG_logo_2k.png': b64(png(500, 250)) });

test('pngDims reads the header and rejects non-png data', () => {
  assert.deepEqual(S.pngDims(png(12, 34)), { width: 12, height: 34 });
  assert.equal(S.pngDims(Buffer.from('GIF89a................................')), null);
  assert.equal(S.pngDims(null), null);
});

test('sniffImage accepts png, jpg and webp only', () => {
  assert.equal(S.sniffImage(png(1, 1)), 'png');
  assert.equal(S.sniffImage(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0])), 'jpg');
  assert.equal(S.sniffImage(Buffer.from('RIFF0000WEBPVP8 ')), 'webp');
  assert.equal(S.sniffImage(Buffer.from('<svg xmlns="x"></svg>')), null);
});

test('isLan allows private ranges and refuses public addresses', () => {
  for (const ip of ['127.0.0.1', '::ffff:192.168.1.5', '10.0.0.2', '172.20.1.1', 'fd12:3456::1']) assert.ok(S.isLan(ip), ip);
  for (const ip of ['8.8.8.8', '172.32.0.1', '::ffff:1.1.1.1', '2001:db8::1']) assert.ok(!S.isLan(ip), ip);
});

test('qmlLogoFiles finds the logo files the QML references, not other images', () => {
  assert.deepEqual(S.qmlLogoFiles(fs.readFileSync(path.join(qmlDir, 'MasterBrand.qml'), 'utf8')), ['LG_logo_4k.png', 'LG_logo_2k.png']);
});

test('validateRenders checks names and sizes against the discovered targets', () => {
  const t = [{ file: 'a.png', width: 10, height: 5 }];
  assert.equal(typeof S.validateRenders({ 'a.png': b64(png(10, 5)) }, t), 'object');
  assert.match(S.validateRenders({ 'a.png': b64(png(11, 5)) }, t), /must be 10x5/);
  assert.match(S.validateRenders({ 'b.png': b64(png(10, 5)) }, t), /do not match/);
  assert.match(S.validateRenders({ 'a.png': b64(Buffer.from('nope')) }, t), /not a png/);
  assert.match(S.validateRenders({}, []), /no targets/);
});

test('state reports the discovered targets with their real sizes', async () => {
  const r = await call('GET', '/api/state');
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.targets, [{ file: 'LG_logo_4k.png', width: 1000, height: 500 }, { file: 'LG_logo_2k.png', width: 500, height: 250 }]);
  assert.equal(r.body.discovery, 'qml');
  assert.equal(r.body.current, 'lg');
});

test('the bundled starter logo is seeded once', async () => {
  const r = await call('GET', '/api/state');
  const seedItem = r.body.items.find(i => i.id === 'helvio');
  assert.ok(seedItem); assert.equal(seedItem.name, 'helv.io'); assert.deepEqual(seedItem.missing, []); assert.ok(seedItem.hasSource);
  assert.ok(fs.existsSync(path.join(base, '.seeded')));
});

test('uploads are validated', async () => {
  assert.equal((await call('POST', '/api/upload', { name: 'x', source: b64(png(5, 5)), renders: { 'LG_logo_4k.png': b64(png(1000, 500)) } })).status, 400);
  assert.equal((await call('POST', '/api/upload', { name: 'x', source: b64(png(5, 5)), renders: Object.assign(good(), { 'LG_logo_2k.png': b64(png(500, 251)) }) })).status, 400);
  assert.equal((await call('POST', '/api/upload', { name: 'x', source: b64(Buffer.from('hello world!!')), renders: good() })).status, 400);
  assert.equal((await call('POST', '/api/upload', { name: 'x', renders: good() })).status, 400);
});

test('upload, apply, restore and delete round-trip', async () => {
  const up = await call('POST', '/api/upload', { name: 'My <b>logo</b>', source: b64(png(300, 100)), params: { mode: 'fit' }, renders: good() });
  assert.equal(up.status, 200);
  const id = up.body.id;
  let s = (await call('GET', '/api/state')).body, it = s.items.find(i => i.id === id);
  assert.equal(it.name, 'My blogob'); assert.ok(it.hasSource);
  assert.equal((await call('POST', '/api/apply?id=' + id)).status, 200);
  assert.equal((await call('GET', '/api/state')).body.current, id);
  assert.ok(fs.existsSync(path.join(base, 'masterbrand', 'LG_logo_4k.png')));
  assert.equal((await call('POST', '/api/restore')).status, 200);
  assert.equal((await call('GET', '/api/state')).body.current, 'lg');
  assert.ok(!fs.existsSync(path.join(base, 'masterbrand', 'LG_logo_4k.png')));
  assert.equal((await call('POST', '/api/delete?id=' + id)).status, 200);
  assert.ok(!(await call('GET', '/api/state')).body.items.some(i => i.id === id));
});

test('save as new copies the source of the item it came from', async () => {
  const r = await call('POST', '/api/upload', { name: 'copy', from: 'helvio', renders: good() });
  assert.equal(r.status, 200);
  assert.ok(fs.existsSync(path.join(base, 'library', r.body.id, 'source.png')));
});

test('a deleted seed does not come back', async () => {
  await call('POST', '/api/delete?id=helvio');
  srv.close();
  await new Promise(r => { srv = S.start(); srv.on('listening', () => { port = srv.address().port; r(); }); });
  assert.ok(!(await call('GET', '/api/state')).body.items.some(i => i.id === 'helvio'));
});

test('the issue link uses the form template, the label and no address', () => {
  const r = { app: '0', model: 'M', firmware: '1', webos: '2', release: 'r', chip: 'K', board: 'B', masterbrand: { qml: 'q', discovery: 'qml', targets: [] },
    supportPowerOffLogoCustomization: false, lgLogoDisplay: 'on', snapshotBoot: true, resume: '/dev/x', secondBootLogo: [], logoPartition: null };
  const u = new URL(S.issueURL(r));
  assert.equal(u.searchParams.get('template'), 'tv-report.yml');
  assert.equal(u.searchParams.get('labels'), 'tv-report');
  assert.match(u.searchParams.get('report'), /Model: M/);
  assert.doesNotMatch(S.reportText(r), /\b\d+\.\d+\.\d+\.\d+\b/);
});
