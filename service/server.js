// Good Splash Replacer service. Runs as root on the TV (node 16+, no dependencies).
// Serves the phone upload page, the library, the TV report, and the apply/restore actions.
'use strict';
const http = require('http'), fs = require('fs'), path = require('path'), os = require('os'), crypto = require('crypto');
const { execFile, execFileSync } = require('child_process');

const CONFIG = JSON.parse(fs.readFileSync(path.join(__dirname, 'config.json'), 'utf8'));
const PORT = Number(process.env.GSR_PORT || CONFIG.port);
const BASE = process.env.GSR_BASE || '/mnt/lg/user/custom-logo';
const QML_DIRS = (process.env.GSR_QML_DIRS || '/usr/lib/qml/MasterBrand').split(':');
const DRY = process.env.GSR_DRY_MOUNT === '1'; // tests: copy files, never mount
const LIB = path.join(BASE, 'library'), MB = path.join(BASE, 'masterbrand');
const MAX_BODY = 24 * 1024 * 1024, MAX_SOURCE = 12 * 1024 * 1024;
const APP_VERSION = (() => { try { return JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'appinfo.json'), 'utf8')).version; } catch (e) { return 'dev'; } })();

// Fallback hints only, used when the logo files cannot be read. Discovery always wins.
const KNOWN = {
  K24N: [{ file: 'LG_logo_4k.png', width: 1000, height: 500 }, { file: 'LG_logo_2k.png', width: 500, height: 250 }],
};

