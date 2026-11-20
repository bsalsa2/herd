/* Herd · persistence
   Everything lives in one localStorage key as JSON. All reads and writes are
   wrapped: private browsing or a full quota degrades to in-memory mode and the
   UI says so, instead of failing silently. */
(function (H) {
  'use strict';

  const U = H.util;
  const KEY = 'herd:data:v1';
  const INTAKES = ['full', 'partial', 'low'];
  const SEXES = Object.keys(U.SEX);
  const MAX_NOTE = 500;

  let data = null;
  let persistent = true;

  function read() {
    try {
      return localStorage.getItem(KEY);
    } catch (err) {
      persistent = false;
      return null;
    }
  }

  function write() {
    try {
      localStorage.setItem(KEY, JSON.stringify(data));
      persistent = true;
    } catch (err) {
      persistent = false;
    }
  }

  const formatId = (n) => 'HRD-' + String(n).padStart(4, '0');
  const seqOf = (id) => parseInt(id.slice(4), 10);

  /* Validate and coerce any payload (stored or imported) into the current
     shape. Invalid rows are dropped and counted rather than aborting. */
  function normalize(obj) {
    if (!obj || typeof obj !== 'object' || !Array.isArray(obj.subjects) || !Array.isArray(obj.entries)) {
      return { ok: false, error: 'This file is not a Herd export: it needs "subjects" and "entries" lists.' };
    }

    const today = U.todayISO();
    let dropped = 0;

    const subjects = [];
    const ids = new Set();
    for (const s of obj.subjects) {
      if (!s || typeof s.id !== 'string' || !/^HRD-\d{4,}$/.test(s.id) || ids.has(s.id)) { dropped++; continue; }
      ids.add(s.id);
      const age = s.ageYears === null || s.ageYears === '' || s.ageYears === undefined ? null : Number(s.ageYears);
      subjects.push({
        id: s.id,
        name: U.cleanStr(s.name, 60) || s.id,
        species: U.cleanStr(s.species, 40) || 'Unspecified',
        breed: U.cleanStr(s.breed, 60),
        sex: SEXES.includes(s.sex) ? s.sex : 'U',
        ageYears: Number.isFinite(age) && age >= 0 && age <= 80 ? age : null,
        ageRecordedOn: U.isISO(s.ageRecordedOn) ? s.ageRecordedOn : today,
        createdAt: typeof s.createdAt === 'string' ? s.createdAt : new Date().toISOString(),
      });
    }

    const entries = [];
    const dayKeys = new Set();
    const entryIds = new Set();
    for (const e of obj.entries) {
      if (!e || !ids.has(e.subjectId) || !U.isISO(e.date)) { dropped++; continue; }
      const energy = Number(e.energy);
      const activity = Number(e.activity);
      if (!INTAKES.includes(e.intake)
        || !Number.isInteger(energy) || energy < 1 || energy > 5
        || !Number.isFinite(activity) || activity < 0 || activity > 1440) { dropped++; continue; }
      const dayKey = e.subjectId + '|' + e.date;
      if (dayKeys.has(dayKey)) { dropped++; continue; }
      dayKeys.add(dayKey);
      let id = typeof e.id === 'string' && e.id ? e.id.slice(0, 64) : U.uid('e');
      if (entryIds.has(id)) id = U.uid('e');
      entryIds.add(id);
      entries.push({
        id,
        subjectId: e.subjectId,
        date: e.date,
        wake: U.isTime(e.wake) ? e.wake : '',
        intake: e.intake,
        energy,
        activity: Math.round(activity),
        behavior: U.cleanStr(e.behavior, MAX_NOTE),
        anomaly: U.cleanStr(e.anomaly, MAX_NOTE),
      });
    }

    const meta = obj.meta && typeof obj.meta === 'object' ? obj.meta : {};
    const maxSeq = subjects.reduce((m, s) => Math.max(m, seqOf(s.id)), 0);
    const nextSeq = Math.max(maxSeq + 1, Number.isInteger(meta.nextSeq) ? meta.nextSeq : 0);

    return {
      ok: true,
      dropped,
      data: {
        version: 1,
        meta: {
          nextSeq,
          lastExportAt: typeof meta.lastExportAt === 'string' ? meta.lastExportAt : null,
          seededOn: U.isISO(meta.seededOn) ? meta.seededOn : null,
        },
        subjects,
        entries,
      },
    };
  }

  function load() {
    const raw = read();
    if (raw) {
      try {
        const res = normalize(JSON.parse(raw));
        if (res.ok) { data = res.data; return; }
      } catch (err) { /* fall through */ }
      // Unreadable payload: keep a copy so nothing is silently destroyed.
      try { localStorage.setItem(KEY + ':unreadable:' + Date.now(), raw); } catch (err) { /* ignore */ }
    }
    data = H.seed(U.todayISO());
    write();
  }

  const byDate = (a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0);

  function cleanSubjectFields(f) {
    return {
      name: U.cleanStr(f.name, 60),
      species: U.cleanStr(f.species, 40) || 'Unspecified',
      breed: U.cleanStr(f.breed, 60),
      sex: SEXES.includes(f.sex) ? f.sex : 'U',
    };
  }

  function cleanEntryFields(f) {
    return {
      date: f.date,
      wake: U.isTime(f.wake) ? f.wake : '',
      intake: f.intake,
      energy: f.energy,
      activity: Math.round(f.activity),
      behavior: U.cleanStr(f.behavior, MAX_NOTE),
      anomaly: U.cleanStr(f.anomaly, MAX_NOTE),
    };
  }

  H.store = {
    KEY,
    load,
    validate: normalize,
    isPersistent: () => persistent,

    subjects: () => data.subjects.slice().sort((a, b) => seqOf(a.id) - seqOf(b.id)),
    subject: (id) => data.subjects.find((s) => s.id === id) || null,
    entries: (subjectId) => data.entries.filter((e) => e.subjectId === subjectId).sort(byDate),
    entry: (id) => data.entries.find((e) => e.id === id) || null,
    entryOn: (subjectId, date) => data.entries.find((e) => e.subjectId === subjectId && e.date === date) || null,
    peekNextId: () => formatId(data.meta.nextSeq),
    meta: () => Object.assign({}, data.meta),
    counts: () => ({ subjects: data.subjects.length, entries: data.entries.length }),

    createSubject(fields) {
      // IDs are never reused, even after a delete, so exported records stay unambiguous.
      const s = Object.assign({ id: formatId(data.meta.nextSeq) }, cleanSubjectFields(fields), {
        ageYears: fields.ageYears,
        ageRecordedOn: U.todayISO(),
        createdAt: new Date().toISOString(),
      });
      data.meta.nextSeq += 1;
      data.subjects.push(s);
      write();
      return s;
    },

    updateSubject(id, fields) {
      const s = this.subject(id);
      if (!s) return null;
      Object.assign(s, cleanSubjectFields(fields));
      if (fields.ageChanged) {
        s.ageYears = fields.ageYears;
        s.ageRecordedOn = U.todayISO();
      }
      write();
      return s;
    },

    deleteSubject(id) {
      data.subjects = data.subjects.filter((s) => s.id !== id);
      data.entries = data.entries.filter((e) => e.subjectId !== id);
      write();
    },

    /* One entry per subject per day. Saving onto a date that already has a
       different entry replaces it (the UI warns before this happens). */
    saveEntry(subjectId, fields, entryId) {
      const clean = cleanEntryFields(fields);
      data.entries = data.entries.filter((e) => !(e.subjectId === subjectId && e.date === clean.date && e.id !== entryId));
      const existing = entryId ? this.entry(entryId) : null;
      if (existing) {
        Object.assign(existing, clean);
        write();
        return existing;
      }
      const e = Object.assign({ id: U.uid('e'), subjectId }, clean);
      data.entries.push(e);
      write();
      return e;
    },

    deleteEntry(id) {
      data.entries = data.entries.filter((e) => e.id !== id);
      write();
    },

    exportPayload() {
      return {
        app: 'herd',
        version: data.version,
        exportedAt: new Date().toISOString(),
        meta: { nextSeq: data.meta.nextSeq },
        subjects: data.subjects,
        entries: data.entries.slice().sort((a, b) => (a.subjectId === b.subjectId ? byDate(a, b) : a.subjectId < b.subjectId ? -1 : 1)),
        // Spaces, sensors (without access tokens), needs, and 14 days of readings.
        environment: H.envStore ? H.envStore.exportPart() : undefined,
      };
    },

    markExported() {
      data.meta.lastExportAt = new Date().toISOString();
      write();
    },

    replaceAll(normalized) {
      const lastExportAt = data.meta.lastExportAt;
      data = normalized;
      data.meta.lastExportAt = data.meta.lastExportAt || lastExportAt;
      write();
    },

    resetToSample() {
      const lastExportAt = data.meta.lastExportAt;
      data = H.seed(U.todayISO());
      data.meta.lastExportAt = lastExportAt;
      write();
    },
  };
})(window.Herd = window.Herd || {});
