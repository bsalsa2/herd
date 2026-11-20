/* Herd · environment persistence
   Spaces, sensors, residency, per-animal needs, and sensor readings live in a
   separate localStorage key from the animal records. Sensor writes are
   frequent; keeping them apart means a full quota can never corrupt records.

   Readings are bucketed to 5 minutes (the latest value in a bucket wins,
   metrics merge) and kept for 14 days: roughly 200 KB per sensor. */
(function (H) {
  'use strict';

  const U = H.util;
  const KEY = 'herd:env:v1';
  const MIN = 60000;
  const BUCKET_MS = 5 * MIN;
  const RETAIN_MS = 14 * U.DAY_MS;
  const METRIC_KEYS = ['temp', 'humidity', 'co2', 'nh3'];
  const KINDS = ['demo', 'manual', 'ble', 'http'];

  let data = null;
  let persistent = true;
  let writeTimer = 0;
  let addsSincePrune = 0;

  const emptyState = () => ({
    version: 1,
    prefs: { unit: 'C' },
    meta: { nextSensor: 1, nextSpace: 1 },
    spaces: [],
    residency: {},
    needs: {},
    sensors: [],
    readings: {},
  });

  const fmtSensorId = (n) => 'SNS-' + String(n).padStart(4, '0');
  const fmtSpaceId = (n) => 'SPC-' + String(n).padStart(4, '0');
  const seq = (id) => parseInt(String(id).slice(4), 10) || 0;
  const round1 = (v) => Math.round(v * 10) / 10;

  /* ---------- Validation ------------------------------------------------- */

  function cleanRange(r, sane) {
    if (!r || typeof r !== 'object') return null;
    const out = {};
    ['min', 'max', 'watch'].forEach((k) => {
      const v = r[k];
      if (v === null || v === undefined || v === '') return;
      const n = Number(v);
      if (Number.isFinite(n) && n >= sane[0] && n <= sane[1]) out[k] = round1(n);
    });
    return Object.keys(out).length ? out : null;
  }

  const SANE = { temp: [-60, 80], humidity: [0, 100], co2: [0, 50000], nh3: [0, 1000], thi: [0, 120] };

  function cleanNeeds(n) {
    if (!n || typeof n !== 'object') return null;
    const out = {};
    Object.keys(SANE).forEach((k) => {
      const r = cleanRange(n[k], SANE[k]);
      if (r) out[k] = r;
    });
    if (typeof n.note === 'string' && n.note.trim()) out.note = n.note.trim().slice(0, 140);
    return Object.keys(out).length ? out : null;
  }

  function cleanValues(v) {
    if (!v || typeof v !== 'object') return null;
    const out = {};
    METRIC_KEYS.forEach((k) => {
      const n = Number(v[k]);
      if (v[k] !== null && v[k] !== undefined && v[k] !== '' && Number.isFinite(n)) out[k] = round1(n);
    });
    return Object.keys(out).length ? out : null;
  }

  function cleanConfig(kind, c) {
    const cfg = c && typeof c === 'object' ? c : {};
    if (kind === 'demo') return { profile: cfg.profile === 'air' ? 'air' : 'climate' };
    if (kind === 'ble') {
      return {
        deviceId: typeof cfg.deviceId === 'string' ? cfg.deviceId.slice(0, 200) : '',
        deviceName: U.cleanStr(cfg.deviceName, 80),
      };
    }
    if (kind === 'http') {
      const endpoints = {};
      METRIC_KEYS.forEach((k) => {
        const e = cfg.endpoints && cfg.endpoints[k];
        if (e && typeof e.url === 'string' && /^https?:\/\//i.test(e.url.trim())) {
          endpoints[k] = { url: e.url.trim().slice(0, 500), path: U.cleanStr(e.path, 120) };
        }
      });
      return {
        preset: ['ha', 'esphome', 'json'].includes(cfg.preset) ? cfg.preset : 'json',
        tempUnit: cfg.tempUnit === 'F' ? 'F' : 'C',
        token: typeof cfg.token === 'string' ? cfg.token.trim().slice(0, 600) : '',
        endpoints,
      };
    }
    return {};
  }

  function validate(obj) {
    if (!obj || typeof obj !== 'object' || !Array.isArray(obj.spaces) || !Array.isArray(obj.sensors)) {
      return { ok: false, error: 'Environment section is malformed.' };
    }
    const d = emptyState();
    let dropped = 0;
    d.prefs.unit = obj.prefs && obj.prefs.unit === 'F' ? 'F' : 'C';

    const spaceIds = new Set();
    obj.spaces.forEach((s) => {
      if (!s || typeof s.id !== 'string' || !/^SPC-\d{4,}$/.test(s.id) || spaceIds.has(s.id)) { dropped++; return; }
      spaceIds.add(s.id);
      d.spaces.push({ id: s.id, name: U.cleanStr(s.name, 60) || s.id });
    });

    if (obj.residency && typeof obj.residency === 'object') {
      Object.keys(obj.residency).forEach((sub) => {
        if (/^HRD-\d{4,}$/.test(sub) && spaceIds.has(obj.residency[sub])) d.residency[sub] = obj.residency[sub];
      });
    }
    if (obj.needs && typeof obj.needs === 'object') {
      Object.keys(obj.needs).forEach((sub) => {
        const n = /^HRD-\d{4,}$/.test(sub) ? cleanNeeds(obj.needs[sub]) : null;
        if (n) d.needs[sub] = n;
      });
    }

    const sensorIds = new Set();
    obj.sensors.forEach((s) => {
      if (!s || typeof s.id !== 'string' || !/^SNS-\d{4,}$/.test(s.id) || sensorIds.has(s.id) || !KINDS.includes(s.kind)) { dropped++; return; }
      sensorIds.add(s.id);
      const metrics = Array.isArray(s.metrics) ? s.metrics.filter((m) => METRIC_KEYS.includes(m)) : [];
      const offsets = {};
      METRIC_KEYS.forEach((k) => {
        const n = Number(s.offsets && s.offsets[k]);
        if (Number.isFinite(n) && n !== 0 && Math.abs(n) <= 100) offsets[k] = round1(n);
      });
      d.sensors.push({
        id: s.id,
        name: U.cleanStr(s.name, 60) || s.id,
        kind: s.kind,
        spaceId: spaceIds.has(s.spaceId) ? s.spaceId : null,
        metrics: metrics.length ? Array.from(new Set(metrics)) : ['temp'],
        intervalSec: Math.min(3600, Math.max(10, Math.round(Number(s.intervalSec) || 60))),
        enabled: s.enabled !== false,
        offsets,
        config: cleanConfig(s.kind, s.config),
        createdAt: typeof s.createdAt === 'string' ? s.createdAt : new Date().toISOString(),
      });
    });

    const cutoff = Date.now() - RETAIN_MS;
    if (obj.readings && typeof obj.readings === 'object') {
      Object.keys(obj.readings).forEach((sid) => {
        if (!sensorIds.has(sid) || !Array.isArray(obj.readings[sid])) return;
        const list = [];
        obj.readings[sid].forEach((r) => {
          const t = Number(r && r.t);
          const v = cleanValues(r && r.v);
          if (!Number.isFinite(t) || t < cutoff || t > Date.now() + 5 * MIN || !v) return;
          list.push({ t, v });
        });
        list.sort((a, b) => a.t - b.t);
        if (list.length) d.readings[sid] = list;
      });
    }

    d.meta.nextSpace = Math.max(Number(obj.meta && obj.meta.nextSpace) || 1, ...d.spaces.map((s) => seq(s.id) + 1), 1);
    d.meta.nextSensor = Math.max(Number(obj.meta && obj.meta.nextSensor) || 1, ...d.sensors.map((s) => seq(s.id) + 1), 1);
    return { ok: true, data: d, dropped };
  }

  /* ---------- Persistence ------------------------------------------------ */

  function writeNow() {
    clearTimeout(writeTimer);
    writeTimer = 0;
    const payload = JSON.stringify(data);
    try {
      localStorage.setItem(KEY, payload);
      persistent = true;
      return;
    } catch (err) {
      // Quota: shed the oldest week of readings, then try once more.
      prune(Date.now() - 7 * U.DAY_MS);
      try {
        localStorage.setItem(KEY, JSON.stringify(data));
        persistent = true;
      } catch (err2) {
        persistent = false;
      }
    }
  }

  /* Config changes save immediately; readings save at most every 5 s. */
  function scheduleWrite() {
    if (writeTimer) return;
    writeTimer = setTimeout(writeNow, 5000);
  }

  function flush() {
    if (writeTimer) writeNow();
  }

  function prune(cutoff) {
    const c = cutoff || Date.now() - RETAIN_MS;
    Object.keys(data.readings).forEach((sid) => {
      const list = data.readings[sid];
      let i = 0;
      while (i < list.length && list[i].t < c) i++;
      if (i) list.splice(0, i);
    });
  }

  function seed() {
    const d = emptyState();
    const now = new Date().toISOString();
    d.spaces.push({ id: 'SPC-0001', name: 'Living room' });
    d.residency = { 'HRD-0001': 'SPC-0001', 'HRD-0002': 'SPC-0001' };
    d.needs = { 'HRD-0001': { temp: { max: 24 }, note: 'Heavy double coat: upper limit lowered' } };
    d.sensors.push(
      { id: 'SNS-0001', name: 'Living room climate', kind: 'demo', spaceId: 'SPC-0001', metrics: ['temp', 'humidity'], intervalSec: 60, enabled: true, offsets: {}, config: { profile: 'climate' }, createdAt: now },
      { id: 'SNS-0002', name: 'Living room air', kind: 'demo', spaceId: 'SPC-0001', metrics: ['co2'], intervalSec: 60, enabled: true, offsets: {}, config: { profile: 'air' }, createdAt: now },
    );
    d.meta = { nextSensor: 3, nextSpace: 2 };
    return d;
  }

  function load() {
    let raw = null;
    try { raw = localStorage.getItem(KEY); } catch (err) { persistent = false; }
    if (raw) {
      try {
        const res = validate(JSON.parse(raw));
        if (res.ok) { data = res.data; prune(); return; }
      } catch (err) { /* fall through */ }
      try { localStorage.setItem(KEY + ':unreadable:' + Date.now(), raw); } catch (err) { /* ignore */ }
    }
    data = seed();
    writeNow();
  }

  /* ---------- API -------------------------------------------------------- */

  H.envStore = {
    KEY, BUCKET_MS, METRIC_KEYS,
    load, flush, validate,
    isPersistent: () => persistent,

    unit: () => data.prefs.unit,
    setUnit(u) { data.prefs.unit = u === 'F' ? 'F' : 'C'; writeNow(); },

    /* Spaces */
    spaces: () => data.spaces.slice().sort((a, b) => seq(a.id) - seq(b.id)),
    space: (id) => data.spaces.find((s) => s.id === id) || null,
    createSpace(name) {
      const s = { id: fmtSpaceId(data.meta.nextSpace), name: U.cleanStr(name, 60) || 'Untitled space' };
      data.meta.nextSpace += 1;
      data.spaces.push(s);
      writeNow();
      return s;
    },
    renameSpace(id, name) {
      const s = this.space(id);
      if (s) { s.name = U.cleanStr(name, 60) || s.name; writeNow(); }
    },
    deleteSpace(id) {
      data.spaces = data.spaces.filter((s) => s.id !== id);
      Object.keys(data.residency).forEach((k) => { if (data.residency[k] === id) delete data.residency[k]; });
      data.sensors.forEach((s) => { if (s.spaceId === id) s.spaceId = null; });
      writeNow();
    },

    /* Residency: which space each animal lives in */
    spaceOf: (subjectId) => data.residency[subjectId] || null,
    residentsOf: (spaceId) => Object.keys(data.residency).filter((k) => data.residency[k] === spaceId).sort(),
    setResidents(spaceId, subjectIds) {
      Object.keys(data.residency).forEach((k) => { if (data.residency[k] === spaceId) delete data.residency[k]; });
      subjectIds.forEach((sid) => { data.residency[sid] = spaceId; });
      writeNow();
    },
    setSpaceOf(subjectId, spaceId) {
      if (spaceId && this.space(spaceId)) data.residency[subjectId] = spaceId;
      else delete data.residency[subjectId];
      writeNow();
    },

    /* Per-animal overrides of the species preset */
    needsOf: (subjectId) => data.needs[subjectId] || null,
    setNeeds(subjectId, needs) {
      const n = cleanNeeds(needs);
      if (n) data.needs[subjectId] = n;
      else delete data.needs[subjectId];
      writeNow();
    },
    forgetSubject(subjectId) {
      delete data.residency[subjectId];
      delete data.needs[subjectId];
      writeNow();
    },

    /* Sensors */
    sensors: () => data.sensors.slice().sort((a, b) => seq(a.id) - seq(b.id)),
    sensor: (id) => data.sensors.find((s) => s.id === id) || null,
    sensorsIn: (spaceId) => data.sensors.filter((s) => s.spaceId === spaceId),
    peekSensorId: () => fmtSensorId(data.meta.nextSensor),
    createSensor(f) {
      const res = validate({ spaces: data.spaces, sensors: [Object.assign({}, f, { id: fmtSensorId(data.meta.nextSensor), createdAt: new Date().toISOString() })] });
      const s = res.data.sensors[0];
      if (!s) return null;
      data.meta.nextSensor += 1;
      data.sensors.push(s);
      writeNow();
      return s;
    },
    updateSensor(id, f) {
      const i = data.sensors.findIndex((s) => s.id === id);
      if (i < 0) return null;
      const merged = Object.assign({}, data.sensors[i], f);
      const res = validate({ spaces: data.spaces, sensors: [merged] });
      if (!res.data.sensors[0]) return null;
      data.sensors[i] = res.data.sensors[0];
      writeNow();
      return data.sensors[i];
    },
    setEnabled(id, on) {
      const s = this.sensor(id);
      if (s) { s.enabled = Boolean(on); writeNow(); }
    },
    deleteSensor(id) {
      data.sensors = data.sensors.filter((s) => s.id !== id);
      delete data.readings[id];
      writeNow();
    },

    /* Readings. Values arrive raw in °C; calibration offsets apply here. */
    addReading(sensorId, rawValues, at) {
      const s = this.sensor(sensorId);
      const v = cleanValues(rawValues);
      if (!s || !v) return null;
      Object.keys(v).forEach((k) => { if (s.offsets[k]) v[k] = round1(v[k] + s.offsets[k]); });
      if (v.humidity != null) v.humidity = Math.max(0, Math.min(100, v.humidity));
      const t = Math.min(at || Date.now(), Date.now());
      const list = data.readings[sensorId] || (data.readings[sensorId] = []);
      const bucket = Math.floor(t / BUCKET_MS);
      const last = list[list.length - 1];
      if (last && Math.floor(last.t / BUCKET_MS) === bucket) {
        last.t = Math.max(last.t, t);
        Object.assign(last.v, v);
      } else if (!last || t > last.t) {
        list.push({ t, v });
      } else {
        // Late or back-dated reading (manual entry): insert in order.
        const idx = list.findIndex((r) => r.t > t);
        const prev = list[idx - 1];
        if (prev && Math.floor(prev.t / BUCKET_MS) === bucket) Object.assign(prev.v, v);
        else list.splice(idx, 0, { t, v });
      }
      if (++addsSincePrune > 200) { addsSincePrune = 0; prune(); }
      scheduleWrite();
      return v;
    },
    readings(sensorId, since) {
      const list = data.readings[sensorId] || [];
      if (!since) return list;
      let i = list.length;
      while (i > 0 && list[i - 1].t >= since) i--;
      return list.slice(i);
    },
    latest(sensorId, metric) {
      const list = data.readings[sensorId] || [];
      for (let i = list.length - 1; i >= 0; i--) {
        if (!metric || list[i].v[metric] != null) return list[i];
      }
      return null;
    },
    readingCount: (sensorId) => (data.readings[sensorId] || []).length,

    /* Export never includes access tokens. */
    exportPart() {
      flush();
      const copy = JSON.parse(JSON.stringify(data));
      copy.sensors.forEach((s) => { if (s.config && 'token' in s.config) s.config.token = ''; });
      return copy;
    },
    replace(validated) {
      // Keep tokens for sensors that survive the import, so a restore doesn't break live connections.
      const tokens = {};
      data.sensors.forEach((s) => { if (s.config && s.config.token) tokens[s.id] = s.config.token; });
      data = validated;
      data.sensors.forEach((s) => { if (s.kind === 'http' && !s.config.token && tokens[s.id]) s.config.token = tokens[s.id]; });
      writeNow();
    },
    resetToSample() {
      data = seed();
      writeNow();
    },
  };
})(window.Herd = window.Herd || {});
