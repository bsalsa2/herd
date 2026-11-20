/* Herd · SVG charts
   Hand-rolled, dependency-free. Charts render at the container's real pixel
   width (not a stretched viewBox) so 1px lines stay 1px, and redraw on resize. */
(function (H) {
  'use strict';

  const U = H.util;
  const DAY = U.DAY_MS;

  const f1 = (n) => (Math.round(n * 10) / 10).toString();
  const crisp = (n) => Math.round(n) + 0.5;
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

  /* "Nice" axis for a 0-based metric: 0, step, 2·step … >= max, ~3 intervals. */
  function niceTicks(max, intervals) {
    const count = intervals || 3;
    const top = Math.max(max, 1);
    const raw = top / count;
    const mag = Math.pow(10, Math.floor(Math.log10(raw)));
    const r = raw / mag;
    const step = (r <= 1 ? 1 : r <= 2 ? 2 : r <= 2.5 ? 2.5 : r <= 5 ? 5 : 10) * mag;
    const ticks = [];
    for (let v = 0; v <= top + step * 0.999; v += step) ticks.push(Math.round(v * 100) / 100);
    if (ticks[ticks.length - 1] < top) ticks.push(ticks[ticks.length - 1] + step);
    return ticks;
  }

  /* Sparkline: index-spaced, fixed domain, a dotted baseline-mean hairline,
     and the latest point marked in the subject's status color. */
  function sparkline(values, opts) {
    const o = opts || {};
    const w = o.width || 96;
    const h = o.height || 24;
    const pad = 3;
    const lo = o.domain ? o.domain[0] : 1;
    const hi = o.domain ? o.domain[1] : 5;
    const label = U.esc(o.label || 'Trend');

    if (!values.length) {
      return `<svg class="spark" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img" aria-label="${label}: no data"><line class="spark-empty" x1="0" x2="${w}" y1="${h / 2}" y2="${h / 2}"/></svg>`;
    }

    const n = values.length;
    const x = (i) => (n === 1 ? w - pad : pad + (i * (w - pad * 2)) / (n - 1));
    const y = (v) => h - pad - ((clamp(v, lo, hi) - lo) / (hi - lo)) * (h - pad * 2);
    const d = values.map((v, i) => `${i ? 'L' : 'M'}${f1(x(i))} ${f1(y(v))}`).join('');
    const mean = o.mean != null ? `<line class="spark-mean" x1="0" x2="${w}" y1="${f1(y(o.mean))}" y2="${f1(y(o.mean))}"/>` : '';
    const level = o.level === 'flag' || o.level === 'watch' ? o.level : '';

    return `<svg class="spark" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img" aria-label="${label}">`
      + `${mean}<path class="spark-line" d="${d}"/>`
      + `<circle class="spark-dot ${level}" cx="${f1(x(n - 1))}" cy="${f1(y(values[n - 1]))}" r="2.25"/></svg>`;
  }

  /* ---------- Line chart ------------------------------------------------- */

  const observed = new Set();
  const ro = typeof ResizeObserver !== 'undefined'
    ? new ResizeObserver((items) => {
      for (const it of items) {
        const el = it.target;
        const w = Math.floor(it.contentRect.width);
        if (w > 0 && w !== el.__herdW) { el.__herdW = w; draw(el); }
      }
    })
    : null;

  /* cfg: {
       points: [{ date, value, level, delta }],   sorted by date
       start, end: ISO dates for the x-range
       domain: [min, max], ticks: [..]
       band: { mean, lo, hi, threshold } | null
       unit, label, format(v)
     } */
  function mount(el, cfg) {
    el.__herdCfg = cfg;
    el.__herdW = Math.floor(el.clientWidth);
    draw(el);
    if (ro && !observed.has(el)) { ro.observe(el); observed.add(el); }
  }

  function reset() {
    if (ro) ro.disconnect();
    observed.clear();
  }

  function draw(el) {
    const cfg = el.__herdCfg;
    if (!cfg) return;

    const W = Math.max(220, Math.floor(el.clientWidth));
    const Hh = Math.max(120, Math.floor(el.clientHeight) || 188);
    const m = { t: 12, r: 38, b: 24, l: 32 };
    const iw = W - m.l - m.r;
    const ih = Hh - m.t - m.b;

    let t0 = U.parseISO(cfg.start);
    const t1 = U.parseISO(cfg.end);
    if (t1 - t0 < DAY) t0 = t1 - DAY;

    const X = (iso) => m.l + ((U.parseISO(iso) - t0) / (t1 - t0)) * iw;
    const [d0, d1] = cfg.domain;
    const Y = (v) => m.t + ih - ((clamp(v, d0, d1) - d0) / (d1 - d0)) * ih;
    const fmt = cfg.format || ((v) => String(v));
    const pts = cfg.points.filter((p) => p.date >= U.toISO(t0) && p.date <= cfg.end);
    const out = [];

    // Gridlines and y labels
    out.push('<g class="ch-grid">');
    cfg.ticks.forEach((v) => {
      const y = crisp(Y(v));
      out.push(`<line x1="${m.l}" x2="${m.l + iw}" y1="${y}" y2="${y}"/>`);
    });
    out.push('</g><g class="ch-axis">');
    cfg.ticks.forEach((v) => out.push(`<text x="${m.l - 8}" y="${f1(Y(v) + 3.5)}" text-anchor="end">${fmt(v)}</text>`));

    // X labels: evenly spaced whole days
    const spanDays = Math.round((t1 - t0) / DAY);
    const nTicks = Math.min(spanDays + 1, iw < 300 ? 3 : iw < 520 ? 4 : 5);
    const seen = new Set();
    for (let k = 0; k < nTicks; k++) {
      const day = Math.round((k * spanDays) / Math.max(1, nTicks - 1));
      const iso = U.toISO(t0 + day * DAY);
      if (seen.has(iso)) continue;
      seen.add(iso);
      const anchor = k === 0 ? 'start' : k === nTicks - 1 ? 'end' : 'middle';
      out.push(`<text x="${f1(X(iso))}" y="${Hh - 6}" text-anchor="${anchor}">${U.fmtDate(iso)}</text>`);
    }
    out.push('</g>');

    // Baseline band (mean ± 1 SD), mean line, flag threshold
    if (cfg.band) {
      const b = cfg.band;
      const yHi = Y(Math.min(b.hi, d1));
      const yLo = Y(Math.max(b.lo, d0));
      out.push(`<rect class="ch-band" x="${m.l}" y="${f1(yHi)}" width="${iw}" height="${f1(Math.max(1, yLo - yHi))}"/>`);
      const ym = crisp(Y(b.mean));
      out.push(`<line class="ch-mean" x1="${m.l}" x2="${m.l + iw}" y1="${ym}" y2="${ym}"/>`);
      out.push(`<text class="ch-mean-label" x="${m.l + iw + 6}" y="${f1(ym + 3)}">μ</text>`);
      if (b.threshold >= d0 && b.threshold <= d1) {
        const yt = crisp(Y(b.threshold));
        out.push(`<line class="ch-thr" x1="${m.l}" x2="${m.l + iw}" y1="${yt}" y2="${yt}"/>`);
        out.push(`<text class="ch-thr-label" x="${m.l + iw + 6}" y="${f1(yt + 3)}">${U.MINUS}30%</text>`);
      }
    }

    // Series: break the line across gaps longer than 2 days
    const px = pts.map((p) => Object.assign({}, p, { x: X(p.date), y: Y(p.value) }));
    if (px.length) {
      let d = '';
      px.forEach((p, i) => {
        const gap = i ? U.daysBetween(px[i - 1].date, p.date) : 0;
        d += `${!i || gap > 2 ? 'M' : 'L'}${f1(p.x)} ${f1(p.y)}`;
      });
      out.push(`<path class="ch-line" d="${d}"/>`);
      const dense = px.length > 60;
      px.forEach((p) => {
        const off = p.level === 'flag' || p.level === 'watch';
        if (dense && !off) return;
        out.push(`<circle class="ch-pt ${off ? p.level : ''}" cx="${f1(p.x)}" cy="${f1(p.y)}" r="${off ? 3 : 2.25}"/>`);
      });
    } else {
      out.push(`<text class="ch-empty" x="${m.l + iw / 2}" y="${m.t + ih / 2}" text-anchor="middle">No entries in range</text>`);
    }

    out.push(`<line class="ch-cross" x1="0" x2="0" y1="${m.t}" y2="${m.t + ih}"/>`);
    out.push('<circle class="ch-focus" cx="0" cy="0" r="5"/>');

    const meanTxt = cfg.band ? ` Baseline mean ${fmt(Math.round(cfg.band.mean * 10) / 10)}${cfg.unit ? ' ' + cfg.unit : ''}.` : '';
    const aria = `${cfg.label}: ${pts.length} entries, ${U.fmtDate(U.toISO(t0))} to ${U.fmtDate(cfg.end)}.${meanTxt} Use arrow keys to read values.`;

    el.innerHTML = `<svg width="${W}" height="${Hh}" viewBox="0 0 ${W} ${Hh}" role="img" aria-label="${U.esc(aria)}">${out.join('')}</svg><div class="tt" aria-hidden="true"></div>`;
    bind(el, px, { W, m, ih, cfg, fmt });
  }

  /* Crosshair + tooltip: pointer, touch (tap), and keyboard (arrow keys). */
  function bind(el, px, ctx) {
    const svg = el.firstElementChild;
    const tt = el.lastElementChild;
    const cross = svg.querySelector('.ch-cross');
    const focus = svg.querySelector('.ch-focus');
    let idx = -1;

    function show(i) {
      if (i < 0 || i >= px.length) return hide();
      idx = i;
      const p = px[i];
      const x = crisp(p.x);
      cross.setAttribute('x1', x);
      cross.setAttribute('x2', x);
      cross.style.opacity = '1';
      focus.setAttribute('cx', f1(p.x));
      focus.setAttribute('cy', f1(p.y));
      focus.style.opacity = '1';
      const unit = ctx.cfg.unit ? ` ${ctx.cfg.unit}` : '';
      const delta = p.delta != null ? ` <b class="${p.level || ''}">${U.fmtPct(p.delta)}</b>` : '';
      tt.innerHTML = `<span class="tt-d">${U.fmtWeekday(p.date)} ${U.fmtDate(p.date)}</span>${U.esc(ctx.fmt(p.value))}${unit}${delta}`;
      tt.style.left = `${clamp(p.x, 56, ctx.W - 56)}px`;
      tt.style.top = `${p.y}px`;
      tt.classList.toggle('below', p.y < 56);
      tt.classList.add('on');
    }

    function hide() {
      idx = -1;
      cross.style.opacity = '0';
      focus.style.opacity = '0';
      tt.classList.remove('on');
    }

    function nearest(clientX) {
      if (!px.length) return -1;
      const x = clientX - svg.getBoundingClientRect().left;
      let best = 0;
      let bd = Infinity;
      for (let i = 0; i < px.length; i++) {
        const d = Math.abs(px[i].x - x);
        if (d < bd) { bd = d; best = i; }
      }
      return best;
    }

    el.onpointermove = (e) => show(nearest(e.clientX));
    el.onpointerdown = (e) => show(nearest(e.clientX));
    el.onpointerleave = (e) => { if (e.pointerType !== 'touch') hide(); };
    el.onblur = hide;
    el.onkeydown = (e) => {
      if (!px.length) return;
      if (e.key === 'ArrowRight') { show(idx < 0 ? px.length - 1 : Math.min(px.length - 1, idx + 1)); e.preventDefault(); }
      else if (e.key === 'ArrowLeft') { show(idx < 0 ? px.length - 1 : Math.max(0, idx - 1)); e.preventDefault(); }
      else if (e.key === 'Home') { show(0); e.preventDefault(); }
      else if (e.key === 'End') { show(px.length - 1); e.preventDefault(); }
      else if (e.key === 'Escape') hide();
    };
  }

  H.charts = { sparkline, mount, reset, niceTicks };
})(window.Herd = window.Herd || {});
