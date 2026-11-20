/* Herd · app controller
   Hash routing (works on GitHub Pages with no server config), delegated
   events, dialogs, import/export. */
(function (H) {
  'use strict';

  const U = H.util;
  const S = H.store;
  const V = H.views;
  const B = H.baseline;
  const C = H.charts;

  const main = document.getElementById('main');
  const dlg = document.getElementById('dialog');
  const fileInput = document.getElementById('import-file');
  const toastEl = document.getElementById('toast');
  const lastExportEl = document.getElementById('last-export');

  /* ---------- UI state (per browser, cosmetic only) ---------------------- */

  const UI_KEY = 'herd:ui';
  const RANGE_KEYS = ['14', '30', '90', 'all'];
  const state = { filter: 'all', range: '30', logAll: false };

  try {
    const saved = JSON.parse(localStorage.getItem(UI_KEY) || '{}');
    if (RANGE_KEYS.includes(saved.range)) state.range = saved.range;
  } catch (err) { /* defaults */ }

  function saveUI() {
    try { localStorage.setItem(UI_KEY, JSON.stringify({ range: state.range })); } catch (err) { /* ignore */ }
  }

  /* ---------- Routing ---------------------------------------------------- */

  let current = null;

  function parseRoute() {
    const h = decodeURIComponent(location.hash.replace(/^#\/?/, ''));
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
    const view = r.name === 'subject' ? V.subject(state, r.id) : V.overview(state);
    main.innerHTML = view.html;
    document.title = view.title;
    if (changed) {
      const el = main.firstElementChild;
      if (el) el.classList.add('enter');
    }
    if (view.mount) view.mount(main);
    main.querySelectorAll('form[data-form="entry"]').forEach(V.updatePreview);
    renderFooter();

    if (changed && o.fromHash) {
      window.scrollTo(0, 0);
      main.focus({ preventScroll: true });
    }
  }

  function renderFooter() {
    const at = S.meta().lastExportAt;
    if (!at) {
      lastExportEl.textContent = 'Last export: never';
      return;
    }
    const d = new Date(at);
    const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    lastExportEl.textContent = `Last export: ${U.fmtDate(iso)} (${U.fmtAgo(iso)})`;
  }

  /* ---------- Toast ------------------------------------------------------ */

  let toastTimer = 0;
  function toast(msg, level) {
    toastEl.innerHTML = `${level ? `<span class="dot ${level}"></span>` : ''}<span>${U.esc(msg)}</span>`;
    // restart the transition
    toastEl.classList.remove('on');
    void toastEl.offsetWidth;
    toastEl.classList.add('on');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove('on'), 2800);
  }

  /* ---------- Dialogs ---------------------------------------------------- */

  let resolveConfirm = null;
  let returnFocus = null;

  function openDialog(html, narrow) {
    returnFocus = document.activeElement;
    dlg.classList.toggle('narrow', Boolean(narrow));
    dlg.returnValue = '';
    dlg.innerHTML = html;
    if (!dlg.open) dlg.showModal();
    const target = dlg.querySelector('[autofocus]') || dlg.querySelector('input:not([type=hidden]), select, textarea');
    if (target) target.focus();
  }

  function closeDialog() {
    if (dlg.open) dlg.close();
  }

  dlg.addEventListener('close', () => {
    if (resolveConfirm) {
      const r = resolveConfirm;
      resolveConfirm = null;
      r(dlg.returnValue === 'confirm');
    }
    dlg.innerHTML = '';
    if (returnFocus && document.contains(returnFocus)) returnFocus.focus({ preventScroll: true });
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
    return confirmDialog({ eyebrow: 'Notice', title, bodyHTML: U.esc(message), confirmLabel: 'OK', cancel: false });
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
      bodyHTML: `This permanently removes <strong>${U.esc(s.name)}</strong> and ${n} ${n === 1 ? 'entry' : 'entries'} from this browser. The ID will not be reused. Export first if you need a copy.`,
      confirmLabel: 'Delete subject',
      danger: true,
    });
    if (!ok) return;
    S.deleteSubject(id);
    navigate('#/');
    toast(`${id} deleted`);
  }

  /* ---------- Entries ---------------------------------------------------- */

  function openEntryDialog(id) {
    const e = S.entry(id);
    if (!e) return;
    const s = S.subject(e.subjectId);
    openDialog(V.entryDialog(s, e));
    const form = dlg.querySelector('form[data-form="entry"]');
    if (form) V.updatePreview(form);
  }

  function submitEntry(form) {
    const { values, errors } = V.readEntryForm(form);
    V.markErrors(form, errors);
    if (errors.length) {
      const first = form.querySelector('[aria-invalid="true"]');
      if (first) (first.matches('.radios') ? first.querySelector('input') : first).focus();
      return;
    }

    const subjectId = form.dataset.subject;
    const saved = S.saveEntry(subjectId, values, form.dataset.entryId || null);
    if (form.closest('dialog')) closeDialog();
    render();

    const ev = B.analyze(S.entries(subjectId)).evals.get(saved.id);
    const label = V.LEVEL_LABEL[ev.level];
    const detail = ev.notes.length ? ` · ${ev.notes[0].text}` : '';
    toast(`Saved ${U.fmtDate(saved.date)} · ${label}${detail}`, ev.level);
  }

  async function deleteEntry(id) {
    const e = S.entry(id);
    if (!e) return;
    const ok = await confirmDialog({
      eyebrow: 'Delete entry',
      title: `Delete the ${U.fmtDate(e.date)} entry?`,
      bodyHTML: `This removes the ${U.esc(U.fmtDateLong(e.date))} entry for <span class="mono">${U.esc(e.subjectId)}</span>. Baselines for the following 14 days will be recalculated.`,
      confirmLabel: 'Delete entry',
      danger: true,
    });
    if (!ok) return;
    S.deleteEntry(id);
    render();
    toast(`Entry ${U.fmtDate(e.date)} deleted`);
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
    renderFooter();
    toast(`Exported ${payload.subjects.length} subjects · ${payload.entries.length} entries`);
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
    const skipped = res.dropped ? ` ${res.dropped} invalid ${res.dropped === 1 ? 'row was' : 'rows were'} skipped.` : '';
    const ok = await confirmDialog({
      eyebrow: 'Import',
      title: 'Replace current data?',
      bodyHTML: `This browser holds <span class="mono">${cur.subjects}</span> subjects and <span class="mono">${cur.entries}</span> entries. `
        + `The file contains <span class="mono">${next.subjects.length}</span> subjects and <span class="mono">${next.entries.length}</span> entries, which will replace them.${U.esc(skipped)}`,
      confirmLabel: 'Replace data',
    });
    if (!ok) return;
    S.replaceAll(next);
    state.filter = 'all';
    navigate('#/');
    toast(`Imported ${next.subjects.length} subjects · ${next.entries.length} entries`);
  }

  async function resetSample() {
    const ok = await confirmDialog({
      eyebrow: 'Reset',
      title: 'Reset to sample data?',
      bodyHTML: 'All subjects and entries in this browser will be replaced with the two sample subjects. Export first if you want to keep your records.',
      confirmLabel: 'Reset data',
      danger: true,
    });
    if (!ok) return;
    S.resetToSample();
    state.filter = 'all';
    navigate('#/');
    toast('Sample data restored');
  }

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
      case 'close-dialog': closeDialog(); break;
      case 'export': exportData(); break;
      case 'import': fileInput.value = ''; fileInput.click(); break;
      case 'reset': resetSample(); break;
      case 'filter': {
        const f = t.dataset.filter;
        state.filter = state.filter === f ? 'all' : f;
        render();
        break;
      }
      case 'range': state.range = t.dataset.range; saveUI(); render(); break;
      case 'log-all': state.logAll = true; render(); break;
      default: break;
    }
  });

  document.addEventListener('submit', (ev) => {
    const form = ev.target.closest('form[data-form]');
    if (!form) return; // method="dialog" confirm forms close natively
    ev.preventDefault();
    if (form.dataset.form === 'entry') submitEntry(form);
    else if (form.dataset.form === 'subject') submitSubject(form);
  });

  const onFormInput = (ev) => {
    const form = ev.target.closest('form[data-form="entry"]');
    if (!form) return;
    if (ev.target.name) {
      const group = ev.target.closest('.radios');
      (group || ev.target).removeAttribute('aria-invalid');
    }
    V.updatePreview(form);
  };
  document.addEventListener('input', onFormInput);
  document.addEventListener('change', onFormInput);

  fileInput.addEventListener('change', () => {
    const file = fileInput.files && fileInput.files[0];
    if (file) importFile(file);
  });

  window.addEventListener('hashchange', () => render({ fromHash: true }));

  // Keep multiple open tabs in sync.
  window.addEventListener('storage', (e) => {
    if (e.key === S.KEY) {
      S.load();
      if (!dlg.open) render();
    }
  });

  /* ---------- Boot ------------------------------------------------------- */

  S.load();
  render();
})(window.Herd = window.Herd || {});
