/* Herd · environment views
   Sensor hub (#/env), the environment panel on each subject page, the summary
   on the field overview, and the dialogs for spaces, sensors, readings and
   needs. Blocks marked data-live re-render in place as readings arrive. */
(function (H) {
  'use strict';

  const U = H.util;
  const E = H.env;
  const ES = H.envStore;
  const S = H.store;
  const C = H.charts;
  const V = H.views;
  const esc = U.esc;
  const MIN = 60000;

  const KIND = {
    ble: { label: 'Bluetooth', hint: 'Chrome or Edge on desktop or Android. Sensors with the Environmental Sensing service (0x181A), e.g. Xiaomi LYWSD03MMC on pvvx/ATC firmware, ESP32 builds.' },
    http: { label: 'Wi‑Fi / HTTP', hint: 'Home Assistant, ESPHome, or any device or hub that serves JSON over HTTPS.' },
    manual: { label: 'Manual', hint: 'Type readings from any thermometer, hygrometer or gas meter. Works everywhere.' },
    demo: { label: 'Simulated', hint: 'Realistic demo data with a daily cycle. No hardware needed.' },
  };

  const PRESETS = {
    ha: {
      label: 'Home Assistant', path: 'state', token: true,
      url: (m) => `https://homeassistant.local:8123/api/states/sensor.room_${m === 'temp' ? 'temperature' : m === 'humidity' ? 'humidity' : m === 'co2' ? 'co2' : 'ammonia'}`,
      help: 'One entity per measurement. Create a long-lived access token (Profile → Security) and add this site to http → cors_allowed_origins in configuration.yaml.',
    },
    esphome: {
      label: 'ESPHome', path: 'value', token: false,
      url: (m) => `https://sensor.local/sensor/${m === 'temp' ? 'temperature' : m === 'humidity' ? 'humidity' : m}`,
      help: 'Uses the web_server REST endpoint /sensor/<id>. Devices serve plain http, so open Herd from your own computer (see README) or put the device behind an https proxy.',
    },
    json: {
      label: 'Generic JSON', path: '', token: true,
      url: () => 'https://',
      help: 'Any URL returning JSON. Point each measurement at a number with a dot path, e.g. data.temperature or readings[0].value. Token is optional.',
    },
  };

  const statusPill = (level) => (level === 'none' ? '<span class="pill none">No residents</span>' : V.pill(level));

  /* ======================================================================
     Shared helpers
     ====================================================================== */

  function unit() { return ES.unit(); }

  function needText(metric, need, u) {
    if (!need) return '';
    const m = E.METRICS[metric];
    if (m.type === 'ceiling') {
      const parts = [];
      if (need.watch != null) parts.push(`watch ${E.fmtValue(metric, need.watch, u, false)}`);
      if (need.max != null) parts.push(`limit ${E.fmtValue(metric, need.max, u, true)}`);
      return parts.join(' · ');
    }
    const lo = need.min != null ? E.fmtValue(metric, need.min, u, false) : '…';
    const hi = need.max != null ? E.fmtValue(metric, need.max, u, false) : '…';
    return `${lo}–${hi} ${E.unitLabel(metric, u)}`;
  }

  function readingText(values, metrics, u) {
    if (!values) return '—';
    return metrics.filter((k) => values[k] != null).map((k) => E.fmtValue(k, values[k], u, true)).join(' · ') || '—';
  }

  function hostOf(url) {
    try { return new URL(url).host; } catch (e) { return ''; }
  }

  function connectionText(s) {
    if (s.kind === 'demo') return `Simulated · ${s.config.profile === 'air' ? 'air quality' : 'climate'}`;
    if (s.kind === 'manual') return 'Manual entry';
    if (s.kind === 'ble') return `Bluetooth · ${s.config.deviceName || 'device'}`;
    const first = Object.values(s.config.endpoints || {})[0];
    return `${PRESETS[s.config.preset].label}${first ? ` · ${hostOf(first.url)}` : ''}`;
  }

  function offsetsText(s, u) {
    const parts = Object.keys(s.offsets || {}).map((k) => {
      const d = E.deltaToDisplay(k, s.offsets[k], u);
      const sign = d > 0 ? '+' : U.MINUS;
      const digits = E.METRICS[k].digits;
      return `${E.METRICS[k].short} ${sign}${Math.abs(d).toFixed(digits)}${E.unitLabel(k, u) === '%' ? '%' : ' ' + E.unitLabel(k, u)}`;
    });
    return parts.length ? `cal ${parts.join(', ')}` : '';
  }

  function hhmm(t) {
    const d = new Date(t);
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  }

  function localInput(t) {
    const d = new Date(t);
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
  }

  function unitToggle() {
    const u = unit();
    return `<div class="seg" role="group" aria-label="Temperature unit">
      <button type="button" class="seg-btn" data-action="unit" data-unit="C" aria-pressed="${u === 'C'}">°C</button>
      <button type="button" class="seg-btn" data-action="unit" data-unit="F" aria-pressed="${u === 'F'}">°F</button>
    </div>`;
  }

  function tir(t) {
    if (!t) return '';
    const pct = Math.round(t.share * 100);
    const cls = t.share >= 0.95 ? '' : t.share >= 0.8 ? 't-watch' : 't-flag';
    return `<span class="tir ${cls}"><span class="tir-bar" aria-hidden="true"><i style="width:${pct}%"></i></span><span class="tir-t">${pct}% in range · 24h</span></span>`;
  }

  /* Live sensor tally used by the app's top bar. */
  function sensorTally() {
    const sensors = ES.sensors();
    const live = sensors.filter((s) => { const k = H.sensors.status(s).key; return k === 'live' || k === 'manual'; }).length;
    return { live, total: sensors.length };
  }

  /* ======================================================================
     Environment page
     ====================================================================== */

  function envPage() {
    const actions = `${unitToggle()}
      <button type="button" class="btn" data-action="new-space"><span class="plus">+</span> Space</button>
      <button type="button" class="btn btn-primary" data-action="new-sensor"><span class="plus">+</span> Sensor</button>`;
    return {
      title: 'Herd · Environment',
      crumbs: [{ label: 'Field', href: '#/' }, { label: 'Environment' }],
      html: `<section class="view">
        ${ES.isPersistent() ? '' : '<div class="banner" role="alert">Browser storage is unavailable or full. Sensor readings will not survive a reload.</div>'}
        ${V.vhead('004 · Environment', 'Environment', 'Spaces, the animals in them, and the sensors that watch them. Each space must suit every resident.', actions)}
        <div data-live="env-body">${envBody().html}</div>
        ${connectGuide()}
      </section>`,
      mount(root) { mountCharts(root); },
    };
  }

  const chartCfgs = new Map();
  function mountCharts(root) {
    root.querySelectorAll('[data-env-chart]').forEach((el) => {
      const cfg = chartCfgs.get(el.dataset.envChart);
      if (cfg) C.mount(el, cfg);
    });
  }

  function envBody() {
    chartCfgs.clear();
    const spaces = ES.spaces();
    const sensors = ES.sensors();
    const analyses = spaces.map((sp) => E.analyzeSpace(sp.id));
    const statuses = sensors.map((s) => H.sensors.status(s));
    const live = statuses.filter((st) => st.key === 'live' || st.key === 'manual').length;
    const attention = analyses.filter((a) => a.level === 'watch' || a.level === 'flag').length;
    const unassigned = S.subjects().filter((s) => !ES.spaceOf(s.id));

    if (!spaces.length && !sensors.length) {
      return { html: `<div class="panel empty">
        <p class="big">No sensors connected yet.</p>
        <p class="muted">Add a sensor when your hardware is ready, log readings by hand, or start with a simulated one. Spaces and climate checks appear here once you do.</p>
        <div class="vhead-actions" style="justify-content:center">
          <button type="button" class="btn btn-primary" data-action="new-sensor"><span class="plus">+</span> Sensor</button>
          <button type="button" class="btn" data-action="new-space"><span class="plus">+</span> Space</button>
        </div>
      </div>` };
    }

    const cell = (label, v, sub, dot, k) => `<div class="tally-btn" data-k="${k || ''}"><span class="k">${dot ? `<i class="dot ${dot}"></i>` : ''}${label}</span><span class="v${v ? ' has' : ''}">${String(v).padStart(2, '0')}</span><span class="s">${sub}</span></div>`;
    const tally = `<div class="tally">
      ${cell('Spaces', spaces.length, 'Rooms, pens, stalls')}
      ${cell('Reporting', live, `of ${sensors.length} ${sensors.length === 1 ? 'sensor' : 'sensors'}`, live ? 'nominal' : 'none')}
      ${cell('Attention', attention, attention === 1 ? 'space on watch or flag' : 'spaces on watch or flag', attention ? 'watch' : '', attention ? 'watch' : '')}
      ${cell('Unassigned', unassigned.length, unassigned.length === 1 ? 'animal without a space' : 'animals without a space')}
    </div>`;

    const spaceList = spaces.length
      ? analyses.map((a) => spaceCard(a)).join('')
      : `<div class="panel empty"><p class="big">No spaces yet.</p><p class="muted">A space is a room, pen, stall or enclosure. Animals live in a space; sensors sit in one.</p><button type="button" class="btn btn-primary" data-action="new-space"><span class="plus">+</span> Space</button></div>`;

    const unassignedNote = unassigned.length
      ? `<p class="hint" style="margin-top:14px">Not in a space: ${unassigned.map((s) => `<a href="#/s/${esc(s.id)}">${esc(s.id)}</a> ${esc(s.name)}`).join(', ')}. Add them to a space so their needs are checked.</p>`
      : '';

    return {
      html: `${tally}
        <section class="section" aria-labelledby="spaces-h">
          <div class="section-head">
            <h2 id="spaces-h"><span class="n">001</span>Spaces</h2>
            <span class="section-meta">Ranges come from each resident&rsquo;s species preset and overrides</span>
          </div>
          <div class="space-list">${spaceList}</div>
          ${unassignedNote}
        </section>
        <section class="section" aria-labelledby="sensors-h">
          <div class="section-head">
            <h2 id="sensors-h"><span class="n">002</span>Sensors</h2>
            <span class="section-meta">${live} of ${sensors.length} reporting · read while Herd is open</span>
          </div>
          ${sensorTable(sensors, statuses)}
        </section>`,
    };
  }

  function spaceCard(a) {
    const u = a.unit;
    const sp = a.space;
    const residents = a.residents.length
      ? a.residents.map(({ subject }) => {
        const st = H.baseline.analyze(S.entries(subject.id)).status.level;
        return `<a class="chip" href="#/s/${esc(subject.id)}">${V.sil(subject.species, st)}<b>${esc(subject.id)}</b>${esc(subject.name)}</a>`;
      }).join('')
      : '<span class="muted" style="font-size:13px">No residents yet</span>';

    // Temperature and humidity always show; gases and THI only when measured.
    const metrics = E.ORDER.filter((k) => a.current[k] || ((k === 'temp' || k === 'humidity') && a.needs[k]));
    const tiles = metrics.map((k) => metricTile(k, a, u)).join('');

    const chartKeys = ['temp', 'humidity', 'co2', 'nh3']
      .filter((k) => a.sensors.some((s) => s.enabled && s.metrics.includes(k) && ES.readings(s.id, Date.now() - U.DAY_MS).length > 1))
      .slice(0, 2);
    const charts = chartKeys.map((k) => {
      const id = `${sp.id}:${k}`;
      chartCfgs.set(id, spaceChartCfg(a, k, u));
      return `<article class="panel chart-card">
        <div class="chart-top"><h3>${esc(E.METRICS[k].label)}<span>${esc(E.unitLabel(k, u))} · 24h</span></h3></div>
        <div class="chart" data-env-chart="${esc(id)}" data-chart="env-${esc(id)}" tabindex="0"></div>
        <div class="legend" aria-hidden="true">
          <span><i class="lg"></i>Reading</span>
          ${E.METRICS[k].type === 'range' && a.needs[k] ? '<span><i class="lg lg-band"></i>Acceptable range</span>' : ''}
          ${E.METRICS[k].type === 'ceiling' && a.needs[k] ? '<span><i class="lg lg-warn"></i>Watch</span><span><i class="lg lg-thr"></i>Limit</span>' : ''}
        </div>
      </article>`;
    }).join('');

    return `<article class="panel space" aria-labelledby="h-${esc(sp.id)}">
      <div class="space-head">
        <div>
          <div class="space-idrow"><span class="tag">${esc(sp.id)}</span>${statusPill(a.level)}</div>
          <h3 class="space-name" id="h-${esc(sp.id)}">${esc(sp.name)}</h3>
          <div class="chips">${residents}</div>
        </div>
        <div class="space-actions">
          <button type="button" class="btn btn-sm" data-action="new-sensor" data-space="${esc(sp.id)}"><span class="plus">+</span> Sensor</button>
          <button type="button" class="btn btn-sm" data-action="edit-space" data-id="${esc(sp.id)}">Edit</button>
        </div>
      </div>
      ${a.notes.length ? `<ul class="env-notes">${a.notes.map((n) => `<li class="t-${n.level}"><i class="dot ${n.level}"></i><span>${esc(n.text)}</span></li>`).join('')}</ul>` : ''}
      ${tiles ? `<div class="metrics">${tiles}</div>` : ''}
      ${charts ? `<div class="charts env-charts">${charts}</div>` : (a.sensors.length ? '' : `<p class="space-hint">No sensors in this space. <button type="button" class="link-btn" data-action="new-sensor" data-space="${esc(sp.id)}">Add one</button>.</p>`)}
    </article>`;
  }

  function metricTile(k, a, u) {
    const m = E.METRICS[k];
    const c = a.current[k];
    const need = a.needs[k];
    const level = c && c.fresh ? c.ev.level : 'none';
    const value = c ? E.fmtValue(k, c.value, u, false) : '—';
    const unitTxt = E.unitLabel(k, u);
    let by = '';
    if (need && a.residents.length > 1 && m.type === 'range') {
      const who = [need.minBinds && need.minBy, need.maxBinds && need.maxBy].filter(Boolean);
      if (who.length === 1 || (who.length === 2 && who[0] === who[1])) by = ` · set by ${who[0]}`;
      else if (who.length === 2) by = ` · min ${who[0]}, max ${who[1]}`;
    }
    const src = c ? (c.derived ? 'from temperature + humidity' : `${esc(c.sensor.name)} · ${E.agoShort(Date.now() - c.at)}`) : 'no sensor';
    return `<div class="metric ${c && !c.fresh ? 'is-stale' : ''}">
      <span class="k">${level !== 'none' ? `<i class="dot ${level}"></i>` : '<i class="dot none"></i>'}${esc(m.short)}</span>
      <span class="v num">${esc(value)}${unitTxt ? `<span class="u">${esc(unitTxt)}</span>` : ''}</span>
      <span class="s">${need ? esc(needText(k, need, u) + by) : 'no requirement'}</span>
      ${tir(a.inRange24[k])}
      <span class="s">${src}</span>
    </div>`;
  }

  function spaceChartCfg(a, k, u) {
    const now = Date.now();
    const t0 = now - U.DAY_MS;
    const m = E.METRICS[k];
    const need = a.needs[k];
    const sensor = a.sensors.find((s) => s.enabled && s.metrics.includes(k) && ES.readings(s.id, t0).length > 1);
    const disp = (v) => E.toDisplay(k, v, u);
    const points = sensor ? ES.readings(sensor.id, t0).filter((r) => r.v[k] != null).map((r) => {
      const ev = need ? E.evaluate(k, r.v[k], need, u) : { level: 'nominal' };
      let tag = null;
      if (ev.over != null) tag = { text: `${E.fmtDelta(k, ev.over, u)} over`, level: 'flag' };
      else if (ev.under != null) tag = { text: `${E.fmtDelta(k, ev.under, u)} under`, level: 'flag' };
      return { t: r.t, value: disp(r.v[k]), tag };
    }) : [];

    const vals = points.map((p) => p.value);
    const refs = [];
    if (need && need.min != null) refs.push(disp(need.min));
    if (need && need.max != null) refs.push(disp(need.max));
    if (need && need.watch != null) refs.push(disp(need.watch));
    const lo = Math.min(...vals, ...refs);
    const hi = Math.max(...vals, ...refs);
    const pad = Math.max((hi - lo) * 0.12, k === 'temp' ? 0.5 : 2);
    const floor0 = k === 'co2' || k === 'nh3' || k === 'humidity';
    const scale = C.niceScale(floor0 ? Math.max(0, lo - pad) : lo - pad, hi + pad, 3);

    const lines = [];
    let band = null;
    if (need && m.type === 'range') {
      band = { lo: need.min != null ? disp(need.min) : scale.domain[0], hi: need.max != null ? disp(need.max) : scale.domain[1] };
      if (need.max != null) lines.push({ value: disp(need.max), kind: 'edge', label: 'max' });
      if (need.min != null) lines.push({ value: disp(need.min), kind: 'edge', label: 'min' });
    } else if (need) {
      if (need.watch != null) lines.push({ value: disp(need.watch), kind: 'warn', label: 'watch' });
      if (need.max != null) lines.push({ value: disp(need.max), kind: 'thr', label: 'limit' });
    }
    const step = scale.ticks[1] - scale.ticks[0];
    const fmtTick = (v) => (step < 1 ? v.toFixed(1) : Math.round(v).toLocaleString('en-US'));

    return {
      label: `${m.label}, last 24 hours${sensor ? `, ${sensor.name}` : ''}`,
      unit: E.unitLabel(k, u),
      points, t0, t1: now, gapMs: 20 * MIN,
      xTicks: C.hourTicks, xLabel: C.hourLabel,
      tipTitle: (p) => `${U.fmtWeekday(U.toISO(p.t - new Date(p.t).getTimezoneOffset() * MIN))} ${hhmm(p.t)}`,
      domain: scale.domain, ticks: scale.ticks, band, lines, dots: false,
      format: (v) => (step < 1 || m.digits ? fmtTick(v) : Math.round(v).toLocaleString('en-US')),
    };
  }

  function sensorTable(sensors, statuses) {
    if (!sensors.length) {
      return `<div class="panel empty"><p class="big">No sensors yet.</p><p class="muted">Connect over Bluetooth or Wi‑Fi, log readings by hand, or start with a simulated sensor.</p><button type="button" class="btn btn-primary" data-action="new-sensor"><span class="plus">+</span> Sensor</button></div>`;
    }
    const u = unit();
    const rows = sensors.map((s, i) => {
      const st = statuses[i];
      const last = ES.latest(s.id);
      const sp = s.spaceId ? ES.space(s.spaceId) : null;
      const cal = offsetsText(s, u);
      const seen = st.lastAt ? E.agoShort(Date.now() - st.lastAt) : 'no readings yet';
      const battery = st.battery != null ? ` · battery ${st.battery}%` : '';

      let primary;
      if (s.kind === 'manual') primary = `<button type="button" class="btn btn-sm" data-action="log-reading" data-id="${esc(s.id)}" ${s.enabled ? '' : 'disabled'}>Log reading</button>`;
      else if (s.kind === 'ble' && (st.key === 'offline' || st.key === 'connecting')) primary = `<button type="button" class="btn btn-sm" data-action="connect-sensor" data-id="${esc(s.id)}" ${s.enabled ? '' : 'disabled'}>Connect</button>`;
      else primary = `<button type="button" class="btn btn-sm" data-action="read-sensor" data-id="${esc(s.id)}" ${s.enabled ? '' : 'disabled'}>Read now</button>`;

      return `<tr class="st-${st.key}">
        <td class="c-sensor"><span class="name">${esc(s.name)}</span><span class="sub">${esc(s.id)} · ${esc(connectionText(s))}</span>${cal ? `<span class="sub">${esc(cal)}</span>` : ''}</td>
        <td class="c-space" data-label="Space">${sp ? esc(sp.name) : '<span class="muted">Unassigned</span>'}</td>
        <td class="c-reading" data-label="Reading">${esc(readingText(last && last.v, s.metrics, u))}</td>
        <td class="c-state" data-label="Status"><span class="sstate ${st.key}"><i></i>${esc(st.label)}</span><span class="sub">${esc(seen + battery)}</span>${st.message ? `<span class="sub st-msg">${esc(st.message)}</span>` : ''}</td>
        <td class="c-controls"><div class="controls">
          ${primary}
          <button type="button" class="btn btn-sm" data-action="toggle-sensor" data-id="${esc(s.id)}" aria-pressed="${!s.enabled}">${s.enabled ? 'Pause' : 'Resume'}</button>
          <button type="button" class="btn btn-sm btn-quiet" data-action="edit-sensor" data-id="${esc(s.id)}">Edit</button>
          <button type="button" class="btn btn-sm btn-quiet btn-danger" data-action="remove-sensor" data-id="${esc(s.id)}">Remove</button>
        </div></td>
      </tr>`;
    }).join('');

    return `<div class="log-wrap"><table class="log sensors">
      <thead><tr>
        <th scope="col">Sensor</th><th scope="col">Space</th><th scope="col">Reading</th><th scope="col">Status</th>
        <th scope="col"><span class="visually-hidden">Controls</span></th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table></div>`;
  }

  function connectGuide() {
    const ble = H.sensors.bleSupported();
    return `<section class="section" aria-labelledby="guide-h">
      <div class="section-head"><h2 id="guide-h"><span class="n">003</span>Connecting sensors</h2></div>
      <div class="guide">
        <div><span class="micro">004A</span><h3>Bluetooth</h3>
          <p>Pair directly from this page. Sensors exposing Environmental Sensing (0x181A): Xiaomi LYWSD03MMC on pvvx firmware, many ESP32 builds.</p>
          <p class="ok">${ble ? 'Available in this browser' : 'Not in this browser · use Chrome or Edge on a computer or Android'}</p></div>
        <div><span class="micro">004B</span><h3>Wi&#8209;Fi / HTTP</h3>
          <p>Polls any JSON endpoint. Easiest via Home Assistant, which already speaks to most sensor brands (Govee, SensorPush, Aqara, Shelly, Zigbee).</p>
          <p class="ok">The device must serve https and allow this site (CORS)</p></div>
        <div><span class="micro">004C</span><h3>Manual</h3>
          <p>Log readings from any meter in seconds. Readings stay valid for 12 hours, then the sensor shows as due.</p>
          <p class="ok">Works on every device</p></div>
        <div><span class="micro">004D</span><h3>Keep in mind</h3>
          <p>Herd has no server: sensors are read only while a tab is open. For 24/7 capture, let a hub record and point Herd at it.</p>
          <p class="ok">Access tokens stay in this browser and are never exported</p></div>
      </div>
    </section>`;
  }

  /* ======================================================================
     Subject page panel and field summary
     ====================================================================== */

  function subjectEnv(subject) {
    const u = unit();
    const needs = E.subjectNeeds(subject);
    const spaceId = ES.spaceOf(subject.id);
    const a = spaceId ? E.analyzeSpace(spaceId) : null;
    const rows = [];
    let level = 'nominal';
    const notes = [];
    if (a) {
      E.ORDER.forEach((k) => {
        const need = needs.metrics[k];
        let c = a.current[k];
        if (k === 'thi' && need && !c && a.current.temp && a.current.humidity && a.current.temp.fresh && a.current.humidity.fresh) {
          c = { value: E.thi(a.current.temp.value, a.current.humidity.value), fresh: true, derived: true, at: a.current.temp.at };
        }
        if (!c && k !== 'temp' && k !== 'humidity') return;
        if (!need && !c) return;
        const ev = c && c.fresh && need ? E.evaluate(k, c.value, need, u) : { level: 'nominal', text: '' };
        rows.push({ k, need, c, ev });
        if (ev.level !== 'nominal') { level = E.worse(level, ev.level); notes.push({ level: ev.level, text: ev.text }); }
      });
      if (!rows.some((r) => r.c)) level = 'none';
    }
    // Time in range against THIS animal's needs, not the space's combined limits.
    const t = a ? E.timeInRange(a.sensors, needs.metrics, Date.now()) : {};
    return { u, needs, space: a ? a.space : null, a, rows, level, notes, tir: t };
  }

  function subjectPanel(subject) {
    // Nothing to show until a space or sensor exists.
    if (!ES.spaces().length && !ES.sensors().length) return '';
    return `<section class="panel env-subject" aria-labelledby="env-h">
      <div class="section-head"><h2 id="env-h">Environment</h2><span class="section-meta"><a href="#/env">Spaces &amp; sensors</a></span></div>
      <div data-live="subject-env:${esc(subject.id)}">${subjectPanelBody(subject).html}</div>
    </section>`;
  }

  function subjectPanelBody(subject) {
    const r = subjectEnv(subject);
    const p = r.needs.profile;
    const editBtn = `<button type="button" class="btn btn-sm" data-action="edit-needs" data-id="${esc(subject.id)}">Space &amp; needs</button>`;
    const preset = `<p class="env-preset">${esc(p.label)} preset${r.needs.overridden ? ' with overrides' : ''} · ${esc(p.source)}${r.needs.note ? ` · <em>${esc(r.needs.note)}</em>` : ''}</p>`;

    if (!r.space) {
      return { html: `<div class="env-subject-head"><div><p style="font-size:14px">Not in a space, so ${esc(subject.name)}&rsquo;s surroundings aren&rsquo;t checked.</p>${preset}</div>${editBtn}</div>
        <div class="metrics">${E.ORDER.filter((k) => r.needs.metrics[k]).map((k) => `<div class="metric"><span class="k">${esc(E.METRICS[k].short)}</span><span class="s">needs ${esc(needText(k, r.needs.metrics[k], r.u))}</span></div>`).join('')}</div>` };
    }

    const notes = r.notes.length
      ? r.notes.map((n) => `<li class="t-${n.level}"><i class="dot ${n.level}"></i><span>${esc(n.text)}</span></li>`).join('')
      : `<li class="t-nominal"><i class="dot ${r.level === 'none' ? 'none' : 'nominal'}"></i><span>${r.level === 'none' ? 'No readings from this space yet' : `Within ${esc(subject.name)}&rsquo;s range`}</span></li>`;

    const tiles = r.rows.map(({ k, need, c, ev }) => {
      const lvl = c && c.fresh ? ev.level : 'none';
      const src = need && need.from && (need.from.min === 'override' || need.from.max === 'override' || need.from.watch === 'override') ? ' · override' : '';
      return `<div class="metric ${c && !c.fresh ? 'is-stale' : ''}">
        <span class="k"><i class="dot ${lvl}"></i>${esc(E.METRICS[k].short)}</span>
        <span class="v num">${c ? esc(E.fmtValue(k, c.value, r.u, false)) : '—'}${E.unitLabel(k, r.u) ? `<span class="u">${esc(E.unitLabel(k, r.u))}</span>` : ''}</span>
        <span class="s">${need ? `needs ${esc(needText(k, need, r.u))}${src}` : 'no requirement'}</span>
        ${tir(r.tir[k])}
      </div>`;
    }).join('');

    return { html: `<div class="env-subject-head">
        <div>
          <a href="#/env" class="space-link">${esc(r.space.name)}</a> <span class="micro">${esc(r.space.id)}</span>
          ${preset}
        </div>
        ${editBtn}
      </div>
      <ul class="env-notes">${notes}</ul>
      ${tiles ? `<div class="metrics">${tiles}</div>` : ''}` };
  }

  function overviewSummary() {
    return `<section class="section" aria-labelledby="ov-env-h">
      <div class="section-head">
        <h2 id="ov-env-h"><span class="n">002</span>Environment</h2>
        <span class="section-meta"><a href="#/env">Spaces &amp; sensors</a></span>
      </div>
      <div data-live="overview-env">${overviewSummaryBody().html}</div>
    </section>`;
  }

  function overviewSummaryBody() {
    const spaces = ES.spaces();
    if (!spaces.length) {
      return { html: `<div class="panel env-empty-line"><span class="muted">No sensors connected yet. Spaces and climate checks show up here once you add one.</span><a class="btn btn-sm" href="#/env">Open environment</a></div>` };
    }
    const u = unit();
    const rows = spaces.map((sp) => {
      const a = E.analyzeSpace(sp.id);
      const val = (k) => (a.current[k] ? E.fmtValue(k, a.current[k].value, u, true) : null);
      const readings = ['temp', 'humidity', 'co2'].map(val).filter(Boolean).join(' · ') || '—';
      return `<a class="env-row" href="#/env">
        <span class="c-id">${esc(sp.id)}</span>
        <span class="c-name"><span class="name">${esc(sp.name)}</span><span class="sub">${a.residents.length} ${a.residents.length === 1 ? 'resident' : 'residents'} · ${a.sensors.length} ${a.sensors.length === 1 ? 'sensor' : 'sensors'}</span></span>
        <span class="c-reading">${esc(readings)}</span>
        <span class="c-signal">${esc(a.notes[0] ? a.notes[0].text : 'All readings within range')}</span>
        <span class="c-status">${statusPill(a.level)}</span>
      </a>`;
    }).join('');
    return { html: `<div class="env-strip" role="list" aria-label="Spaces">${rows}</div>` };
  }

  /* Live re-render entry point used by the app. */
  function live(key) {
    if (key === 'env-body') return Object.assign(envBody(), { mount: mountCharts });
    if (key === 'overview-env') return overviewSummaryBody();
    if (key.startsWith('subject-env:')) {
      const s = S.subject(key.slice(12));
      return s ? subjectPanelBody(s) : null;
    }
    return null;
  }

  /* ======================================================================
     Dialogs
     ====================================================================== */

  const head = (eyebrow, title) => V.dlgHead(eyebrow, title);

  function spaceForm(space) {
    const subjects = S.subjects();
    const residents = space ? ES.residentsOf(space.id) : [];
    const list = subjects.length ? subjects.map((s) => {
      const cur = ES.spaceOf(s.id);
      const elsewhere = cur && (!space || cur !== space.id) ? ES.space(cur) : null;
      return `<label class="check">
        <input type="checkbox" name="residents" value="${esc(s.id)}"${residents.includes(s.id) ? ' checked' : ''}>
        <span><span class="mono">${esc(s.id)}</span> ${esc(s.name)} <span class="muted">· ${esc(s.species)}${elsewhere ? ` · moves from ${esc(elsewhere.name)}` : ''}</span></span>
      </label>`;
    }).join('') : '<p class="muted">No animals yet.</p>';

    return `<form data-form="space" data-id="${space ? esc(space.id) : ''}" novalidate>
      ${head(space ? 'Edit space' : 'New space', `<span class="mono">${space ? esc(space.id) : 'New space'}</span>`)}
      <div class="dlg-body">
        <div class="field">
          <label for="sp-name">Name</label>
          <input class="input" id="sp-name" name="name" maxlength="60" required value="${space ? esc(space.name) : ''}" placeholder="e.g. Barn A, Kennel, Living room" autocomplete="off">
        </div>
        <fieldset class="field" style="margin-top:16px">
          <legend>Residents</legend>
          <div class="checks">${list}</div>
          <p class="hint">The space must suit every resident: Herd uses the highest minimum and lowest maximum among them.</p>
        </fieldset>
        <p class="form-error" data-error role="alert"></p>
        <div class="dlg-actions">
          ${space ? `<button type="button" class="btn btn-danger dlg-left" data-action="delete-space" data-id="${esc(space.id)}">Delete space</button>` : ''}
          <button type="button" class="btn" data-action="close-dialog">Cancel</button>
          <button type="submit" class="btn btn-primary">${space ? 'Save space' : 'Create space'}</button>
        </div>
      </div>
    </form>`;
  }

  function readSpaceForm(form) {
    const name = form.elements.name.value.trim();
    const residents = Array.from(form.querySelectorAll('input[name="residents"]:checked')).map((i) => i.value);
    return { name, residents, errors: name ? [] : ['Name is required.'] };
  }

  function sensorForm(sensor, presetSpace) {
    const u = unit();
    const isEdit = Boolean(sensor);
    const s = sensor || { kind: 'http', metrics: ['temp', 'humidity'], intervalSec: 60, offsets: {}, config: { preset: 'ha', endpoints: {} }, spaceId: presetSpace || (ES.spaces()[0] || {}).id || null, enabled: true };
    const cfg = s.config || {};
    const spaces = ES.spaces();
    const preset = cfg.preset || 'ha';

    const kindCards = isEdit ? `<p class="kind-fixed"><span class="eyebrow">Connection</span> ${esc(KIND[s.kind].label)}</p><input type="hidden" name="kind" value="${esc(s.kind)}">`
      : `<fieldset class="field"><legend>Connection</legend><div class="kind-cards">${Object.keys(KIND).map((k) => `
          <input type="radio" name="kind" id="sk-${k}" value="${k}"${s.kind === k ? ' checked' : ''}>
          <label for="sk-${k}" class="kind-card"><span class="kc-title">${esc(KIND[k].label)}</span><span class="kc-hint">${esc(KIND[k].hint)}</span></label>`).join('')}
        </div></fieldset>`;

    const metricChecks = E.SENSOR_METRICS.map((k) => `<label class="check inline"><input type="checkbox" name="metrics" value="${k}"${s.metrics.includes(k) ? ' checked' : ''}><span>${esc(E.METRICS[k].label)}</span></label>`).join('');

    const endpoints = E.SENSOR_METRICS.map((k) => {
      const e = (cfg.endpoints || {})[k] || {};
      return `<div class="endpoint" data-metric-row="${k}">
        <div class="field"><label for="ep-url-${k}">${esc(E.METRICS[k].label)} URL</label>
          <input class="input mono" id="ep-url-${k}" name="url-${k}" type="url" inputmode="url" value="${esc(e.url || '')}" placeholder="${esc(PRESETS[preset].url(k))}" autocomplete="off" spellcheck="false"></div>
        <div class="field ep-path"><label for="ep-path-${k}">JSON path</label>
          <input class="input mono" id="ep-path-${k}" name="path-${k}" value="${esc(e.path != null && e.url ? e.path : PRESETS[preset].path)}" placeholder="(whole response)" autocomplete="off" spellcheck="false"></div>
      </div>`;
    }).join('');

    const offsets = E.SENSOR_METRICS.map((k) => {
      const d = s.offsets && s.offsets[k] ? E.deltaToDisplay(k, s.offsets[k], u) : '';
      return `<div class="field" data-metric-row="${k}"><label for="off-${k}">${esc(E.METRICS[k].short)}<span class="unit">${esc(E.unitLabel(k, u))}</span></label>
        <input class="input mono" id="off-${k}" name="off-${k}" type="number" step="0.1" inputmode="decimal" value="${d === '' ? '' : esc(Math.round(d * 10) / 10)}" placeholder="0"></div>`;
    }).join('');

    return `<form data-form="sensor" data-id="${isEdit ? esc(s.id) : ''}" novalidate>
      ${head(isEdit ? 'Edit sensor' : 'Add sensor', `<span class="mono">${esc(isEdit ? s.id : ES.peekSensorId())}</span>`)}
      <div class="dlg-body sensor-form">
        ${kindCards}
        <div class="form-grid" style="margin-top:16px">
          <div class="field"><label for="sn-name">Name</label>
            <input class="input" id="sn-name" name="name" maxlength="60" value="${isEdit ? esc(s.name) : ''}" placeholder="e.g. Barn A climate" autocomplete="off"></div>
          <div class="field"><label for="sn-space">Space</label>
            <select class="input" id="sn-space" name="spaceId">
              <option value="">Unassigned</option>
              ${spaces.map((sp) => `<option value="${esc(sp.id)}"${s.spaceId === sp.id ? ' selected' : ''}>${esc(sp.name)}</option>`).join('')}
            </select></div>
        </div>

        <fieldset class="field" data-when="manual http" style="margin-top:16px"><legend>Measures</legend><div class="checks inline">${metricChecks}</div></fieldset>

        <div data-when="ble" class="when-block">
          <div class="pair-row">
            <button type="button" class="btn" data-action="ble-pair">${cfg.deviceId ? 'Pair a different device' : 'Pair Bluetooth device'}</button>
            <span class="mono pair-label" data-pair-label>${cfg.deviceName ? `Paired: ${esc(cfg.deviceName)}` : 'No device paired'}</span>
          </div>
          <input type="hidden" name="deviceId" value="${esc(cfg.deviceId || '')}">
          <input type="hidden" name="deviceName" value="${esc(cfg.deviceName || '')}">
          <p class="hint">${H.sensors.bleSupported() ? 'Reads temperature and humidity (and battery, if offered). Keep the sensor within about 10 m.' : 'This browser has no Web Bluetooth. Use Chrome or Edge on a computer or Android phone.'}</p>
        </div>

        <div data-when="http" class="when-block">
          <div class="form-grid">
            <div class="field"><label for="sn-preset">Source</label>
              <select class="input" id="sn-preset" name="preset">${Object.keys(PRESETS).map((p) => `<option value="${p}"${preset === p ? ' selected' : ''}>${esc(PRESETS[p].label)}</option>`).join('')}</select></div>
            <div class="field"><label for="sn-tunit">Source temperature unit</label>
              <select class="input" id="sn-tunit" name="tempUnit"><option value="C"${cfg.tempUnit !== 'F' ? ' selected' : ''}>°C</option><option value="F"${cfg.tempUnit === 'F' ? ' selected' : ''}>°F</option></select></div>
          </div>
          <p class="hint" data-preset-help>${esc(PRESETS[preset].help)}</p>
          <div class="endpoints">${endpoints}</div>
          <div class="field" data-token-row style="margin-top:12px"><label for="sn-token">Access token</label>
            <input class="input mono" id="sn-token" name="token" type="password" value="${esc(cfg.token || '')}" autocomplete="off" spellcheck="false" placeholder="Bearer token (optional for generic JSON)">
            <p class="hint">Stored only in this browser. Never included in exports.</p></div>
          <div class="test-row">
            <button type="button" class="btn" data-action="test-http">Test connection</button>
            <span class="test-result" data-test-result aria-live="polite"></span>
          </div>
        </div>

        <div data-when="demo" class="when-block">
          <fieldset class="field"><legend>Simulates</legend>
            <div class="radios">
              <input type="radio" id="sd-climate" name="profile" value="climate"${cfg.profile !== 'air' ? ' checked' : ''}><label for="sd-climate">Temperature + humidity</label>
              <input type="radio" id="sd-air" name="profile" value="air"${cfg.profile === 'air' ? ' checked' : ''}><label for="sd-air">CO₂</label>
            </div>
          </fieldset>
        </div>

        <div class="form-grid" style="margin-top:16px">
          <div class="field" data-when="ble http demo"><label for="sn-int">Read every<span class="unit">seconds</span></label>
            <input class="input mono" id="sn-int" name="intervalSec" type="number" min="10" max="3600" step="1" inputmode="numeric" value="${esc(s.intervalSec)}"></div>
        </div>

        <fieldset class="field" style="margin-top:16px"><legend>Calibration offset</legend>
          <div class="offsets">${offsets}</div>
          <p class="hint">Added to every reading. Compare against a reference meter: if the sensor reads 0.5° high, enter −0.5.</p>
        </fieldset>

        <p class="form-error" data-error role="alert"></p>
        <div class="dlg-actions">
          <button type="button" class="btn" data-action="close-dialog">Cancel</button>
          <button type="submit" class="btn btn-primary">${isEdit ? 'Save sensor' : 'Add sensor'}</button>
        </div>
      </div>
    </form>`;
  }

  /* Show only the parts of the sensor form that apply to the chosen connection. */
  function syncSensorForm(form) {
    const kind = (form.querySelector('input[name="kind"]:checked') || form.querySelector('input[name="kind"]')).value;
    form.querySelectorAll('[data-when]').forEach((el) => { el.hidden = !el.dataset.when.split(' ').includes(kind); });
    const metrics = sensorMetrics(form, kind);
    form.querySelectorAll('[data-metric-row]').forEach((el) => { el.hidden = !metrics.includes(el.dataset.metricRow); });

    const presetSel = form.elements.preset;
    if (presetSel) {
      const p = PRESETS[presetSel.value];
      const help = form.querySelector('[data-preset-help]');
      if (help) help.textContent = p.help;
      const tokenRow = form.querySelector('[data-token-row]');
      if (tokenRow) tokenRow.hidden = !p.token;
      E.SENSOR_METRICS.forEach((k) => {
        const url = form.elements[`url-${k}`];
        const path = form.elements[`path-${k}`];
        if (url) url.placeholder = p.url(k);
        // Swap the default path when the preset changes, unless the user typed their own.
        if (path && (path.dataset.auto !== 'false')) {
          if (path.value === '' || Object.values(PRESETS).some((x) => x.path === path.value)) path.value = p.path;
        }
      });
    }
  }

  function sensorMetrics(form, kind) {
    if (kind === 'ble') return ['temp', 'humidity'];
    if (kind === 'demo') {
      const prof = form.querySelector('input[name="profile"]:checked');
      return prof && prof.value === 'air' ? ['co2'] : ['temp', 'humidity'];
    }
    return Array.from(form.querySelectorAll('input[name="metrics"]:checked')).map((i) => i.value);
  }

  function readSensorForm(form) {
    const u = unit();
    const kind = (form.querySelector('input[name="kind"]:checked') || form.querySelector('input[name="kind"]')).value;
    const metrics = sensorMetrics(form, kind);
    const errors = [];
    const name = form.elements.name.value.trim();
    const intervalSec = Number(form.elements.intervalSec.value) || 60;
    if (!metrics.length) errors.push('Choose at least one measurement.');
    if (kind !== 'manual' && (intervalSec < 10 || intervalSec > 3600)) errors.push('Read interval must be 10–3600 seconds.');

    const offsets = {};
    metrics.forEach((k) => {
      const raw = form.elements[`off-${k}`].value.trim();
      if (raw === '') return;
      const n = Number(raw);
      if (!Number.isFinite(n) || Math.abs(n) > 50) { errors.push(`${E.METRICS[k].label} offset looks wrong.`); return; }
      offsets[k] = k === 'temp' && u === 'F' ? (n * 5) / 9 : n;
    });

    let config = {};
    if (kind === 'demo') config = { profile: metrics.includes('co2') ? 'air' : 'climate' };
    if (kind === 'ble') {
      config = { deviceId: form.elements.deviceId.value, deviceName: form.elements.deviceName.value };
      if (!config.deviceId) errors.push('Pair a Bluetooth device first.');
    }
    if (kind === 'http') {
      const endpoints = {};
      metrics.forEach((k) => {
        const url = form.elements[`url-${k}`].value.trim();
        if (!url) { errors.push(`Add a URL for ${E.METRICS[k].label.toLowerCase()}.`); return; }
        if (!/^https?:\/\/[^\s]+$/i.test(url)) { errors.push(`${E.METRICS[k].label} URL must start with https://`); return; }
        endpoints[k] = { url, path: form.elements[`path-${k}`].value.trim() };
      });
      config = { preset: form.elements.preset.value, tempUnit: form.elements.tempUnit.value, token: form.elements.token.value.trim(), endpoints };
    }

    const fallback = kind === 'ble' && config.deviceName ? config.deviceName : `${KIND[kind].label} sensor`;
    return {
      fields: { name: name || fallback, kind, spaceId: form.elements.spaceId.value || null, metrics, intervalSec, offsets, config },
      errors,
    };
  }

  function manualForm(sensor) {
    const u = unit();
    const last = ES.latest(sensor.id);
    const fields = sensor.metrics.map((k) => {
      const prev = last && last.v[k] != null ? E.fmtValue(k, last.v[k], u, false).replace(U.MINUS, '-') : '';
      return `<div class="field"><label for="mr-${k}">${esc(E.METRICS[k].label)}<span class="unit">${esc(E.unitLabel(k, u))}</span></label>
        <input class="input mono" id="mr-${k}" name="v-${k}" type="number" step="0.1" inputmode="decimal" placeholder="${esc(prev ? `last ${prev}` : '')}"></div>`;
    }).join('');
    return `<form data-form="manual" data-id="${esc(sensor.id)}" novalidate>
      ${head(`Log reading · <span class="mono" style="letter-spacing:0">${esc(sensor.id)}</span>`, esc(sensor.name))}
      <div class="dlg-body">
        <div class="form-grid">
          <div class="field span-2"><label for="mr-at">Taken at</label>
            <input class="input mono" id="mr-at" name="at" type="datetime-local" value="${localInput(Date.now())}" max="${localInput(Date.now())}"></div>
          ${fields}
        </div>
        <p class="hint">Calibration offsets for this sensor are applied on save.</p>
        <p class="form-error" data-error role="alert"></p>
        <div class="dlg-actions">
          <button type="button" class="btn" data-action="close-dialog">Cancel</button>
          <button type="submit" class="btn btn-primary">Save reading</button>
        </div>
      </div>
    </form>`;
  }

  function readManualForm(form, sensor) {
    const u = unit();
    const errors = [];
    const at = new Date(form.elements.at.value).getTime();
    if (!Number.isFinite(at)) errors.push('Enter when the reading was taken.');
    else if (at > Date.now() + MIN) errors.push('The reading can’t be in the future.');
    else if (at < Date.now() - 14 * U.DAY_MS) errors.push('Readings older than 14 days are not kept.');
    const values = {};
    sensor.metrics.forEach((k) => {
      const raw = form.elements[`v-${k}`].value.trim();
      if (raw === '') return;
      const n = Number(raw);
      if (!Number.isFinite(n)) { errors.push(`${E.METRICS[k].label} must be a number.`); return; }
      values[k] = E.fromDisplay(k, n, u);
      if (k === 'humidity' && (n < 0 || n > 100)) errors.push('Humidity must be 0–100%.');
      if ((k === 'co2' || k === 'nh3') && n < 0) errors.push(`${E.METRICS[k].label} can’t be negative.`);
    });
    if (!Object.keys(values).length) errors.push('Enter at least one value.');
    return { at, values, errors };
  }

  function needsForm(subject) {
    const u = unit();
    const profile = E.profileFor(subject.species);
    const ov = ES.needsOf(subject.id) || {};
    const spaces = ES.spaces();
    const cur = ES.spaceOf(subject.id);
    const keys = E.ORDER.filter((k) => profile[k] || ov[k] || (k !== 'thi'));

    const rows = keys.map((k) => {
      const m = E.METRICS[k];
      const base = profile[k] || {};
      const o = ov[k] || {};
      const shown = (v) => (v == null ? '' : String(Math.round(E.toDisplay(k, v, u) * 10) / 10));
      const ph = (v) => (v == null ? '—' : shown(v));
      const fields = m.type === 'ceiling' ? ['watch', 'max'] : ['min', 'max'];
      const labels = m.type === 'ceiling' ? ['Watch at', 'Limit'] : ['Min', 'Max'];
      return `<div class="needs-row">
        <div class="needs-metric"><span>${esc(m.label)}</span><span class="sub mono">${esc(E.unitLabel(k, u) || 'index')} · preset ${esc(needText(k, profile[k], u) || 'none')}</span></div>
        ${fields.map((f, i) => `<div class="field"><label for="nd-${k}-${f}">${labels[i]}</label>
          <input class="input mono" id="nd-${k}-${f}" name="${k}-${f}" type="number" step="0.1" inputmode="decimal" value="${esc(shown(o[f]))}" placeholder="${esc(ph(base[f]))}"></div>`).join('')}
      </div>`;
    }).join('');

    return `<form data-form="needs" data-id="${esc(subject.id)}" novalidate>
      ${head(`Space &amp; needs · <span class="mono" style="letter-spacing:0">${esc(subject.id)}</span>`, esc(subject.name))}
      <div class="dlg-body">
        <div class="field"><label for="nd-space">Lives in</label>
          <select class="input" id="nd-space" name="spaceId">
            <option value="">No space</option>
            ${spaces.map((sp) => `<option value="${esc(sp.id)}"${cur === sp.id ? ' selected' : ''}>${esc(sp.name)}</option>`).join('')}
          </select></div>
        <p class="env-preset" style="margin-top:14px"><span class="mono">${esc(profile.label)}</span> preset · ${esc(profile.source)}<br><span class="muted">${esc(profile.note)}</span></p>
        <div class="needs">${rows}</div>
        <div class="field" style="margin-top:12px"><label for="nd-note">Reason for overrides</label>
          <input class="input" id="nd-note" name="note" maxlength="140" value="${esc(ov.note || '')}" placeholder="e.g. Heavy coat, senior, post-surgery, vet advice"></div>
        <p class="hint">Leave a field empty to use the preset. Overrides apply to this animal only.</p>
        <p class="form-error" data-error role="alert"></p>
        <div class="dlg-actions">
          <button type="button" class="btn btn-quiet dlg-left" data-action="clear-needs">Clear overrides</button>
          <button type="button" class="btn" data-action="close-dialog">Cancel</button>
          <button type="submit" class="btn btn-primary">Save</button>
        </div>
      </div>
    </form>`;
  }

  function readNeedsForm(form) {
    const u = unit();
    const errors = [];
    const needs = {};
    E.ORDER.forEach((k) => {
      const m = E.METRICS[k];
      const fields = m.type === 'ceiling' ? ['watch', 'max'] : ['min', 'max'];
      const r = {};
      fields.forEach((f) => {
        const el = form.elements[`${k}-${f}`];
        if (!el || el.value.trim() === '') return;
        const n = Number(el.value);
        if (!Number.isFinite(n)) { errors.push(`${m.label} ${f} must be a number.`); return; }
        r[f] = E.fromDisplay(k, n, u);
      });
      if (r.min != null && r.max != null && r.min >= r.max) errors.push(`${m.label}: min must be below max.`);
      if (r.watch != null && r.max != null && r.watch >= r.max) errors.push(`${m.label}: watch must be below the limit.`);
      if (Object.keys(r).length) needs[k] = r;
    });
    const note = form.elements.note.value.trim();
    if (note) needs.note = note;
    return { spaceId: form.elements.spaceId.value || null, needs, errors };
  }

  H.envViews = {
    envPage, subjectPanel, overviewSummary, live, sensorTally,
    spaceForm, readSpaceForm, sensorForm, syncSensorForm, readSensorForm, manualForm, readManualForm, needsForm, readNeedsForm,
    mountCharts, KIND, PRESETS,
  };
})(window.Herd = window.Herd || {});
