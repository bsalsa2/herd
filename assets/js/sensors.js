/* Herd · sensor runtime
   Herd is a static page, so the browser itself talks to the sensors:

     demo    Simulated sensors with a realistic daily cycle (no hardware).
     manual  Readings typed in from any thermometer or hygrometer.
     http    Polls a JSON URL: Home Assistant, ESPHome, or any device/hub
             that serves JSON over HTTPS with CORS enabled.
     ble     Web Bluetooth, Environmental Sensing Service (0x181A).
             Chrome and Edge on desktop and Android. Not Safari or iOS.

   Sensors run only while Herd is open in a tab. */
(function (H) {
  'use strict';

  const ES = H.envStore;
  const MIN = 60000;
  const HOUR = 60 * MIN;
  const BUCKET = 5 * MIN;

  const ESS = 0x181a;          // Environmental Sensing service
  const BATTERY = 0x180f;
  const CH_TEMP = 0x2a6e;      // sint16, 0.01 °C
  const CH_TEMP_LEGACY = 0x2a1f; // sint16, 0.1 °C (some custom firmwares)
  const CH_HUM = 0x2a6f;       // uint16, 0.01 %
  const CH_BATT = 0x2a19;      // uint8, %

  const rt = new Map();        // sensorId -> runtime state
  const listeners = new Set();
  let pendingDevice = null;    // a paired BLE device waiting for its sensor to be saved

  function state(id) {
    if (!rt.has(id)) rt.set(id, { timer: 0, state: 'idle', message: '', battery: null, device: null, chars: null, retries: 0 });
    return rt.get(id);
  }

  let emitQueued = false;
  function emit() {
    if (emitQueued) return;
    emitQueued = true;
    Promise.resolve().then(() => { emitQueued = false; listeners.forEach((fn) => fn()); });
  }

  function setState(id, st, message) {
    const r = state(id);
    r.state = st;
    r.message = message || '';
    emit();
  }

  function record(sensor, values, at) {
    const v = ES.addReading(sensor.id, values, at);
    if (v) {
      const r = state(sensor.id);
      r.lastAt = Date.now();
      if (r.state !== 'live') { r.state = 'live'; r.message = ''; }
      emit();
    }
    return v;
  }

  /* ---------- Simulated -------------------------------------------------- */

  // Deterministic noise from a time bucket, so a reload continues the same curve.
  function noise(t, salt) {
    let x = Math.floor(t / BUCKET) * 374761393 + salt * 668265263;
    x = (x ^ (x >>> 13)) * 1274126177;
    x ^= x >>> 16;
    return ((x >>> 0) % 2000) / 1000 - 1;
  }

  function simulate(profile, t) {
    const d = new Date(t);
    const h = d.getHours() + d.getMinutes() / 60;
    const day = Math.floor(t / H.util.DAY_MS);
    const daily = Math.sin((2 * Math.PI * (h - 9)) / 24);  // peaks mid-afternoon
    const dayDrift = noise(day * H.util.DAY_MS, 7) * 0.5;
    if (profile === 'air') {
      const evening = Math.exp(-Math.pow(h - 20, 2) / 8);
      const morning = Math.exp(-Math.pow(h - 7.5, 2) / 3) * 0.5;
      return { co2: Math.round(610 + 520 * evening + 300 * morning + 35 * noise(t, 3)) };
    }
    return {
      temp: 22.5 + 2.3 * daily + dayDrift + 0.2 * noise(t, 1),
      humidity: 50 - 7 * daily - dayDrift * 3 + 1.2 * noise(t, 2),
    };
  }

  // Fill any gap since the last stored reading (up to 48 h) so charts stay continuous.
  function backfill(sensor) {
    const now = Date.now();
    const last = ES.latest(sensor.id);
    let t = last ? Math.floor(last.t / BUCKET) * BUCKET + BUCKET : Math.floor((now - 48 * HOUR) / BUCKET) * BUCKET;
    t = Math.max(t, now - 48 * HOUR);
    for (; t < now - BUCKET; t += BUCKET) ES.addReading(sensor.id, simulate(sensor.config.profile, t), t);
  }

  function startDemo(sensor) {
    backfill(sensor);
    const tick = () => record(sensor, simulate(sensor.config.profile, Date.now()));
    tick();
    state(sensor.id).timer = setInterval(tick, sensor.intervalSec * 1000);
  }

  /* ---------- HTTP / JSON ------------------------------------------------ */

  function getPath(obj, path) {
    if (!path) return obj;
    return String(path).replace(/\[(\d+)\]/g, '.$1').split('.').filter(Boolean)
      .reduce((o, k) => (o == null ? undefined : o[k]), obj);
  }

  function toNumber(v) {
    if (typeof v === 'number') return v;
    if (typeof v === 'string') { const n = parseFloat(v); return Number.isFinite(n) ? n : NaN; }
    return NaN;
  }

  function explainFetch(err, url) {
    if (location.protocol === 'https:' && /^http:\/\//i.test(url)) {
      return 'Blocked: Herd is on https but the device is http (mixed content). Open Herd from your own computer, or use an https hub such as Home Assistant.';
    }
    if (err && err.name === 'AbortError') return 'No response within 8 s. Check the address and that the device is on.';
    if (err instanceof TypeError) return `Network or CORS error. The device must allow requests from ${location.origin}.`;
    return (err && err.message) || 'Request failed.';
  }

  async function fetchJson(url, token) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8000);
    try {
      const headers = { Accept: 'application/json' };
      if (token) headers.Authorization = `Bearer ${token}`;
      const res = await fetch(url, { headers, cache: 'no-store', signal: ctrl.signal });
      if (!res.ok) {
        const hint = res.status === 401 || res.status === 403 ? ' Check the access token.' : res.status === 404 ? ' Check the URL or entity ID.' : '';
        throw new Error(`HTTP ${res.status}.${hint}`);
      }
      try { return await res.json(); } catch (e) { throw new Error('The response is not JSON.'); }
    } catch (err) {
      if (err.message && /^HTTP \d|not JSON/.test(err.message)) throw err;
      throw new Error(explainFetch(err, url));
    } finally {
      clearTimeout(timer);
    }
  }

  /* Poll each distinct URL once, then pull every metric from its JSON path.
     Shared by the live poller and the "Test connection" button. */
  async function readHttp(config) {
    const byUrl = {};
    Object.keys(config.endpoints || {}).forEach((k) => {
      const e = config.endpoints[k];
      (byUrl[e.url] = byUrl[e.url] || []).push(k);
    });
    const values = {};
    const problems = [];
    for (const url of Object.keys(byUrl)) {
      const json = await fetchJson(url, config.token);
      byUrl[url].forEach((k) => {
        const path = config.endpoints[k].path;
        const n = toNumber(getPath(json, path));
        if (Number.isFinite(n)) values[k] = n;
        else problems.push(`${H.env.METRICS[k].label}: no number at "${path || '(root)'}"`);
      });
    }
    if (!Object.keys(values).length) throw new Error(problems.join('; ') || 'No values found.');
    return { values, problems };
  }

  /* Home Assistant reports °F entities in °F; Herd stores °C. */
  function normalizeUnits(sensor, values) {
    if (values.temp != null && sensor.config.tempUnit === 'F') values.temp = H.env.fToC(values.temp);
    return values;
  }

  function startHttp(sensor) {
    const poll = async () => {
      const s = ES.sensor(sensor.id);
      if (!s || !s.enabled) return;
      try {
        const { values, problems } = await readHttp(s.config);
        record(s, normalizeUnits(s, values));
        if (problems.length) setState(s.id, 'live', problems.join('; '));
      } catch (err) {
        setState(s.id, 'error', err.message);
      }
    };
    setState(sensor.id, 'connecting');
    poll();
    state(sensor.id).timer = setInterval(poll, sensor.intervalSec * 1000);
  }

  /* ---------- Bluetooth -------------------------------------------------- */

  const bleSupported = () => typeof navigator !== 'undefined' && Boolean(navigator.bluetooth);

  async function pairBle() {
    if (!bleSupported()) {
      throw new Error('This browser has no Web Bluetooth. Use Chrome or Edge on a computer or Android phone (Safari and iOS do not support it).');
    }
    const device = await navigator.bluetooth.requestDevice({
      filters: [{ services: [ESS] }, { namePrefix: 'ATC' }, { namePrefix: 'LYWSD' }, { namePrefix: 'ESP' }],
      optionalServices: [ESS, BATTERY],
    });
    pendingDevice = device;
    return { id: device.id, name: device.name || 'Bluetooth sensor' };
  }

  function takePendingDevice(deviceId) {
    if (pendingDevice && pendingDevice.id === deviceId) {
      const d = pendingDevice;
      pendingDevice = null;
      return d;
    }
    return null;
  }

  function parseChar(kind, dv, scale) {
    if (kind === 'temp') return dv.getInt16(0, true) * scale;
    if (kind === 'humidity') return dv.getUint16(0, true) * 0.01;
    return dv.getUint8(0);
  }

  async function connectBle(sensor, device) {
    const r = state(sensor.id);
    r.device = device;
    setState(sensor.id, 'connecting');
    if (!device.__herdBound) {
      device.__herdBound = true;
      device.addEventListener('gattserverdisconnected', () => onBleDisconnect(sensor.id));
    }
    const server = await device.gatt.connect();
    const svc = await server.getPrimaryService(ESS);
    const chars = {};
    try { chars.temp = await svc.getCharacteristic(CH_TEMP); chars.tempScale = 0.01; } catch (e) {
      try { chars.temp = await svc.getCharacteristic(CH_TEMP_LEGACY); chars.tempScale = 0.1; } catch (e2) { /* none */ }
    }
    try { chars.humidity = await svc.getCharacteristic(CH_HUM); } catch (e) { /* none */ }
    if (!chars.temp && !chars.humidity) throw new Error('No temperature or humidity characteristic found (Environmental Sensing 0x181A).');
    try {
      const b = await (await server.getPrimaryService(BATTERY)).getCharacteristic(CH_BATT);
      r.battery = parseChar('battery', await b.readValue());
    } catch (e) { /* battery is optional */ }
    r.chars = chars;
    r.retries = 0;

    for (const k of ['temp', 'humidity']) {
      const c = chars[k];
      if (!c || !c.properties.notify) continue;
      c.addEventListener('characteristicvaluechanged', (ev) => {
        const s = ES.sensor(sensor.id);
        if (s && s.enabled) record(s, { [k]: parseChar(k, ev.target.value, chars.tempScale) });
      });
      try { await c.startNotifications(); } catch (e) { /* fall back to polling */ }
    }

    const poll = async () => {
      const s = ES.sensor(sensor.id);
      if (!s || !s.enabled || !device.gatt.connected) return;
      const values = {};
      for (const k of ['temp', 'humidity']) {
        if (!chars[k] || !chars[k].properties.read) continue;
        try { values[k] = parseChar(k, await chars[k].readValue(), chars.tempScale); } catch (e) { /* skip */ }
      }
      if (Object.keys(values).length) record(s, values);
    };
    await poll();
    clearInterval(r.timer);
    r.timer = setInterval(poll, sensor.intervalSec * 1000);
    if (r.state === 'connecting') setState(sensor.id, 'live', 'Connected, waiting for a reading');
  }

  function onBleDisconnect(id) {
    const s = ES.sensor(id);
    const r = state(id);
    clearInterval(r.timer);
    if (!s || !s.enabled) return;
    if (r.retries < 3 && r.device) {
      r.retries += 1;
      setState(id, 'connecting', `Connection lost. Retrying (${r.retries}/3)…`);
      setTimeout(() => connectBle(s, r.device).catch((err) => setState(id, 'offline', err.message)), 2000 * r.retries);
    } else {
      setState(id, 'offline', 'Out of range or switched off. Use Connect to pair again.');
    }
  }

  async function startBle(sensor) {
    const r = state(sensor.id);
    let device = r.device || takePendingDevice(sensor.config.deviceId);
    if (!device && bleSupported() && navigator.bluetooth.getDevices) {
      try {
        const known = await navigator.bluetooth.getDevices();
        device = known.find((d) => d.id === sensor.config.deviceId) || null;
      } catch (e) { /* permission backend not available */ }
    }
    if (!device) {
      setState(sensor.id, 'offline', bleSupported()
        ? 'Browsers require a click to reconnect Bluetooth after a reload. Use Connect.'
        : 'Bluetooth needs Chrome or Edge on a computer or Android.');
      return;
    }
    try {
      await connectBle(sensor, device);
    } catch (err) {
      setState(sensor.id, 'offline', err.message || 'Could not connect.');
    }
  }

  /* User-initiated (click): pick the device again and connect. */
  async function reconnectBle(id) {
    const s = ES.sensor(id);
    if (!s) return;
    const picked = await pairBle();
    const device = takePendingDevice(picked.id);
    if (picked.id !== s.config.deviceId) ES.updateSensor(id, { config: { deviceId: picked.id, deviceName: picked.name } });
    await connectBle(ES.sensor(id), device);
  }

  /* ---------- Lifecycle -------------------------------------------------- */

  function stop(id) {
    const r = rt.get(id);
    if (!r) return;
    clearInterval(r.timer);
    r.timer = 0;
    if (r.device && r.device.gatt && r.device.gatt.connected) {
      r.retries = 99; // a deliberate stop is not a dropout
      try { r.device.gatt.disconnect(); } catch (e) { /* ignore */ }
    }
  }

  function start(sensor) {
    stop(sensor.id);
    const r = state(sensor.id);
    r.retries = 0;
    if (!sensor.enabled) { setState(sensor.id, 'paused'); return; }
    if (sensor.kind === 'demo') { startDemo(sensor); return; }
    if (sensor.kind === 'http') { startHttp(sensor); return; }
    if (sensor.kind === 'ble') { startBle(sensor); return; }
    setState(sensor.id, 'manual');
  }

  /* Reconcile runtime with stored config: start new or changed, stop removed. */
  function sync() {
    const ids = new Set();
    ES.sensors().forEach((s) => {
      ids.add(s.id);
      const sig = JSON.stringify([s.kind, s.enabled, s.intervalSec, s.config, s.metrics]);
      const r = state(s.id);
      if (r.sig !== sig) { r.sig = sig; start(s); }
    });
    Array.from(rt.keys()).forEach((id) => { if (!ids.has(id)) { stop(id); rt.delete(id); } });
    emit();
  }

  function stopAll() {
    Array.from(rt.keys()).forEach(stop);
    rt.clear();
  }

  async function readNow(id) {
    const s = ES.sensor(id);
    if (!s) return;
    if (s.kind === 'demo') record(s, simulate(s.config.profile, Date.now()));
    else if (s.kind === 'http') {
      try { record(s, normalizeUnits(s, (await readHttp(s.config)).values)); } catch (err) { setState(id, 'error', err.message); throw err; }
    } else if (s.kind === 'ble') {
      const r = state(id);
      if (!r.device || !r.device.gatt.connected) throw new Error('Not connected.');
      const values = {};
      for (const k of ['temp', 'humidity']) {
        if (r.chars && r.chars[k]) values[k] = parseChar(k, await r.chars[k].readValue(), r.chars.tempScale);
      }
      record(s, values);
    }
  }

  /* Display status = runtime state + reading freshness. */
  function status(sensor) {
    const r = state(sensor.id);
    const last = ES.latest(sensor.id);
    const lastAt = last ? last.t : null;
    if (!sensor.enabled) return { key: 'paused', label: 'Paused', message: '', lastAt };
    if (sensor.kind === 'manual') {
      const fresh = lastAt && Date.now() - lastAt <= H.env.freshMs(sensor);
      return { key: fresh ? 'manual' : 'stale', label: fresh ? 'Manual' : 'Due', message: fresh ? '' : 'Log a new reading', lastAt };
    }
    if (r.state === 'error') return { key: 'error', label: 'Error', message: r.message, lastAt };
    if (r.state === 'offline') return { key: 'offline', label: 'Offline', message: r.message, lastAt };
    if (r.state === 'connecting' && !lastAt) return { key: 'connecting', label: 'Connecting', message: r.message, lastAt };
    if (lastAt && Date.now() - lastAt > H.env.freshMs(sensor)) return { key: 'stale', label: 'Stale', message: 'No recent reading', lastAt };
    if (!lastAt) return { key: 'connecting', label: 'Waiting', message: r.message, lastAt };
    return { key: 'live', label: 'Live', message: r.message, lastAt, battery: r.battery };
  }

  window.addEventListener('pagehide', () => ES.flush());
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') ES.flush(); });

  H.sensors = {
    sync, stop, stopAll, readNow, status, readHttp, normalizeUnits, pairBle, reconnectBle, bleSupported, simulate,
    onUpdate: (fn) => listeners.add(fn),
  };
})(window.Herd = window.Herd || {});
