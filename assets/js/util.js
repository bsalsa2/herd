/* Herd · shared helpers (dates, formatting, escaping) */
(function (H) {
  'use strict';

  const DAY_MS = 86400000;
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const ISO_RE = /^\d{4}-\d{2}-\d{2}$/;
  const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
  const MINUS = '−';

  const pad = (n) => String(n).padStart(2, '0');

  /* Dates are stored as local calendar days (YYYY-MM-DD) and compared in UTC
     so daylight-saving shifts never turn one day into 23 or 25 hours. */
  function todayISO() {
    const d = new Date();
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }

  function parseISO(iso) {
    const [y, m, d] = iso.split('-').map(Number);
    return Date.UTC(y, m - 1, d);
  }

  function toISO(t) {
    const d = new Date(t);
    return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
  }

  function isISO(s) {
    if (typeof s !== 'string' || !ISO_RE.test(s)) return false;
    const t = parseISO(s);
    return !Number.isNaN(t) && toISO(t) === s;
  }

  const addDays = (iso, n) => toISO(parseISO(iso) + n * DAY_MS);
  const daysBetween = (a, b) => Math.round((parseISO(b) - parseISO(a)) / DAY_MS);
  const dayNumber = (iso) => Math.round(parseISO(iso) / DAY_MS);

  function fmtDate(iso) {
    const d = new Date(parseISO(iso));
    return `${MONTHS[d.getUTCMonth()]} ${pad(d.getUTCDate())}`;
  }

  function fmtDateLong(iso) {
    const d = new Date(parseISO(iso));
    return `${WEEKDAYS[d.getUTCDay()]}, ${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
  }

  const fmtWeekday = (iso) => WEEKDAYS[new Date(parseISO(iso)).getUTCDay()];

  function fmtAgo(iso, today) {
    const n = daysBetween(iso, today || todayISO());
    if (n <= 0) return 'today';
    return `${n}d ago`;
  }

  const isTime = (s) => typeof s === 'string' && TIME_RE.test(s);

  function timeToMin(s) {
    if (!isTime(s)) return null;
    const [h, m] = s.split(':').map(Number);
    return h * 60 + m;
  }

  function minToTime(min) {
    const m = ((Math.round(min) % 1440) + 1440) % 1440;
    return `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
  }

  /* Signed percentage with a true minus sign: +4%, −42%, 0% */
  function fmtPct(p) {
    if (p == null || Number.isNaN(p)) return '—';
    if (p === 0) return '0%';
    return (p > 0 ? '+' : MINUS) + Math.abs(p) + '%';
  }

  /* Signed minutes: +65m, −12m */
  function fmtMinDelta(m) {
    const r = Math.round(m);
    if (r === 0) return '0m';
    return (r > 0 ? '+' : MINUS) + Math.abs(r) + 'm';
  }

  function fmtNum(v, digits) {
    if (v == null || Number.isNaN(v)) return '—';
    return v.toFixed(digits || 0).replace('-', MINUS);
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ));
  }

  function uid(prefix) {
    let rand = '';
    if (window.crypto && window.crypto.getRandomValues) {
      const buf = new Uint32Array(2);
      window.crypto.getRandomValues(buf);
      rand = buf[0].toString(36) + buf[1].toString(36);
    } else {
      rand = Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
    }
    return `${prefix || 'id'}_${Date.now().toString(36)}${rand.slice(0, 8)}`;
  }

  const cleanStr = (s, max) => (typeof s === 'string' ? s.trim().slice(0, max) : '');

  /* Age is captured as "N years as of date" so it keeps advancing over the record. */
  function currentAge(ageYears, recordedOn, today) {
    if (ageYears == null) return null;
    const elapsed = isISO(recordedOn) ? Math.max(0, daysBetween(recordedOn, today || todayISO())) / 365.25 : 0;
    return ageYears + elapsed;
  }

  function ageLabel(ageYears, recordedOn, today) {
    const years = currentAge(ageYears, recordedOn, today);
    if (years == null) return '—';
    if (years < 2) return `${Math.floor(years * 12)} mo`;
    return `${Math.floor(years)} y`;
  }

  const SEX = {
    M: 'Male, intact',
    MN: 'Male, neutered',
    F: 'Female, intact',
    FS: 'Female, spayed',
    U: 'Unknown',
  };

  const INTAKE = {
    full: 'Full',
    partial: 'Partial',
    low: 'Low',
  };

  H.util = {
    DAY_MS, MINUS, SEX, INTAKE,
    todayISO, parseISO, toISO, isISO, addDays, daysBetween, dayNumber,
    fmtDate, fmtDateLong, fmtWeekday, fmtAgo,
    isTime, timeToMin, minToTime,
    fmtPct, fmtMinDelta, fmtNum,
    esc, uid, cleanStr, currentAge, ageLabel,
  };
})(window.Herd = window.Herd || {});
