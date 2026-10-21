/* Good Splash Replacer TV app. Talks to the local service; rendering lives in render.js. */
var APPDIR = decodeURIComponent(location.pathname.replace(/\/[^\/]*$/, ''));
function readLocal(f) { try { var x = new XMLHttpRequest(); x.open('GET', f, false); x.send(); return JSON.parse(x.responseText); } catch (e) { return null; } }
var CONFIG = readLocal('service/config.json') || { port: 8086 }, APPINFO = readLocal('appinfo.json') || {};
var API = 'http://127.0.0.1:' + CONFIG.port;
var st = null, sel = null, ver = 0, bridges = [], restarted = false, rerendering = {};
var view = 'main', ed = null, menuId = null, seenPending = null;

function $(i) { return document.getElementById(i); }
function toast(t) { var e = $('toast'); e.textContent = t; e.style.opacity = 1; clearTimeout(toast.t); toast.t = setTimeout(function () { e.style.opacity = 0; }, 2500); }
function req(m, p, body, cb) {
  var x = new XMLHttpRequest(); x.open(m, API + p); x.timeout = 20000;
  x.onload = function () { var j = {}; try { j = JSON.parse(x.responseText); } catch (e) {} cb(x.status == 200 ? null : (j.error || 'error'), j); };
  x.onerror = x.ontimeout = function () { cb('offline'); };
  if (body) { x.setRequestHeader('Content-Type', 'application/json'); x.send(JSON.stringify(body)); } else x.send();
}
// Starts the service, or restarts it after a reinstall, through the Homebrew Channel root exec.
function startService() {
  try { var b = new PalmServiceBridge(); bridges.push(b); b.onservicecallback = function () {};
    b.call('luna://org.webosbrew.hbchannel.service/exec', JSON.stringify({ command: 'sh ' + APPDIR + '/service/start.sh' })); } catch (e) {}
}
function qr(el, url, cell) { var q = qrcode(0, 'M'); q.addData(url); q.make(); el.innerHTML = q.createImgTag(cell, 0); }
function loadImg(src, cb) { var i = new Image(); i.crossOrigin = 'anonymous'; i.onload = function () { cb(i); }; i.onerror = function () { cb(null); }; i.src = src; }

// ---------- main screen ----------
function render() {
  $('curimg').src = API + '/current.png?' + ver;
  var cur = st.current, it = st.items.filter(function (i) { return i.id == cur; })[0];
  $('curname').textContent = cur == 'lg' ? 'LG original' : (it ? it.name : 'Custom image');
  $('status').textContent = st.supported ? st.items.length + ' logo' + (st.items.length == 1 ? '' : 's') : 'power-off logo not found on this tv';
  var url = 'http://' + st.ip + ':' + st.port + '/';
  if ($('url').textContent != url) { $('url').textContent = url; qr($('qr'), url, 5); }
  var g = $('grid'), foc = document.activeElement && document.activeElement.dataset.id; g.innerHTML = '';
  if (sel && !st.items.some(function (i) { return i.id == sel; })) sel = null;
  if (!sel && st.items.length) sel = st.items[0].id;
  if (!st.items.length) g.innerHTML = '<div class="empty">No logos yet. Scan the code to send one from your phone.</div>';
  st.items.forEach(function (i) {
    var d = document.createElement('div');
    d.className = 'tile' + (i.id == sel ? ' sel' : '') + (i.id == cur ? ' live' : ''); d.tabIndex = 0; d.dataset.id = i.id;
    d.innerHTML = '<img alt=""><div class="n"></div>'; d.querySelector('img').src = API + '/img/' + i.id + '/thumb?' + ver;
    d.querySelector('.n').textContent = i.name; g.appendChild(d);
    if (foc == i.id) d.focus();
  });
  st.items.forEach(function (i) { if (i.missing.length && i.hasSource) rerender(i); });
}
// A logo made for other target sizes is re-rendered here from its stored source and settings.
function rerender(i) {
  if (rerendering[i.id]) return; rerendering[i.id] = 1;
  loadImg(API + '/img/' + i.id + '/source', function (img) {
    if (!img) return;
    req('POST', '/api/render?id=' + i.id, { renders: GSR.renderAll(img, st.targets, GSR.clean(i.params)) }, function () { refresh(true); });
  });
}
function refresh(force) {
  req('GET', '/api/state', null, function (e, j) {
    if (e) { $('status').textContent = 'starting the service'; startService(); return; }
    if (j.appVersion != APPINFO.version && !restarted) { restarted = true; startService(); setTimeout(function () { refresh(true); }, 3000); }
    if (force || j.version != ver) {
      var newer = st && j.items.length > st.items.length; st = j; ver = j.version;
      if (newer) sel = j.items[0].id;
      if (view == 'main') render();
      if (newer) toast('New logo received');
      // The phone asked to apply it: open its menu so the person at the TV decides.
      if (j.pending && j.pending.at != seenPending) { seenPending = j.pending.at; if (view == 'main' && st.items.some(function (i) { return i.id == j.pending.id; })) openMenu(j.pending.id); }
    }
  });
}
function loadToggle() { req('GET', '/api/logo-display', null, function (e, j) { $('tg').className = j && j.value == 'off' ? '' : 'on'; }); }
function act(p, msg) { req('POST', p, null, function (e) { toast(e ? e : msg); refresh(true); loadToggle(); }); }

