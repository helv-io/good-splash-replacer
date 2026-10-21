/* Good Splash Replacer: shared renderer for the phone page and the TV editor.
 * Rules, applied per target (w x h):
 *  - Fit (default, contain): if the source is smaller than the target in both
 *    dimensions it is centered at native size (no upscaling); otherwise it is
 *    scaled uniformly so the whole image is visible. Aspect ratio is always kept.
 *  - Fill (cover): scaled uniformly so the target is covered, centered crop.
 *  - zoom multiplies the base scale; dx/dy move the image by a fraction of the
 *    target size (0 = centered).
 *  - Padding is opaque bg (black by default). "knock" turns near-black pixels
 *    transparent, with threshold 0-255 on the brightest channel.
 */
(function (g) {
  function baseScale(sw, sh, w, h, mode) {
    if (mode === 'fill') return Math.max(w / sw, h / sh);
    if (sw <= w && sh <= h) return 1;
    return Math.min(w / sw, h / sh);
  }
  // Where the source lands on a w x h target: { x, y, width, height }.
  function layout(sw, sh, w, h, o) {
    o = o || {};
    var s = baseScale(sw, sh, w, h, o.mode) * (o.zoom || 1), dw = sw * s, dh = sh * s;
    return { x: (w - dw) / 2 + (o.dx || 0) * w, y: (h - dh) / 2 + (o.dy || 0) * h, width: dw, height: dh };
  }
  // Alpha for one pixel when near-black becomes transparent.
  function knockAlpha(r, g, b, a, t) {
    var m = Math.max(r, g, b);
    if (m <= t) return 0;
    if (m < t * 2) return Math.round(a * (m - t) / t);
    return a;
  }
  function render(img, w, h, o, canvas) {
    o = o || {};
    var c = canvas || document.createElement('canvas');
    c.width = w; c.height = h;
    var x = c.getContext('2d'), sw = img.naturalWidth || img.width, sh = img.naturalHeight || img.height;
    var L = layout(sw, sh, w, h, o), px = L.x, py = L.y, dw = L.width, dh = L.height;
    x.clearRect(0, 0, w, h);
    if (o.bg !== 'transparent') { x.fillStyle = o.bg || '#000000'; x.fillRect(0, 0, w, h); }
    x.imageSmoothingEnabled = true; x.imageSmoothingQuality = 'high';
    x.drawImage(img, px, py, dw, dh);
    if (o.knock) {
      var t = o.threshold == null ? 40 : o.threshold, d = x.getImageData(0, 0, w, h), a = d.data;
      for (var i = 0; i < a.length; i += 4) a[i + 3] = knockAlpha(a[i], a[i + 1], a[i + 2], a[i + 3], t);
      x.putImageData(d, 0, 0);
    }
    return c;
  }
  function b64(c) { return c.toDataURL('image/png').split(',')[1]; }
  // Render one PNG per discovered target: { "LG_logo_4k.png": base64, ... }
  function renderAll(img, targets, o) {
    var out = {};
    targets.forEach(function (t) { out[t.file] = b64(render(img, t.width, t.height, o)); });
    return out;
  }
  var api = { render: render, layout: layout, knockAlpha: knockAlpha, renderAll: renderAll, baseScale: baseScale, b64: b64,
    defaults: function () { return { mode: 'fit', zoom: 1, dx: 0, dy: 0, bg: '#000000', knock: false, threshold: 40 }; } };
  g.GSR = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : this);
