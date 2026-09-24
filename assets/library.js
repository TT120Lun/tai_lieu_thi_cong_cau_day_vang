/* Thư viện chỉ-xem: tài liệu PDF, hình ảnh, video YouTube.
   Dữ liệu đọc từ data/library.json + data/config.json (sinh bởi tools/build_manifest.py). */
(function () {
  'use strict';

  var TABS = ['tai-lieu', 'hinh-anh', 'video'];
  var S = { cfg: {}, docs: [], imgs: [], vids: [], tab: 'tai-lieu', q: '', proj: '', imgList: [], imgIdx: 0 };
  var WM = 'Chỉ xem';

  function $(id) { return document.getElementById(id); }
  function mk(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  function norm(s) {
    return (s || '').toString().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd');
  }
  function url(p) { return encodeURI(p); }
  function getJSON(u) {
    return fetch(u + (u.indexOf('?') < 0 ? '?v=' : '&v=') + Date.now()).then(function (r) {
      if (!r.ok) throw new Error(u + ' ' + r.status);
      return r.json();
    });
  }

  /* ---------- Hình mờ (đóng thẳng vào canvas nên ảnh lưu lại vẫn có) ---------- */
  function stamp(ctx, w, h) {
    var fs = Math.max(13, Math.round(Math.min(w, h) / 24));
    var text = WM;
    ctx.save();
    ctx.font = '600 ' + fs + 'px "IBM Plex Sans", Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.translate(w / 2, h / 2);
    ctx.rotate(-Math.PI / 7);
    var tw = ctx.measureText(text).width + fs * 3;
    var th = fs * 4.2;
    var diag = Math.sqrt(w * w + h * h);
    var row = 0;
    for (var y = -diag / 2; y < diag / 2; y += th, row++) {
      for (var x = -diag / 2 - (row % 2) * tw / 2; x < diag / 2; x += tw) {
        ctx.lineWidth = Math.max(2, fs / 7);
        ctx.strokeStyle = 'rgba(255,255,255,.28)';
        ctx.strokeText(text, x, y);
        ctx.fillStyle = 'rgba(0,0,0,.22)';
        ctx.fillText(text, x, y);
      }
    }
    ctx.restore();
  }

  /* ---------- Bộ lọc ---------- */
  function fillProjects() {
    var set = {};
    [S.docs, S.imgs, S.vids].forEach(function (a) { a.forEach(function (x) { set[x.project || 'Chung'] = 1; }); });
    var sel = $('proj');
    Object.keys(set).sort().forEach(function (p) {
      var o = mk('option', null, p); o.value = p; sel.appendChild(o);
    });
  }
  function match(x) {
    if (S.proj && (x.project || 'Chung') !== S.proj) return false;
    if (!S.q) return true;
    return norm(x.title + ' ' + (x.project || '') + ' ' + (x.desc || '')).indexOf(norm(S.q)) >= 0;
  }
  function empty(msg) { return mk('div', 'empty', msg); }

  /* ---------- Tab ---------- */
  function setTab(t, push) {
    if (TABS.indexOf(t) < 0) t = 'tai-lieu';
    S.tab = t;
    TABS.forEach(function (k) {
      $('pane-' + k).hidden = (k !== t);
      $('tab-' + k).setAttribute('aria-selected', k === t ? 'true' : 'false');
    });
    if (push) { try { history.replaceState(null, '', '#' + t); } catch (e) {} }
  }

  /* ---------- Tài liệu ---------- */
  function renderDocs() {
    var pane = $('pane-tai-lieu'); pane.textContent = '';
    var list = S.docs.filter(match);
    if (!list.length) { pane.appendChild(empty(S.docs.length ? 'Không có tài liệu khớp bộ lọc.' : 'Tài liệu đang được cập nhật.')); return; }
    var g = mk('div', 'grid docs');
    list.forEach(function (d) {
      var b = mk('button', 'item'); b.type = 'button';
      b.appendChild(mk('div', 'doc-ico', 'PDF'));
      var body = mk('div', 'body');
      body.appendChild(mk('div', 'proj', d.project || 'Chung'));
      body.appendChild(mk('h3', null, d.title));
      if (d.desc) body.appendChild(mk('p', null, d.desc));
      var meta = [];
      if (d.pages) meta.push(d.pages + ' trang');
      if (d.size_mb) meta.push(d.size_mb + ' MB');
      if (meta.length) body.appendChild(mk('div', 'meta', meta.join(' · ')));
      b.appendChild(body);
      b.addEventListener('click', function () { openPdf(d); });
      g.appendChild(b);
    });
    pane.appendChild(g);
  }

  var pdf = { doc: null, zoom: 1, token: 0, obs: null };
  function openPdf(d) {
    var v = $('pdfViewer'), body = $('pdfBody');
    $('pdfTitle').textContent = d.title;
    v.hidden = false; document.body.style.overflow = 'hidden';
    pdf.zoom = 1; pdf.token++;
    var tk = pdf.token;
    body.textContent = ''; body.appendChild(mk('div', 'viewer-msg', 'Đang tải tài liệu…'));
    if (!window.pdfjsLib) { body.textContent = ''; body.appendChild(mk('div', 'viewer-msg', 'Không tải được bộ xem PDF.')); return; }
    pdfjsLib.GlobalWorkerOptions.workerSrc = 'assets/vendor/pdf.worker.min.js';
    pdfjsLib.getDocument({ url: url(d.file) }).promise.then(function (doc) {
      if (tk !== pdf.token) { doc.destroy(); return; }
      pdf.doc = doc; buildPages(tk);
    }).catch(function () {
      if (tk !== pdf.token) return;
      body.textContent = ''; body.appendChild(mk('div', 'viewer-msg', 'Không mở được tài liệu này.'));
    });
  }
  function buildPages(tk) {
    var body = $('pdfBody'), doc = pdf.doc;
    if (pdf.obs) pdf.obs.disconnect();
    body.textContent = '';
    $('pdfZoomLbl').textContent = Math.round(pdf.zoom * 100) + '%';
    var width = Math.min(body.clientWidth - 24, 960) * pdf.zoom;
    if (width < 200) width = 200;
    doc.getPage(1).then(function (p1) {
      if (tk !== pdf.token) return;
      var vp1 = p1.getViewport({ scale: 1 });
      var ratio = vp1.height / vp1.width;
      var holders = [];
      pdf.obs = new IntersectionObserver(function (es) {
        es.forEach(function (e) {
          if (e.isIntersecting) { pdf.obs.unobserve(e.target); renderPage(tk, +e.target.dataset.n, e.target, width); }
        });
      }, { root: body, rootMargin: '600px 0px' });
      for (var n = 1; n <= doc.numPages; n++) {
        var h = mk('div', 'pdf-page', 'Trang ' + n);
        h.style.width = width + 'px'; h.style.height = Math.round(width * ratio) + 'px';
        h.dataset.n = n; body.appendChild(h); holders.push(h); pdf.obs.observe(h);
      }
    });
  }
  function renderPage(tk, n, holder, width) {
    pdf.doc.getPage(n).then(function (page) {
      if (tk !== pdf.token) return;
      var base = page.getViewport({ scale: 1 });
      var dpr = Math.min(window.devicePixelRatio || 1, 2);
      var vp = page.getViewport({ scale: (width / base.width) * dpr });
      var c = document.createElement('canvas');
      c.width = Math.floor(vp.width); c.height = Math.floor(vp.height);
      var ctx = c.getContext('2d');
      return page.render({ canvasContext: ctx, viewport: vp }).promise.then(function () {
        if (tk !== pdf.token) return;
        stamp(ctx, c.width, c.height);
        holder.textContent = ''; holder.style.height = 'auto'; holder.appendChild(c);
      });
    });
  }
  function closePdf() {
    pdf.token++;
    if (pdf.obs) pdf.obs.disconnect();
    if (pdf.doc) { try { pdf.doc.destroy(); } catch (e) {} pdf.doc = null; }
    $('pdfBody').textContent = ''; $('pdfViewer').hidden = true; document.body.style.overflow = '';
  }
  function zoom(delta) {
    if (!pdf.doc) return;
    pdf.zoom = Math.max(0.5, Math.min(2, Math.round((pdf.zoom + delta) * 10) / 10));
    pdf.token++; buildPages(pdf.token);
  }

  /* ---------- Hình ảnh ---------- */
  function drawImg(img, maxW) {
    var w = Math.min(img.naturalWidth, maxW), h = Math.round(img.naturalHeight * w / img.naturalWidth);
    var c = document.createElement('canvas'); c.width = w; c.height = h;
    var ctx = c.getContext('2d'); ctx.drawImage(img, 0, 0, w, h); stamp(ctx, w, h);
    return c;
  }
  function loadImg(src, cb) {
    var im = new Image();
    im.onload = function () { cb(im); };
    im.onerror = function () { cb(null); };
    im.src = url(src);
  }
  function renderImgs() {
    var pane = $('pane-hinh-anh'); pane.textContent = '';
    var list = S.imgs.filter(match); S.imgList = list;
    if (!list.length) { pane.appendChild(empty(S.imgs.length ? 'Không có hình ảnh khớp bộ lọc.' : 'Hình ảnh đang được cập nhật.')); return; }
    var g = mk('div', 'grid imgs protect');
    var obs = new IntersectionObserver(function (es) {
      es.forEach(function (e) {
        if (!e.isIntersecting) return;
        obs.unobserve(e.target);
        var box = e.target, i = +box.dataset.i;
        loadImg(list[i].file, function (im) { if (im) { box.textContent = ''; box.appendChild(drawImg(im, 640)); } });
      });
    }, { rootMargin: '300px' });
    list.forEach(function (it, i) {
      var b = mk('button', 'item'); b.type = 'button';
      var t = mk('div', 'thumb'); t.dataset.i = i; obs.observe(t);
      b.appendChild(t);
      var body = mk('div', 'body');
      body.appendChild(mk('div', 'proj', it.project || 'Chung'));
      body.appendChild(mk('h3', null, it.title));
      if (it.desc) body.appendChild(mk('p', null, it.desc));
      b.appendChild(body);
      b.addEventListener('click', function () { openImg(i); });
      g.appendChild(b);
    });
    pane.appendChild(g);
  }
  function openImg(i) {
    var n = S.imgList.length; if (!n) return;
    S.imgIdx = (i + n) % n;
    var it = S.imgList[S.imgIdx], body = $('imgBody');
    $('imgViewer').hidden = false; document.body.style.overflow = 'hidden';
    $('imgTitle').textContent = it.title; $('imgPos').textContent = (S.imgIdx + 1) + ' / ' + n;
    body.textContent = ''; body.appendChild(mk('div', 'viewer-msg', 'Đang tải…'));
    var idx = S.imgIdx;
    loadImg(it.file, function (im) {
      if (idx !== S.imgIdx || $('imgViewer').hidden) return;
      body.textContent = '';
      body.appendChild(im ? drawImg(im, 1800) : mk('div', 'viewer-msg', 'Không mở được ảnh này.'));
    });
  }
  function closeImg() { $('imgViewer').hidden = true; $('imgBody').textContent = ''; document.body.style.overflow = ''; }

  /* ---------- Video (YouTube nhúng) ---------- */
  function renderVids() {
    var pane = $('pane-video'); pane.textContent = '';
    var list = S.vids.filter(match);
    if (!list.length) { pane.appendChild(empty(S.vids.length ? 'Không có video khớp bộ lọc.' : 'Video đang được cập nhật.')); return; }
    var g = mk('div', 'grid vids');
    list.forEach(function (v) {
      var b = mk('button', 'item'); b.type = 'button';
      var t = mk('div', 'vthumb');
      var im = document.createElement('img');
      im.src = 'https://i.ytimg.com/vi/' + v.id + '/hqdefault.jpg'; im.alt = ''; im.loading = 'lazy';
      t.appendChild(im); t.appendChild(mk('div', 'play', '▶'));
      b.appendChild(t);
      var body = mk('div', 'body');
      body.appendChild(mk('div', 'proj', v.project || 'Chung'));
      body.appendChild(mk('h3', null, v.title));
      if (v.desc) body.appendChild(mk('p', null, v.desc));
      b.appendChild(body);
      b.addEventListener('click', function () { openVid(v); });
      g.appendChild(b);
    });
    pane.appendChild(g);
  }
  function openVid(v) {
    $('vidTitle').textContent = v.title;
    var body = $('vidBody'); body.textContent = '';
    var f = mk('div', 'frame'), ifr = document.createElement('iframe');
    ifr.src = 'https://www.youtube-nocookie.com/embed/' + encodeURIComponent(v.id) + '?rel=0&modestbranding=1&autoplay=1';
    ifr.title = v.title; ifr.allow = 'autoplay; encrypted-media; picture-in-picture; fullscreen';
    ifr.setAttribute('allowfullscreen', ''); ifr.referrerPolicy = 'strict-origin-when-cross-origin';
    f.appendChild(ifr); body.appendChild(f);
    $('vidViewer').hidden = false; document.body.style.overflow = 'hidden';
  }
  function closeVid() { $('vidBody').textContent = ''; $('vidViewer').hidden = true; document.body.style.overflow = ''; }

  /* ---------- Liên hệ ---------- */
  function renderContact() {
    var c = (S.cfg && S.cfg.lien_he) || {}, box = $('contact');
    var acts = mk('div', 'acts'), any = false;
    if (c.email) {
      var a = mk('a', 'btn btn-primary', 'Gửi email'); a.href = 'mailto:' + c.email + '?subject=' + encodeURIComponent('Xin bản gốc tài liệu/hình ảnh/video'); acts.appendChild(a); any = true;
    }
    if (c.youtube) {
      var y = mk('a', 'btn btn-outline', 'Kênh YouTube'); y.href = c.youtube; y.target = '_blank'; y.rel = 'noopener'; acts.appendChild(y); any = true;
    }
    if (!any && !c.ghi_chu) return;
    box.textContent = '';
    box.appendChild(mk('p', null, c.ghi_chu || 'Nội dung chỉ để xem. Cần bản gốc vui lòng liên hệ trực tiếp.'));
    if (any) box.appendChild(acts);
    box.hidden = false;
  }

  /* ---------- Chặn thao tác tải/sao chép thông thường ---------- */
  function guards() {
    document.addEventListener('contextmenu', function (e) {
      if (e.target.closest && e.target.closest('.protect, .thumb, .viewer')) e.preventDefault();
    });
    document.addEventListener('dragstart', function (e) {
      if (e.target.closest && e.target.closest('.protect, .thumb, .viewer')) e.preventDefault();
    });
    document.addEventListener('keydown', function (e) {
      var open = !$('pdfViewer').hidden || !$('imgViewer').hidden || !$('vidViewer').hidden;
      if (e.key === 'Escape' && open) { closePdf(); closeImg(); closeVid(); return; }
      if (!$('imgViewer').hidden) {
        if (e.key === 'ArrowLeft') openImg(S.imgIdx - 1);
        if (e.key === 'ArrowRight') openImg(S.imgIdx + 1);
      }
      if ((e.ctrlKey || e.metaKey) && ['s', 'p', 'u'].indexOf((e.key || '').toLowerCase()) >= 0) e.preventDefault();
    });
  }

  /* ---------- Khởi tạo ---------- */
  function refresh() { renderDocs(); renderImgs(); renderVids(); }
  function init() {
    TABS.forEach(function (t) { $('tab-' + t).addEventListener('click', function () { setTab(t, true); }); });
    $('q').addEventListener('input', function (e) { S.q = e.target.value; refresh(); });
    $('proj').addEventListener('change', function (e) { S.proj = e.target.value; refresh(); });
    $('pdfClose').addEventListener('click', closePdf);
    $('imgClose').addEventListener('click', closeImg);
    $('vidClose').addEventListener('click', closeVid);
    $('pdfZoomIn').addEventListener('click', function () { zoom(0.2); });
    $('pdfZoomOut').addEventListener('click', function () { zoom(-0.2); });
    $('imgPrev').addEventListener('click', function () { openImg(S.imgIdx - 1); });
    $('imgNext').addEventListener('click', function () { openImg(S.imgIdx + 1); });
    guards();
    setTab((location.hash || '').replace('#', ''), false);
    window.addEventListener('hashchange', function () { setTab((location.hash || '').replace('#', ''), false); });

    Promise.all([getJSON('data/config.json').catch(function () { return {}; }), getJSON('data/library.json')]).then(function (r) {
      S.cfg = r[0] || {}; if (S.cfg.watermark) WM = S.cfg.watermark;
      var lib = r[1] || {};
      S.docs = lib.documents || []; S.imgs = lib.images || []; S.vids = lib.videos || [];
      $('cnt-tai-lieu').textContent = S.docs.length; $('cnt-hinh-anh').textContent = S.imgs.length; $('cnt-video').textContent = S.vids.length;
      fillProjects(); refresh(); renderContact();
    }).catch(function () {
      ['pane-tai-lieu', 'pane-hinh-anh', 'pane-video'].forEach(function (id) {
        $(id).appendChild(empty('Không tải được danh mục. Vui lòng mở trang qua địa chỉ web (không mở trực tiếp file).'));
      });
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
