/* Herd · SVG charts
   Hand-rolled, dependency-free. Charts render at the container's real pixel
   width (not a stretched viewBox) so 1px lines stay 1px, and redraw on resize.
   The x-axis is plain milliseconds, so the same engine draws daily records
   and 24-hour sensor series. */
(function (H) {
  'use strict';

  const U = H.util;
  const DAY = U.DAY_MS;
  const HOUR = 3600000;

  const f1 = (n) => (Math.round(n * 10) / 10).toString();
  const crisp = (n) => Math.round(n) + 0.5;
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

  /* Nice ticks for any [lo, hi]: ~`intervals` steps on 1/2/2.5/5 × 10^n. */
  function niceScale(lo, hi, intervals) {
    const count = intervals || 3;
    let a = lo;
    let b = hi;
    if (!(b > a)) { a -= 1; b += 1; }
    const raw = (b - a) / count;
    const mag = Math.pow(10, Math.floor(Math.log10(raw)));
    const r = raw / mag;
    const step = (r <= 1 ? 1 : r <= 2 ? 2 : r <= 2.5 ? 2.5 : r <= 5 ? 5 : 10) * mag;
    const start = Math.floor(a / step) * step;
    const end = Math.ceil(b / step) * step;
    const ticks = [];
    for (let v = start; v <= end + step * 0.001; v += step) ticks.push(Math.round(v * 1000) / 1000);
    return { ticks, domain: [ticks[0], ticks[ticks.length - 1]] };
  }

  /* 0-based variant used by activity minutes. */
  function niceTicks(max, intervals) {
    return niceScale(0, Math.max(max, 1), intervals).ticks;
  }

  /* x-tick helpers ---------------------------------------------------------- */

  function dayTicks(t0, t1, iw) {
    const spanDays = Math.round((t1 - t0) / DAY);
    const n = Math.min(spanDays + 1, iw < 300 ? 3 : iw < 520 ? 4 : 5);
    const out = [];
    for (let k = 0; k < n; k++) {
      const t = t0 + Math.round((k * spanDays) / Math.max(1, n - 1)) * DAY;
      if (!out.includes(t)) out.push(t);
    }
    return out;
  }

  function hourTicks(t0, t1, iw) {
    const span = (t1 - t0) / HOUR;
    const step = span <= 12 ? 3 : iw < 300 ? 12 : 6;
    const d = new Date(t0);
    d.setMinutes(0, 0, 0);
    const out = [];
    for (let t = d.getTime(); t <= t1; t += HOUR) {
      if (t >= t0 && new Date(t).getHours() % step === 0) out.push(t);
    }
    return out;
  }

  const dayLabel = (t) => U.fmtDate(U.toISO(t));
  function hourLabel(t) {
    const d = new Date(t);
    if (d.getHours() === 0) return `${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getMonth()]} ${String(d.getDate()).padStart(2, '0')}`;
    return `${String(d.getHours()).padStart(2, '0')}:00`;
  }

  /* Sparkline: index-spaced, fixed domain, a dotted reference hairline, and the
     latest point marked in the status color. */
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
    const ref = o.mean != null ? `<line class="spark-mean" x1="0" x2="${w}" y1="${f1(y(o.mean))}" y2="${f1(y(o.mean))}"/>` : '';
    const level = o.level === 'flag' || o.level === 'watch' ? o.level : '';

    return `<svg class="spark" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img" aria-label="${label}">`
      + `${ref}<path class="spark-line" d="${d}"/>`
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
       points: [{ t, value, level?, delta?, tag?: { text, level } }]   sorted by t
       t0, t1             x-range in ms
       xTicks(t0,t1,iw)   tick positions;  xLabel(t)  tick text
       tipTitle(p)        tooltip heading
       gapMs              break the line across gaps longer than this
       domain, ticks      y scale
       band: { lo, hi }   shaded reference zone (optional)
       lines: [{ value, kind: 'mean'|'thr'|'edge', label }]   reference lines
       dots: true|false   per-point markers (auto-thinned when dense)
       unit, label, format(v)
     } */
  function mount(el, cfg) {
    el.__herdCfg = cfg;
    el.__herdW = Math.floor(el.clientWidth);
    draw(el);
    if (ro && !observed.has(el)) { ro.observe(el); observed.add(el); }
  }

  function unmount(el) {
    if (ro && observed.has(el)) { ro.unobserve(el); observed.delete(el); }
  }

  function unmountWithin(root) {
    for (const el of Array.from(observed)) if (root.contains(el)) unmount(el);
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
    const m = { t: 12, r: 44, b: 24, l: 38 };
    const iw = W - m.l - m.r;
    const ih = Hh - m.t - m.b;

    const t1 = cfg.t1;
    const t0 = Math.min(cfg.t0, t1 - 1);
    const X = (t) => m.l + ((t - t0) / (t1 - t0)) * iw;
    const [d0, d1] = cfg.domain;
    const Y = (v) => m.t + ih - ((clamp(v, d0, d1) - d0) / (d1 - d0)) * ih;
    const fmt = cfg.format || ((v) => String(v));
    const pts = cfg.points.filter((p) => p.t >= t0 && p.t <= t1);
    const out = [];

    // Gridlines and y labels
    out.push('<g class="ch-grid">');
    cfg.ticks.forEach((v) => {
      const y = crisp(Y(v));
      out.push(`<line x1="${m.l}" x2="${m.l + iw}" y1="${y}" y2="${y}"/>`);
    });
    out.push('</g><g class="ch-axis">');
    cfg.ticks.forEach((v) => out.push(`<text x="${m.l - 8}" y="${f1(Y(v) + 3.5)}" text-anchor="end">${U.esc(fmt(v))}</text>`));

    // x labels
    const xt = (cfg.xTicks || dayTicks)(t0, t1, iw);
    const xl = cfg.xLabel || dayLabel;
    xt.forEach((t) => {
      const x = X(t);
      const anchor = x < m.l + 24 ? 'start' : x > m.l + iw - 24 ? 'end' : 'middle';
      out.push(`<text x="${f1(x)}" y="${Hh - 6}" text-anchor="${anchor}">${U.esc(xl(t))}</text>`);
    });
    out.push('</g>');

    // Reference band and lines
    if (cfg.band) {
      const yHi = Y(Math.min(cfg.band.hi, d1));
      const yLo = Y(Math.max(cfg.band.lo, d0));
      if (yLo > yHi) out.push(`<rect class="ch-band" x="${m.l}" y="${f1(yHi)}" width="${iw}" height="${f1(yLo - yHi)}"/>`);
    }
    (cfg.lines || []).forEach((ln) => {
      if (!(ln.value >= d0 && ln.value <= d1)) return;
      const y = crisp(Y(ln.value));
      out.push(`<line class="ch-${ln.kind}" x1="${m.l}" x2="${m.l + iw}" y1="${y}" y2="${y}"/>`);
      if (ln.label) out.push(`<text class="ch-${ln.kind}-label" x="${m.l + iw + 6}" y="${f1(y + 3)}">${U.esc(ln.label)}</text>`);
    });

    // Series
    const px = pts.map((p) => Object.assign({}, p, { x: X(p.t), y: Y(p.value) }));
    if (px.length) {
      const gap = cfg.gapMs || 2 * DAY;
      let d = '';
      px.forEach((p, i) => {
        d += `${!i || p.t - px[i - 1].t > gap ? 'M' : 'L'}${f1(p.x)} ${f1(p.y)}`;
      });
      // A soft area under each unbroken run of the series.
      const base = f1(m.t + ih);
      const runs = [[]];
      px.forEach((p, i) => { if (i && p.t - px[i - 1].t > gap) runs.push([]); runs[runs.length - 1].push(p); });
      runs.forEach((run) => {
        if (run.length < 2) return;
        const a = `M${f1(run[0].x)} ${base}` + run.map((p) => `L${f1(p.x)} ${f1(p.y)}`).join('') + `L${f1(run[run.length - 1].x)} ${base}Z`;
        out.push(`<path class="ch-area" d="${a}"/>`);
      });
      out.push(`<path class="ch-line" d="${d}"/>`);
      if (cfg.dots !== false) {
        const dense = px.length > 60;
        px.forEach((p) => {
          const off = p.level === 'flag' || p.level === 'watch';
          if (dense && !off) return;
          out.push(`<circle class="ch-pt ${off ? p.level : ''}" cx="${f1(p.x)}" cy="${f1(p.y)}" r="${off ? 3 : 2.25}"/>`);
        });
      }
    } else {
      out.push(`<text class="ch-empty" x="${m.l + iw / 2}" y="${m.t + ih / 2}" text-anchor="middle">No readings in range</text>`);
    }

    out.push(`<line class="ch-cross" x1="0" x2="0" y1="${m.t}" y2="${m.t + ih}"/>`);
    out.push('<circle class="ch-focus" cx="0" cy="0" r="5"/>');

    const aria = `${cfg.label}: ${pts.length} points, ${xl(t0)} to ${xl(t1)}.${cfg.ariaExtra ? ' ' + cfg.ariaExtra : ''} Use arrow keys to read values.`;
    el.innerHTML = `<svg width="${W}" height="${Hh}" viewBox="0 0 ${W} ${Hh}" role="img" aria-label="${U.esc(aria)}">${out.join('')}</svg><div class="tt" aria-hidden="true"></div>`;
    bind(el, px, { W, cfg, fmt });
  }

  /* Crosshair + tooltip: pointer, touch (tap), and keyboard (arrow keys). */
  function bind(el, px, ctx) {
    const svg = el.firstElementChild;
    const tt = el.lastElementChild;
    const cross = svg.querySelector('.ch-cross');
    const focus = svg.querySelector('.ch-focus');
    const title = ctx.cfg.tipTitle || ((p) => `${U.fmtWeekday(U.toISO(p.t))} ${U.fmtDate(U.toISO(p.t))}`);
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
      let extra = '';
      if (p.delta != null) extra = ` <b class="${p.level || ''}">${U.fmtPct(p.delta)}</b>`;
      else if (p.tag) extra = ` <b class="${p.tag.level || ''}">${U.esc(p.tag.text)}</b>`;
      tt.innerHTML = `<span class="tt-d">${U.esc(title(p))}</span>${U.esc(ctx.fmt(p.value))}${U.esc(unit)}${extra}`;
      tt.style.left = `${clamp(p.x, 64, ctx.W - 64)}px`;
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
      const step = px.length > 60 ? 6 : 1;
      if (e.key === 'ArrowRight') { show(idx < 0 ? px.length - 1 : Math.min(px.length - 1, idx + step)); e.preventDefault(); }
      else if (e.key === 'ArrowLeft') { show(idx < 0 ? px.length - 1 : Math.max(0, idx - step)); e.preventDefault(); }
      else if (e.key === 'Home') { show(0); e.preventDefault(); }
      else if (e.key === 'End') { show(px.length - 1); e.preventDefault(); }
      else if (e.key === 'Escape') hide();
    };
  }

  H.charts = {
    sparkline, mount, unmount, unmountWithin, reset,
    niceTicks, niceScale, dayTicks, hourTicks, dayLabel, hourLabel,
  };
})(window.Herd = window.Herd || {});
