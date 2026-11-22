/* Herd · public site
   No framework, no dependencies. Each block below is one part of the page:
   nav, index, reveal, hero (aerial herd + thermal wordmark), problem dot plot,
   signals demo (Herd's real baseline rules), environment field + instruments,
   species index, principles, field log thumbnails, closing lines. */
(() => {
  'use strict';

  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const TAU = Math.PI * 2;
  const MINUS = '−';
  const NS = 'http://www.w3.org/2000/svg';
  const RM = matchMedia('(prefers-reduced-motion: reduce)');
  const reduced = () => RM.matches;
  const fmtPct = (p) => (p === 0 ? '0%' : (p > 0 ? '+' : MINUS) + Math.abs(p) + '%');
  const fmtNum = (v, d = 0) => v.toFixed(d).replace('-', MINUS);
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  function rng(seed) { // mulberry32
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const gauss = (r) => (r() + r() + r() + r() - 2) / 2;

  function makeNoise(seed) {
    const r = rng(seed), P = new Uint8Array(512), G = new Float32Array(256);
    for (let i = 0; i < 256; i++) { P[i] = i; G[i] = r(); }
    for (let i = 255; i > 0; i--) { const j = (r() * (i + 1)) | 0; const t = P[i]; P[i] = P[j]; P[j] = t; }
    for (let i = 0; i < 256; i++) P[i + 256] = P[i];
    const n2 = (x, y) => {
      const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
      const X = xi & 255, Y = yi & 255;
      const a = G[P[P[X] + Y]], b = G[P[P[X + 1] + Y]], c = G[P[P[X] + Y + 1]], d = G[P[P[X + 1] + Y + 1]];
      const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
      return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
    };
    return (x, y, oct = 4) => {
      let f = 0, amp = 0.5, fr = 1, norm = 0;
      for (let o = 0; o < oct; o++) { f += amp * n2(x * fr, y * fr); norm += amp; amp *= 0.5; fr *= 2.03; }
      return f / norm;
    };
  }

  /* Thermal palette, shared by the hero wordmark and the environment field. */
  const HEAT = [[0, [8, 3, 26]], [0.16, [34, 8, 72]], [0.3, [86, 14, 118]], [0.44, [158, 24, 118]], [0.57, [222, 52, 86]], [0.69, [255, 112, 34]], [0.81, [255, 186, 52]], [0.92, [255, 236, 160]], [1, [255, 255, 246]]];
  function makeLut(stops) {
    const L = new Uint8ClampedArray(256 * 3);
    for (let i = 0; i < 256; i++) {
      const t = i / 255;
      let k = 0;
      while (k < stops.length - 2 && t > stops[k + 1][0]) k++;
      const [t0, c0] = stops[k], [t1, c1] = stops[k + 1];
      const u = clamp((t - t0) / (t1 - t0), 0, 1);
      for (let j = 0; j < 3; j++) L[i * 3 + j] = c0[j] + (c1[j] - c0[j]) * u;
    }
    return L;
  }
  const LUT = makeLut(HEAT);

  const svgEl = (tag, attrs, parent) => {
    const el = document.createElementNS(NS, tag);
    for (const k in attrs) el.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(el);
    return el;
  };

  /* One scroll listener, many subscribers. */
  const onScrollFns = [];
  let scrollRaf = 0;
  addEventListener('scroll', () => {
    if (!scrollRaf) scrollRaf = requestAnimationFrame(() => { scrollRaf = 0; onScrollFns.forEach((f) => f()); });
  }, { passive: true });

  /* ======================================================================
     Nav: compact status bar after the hero, tone follows the section below.
     ====================================================================== */
  function initNav() {
    const nav = $('#nav'), out = $('#nav-section');
    const secs = $$('main [data-name], footer[data-name]');
    let compact = null;
    const update = () => {
      const c = scrollY > Math.min(innerHeight * 0.5, 420);
      if (c !== compact) { compact = c; nav.classList.toggle('is-compact', c); }
      const y = (nav.offsetHeight || 60) / 2;
      for (const s of secs) {
        const r = s.getBoundingClientRect();
        if (r.top <= y && r.bottom > y) {
          if (nav.dataset.tone !== s.dataset.tone) nav.dataset.tone = s.dataset.tone;
          if (out.textContent !== s.dataset.name) out.textContent = s.dataset.name;
          break;
        }
      }
    };
    onScrollFns.push(update);
    addEventListener('resize', update);
    update();
  }

  /* ======================================================================
     Index overlay
     ====================================================================== */
  function initIndex() {
    const box = $('#index'), open = $('#index-open'), close = $('#index-close');
    $$('.index-list > li', box).forEach((li, i) => li.style.setProperty('--i', i));
    let last = null;
    const show = () => {
      last = document.activeElement;
      box.hidden = false;
      open.setAttribute('aria-expanded', 'true');
      document.documentElement.style.overflow = 'hidden';
      close.focus();
    };
    const hide = (refocus) => {
      box.hidden = true;
      open.setAttribute('aria-expanded', 'false');
      document.documentElement.style.overflow = '';
      if (refocus && last) last.focus();
    };
    open.addEventListener('click', show);
    close.addEventListener('click', () => hide(true));
    box.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { e.preventDefault(); hide(true); }
      if (e.key === 'Tab') {
        const f = $$('a, button', box);
        const first = f[0], end = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); end.focus(); }
        else if (!e.shiftKey && document.activeElement === end) { e.preventDefault(); first.focus(); }
      }
    });
    $$('a', box).forEach((a) => a.addEventListener('click', () => hide(false)));
  }

  /* ======================================================================
     Reveal, line splits, count-ups
     ====================================================================== */
  function countUp(el) {
    const to = Number(el.dataset.count);
    if (reduced() || !Number.isFinite(to) || to === 0) { el.textContent = to.toLocaleString('en-US'); return; }
    const dur = 1400, t0 = performance.now();
    const tick = (now) => {
      const p = clamp((now - t0) / dur, 0, 1), e = 1 - Math.pow(1 - p, 4);
      el.textContent = Math.round(to * e).toLocaleString('en-US');
      if (p < 1) requestAnimationFrame(tick);
    };
    el.textContent = '0';
    requestAnimationFrame(tick);
  }

  function scramble(el) {
    const final = el.textContent;
    if (reduced()) return;
    const glyphs = '0123456789#+/\\%';
    const dur = 900, t0 = performance.now();
    const tick = (now) => {
      const p = clamp((now - t0) / dur, 0, 1);
      let s = '';
      for (let i = 0; i < final.length; i++) {
        const settle = (i + 1) / final.length;
        s += p >= settle || final[i] === ' ' ? final[i] : glyphs[(Math.random() * glyphs.length) | 0];
      }
      el.textContent = s;
      if (p < 1) requestAnimationFrame(tick); else el.textContent = final;
    };
    requestAnimationFrame(tick);
  }

  function initReveal() {
    $$('[data-split]').forEach((el) => {
      Array.from(el.children).forEach((s, i) => {
        const inner = document.createElement('span');
        inner.textContent = s.textContent;
        s.textContent = '';
        s.appendChild(inner);
        s.style.setProperty('--i', i);
      });
    });
    $$('[data-reveal]').forEach((el) => {
      const sibs = Array.from(el.parentElement.children).filter((c) => c.hasAttribute('data-reveal'));
      const i = sibs.indexOf(el);
      if (i > 0) el.style.setProperty('--d', Math.min(i, 6) * 0.08 + 's');
    });
    $$('.species-row li').forEach((li, i) => li.style.setProperty('--i', i));

    const targets = $$('[data-reveal], [data-split], .species-row, .dotplot, .sp, [data-count], .stats');
    const onIn = (el) => {
      if (el.hasAttribute('data-count')) countUp(el);
      if (el.classList.contains('stats')) $$('.stat b:not([data-count])', el).forEach(scramble);
    };
    if (!('IntersectionObserver' in window)) { targets.forEach((t) => { t.classList.add('in'); }); return; }
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        e.target.classList.add('in');
        io.unobserve(e.target);
        onIn(e.target);
      }
    }, { rootMargin: '0px 0px -10% 0px', threshold: 0.01 });
    targets.forEach((t) => io.observe(t));
  }

  /* ======================================================================
     Hero: an aerial pasture, seen from a drone. Every animal carries its own
     ID and baseline. Inside the wordmark the same field is seen in thermal,
     where the flagged animal runs hottest.
     ====================================================================== */
  function initHero() {
    const sec = $('.hero'), cv = $('.hero-canvas');
    if (!sec || !cv || !cv.getContext) return;
    const ctx = cv.getContext('2d', { alpha: false });
    const probeT = $('#probe-track'), probeH = $('#probe-hover');
    const hmCount = $('#hm-count'), hmState = $('#hm-state');
    const noise = makeNoise(42);
    const FONT = '"Host Grotesk", ui-sans-serif, system-ui, sans-serif';
    const COATS = [[[22, 19, 17], 0.3], [[36, 29, 24], 0.18], [[80, 49, 31], 0.2], [[108, 68, 43], 0.1], [[214, 205, 188], 0.13], [[178, 162, 140], 0.09]];

    let W = 0, H = 0, DPR = 1, S = 1, gutter = 16;
    const gPad = 30;
    let ground = null, word = null, maskData = null;
    let small = null, smallCtx = null, smallImg = null, thermal = null, thermalCtx = null, F = null;
    let animals = [], groups = [], sick = null;
    const ptr = { x: -1e4, y: -1e4, tx: 0, ty: 0, px: 0, py: 0 };
    let hover = null, lastHover = undefined, running = false, visible = true, raf = 0, last = 0, t = 0, ready = false;
    const R = rng(1117);

    function pickCoat(r) {
      let x = r();
      for (const [c, w] of COATS) { if ((x -= w) <= 0) return c; }
      return COATS[0][0];
    }

    /* Pasture: low-res noise upscaled, then grain, tracks, a fence and a trough. */
    function paintGround() {
      const gw = W + gPad * 2, gh = H + gPad * 2;
      const c = document.createElement('canvas');
      c.width = Math.round(gw * DPR); c.height = Math.round(gh * DPR);
      const g = c.getContext('2d');
      const k = 2, lw = Math.ceil(gw / k), lh = Math.ceil(gh / k);
      const lc = document.createElement('canvas'); lc.width = lw; lc.height = lh;
      const lg = lc.getContext('2d'), im = lg.createImageData(lw, lh), d = im.data;
      const sc = 1 / (240 * S);
      for (let y = 0; y < lh; y++) {
        for (let x = 0; x < lw; x++) {
          const nx = x * k * sc, ny = y * k * sc;
          const n = noise(nx, ny, 5), m = noise(nx * 3.1 + 40, ny * 3.1 - 17, 3), dry = noise(nx * 0.7 + 90, ny * 0.7 + 12, 3);
          const stripe = Math.sin((x * k * 0.86 + y * k * 0.5) / (34 * S) + noise(nx * 0.8, ny * 0.8, 2) * 4) * 0.5 + 0.5;
          let v = clamp((n * 0.62 + m * 0.38 - 0.25) * 1.9, 0, 1) * 0.86 + stripe * 0.14;
          let r = lerp(14, 40, v), gg = lerp(30, 68, v), b = lerp(22, 46, v);
          if (v > 0.58) { const u = (v - 0.58) / 0.42; r = lerp(r, 66, u); gg = lerp(gg, 90, u); b = lerp(b, 58, u); }
          const df = clamp((dry - 0.6) / 0.14, 0, 1) * 0.55;
          r = lerp(r, 92, df); gg = lerp(gg, 92, df); b = lerp(b, 62, df);
          const i = (y * lw + x) * 4;
          d[i] = r; d[i + 1] = gg; d[i + 2] = b; d[i + 3] = 255;
        }
      }
      lg.putImageData(im, 0, 0);
      g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high';
      g.drawImage(lc, 0, 0, c.width, c.height);
      g.setTransform(DPR, 0, 0, DPR, 0, 0);
      const r = rng(9);
      // grass grain
      const tufts = Math.round((gw * gh) / 28);
      for (let i = 0; i < tufts; i++) {
        const lt = r() < 0.5;
        g.fillStyle = lt ? 'rgba(150,180,130,.13)' : 'rgba(0,10,4,.26)';
        g.fillRect(r() * gw, r() * gh, 1 + (r() < 0.25), 1 + (r() < 0.25));
      }
      // two wheel ruts
      const rut = (off, w, col) => {
        g.beginPath();
        g.moveTo(-20, gh * 0.9 + off);
        g.bezierCurveTo(gw * 0.3, gh * 0.74 + off, gw * 0.5, gh * 0.48 + off, gw * 0.7, gh * 0.4 + off);
        g.bezierCurveTo(gw * 0.84, gh * 0.34 + off, gw * 0.95, gh * 0.18 + off, gw + 30, gh * 0.06 + off);
        g.lineWidth = w; g.strokeStyle = col; g.stroke();
      };
      rut(4 * S, 14 * S, 'rgba(110,104,72,.10)');
      rut(0, 2.2 * S, 'rgba(96,84,58,.42)');
      rut(8 * S, 2.2 * S, 'rgba(96,84,58,.36)');
      // fence along the top right with posts and shadows
      const fx0 = gw * 0.56, fy0 = -10, fx1 = gw + 10, fy1 = gh * 0.36;
      const len = Math.hypot(fx1 - fx0, fy1 - fy0), ux = (fx1 - fx0) / len, uy = (fy1 - fy0) / len;
      g.strokeStyle = 'rgba(0,0,0,.35)'; g.lineWidth = 1;
      g.beginPath(); g.moveTo(fx0 + 4, fy0 + 5); g.lineTo(fx1 + 4, fy1 + 5); g.stroke();
      g.strokeStyle = 'rgba(214,214,200,.32)';
      g.beginPath(); g.moveTo(fx0, fy0); g.lineTo(fx1, fy1); g.stroke();
      for (let s = 0; s < len; s += 28 * S) {
        const px = fx0 + ux * s, py = fy0 + uy * s;
        g.fillStyle = 'rgba(0,0,0,.4)'; g.fillRect(px + 2, py + 3, 3, 3);
        g.fillStyle = 'rgba(190,180,160,.7)'; g.fillRect(px - 1, py - 1, 2.5, 2.5);
      }
      // trough
      g.save();
      g.translate(gw * 0.34, gh * 0.5); g.rotate(-0.32);
      g.fillStyle = 'rgba(0,0,0,.35)'; g.fillRect(-20 * S + 4, -6 * S + 5, 40 * S, 12 * S);
      g.fillStyle = 'rgba(140,146,140,.9)'; g.fillRect(-20 * S, -6 * S, 40 * S, 12 * S);
      g.fillStyle = 'rgba(40,70,82,.95)'; g.fillRect(-18 * S, -4 * S, 36 * S, 8 * S);
      g.fillStyle = 'rgba(170,210,220,.28)'; g.fillRect(-18 * S, -4 * S, 36 * S, 2 * S);
      g.restore();
      // worn ground around the trough
      const wg = g.createRadialGradient(gw * 0.34, gh * 0.5, 4, gw * 0.34, gh * 0.5, 70 * S);
      wg.addColorStop(0, 'rgba(92,82,58,.32)'); wg.addColorStop(1, 'rgba(92,82,58,0)');
      g.fillStyle = wg; g.fillRect(0, 0, gw, gh);
      // vignette and a cool grade
      const vg = g.createRadialGradient(gw * 0.5, gh * 0.42, Math.min(gw, gh) * 0.2, gw * 0.5, gh * 0.5, Math.max(gw, gh) * 0.78);
      vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,6,4,.55)');
      g.fillStyle = vg; g.fillRect(0, 0, gw, gh);
      const top = g.createLinearGradient(0, 0, 0, gh * 0.3);
      top.addColorStop(0, 'rgba(3,8,6,.6)'); top.addColorStop(1, 'rgba(3,8,6,0)');
      g.fillStyle = top; g.fillRect(0, 0, gw, gh * 0.3);
      return c;
    }

    /* The wordmark: a mask of "herd" plus the buffers for the thermal view. */
    function buildWord() {
      const m = document.createElement('canvas').getContext('2d');
      const ls = (fs) => { if ('letterSpacing' in m) m.letterSpacing = (-0.04 * fs).toFixed(2) + 'px'; };
      m.font = `700 200px ${FONT}`; ls(200);
      const mt = m.measureText('herd');
      const inkW = mt.actualBoundingBoxLeft + mt.actualBoundingBoxRight;
      const asc = mt.actualBoundingBoxAscent, desc = Math.max(0, mt.actualBoundingBoxDescent);
      let fs = ((W - 2 * gutter) / inkW) * 200;
      fs = Math.min(fs, ((H * (W < 700 ? 0.3 : 0.6)) / asc) * 200);
      const k = fs / 200;
      const w = Math.ceil(inkW * k) + 2, h = Math.ceil((asc + desc) * k) + 2;
      const x = Math.round(gutter), y = Math.round(H - gutter * 0.6 - h);
      const mask = document.createElement('canvas');
      mask.width = Math.round(w * DPR); mask.height = Math.round(h * DPR);
      const mg = mask.getContext('2d');
      mg.scale(DPR, DPR);
      mg.font = `700 ${fs}px ${FONT}`;
      if ('letterSpacing' in mg) mg.letterSpacing = (-0.04 * fs).toFixed(2) + 'px';
      mg.fillStyle = '#fff';
      mg.fillText('herd', mt.actualBoundingBoxLeft * k + 1, asc * k + 1);
      maskData = { data: mg.getImageData(0, 0, mask.width, mask.height).data, w: mask.width, h: mask.height };
      // scanlines, like a thermal camera
      mg.globalCompositeOperation = 'destination-out';
      mg.fillStyle = 'rgba(0,0,0,.16)';
      for (let yy = 0; yy < h; yy += 3) mg.fillRect(0, yy, w, 1);

      const cs = Math.max(3, Math.round(5 * S));
      const tw = Math.ceil(w / cs) + 2, th = Math.ceil(h / cs) + 2;
      const base = new Float32Array(tw * th);
      for (let j = 0; j < th; j++) for (let i = 0; i < tw; i++) {
        const gx = (x + i * cs) / (240 * S), gy = (y + j * cs) / (240 * S);
        base[j * tw + i] = 0.33 + 0.17 * noise(gx, gy, 4) + 0.05 * noise(gx * 4 + 7, gy * 4 + 3, 2);
      }
      word = { x, y, w, h, cs, tw, th, base, mask };
      small = document.createElement('canvas'); small.width = tw; small.height = th;
      smallCtx = small.getContext('2d'); smallImg = smallCtx.createImageData(tw, th);
      thermal = document.createElement('canvas'); thermal.width = mask.width; thermal.height = mask.height;
      thermalCtx = thermal.getContext('2d');
      F = new Float32Array(tw * th);
    }

    function inLetter(px, py) {
      if (!maskData) return false;
      const mx = Math.round((px - word.x) * DPR), my = Math.round((py - word.y) * DPR);
      if (mx < 0 || my < 0 || mx >= maskData.w || my >= maskData.h) return false;
      return maskData.data[(my * maskData.w + mx) * 4 + 3] > 200;
    }

    /* Find a resting place for the flagged animal well inside a letter stroke. */
    function sickSpot(len) {
      const want = [word.x + word.w * (W < 700 ? 0.62 : 0.6), word.y + word.h * 0.5];
      let best = null, bd = Infinity;
      const step = Math.max(3, len * 0.25);
      for (let y = word.y; y < word.y + word.h; y += step) {
        for (let x = word.x; x < word.x + word.w; x += step) {
          const r = len * 0.75;
          if (!inLetter(x, y) || !inLetter(x - r, y) || !inLetter(x + r, y) || !inLetter(x, y - r * 0.7) || !inLetter(x, y + r * 0.7)) continue;
          const d = Math.hypot(x - want[0], (y - want[1]) * 1.4);
          if (d < bd) { bd = d; best = [x, y]; }
        }
      }
      return best || want;
    }

    function spark(r, delta) {
      const v = [];
      for (let i = 0; i < 13; i++) v.push(100 + gauss(r) * 9);
      v.push(100 * (1 + delta / 100));
      return v;
    }

    function spawn() {
      const n = Math.round(clamp((W * H) / 14000, 30, 104));
      const area = [[0.2, 0.42], [0.5, 0.64], [0.8, 0.46]];
      groups = area.map(([gx, gy], i) => ({ x: gx * W, y: gy * H, vx: (i - 1) * 3, vy: 0 }));
      const ids = [];
      for (let i = 0; i < n + 1; i++) ids.push(101 + i);
      for (let i = ids.length - 1; i > 0; i--) { const j = (R() * (i + 1)) | 0; [ids[i], ids[j]] = [ids[j], ids[i]]; }
      const idx117 = ids.indexOf(117); if (idx117 >= 0) ids.splice(idx117, 1);
      animals = [];
      for (let i = 0; i < n; i++) {
        const gi = i % 3, g = groups[gi];
        const a = {
          x: g.x + gauss(R) * 210 * S, y: g.y + gauss(R) * 110 * S,
          h: R() * TAU, want: R() * TAU, sp: 0, len: (22 + R() * 8) * S,
          coat: pickCoat(R), id: 'HRD-0' + ids[i], g: gi,
          state: 'graze', timer: R() * 6, bob: R() * TAU, ping: -9,
          delta: Math.round(gauss(R) * 9), level: 'nominal', lying: false,
        };
        a.delta = clamp(a.delta, -16, 14);
        animals.push(a);
      }
      // two animals on watch
      [[3, -22], [Math.floor(n / 2) + 1, -27]].forEach(([i, d]) => { if (animals[i]) { animals[i].delta = d; animals[i].level = 'watch'; } });
      // the flagged one: lying down, alone, inside the wordmark
      const len = 27 * S;
      const [sx, sy] = sickSpot(len);
      sick = { x: sx, y: sy, h: -0.5, want: -0.5, sp: 0, len, coat: [30, 24, 20], id: 'HRD-0117', g: -1, state: 'lie', timer: 1e9, bob: 0, ping: -9, delta: -34, level: 'flag', lying: true, sick: true };
      animals.push(sick);
      animals.forEach((a) => { const r = rng(parseInt(a.id.slice(4), 10) * 31); a.spark = spark(r, a.delta); });
      // keep herd animals off the flagged one's spot
      animals.forEach((a) => { if (a !== sick && Math.hypot(a.x - sick.x, a.y - sick.y) < 60 * S) { a.x -= 80 * S; } });
      const watch = animals.filter((a) => a.level === 'watch').length;
      hmCount.textContent = `${animals.length} subjects`;
      hmState.textContent = `${animals.length - watch - 1} nominal · ${watch} watch · 1 flag`;
    }

    function build() {
      const oldW = W, oldH = H;
      W = Math.round(sec.clientWidth); H = Math.round(sec.clientHeight);
      if (!W || !H) return;
      DPR = Math.min(window.devicePixelRatio || 1, W * H > 1.6e6 ? 1.5 : 2);
      S = clamp(Math.min(W / 1440, H / 860), 0.6, 1.3);
      gutter = clamp(W * 0.04, 16, 58);
      cv.width = Math.round(W * DPR); cv.height = Math.round(H * DPR);
      ground = paintGround();
      buildWord();
      if (!animals.length || !oldW) spawn();
      else {
        const kx = W / oldW, ky = H / oldH;
        animals.forEach((a) => { if (a !== sick) { a.x *= kx; a.y *= ky; } });
        groups.forEach((g) => { g.x *= kx; g.y *= ky; });
        const [sx, sy] = sickSpot(sick.len); sick.x = sx; sick.y = sy;
      }
      ready = true;
    }

    /* ---- simulation ---- */
    const angDiff = (a, b) => { let d = (a - b) % TAU; if (d > Math.PI) d -= TAU; if (d < -Math.PI) d += TAU; return d; };

    function step(dt) {
      t += dt;
      for (const g of groups) {
        g.vx += (R() - 0.5) * 6 * dt; g.vy += (R() - 0.5) * 6 * dt;
        const sp = Math.hypot(g.vx, g.vy), mx = 5 * S;
        if (sp > mx) { g.vx *= mx / sp; g.vy *= mx / sp; }
        g.x += g.vx * dt; g.y += g.vy * dt;
        if (g.x < W * 0.14 || g.x > W * 0.86) g.vx *= -1;
        if (g.y < H * 0.3 || g.y > H * 0.76) g.vy *= -1;
        g.x = clamp(g.x, W * 0.14, W * 0.86); g.y = clamp(g.y, H * 0.3, H * 0.76);
      }
      for (const a of animals) {
        if (a.lying) continue;
        a.timer -= dt;
        const g = groups[a.g], dx = g.x - a.x, dy = g.y - a.y, dist = Math.hypot(dx, dy);
        if (a.timer <= 0) {
          if (a.state === 'graze' && R() < 0.3) { a.state = 'walk'; a.timer = 2 + R() * 4; a.want = Math.atan2(dy, dx) + (R() - 0.5) * 1.2; }
          else { a.state = 'graze'; a.timer = 3 + R() * 8; a.want = a.h + (R() - 0.5) * 1.8; }
        }
        if (dist > 220 * S) a.want = Math.atan2(dy, dx);
        a.h += clamp(angDiff(a.want, a.h), -1.1 * dt, 1.1 * dt);
        const target = a.state === 'walk' ? 10 * S : (Math.sin(t * 0.7 + a.bob) > 0.3 ? 1.6 * S : 0);
        a.sp += (target - a.sp) * Math.min(1, dt * 1.4);
        a.x += Math.cos(a.h) * a.sp * dt; a.y += Math.sin(a.h) * a.sp * dt;
        a.x = clamp(a.x, 12, W - 12); a.y = clamp(a.y, H * 0.17, H - 12);
      }
      // separation
      for (let i = 0; i < animals.length; i++) {
        const a = animals[i];
        for (let j = i + 1; j < animals.length; j++) {
          const b = animals[j];
          const dx = b.x - a.x, dy = b.y - a.y, min = (a.len + b.len) * 0.52, d2 = dx * dx + dy * dy;
          if (d2 > 0.01 && d2 < min * min) {
            const d = Math.sqrt(d2), push = (min - d) * 0.5, nx = dx / d, ny = dy / d;
            if (!a.lying) { a.x -= nx * push; a.y -= ny * push; }
            if (!b.lying) { b.x += nx * push; b.y += ny * push; }
          }
        }
      }
      // scan line pings
      const sx = scanX();
      for (const a of animals) if (Math.abs(a.x - sx) < 4) a.ping = t;
    }
    const SCAN = 11;
    const scanX = () => ((t % SCAN) / SCAN) * (W + 240) - 120;

    /* ---- drawing ---- */
    function ellipse(x, y, rx, ry, rot) { ctx.beginPath(); ctx.ellipse(x, y, rx, ry, rot, 0, TAU); ctx.fill(); }
    const rgb = (c, k = 1) => `rgb(${(c[0] * k) | 0},${(c[1] * k) | 0},${(c[2] * k) | 0})`;

    function drawAnimal(a) {
      const L = a.len, c = a.coat;
      ctx.save();
      ctx.translate(a.x, a.y); ctx.rotate(a.h);
      ctx.fillStyle = rgb(c);
      ctx.strokeStyle = 'rgba(0,0,0,.35)'; ctx.lineWidth = 0.8;
      if (a.lying) {
        ellipse(0, 0, L * 0.42, L * 0.3, 0);
        ctx.fillStyle = rgb(c, 0.85); ellipse(L * 0.36, L * 0.12, L * 0.14, L * 0.1, 0.5);
      } else {
        ellipse(0, 0, L * 0.5, L * 0.23, 0); ctx.stroke();
        const bob = a.state === 'graze' ? Math.sin(t * 3 + a.bob) * L * 0.035 : 0;
        const hx = L * (a.state === 'graze' ? 0.56 : 0.5) + bob;
        ctx.fillStyle = rgb(c, c[0] > 150 ? 0.92 : 1.15);
        ellipse(hx, 0, L * 0.15, L * 0.105, 0);
        ctx.fillStyle = rgb(c, 0.8);
        ellipse(hx - L * 0.06, -L * 0.1, L * 0.05, L * 0.025, 0.4);
        ellipse(hx - L * 0.06, L * 0.1, L * 0.05, L * 0.025, -0.4);
      }
      ctx.fillStyle = c[0] > 150 ? 'rgba(255,255,255,.18)' : 'rgba(255,255,255,.07)';
      ellipse(-L * 0.06, -L * 0.07, L * 0.3, L * 0.08, 0);
      ctx.restore();
    }

    function splat(cx, cy, r, amp) {
      const { tw, th } = word;
      const x0 = Math.max(0, Math.floor(cx - 2 * r)), x1 = Math.min(tw - 1, Math.ceil(cx + 2 * r));
      const y0 = Math.max(0, Math.floor(cy - 2 * r)), y1 = Math.min(th - 1, Math.ceil(cy + 2 * r));
      const ir = 1 / (r * r);
      for (let j = y0; j <= y1; j++) {
        const dy = (j - cy) * (j - cy);
        for (let i = x0; i <= x1; i++) {
          const d2 = ((i - cx) * (i - cx) + dy) * ir;
          if (d2 < 4) F[j * tw + i] += amp * Math.exp(-d2 * 1.3);
        }
      }
    }

    function drawThermal() {
      const { x, y, w, h, cs, tw, th, base } = word;
      F.set(base);
      const ox = ptr.px, oy = ptr.py;
      for (const a of animals) {
        const cx = (a.x + ox - x) / cs, cy = (a.y + oy - y) / cs, r = (a.len * (a.sick ? 0.46 : 0.34)) / cs;
        if (cx < -4 * r || cy < -4 * r || cx > tw + 4 * r || cy > th + 4 * r) continue;
        const amp = a.sick ? 1 + Math.sin(t * 2.2) * 0.04 : 0.36;
        splat(cx + (a.len * 0.16) / cs, cy + (a.len * 0.2) / cs, r * 1.3, -0.05);
        splat(cx, cy, r, amp);
        if (!a.lying) splat(cx + (Math.cos(a.h) * a.len * 0.52) / cs, cy + (Math.sin(a.h) * a.len * 0.52) / cs, r * 0.5, amp * 0.85);
        else splat(cx, cy, r * 1.7, 0.18);
      }
      const d = smallImg.data;
      for (let k = 0, n = tw * th; k < n; k++) {
        const v = (clamp(F[k], 0, 1) * 255) | 0, o = k * 4;
        d[o] = LUT[v * 3]; d[o + 1] = LUT[v * 3 + 1]; d[o + 2] = LUT[v * 3 + 2]; d[o + 3] = 255;
      }
      smallCtx.putImageData(smallImg, 0, 0);
      thermalCtx.globalCompositeOperation = 'copy';
      thermalCtx.imageSmoothingEnabled = true; thermalCtx.imageSmoothingQuality = 'high';
      thermalCtx.drawImage(small, 0, 0, tw, th, 0, 0, tw * cs * DPR, th * cs * DPR);
      thermalCtx.globalCompositeOperation = 'destination-in';
      thermalCtx.drawImage(word.mask, 0, 0);
      ctx.drawImage(thermal, x, y, w, h);
    }

    function brackets(x, y, s, col, alpha) {
      const k = s * 0.42;
      ctx.globalAlpha = alpha; ctx.strokeStyle = col; ctx.lineWidth = 1.25;
      ctx.beginPath();
      ctx.moveTo(x - s, y - s + k); ctx.lineTo(x - s, y - s); ctx.lineTo(x - s + k, y - s);
      ctx.moveTo(x + s - k, y - s); ctx.lineTo(x + s, y - s); ctx.lineTo(x + s, y - s + k);
      ctx.moveTo(x + s, y + s - k); ctx.lineTo(x + s, y + s); ctx.lineTo(x + s - k, y + s);
      ctx.moveTo(x - s + k, y + s); ctx.lineTo(x - s, y + s); ctx.lineTo(x - s, y + s - k);
      ctx.stroke(); ctx.globalAlpha = 1;
    }
    const LCOL = { nominal: '#B6F03C', watch: '#FFB01F', flag: '#FF4B2B' };

    function render() {
      ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
      ctx.drawImage(ground, -gPad + ptr.px, -gPad + ptr.py, W + gPad * 2, H + gPad * 2);
      ctx.save();
      ctx.translate(ptr.px, ptr.py);
      ctx.fillStyle = 'rgba(0,0,0,.3)';
      for (const a of animals) {
        const sx = a.lying ? 0.42 : 0.54, sy = a.lying ? 0.32 : 0.27;
        ellipse(a.x + a.len * 0.16, a.y + a.len * 0.2, a.len * sx, a.len * sy, a.h);
      }
      for (const a of animals) drawAnimal(a);
      // scan line
      if (!reduced()) {
        const sx = scanX();
        const gr = ctx.createLinearGradient(sx - 90, 0, sx, 0);
        gr.addColorStop(0, 'rgba(182,240,60,0)'); gr.addColorStop(1, 'rgba(182,240,60,.06)');
        ctx.fillStyle = gr; ctx.fillRect(sx - 90, H * 0.14, 90, H);
        ctx.fillStyle = 'rgba(182,240,60,.22)'; ctx.fillRect(sx, H * 0.14, 1, H);
        for (const a of animals) {
          const age = t - a.ping;
          if (age < 1.2 && a !== sick && (a.level !== 'nominal' || a.bob < 1.3)) brackets(a.x, a.y, a.len * 0.7, LCOL[a.level], (1 - age / 1.2) * 0.7);
        }
      }
      ctx.restore();
      drawThermal();
      // flagged animal: brackets, rotating ring, leader
      const fx = sick.x + ptr.px, fy = sick.y + ptr.py, s = sick.len * 1.05;
      brackets(fx, fy, s, LCOL.flag, 1);
      ctx.save();
      ctx.translate(fx, fy); ctx.rotate(t * 0.6);
      ctx.strokeStyle = 'rgba(255,75,43,.75)'; ctx.setLineDash([3, 5]); ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(0, 0, s * 1.75, 0, TAU); ctx.stroke();
      ctx.restore();
      const pr = 0.5 + 0.5 * Math.sin(t * 2.4);
      ctx.strokeStyle = `rgba(255,75,43,${0.5 * (1 - pr)})`; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(fx, fy, s * (1.9 + pr * 1.2), 0, TAU); ctx.stroke();
      const lt = place(probeT, sick, fx, fy, s * 1.75);
      leader(fx, fy, s * 1.75, lt, LCOL.flag);
      if (hover && hover !== sick) {
        const hx = hover.x + ptr.px, hy = hover.y + ptr.py, hs = hover.len * 0.85;
        brackets(hx, hy, hs, '#F2F1EC', 1);
        const lh = place(probeH, hover, hx, hy, hs);
        leader(hx, hy, hs, lh, 'rgba(242,241,236,.8)');
      }
    }

    function leader(x, y, s, box, col) {
      if (!box) return;
      const right = box.x > x;
      const sx = x + (right ? s : -s), sy = y;
      const ex = right ? box.x : box.x + box.w, ey = box.y + 14;
      ctx.strokeStyle = col; ctx.lineWidth = 1; ctx.setLineDash([]);
      ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(lerp(sx, ex, 0.5), ey); ctx.lineTo(ex, ey); ctx.stroke();
      ctx.fillStyle = col; ctx.fillRect(sx - 1.5, sy - 1.5, 3, 3);
    }

    function probeHTML(a) {
      const v = a.spark, lo = Math.min(...v) - 4, hi = Math.max(...v) + 4;
      const px = (i) => (i / 13) * 200, py = (val) => 28 - ((val - lo) / (hi - lo)) * 26;
      const pts = v.map((val, i) => `${px(i).toFixed(1)},${py(val).toFixed(1)}`).join(' ');
      const note = a.level === 'flag' ? 'Activity ' + fmtPct(a.delta) + ' vs 14-day baseline'
        : 'Activity ' + fmtPct(a.delta) + ' vs own baseline';
      const col = LCOL[a.level];
      return `<div class="probe-row"><span><b>${a.id}</b> · Cattle</span><em class="lvl" data-level="${a.level}">${a.level}</em></div>`
        + `<div class="probe-row"><span>${esc(note)}</span></div>`
        + `<svg viewBox="0 0 206 30" preserveAspectRatio="none"><rect x="0" y="${py(106).toFixed(1)}" width="200" height="${(py(94) - py(106)).toFixed(1)}" fill="rgba(185,140,255,.18)"/>`
        + `<polyline points="${pts}" fill="none" stroke="rgba(242,241,236,.75)" stroke-width="1"/>`
        + `<circle cx="${px(13)}" cy="${py(v[13]).toFixed(1)}" r="2.6" fill="${col}"/></svg>`;
    }

    function place(el, a, x, y, s) {
      if (el._for !== a) { el.innerHTML = probeHTML(a); el._for = a; el._w = el.offsetWidth; el._h = el.offsetHeight; }
      el.classList.add('on');
      const w = el._w || 230, h = el._h || 80;
      let bx = x + s + 28, by = y - h - s * 0.6;
      if (bx + w > W - 12) bx = x - s - 28 - w;
      if (by < 70) by = y + s + 10;
      bx = clamp(bx, 8, W - w - 8);
      el.style.transform = `translate3d(${bx.toFixed(1)}px, ${by.toFixed(1)}px, 0)`;
      return { x: bx, y: by, w, h };
    }

    /* ---- loop, input, lifecycle ---- */
    function frame(now) {
      raf = 0;
      if (!running) return;
      const dt = Math.min(0.05, (now - last) / 1000 || 0.016);
      last = now;
      ptr.px += (ptr.tx - ptr.px) * Math.min(1, dt * 3);
      ptr.py += (ptr.ty - ptr.py) * Math.min(1, dt * 3);
      step(dt);
      render();
      raf = requestAnimationFrame(frame);
    }
    function start() {
      if (!ready) return;
      if (reduced()) { render(); return; }
      if (running) return;
      running = true; last = performance.now();
      raf = requestAnimationFrame(frame);
    }
    function stop() { running = false; if (raf) cancelAnimationFrame(raf); raf = 0; }

    function pick(x, y) {
      let best = null, bd = Infinity;
      for (const a of animals) {
        const d = Math.hypot(a.x + ptr.px - x, a.y + ptr.py - y);
        if (d < bd) { bd = d; best = a; }
      }
      return bd < Math.max(34, (best ? best.len : 20) * 1.6) ? best : null;
    }
    sec.addEventListener('pointermove', (e) => {
      if (e.pointerType !== 'mouse') return;
      const r = sec.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
      ptr.tx = (x / W - 0.5) * -16; ptr.ty = (y / H - 0.5) * -10;
      hover = pick(x, y);
      if (hover !== lastHover) { lastHover = hover; if (!hover) probeH.classList.remove('on'); if (!running) render(); }
    });
    sec.addEventListener('pointerleave', () => { hover = null; lastHover = null; probeH.classList.remove('on'); ptr.tx = 0; ptr.ty = 0; });
    sec.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse' || e.target.closest('a,button')) return;
      const r = sec.getBoundingClientRect();
      hover = pick(e.clientX - r.left, e.clientY - r.top);
      if (!hover) probeH.classList.remove('on');
      if (!running) render();
    });

    if ('IntersectionObserver' in window) {
      new IntersectionObserver(([e]) => { visible = e.isIntersecting; if (visible && !document.hidden) start(); else stop(); }).observe(sec);
    }
    document.addEventListener('visibilitychange', () => { if (document.hidden) stop(); else if (visible) start(); });

    // scroll: the field sinks and dims as the page moves on
    const tag = $('.hero-tag');
    onScrollFns.push(() => {
      const y = scrollY;
      if (y > H * 1.2) return;
      cv.style.transform = `translate3d(0, ${(y * 0.32).toFixed(1)}px, 0)`;
      tag.style.opacity = String(clamp(1 - y / (H * 0.45), 0, 1));
    });

    let lastSize = '';
    const rebuild = () => {
      const size = `${sec.clientWidth}x${sec.clientHeight}`;
      if (size === lastSize) return;
      const [w0, h0] = lastSize.split('x').map(Number);
      // ignore phone toolbar height jitter
      if (lastSize && w0 === sec.clientWidth && Math.abs(h0 - sec.clientHeight) < 120) return;
      lastSize = size;
      stop(); build(); probeT._for = null; probeH._for = null;
      if (visible) start(); else render();
    };
    let rt = 0;
    addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(rebuild, 180); });

    const go = () => {
      rebuild();
      render();
      sec.classList.add('is-live');
      start();
    };
    const fontReady = document.fonts && document.fonts.load ? document.fonts.load(`700 100px ${FONT}`) : Promise.resolve();
    Promise.race([fontReady, new Promise((r) => setTimeout(r, 2500))]).then(go, go);
    RM.addEventListener && RM.addEventListener('change', () => { stop(); start(); });
  }

  /* ======================================================================
     01 · Dot plot: an illustrative breed spread vs one dog's own record
     ====================================================================== */
  function initDotplot() {
    const svg = $('#dotplot svg');
    if (!svg) return;
    const X0 = 40, STEP = 32;
    const col = (v) => Math.round(v / 8);
    const cx = (c) => X0 + c * STEP;
    const xv = (v) => X0 + (v / 8) * STEP;
    const POP_Y = 252, HER_Y = 386, GAP = 13;
    const small = matchMedia('(max-width: 640px)').matches, LH = small ? 22 : 14;
    // population (illustrative): normal, mean 56 min, sd 22
    for (let c = 0; c <= 20; c++) {
      const v = c * 8, n = Math.round(11 * Math.exp(-((v - 56) ** 2) / (2 * 22 * 22)));
      for (let k = 0; k < n; k++) {
        svgEl('circle', { class: 'dp-pop dp-a', cx: cx(c), cy: POP_Y - k * GAP, r: (4.7 * (1 - 0.5 * (k / 10))).toFixed(2), style: `--d:${(c * 0.03 + k * 0.025).toFixed(3)}s;opacity:.26` }, svg);
      }
    }
    svgEl('line', { class: 'dp-axis', x1: X0 - 12, x2: cx(20) + 12, y1: POP_Y + 12, y2: POP_Y + 12 }, svg);
    // her 13 entries in the 14-day window (HRD-0002 sample record)
    const HER = [110, 95, 120, 92, 68, 94, 105, 100, 115, 98, 108, 96, 104];
    const stack = {};
    HER.forEach((v, i) => {
      const c = col(v), k = (stack[c] = (stack[c] || 0) + 1) - 1;
      svgEl('circle', { class: 'dp-her dp-a', cx: cx(c), cy: HER_Y - k * GAP, r: 4.7, style: `--d:${(1 + i * 0.05).toFixed(2)}s` }, svg);
    });
    svgEl('line', { class: 'dp-axis', x1: X0 - 12, x2: cx(20) + 12, y1: HER_Y + 12, y2: HER_Y + 12 }, svg);
    [0, 40, 80, 120, 160].forEach((v) => {
      svgEl('line', { class: 'dp-axis', x1: xv(v), x2: xv(v), y1: HER_Y + 12, y2: HER_Y + 17 }, svg);
      const tx = svgEl('text', { class: 'dp-tick', x: xv(v), y: HER_Y + 32, 'text-anchor': 'middle' }, svg);
      tx.textContent = v + (v === 160 ? ' min' : '');
    });
    const mean = HER.reduce((a, b) => a + b, 0) / HER.length;
    const late = svgEl('g', { class: 'dp-late' }, svg);
    svgEl('line', { class: 'dp-mean', x1: xv(mean), x2: xv(mean), y1: 300, y2: HER_Y + 12 }, late);
    const ml = svgEl('text', { class: 'dp-lab dp-lab-strong', x: xv(mean) + 8, y: 306 }, late); ml.innerHTML = 'Her <tspan class="lc">μ</tspan> ' + Math.round(mean) + ' min';
    const lab = (x, y, s, cls = 'dp-lab', anchor = 'start') => { const e = svgEl('text', { class: cls, x, y, 'text-anchor': anchor }, svg); e.textContent = s; return e; };
    lab(X0 - 12, 26, 'Illustrative breed spread');
    lab(X0 - 12, 26 + LH, 'Activity, min / day');
    lab(X0 - 12, HER_Y + 58, 'HRD-0002 · her 14-day window, 13 entries');
    // today: 48 min. Typical for the breed, far below her own normal.
    const T = 48, tx = xv(T);
    const pct = Math.round(((T - mean) / mean) * 100);
    svgEl('line', { class: 'dp-guide', x1: tx, x2: tx, y1: HER_Y - 10, y2: 78 }, late);
    const tl = svgEl('text', { class: 'dp-lab dp-lab-strong', x: tx + 10, y: 74 }, late); tl.textContent = 'Today · 48 min';
    const tl2 = svgEl('text', { class: 'dp-lab', x: tx + 10, y: 74 + LH }, late); tl2.textContent = 'Typical for the breed';
    svgEl('circle', { class: 'dp-flag dp-a', cx: tx, cy: HER_Y, r: 5.2, style: '--d:1.8s' }, svg);
    svgEl('circle', { class: 'dp-ring', cx: tx, cy: HER_Y, r: 10 }, late);
    svgEl('circle', { class: 'dp-ring dp-ring-pulse', cx: tx, cy: HER_Y, r: 10 }, late);
    const big = svgEl('text', { class: 'dp-flag dp-big', x: tx + 18, y: HER_Y - (small ? 8 : 4) }, late); big.textContent = fmtPct(pct);
    const big2 = svgEl('text', { class: 'dp-lab', x: tx + 18, y: HER_Y + 9 }, late); big2.textContent = 'for her';
  }

  /* ======================================================================
     03 · Signals: Herd's baseline rules, run live on HRD-0002's record.
     Same thresholds, rounding and wording as assets/js/baseline.js.
     ====================================================================== */
  function initDemo() {
    const root = $('#demo');
    if (!root) return;
    const CONFIG = { flagDrop: 30, watchDrop: 20 };
    const RANK = { nominal: 0, watch: 1, flag: 2 };
    // [daysAgo, energy, activity] — the 13 entries in the 14 days before today
    const HIST = [[14, 5, 110], [13, 4, 95], [12, 5, 120], [11, 4, 92], [10, 3, 68], [9, 4, 94], [8, 5, 105], [7, 4, 100], [6, 5, 115], [5, 4, 98], [4, 5, 108], [3, 4, 96], [2, 5, 104]];
    const summarize = (vals) => {
      const n = vals.length, mean = vals.reduce((a, b) => a + b, 0) / n;
      const sd = Math.sqrt(vals.reduce((a, v) => a + (v - mean) ** 2, 0) / (n - 1));
      return { n, mean, sd };
    };
    const base = { n: HIST.length, energy: summarize(HIST.map((h) => h[1])), activity: summarize(HIST.map((h) => h[2])) };
    const levelForPct = (p) => (p <= -CONFIG.flagDrop ? 'flag' : p <= -CONFIG.watchDrop ? 'watch' : 'nominal');
    function evaluate(e) {
      const notes = [];
      if (e.intake === 'low') notes.push({ level: 'flag', text: 'Intake low' });
      else if (e.intake === 'partial') notes.push({ level: 'watch', text: 'Intake partial' });
      for (const [key, label] of [['activity', 'Activity'], ['energy', 'Energy']]) {
        const mean = base[key].mean;
        const pct = Math.round(((e[key] - mean) / mean) * 100);
        const level = levelForPct(pct);
        if (level !== 'nominal') notes.push({ level, text: `${label} ${fmtPct(pct)} vs 14-day baseline` });
      }
      notes.sort((a, b) => RANK[b.level] - RANK[a.level]);
      return { level: notes.length ? notes[0].level : 'nominal', notes };
    }

    const svg = $('#demo-chart'), act = $('#in-act'), out = $('#out-act');
    const badge = $('#demo-badge'), notesEl = $('#demo-notes'), vs = $('#demo-vs');
    const words = $$('.signals-words span');
    const PX0 = 46, PX1 = 612, PY0 = 18, PY1 = 246, MAX = 160;
    const sx = (i) => PX0 + (i / 13) * (PX1 - PX0);
    const sy = (v) => PY1 - (clamp(v, 0, MAX) / MAX) * (PY1 - PY0);
    const A = base.activity;
    const narrow = matchMedia('(max-width: 640px)').matches;
    // static layer
    [0, 40, 80, 120, 160].forEach((v) => {
      svgEl('line', { class: 'dc-grid', x1: PX0, x2: PX1, y1: sy(v), y2: sy(v) }, svg);
      const tx = svgEl('text', { class: 'dc-tick', x: PX0 - 10, y: sy(v) + 3, 'text-anchor': 'end' }, svg); tx.textContent = v;
    });
    const mt = svgEl('text', { class: 'dc-tick', x: PX0 - 10, y: PY0 - (narrow ? 20 : 6), 'text-anchor': 'end' }, svg); mt.textContent = 'min';
    svgEl('rect', { class: 'dc-band', x: PX0, width: PX1 - PX0, y: sy(A.mean + A.sd), height: sy(A.mean - A.sd) - sy(A.mean + A.sd) }, svg);
    svgEl('line', { class: 'dc-mean', x1: PX0, x2: PX1, y1: sy(A.mean), y2: sy(A.mean) }, svg);
    svgEl('line', { class: 'dc-watch', x1: PX0, x2: PX1, y1: sy(A.mean * 0.8), y2: sy(A.mean * 0.8) }, svg);
    svgEl('line', { class: 'dc-flag', x1: PX0, x2: PX1, y1: sy(A.mean * 0.7), y2: sy(A.mean * 0.7) }, svg);
    const rl = (y, s, fill) => { const e = svgEl('text', { class: 'dc-lab', x: PX1 + 6, y: y + 3, fill }, svg); e.textContent = s; };
    rl(sy(A.mean), 'μ', '#B98CFF'); svg.lastChild.classList.add('lc');
    rl(sy(A.mean * 0.8), MINUS + '20', '#FFB01F');
    rl(sy(A.mean * 0.7), MINUS + '30', '#FF4B2B');
    HIST.forEach((h, i) => {
      if (narrow ? i % 4 === 0 && i < 12 : i % 2 === 0) { const e = svgEl('text', { class: 'dc-tick', x: sx(i), y: PY1 + 22, 'text-anchor': 'middle' }, svg); e.textContent = 'D' + MINUS + h[0]; }
    });
    const tlab = svgEl('text', { class: 'dc-tick', x: sx(13), y: PY1 + 22, 'text-anchor': 'middle', fill: '#F2F1EC' }, svg); tlab.textContent = 'Today';
    svgEl('polyline', { class: 'dc-line', points: HIST.map((h, i) => `${sx(i)},${sy(h[2])}`).join(' ') }, svg);
    HIST.forEach((h, i) => svgEl('circle', { class: 'dc-pt', cx: sx(i), cy: sy(h[2]), r: 3.2 }, svg));
    // live layer
    const live = svgEl('g', {}, svg);
    const conn = svgEl('line', { class: 'dc-today-line', x1: sx(12), y1: sy(HIST[12][2]), x2: sx(13) }, live);
    const halo = svgEl('circle', { class: 'dc-halo', cx: sx(13), r: 17 }, live);
    const dot = svgEl('circle', { class: 'dc-today', cx: sx(13), r: 7 }, live);
    const vl = svgEl('text', { class: 'dc-lab', x: sx(13) - 14, 'text-anchor': 'end' }, live);
    const COL = { nominal: '#B6F03C', watch: '#FFB01F', flag: '#FF4B2B' };

    const state = { activity: 48, energy: 4, intake: 'full' };
    function update() {
      const ev = evaluate(state);
      const y = sy(state.activity), c = COL[ev.level];
      live.setAttribute('color', c);
      [halo, dot].forEach((e) => e.setAttribute('cy', y));
      dot.setAttribute('stroke', c); halo.setAttribute('fill', c);
      conn.setAttribute('y2', y); conn.setAttribute('stroke', c);
      vl.setAttribute('y', y + 4); vl.setAttribute('fill', c);
      const pct = Math.round(((state.activity - A.mean) / A.mean) * 100);
      vl.textContent = `${state.activity} min · ${fmtPct(pct)}`;
      act.value = state.activity;
      act.style.setProperty('--p', (state.activity / MAX) * 100 + '%');
      out.textContent = state.activity + ' min';
      badge.dataset.level = ev.level;
      badge.textContent = ev.level === 'nominal' ? 'Nominal' : ev.level === 'watch' ? 'Watch' : 'Flag';
      notesEl.innerHTML = ev.notes.length
        ? ev.notes.map((n) => `<li data-level="${n.level}">${esc(n.text)}</li>`).join('')
        : '<li class="none" data-level="nominal">Within its own baseline</li>';
      vs.innerHTML = `vs <span class="lc">μ</span> energy ${fmtNum(base.energy.mean, 1)} · activity ${fmtNum(A.mean)} min · <span class="lc">n</span>=${base.n}`;
      words.forEach((w) => w.classList.toggle('on', w.dataset.level === ev.level));
    }

    let intro = null;
    const cancelIntro = () => { if (intro) { cancelAnimationFrame(intro); intro = null; } };
    act.addEventListener('input', () => { cancelIntro(); state.activity = Number(act.value); update(); });
    $$('input[name="energy"]', root).forEach((r) => r.addEventListener('change', () => { cancelIntro(); state.energy = Number(r.value); update(); }));
    $$('input[name="intake"]', root).forEach((r) => r.addEventListener('change', () => { cancelIntro(); state.intake = r.value; update(); }));
    // drag today's point
    let drag = false;
    const fromEvent = (e) => {
      const p = svg.createSVGPoint(); p.x = e.clientX; p.y = e.clientY;
      const q = p.matrixTransform(svg.getScreenCTM().inverse());
      state.activity = Math.round(clamp(((PY1 - q.y) / (PY1 - PY0)) * MAX, 0, MAX));
      update();
    };
    svg.addEventListener('pointerdown', (e) => {
      const p = svg.createSVGPoint(); p.x = e.clientX; p.y = e.clientY;
      const q = p.matrixTransform(svg.getScreenCTM().inverse());
      if (q.x < sx(12) + 10) return;
      if (e.pointerType === 'touch' && e.target !== halo && e.target !== dot) return;
      cancelIntro(); drag = true; svg.setPointerCapture(e.pointerId); fromEvent(e);
    });
    svg.addEventListener('pointermove', (e) => { if (drag) fromEvent(e); });
    svg.addEventListener('pointerup', () => { drag = false; });
    svg.addEventListener('pointercancel', () => { drag = false; });

    if (reduced() || !('IntersectionObserver' in window)) { update(); return; }
    // intro: a normal day slides into a flagged one
    state.activity = 104; update();
    const io = new IntersectionObserver(([e]) => {
      if (!e.isIntersecting) return;
      io.disconnect();
      const t0 = performance.now() + 500, from = 104, to = 48, dur = 2800;
      const tick = (now) => {
        const p = clamp((now - t0) / dur, 0, 1), k = p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2;
        state.activity = Math.round(lerp(from, to, k)); update();
        intro = p < 1 ? requestAnimationFrame(tick) : null;
      };
      intro = requestAnimationFrame(tick);
    }, { threshold: 0.45 });
    io.observe(root);
  }

  /* ======================================================================
     04 · Environment: a live thermal field behind the section
     ====================================================================== */
  function initEnvField() {
    const sec = $('.sec-env'), cv = $('.env-canvas');
    if (!sec || !cv) return;
    const ctx = cv.getContext('2d');
    const noise = makeNoise(77);
    let w = 0, h = 0, img = null, running = false, raf = 0, t = 0, last = 0;
    const r = rng(5);
    const blobs = Array.from({ length: 9 }, () => ({ x: r(), y: 0.2 + r() * 0.75, rx: 0.05 + r() * 0.06, a: 0.24 + r() * 0.16, f: 0.15 + r() * 0.3, p: r() * TAU, ax: 0.03 + r() * 0.05 }));
    function size() {
      const ar = sec.clientWidth / Math.max(1, sec.clientHeight);
      w = 140; h = clamp(Math.round(w / ar), 60, 420);
      cv.width = w; cv.height = h;
      img = ctx.createImageData(w, h);
    }
    function draw() {
      const d = img.data, k = 1 / w;
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const u = x * k, v = y * k;
          let f = 0.34 + 0.22 * noise(u * 4 + t * 0.05, v * 4 - t * 0.04, 3) + 0.12 * (y / h);
          for (const b of blobs) {
            const bx = b.x + Math.sin(t * b.f + b.p) * b.ax, by = b.y * (h * k) + Math.cos(t * b.f * 0.8 + b.p) * b.ax * 0.6;
            const dx = (u - bx) / b.rx, dy = (v - by) / (b.rx * 0.62);
            const q = dx * dx + dy * dy;
            if (q < 9) f += b.a * (1 + 0.08 * Math.sin(t * 1.6 + b.p)) * Math.exp(-q * 0.9);
          }
          const val = (clamp(f, 0, 1) * 255) | 0, o = (y * w + x) * 4;
          d[o] = LUT[val * 3]; d[o + 1] = LUT[val * 3 + 1]; d[o + 2] = LUT[val * 3 + 2]; d[o + 3] = 255;
        }
      }
      ctx.putImageData(img, 0, 0);
    }
    function frame(now) {
      raf = 0;
      if (!running) return;
      const dt = Math.min(0.1, (now - last) / 1000 || 0.03);
      if (dt >= 1 / 30) { last = now; t += dt; draw(); }
      raf = requestAnimationFrame(frame);
    }
    const start = () => { if (reduced()) { draw(); return; } if (!running) { running = true; last = performance.now(); raf = requestAnimationFrame(frame); } };
    const stop = () => { running = false; if (raf) cancelAnimationFrame(raf); raf = 0; };
    size(); draw();
    addEventListener('resize', () => { size(); draw(); });
    if ('IntersectionObserver' in window) new IntersectionObserver(([e]) => (e.isIntersecting ? start() : stop()), { rootMargin: '100px' }).observe(sec);
  }

  /* ======================================================================
     04 · Instruments: shared-space resolver and THI
     ====================================================================== */
  const PRESETS = {
    cattle: { label: 'Cattle', min: -5, max: 25 }, horse: { label: 'Horse', min: 5, max: 25 },
    sheep: { label: 'Sheep', min: 5, max: 25 }, goat: { label: 'Goat', min: 10, max: 27 },
    pig: { label: 'Pig', min: 16, max: 22 }, chicken: { label: 'Chicken', min: 16, max: 27 },
    dog: { label: 'Dog', min: 18, max: 29 }, cat: { label: 'Cat', min: 18, max: 29 },
    rabbit: { label: 'Rabbit', min: 16, max: 22 }, chick: { label: 'Chicks, week 1', min: 32, max: 35, plural: true },
  };
  const deg = (v) => fmtNum(v) + ' °C';
  const range = (a, b) => `${fmtNum(a)}–${b} °C`;

  function initResolver() {
    const root = $('#resolver');
    if (!root) return;
    const inputs = $$('input', root), svg = $('#res-chart'), out = $('#res-out');
    const title = svg.querySelector('title');
    let X0 = 96;
    const X1 = 540, T0 = -10, T1 = 40;
    const x = (t) => X0 + ((t - T0) / (T1 - T0)) * (X1 - X0);
    const narrow = matchMedia('(max-width: 640px)');
    const names = (list) => {
      const n = list.map((p) => p.label);
      return n.length < 3 ? n.join(' and ') : n.slice(0, -1).join(', ') + ' and ' + n[n.length - 1];
    };
    function draw() {
      const sel = inputs.filter((i) => i.checked).map((i) => PRESETS[i.value]);
      X0 = narrow.matches ? 176 : 96;
      while (svg.firstChild) svg.removeChild(svg.firstChild);
      if (title) svg.appendChild(title);
      svg.insertAdjacentHTML('beforeend', '<defs><pattern id="hatch-flag" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="6" height="6" fill="rgba(255,75,43,.12)"/><line x1="0" y1="0" x2="0" y2="6" stroke="#FF4B2B" stroke-width="1.2"/></pattern></defs>');
      const n = Math.max(1, inputs.filter((i) => i.checked).length);
      const AX = 14 + n * 26 + 30;
      svg.setAttribute('viewBox', `0 0 560 ${AX + 26}`);
      for (let t = T0; t <= T1; t += 10) {
        svgEl('line', { class: 'rc-grid', x1: x(t), x2: x(t), y1: 6, y2: AX }, svg);
        const e = svgEl('text', { class: 'rc-tick', x: x(t), y: AX + 16, 'text-anchor': 'middle' }, svg); e.textContent = fmtNum(t) + (t === T1 ? ' °C' : '');
      }
      svgEl('line', { class: 'rc-axis', x1: X0, x2: X1, y1: AX, y2: AX }, svg);
      if (!sel.length) { out.innerHTML = 'Pick at least one resident.'; return; }
      const hi = Math.max(...sel.map((p) => p.min)), lo = Math.min(...sel.map((p) => p.max));
      const top = 14, rowH = 26;
      const ok = hi <= lo;
      const bandTop = top - 4, bandH = sel.length * rowH + 4;
      if (ok) svgEl('rect', { class: 'rc-ok', x: x(hi), width: Math.max(1, x(lo) - x(hi)), y: bandTop, height: bandH }, svg);
      else svgEl('rect', { class: 'rc-bad', x: x(lo), width: x(hi) - x(lo), y: bandTop, height: bandH }, svg);
      sel.forEach((p, i) => {
        const y = top + i * rowH, bh = Math.max(4, Math.min(8, rowH * 0.36));
        const bind = p.min === hi || p.max === lo;
        svgEl('rect', { class: bind ? 'rc-bar rc-bar-bind' : 'rc-bar', x: x(p.min), width: x(p.max) - x(p.min), y: y + rowH / 2 - bh / 2, height: bh }, svg);
        const n = svgEl('text', { class: 'rc-name', x: X0 - 12, y: y + rowH / 2 + 3, 'text-anchor': 'end' }, svg); n.textContent = p.label;
      });
      const minBy = sel.filter((p) => p.min === hi), maxBy = sel.filter((p) => p.max === lo);
      if (ok) {
        const l = svgEl('text', { class: 'rc-ok-lab', x: (x(hi) + x(lo)) / 2, y: bandTop + bandH + 14, 'text-anchor': 'middle' }, svg);
        l.textContent = range(hi, lo);
        out.innerHTML = sel.length === 1
          ? `Allowed <b>${range(hi, lo)}</b>, straight from the ${esc(sel[0].label)} preset.`
          : `Allowed <b>${range(hi, lo)}</b>. The minimum is set by ${esc(names(minBy))}, the maximum by ${esc(names(maxBy))}.`;
      } else {
        const verb = (list, s, p) => (list.length > 1 || list[0].plural ? p : s);
        out.innerHTML = `<b class="bad">Conflict.</b> ${esc(names(minBy))} ${verb(minBy, 'needs', 'need')} at least ${deg(hi)}; ${esc(names(maxBy))} ${verb(maxBy, 'tolerates', 'tolerate')} at most ${deg(lo)}. No range works, so Herd says so instead of guessing.`;
      }
    }
    inputs.forEach((i) => i.addEventListener('change', draw));
    narrow.addEventListener && narrow.addEventListener('change', draw);
    draw();
  }

  function initTHI() {
    const tIn = $('#in-t'), rhIn = $('#in-rh');
    if (!tIn) return;
    const num = $('#thi-num'), badge = $('#thi-badge'), f = $('#thi-f'), needle = $('#thi-needle');
    const outT = $('#out-t'), outRH = $('#out-rh');
    const thi = (tC, rh) => { const tF = (tC * 9) / 5 + 32; return Math.round((tF - (0.55 - 0.0055 * rh) * (tF - 58)) * 10) / 10; };
    function update() {
      const t = Number(tIn.value), rh = Number(rhIn.value), v = thi(t, rh);
      const lvl = v >= 72 ? 'flag' : v >= 68 ? 'watch' : 'nominal';
      num.textContent = fmtNum(v, 1);
      badge.dataset.level = lvl; badge.textContent = lvl === 'flag' ? 'Flag' : lvl === 'watch' ? 'Watch' : 'Nominal';
      f.textContent = `${fmtNum((t * 9) / 5 + 32, 1)} °F · ${rh} % RH`;
      needle.style.setProperty('--x', clamp((v - 50) / 40, 0, 1) * 100 + '%');
      outT.textContent = fmtNum(t, 1) + ' °C'; outRH.textContent = rh + ' %';
      tIn.style.setProperty('--p', (t / 40) * 100 + '%'); rhIn.style.setProperty('--p', rh + '%');
    }
    tIn.addEventListener('input', update); rhIn.addEventListener('input', update);
    update();
  }

  /* ======================================================================
     05 · Species index: expand rows, a heat-filled silhouette follows the cursor
     ====================================================================== */
  function initSpecies() {
    const sp = $('#sp');
    if (!sp) return;
    const items = $$('.sp-item', sp);
    const toggle = (item, open) => {
      const o = open == null ? !item.classList.contains('open') : open;
      item.classList.toggle('open', o);
      $('.sp-row', item).setAttribute('aria-expanded', String(o));
    };
    items.forEach((it) => $('.sp-row', it).addEventListener('click', () => toggle(it)));
    const fromHash = () => { const t = location.hash && document.getElementById(location.hash.slice(1)); if (t && t.classList.contains('sp-item')) toggle(t, true); };
    addEventListener('hashchange', fromHash); fromHash();

    const ghost = $('#sp-ghost'), use = $('use', ghost);
    if (!matchMedia('(hover: hover) and (pointer: fine)').matches || reduced()) return;
    let gx = 0, gy = 0, tx = 0, ty = 0, raf = 0, cur = '';
    const loop = () => {
      gx += (tx - gx) * 0.18; gy += (ty - gy) * 0.18;
      ghost.style.left = gx + 'px'; ghost.style.top = gy + 'px';
      raf = Math.abs(tx - gx) + Math.abs(ty - gy) > 0.5 ? requestAnimationFrame(loop) : 0;
    };
    sp.addEventListener('pointermove', (e) => {
      const item = e.target.closest('.sp-item');
      if (!item || e.target.closest('.sp-detail')) { ghost.classList.remove('on'); return; }
      const k = item.dataset.sp;
      if (k !== cur) { cur = k; use.setAttribute('href', '#sp-' + k); }
      tx = e.clientX + 190; ty = e.clientY - 40;
      if (!ghost.classList.contains('on')) { gx = tx; gy = ty; ghost.classList.add('on'); }
      if (!raf) raf = requestAnimationFrame(loop);
    });
    sp.addEventListener('pointerleave', () => ghost.classList.remove('on'));
    addEventListener('scroll', () => ghost.classList.remove('on'), { passive: true });
  }

  /* ======================================================================
     07 · Principles: pinned horizontal scroll on wide screens
     ====================================================================== */
  function initPrinciples() {
    const sec = $('#principles'), track = $('#pr-track'), bar = $('#pr-bar');
    if (!sec) return;
    const mq = matchMedia('(min-width: 900px)');
    let dist = 0;
    function layout() {
      if (!mq.matches || reduced()) {
        sec.classList.remove('is-pinned'); sec.style.height = ''; track.style.transform = '';
        return;
      }
      sec.classList.add('is-pinned');
      dist = Math.max(0, track.scrollWidth - track.clientWidth);
      sec.style.height = (innerHeight + dist) + 'px';
      move();
    }
    function move() {
      if (sec.classList.contains('is-pinned')) {
        const p = clamp(-sec.getBoundingClientRect().top / (dist || 1), 0, 1);
        track.style.transform = `translate3d(${(-p * dist).toFixed(1)}px,0,0)`;
        bar.style.setProperty('--p', p);
      }
    }
    track.addEventListener('scroll', () => {
      if (!sec.classList.contains('is-pinned')) bar.style.setProperty('--p', track.scrollLeft / Math.max(1, track.scrollWidth - track.clientWidth));
    }, { passive: true });
    onScrollFns.push(move);
    addEventListener('resize', layout);
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(layout);
    layout();
  }

  /* ======================================================================
     08 · Field log thumbnails, drawn rather than photographed
     ====================================================================== */
  function initLog() {
    const r = rng(3);
    const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
    const kinds = {
      release() {
        let s = '<rect width="320" height="200" fill="#0D1712"/>';
        for (let y = 0; y < 9; y++) for (let x = 0; x < 15; x++) {
          const cx = 20 + x * 20 + (y % 2) * 10, cy = 20 + y * 20;
          const ring = x === 9 && y === 4;
          const rad = 2 + 3.2 * Math.max(0, 1 - Math.hypot(cx - 200, cy - 100) / 170);
          s += ring ? `<circle cx="${cx}" cy="${cy}" r="7" fill="none" stroke="#B6F03C" stroke-width="1.6"/><circle cx="${cx}" cy="${cy}" r="15" fill="none" stroke="#B6F03C" stroke-opacity=".3"/>`
            : `<circle cx="${cx}" cy="${cy}" r="${rad.toFixed(2)}" fill="#F2F1EC" fill-opacity=".8"/>`;
        }
        return s;
      },
      lock() {
        let s = '<rect width="320" height="200" fill="#09100C"/>';
        for (let y = 0; y < 15; y++) {
          let line = ''; for (let i = 0; i < 46; i++) line += B64[(r() * 64) | 0];
          const hl = y === 7;
          s += `<text x="10" y="${16 + y * 13}" font-family="Martian Mono, monospace" font-size="9.5" letter-spacing="-.3" fill="${hl ? '#B6F03C' : 'rgba(242,241,236,.28)'}">${line}</text>`;
        }
        s += '<rect x="138" y="76" width="44" height="48" fill="#09100C"/><g transform="translate(145 84) scale(2.5)" fill="#F2F1EC"><rect x="1" y="6" width="10" height="7.5" rx="1"/><path d="M3.2 6V4.2a2.8 2.8 0 0 1 5.6 0V6" fill="none" stroke="#F2F1EC" stroke-width="1.4"/></g>';
        return s;
      },
      env() {
        return '<defs><radialGradient id="th1"><stop offset="0" stop-color="#FFF6C8"/><stop offset=".25" stop-color="#FFC93C"/><stop offset=".5" stop-color="#FF7A1A"/><stop offset=".75" stop-color="#C21C6F" stop-opacity=".7"/><stop offset="1" stop-color="#4B0F6B" stop-opacity="0"/></radialGradient></defs>'
          + '<rect width="320" height="200" fill="#2A0B4E"/><rect width="320" height="200" fill="#6C1380" opacity=".45"/>'
          + [[70, 70, 46], [170, 120, 60], [250, 60, 40], [120, 160, 34], [280, 150, 30]].map(([x, y, rr]) => `<ellipse cx="${x}" cy="${y}" rx="${rr * 1.3}" ry="${rr}" fill="url(#th1)"/>`).join('')
          + Array.from({ length: 66 }, (_, i) => `<rect y="${i * 3}" width="320" height="1" fill="#000" opacity=".12"/>`).join('');
      },
      sensors() {
        let s = '<rect width="320" height="200" fill="#0D1712"/>';
        for (let i = 1; i < 8; i++) s += `<line x1="${i * 40}" x2="${i * 40}" y1="0" y2="200" stroke="rgba(242,241,236,.06)"/>`;
        const wave = (amp, off, ph, col, w) => {
          let d = '';
          for (let x = 0; x <= 320; x += 4) { const y = off + Math.sin((x / 320) * TAU * 1.5 + ph) * amp + Math.sin(x * 0.21) * 1.2; d += (x ? 'L' : 'M') + x + ' ' + y.toFixed(1); }
          return `<path d="${d}" fill="none" stroke="${col}" stroke-width="${w}"/>`;
        };
        s += wave(34, 80, 0, '#B6F03C', 1.6) + wave(22, 130, 1.4, '#FFB01F', 1.2) + wave(12, 160, 2.2, 'rgba(242,241,236,.5)', 1);
        s += '<text x="12" y="22" font-family="Martian Mono, monospace" font-size="9" fill="rgba(242,241,236,.5)">0x181A · 5 MIN BUCKETS</text>';
        return s;
      },
      species() {
        return '<defs><linearGradient id="pk" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#FFD9B8"/><stop offset="1" stop-color="#FF9AB8"/></linearGradient></defs><rect width="320" height="200" fill="url(#pk)"/>'
          + '<svg x="22" y="64" width="120" height="84" viewBox="0 0 100 70"><use href="#sp-pig" width="100" height="70"/></svg>'
          + '<svg x="150" y="46" width="84" height="104" viewBox="0 0 100 124"><use href="#sp-chicken" width="100" height="124"/></svg>'
          + '<svg x="226" y="82" width="82" height="66" viewBox="0 0 100 80"><use href="#sp-rabbit" width="100" height="80"/></svg>'
          + '<line x1="0" x2="320" y1="150" y2="150" stroke="#0C0D0C" stroke-opacity=".35"/>';
      },
      baseline() {
        let s = '<rect width="320" height="200" fill="#0D1712"/><rect x="0" y="62" width="320" height="38" fill="rgba(185,140,255,.18)"/><line x1="0" x2="320" y1="81" y2="81" stroke="#B98CFF" stroke-dasharray="5 4"/><line x1="0" x2="320" y1="126" y2="126" stroke="#FF4B2B" stroke-dasharray="1 3"/>';
        const v = [74, 86, 70, 90, 104, 88, 78, 82, 72, 84, 76, 86, 78, 146];
        s += `<polyline points="${v.map((y, i) => `${14 + i * 22},${y}`).join(' ')}" fill="none" stroke="rgba(242,241,236,.7)"/>`;
        v.forEach((y, i) => { s += i === 13 ? `<circle cx="${14 + i * 22}" cy="${y}" r="6" fill="#0D1712" stroke="#FF4B2B" stroke-width="2"/>` : `<circle cx="${14 + i * 22}" cy="${y}" r="2.6" fill="#0D1712" stroke="#F2F1EC"/>`; });
        return s;
      },
    };
    $$('.log-thumb').forEach((el) => {
      const f = kinds[el.dataset.kind];
      if (f) el.innerHTML = `<svg viewBox="0 0 320 200" preserveAspectRatio="xMidYMid slice" fill="#0C0D0C">${f()}</svg>`;
    });
  }

  /* ======================================================================
     09 · Closing lines drift against each other as you scroll
     ====================================================================== */
  function initClose() {
    const sec = $('#close');
    if (!sec || reduced()) return;
    const lines = $$('[data-drift]', sec);
    onScrollFns.push(() => {
      const r = sec.getBoundingClientRect();
      if (r.bottom < 0 || r.top > innerHeight) return;
      const p = clamp(1 - (r.top + r.height * 0.3) / innerHeight, -1, 1.5);
      lines.forEach((l) => { l.style.transform = `translate3d(${clamp(Number(l.dataset.drift) * (p - 0.6) * 4, -3, 3).toFixed(2)}vw,0,0)`; });
    });
  }

  initNav();
  initIndex();
  initReveal();
  initHero();
  initDotplot();
  initDemo();
  initEnvField();
  initResolver();
  initTHI();
  initSpecies();
  initPrinciples();
  initLog();
  initClose();
})();