// ---------- editor ----------
// A full-screen preview of the power-off screen. The preview is drawn downscaled to the screen; Save renders every
// target at full size with the same render.js, from the same cleaned settings the phone sends.
var SW = 1920, SH = 1080, STEP = 0.01;
function openEditor() {
  var it = st && st.items.filter(function (i) { return i.id == sel; })[0];
  if (!it) return toast('pick a logo first');
  if (!it.hasSource) return toast('this logo has no source image');
  loadImg(API + '/img/' + it.id + '/source?' + ver, function (img) {
    if (!img) return toast('cannot load the image');
    var o = GSR.clean(it.params);
    ed = { item: it, img: img, o: o, orig: JSON.stringify(o), edge: edgeOf(img), moving: false, busy: false };
    view = 'editor'; $('edname').textContent = it.name;
    $('edgedot').style.setProperty('--c', ed.edge);
    $('editor').className = ''; drawEditor();
    document.querySelector('#dock .e').focus();
  });
}
function edgeOf(img) {
  var k = Math.min(1, 256 / Math.max(img.naturalWidth, img.naturalHeight)), w = Math.max(1, Math.round(img.naturalWidth * k)), h = Math.max(1, Math.round(img.naturalHeight * k));
  var c = document.createElement('canvas'); c.width = w; c.height = h; var x = c.getContext('2d'); x.drawImage(img, 0, 0, w, h);
  try { return GSR.edgeColor(x.getImageData(0, 0, w, h).data, w, h); } catch (e) { return '#000000'; }
}
function bigTarget() { return st.targets.slice().sort(function (a, b) { return b.width - a.width; })[0]; }
function isDirty() { return ed && JSON.stringify(GSR.clean(ed.o)) != ed.orig; }
var edRaf = 0;
function drawEditor() { if (!edRaf) edRaf = (window.requestAnimationFrame || setTimeout)(paintEditor); }
function paintEditor() {
  edRaf = 0; if (!ed) return;
  var t = bigTarget(), o = ed.o, p = GSR.clean(o), img = ed.img;
  p.scale = SW / t.width; GSR.render(img, t.width, t.height, p, $('edcv'));
  $('mode').dataset.v = o.mode;
  [].forEach.call(document.querySelectorAll('#mode .btn'), function (b) { b.classList.toggle('on', b.dataset.a == o.mode); });
  var pick = o.bg == '#000000' || o.bg == '#ffffff' ? o.bg : o.bg == ed.edge ? 'auto' : '';
  [].forEach.call(document.querySelectorAll('#bgs .swb'), function (b) { b.classList.toggle('on', b.dataset.v == pick); });
  $('zv').textContent = Math.round(o.zoom * 100) + '%';
  tone('br', o.brightness); tone('ct', o.contrast);
  $('safebtn').classList.toggle('on', $('editor').classList.contains('show-safe'));
  $('movebtn').classList.toggle('on', ed.moving); $('adjbtn').classList.toggle('on', view == 'adjust');
  var L = GSR.layout(img.naturalWidth, img.naturalHeight, t.width, t.height, o);
  var native = o.mode == 'fit' && o.zoom == 1 && GSR.baseScale.apply(null, GSR.turned(img.naturalWidth, img.naturalHeight, o).concat([t.width, t.height, 'fit'])) == 1;
  $('edchip').textContent = (native ? 'Shown at its own size' : Math.round(L.width) + ' x ' + Math.round(L.height)) + ' on ' + t.width + ' x ' + t.height;
  $('gv').classList.toggle('on', ed.moving && o.dx === 0); $('gh').classList.toggle('on', ed.moving && o.dy === 0);
}
function tone(id, v) {
  $(id + 'v').textContent = (v > 0 ? '+' : '') + v;
  var b = $(id + 'bar').style; b.left = (v < 0 ? 50 + v / 2 : 50) + '%'; b.width = Math.abs(v) / 2 + '%';
}
function openSheet() { view = 'adjust'; $('editor').classList.add('sheet-on'); drawEditor(); document.querySelector('#adjust .e').focus(); }
function closeSheet() { view = 'editor'; $('editor').classList.remove('sheet-on'); drawEditor(); $('adjbtn').focus(); }
function startMove() { ed.moving = true; $('editor').classList.add('moving'); drawEditor(); }
function endMove() { ed.moving = false; delete ed.o.rdx; delete ed.o.rdy; $('editor').classList.remove('moving'); drawEditor(); $('movebtn').focus(); }
function nudge(dx, dy, fast) {
  var o = ed.o, s = fast ? STEP * 3 : STEP;
  o.rdx = (o.rdx == null ? o.dx : o.rdx) + dx * s; o.rdy = (o.rdy == null ? o.dy : o.rdy) + dy * s;
  o.dx = GSR.snap(o.rdx, STEP * 0.6); o.dy = GSR.snap(o.rdy, STEP * 0.6); drawEditor();
}
// Back and Cancel: close what is open first, then ask before throwing edits away.
function leaveEditor() {
  if (!isDirty()) return closeOverlay();
  view = 'unsaved'; $('unsaved').classList.remove('hidden'); document.querySelector('#unsaved [data-u="keep"]').focus();
}
function unsavedAction(u) {
  if (u == 'discard') return closeOverlay();
  $('unsaved').classList.add('hidden'); view = 'editor'; document.querySelector('#dock [data-a="cancel"]').focus();
}
function closeOverlay() {
  view = 'main'; ed = null;
  ['editor', 'reportbox', 'menu', 'confirm', 'unsaved'].forEach(function (i) { $(i).classList.add('hidden'); });
  render(); focusMain();
}
function focusMain() {
  var t = menuId && document.querySelector('.tile[data-id="' + menuId + '"]');
  (t || document.querySelector('.tile') || $('restore')).focus();
}
// ---------- item menu and delete confirmation ----------
function itemName(id) { var it = st.items.filter(function (i) { return i.id == id; })[0]; return it ? it.name : ''; }
function openMenu(id) {
  menuId = id; sel = id; view = 'menu';
  $('menuname').textContent = itemName(id); $('menu').classList.remove('hidden');
  document.querySelector('#menu .m').focus();
}
function menuAction(a) {
  var id = menuId;
  if (a == 'cancel') return closeOverlay();
  if (a == 'apply') { closeOverlay(); return act('/api/apply?id=' + id, 'Applied'); }
  if (a == 'edit') { $('menu').classList.add('hidden'); view = 'main'; return openEditor(); }
  if (a == 'delete') {
    $('menu').classList.add('hidden'); view = 'confirm';
    $('confirmname').textContent = itemName(id); $('confirm').classList.remove('hidden');
    document.querySelector('#confirm [data-c="cancel"]').focus();
  }
}
function confirmAction(c) {
  var id = menuId; closeOverlay();
  if (c == 'delete') { menuId = null; act('/api/delete?id=' + id, 'Deleted'); }
}
function edAction(a, el) {
  var o = ed.o;
  if (ed.busy) return;
  if (a == 'fit' || a == 'fill') { if (o.mode != a) { o.mode = a; o.zoom = 1; o.dx = 0; o.dy = 0; } }
  else if (a == 'bg') o.bg = el.dataset.v == 'auto' ? ed.edge : el.dataset.v;
  else if (a == 'zin') o.zoom = Math.min(4, +(o.zoom * 1.1).toFixed(3));
  else if (a == 'zout') o.zoom = Math.max(0.1, +(o.zoom / 1.1).toFixed(3));
  else if (a == 'move') return startMove();
  else if (a == 'adjust') return view == 'adjust' ? closeSheet() : openSheet();
  else if (a == 'rot') { o.rotate = (o.rotate + 90) % 360; o.dx = 0; o.dy = 0; }
  else if (a == 'safe') $('editor').classList.toggle('show-safe');
  else if (a == 'reset') { var bg = o.bg; ed.o = o = GSR.defaults(); o.bg = bg; }
  else if (a == 'br-' || a == 'br+') o.brightness = Math.max(-100, Math.min(100, o.brightness + (a == 'br+' ? 5 : -5)));
  else if (a == 'ct-' || a == 'ct+') o.contrast = Math.max(-100, Math.min(100, o.contrast + (a == 'ct+' ? 5 : -5)));
  else if (a == 'cancel') return leaveEditor();
  else if (a == 'save' || a == 'apply') {
    var p = GSR.clean(o), id = ed.item.id; ed.busy = true; toast('Saving');
    // Let the toast paint before the full-size render blocks the page.
    setTimeout(function () {
      var renders = GSR.renderAll(ed.img, st.targets, p);
      req('POST', '/api/render?id=' + id, { renders: renders, params: p }, function (e) {
        if (e) { ed.busy = false; return toast(e); }
        closeOverlay();
        if (a == 'apply') act('/api/apply?id=' + id, 'Saved and applied'); else { toast('Saved'); refresh(true); }
      });
    }, 30);
    return;
  }
  drawEditor();
}

