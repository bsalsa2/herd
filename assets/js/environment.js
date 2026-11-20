/* Herd · environment logic
   Species presets → per-animal needs (preset + overrides) → space needs
   (the intersection across every resident) → evaluation of live readings.

   Presets are conservative starting points with their source shown in the UI.
   Breed, age, coat, acclimatization, and health shift real tolerances, so every
   limit can be overridden per animal. All temperatures are stored in °C. */
(function (H) {
  'use strict';

  const U = H.util;
  const MIN = 60000;

  const METRICS = {
    temp: { key: 'temp', label: 'Temperature', short: 'Temp', type: 'range', unit: '°C', digits: 1, margin: 1 },
    humidity: { key: 'humidity', label: 'Humidity', short: 'Humidity', type: 'range', unit: '%', digits: 0, margin: 5 },
    co2: { key: 'co2', label: 'CO₂', short: 'CO₂', type: 'ceiling', unit: 'ppm', digits: 0 },
    nh3: { key: 'nh3', label: 'Ammonia', short: 'NH₃', type: 'ceiling', unit: 'ppm', digits: 1 },
    thi: { key: 'thi', label: 'Heat stress (THI)', short: 'THI', type: 'ceiling', unit: '', digits: 0, derived: true },
  };
  const SENSOR_METRICS = ['temp', 'humidity', 'co2', 'nh3'];
  const ORDER = ['temp', 'humidity', 'thi', 'co2', 'nh3'];

  const GUIDE = 'Guide for the Care and Use of Laboratory Animals, 8th ed., Table 3.1';
  const NH3 = { watch: 10, max: 25 };          // keep below 25 ppm, ideally below 10
  const CO2_INDOOR = { watch: 1500, max: 2500 };
  const CO2_BARN = { watch: 2500, max: 3000 }; // common livestock-housing ceiling

  const PROFILES = [
    {
      key: 'dog', label: 'Dog', match: ['dog', 'canine', 'canis', 'puppy'],
      temp: { min: 18, max: 29 }, humidity: { min: 30, max: 70 }, co2: CO2_INDOOR, nh3: NH3,
      source: GUIDE, note: 'Heavy-coated and flat-faced breeds tolerate heat poorly: lower the max for them.',
    },
    {
      key: 'cat', label: 'Cat', match: ['cat', 'feline', 'kitten'],
      temp: { min: 18, max: 29 }, humidity: { min: 30, max: 70 }, co2: CO2_INDOOR, nh3: NH3,
      source: GUIDE, note: 'Seniors and kittens need the warmer end of the range.',
    },
    {
      key: 'rabbit', label: 'Rabbit', match: ['rabbit', 'bunny'],
      temp: { min: 16, max: 22 }, humidity: { min: 30, max: 70 }, co2: CO2_INDOOR, nh3: NH3,
      source: GUIDE, note: 'Heat-sensitive: sustained temperatures near 28 °C are dangerous.',
    },
    {
      key: 'chicken', label: 'Chicken', match: ['chicken', 'hen', 'poultry', 'rooster', 'broiler', 'layer', 'pullet'],
      temp: { min: 16, max: 27 }, humidity: { min: 30, max: 70 }, co2: CO2_BARN, nh3: NH3,
      source: GUIDE, note: 'Adult birds. Chicks need about 32–35 °C in week one, falling weekly.',
    },
    {
      key: 'pig', label: 'Pig', match: ['pig', 'swine', 'hog', 'sow', 'boar', 'piglet'],
      temp: { min: 16, max: 22 }, humidity: { min: 40, max: 70 }, co2: CO2_BARN, nh3: NH3,
      source: 'Grower–finisher thermal comfort zone', note: 'Piglets need about 30 °C at birth. Pigs cannot sweat: provide cooling above the max.',
    },
    {
      key: 'horse', label: 'Horse', match: ['horse', 'equine', 'pony', 'mare', 'gelding', 'stallion', 'foal', 'donkey'],
      temp: { min: 5, max: 25 }, humidity: { min: 40, max: 80 }, co2: CO2_BARN, nh3: NH3,
      source: 'Thermoneutral zone, adult horse', note: 'With shelter, forage and water, acclimatized horses cope well below the min.',
    },
    {
      key: 'cattle', label: 'Cattle', match: ['cow', 'cattle', 'bovine', 'calf', 'heifer', 'steer', 'bull'],
      temp: { min: -5, max: 25 }, humidity: { min: 40, max: 80 }, thi: { watch: 68, max: 72 }, co2: CO2_BARN, nh3: NH3,
      source: 'Thermoneutral zone and THI heat-stress thresholds, dairy cattle', note: 'THI ≥ 68 is where heat stress begins in high-yield dairy cows.',
    },
    {
      key: 'sheep', label: 'Sheep', match: ['sheep', 'ewe', 'ram', 'lamb', 'ovine'],
      temp: { min: 5, max: 25 }, humidity: { min: 40, max: 80 }, co2: CO2_BARN, nh3: NH3,
      source: 'Thermoneutral zone, fleeced adult sheep', note: 'Freshly shorn sheep need it markedly warmer.',
    },
    {
      key: 'goat', label: 'Goat', match: ['goat', 'caprine', 'kid', 'doe', 'buck'],
      temp: { min: 10, max: 27 }, humidity: { min: 40, max: 80 }, co2: CO2_BARN, nh3: NH3,
      source: 'Thermoneutral zone, adult goat', note: 'Goats dislike draughts and wet bedding more than cold air.',
    },
  ];

  const GENERIC = {
    key: 'generic', label: 'Generic', match: [], generic: true,
    temp: { min: 15, max: 28 }, humidity: { min: 30, max: 70 }, co2: CO2_INDOOR, nh3: NH3,
    source: 'No preset matches this species: generic indoor starting point', note: 'Set this animal\'s ranges on its page.',
  };

  function profileFor(species) {
    const s = String(species || '').toLowerCase().trim();
    if (!s) return GENERIC;
    const words = s.split(/[^a-z]+/).filter(Boolean);
    return PROFILES.find((p) => p.match.some((m) => words.includes(m) || s === m)) || GENERIC;
  }

  /* ---------- Units ------------------------------------------------------ */

  const cToF = (c) => (c * 9) / 5 + 32;
  const fToC = (f) => ((f - 32) * 5) / 9;
  const unitLabel = (metric, unit) => (metric === 'temp' ? (unit === 'F' ? '°F' : '°C') : METRICS[metric].unit);
  function toDisplay(metric, v, unit) { return metric === 'temp' && unit === 'F' ? cToF(v) : v; }
  function fromDisplay(metric, v, unit) { return metric === 'temp' && unit === 'F' ? fToC(v) : v; }
  function deltaToDisplay(metric, d, unit) { return metric === 'temp' && unit === 'F' ? (d * 9) / 5 : d; }

  function fmtValue(metric, v, unit, withUnit) {
    if (v == null || Number.isNaN(v)) return '—';
    const m = METRICS[metric];
    const dv = toDisplay(metric, v, unit);
    const n = m.digits ? dv.toFixed(m.digits) : Math.round(dv).toLocaleString('en-US');
    const txt = n.replace('-', U.MINUS);
    if (!withUnit) return txt;
    const u = unitLabel(metric, unit);
    return u ? `${txt} ${u}` : txt;
  }

  function fmtDelta(metric, d, unit) {
    const m = METRICS[metric];
    const dv = deltaToDisplay(metric, Math.abs(d), unit);
    const n = m.digits ? dv.toFixed(m.digits) : Math.round(dv).toLocaleString('en-US');
    const u = unitLabel(metric, unit);
    return u ? `${n} ${u}` : n;
  }

  /* Temperature–humidity index (NRC 1971), the standard livestock heat-stress index. */
  function thi(tC, rh) {
    if (tC == null || rh == null) return null;
    const tF = cToF(tC);
    return Math.round((tF - (0.55 - 0.0055 * rh) * (tF - 58)) * 10) / 10;
  }

  /* ---------- Needs ------------------------------------------------------ */

  /* One animal: species preset, overridden field-by-field. */
  function subjectNeeds(subject) {
    const profile = profileFor(subject.species);
    const ov = H.envStore.needsOf(subject.id) || {};
    const metrics = {};
    ORDER.forEach((k) => {
      const base = profile[k];
      const o = ov[k];
      if (!base && !o) return;
      const r = {};
      const from = {};
      ['min', 'max', 'watch'].forEach((f) => {
        if (o && o[f] != null) { r[f] = o[f]; from[f] = 'override'; }
        else if (base && base[f] != null) { r[f] = base[f]; from[f] = 'species'; }
      });
      if (Object.keys(r).length) metrics[k] = Object.assign(r, { from });
    });
    return { profile, metrics, note: ov.note || '', overridden: Boolean(H.envStore.needsOf(subject.id)) };
  }

  /* A shared space must suit every resident: highest min, lowest max.
     Each limit remembers which animal set it, and conflicts are explicit. */
  function spaceNeeds(residents) {
    const out = {};
    residents.forEach(({ subject, needs }) => {
      Object.keys(needs.metrics).forEach((k) => {
        const r = needs.metrics[k];
        const cur = out[k] || (out[k] = {});
        if (r.min != null && (cur.min == null || r.min > cur.min)) { cur.min = r.min; cur.minBy = subject.id; cur.minFrom = r.from.min; }
        if (r.max != null && (cur.max == null || r.max < cur.max)) { cur.max = r.max; cur.maxBy = subject.id; cur.maxFrom = r.from.max; }
        if (r.watch != null && (cur.watch == null || r.watch < cur.watch)) { cur.watch = r.watch; cur.watchBy = subject.id; }
      });
    });
    Object.keys(out).forEach((k) => {
      const r = out[k];
      if (r.min != null && r.max != null && r.min > r.max) r.conflict = true;
      // A limit "binds" only if some resident would tolerate more. Ties name nobody.
      const vals = residents.map((x) => x.needs.metrics[k]).filter(Boolean);
      r.minBinds = r.min != null && vals.some((v) => v.min == null || v.min < r.min);
      r.maxBinds = r.max != null && vals.some((v) => v.max == null || v.max > r.max);
    });
    return out;
  }

  /* ---------- Evaluation ------------------------------------------------- */

  /* Compare one value with one requirement. */
  function evaluate(metric, value, need, unit) {
    const m = METRICS[metric];
    if (value == null || !need) return { level: 'nominal', text: '' };
    const v = (x) => fmtValue(metric, x, unit, true);
    if (m.type === 'ceiling') {
      if (need.max != null && value >= need.max) return { level: 'flag', text: `${m.label} ${v(value)}, at or above the ${v(need.max)} limit`, over: value - need.max };
      if (need.watch != null && value >= need.watch) return { level: 'watch', text: `${m.label} ${v(value)}, above the ${v(need.watch)} guideline` };
      return { level: 'nominal', text: '' };
    }
    if (need.max != null && value > need.max) return { level: 'flag', text: `${m.label} ${v(value)}, ${fmtDelta(metric, value - need.max, unit)} above max ${v(need.max)}`, over: value - need.max };
    if (need.min != null && value < need.min) return { level: 'flag', text: `${m.label} ${v(value)}, ${fmtDelta(metric, need.min - value, unit)} below min ${v(need.min)}`, under: need.min - value };
    if (need.max != null && value > need.max - m.margin) return { level: 'watch', text: `${m.label} ${v(value)}, within ${fmtDelta(metric, m.margin, unit)} of max ${v(need.max)}` };
    if (need.min != null && value < need.min + m.margin) return { level: 'watch', text: `${m.label} ${v(value)}, within ${fmtDelta(metric, m.margin, unit)} of min ${v(need.min)}` };
    return { level: 'nominal', text: '' };
  }

  function inRange(metric, value, need) {
    if (!need) return true;
    if (METRICS[metric].type === 'ceiling') return need.max == null || value < need.max;
    return (need.min == null || value >= need.min) && (need.max == null || value <= need.max);
  }

  /* A reading is fresh for 3 sampling intervals (at least 15 min).
     Manual readings are trusted for 12 h. */
  function freshMs(sensor) {
    if (sensor.kind === 'manual') return 12 * 60 * MIN;
    return Math.max(3 * sensor.intervalSec * 1000, 15 * MIN);
  }

  const RANK = { nominal: 0, watch: 1, flag: 2 };
  const worse = (a, b) => (RANK[b] > RANK[a] ? b : a);

  /* Everything a view needs about one space, right now. */
  function analyzeSpace(spaceId, now) {
    const t = now || Date.now();
    const ES = H.envStore;
    const unit = ES.unit();
    const space = ES.space(spaceId);
    const residents = ES.residentsOf(spaceId)
      .map((id) => H.store.subject(id))
      .filter(Boolean)
      .map((subject) => ({ subject, needs: subjectNeeds(subject) }));
    const needs = spaceNeeds(residents);
    const sensors = ES.sensorsIn(spaceId);

    // Current value per metric: the worst fresh reading across sensors.
    const current = {};
    const notes = [];
    let level = 'nominal';

    SENSOR_METRICS.forEach((k) => {
      sensors.filter((s) => s.enabled && s.metrics.includes(k)).forEach((s) => {
        const r = ES.latest(s.id, k);
        if (!r) return;
        const age = t - r.t;
        const fresh = age <= freshMs(s);
        const ev = fresh ? evaluate(k, r.v[k], needs[k], unit) : { level: 'nominal', text: '' };
        const cand = { value: r.v[k], at: r.t, sensor: s, fresh, ev };
        const prev = current[k];
        if (!prev || (fresh && !prev.fresh) || (fresh === prev.fresh && (RANK[ev.level] > RANK[prev.ev.level] || (ev.level === prev.ev.level && r.t > prev.at)))) {
          current[k] = cand;
        }
      });
    });

    if (needs.thi && current.temp && current.humidity && current.temp.fresh && current.humidity.fresh) {
      const v = thi(current.temp.value, current.humidity.value);
      current.thi = { value: v, at: Math.min(current.temp.at, current.humidity.at), fresh: true, derived: true, ev: evaluate('thi', v, needs.thi, unit) };
    }

    ORDER.forEach((k) => {
      const c = current[k];
      const need = needs[k];
      if (need && need.conflict) {
        level = 'flag';
        notes.push({
          level: 'flag', metric: k,
          text: `No ${METRICS[k].label.toLowerCase()} suits every resident: ${need.minBy} needs ≥ ${fmtValue(k, need.min, unit, true)}, ${need.maxBy} needs ≤ ${fmtValue(k, need.max, unit, true)}`,
        });
        return;
      }
      if (!c) return;
      if (!c.fresh) {
        if (residents.length) {
          level = worse(level, 'watch');
          notes.push({ level: 'watch', metric: k, text: `${METRICS[k].label}: no reading for ${ago(t - c.at)} from ${c.sensor.name}` });
        }
        return;
      }
      if (c.ev.level !== 'nominal') {
        level = worse(level, c.ev.level);
        const by = (c.ev.over != null && need.maxBinds) ? need.maxBy : (c.ev.under != null && need.minBinds) ? need.minBy : null;
        const byNote = by && residents.length > 1 ? ` (limit set by ${by})` : '';
        notes.push({ level: c.ev.level, metric: k, text: c.ev.text + byNote });
      }
    });

    notes.sort((a, b) => RANK[b.level] - RANK[a.level]);
    if (!residents.length) level = 'none';
    else if (!Object.keys(current).length) {
      level = 'none';
      notes.push({ level: 'none', text: 'No sensor readings yet for this space' });
    } else if (!notes.length) notes.push({ level: 'nominal', text: 'All readings within every resident\'s range' });

    return { space, residents, needs, sensors, current, notes, level, unit, inRange24: timeInRange(sensors, needs, t) };
  }

  /* Share of the last 24 h (in 5-minute buckets) each metric spent in range. */
  function timeInRange(sensors, needs, now) {
    const since = now - U.DAY_MS;
    const out = {};
    SENSOR_METRICS.forEach((k) => {
      if (!needs[k]) return;
      let n = 0;
      let ok = 0;
      sensors.filter((s) => s.metrics.includes(k)).forEach((s) => {
        H.envStore.readings(s.id, since).forEach((r) => {
          if (r.v[k] == null) return;
          n++;
          if (inRange(k, r.v[k], needs[k])) ok++;
        });
      });
      if (n >= 12) out[k] = { share: ok / n, n, hoursOut: ((n - ok) * 5) / 60 };
    });
    return out;
  }

  function ago(ms) {
    const m = Math.round(ms / MIN);
    if (m < 1) return 'under a minute';
    if (m < 60) return `${m} min`;
    const h = Math.round(m / 60);
    if (h < 48) return `${h} h`;
    return `${Math.round(h / 24)} d`;
  }

  function agoShort(ms) {
    const s = Math.round(ms / 1000);
    if (s < 45) return 'just now';
    return `${ago(ms)} ago`;
  }

  H.env = {
    METRICS, SENSOR_METRICS, ORDER, PROFILES, GENERIC,
    profileFor, subjectNeeds, spaceNeeds, evaluate, inRange, analyzeSpace, timeInRange, freshMs, thi,
    cToF, fToC, toDisplay, fromDisplay, deltaToDisplay, unitLabel, fmtValue, fmtDelta, ago, agoShort, worse,
  };
})(window.Herd = window.Herd || {});
