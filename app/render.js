/* Good Splash Replacer: shared renderer for the phone page and the TV editor.
 * Rules, applied per target (w x h):
 *  - Fit (default, contain): if the source is smaller than the target in both
 *    dimensions it is centered at native size (no upscaling); otherwise it is
 *    scaled uniformly so the whole image is visible. Aspect ratio is always kept.
 *  - Fill (cover): scaled uniformly so the target is covered, centered crop.
 *  - rotate turns the source by 0, 90, 180 or 270 degrees before sizing.
 *  - zoom multiplies the base scale; dx/dy move the image by a fraction of the
 *    target size (0 = centered).
 *  - brightness and contrast run from -100 to 100 (0 = unchanged) and touch the
 *    image only, never the padding.
 *  - Padding is opaque bg (black by default). Output is always opaque.
 *  - scale (preview only) draws the same layout on a smaller canvas.
 */
(function (g) {
  function rot(o) { var r = ((+(o && o.rotate) || 0) % 360 + 360) % 360; return r - r % 90; }
  // Source size after rotation.
  function turned(sw, sh, o) { return rot(o) % 180 ? [sh, sw] : [sw, sh]; }
  function baseScale(sw, sh, w, h, mode) {
    if (mode === 'fill') return Math.max(w / sw, h / sh);
    if (sw <= w && sh <= h) return 1;
    return Math.min(w / sw, h / sh);
  }
  // Where the (rotated) source lands on a w x h target: { x, y, width, height }.
  function layout(sw, sh, w, h, o) {
    o = o || {};
    var t = turned(sw, sh, o); sw = t[0]; sh = t[1];
    var s = baseScale(sw, sh, w, h, o.mode) * (o.zoom || 1), dw = sw * s, dh = sh * s;
    return { x: (w - dw) / 2 + (o.dx || 0) * w, y: (h - dh) / 2 + (o.dy || 0) * h, width: dw, height: dh };
  }
  // Offsets within eps of center snap to 0, so a drag can land exactly centered.
  function snap(v, eps) { return Math.abs(v) < (eps == null ? 0.015 : eps) ? 0 : v; }
  // One channel after brightness and contrast (-100..100 each).
  function tone(v, br, ct) {
    var c = (ct || 0) * 2.55, f = (259 * (c + 255)) / (255 * (259 - c));
    v = f * (v - 128) + 128 + (br || 0) * 2.55;
    return v < 0 ? 0 : v > 255 ? 255 : Math.round(v);
  }
  function hex(r, g, b) { return '#' + [r, g, b].map(function (v) { return (v < 16 ? '0' : '') + v.toString(16); }).join(''); }
  // Most common color along the border of RGBA data, as #rrggbb. Colors are bucketed so noise does not win.
  function edgeColor(d, w, h) {
    var n = {}, best = null, top = 0;
    function add(x, y) {
      var i = (y * w + x) * 4; if (d[i + 3] < 128) return;
      var k = (d[i] >> 4) + ',' + (d[i + 1] >> 4) + ',' + (d[i + 2] >> 4), e = n[k] || (n[k] = [0, 0, 0, 0]);
      e[0] += d[i]; e[1] += d[i + 1]; e[2] += d[i + 2]; e[3]++;
      if (e[3] > top) { top = e[3]; best = e; }
    }
    for (var x = 0; x < w; x++) { add(x, 0); add(x, h - 1); }
    for (var y = 1; y < h - 1; y++) { add(0, y); add(w - 1, y); }
    if (!best) return '#000000';
    return hex(Math.round(best[0] / best[3]), Math.round(best[1] / best[3]), Math.round(best[2] / best[3]));
  }
  function defaults() { return { mode: 'fit', zoom: 1, dx: 0, dy: 0, rotate: 0, brightness: 0, contrast: 0, bg: '#000000' }; }
  function color(v) { return /^#[0-9a-f]{6}$/i.test(v) ? v.toLowerCase() : '#000000'; }
  function num(v, d, lo, hi) { v = +v; return isFinite(v) ? Math.max(lo, Math.min(hi, v)) : d; }
  // Saved settings, known fields only. Old or unknown fields are ignored and bad values fall back to the defaults,
  // so settings saved by any version load, and the phone and the TV render the same thing from them.
  function clean(p) {
    p = p && typeof p === 'object' ? p : {};
    return { mode: p.mode === 'fill' ? 'fill' : 'fit', zoom: num(p.zoom, 1, 0.1, 4), dx: num(p.dx, 0, -2, 2), dy: num(p.dy, 0, -2, 2),
      rotate: rot(p), brightness: num(p.brightness, 0, -100, 100), contrast: num(p.contrast, 0, -100, 100), bg: color(p.bg) };
  }
  function render(img, w, h, o, canvas) {
    o = o || {};
    var k = o.scale || 1, c = canvas || document.createElement('canvas');
    c.width = Math.round(w * k); c.height = Math.round(h * k);
    var x = c.getContext('2d'), sw = img.naturalWidth || img.width, sh = img.naturalHeight || img.height;
    var L = layout(sw, sh, w, h, o), r = rot(o), tonal = (o.brightness || 0) || (o.contrast || 0);
    x.setTransform(1, 0, 0, 1, 0, 0);
    x.clearRect(0, 0, c.width, c.height);
    // The image is drawn on its own layer so tone never touches the padding.
    var lc = document.createElement('canvas'); lc.width = c.width; lc.height = c.height;
    var lx = lc.getContext('2d');
    lx.imageSmoothingEnabled = true; lx.imageSmoothingQuality = 'high';
    lx.setTransform(k, 0, 0, k, 0, 0);
    lx.translate(L.x + L.width / 2, L.y + L.height / 2);
    lx.rotate(r * Math.PI / 180);
    var dw = r % 180 ? L.height : L.width, dh = r % 180 ? L.width : L.height;
    lx.drawImage(img, -dw / 2, -dh / 2, dw, dh);
    if (tonal) {
      var D = lx.getImageData(0, 0, lc.width, lc.height), a = D.data, lut = [];
      for (var v = 0; v < 256; v++) lut[v] = tone(v, o.brightness, o.contrast);
      for (var i = 0; i < a.length; i += 4) if (a[i + 3]) { a[i] = lut[a[i]]; a[i + 1] = lut[a[i + 1]]; a[i + 2] = lut[a[i + 2]]; }
      lx.putImageData(D, 0, 0);
    }
    x.fillStyle = color(o.bg); x.fillRect(0, 0, c.width, c.height);
    x.drawImage(lc, 0, 0);
    return c;
  }
  function b64(c) { return c.toDataURL('image/png').split(',')[1]; }
  // Render one PNG per discovered target: { "LG_logo_4k.png": base64, ... }
  function renderAll(img, targets, o) {
    var out = {}, p = clean(o);
    targets.forEach(function (t) { out[t.file] = b64(render(img, t.width, t.height, p)); });
    return out;
  }
  var api = { render: render, layout: layout, clean: clean, renderAll: renderAll, baseScale: baseScale, b64: b64,
    snap: snap, tone: tone, edgeColor: edgeColor, turned: turned,
    defaults: defaults };
  g.GSR = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : this);
