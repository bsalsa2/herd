/* Herd · baseline engine
   Every subject is compared only to itself. For each entry, the baseline is
   the subject's entries from the 14 calendar days before that entry's date
   (the entry itself is never part of its own baseline).

     FLAG   energy or activity >= 30% below baseline mean, or intake "low"
     WATCH  energy or activity 20–29% below baseline mean, or intake "partial"
     ---    a subject also stays on WATCH for 3 days after its last flag

   Percentages are rounded to whole numbers before thresholds are applied, so
   the number shown in a note always agrees with the level it produced. */
(function (H) {
  'use strict';

  const U = H.util;

  const CONFIG = {
    windowDays: 14,   // baseline look-back, in calendar days
    minEntries: 3,    // relative checks start once the window holds this many entries
    flagDrop: 30,     // % below baseline mean that raises FLAG
    watchDrop: 20,    // % below baseline mean that raises WATCH
    recoveryDays: 3,  // days a subject stays on WATCH after a flag
  };

  const RANK = { nominal: 0, watch: 1, flag: 2 };
  const METRICS = [
    { key: 'activity', label: 'Activity' },
    { key: 'energy', label: 'Energy' },
  ];

  function summarize(values) {
    const n = values.length;
    if (!n) return null;
    const mean = values.reduce((a, b) => a + b, 0) / n;
    const sd = n > 1 ? Math.sqrt(values.reduce((a, v) => a + (v - mean) * (v - mean), 0) / (n - 1)) : 0;
    return { n, mean, sd, min: Math.min.apply(null, values), max: Math.max.apply(null, values) };
  }

  /* Baseline from a set of window entries, for an entry dated `date`. */
  function baselineFrom(win, date) {
    const wakes = win.map((e) => U.timeToMin(e.wake)).filter((v) => v != null);
    return {
      date,
      from: U.addDays(date, -CONFIG.windowDays),
      to: U.addDays(date, -1),
      n: win.length,
      ready: win.length >= CONFIG.minEntries,
      energy: summarize(win.map((e) => e.energy)),
      activity: summarize(win.map((e) => e.activity)),
      wake: summarize(wakes),
      intakeFull: win.length ? win.filter((e) => e.intake === 'full').length / win.length : null,
    };
  }

  /* Baseline for an arbitrary date (used by the entry form preview).
     `excludeId` keeps an entry being edited out of its own baseline. */
  function baselineFor(entries, date, excludeId) {
    const win = entries.filter((e) => {
      if (e.id === excludeId) return false;
      const gap = U.daysBetween(e.date, date);
      return gap >= 1 && gap <= CONFIG.windowDays;
    });
    return baselineFrom(win, date);
  }

  function levelForPct(pct) {
    if (pct == null) return 'nominal';
    if (pct <= -CONFIG.flagDrop) return 'flag';
    if (pct <= -CONFIG.watchDrop) return 'watch';
    return 'nominal';
  }

  /* Evaluate one entry against a baseline. Returns the level, the notes that
     explain it (most severe first), and the per-metric % deltas. */
  function evaluate(entry, base) {
    const notes = [];
    const deltas = { energy: null, activity: null };

    if (entry.intake === 'low') notes.push({ level: 'flag', kind: 'intake', text: 'Intake low' });
    else if (entry.intake === 'partial') notes.push({ level: 'watch', kind: 'intake', text: 'Intake partial' });

    if (base.ready) {
      for (const m of METRICS) {
        const mean = base[m.key] && base[m.key].mean;
        if (!(mean > 0)) continue;
        const pct = Math.round(((entry[m.key] - mean) / mean) * 100);
        deltas[m.key] = pct;
        const level = levelForPct(pct);
        if (level !== 'nominal') {
          notes.push({
            level, kind: 'delta', metric: m.key, label: m.label, pct,
            text: `${m.label} ${U.fmtPct(pct)} vs 14-day baseline`,
          });
        }
      }
    }

    notes.sort((a, b) => RANK[b.level] - RANK[a.level]);
    const level = notes.length ? notes[0].level : 'nominal';
    return { level, notes, deltas, base, calibrating: !base.ready };
  }

  /* Evaluate every entry of one subject. Entries must be sorted by date and
     unique per day; a sliding window keeps this linear in record length. */
  function evaluateAll(entries) {
    const out = new Map();
    const days = entries.map((e) => U.dayNumber(e.date));
    let lo = 0;
    for (let i = 0; i < entries.length; i++) {
      while (lo < i && days[i] - days[lo] > CONFIG.windowDays) lo++;
      const win = entries.slice(lo, i);
      out.set(entries[i].id, evaluate(entries[i], baselineFrom(win, entries[i].date)));
    }
    return out;
  }

  /* Subject-level status, driven by the most recent entry. */
  function subjectStatus(entries, evals) {
    if (!entries.length) {
      return { level: 'none', notes: [{ level: 'none', kind: 'text', text: 'No entries recorded yet' }], latest: null, ev: null };
    }
    const latest = entries[entries.length - 1];
    const ev = evals.get(latest.id);
    const notes = ev.notes.slice();
    let level = ev.level;

    if (level !== 'flag') {
      for (let i = entries.length - 2; i >= 0; i--) {
        const gap = U.daysBetween(entries[i].date, latest.date);
        if (gap > CONFIG.recoveryDays) break;
        if (evals.get(entries[i].id).level === 'flag') {
          level = 'watch';
          notes.push({ level: 'watch', kind: 'recovery', date: entries[i].date, text: `Recovering · flagged ${U.fmtDate(entries[i].date)}` });
          break;
        }
      }
    }

    if (!notes.length) {
      notes.push(ev.calibrating
        ? { level: 'nominal', kind: 'calibrating', n: ev.base.n, min: CONFIG.minEntries, text: `Baseline calibrating · n=${ev.base.n}/${CONFIG.minEntries}` }
        : { level: 'nominal', kind: 'text', text: 'Within 14-day baseline' });
    }

    return { level, notes, latest, ev };
  }

  /* Everything a view needs about one subject's record. */
  function analyze(entries) {
    const evals = evaluateAll(entries);
    const status = subjectStatus(entries, evals);
    // "Current" baseline = the one the latest entry was judged against, so the
    // chart band, the stats strip, and the status note always reconcile.
    const current = status.latest ? evals.get(status.latest.id).base : null;
    return { entries, evals, status, current };
  }

  H.baseline = { CONFIG, summarize, baselineFor, evaluate, evaluateAll, subjectStatus, analyze, levelForPct };
})(window.Herd = window.Herd || {});
