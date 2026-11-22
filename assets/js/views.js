/* Herd · views
   Pure render functions: data in, HTML string out. Every user-supplied string
   passes through esc(). Charts are mounted after the HTML is in the DOM.
   Each page returns { title, crumbs, html, mount? }. */
(function (H) {
  'use strict';

  const U = H.util;
  const B = H.baseline;
  const S = H.store;
  const C = H.charts;
  const esc = U.esc;

  const LEVEL_LABEL = { nominal: 'Nominal', watch: 'Watch', flag: 'Flag', none: 'No data', calib: 'Calib.' };
  const RANK = { flag: 0, watch: 1, nominal: 2, none: 3 };
  const RANGES = [['14', '14D'], ['30', '30D'], ['90', '90D'], ['all', 'All']];
  const LOG_PAGE = 30;
  const MU = '<span class="lc">μ</span>';
  const SIGMA = '<span class="lc">σ</span>';

  const pill = (level, big) => `<span class="pill ${level}${big ? ' big' : ''}">${LEVEL_LABEL[level]}</span>`;

  function noteHTML(n, compact) {
    if (n.kind === 'delta') return compact ? `${esc(n.label)} ${U.fmtPct(n.pct)}` : `${esc(n.label)} ${U.fmtPct(n.pct)} vs 14-day baseline`;
    if (n.kind === 'recovery') return `Recovering · flagged ${U.fmtDate(n.date)}`;
    if (n.kind === 'calibrating') return `Baseline calibrating · <span class="lc">n</span>=${n.n}/${n.min}`;
    return esc(n.text);
  }

  /* ---------- Silhouettes (CC0, PhyloPic) by species preset ------------- */
  const SPRITES = ['cattle', 'horse', 'sheep', 'goat', 'pig', 'chicken', 'dog', 'cat', 'rabbit'];
  function sil(species, level, cls) {
    const p = H.env.profileFor(species);
    const k = SPRITES.includes(p.key) ? `sp-${p.key}` : 'i-mark';
    const lv = level === 'flag' || level === 'watch' ? ` ${level}` : '';
    return `<svg class="sil${lv}${cls ? ' ' + cls : ''}" aria-hidden="true"><use href="#${k}"/></svg>`;
  }

  function speciesLine(s) {
    return [s.species, s.breed].filter(Boolean).map(esc).join(' · ');
  }

  function storageBanner() {
    return S.isPersistent() ? '' : '<div class="banner" role="alert">Browser storage is unavailable (private mode or storage full). Changes will be lost on reload, so use Export to keep them.</div>';
  }

  function vhead(tag, title, sub, actions) {
    return `<div class="vhead">
      <div>
        <div class="vhead-tag"><span class="tag">${tag}</span><span class="hatch" aria-hidden="true"></span></div>
        <h1 class="display">${title}</h1>
        ${sub ? `<p class="vsub">${sub}</p>` : ''}
      </div>
      ${actions ? `<div class="vhead-actions">${actions}</div>` : ''}
    </div>`;
  }

  function dlgHead(eyebrow, titleHTML) {
    return `<div class="dlg-head">
      <div><p class="eyebrow">${eyebrow}</p><h2 class="dlg-title" id="dialog-title">${titleHTML}</h2></div>
      <button type="button" class="btn btn-quiet btn-sm" data-action="close-dialog" aria-label="Close">Close <kbd>esc</kbd></button>
    </div>`;
  }

  /* ======================================================================
     Field (overview)
     ====================================================================== */

  function overview(state) {
    const today = U.todayISO();
    const items = S.subjects().map((s) => ({ s, a: B.analyze(S.entries(s.id)) }));
    const counts = { all: items.length, nominal: 0, watch: 0, flag: 0 };
    items.forEach((it) => { if (it.a.status.level in counts) counts[it.a.status.level]++; });
    items.sort((x, y) => (RANK[x.a.status.level] - RANK[y.a.status.level]) || (x.s.id < y.s.id ? -1 : 1));

    const filter = state.filter;
    const shown = filter === 'all' ? items : items.filter((it) => it.a.status.level === filter);

    const tally = (key, label, n, sub) => `
      <button type="button" class="tally-btn" data-action="filter" data-filter="${key}" data-k="${key}" aria-pressed="${filter === key}">
        <span class="k">${key === 'all' ? '' : `<i class="dot ${key}"></i>`}${label}</span>
        <span class="v${n ? ' has' : ''}">${String(n).padStart(2, '0')}</span>
        <span class="s">${sub}</span>
      </button>`;

    let list;
    if (!items.length) {
      list = `<div class="panel empty">
          <p class="big">No subjects yet.</p>
          <p class="muted">Each animal gets a permanent ID and a baseline of its own.</p>
          <button type="button" class="btn btn-primary" data-action="new-subject"><span class="plus">+</span> New subject</button>
        </div>`;
    } else if (!shown.length) {
      list = `<div class="panel empty"><p class="big">No subjects on ${esc(LEVEL_LABEL[filter])}.</p>
          <button type="button" class="btn btn-sm" data-action="filter" data-filter="all">Show all subjects</button></div>`;
    } else {
      list = `<div class="ix" role="list" aria-label="Subjects">
          <div class="ix-head micro" aria-hidden="true">
            <span></span><span>ID</span><span>Subject</span><span>Last entry</span><span>Activity · 14D</span><span>Signal</span><span>Status</span><span></span>
          </div>
          ${shown.map((it) => subjectRow(it, today)).join('')}
        </div>`;
    }

    const actions = `<button type="button" class="btn" data-action="palette">Search <kbd>&#8984;K</kbd></button>
      <button type="button" class="btn btn-primary" data-action="new-subject"><span class="plus">+</span> New subject</button>`;

    return {
      title: 'Herd · Field',
      crumbs: [{ label: 'Field' }],
      html: `<section class="view">
        ${storageBanner()}
        ${vhead('000 · Field', 'Field', `${esc(U.fmtDateLong(today))} · ${items.length} ${items.length === 1 ? 'animal' : 'animals'} on record`, actions)}
        <div class="tally" role="group" aria-label="Filter subjects by status">
          ${tally('all', 'Subjects', counts.all, 'On record')}
          ${tally('nominal', 'Nominal', counts.nominal, 'Within baseline')}
          ${tally('watch', 'Watch', counts.watch, '20–29% below, or recovering')}
          ${tally('flag', 'Flag', counts.flag, '30%+ below, or low intake')}
        </div>
        ${items.length ? rounds(items, today) : ''}
        <section class="section" aria-labelledby="ix-h">
          <div class="section-head"><h2 id="ix-h"><span class="n">001</span>Subjects</h2><span class="section-meta">Most urgent first${filter !== 'all' ? ` · showing ${esc(LEVEL_LABEL[filter])}` : ''}</span></div>
          ${list}
        </section>
        ${H.envViews.overviewSummary()}
      </section>`,
    };
  }

  /* Today's rounds: who still needs today's entry. */
  function rounds(items, today) {
    const due = items.filter((it) => !S.entryOn(it.s.id, today));
    const done = items.length - due.length;
    const segs = items.length <= 32
      ? items.map((_, i) => `<i class="${i < done ? 'on' : ''}"></i>`).join('')
      : `<i class="on" style="flex:${done}"></i><i style="flex:${due.length}"></i>`;
    const list = due.length
      ? `<ul class="rounds-list">${due.slice(0, 6).map(({ s, a }) => {
        const last = a.status.latest;
        const why = last ? `Last entry ${U.fmtDate(last.date)} · ${U.fmtAgo(last.date, today)}` : 'No entries yet';
        return `<li class="rounds-item">
            ${sil(s.species, a.status.level)}
            <a class="who" href="#/s/${esc(s.id)}"><b>${esc(s.id)}</b><span>${esc(s.name)}</span><span class="why">${esc(why)}</span></a>
            <button type="button" class="btn btn-sm" data-action="log-entry" data-id="${esc(s.id)}">Log today</button>
          </li>`;
      }).join('')}${due.length > 6 ? `<li class="rounds-item"><span></span><span class="muted">and ${due.length - 6} more</span><span></span></li>` : ''}</ul>`
      : '<p class="rounds-done"><i class="dot nominal"></i>Everyone is logged for today.</p>';
    return `<section class="rounds" aria-labelledby="rounds-h">
      <div>
        <div class="rounds-k"><span class="pulse-dot dot ${due.length ? 'watch' : 'nominal'}"></span><h2 class="micro" id="rounds-h">Today&rsquo;s rounds</h2></div>
        <p class="rounds-v num">${done}<small>/ ${items.length} logged</small></p>
        <div class="rounds-bar" aria-hidden="true">${segs}</div>
      </div>
      ${list}
    </section>`;
  }

  function subjectRow({ s, a }, today) {
    const st = a.status;
    const last = st.latest;
    const recent = a.entries.slice(-14);
    const mean = a.current && a.current.ready ? a.current.activity.mean : null;
    const vals = recent.map((e) => e.activity);
    const hi = Math.max(30, ...vals, mean || 0) * 1.08;
    const spark = C.sparkline(vals, {
      width: 104, height: 26, domain: [0, hi], level: st.level, mean,
      label: `Activity, last ${recent.length} entries${recent.length ? `, latest ${recent[recent.length - 1].activity} min` : ''}`,
    });
    const stale = last && U.daysBetween(last.date, today) > 2;
    const notes = st.notes.slice(0, 2).map(noteHTML).join('<br>');
    const more = st.notes.length > 2 ? `<br><span class="more">+${st.notes.length - 2} more</span>` : '';
    const sub = [speciesLine(s), `${esc(s.sex)} · ${esc(U.ageLabel(s.ageYears, s.ageRecordedOn, today))}`].filter(Boolean).join(' · ');

    return `<a class="ix-row" role="listitem" href="#/s/${esc(s.id)}" aria-label="${esc(s.id)} ${esc(s.name)}, status ${LEVEL_LABEL[st.level]}">
      ${sil(s.species, st.level)}
      <span class="ix-id">${esc(s.id)}</span>
      <span class="ix-name"><b data-id="${esc(s.id)}">${esc(s.name)}</b><span>${sub}</span></span>
      <span class="ix-last">${last ? `<b>${U.fmtDate(last.date)}</b><span class="${stale ? 'stale' : ''}">${U.fmtAgo(last.date, today)}</span>` : '<span>No entries</span>'}</span>
      <span class="ix-spark">${spark}</span>
      <span class="ix-sig">${notes}${more}</span>
      <span class="ix-status">${pill(st.level)}</span>
      <span class="ix-go" aria-hidden="true">&rarr;</span>
    </a>`;
  }

  /* ======================================================================
     Subject record
     ====================================================================== */

  function subject(state, id) {
    const s = S.subject(id);
    if (!s) return notFound(id);

    const today = U.todayISO();
    const a = B.analyze(S.entries(id));
    const st = a.status;
    const first = a.entries[0];
    const todays = S.entryOn(id, today);
    const cfgs = chartConfigs(a, state.range, today);
    const fact = (k, v) => (v ? `<div><dt>${k}</dt><dd>${v}</dd></div>` : '');

    const html = `<section class="view">
      ${storageBanner()}
      <header class="rec-head">
        <div class="rec-frame" data-level="${st.level}">${sil(s.species, st.level)}</div>
        <div>
          <div class="rec-id"><span class="tag">Subject record</span>${pill(st.level, true)}</div>
          <h1 class="rec-title">${esc(s.id)}</h1>
          <p class="rec-name">${esc(s.name)}${s.breed ? ` <span>· ${esc(s.breed)}</span>` : ''}</p>
          <dl class="facts">
            ${fact('Species', esc(s.species))}
            ${fact('Sex', `<span title="${esc(U.SEX[s.sex])}">${esc(s.sex)}</span>`)}
            ${fact('Age', esc(U.ageLabel(s.ageYears, s.ageRecordedOn, today)))}
            ${fact('Record', `${a.entries.length} ${a.entries.length === 1 ? 'entry' : 'entries'}`)}
            ${fact('Since', first ? U.fmtDate(first.date) : '—')}
          </dl>
        </div>
        <div class="rec-actions">
          <button type="button" class="btn btn-primary" data-action="focus-entry">${todays ? 'Edit today' : 'Log today'} <kbd>L</kbd></button>
          <div class="row">
            <button type="button" class="btn btn-sm" data-action="edit-subject" data-id="${esc(s.id)}">Edit</button>
            <button type="button" class="btn btn-sm btn-danger" data-action="delete-subject" data-id="${esc(s.id)}">Delete</button>
          </div>
        </div>
      </header>

      ${signalPanel(st, today)}

      <div class="rec-grid">
        <div class="rec-main">
          ${baselinePanel(a)}
          <section class="section" aria-labelledby="trends-h">
            <div class="section-head">
              <h2 id="trends-h"><span class="n">002</span>Trends</h2>
              <div class="seg" role="group" aria-label="Chart range">
                ${RANGES.map(([k, l]) => `<button type="button" class="seg-btn" data-action="range" data-range="${k}" aria-pressed="${state.range === k}">${l}</button>`).join('')}
              </div>
            </div>
            <div class="charts">
              ${chartCard('energy', 'Energy', '1–5', a, st)}
              ${chartCard('activity', 'Activity', 'min', a, st)}
            </div>
          </section>
        </div>
        <aside class="rec-side" aria-label="Today">
          <section class="panel entry-card" id="entry" aria-labelledby="entry-h">
            <div class="section-head"><h2 id="entry-h">Entry · Today</h2><span class="section-meta">${esc(U.fmtDateLong(today))}${todays ? ' · recorded' : ''}</span></div>
            ${entryForm({ subjectId: s.id, entry: todays, date: today, prefix: 'today', mode: 'inline' })}
          </section>
          ${H.envViews.subjectPanel(s)}
        </aside>
      </div>
      ${logPanel(a, state)}
    </section>`;

    return {
      title: `${s.id} · ${s.name} · Herd`,
      crumbs: [{ label: 'Field', href: '#/' }, { label: s.id }],
      html,
      mount(root) {
        root.querySelectorAll('[data-chart]').forEach((el) => C.mount(el, cfgs[el.dataset.chart]));
      },
    };
  }

  function notFound(id) {
    return {
      title: 'Not found · Herd',
      crumbs: [{ label: 'Field', href: '#/' }, { label: 'Not found' }],
      html: `<section class="view">
        ${vhead('404', 'Not found', `No subject with ID <span class="mono">${esc(id)}</span>. It may have been deleted, or the data in this browser was replaced by an import.`, '<a class="btn" href="#/">Back to the field</a>')}
      </section>`,
    };
  }

  function signalPanel(st, today) {
    const when = st.latest ? `Latest entry ${U.fmtDate(st.latest.date)}<br>${U.fmtAgo(st.latest.date, today)}` : 'No entries yet';
    return `<section class="signal" data-level="${st.level}" aria-label="Current signal">
      <span class="signal-level">${LEVEL_LABEL[st.level]}</span>
      <ul class="signal-notes">${st.notes.map((n) => `<li class="${n.level === 'flag' || n.level === 'watch' ? 't-' + n.level : ''}"><span>${noteHTML(n)}</span></li>`).join('')}</ul>
      <span class="signal-when">${when}</span>
    </section>`;
  }

  function baselinePanel(a) {
    const c = a.current;
    const head = (meta) => `<div class="section-head">
        <h2 id="baseline-h"><span class="n">001</span>Baseline · 14D</h2>
        <span class="section-meta">${meta}</span>
      </div>`;
    const bar = (n) => `<div class="calib-bar" aria-hidden="true">${Array.from({ length: B.CONFIG.minEntries }, (_, i) => `<i class="${i < n ? 'on' : ''}"></i>`).join('')}</div>`;

    if (!c) {
      return `<section class="section" aria-labelledby="baseline-h">${head('No entries yet')}
        <div class="calib">The baseline forms from the first ${B.CONFIG.minEntries} entries. Log today&rsquo;s entry to begin.${bar(0)}</div></section>`;
    }

    const meta = `${U.fmtDate(c.from)} – ${U.fmtDate(c.to)} · <span class="lc">n</span>=${c.n} · reference for ${U.fmtDate(c.date)}`;

    if (!c.ready) {
      return `<section class="section" aria-labelledby="baseline-h">${head(meta)}
        <div class="calib">Calibrating: ${c.n} of ${B.CONFIG.minEntries} entries in the window. Energy and activity checks start at ${B.CONFIG.minEntries}; low intake is flagged from day one.${bar(c.n)}</div></section>`;
    }

    const kpi = (k, v, u, sub) => `<div class="kpi"><span class="k">${k}</span><span class="v num">${v}${u ? `<span class="u">${u}</span>` : ''}</span><span class="s">${sub}</span></div>`;
    const e = c.energy;
    const act = c.activity;
    const w = c.wake;

    return `<section class="section" aria-labelledby="baseline-h">${head(meta)}
      <div class="kpis">
        ${kpi(`Energy ${MU}`, U.fmtNum(e.mean, 1), '/ 5', `${SIGMA} ${U.fmtNum(e.sd, 2)} · ${e.min}–${e.max}`)}
        ${kpi(`Activity ${MU}`, U.fmtNum(act.mean, 0), 'min', `${SIGMA} ${U.fmtNum(act.sd, 1)} · ${act.min}–${act.max}`)}
        ${kpi(`Wake ${MU}`, w ? U.minToTime(w.mean) : '—', '', w ? `${SIGMA} ${Math.round(w.sd)} min · <span class="lc">n</span>=${w.n}` : 'no wake times logged')}
        ${kpi('Intake full', U.fmtNum(c.intakeFull * 100, 0), '%', `${Math.round(c.intakeFull * c.n)} of ${c.n} days`)}
      </div>
    </section>`;
  }

  function chartCard(key, label, unitLabel, a, st) {
    const latest = st.latest;
    let readout = '<span class="readout-v muted">—</span>';
    if (latest) {
      const ev = a.evals.get(latest.id);
      const d = ev.deltas[key];
      const lv = B.levelForPct(d);
      readout = `<span class="readout-v">${latest[key]}</span><span class="readout-u">${key === 'energy' ? '/ 5' : 'min'}</span>`
        + (d != null ? `<span class="readout-d ${lv}">${U.fmtPct(d)}</span>` : '');
    }
    return `<article class="panel chart-card">
      <div class="chart-top">
        <h3>${label}<span>${unitLabel}</span></h3>
        <div class="readout" title="Latest entry vs its 14-day baseline">${readout}</div>
      </div>
      <div class="chart" data-chart="${key}" tabindex="0"></div>
      <div class="legend" aria-hidden="true">
        <span><i class="lg"></i>Daily</span>
        <span><i class="lg lg-band"></i>${MU} ± 1${SIGMA}</span>
        <span><i class="lg lg-warn"></i>${U.MINUS}${B.CONFIG.watchDrop}%</span>
        <span><i class="lg lg-thr"></i>${U.MINUS}${B.CONFIG.flagDrop}%</span>
      </div>
    </article>`;
  }

  function chartConfigs(a, range, today) {
    const entries = a.entries;
    // Never spend chart width on time before the record began, but always
    // show at least 14 days so a new record isn't stretched edge to edge.
    const floor = U.addDays(today, -13);
    const first = entries.length ? entries[0].date : today;
    const recordStart = first < floor ? first : floor;
    const rangeStart = range === 'all' ? recordStart : U.addDays(today, -(Number(range) - 1));
    const start = rangeStart > recordStart ? rangeStart : recordStart;
    const c = a.current && a.current.ready ? a.current : null;
    // Baseline band = mean ± 1 SD; reference lines = mean, watch and flag thresholds.
    const band = (key) => (c ? { lo: c[key].mean - c[key].sd, hi: c[key].mean + c[key].sd } : null);
    const lines = (key) => (c ? [
      { value: c[key].mean, kind: 'mean', label: 'μ' },
      { value: c[key].mean * (1 - B.CONFIG.watchDrop / 100), kind: 'warn', label: `${U.MINUS}${B.CONFIG.watchDrop}%` },
      { value: c[key].mean * (1 - B.CONFIG.flagDrop / 100), kind: 'thr', label: `${U.MINUS}${B.CONFIG.flagDrop}%` },
    ] : []);
    const pts = (key) => entries.filter((e) => e.date >= start).map((e) => {
      const delta = a.evals.get(e.id).deltas[key];
      return { t: U.parseISO(e.date), value: e[key], delta, level: B.levelForPct(delta) };
    });
    const common = {
      t0: U.parseISO(start), t1: U.parseISO(today),
      xTicks: C.dayTicks, xLabel: C.dayLabel, gapMs: 2 * U.DAY_MS,
    };
    const mean = (key) => (c ? `Baseline mean ${U.fmtNum(c[key].mean, 1)}.` : '');

    const actPts = pts('activity');
    const actBand = band('activity');
    const actMax = Math.max(30, ...actPts.map((p) => p.value), actBand ? actBand.hi : 0);
    const actTicks = C.niceTicks(actMax, 3);

    return {
      energy: Object.assign({}, common, {
        label: 'Energy', unit: '/ 5', ariaExtra: mean('energy'),
        points: pts('energy'), domain: [1, 5], ticks: [1, 3, 5], band: band('energy'), lines: lines('energy'),
      }),
      activity: Object.assign({}, common, {
        label: 'Activity', unit: 'min', ariaExtra: mean('activity'),
        points: actPts, domain: [0, actTicks[actTicks.length - 1]], ticks: actTicks, band: actBand, lines: lines('activity'),
      }),
    };
  }

  /* ---------- Entry form -------------------------------------------------- */

  function radios(prefix, name, options, selected, extraClass) {
    return `<div class="radios ${extraClass || ''}" data-group="${name}">${options.map(([value, label]) => {
      const id = `${prefix}-${name}-${value}`;
      const checked = String(selected) === String(value) ? ' checked' : '';
      return `<input type="radio" id="${id}" name="${name}" value="${value}"${checked}><label for="${id}">${label}</label>`;
    }).join('')}</div>`;
  }

  function entryForm(o) {
    const e = o.entry || {};
    const p = o.prefix;
    const today = U.todayISO();
    const date = e.date || o.date || today;
    const isEdit = Boolean(e.id);
    const label = isEdit ? 'Update entry' : 'Save entry';

    return `<form class="entry-form" data-form="entry" data-subject="${esc(o.subjectId)}" data-entry-id="${esc(e.id || '')}" data-mode="${o.mode}" novalidate>
      <div class="ef-row">
        <div class="field">
          <label for="${p}-date">Date</label>
          <input class="input mono" type="date" id="${p}-date" name="date" value="${esc(date)}" max="${today}" required>
        </div>
        <div class="field">
          <label for="${p}-wake">Wake</label>
          <input class="input mono" type="time" id="${p}-wake" name="wake" value="${esc(e.wake || '')}">
        </div>
      </div>
      <div class="field">
        <label for="${p}-activity">Activity<span class="unit">minutes</span></label>
        <input class="input mono" type="number" id="${p}-activity" name="activity" inputmode="numeric" min="0" max="1440" step="1" placeholder="0" value="${e.activity != null ? esc(e.activity) : ''}" required>
      </div>
      <fieldset class="field">
        <legend>Food intake</legend>
        ${radios(p, 'intake', [['full', 'Full'], ['partial', 'Partial'], ['low', 'Low']], e.intake)}
      </fieldset>
      <fieldset class="field">
        <legend>Energy<span class="unit">1–5</span></legend>
        ${radios(p, 'energy', [[1, '1'], [2, '2'], [3, '3'], [4, '4'], [5, '5']], e.energy, 'mono')}
      </fieldset>
      <div class="field">
        <label for="${p}-behavior">Behavior note</label>
        <textarea class="input" id="${p}-behavior" name="behavior" rows="2" maxlength="500" placeholder="Routine, mood, exercise, context">${esc(e.behavior || '')}</textarea>
      </div>
      <div class="field">
        <label for="${p}-anomaly">Anomaly note</label>
        <textarea class="input" id="${p}-anomaly" name="anomaly" rows="2" maxlength="500" placeholder="Anything unusual: appetite, gait, stool, sleep">${esc(e.anomaly || '')}</textarea>
      </div>
      <div class="preview" data-preview aria-live="polite"></div>
      <div class="ef-actions">
        ${o.mode === 'dialog' ? '<button type="button" class="btn" data-action="close-dialog">Cancel</button>' : ''}
        <button type="submit" class="btn btn-primary" data-submit data-label="${label}">${label}</button>
      </div>
      <p class="form-error" data-error role="alert"></p>
    </form>`;
  }

  /* Read + validate. Returns { values, errors: [{ field, msg }] }. */
  function readEntryForm(form) {
    // namedItem returns an input or a RadioNodeList; both expose .value
    const get = (n) => {
      const el = form.elements.namedItem(n);
      return el ? el.value : '';
    };
    const today = U.todayISO();
    const errors = [];

    const date = get('date');
    if (!U.isISO(date)) errors.push({ field: 'date', msg: 'Enter a valid date.' });
    else if (date > today) errors.push({ field: 'date', msg: 'Entries can’t be in the future.' });

    const wake = get('wake');
    if (wake && !U.isTime(wake)) errors.push({ field: 'wake', msg: 'Wake time should be HH:MM.' });

    const intake = get('intake');
    if (!U.INTAKE[intake]) errors.push({ field: 'intake', msg: 'Select food intake.' });

    const energyRaw = get('energy');
    const energy = Number(energyRaw);
    if (!energyRaw || !(energy >= 1 && energy <= 5)) errors.push({ field: 'energy', msg: 'Select energy 1–5.' });

    const actRaw = String(get('activity')).trim();
    const activity = Number(actRaw);
    if (actRaw === '' || !Number.isFinite(activity) || activity < 0 || activity > 1440) {
      errors.push({ field: 'activity', msg: 'Activity must be 0–1440 minutes.' });
    }

    return {
      values: { date, wake, intake, energy, activity, behavior: get('behavior'), anomaly: get('anomaly') },
      errors,
    };
  }

  function markErrors(form, errors) {
    form.querySelectorAll('[aria-invalid]').forEach((el) => el.removeAttribute('aria-invalid'));
    errors.forEach((er) => {
      const group = form.querySelector(`.radios[data-group="${er.field}"]`);
      const el = group || form.elements.namedItem(er.field);
      if (el && el.setAttribute) el.setAttribute('aria-invalid', 'true');
    });
    const out = form.querySelector('[data-error]');
    if (out) out.textContent = errors.map((er) => er.msg).join(' ');
  }

  /* Live preview: evaluates the in-progress entry against the baseline for
     its date, so the flag shows before the entry is saved. */
  function updatePreview(form) {
    const out = form.querySelector('[data-preview]');
    const submit = form.querySelector('[data-submit]');
    if (!out) return;

    const subjectId = form.dataset.subject;
    const entryId = form.dataset.entryId || null;
    const { values } = readEntryForm(form);
    const all = S.entries(subjectId);

    const clash = U.isISO(values.date) ? all.find((e) => e.date === values.date && e.id !== entryId) : null;
    if (submit) submit.textContent = clash ? 'Save & replace' : submit.dataset.label;

    if (!U.isISO(values.date)) {
      out.innerHTML = '<span class="pv-label">Choose a date to preview the signal</span>';
      return;
    }

    const base = B.baselineFor(all, values.date, entryId);
    const complete = U.INTAKE[values.intake] && values.energy >= 1 && String(values.activity).trim() !== '' && Number.isFinite(Number(values.activity));
    const parts = [];

    if (complete) {
      const ev = B.evaluate({ intake: values.intake, energy: Number(values.energy), activity: Number(values.activity) }, base);
      parts.push(`<div class="pv-top"><span class="pv-label">Live preview</span>${pill(ev.level)}</div>`);
      parts.push(`<div class="pv-notes">${ev.notes.length ? ev.notes.map(noteHTML).join('<br>') : (base.ready ? 'Within its 14-day baseline' : 'Intake normal')}</div>`);
    } else {
      parts.push('<div class="pv-top"><span class="pv-label">Live preview</span></div><div class="pv-notes muted">Set activity, intake and energy to see the signal before you save.</div>');
    }

    parts.push(base.ready
      ? `<div class="pv-base">vs ${MU} energy ${U.fmtNum(base.energy.mean, 1)} · activity ${U.fmtNum(base.activity.mean, 0)} min · <span class="lc">n</span>=${base.n}</div>`
      : `<div class="pv-base">baseline calibrating · <span class="lc">n</span>=${base.n}/${B.CONFIG.minEntries}</div>`);
    if (clash) parts.push(`<div class="pv-warn">Replaces the existing entry for ${U.fmtDate(values.date)}.</div>`);

    out.innerHTML = parts.join('');
  }

  /* ---------- Log -------------------------------------------------------- */

  function logPanel(a, state) {
    const rows = a.entries.slice().reverse();
    const shown = state.logAll ? rows : rows.slice(0, LOG_PAGE);
    const meta = rows.length ? `${rows.length} ${rows.length === 1 ? 'entry' : 'entries'} · newest first` : 'No entries';

    let body;
    if (!rows.length) {
      body = '<div class="panel empty"><p class="big">No entries yet.</p><p class="muted">Use today&rsquo;s entry form to record the first day.</p></div>';
    } else {
      body = `<div class="log-wrap">
          <table class="log">
            <thead><tr>
              <th scope="col">Date</th>
              <th scope="col">Wake</th>
              <th scope="col">Intake</th>
              <th scope="col" class="r">Energy</th>
              <th scope="col" class="r">Activity</th>
              <th scope="col">Notes</th>
              <th scope="col">Signal</th>
              <th scope="col"><span class="visually-hidden">Actions</span></th>
            </tr></thead>
            <tbody>${shown.map((e) => logRow(e, a.evals.get(e.id))).join('')}</tbody>
          </table>
        </div>
        ${rows.length > shown.length ? `<div class="log-foot"><button type="button" class="btn btn-sm" data-action="log-all">Show all ${rows.length} entries</button></div>` : ''}`;
    }

    return `<section class="section" aria-labelledby="log-h">
      <div class="section-head">
        <h2 id="log-h"><span class="n">003</span>Log</h2>
        <span class="section-meta">${meta}</span>
      </div>
      ${body}
    </section>`;
  }

  function logRow(e, ev) {
    const level = ev.level === 'nominal' && ev.calibrating ? 'calib' : ev.level;
    const dE = ev.deltas.energy;
    const dA = ev.deltas.activity;
    const wakeBase = ev.base.wake && ev.base.n >= B.CONFIG.minEntries ? ev.base.wake.mean : null;
    const wakeMin = U.timeToMin(e.wake);
    const wakeDelta = wakeBase != null && wakeMin != null && Math.abs(wakeMin - wakeBase) >= 30
      ? `<span class="d">${U.fmtMinDelta(wakeMin - wakeBase)}</span>` : '';
    const delta = (d) => (d == null ? '' : `<span class="d ${B.levelForPct(d)}">${U.fmtPct(d)}</span>`);
    const notes = (e.behavior ? esc(e.behavior) : '')
      + (e.anomaly ? `<span class="anomaly">${esc(e.anomaly)}</span>` : '');
    const signal = ev.notes.length
      ? `<ul class="sig-notes">${ev.notes.map((n) => `<li>${noteHTML(n, true)}</li>`).join('')}</ul>`
      : (ev.calibrating ? `<ul class="sig-notes"><li>Baseline <span class="lc">n</span>=${ev.base.n}/${B.CONFIG.minEntries}</li></ul>` : '');

    return `<tr class="lv-${ev.level}">
      <td class="c-date"><span class="v">${U.fmtDate(e.date)}</span><span class="d">${U.fmtWeekday(e.date)}</span></td>
      <td class="c-wake" data-label="Wake"><span class="v">${e.wake ? esc(e.wake) : '—'}</span>${wakeDelta}</td>
      <td class="c-intake" data-label="Intake"><span class="intake-${e.intake}">${U.INTAKE[e.intake]}</span></td>
      <td class="c-energy r" data-label="Energy"><span class="v">${e.energy}</span>${delta(dE)}</td>
      <td class="c-activity r" data-label="Activity"><span class="v">${e.activity}<span class="u">min</span></span>${delta(dA)}</td>
      <td class="c-notes" data-label="Notes">${notes || '<span class="none">—</span>'}</td>
      <td class="c-signal">${pill(level)}${signal}</td>
      <td class="c-actions"><span class="row-actions">
        <button type="button" class="btn btn-quiet btn-sm" data-action="edit-entry" data-id="${esc(e.id)}" aria-label="Edit entry ${U.fmtDate(e.date)}">Edit</button>
        <button type="button" class="btn btn-quiet btn-sm btn-danger" data-action="delete-entry" data-id="${esc(e.id)}" aria-label="Delete entry ${U.fmtDate(e.date)}">Delete</button>
      </span></td>
    </tr>`;
  }

  /* ======================================================================
     Dialog bodies
     ====================================================================== */

  function subjectForm(s) {
    const today = U.todayISO();
    const isEdit = Boolean(s);
    const age = s ? U.currentAge(s.ageYears, s.ageRecordedOn, today) : null;
    const ageShown = age == null ? '' : String(Math.round(age * 10) / 10);
    const sexes = Object.keys(U.SEX).map((k) => `<option value="${k}"${s && s.sex === k ? ' selected' : ''}>${k} — ${U.SEX[k]}</option>`).join('');

    return `<form data-form="subject" data-id="${s ? esc(s.id) : ''}" data-age-shown="${esc(ageShown)}" novalidate>
      ${dlgHead(isEdit ? 'Edit subject' : 'New subject · ID is permanent', esc(s ? s.id : S.peekNextId()))}
      <div class="dlg-body">
        <div class="form-grid">
          <div class="field span-2">
            <label for="sf-name">Name</label>
            <input class="input" id="sf-name" name="name" maxlength="60" required value="${s ? esc(s.name) : ''}" placeholder="e.g. Dog 3" autocomplete="off" autofocus>
          </div>
          <div class="field">
            <label for="sf-species">Species</label>
            <input class="input" id="sf-species" name="species" maxlength="40" list="sf-species-list" value="${esc(s ? s.species : 'Dog')}" autocomplete="off">
            <datalist id="sf-species-list"><option value="Dog"><option value="Cat"><option value="Horse"><option value="Cow"><option value="Goat"><option value="Sheep"><option value="Pig"><option value="Rabbit"><option value="Chicken"></datalist>
          </div>
          <div class="field">
            <label for="sf-breed">Breed</label>
            <input class="input" id="sf-breed" name="breed" maxlength="60" value="${s ? esc(s.breed) : ''}" placeholder="Optional" autocomplete="off">
          </div>
          <div class="field">
            <label for="sf-sex">Sex</label>
            <select class="input" id="sf-sex" name="sex">${sexes}</select>
          </div>
          <div class="field">
            <label for="sf-age">Age<span class="unit">years</span></label>
            <input class="input mono" id="sf-age" name="age" type="number" inputmode="decimal" min="0" max="80" step="0.1" value="${esc(ageShown)}" placeholder="e.g. 2.5">
            <p class="hint">Advances automatically over the record.</p>
          </div>
        </div>
        <p class="form-error" data-error role="alert"></p>
        <div class="dlg-actions">
          <button type="button" class="btn" data-action="close-dialog">Cancel</button>
          <button type="submit" class="btn btn-primary">${isEdit ? 'Save changes' : 'Create subject'}</button>
        </div>
      </div>
    </form>`;
  }

  function entryDialog(subjectRec, entry, date) {
    const isEdit = Boolean(entry);
    const d = entry ? entry.date : date;
    return `${dlgHead(`${isEdit ? 'Edit entry' : 'New entry'} · <span class="lc">${esc(subjectRec.id)}</span>`, `${esc(subjectRec.name)} · ${U.fmtDate(d)}`)}
      <div class="dlg-body">
        ${entryForm({ subjectId: subjectRec.id, entry, date, prefix: 'dlg', mode: 'dialog' })}
      </div>`;
  }

  function confirmBody(o) {
    return `<form method="dialog">
      <div class="dlg-head"><div>
        <p class="eyebrow">${esc(o.eyebrow || 'Confirm')}</p>
        <h2 class="dlg-title" id="dialog-title">${esc(o.title)}</h2>
      </div></div>
      <div class="dlg-body">
        <p>${o.bodyHTML}</p>
        <div class="dlg-actions">
          ${o.cancel === false ? '' : `<button type="submit" class="btn" value="cancel">${esc(o.cancelLabel || 'Cancel')}</button>`}
          <button type="submit" class="btn ${o.danger ? 'btn-danger-solid' : 'btn-primary'}" value="confirm" autofocus>${esc(o.confirmLabel || 'Confirm')}</button>
        </div>
      </div>
    </form>`;
  }

  H.views = {
    overview, subject, subjectForm, entryDialog, confirmBody,
    readEntryForm, markErrors, updatePreview, noteHTML, pill, sil, dlgHead, vhead, LEVEL_LABEL,
  };
})(window.Herd = window.Herd || {});
