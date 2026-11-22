/* Herd · app controller
   Hash routing (works on GitHub Pages with no server config), the shell
   (rail roster, breadcrumbs, top bar), delegated events, dialogs, the command
   palette, keyboard shortcuts, theme, lock, import/export. */
(function (H) {
  'use strict';

  const U = H.util;
  const S = H.store;
  const V = H.views;
  const B = H.baseline;
  const C = H.charts;
  const ES = H.envStore;
  const EV = H.envViews;
  const SN = H.sensors;
  const esc = U.esc;

  const main = document.getElementById('main');
  const dlg = document.getElementById('dialog');
  const fileInput = document.getElementById('import-file');
  const toastEl = document.getElementById('toast');
  const lastExportEl = document.getElementById('last-export');
  const rosterEl = document.getElementById('roster');
  const crumbsEl = document.getElementById('crumbs');
  const barToday = document.getElementById('bar-today');
  const barSensors = document.getElementById('bar-sensors');
  const barSensorsCell = document.getElementById('bar-sensors-cell');
  const themeBtn = document.getElementById('theme-btn');
  const lockBtn = document.getElementById('lock-btn');
  const pal = document.getElementById('palette');
  const palInput = document.getElementById('pal-input');
  const palList = document.getElementById('pal-list');

  /* ---------- UI state (per browser, cosmetic only) ---------------------- */

  const UI_KEY = 'herd:ui';
  const RANGE_KEYS = ['14', '30', '90', 'all'];
  const state = { filter: 'all', range: '30', logAll: false, theme: document.documentElement.getAttribute('data-theme') || 'dark' };

  try {
    const saved = JSON.parse(localStorage.getItem(UI_KEY) || '{}');
    if (RANGE_KEYS.includes(saved.range)) state.range = saved.range;
  } catch (err) { /* defaults */ }

  function saveUI(extra) {
    try {
      const prev = JSON.parse(localStorage.getItem(UI_KEY) || '{}');
      localStorage.setItem(UI_KEY, JSON.stringify(Object.assign(prev, { range: state.range }, extra || {})));
    } catch (err) { /* ignore */ }
  }

  /* ---------- Theme and lock -------------------------------------------- */

  function applyTheme(t) {
    state.theme = t === 'light' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', state.theme);
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', state.theme === 'light' ? '#F2F1EC' : '#07100B');
    const next = state.theme === 'light' ? 'dark' : 'light';
    themeBtn.setAttribute('aria-label', `Switch to ${next} theme`);
    themeBtn.title = `Switch to ${next} theme`;
    themeBtn.querySelector('use').setAttribute('href', state.theme === 'light' ? '#i-moon' : '#i-sun');
  }

  function toggleTheme() {
    applyTheme(state.theme === 'light' ? 'dark' : 'light');
    saveUI({ theme: state.theme });
    C.reset();
    render();
  }

  // Only the published copy sits behind the passphrase gate.
  const LOCKED_COPY = /\/internal\/?/.test(location.pathname);
  lockBtn.hidden = !LOCKED_COPY;

  function lock() {
    try { localStorage.removeItem('herd:unlock'); } catch (err) { /* ignore */ }
    SN.stopAll && SN.stopAll();
    location.reload();
  }

  /* ---------- Routing ---------------------------------------------------- */

  let current = null;

  function parseRoute() {
    const h = decodeURIComponent(location.hash.replace(/^#\/?/, ''));
    if (/^env\/?$/i.test(h)) return { name: 'env', id: null };
    const m = h.match(/^s\/(HRD-\d{4,})$/i);
    return m ? { name: 'subject', id: m[1].toUpperCase() } : { name: 'overview', id: null };
  }

  function navigate(hash) {
    if (location.hash === hash) render();
    else location.hash = hash;
  }

  function render(opts) {
    const o = opts || {};
    const r = parseRoute();
    const changed = !current || r.name !== current.name || r.id !== current.id;
    if (changed) state.logAll = false;
    current = r;

    C.reset();
    let view;
    if (r.name === 'subject') view = V.subject(state, r.id);
    else if (r.name === 'env') view = EV.envPage();
    else view = V.overview(state);
    main.innerHTML = view.html;
    const navKey = r.name === 'env' ? 'env' : r.name === 'overview' ? 'overview' : '';
    document.querySelectorAll('[data-nav]').forEach((a) => {
      if (a.dataset.nav === navKey) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
    });
    document.title = view.title;
    renderCrumbs(view.crumbs || []);
    if (changed) {
      const el = main.firstElementChild;
      if (el) el.classList.add('enter');
    }
    if (view.mount) view.mount(main);
    main.querySelectorAll('[data-live]').forEach((el) => { el.__html = el.innerHTML; });
    main.querySelectorAll('form[data-form="entry"]').forEach(V.updatePreview);
    renderShell();

    if (changed && o.fromHash) {
      window.scrollTo(0, 0);
      main.focus({ preventScroll: true });
    }
  }

  function renderCrumbs(list) {
    const parts = [`<a href="#/">Herd</a>`];
    list.forEach((c, i) => {
      parts.push('<span class="sep" aria-hidden="true">/</span>');
      parts.push(c.href && i < list.length - 1 ? `<a href="${esc(c.href)}">${esc(c.label)}</a>` : `<span aria-current="page">${esc(c.label)}</span>`);
    });
    crumbsEl.innerHTML = parts.join('');
  }

  /* Rail roster, top bar cells, last export. */
  function renderShell() {
    const subjects = S.subjects();
    const activeId = current && current.name === 'subject' ? current.id : null;
    rosterEl.innerHTML = subjects.length ? subjects.map((s) => {
      const lv = B.analyze(S.entries(s.id)).status.level;
      return `<li><a class="ros" href="#/s/${esc(s.id)}"${s.id === activeId ? ' aria-current="page"' : ''} title="${esc(V.LEVEL_LABEL[lv])}">
        <i class="dot ${lv}" aria-hidden="true"></i><span class="ros-id">${esc(s.id)}</span><span class="ros-name">${esc(s.name)}</span>
        <span class="visually-hidden">, ${esc(V.LEVEL_LABEL[lv])}</span></a></li>`;
    }).join('') : '<li class="ros-empty">No subjects yet</li>';

    const today = U.todayISO();
    barToday.textContent = `${U.fmtWeekday(today)} ${U.fmtDate(today)}`;
    renderSensorCell();

    const at = S.meta().lastExportAt;
    if (!at) lastExportEl.textContent = 'Last export: never';
    else {
      const d = new Date(at);
      const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      lastExportEl.textContent = `Last export: ${U.fmtDate(iso)} · ${U.fmtAgo(iso)}`;
    }
  }

  function renderSensorCell() {
    const t = EV.sensorTally();
    barSensorsCell.hidden = !t.total;
    barSensors.innerHTML = `<i class="dot ${t.live === t.total ? 'nominal' : t.live ? 'watch' : 'flag'}" aria-hidden="true"></i> ${t.live}/${t.total} live`;
    barSensors.style.display = 'inline-flex';
    barSensors.style.alignItems = 'center';
    barSensors.style.gap = '8px';
  }

  /* ---------- Live sensor updates --------------------------------------
     Only [data-live] blocks re-render, never whole pages, so an entry being
     typed on a subject page is never wiped by an incoming reading. Focus is
     restored, and a block is skipped while the pointer is reading a chart. */

  let liveTimer = 0;
  function scheduleLive() {
    if (liveTimer) return;
    liveTimer = setTimeout(() => { liveTimer = 0; refreshLive(); }, 1200);
  }

  function focusKey(el) {
    if (!el || !el.dataset) return null;
    const d = el.dataset;
    return [d.action, d.id, d.chart, d.unit].join('|');
  }

  function refreshLive() {
    renderSensorCell();
    main.querySelectorAll('[data-live]').forEach((el) => {
      if (el.querySelector('.chart:hover, .chart:focus')) return; // don't yank a tooltip mid-read
      const res = EV.live(el.dataset.live);
      if (!res || res.html === el.__html) return;
      const active = el.contains(document.activeElement) ? focusKey(document.activeElement) : null;
      C.unmountWithin(el);
      el.innerHTML = res.html;
      el.__html = res.html;
      if (res.mount) res.mount(el);
      if (active) {
        const again = Array.from(el.querySelectorAll('[data-action], [data-chart]')).find((n) => focusKey(n) === active);
        if (again) again.focus({ preventScroll: true });
      }
    });
  }

  SN.onUpdate(scheduleLive);
  setInterval(refreshLive, 30000); // ages "2 min ago" labels and staleness

  /* ---------- Toast ------------------------------------------------------ */

  let toastTimer = 0;
  function toast(msg, level) {
    toastEl.innerHTML = `${level ? `<span class="dot ${level}"></span>` : ''}<span>${esc(msg)}</span>`;
    toastEl.classList.remove('on');
    void toastEl.offsetWidth; // restart the transition
    toastEl.classList.add('on');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove('on'), 3000);
  }

  /* ---------- Dialogs ---------------------------------------------------- */

  let resolveConfirm = null;
  let returnFocus = null;

  function openDialog(html, narrow) {
    closePalette(false);
    returnFocus = document.activeElement;
    dlg.classList.toggle('narrow', Boolean(narrow));
    dlg.returnValue = '';
    dlg.innerHTML = html;
    if (!dlg.open) dlg.showModal();
    const target = dlg.querySelector('[autofocus]') || dlg.querySelector('input:not([type=hidden]):not([type=radio]), select, textarea');
    if (target) target.focus();
  }

  function closeDialog() {
    if (dlg.open) dlg.close();
  }

  dlg.addEventListener('close', () => {
    // 'close' fires asynchronously. If a new dialog opened in the meantime
    // (edit → confirm delete), this event belongs to the old one: ignore it.
    if (dlg.open) return;
    if (resolveConfirm) {
      const r = resolveConfirm;
      resolveConfirm = null;
      r(dlg.returnValue === 'confirm');
    }
    dlg.innerHTML = '';
    // The opener may have been re-rendered away; keep focus inside the page.
    if (returnFocus && document.contains(returnFocus) && returnFocus !== document.body) returnFocus.focus({ preventScroll: true });
    else main.focus({ preventScroll: true });
    returnFocus = null;
  });

  // Click on the backdrop closes the dialog.
  dlg.addEventListener('mousedown', (e) => {
    if (e.target === dlg) closeDialog();
  });

  function confirmDialog(o) {
    return new Promise((resolve) => {
      openDialog(V.confirmBody(o), true);
      resolveConfirm = resolve;
    });
  }

  function alertDialog(title, message) {
    return confirmDialog({ eyebrow: 'Notice', title, bodyHTML: esc(message), confirmLabel: 'OK', cancel: false });
  }

  /* ---------- Subjects --------------------------------------------------- */

  function openSubjectDialog(id) {
    const s = id ? S.subject(id) : null;
    openDialog(V.subjectForm(s));
  }

  function submitSubject(form) {
    const fd = new FormData(form);
    const name = String(fd.get('name') || '').trim();
    const ageRaw = String(fd.get('age') || '').trim();
    const age = ageRaw === '' ? null : Number(ageRaw);
    const errors = [];
    form.querySelectorAll('[aria-invalid]').forEach((el) => el.removeAttribute('aria-invalid'));

    if (!name) { errors.push('Name is required.'); form.elements.name.setAttribute('aria-invalid', 'true'); }
    if (age !== null && !(Number.isFinite(age) && age >= 0 && age <= 80)) {
      errors.push('Age must be between 0 and 80 years.');
      form.elements.age.setAttribute('aria-invalid', 'true');
    }
    if (errors.length) {
      form.querySelector('[data-error]').textContent = errors.join(' ');
      return;
    }

    const fields = {
      name,
      species: String(fd.get('species') || ''),
      breed: String(fd.get('breed') || ''),
      sex: String(fd.get('sex') || 'U'),
      ageYears: age,
      ageChanged: ageRaw !== form.dataset.ageShown,
    };

    const id = form.dataset.id;
    closeDialog();
    if (id) {
      S.updateSubject(id, fields);
      render();
      toast(`${id} updated`);
    } else {
      const s = S.createSubject(fields);
      navigate(`#/s/${s.id}`);
      toast(`${s.id} created`);
    }
  }

  async function deleteSubject(id) {
    const s = S.subject(id);
    if (!s) return;
    const n = S.entries(id).length;
    const ok = await confirmDialog({
      eyebrow: 'Delete subject',
      title: `Delete ${s.id}?`,
      bodyHTML: `This permanently removes <strong>${esc(s.name)}</strong> and ${n} ${n === 1 ? 'entry' : 'entries'} from this browser. The ID will not be reused. Export first if you need a copy.`,
      confirmLabel: 'Delete subject',
      danger: true,
    });
    if (!ok) return;
    S.deleteSubject(id);
    ES.forgetSubject(id);
    navigate('#/');
    toast(`${id} deleted`);
  }

  /* ---------- Entries ---------------------------------------------------- */

  function openEntryDialog(id) {
    const e = S.entry(id);
    if (!e) return;
    const s = S.subject(e.subjectId);
    openDialog(V.entryDialog(s, e, e.date));
    const form = dlg.querySelector('form[data-form="entry"]');
    if (form) V.updatePreview(form);
  }

  /* Today's entry for any subject, from the field view or the palette. */
  function openTodayDialog(subjectId) {
    const s = S.subject(subjectId);
    if (!s) return;
    const today = U.todayISO();
    openDialog(V.entryDialog(s, S.entryOn(subjectId, today), today));
    const form = dlg.querySelector('form[data-form="entry"]');
    if (form) {
      V.updatePreview(form);
      const first = firstOpen(form);
      if (first) first.focus();
    }
  }

  /* The first control of the first unanswered question, else the first one. */
  function firstOpen(form) {
    const q = form.querySelector('[data-field]:not(.answered)') || form.querySelector('[data-field]');
    return q ? q.querySelector('input:checked, input[type="radio"], input[type="range"], input, button') : null;
  }

  function focusEntry() {
    const form = main.querySelector('#entry form');
    if (!form) return;
    form.closest('section').scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
    const first = firstOpen(form);
    setTimeout(() => first && first.focus({ preventScroll: true }), 300);
  }

  function submitEntry(form) {
    const { values, errors } = V.readEntryForm(form);
    V.markErrors(form, errors);
    if (errors.length) {
      const first = form.querySelector('[aria-invalid="true"]');
      if (first) {
        const target = first.matches('[data-field]') ? first.querySelector('input:checked, input[type="radio"], input[type="range"], input') : first;
        if (target) target.focus();
        first.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
      return;
    }

    const subjectId = form.dataset.subject;
    const entryId = form.dataset.entryId || null;
    const base = B.baselineFor(S.entries(subjectId), values.date, entryId);
    const v = V.verdict(values, base, form.dataset.name || subjectId);
    const saved = S.saveEntry(subjectId, values, entryId);
    if (form.closest('dialog')) closeDialog();
    render();

    const reason = v.items.find((it) => it.level === v.level && v.level !== 'nominal');
    toast(`Saved · ${v.head.replace(/\.$/, '')}${reason ? ` · ${reason.text.toLowerCase()}` : ''}`, v.level);
    void saved;
  }

  async function deleteEntry(id) {
    const e = S.entry(id);
    if (!e) return;
    const ok = await confirmDialog({
      eyebrow: 'Delete entry',
      title: `Delete the ${U.fmtDate(e.date)} entry?`,
      bodyHTML: `This removes the ${esc(U.fmtDateLong(e.date))} entry for <strong>${esc(e.subjectId)}</strong>. Baselines for the following 14 days will be recalculated.`,
      confirmLabel: 'Delete entry',
      danger: true,
    });
    if (!ok) return;
    S.deleteEntry(id);
    render();
    toast(`Entry ${U.fmtDate(e.date)} deleted`);
  }

  /* ---------- Environment: spaces, sensors, needs ----------------------- */

  function setError(form, msgs) {
    const out = form.querySelector('[data-error]');
    if (out) out.textContent = msgs.join(' ');
  }

  function submitSpace(form) {
    const { name, residents, errors } = EV.readSpaceForm(form);
    if (errors.length) { setError(form, errors); return; }
    const id = form.dataset.id;
    const sp = id ? ES.space(id) : ES.createSpace(name);
    if (id) ES.renameSpace(id, name);
    ES.setResidents(sp.id, residents);
    closeDialog();
    render();
    toast(`${sp.name} ${id ? 'updated' : 'created'} · ${residents.length} ${residents.length === 1 ? 'resident' : 'residents'}`);
  }

  async function deleteSpace(id) {
    const sp = ES.space(id);
    if (!sp) return;
    closeDialog();
    const n = ES.residentsOf(id).length;
    const k = ES.sensorsIn(id).length;
    const ok = await confirmDialog({
      eyebrow: 'Delete space',
      title: `Delete ${sp.name}?`,
      bodyHTML: `${n} ${n === 1 ? 'animal' : 'animals'} and ${k} ${k === 1 ? 'sensor' : 'sensors'} will become unassigned. Sensors and their readings are kept.`,
      confirmLabel: 'Delete space',
      danger: true,
    });
    if (!ok) return;
    ES.deleteSpace(id);
    render();
    toast(`${sp.name} deleted`);
  }

  function openSensorDialog(id, spaceId) {
    openDialog(EV.sensorForm(id ? ES.sensor(id) : null, spaceId));
    const form = dlg.querySelector('form[data-form="sensor"]');
    if (form) EV.syncSensorForm(form);
  }

  function submitSensor(form) {
    const { fields, errors } = EV.readSensorForm(form);
    if (errors.length) { setError(form, errors); return; }
    const id = form.dataset.id;
    let s;
    if (id) {
      const prev = ES.sensor(id);
      // A blank token field on edit keeps the stored token.
      if (fields.kind === 'http' && !fields.config.token && prev.config.token && form.elements.token.value === '') fields.config.token = prev.config.token;
      s = ES.updateSensor(id, fields);
    } else {
      s = ES.createSensor(fields);
    }
    closeDialog();
    if (!s) { toast('Could not save sensor', 'flag'); return; }
    SN.sync();
    render();
    toast(`${s.id} ${id ? 'saved' : 'added'} · ${EV.KIND[s.kind].label}`);
  }

  async function removeSensor(id) {
    const s = ES.sensor(id);
    if (!s) return;
    const n = ES.readingCount(id);
    const ok = await confirmDialog({
      eyebrow: 'Remove sensor',
      title: `Remove ${s.name}?`,
      bodyHTML: `This disconnects <strong>${esc(s.id)}</strong> and deletes its ${n} stored ${n === 1 ? 'reading' : 'readings'}. The ID will not be reused.`,
      confirmLabel: 'Remove sensor',
      danger: true,
    });
    if (!ok) return;
    ES.deleteSensor(id);
    SN.sync();
    render();
    toast(`${s.id} removed`);
  }

  function toggleSensor(id) {
    const s = ES.sensor(id);
    if (!s) return;
    ES.setEnabled(id, !s.enabled);
    SN.sync();
    render();
    toast(`${s.name} ${s.enabled ? 'paused' : 'resumed'}`);
  }

  async function readSensor(id) {
    try {
      await SN.readNow(id);
      toast('Reading taken');
    } catch (err) {
      toast(err.message || 'Read failed', 'flag');
    }
    refreshLive();
  }

  async function connectSensor(id) {
    try {
      await SN.reconnectBle(id);
      toast('Connected');
    } catch (err) {
      if (err && err.name === 'NotFoundError') return; // user closed the picker
      toast(err.message || 'Could not connect', 'flag');
    }
    refreshLive();
  }

  function submitManual(form) {
    const s = ES.sensor(form.dataset.id);
    if (!s) return;
    const { at, values, errors } = EV.readManualForm(form, s);
    if (errors.length) { setError(form, errors); return; }
    ES.addReading(s.id, values, at);
    ES.flush();
    closeDialog();
    render();
    toast(`Reading saved · ${s.name}`);
  }

  function submitNeeds(form) {
    const { spaceId, needs, errors } = EV.readNeedsForm(form);
    if (errors.length) { setError(form, errors); return; }
    const id = form.dataset.id;
    ES.setSpaceOf(id, spaceId);
    ES.setNeeds(id, needs);
    closeDialog();
    render();
    toast(`${id} needs saved`);
  }

  async function pairInDialog(btn) {
    const form = btn.closest('form');
    try {
      const dev = await SN.pairBle();
      form.elements.deviceId.value = dev.id;
      form.elements.deviceName.value = dev.name;
      form.querySelector('[data-pair-label]').textContent = `Paired: ${dev.name}`;
      if (!form.elements.name.value.trim()) form.elements.name.value = dev.name;
      setError(form, []);
    } catch (err) {
      if (err && err.name === 'NotFoundError') return;
      setError(form, [err.message || 'Pairing failed.']);
    }
  }

  async function testHttp(btn) {
    const form = btn.closest('form');
    const out = form.querySelector('[data-test-result]');
    const { fields, errors } = EV.readSensorForm(form);
    const blocking = errors.filter((e) => /URL|measurement/.test(e));
    if (blocking.length) { out.className = 'test-result t-flag'; out.textContent = blocking.join(' '); return; }
    if (!fields.config.token && form.dataset.id) {
      const prev = ES.sensor(form.dataset.id);
      if (prev && prev.config.token) fields.config.token = prev.config.token;
    }
    out.className = 'test-result';
    out.textContent = 'Testing…';
    btn.disabled = true;
    try {
      const { values, problems } = await SN.readHttp(fields.config);
      const v = SN.normalizeUnits({ config: fields.config }, values);
      const u = ES.unit();
      out.className = 'test-result t-nominal';
      out.textContent = `OK: ${Object.keys(v).map((k) => H.env.fmtValue(k, v[k], u, true)).join(' · ')}${problems.length ? `. ${problems.join('; ')}` : ''}`;
    } catch (err) {
      out.className = 'test-result t-flag';
      out.textContent = err.message;
    } finally {
      btn.disabled = false;
    }
  }

  /* ---------- Import / export / reset ----------------------------------- */

  function exportData() {
    const payload = S.exportPayload();
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `herd-backup-${U.todayISO()}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    S.markExported();
    renderShell();
    toast(`Exported ${payload.subjects.length} subjects · ${payload.entries.length} entries`);
  }

  function pickImport() {
    fileInput.value = '';
    fileInput.click();
  }

  async function importFile(file) {
    if (file.size > 20 * 1024 * 1024) {
      await alertDialog('Import failed', 'That file is larger than 20 MB, which is more than a Herd export should be.');
      return;
    }
    let parsed;
    try {
      parsed = JSON.parse(await file.text());
    } catch (err) {
      await alertDialog('Import failed', 'The file is not valid JSON.');
      return;
    }
    const res = S.validate(parsed);
    if (!res.ok) {
      await alertDialog('Import failed', res.error);
      return;
    }
    const cur = S.counts();
    const next = res.data;
    const envRes = parsed.environment ? ES.validate(parsed.environment) : null;
    const envOk = envRes && envRes.ok;
    const skipped = res.dropped ? ` ${res.dropped} invalid ${res.dropped === 1 ? 'row was' : 'rows were'} skipped.` : '';
    const envNote = envOk
      ? ` Environment: ${envRes.data.spaces.length} spaces and ${envRes.data.sensors.length} sensors will also be replaced (access tokens are never in exports; re-enter them for Wi‑Fi sensors).`
      : ' The file has no environment section, so spaces and sensors stay as they are.';
    const ok = await confirmDialog({
      eyebrow: 'Import',
      title: 'Replace current data?',
      bodyHTML: `This browser holds <strong>${cur.subjects}</strong> subjects and <strong>${cur.entries}</strong> entries. `
        + `The file contains <strong>${next.subjects.length}</strong> subjects and <strong>${next.entries.length}</strong> entries, which will replace them.${esc(skipped)}${esc(envNote)}`,
      confirmLabel: 'Replace data',
    });
    if (!ok) return;
    S.replaceAll(next);
    if (envOk) { ES.replace(envRes.data); SN.sync(); }
    state.filter = 'all';
    navigate('#/');
    toast(`Imported ${next.subjects.length} subjects · ${next.entries.length} entries`);
  }

  async function resetSample() {
    const ok = await confirmDialog({
      eyebrow: 'Reset',
      title: 'Reset to sample data?',
      bodyHTML: 'All subjects, entries, spaces and sensors in this browser will be replaced with the sample data. Export first if you want to keep your records.',
      confirmLabel: 'Reset data',
      danger: true,
    });
    if (!ok) return;
    S.resetToSample();
    ES.resetToSample();
    SN.sync();
    state.filter = 'all';
    navigate('#/');
    toast('Sample data restored');
  }

  /* ---------- Command palette ------------------------------------------- */

  let palItems = [];
  let palIndex = 0;
  let palReturn = null;

  function commands() {
    const list = [];
    const today = U.todayISO();
    S.subjects().forEach((s) => {
      const st = B.analyze(S.entries(s.id)).status;
      const note = st.notes[0] ? V.notePlain(st.notes[0]) : '';
      list.push({
        group: 'Subjects', key: `${s.id} ${s.name} ${s.species} ${s.breed}`,
        icon: V.sil(s.species, st.level), id: s.id, title: s.name, sub: [`${V.LEVEL_LABEL[st.level]}`, note].filter(Boolean).join(' · '), go: 'Open',
        run: () => navigate(`#/s/${s.id}`),
      });
    });
    S.subjects().forEach((s) => {
      const done = S.entryOn(s.id, today);
      list.push({
        group: 'Log', key: `log check in today entry ${s.id} ${s.name}`,
        icon: '<svg aria-hidden="true"><use href="#i-plus"/></svg>', id: s.id, title: `${done ? 'Edit today’s check-in' : 'Check in for today'}`, sub: s.name, go: 'Open',
        run: () => openTodayDialog(s.id), secondary: true,
      });
    });
    ES.spaces().forEach((sp) => {
      list.push({ group: 'Spaces', key: `space ${sp.id} ${sp.name}`, icon: '<svg aria-hidden="true"><use href="#i-env"/></svg>', id: sp.id, title: sp.name, sub: `${ES.residentsOf(sp.id).length} residents`, go: 'Edit', run: () => openDialog(EV.spaceForm(ES.space(sp.id))) });
    });
    const act = (title, key, sub, run, icon) => list.push({ group: 'Actions', key: `${title} ${key}`, icon: `<svg aria-hidden="true"><use href="#${icon || 'i-plus'}"/></svg>`, title, sub, go: 'Run', run });
    act('New animal', 'add create subject', 'Shortcut N', () => openSubjectDialog());
    act('Field', 'overview home subjects go', 'Shortcut G then F', () => navigate('#/'), 'i-field');
    act('Environment', 'spaces sensors climate go', 'Shortcut G then E', () => navigate('#/env'), 'i-env');
    act('Add sensor', 'new bluetooth wifi manual simulated', '', () => openSensorDialog(null), 'i-env');
    act('Add space', 'new room pen stall barn', '', () => openDialog(EV.spaceForm(null)), 'i-env');
    act('Export backup', 'download json save', 'Downloads every record as JSON', exportData, 'i-search');
    act('Import backup', 'upload json restore', 'Replaces the data in this browser', pickImport, 'i-search');
    act(`Switch to ${state.theme === 'light' ? 'dark' : 'light'} theme`, 'theme dark light mode appearance', '', toggleTheme, state.theme === 'light' ? 'i-moon' : 'i-sun');
    if (LOCKED_COPY) act('Lock this device', 'lock sign out logout passphrase', 'Forgets the saved key and shows the gate', lock, 'i-lock');
    act('Public site', 'landing website home page', '', () => { location.href = '../'; }, 'i-mark');
    return list;
  }

  function score(item, q) {
    if (!q) return item.secondary ? -1 : 1;
    const hay = `${item.id || ''} ${item.title} ${item.key} ${item.sub || ''}`.toLowerCase();
    let s = 0;
    for (const term of q.split(/\s+/).filter(Boolean)) {
      const i = hay.indexOf(term);
      if (i < 0) return -1;
      s += i === 0 ? 4 : /\s/.test(hay[i - 1]) ? 3 : 1;
    }
    if ((item.id || '').toLowerCase().includes(q)) s += 5;
    return s;
  }

  function hilite(text, q) {
    const t = esc(text);
    if (!q) return t;
    const terms = q.split(/\s+/).filter((x) => x.length > 1).map((x) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    if (!terms.length) return t;
    return t.replace(new RegExp(`(${terms.join('|')})`, 'ig'), '<mark>$1</mark>');
  }

  function renderPalette() {
    const q = palInput.value.trim().toLowerCase();
    const all = commands();
    palItems = all.map((it) => ({ it, s: score(it, q) })).filter((x) => x.s >= 0)
      .sort((a, b) => (q ? b.s - a.s : 0)).map((x) => x.it);
    if (!q) palItems = palItems.filter((it) => it.group !== 'Log' && it.group !== 'Spaces').concat(all.filter((it) => it.group === 'Spaces'));
    palItems = palItems.slice(0, 40);
    palIndex = Math.min(palIndex, Math.max(0, palItems.length - 1));
    if (!palItems.length) {
      palList.innerHTML = `<li class="pal-empty">Nothing matches “${esc(palInput.value)}”.</li>`;
      palInput.removeAttribute('aria-activedescendant');
      return;
    }
    let group = '';
    palList.innerHTML = palItems.map((it, i) => {
      const head = !q && it.group !== group ? `<li class="pal-group" role="presentation">${esc(it.group)}</li>` : '';
      group = it.group;
      return `${head}<li class="pal-item" role="option" id="pal-${i}" data-i="${i}" aria-selected="${i === palIndex}">
        <span class="ic">${it.icon}</span>
        <span class="tx">${it.id ? `<span class="id">${hilite(it.id, q)}</span>` : ''}<b>${hilite(it.title, q)}</b>${it.sub ? `<small>${esc(it.sub)}</small>` : ''}</span>
        <span class="go">${esc(it.go || '')}</span>
      </li>`;
    }).join('');
    palInput.setAttribute('aria-activedescendant', `pal-${palIndex}`);
  }

  function movePalette(d) {
    if (!palItems.length) return;
    palIndex = (palIndex + d + palItems.length) % palItems.length;
    palList.querySelectorAll('.pal-item').forEach((el) => el.setAttribute('aria-selected', String(Number(el.dataset.i) === palIndex)));
    palInput.setAttribute('aria-activedescendant', `pal-${palIndex}`);
    const el = document.getElementById(`pal-${palIndex}`);
    if (el) el.scrollIntoView({ block: 'nearest' });
  }

  function openPalette(seed) {
    if (dlg.open) return;
    palReturn = document.activeElement;
    pal.hidden = false;
    palInput.value = seed || '';
    palIndex = 0;
    renderPalette();
    palInput.focus();
    document.documentElement.style.overflow = 'hidden';
  }

  function closePalette(refocus) {
    if (pal.hidden) return;
    pal.hidden = true;
    document.documentElement.style.overflow = '';
    if (refocus !== false && palReturn && document.contains(palReturn)) palReturn.focus({ preventScroll: true });
  }

  function runPalette(i) {
    const it = palItems[i];
    if (!it) return;
    closePalette(false);
    it.run();
  }

  palInput.addEventListener('input', () => { palIndex = 0; renderPalette(); });
  palInput.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); movePalette(1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); movePalette(-1); }
    else if (e.key === 'Enter') { e.preventDefault(); runPalette(palIndex); }
    else if (e.key === 'Escape') { e.preventDefault(); closePalette(); }
    else if (e.key === 'Tab') e.preventDefault();
  });
  palList.addEventListener('mousemove', (e) => {
    const li = e.target.closest('.pal-item');
    if (li && Number(li.dataset.i) !== palIndex) movePalette(Number(li.dataset.i) - palIndex);
  });
  palList.addEventListener('click', (e) => {
    const li = e.target.closest('.pal-item');
    if (li) runPalette(Number(li.dataset.i));
  });
  pal.addEventListener('mousedown', (e) => { if (e.target === pal) closePalette(); });

  /* ---------- Keyboard shortcuts ---------------------------------------- */

  let gPending = 0;
  document.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K')) {
      e.preventDefault();
      if (pal.hidden) openPalette(); else closePalette();
      return;
    }
    if (e.metaKey || e.ctrlKey || e.altKey || dlg.open || !pal.hidden) return;
    const t = e.target;
    if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
    const k = e.key.toLowerCase();
    if (gPending) {
      gPending = 0;
      if (k === 'f') { e.preventDefault(); navigate('#/'); }
      else if (k === 'e') { e.preventDefault(); navigate('#/env'); }
      return;
    }
    if (k === '/') { e.preventDefault(); openPalette(); }
    else if (k === 'n') { e.preventDefault(); openSubjectDialog(); }
    else if (k === 'g') { gPending = setTimeout(() => { gPending = 0; }, 900); }
    else if (k === 'l' && current && current.name === 'subject') { e.preventDefault(); focusEntry(); }
  });

  /* ---------- Events ----------------------------------------------------- */

  document.addEventListener('click', (ev) => {
    const t = ev.target.closest('[data-action]');
    if (!t) return;
    const id = t.dataset.id;
    switch (t.dataset.action) {
      case 'new-subject': openSubjectDialog(); break;
      case 'edit-subject': openSubjectDialog(id); break;
      case 'delete-subject': deleteSubject(id); break;
      case 'edit-entry': openEntryDialog(id); break;
      case 'delete-entry': deleteEntry(id); break;
      case 'log-entry': openTodayDialog(id); break;
      case 'focus-entry': focusEntry(); break;
      case 'ef-day': case 'ef-act': case 'ef-tag': case 'ef-wake': {
        const f = t.closest('form[data-form="entry"]');
        if (f) V.entryAction(f, t);
        break;
      }
      case 'close-dialog': closeDialog(); break;
      case 'export': exportData(); break;
      case 'import': pickImport(); break;
      case 'reset': resetSample(); break;
      case 'palette': openPalette(); break;
      case 'theme': toggleTheme(); break;
      case 'lock': lock(); break;
      case 'filter': {
        const f = t.dataset.filter;
        state.filter = state.filter === f ? 'all' : f;
        render();
        break;
      }
      case 'range': state.range = t.dataset.range; saveUI(); render(); break;
      case 'log-all': state.logAll = true; render(); break;
      case 'unit': ES.setUnit(t.dataset.unit); render(); break;
      case 'new-space': openDialog(EV.spaceForm(null)); break;
      case 'edit-space': openDialog(EV.spaceForm(ES.space(id))); break;
      case 'delete-space': deleteSpace(id); break;
      case 'new-sensor': openSensorDialog(null, t.dataset.space); break;
      case 'edit-sensor': openSensorDialog(id); break;
      case 'remove-sensor': removeSensor(id); break;
      case 'toggle-sensor': toggleSensor(id); break;
      case 'read-sensor': readSensor(id); break;
      case 'connect-sensor': connectSensor(id); break;
      case 'log-reading': openDialog(EV.manualForm(ES.sensor(id)), true); break;
      case 'edit-needs': openDialog(EV.needsForm(S.subject(id))); break;
      case 'clear-needs': {
        const f = t.closest('form');
        f.querySelectorAll('.needs input, input[name="note"]').forEach((i) => { i.value = ''; });
        break;
      }
      case 'ble-pair': pairInDialog(t); break;
      case 'test-http': testHttp(t); break;
      default: break;
    }
  });

  document.addEventListener('submit', (ev) => {
    const form = ev.target.closest('form[data-form]');
    if (!form) return; // method="dialog" confirm forms close natively
    ev.preventDefault();
    if (form.dataset.form === 'entry') submitEntry(form);
    else if (form.dataset.form === 'subject') submitSubject(form);
    else if (form.dataset.form === 'space') submitSpace(form);
    else if (form.dataset.form === 'sensor') submitSensor(form);
    else if (form.dataset.form === 'manual') submitManual(form);
    else if (form.dataset.form === 'needs') submitNeeds(form);
  });

  const onFormInput = (ev) => {
    const sensorForm = ev.target.closest('form[data-form="sensor"]');
    if (sensorForm) { EV.syncSensorForm(sensorForm); return; }
    const form = ev.target.closest('form[data-form="entry"]');
    if (!form) return;
    const q = ev.target.closest('[data-field]');
    if (q) q.removeAttribute('aria-invalid');
    if (ev.target.removeAttribute) ev.target.removeAttribute('aria-invalid');
    V.syncEntry(form, ev.target);
    V.updatePreview(form);
  };
  document.addEventListener('input', onFormInput);
  document.addEventListener('change', onFormInput);

  fileInput.addEventListener('change', () => {
    const file = fileInput.files && fileInput.files[0];
    if (file) importFile(file);
  });

  window.addEventListener('hashchange', () => { closePalette(false); render({ fromHash: true }); });

  // Keep multiple open tabs in sync.
  window.addEventListener('storage', (e) => {
    if (e.key === S.KEY) {
      S.load();
      if (!dlg.open) render();
    } else if (e.key === ES.KEY) {
      // Another tab changed sensor config. Readings from two tabs would interleave,
      // so this tab adopts the stored state; only one tab should run sensors.
      ES.load();
      SN.sync();
      scheduleLive();
    }
  });

  /* ---------- Boot ------------------------------------------------------- */

  applyTheme(state.theme);
  S.load();
  ES.load();
  SN.sync();
  render();
})(window.Herd = window.Herd || {});