// ---------- pure helpers (unit tested) ----------
const PNG_SIG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
function pngDims(b) {
  if (!Buffer.isBuffer(b) || b.length < 33 || !b.subarray(0, 8).equals(PNG_SIG) || b.toString('ascii', 12, 16) !== 'IHDR') return null;
  return { width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
}
function sniffImage(b) {
  if (!Buffer.isBuffer(b) || b.length < 12) return null;
  if (b.subarray(0, 8).equals(PNG_SIG)) return 'png';
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpg';
  if (b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP') return 'webp';
  return null;
}
function bareIP(ip) { return String(ip || '').replace(/^::ffff:/, ''); }
function isLocal(ip) { ip = bareIP(ip); return ip === '127.0.0.1' || ip === '::1'; }
function isLan(ip) {
  ip = bareIP(ip);
  return isLocal(ip) || /^10\./.test(ip) || /^192\.168\./.test(ip) || /^172\.(1[6-9]|2\d|3[01])\./.test(ip) ||
    /^169\.254\./.test(ip) || /^f[cd][0-9a-f]{2}:/i.test(ip) || /^fe80:/i.test(ip);
}
// Logo file names the MasterBrand QML references, in order, without duplicates.
function qmlLogoFiles(qml) {
  const out = [], re = /resolvedUrl\(\s*["']\.\/(LG_logo[^"']*\.png)["']\s*\)/g;
  let m; while ((m = re.exec(qml))) if (!out.includes(m[1])) out.push(m[1]);
  return out;
}
// Renders must be exactly one PNG per target at the target's size.
function validateRenders(renders, targets) {
  if (!renders || typeof renders !== 'object') return 'missing renders';
  const keys = Object.keys(renders);
  if (!targets.length) return 'no targets on this tv';
  if (keys.length !== targets.length || !targets.every(t => keys.includes(t.file))) return 'renders do not match the targets';
  const out = {};
  for (const t of targets) {
    const b = Buffer.from(String(renders[t.file]), 'base64'), d = pngDims(b);
    if (!d) return t.file + ' is not a png';
    if (d.width !== t.width || d.height !== t.height) return t.file + ' must be ' + t.width + 'x' + t.height;
    out[t.file] = b;
  }
  return out;
}
function cleanName(n) { return String(n || '').replace(/[^\w .'-]/g, '').trim().slice(0, 40) || 'Logo'; }
function cleanId(id) { return String(id || '').replace(/[^a-z0-9-]/g, ''); }
function lanIP() {
  const ifs = os.networkInterfaces(), pref = n => (/^(eth|wlan|en|wl)/.test(n) ? 0 : 1);
  for (const n of Object.keys(ifs).sort((a, b) => pref(a) - pref(b))) for (const a of ifs[n])
    if (a.family === 'IPv4' && !a.internal && !a.address.startsWith('169.254.')) return a.address;
  return '127.0.0.1';
}

// ---------- TV state ----------
function readMounts() { try { return fs.readFileSync('/proc/mounts', 'utf8'); } catch (e) { return ''; } }
function mounted(p) { return DRY ? fs.existsSync(p + '.gsr-dry') : readMounts().includes(' ' + p + ' '); }
function chip() { try { return (fs.readFileSync('/proc/cmdline', 'utf8').match(/\bchip=(\S+)/) || [])[1] || null; } catch (e) { return null; } }

let discovered = null;
function discover(force) {
  if (discovered && !force) return discovered;
  const cacheFile = path.join(BASE, 'targets.json');
  let cache = {}; try { cache = JSON.parse(fs.readFileSync(cacheFile, 'utf8')); } catch (e) {}
  for (const dir of QML_DIRS) {
    const qml = path.join(dir, 'MasterBrand.qml');
    let files = [], how = 'qml';
    if (fs.existsSync(qml)) files = qmlLogoFiles(fs.readFileSync(qml, 'utf8'));
    if (!files.length && fs.existsSync(dir)) { files = fs.readdirSync(dir).filter(f => /^LG_logo.*\.png$/.test(f)).sort().reverse(); how = 'files'; }
    if (!files.length) continue;
    const targets = [];
    for (const file of files) {
      const p = path.join(dir, file);
      // A bind-mounted file shows our image, so prefer the size recorded before we mounted anything.
      let d = mounted(p) && cache[p] ? cache[p] : null;
      if (!d) { try { const fd = fs.openSync(p, 'r'), b = Buffer.alloc(33); fs.readSync(fd, b, 0, 33, 0); fs.closeSync(fd); d = pngDims(b); } catch (e) {} }
      if (d) { targets.push({ file, width: d.width, height: d.height, path: p }); cache[p] = { width: d.width, height: d.height }; }
    }
    try { fs.writeFileSync(cacheFile, JSON.stringify(cache)); } catch (e) {}
    if (targets.length) return (discovered = { dir, qml: fs.existsSync(qml) ? qml : null, how, targets });
  }
  const hint = KNOWN[chip()];
  return (discovered = { dir: null, qml: null, how: hint ? 'hint' : 'none', targets: hint ? hint.map(t => Object.assign({ path: null }, t)) : [] });
}
const targets = () => discover().targets;
const publicTargets = () => targets().map(t => ({ file: t.file, width: t.width, height: t.height }));

function ensureDirs() { fs.mkdirSync(LIB, { recursive: true }); fs.mkdirSync(MB, { recursive: true }); }
// One-time seed of the bundled starter logos. The marker keeps a deleted seed from coming back.
function seed() {
  const marker = path.join(BASE, '.seeded'), src = path.join(__dirname, 'seed');
  if (fs.existsSync(marker)) return;
  if (fs.existsSync(src) && fs.readdirSync(LIB).length === 0)
    for (const d of fs.readdirSync(src)) {
      fs.mkdirSync(path.join(LIB, d), { recursive: true });
      for (const f of fs.readdirSync(path.join(src, d))) fs.copyFileSync(path.join(src, d, f), path.join(LIB, d, f));
    }
  fs.writeFileSync(marker, String(Date.now()));
}
function sourceFile(dir) { return ['source.png', 'source.jpg', 'source.webp'].map(f => path.join(dir, f)).find(f => fs.existsSync(f)); }
function list() {
  const ts = targets();
  return fs.readdirSync(LIB).filter(d => fs.statSync(path.join(LIB, d)).isDirectory()).map(id => {
    const dir = path.join(LIB, id);
    let name = id, params = null;
    try { name = fs.readFileSync(path.join(dir, 'name'), 'utf8').trim() || id; } catch (e) {}
    try { params = JSON.parse(fs.readFileSync(path.join(dir, 'params.json'), 'utf8')); } catch (e) {}
    const missing = ts.filter(t => { const d = (() => { try { return pngDims(fs.readFileSync(path.join(dir, t.file))); } catch (e) { return null; } })(); return !d || d.width !== t.width || d.height !== t.height; }).map(t => t.file);
    return { id, name, params, hasSource: !!sourceFile(dir), missing, t: fs.statSync(dir).mtimeMs };
  }).sort((a, b) => b.t - a.t);
}
function current() {
  const ts = targets();
  if (!ts.length || !ts[0].path || !mounted(ts[0].path)) return 'lg';
  const items = list();
  try { const id = fs.readFileSync(path.join(MB, 'source'), 'utf8').trim(); if (items.some(i => i.id === id)) return id; } catch (e) {}
  try {
    const row = readActive().find(r => r[0] === ts[0].path);
    const live = fs.readFileSync(row ? row[1] : path.join(MB, ts[0].file));
    for (const i of items) { const f = path.join(LIB, i.id, ts[0].file); if (fs.existsSync(f) && live.equals(fs.readFileSync(f))) { fs.writeFileSync(path.join(MB, 'source'), i.id); return i.id; } }
  } catch (e) {}
  return 'custom';
}
// Mounts are recorded in masterbrand/active as "<target path> <file>" lines; init.d/72-goodsplash-logo replays them at boot.
function bind(src, dst) { if (DRY) fs.writeFileSync(dst + '.gsr-dry', src); else execFileSync('mount', ['--bind', src, dst]); }
// Unmount until the target shows the stock file again; a correct setup needs exactly one umount.
function unbind(dst) {
  for (let i = 0; i < 5 && mounted(dst); i++) { if (DRY) fs.unlinkSync(dst + '.gsr-dry'); else execFileSync('umount', [dst]); }
  if (mounted(dst)) throw new Error('cannot unmount ' + path.basename(dst));
}
function readActive() {
  try { return fs.readFileSync(path.join(MB, 'active'), 'utf8').split('\n').filter(Boolean).map(l => l.split(' ')); } catch (e) { return []; }
}
function writeActive(rows) {
  const tmp = path.join(MB, 'active.tmp');
  fs.writeFileSync(tmp, rows.map(r => r.join(' ')).join('\n') + (rows.length ? '\n' : ''));
  fs.renameSync(tmp, path.join(MB, 'active'));
}
// Delete files in masterbrand/ that no mount uses any more.
function prune(keep) {
  for (const f of fs.readdirSync(MB)) if (/\.png$/.test(f) && !keep.includes(path.join(MB, f))) try { fs.unlinkSync(path.join(MB, f)); } catch (e) {}
}
// Never writes to a mounted file: each apply writes new versioned files, then per target one umount and one bind.
function apply(id) {
  const ts = targets(), dir = path.join(LIB, id);
  if (!ts.length || !ts[0].path) throw new Error('no logo files found on this tv');
  if (!fs.existsSync(dir)) throw new Error('unknown logo');
  const item = list().find(i => i.id === id);
  if (item.missing.length) throw new Error('logo needs a re-render for this tv');
  const stamp = Date.now().toString(36), rows = [];
  for (const t of ts) {
    const dst = path.join(MB, id + '.' + stamp + '.' + t.file);
    fs.copyFileSync(path.join(dir, t.file), dst);
    rows.push([t.path, dst]);
  }
  for (const [target, file] of rows) { unbind(target); bind(file, target); }
  writeActive(rows);
  fs.writeFileSync(path.join(MB, 'source'), id);
  prune(rows.map(r => r[1]));
}
function restore() {
  for (const t of targets()) if (t.path) unbind(t.path);
  for (const [target] of readActive()) unbind(target);
  writeActive([]);
  try { fs.unlinkSync(path.join(MB, 'source')); } catch (e) {}
  prune([]);
}
function saveItem(id, body, isNew) {
  const r = validateRenders(body.renders, targets());
  if (typeof r === 'string') throw Object.assign(new Error(r), { code: 400 });
  const dir = path.join(LIB, id);
  let src = null, kind = null;
  if (body.source) {
    src = Buffer.from(String(body.source), 'base64'); kind = sniffImage(src);
    if (!kind) throw Object.assign(new Error('source is not a png, jpg or webp'), { code: 400 });
    if (src.length > MAX_SOURCE) throw Object.assign(new Error('source is too big'), { code: 400 });
  } else if (isNew && !body.from) throw Object.assign(new Error('missing source'), { code: 400 });
  fs.mkdirSync(dir, { recursive: true });
  if (src) { for (const f of ['source.png', 'source.jpg', 'source.webp']) try { fs.unlinkSync(path.join(dir, f)); } catch (e) {} fs.writeFileSync(path.join(dir, 'source.' + kind), src); }
  else if (body.from) { const s = sourceFile(path.join(LIB, cleanId(body.from))); if (s) fs.copyFileSync(s, path.join(dir, path.basename(s))); }
  for (const f of Object.keys(r)) fs.writeFileSync(path.join(dir, f), r[f]);
  if (body.params && typeof body.params === 'object') fs.writeFileSync(path.join(dir, 'params.json'), JSON.stringify(body.params));
  if (isNew || body.name) fs.writeFileSync(path.join(dir, 'name'), cleanName(body.name));
}

// ---------- TV report (read-only; no serials, MACs, IPs or accounts) ----------
function sh(cmd, args) { return new Promise(res => execFile(cmd, args, { timeout: 8000 }, (e, out) => res(e ? '' : String(out)))); }
async function luna(uri, payload) { try { return JSON.parse(await sh('luna-send', ['-n', '1', uri, JSON.stringify(payload)])); } catch (e) { return null; } }
function md5(p) { try { return crypto.createHash('md5').update(fs.readFileSync(p)).digest('hex'); } catch (e) { return null; } }
async function report() {
  const info = (await luna('luna://com.webos.service.tv.systemproperty/getSystemInfo', { keys: ['modelName', 'firmwareVersion', 'sdkVersion', 'boardType'] })) || {};
  const prof = await luna('luna://com.webos.service.systemprofile/getProfiles', { names: ['customization'] });
  const set = await luna('luna://com.webos.settingsservice/getSystemSettings', { category: 'other', keys: ['lgLogoDisplay'] });
  let cmdline = ''; try { cmdline = fs.readFileSync('/proc/cmdline', 'utf8'); } catch (e) {}
  let release = ''; try { release = fs.readFileSync('/etc/starfish-release', 'utf8').trim(); } catch (e) {}
  const d = discover(true);
  const sbRoot = '/usr/share/qt5-qpa-starfish/resources/images';
  const secondBoot = [];
  try { for (const r of fs.readdirSync(sbRoot)) for (const f of fs.readdirSync(path.join(sbRoot, r))) if (/SecondBootLogo/.test(f)) {
    const p = path.join(sbRoot, r, f); let dims = null; try { dims = pngDims(fs.readFileSync(p).subarray(0, 33)); } catch (e) {}
    secondBoot.push({ path: p, size: dims ? dims.width + 'x' + dims.height : null });
  } } catch (e) {}
  let logoPart = null;
  try {
    const m = fs.readFileSync('/proc/partinfo', 'utf8').match(/part(\d+):\s+\S+\s+(\S+)\s+"logo"/);
    if (m) {
      const dev = '/dev/mmcblk0p' + m[1], b = Buffer.alloc(64); let head = null;
      try { const fd = fs.openSync(dev, 'r'); fs.readSync(fd, b, 0, 64, 0); fs.closeSync(fd); head = b.toString('hex'); } catch (e) {}
      logoPart = { name: 'logo', device: dev, size: parseInt(m[2], 16), first64: head };
    }
  } catch (e) {}
  const model = String(info.modelName || '').replace(/\..*/, '') || null; // drop the region/batch suffix
  return {
    app: APP_VERSION,
    model, firmware: info.firmwareVersion || null, webos: info.sdkVersion || null, release: release || null,
    chip: (cmdline.match(/\bchip=(\S+)/) || [])[1] || null, board: info.boardType || null,
    masterbrand: { dir: d.dir, qml: d.qml, discovery: d.how,
      targets: d.targets.map(t => ({ file: t.file, width: t.width, height: t.height, path: t.path, md5: t.path ? md5(t.path) : null, overridden: t.path ? mounted(t.path) : false })) },
    supportPowerOffLogoCustomization: prof && prof.profiles && prof.profiles.customization ? !!prof.profiles.customization.supportPowerOffLogoCustomization : null,
    lgLogoDisplay: set && set.settings ? set.settings.lgLogoDisplay : null,
    snapshotBoot: /\bsnapshot\b/.test(cmdline), resume: (cmdline.match(/\bresume=(\S+)/) || [])[1] || null,
    secondBootLogo: secondBoot, logoPartition: logoPart,
  };
}
function reportText(r) {
  const t = r.masterbrand.targets.map(x => '  - ' + x.file + ' ' + x.width + 'x' + x.height + ' md5 ' + x.md5 + (x.overridden ? ' (replaced by app)' : '')).join('\n');
  return ['Model: ' + r.model, 'Firmware: ' + r.firmware, 'webOS: ' + r.webos + ' / ' + r.release, 'Chip: ' + r.chip, 'Board: ' + r.board,
    'App: ' + r.app, 'MasterBrand: ' + r.masterbrand.qml + ' via ' + r.masterbrand.discovery, 'Targets:', t || '  none',
    'supportPowerOffLogoCustomization: ' + r.supportPowerOffLogoCustomization, 'lgLogoDisplay: ' + r.lgLogoDisplay,
    'Snapshot boot: ' + r.snapshotBoot + ' resume=' + r.resume,
    'SecondBootLogo:', r.secondBootLogo.map(s => '  - ' + s.path + ' ' + s.size).join('\n') || '  none',
    'Logo partition: ' + (r.logoPartition ? r.logoPartition.device + ' ' + r.logoPartition.size + ' bytes' : 'not found'),
    'First 64 bytes: ' + (r.logoPartition && r.logoPartition.first64 || 'n/a')].join('\n');
}
function issueURL(r) {
  const q = new URLSearchParams({ template: 'tv-report.yml', labels: 'tv-report', title: 'TV report: ' + r.model + ' fw ' + r.firmware,
    model: String(r.model), firmware: String(r.firmware), report: reportText(r) });
  return 'https://github.com/' + CONFIG.repo + '/issues/new?' + q.toString();
}

// ---------- HTTP ----------
let version = Date.now();
const bump = () => { version = Date.now(); };
function send(res, code, body, type) {
  res.writeHead(code, { 'Content-Type': type || 'application/json', 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}
function readJSON(req, cb) {
  const chunks = []; let n = 0, dead = false;
  req.on('data', c => { n += c.length; if (n > MAX_BODY) { dead = true; req.destroy(); } else chunks.push(c); });
  req.on('end', () => { if (dead) return; let j = null; try { j = JSON.parse(Buffer.concat(chunks).toString()); } catch (e) {} cb(j); });
}
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
function reportPage(r) {
  return '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>TV report</title>' +
    '<style>body{font-family:system-ui,sans-serif;background:#111;color:#eee;max-width:640px;margin:auto;padding:20px}pre{white-space:pre-wrap;word-break:break-all;background:#1b1b1b;padding:12px;border-radius:8px;font-size:13px}' +
    'a.btn{display:block;text-align:center;padding:16px;border-radius:10px;background:#e6007e;color:#fff;font-weight:600;text-decoration:none;font-size:18px}</style>' +
    '<h1>TV report</h1><p>Read-only. No serial numbers, MAC or IP addresses.</p><a class="btn" href="' + esc(issueURL(r)) + '">Open GitHub issue</a><pre>' + esc(reportText(r)) + '</pre>';
}

function handler(req, res) {
  const ip = req.socket.remoteAddress || '';
  if (!isLan(ip)) return send(res, 403, { error: 'lan only' });
  const u = new URL(req.url, 'http://x'), p = u.pathname, local = isLocal(ip), M = req.method;
  const fail = e => send(res, e.code || 500, { error: String(e.message || e) });
  try {
    if (M === 'GET' && p === '/') return send(res, 200, fs.readFileSync(path.join(__dirname, 'upload.html')), 'text/html; charset=utf-8');
    if (M === 'GET' && p === '/render.js') return send(res, 200, fs.readFileSync(path.join(__dirname, '..', 'render.js')), 'text/javascript');
    if (M === 'GET' && p === '/api/state') return send(res, 200, { ip: lanIP(), port: PORT, appVersion: APP_VERSION, version, discovery: discover().how,
      supported: targets().length > 0 && !!targets()[0].path, targets: publicTargets(), current: current(), items: list() });
    let m = p.match(/^\/img\/([a-z0-9-]+)\/([\w.]+)$/);
    if (M === 'GET' && m) {
      const dir = path.join(LIB, m[1]);
      const f = m[2] === 'source' ? sourceFile(dir) : m[2] === 'thumb' ? targets().map(t => path.join(dir, t.file)).find(x => fs.existsSync(x)) || sourceFile(dir) : path.join(dir, path.basename(m[2]));
      if (!f || !fs.existsSync(f)) return send(res, 404, { error: 'not found' });
      return send(res, 200, fs.readFileSync(f), { png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp' }[sniffImage(fs.readFileSync(f).subarray(0, 12))] || 'application/octet-stream');
    }
    if (M === 'GET' && p === '/current.png') {
      const t = targets()[0]; if (!t || !t.path) return send(res, 404, { error: 'no logo' });
      const row = readActive().find(r => r[0] === t.path);
      return send(res, 200, fs.readFileSync(row && mounted(t.path) ? row[1] : t.path), 'image/png');
    }
    if (M === 'GET' && p === '/api/report') return report().then(r => send(res, 200, Object.assign(r, { text: reportText(r), issueUrl: issueURL(r) })), fail);
    if (M === 'GET' && p === '/report') return report().then(r => send(res, 200, reportPage(r), 'text/html; charset=utf-8'), fail);
    if (M === 'POST' && p === '/api/upload') return readJSON(req, j => {
      if (!j) return send(res, 400, { error: 'bad request' });
      try { const id = 'u' + Date.now().toString(36); saveItem(id, j, true); bump(); send(res, 200, { ok: true, id }); } catch (e) { fail(e); }
    });
    // Everything below changes the TV; only the TV app itself may call it.
    if (!local) return send(res, 403, { error: 'tv only' });
    if (M === 'POST' && p === '/api/render') return readJSON(req, j => {
      const id = cleanId(u.searchParams.get('id'));
      if (!j || !id || !fs.existsSync(path.join(LIB, id))) return send(res, 400, { error: 'bad request' });
      try { saveItem(id, j, false); bump(); send(res, 200, { ok: true }); } catch (e) { fail(e); }
    });
    if (M === 'POST' && p === '/api/apply') { apply(cleanId(u.searchParams.get('id'))); bump(); return send(res, 200, { ok: true }); }
    if (M === 'POST' && p === '/api/restore') { restore(); bump(); return send(res, 200, { ok: true }); }
    if (M === 'POST' && p === '/api/delete') {
      const id = cleanId(u.searchParams.get('id'));
      if (!id) return send(res, 400, { error: 'missing id' });
      fs.rmSync(path.join(LIB, id), { recursive: true, force: true }); bump();
      return send(res, 200, { ok: true });
    }
    if (M === 'GET' && p === '/api/logo-display') return luna('luna://com.webos.settingsservice/getSystemSettings', { category: 'other', keys: ['lgLogoDisplay'] })
      .then(r => send(res, 200, { value: r && r.settings ? r.settings.lgLogoDisplay : null }));
    if (M === 'POST' && p === '/api/logo-display') {
      const v = u.searchParams.get('value') === 'off' ? 'off' : 'on';
      return luna('luna://com.webos.settingsservice/setSystemSettings', { category: 'other', settings: { lgLogoDisplay: v } })
        .then(r => send(res, 200, { ok: !!(r && r.returnValue), value: v }));
    }
    send(res, 404, { error: 'not found' });
  } catch (e) { fail(e); }
}

function start() {
  ensureDirs(); seed(); discover();
  const srv = http.createServer(handler);
  srv.listen(PORT, process.env.GSR_HOST || '0.0.0.0');
  if (!process.env.GSR_BASE) { try { fs.writeFileSync('/tmp/goodsplash.pid', String(process.pid)); fs.writeFileSync('/tmp/goodsplash.ver', APP_VERSION); } catch (e) {} }
  return srv;
}
// Exit cleanly on SIGTERM or SIGINT: stop accepting, drop open sockets, exit. No file is held open between requests.
function onSignals(srv) {
  const stop = () => { try { srv.close(); } catch (e) {} if (srv.closeAllConnections) srv.closeAllConnections(); setTimeout(() => process.exit(0), 200).unref(); };
  process.once('SIGTERM', stop); process.once('SIGINT', stop);
}

module.exports = { readActive, pngDims, sniffImage, isLan, isLocal, qmlLogoFiles, validateRenders, cleanName, cleanId, reportText, issueURL, start, handler, KNOWN };
if (require.main === module) onSignals(start());