// ---------- report ----------
function openReport() {
  view = 'report'; $('reportbox').classList.remove('hidden'); $('reptext').textContent = 'Reading'; $('repqr').innerHTML = '';
  $('repclose').focus();
  req('GET', '/api/report', null, function (e, r) {
    if (e) { $('reptext').textContent = e; return; }
    $('reptext').textContent = r.text;
    // The full issue URL is too long for a TV-readable QR code, so the code opens the report page on this TV.
    qr($('repqr'), 'http://' + st.ip + ':' + st.port + '/report', 6);
  });
}

// ---------- remote ----------
function exitApp() {
  if (window.webOSSystem && webOSSystem.platformBack) webOSSystem.platformBack();
  else if (window.PalmSystem && PalmSystem.platformBack) PalmSystem.platformBack();
  else window.close();
}
function activate(el) {
  if (!el) return;
  if (el.id == 'restore') act('/api/restore', 'LG logo restored');
  else if (el.id == 'toggle') act('/api/logo-display?value=' + ($('tg').className == 'on' ? 'off' : 'on'), 'Saved');
  else if (el.id == 'report') openReport();
  else if (el.id == 'repclose') closeOverlay();
  else if (el.dataset.a) edAction(el.dataset.a, el);
  else if (el.dataset.u) unsavedAction(el.dataset.u);
  else if (el.dataset.m) menuAction(el.dataset.m);
  else if (el.dataset.c) confirmAction(el.dataset.c);
  else if (el.dataset.id) openMenu(el.dataset.id);
}
function focusables() {
  var q = { editor: '#dock .e', adjust: '#adjust .e', unsaved: '#unsaved .u', report: '#reportbox .r', menu: '#menu .m', confirm: '#confirm .c' }[view] || '.f,.tile';
  return [].slice.call(document.querySelectorAll(q));
}
function move(dx, dy) {
  var els = focusables(), a = document.activeElement;
  if (els.indexOf(a) < 0) { if (els[0]) els[0].focus(); return; }
  var r = a.getBoundingClientRect(), cx = r.left + r.width / 2, cy = r.top + r.height / 2, best = null, bd = 1e9;
  els.forEach(function (e) {
    if (e == a) return;
    var b = e.getBoundingClientRect(), x = b.left + b.width / 2 - cx, y = b.top + b.height / 2 - cy;
    if (dx && x * dx <= 10) return; if (dy && y * dy <= 10) return;
    var d = dx ? Math.abs(x) + Math.abs(y) * 3 : Math.abs(y) + Math.abs(x) * 0.5;
    if (d < bd) { bd = d; best = e; }
  });
  if (best) best.focus();
}
function back() {
  if (view == 'unsaved') unsavedAction('keep');
  else if (view == 'adjust') closeSheet();
  else if (view == 'editor') leaveEditor();
  else if (view != 'main') closeOverlay();
  else exitApp();
}
document.addEventListener('keydown', function (e) {
  var k = e.keyCode, a = document.activeElement;
  // Move mode: arrows pan the image, OK or Back ends it. Holding an arrow moves faster.
  if (view == 'editor' && ed && ed.moving) {
    if (k == 37) nudge(-1, 0, e.repeat); else if (k == 39) nudge(1, 0, e.repeat); else if (k == 38) nudge(0, -1, e.repeat); else if (k == 40) nudge(0, 1, e.repeat);
    else if (k == 13 || k == 461 || k == 8 || k == 27) endMove();
    else return;
    e.preventDefault(); return;
  }
  if (k == 37) move(-1, 0); else if (k == 39) move(1, 0); else if (k == 38) move(0, -1); else if (k == 40) move(0, 1);
  else if (k == 13) activate(a);
  else if (k == 461 || k == 8 || k == 27) { e.preventDefault(); back(); return; }
  else return;
  e.preventDefault();
});
// ---------- Magic Remote pointer ----------
// Hover moves focus, click activates, a click on a dialog backdrop closes it, the wheel scrolls the library.
// Focus is the one source of truth, so arrows continue from wherever the pointer left it.
function focusTarget(t) {
  var el = t && t.closest ? t.closest('.btn,.tile') : null;
  return el && focusables().indexOf(el) >= 0 ? el : null;
}
document.addEventListener('mouseover', function (e) { var el = focusTarget(e.target); if (el && document.activeElement !== el) el.focus(); });
document.addEventListener('click', function (e) {
  if (view == 'unsaved' && e.target.id == 'unsaved') { unsavedAction('keep'); return; }
  if (ed && ed.moving) { endMove(); return; }
  if (view == 'adjust' && e.target.id == 'edcv') { closeSheet(); return; }
  if (e.target.classList && e.target.classList.contains('modal')) { closeOverlay(); return; }
  var el = focusTarget(e.target); if (!el) return;
  e.preventDefault(); el.focus(); activate(el);
});
// In the editor the pointer drags the image on the preview and the wheel sizes it.
var drag = null;
$('edcv').addEventListener('mousedown', function (e) { if (view == 'editor' && ed && !ed.moving) drag = { x: e.clientX, y: e.clientY, dx: ed.o.dx, dy: ed.o.dy, moved: false }; });
document.addEventListener('mousemove', function (e) {
  if (!drag || !ed) return;
  var mx = (e.clientX - drag.x) / SW, my = (e.clientY - drag.y) / SH;
  if (Math.abs(mx) + Math.abs(my) > 0.003) drag.moved = true;
  ed.o.dx = GSR.snap(drag.dx + mx); ed.o.dy = GSR.snap(drag.dy + my); drawEditor();
});
document.addEventListener('mouseup', function () { drag = null; });
$('edcv').addEventListener('wheel', function (e) {
  if (!ed || view != 'editor') return; e.preventDefault();
  ed.o.zoom = Math.max(0.1, Math.min(4, +(ed.o.zoom * Math.exp(-(e.deltaY || 0) / 400)).toFixed(3))); drawEditor();
});
$('grid').addEventListener('wheel', function (e) { $('grid').scrollLeft += e.deltaY || e.deltaX; e.preventDefault(); });
document.addEventListener('focusin', function (e) { if (e.target.classList.contains('tile') && e.target.scrollIntoView) e.target.scrollIntoView({ block: 'nearest', inline: 'nearest' }); });

refresh(true); loadToggle(); setInterval(refresh, 2000);
setTimeout(focusMain, 300);
