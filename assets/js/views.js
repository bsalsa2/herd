/* Herd · views
   Pure render functions: data in, HTML string out. Every user-supplied string
   passes through esc(). Charts are mounted after the HTML is in the DOM. */
(function (H) {
  'use strict';

  const U = H.util;
  const B = H.baseline;
  const S = H.store;
  const C = H.charts;
  const esc = U.esc;

  const LEVEL_LABEL = { nominal: 'Nominal', watch: 'Watch', flag: 'Flag', none: 'No data', calib: 'Calib.' };
  const RANGES = [['14', '14D'], ['30', '30D'], ['90', '90D'], ['all', 'All']];
  const LOG_PAGE = 30;

  const pill = (level) => `<span class="pill ${level}">${LEVEL_LABEL[level]}</span>`;

  function noteHTML(n) {
    if (n.kind === 'delta') return `${esc(n.label)} <span class="mono">${U.fmtPct(n.pct)}</span> vs 14-day baseline`;
    if (n.kind === 'recovery') return `Recovering · flagged <span class="mono">${U.fmtDate(n.date)}</span>`;
    if (n.kind === 'calibrating') return `Baseline calibrating · <span class="mono">n=${n.n}/${n.min}</span>`;
    return esc(n.text);
  }

  function speciesLine(s) {
    return [s.species, s.breed].filter(Boolean).map(esc).join(' · ');
  }

  /* ======================================================================
     Overview
     ====================================================================== */

  /* Binomial names, so every subject reads like a specimen record. */
  const LATIN = [
    [/\b(donkey|burro|ass)\b/, 'Equus asinus'],
    [/\b(dog|dogs|canine|puppy)\b/, 'Canis lupus familiaris'],
    [/\b(cat|cats|feline|kitten)\b/, 'Felis catus'],
    [/\b(horse|equine|pony|mare|gelding|stallion|foal)\b/, 'Equus caballus'],
    [/\b(cow|cows|cattle|bovine|calf|heifer|steer|bull)\b/, 'Bos taurus'],
    [/\b(pig|swine|hog|sow|boar|piglet)\b/, 'Sus domesticus'],
    [/\b(sheep|ewe|ram|lamb)\b/, 'Ovis aries'],
    [/\b(goat|goats|kid|doe)\b/, 'Capra hircus'],
    [/\b(rabbit|bunny)\b/, 'Oryctolagus cuniculus'],
    [/\b(chicken|hen|poultry|rooster|broiler|layer)\b/, 'Gallus gallus domesticus'],
  ];
  function latinName(species) {
    const v = String(species || '').toLowerCase();
    const hit = LATIN.find(([re]) => re.test(v));
    return hit ? hit[1] : '';
  }
  const specimenNo = (id) => 'No. ' + String(parseInt(String(id).slice(4), 10) || 0).padStart(3, '0');

  /* Sequence: the last 14 days as a barcode. Bar height = energy, colour =
     that day's signal; an empty slot is a day with no entry. */
  function sequence(a, today) {
    const byDate = new Map(a.entries.map((e) => [e.date, e]));
    const bars = [];
    let flags = 0;
    let logged = 0;
    for (let i = 13; i >= 0; i--) {
      const d = U.addDays(today, -i);
      const e = byDate.get(d);
      if (!e) { bars.push('<i class="none"></i>'); continue; }
      logged++;
      const ev = a.evals.get(e.id);
      const lv = ev.level === 'nominal' && ev.calibrating ? 'calib' : ev.level;
      if (lv === 'flag') flags++;
      bars.push(`<i class="${lv}" style="--h:${Math.round(18 + (e.energy - 1) * 20.5)}%"></i>`);
    }
    const label = `Last 14 days: ${logged} entries, ${flags} flagged`;
    return `<span class="seq" role="img" aria-label="${esc(label)}">${bars.join('')}</span>`;
  }

  function overview(state) {
    const today = U.todayISO();
    const items = S.subjects().map((s) => ({ s, a: B.analyze(S.entries(s.id)) }));
    const counts = { all: items.length, nominal: 0, watch: 0, flag: 0 };
    items.forEach((it) => { if (it.a.status.level in counts) counts[it.a.status.level]++; });

    const filter = state.filter;
    const shown = filter === 'all' ? items : items.filter((it) => it.a.status.level === filter);

    const tile = (key, label, n) => `
      <button type="button" class="tile" data-action="filter" data-filter="${key}" aria-pressed="${filter === key}">
        <span class="eyebrow">${key === 'all' ? '' : `<i class="dot ${key}"></i>`}${label}</span>
        <span class="tile-num">${n}</span>
      </button>`;

    let list;
    if (!items.length) {
      list = `<div class="panel empty">
          <p>No subjects yet.</p>
          <p class="muted">Each subject gets a permanent ID and its own baseline.</p>
          <button type="button" class="btn btn-primary" data-action="new-subject">New subject</button>
        </div>`;
    } else if (!shown.length) {
      list = `<div class="panel empty"><p>No subjects with status ${esc(LEVEL_LABEL[filter])}.</p>
          <p><button type="button" class="link-btn" data-action="filter" data-filter="all">Show all subjects</button></p></div>`;
    } else {
      list = `<ul class="list" aria-label="Subjects">
          <li class="list-head" aria-hidden="true">
            <span class="eyebrow">Specimen</span>
            <span class="eyebrow">Subject</span>
            <span class="eyebrow">Species</span>
            <span class="eyebrow h-last">Last entry</span>
            <span class="eyebrow">Sequence · 14D</span>
            <span class="eyebrow">Signal</span>
            <span class="eyebrow r">Status</span>
          </li>
          ${shown.map((it) => subjectRow(it, today)).join('')}
        </ul>`;
    }

    return {
      title: 'Herd · Subjects',
      html: `<section class="view">
        ${storageBanner()}
        <header class="hero">
          <p class="hero-kicker mono"><span>Herd</span><span>Longitudinal record</span><span>${esc(U.fmtDateLong(today))}</span></p>
          <div class="hero-top">
            <h1 class="hero-title">The herd,<br><em>observed.</em></h1>
            ${items.length ? `<figure class="plate panel" aria-label="Figure 1: energy and signal for each subject over the last 14 days">
              <figcaption class="plate-cap mono"><span>Fig. 1</span><span>Energy × signal · 14 days</span></figcaption>
              ${items.slice(0, 6).map((it) => `<div class="plate-row"><span class="plate-label mono">${specimenNo(it.s.id)}<b>${esc(it.s.name)}</b></span>${sequence(it.a, today)}</div>`).join('')}
              <div class="plate-axis mono"><span>${U.MINUS}13 d</span><span>Today</span></div>
            </figure>` : ''}
          </div>
          <div class="hero-foot">
            <p class="hero-lede">${heroLede(counts)}</p>
            <button type="button" class="btn btn-primary" data-action="new-subject">New subject <span aria-hidden="true">→</span></button>
          </div>
        </header>
        <div class="hairgrid tiles" role="group" aria-label="Filter subjects by status">
          ${tile('all', 'Subjects', counts.all)}
          ${tile('nominal', 'Nominal', counts.nominal)}
          ${tile('watch', 'Watch', counts.watch)}
          ${tile('flag', 'Flag', counts.flag)}
        </div>
        ${list}
        ${H.envViews.overviewSummary()}
      </section>`,
    };
  }

  function heroLede(c) {
    if (!c.all) return 'No subjects under observation yet. Each one gets a permanent ID and is measured only against itself.';
    const n = (k, one, many) => `${c[k]} ${c[k] === 1 ? one : many}`;
    const parts = [];
    if (c.flag) parts.push(`${n('flag', 'flagged', 'flagged')}`);
    if (c.watch) parts.push(`${n('watch', 'on watch', 'on watch')}`);
    const tail = parts.length ? parts.join(', ') + '.' : 'All within their own baselines.';
    return `${n('all', 'subject', 'subjects')} under continuous observation, each measured only against itself. ${tail}`;
  }

  function subjectRow({ s, a }, today) {
    const st = a.status;
    const last = st.latest;
    const stale = last && U.daysBetween(last.date, today) > 2;
    const notes = st.notes.slice(0, 2).map(noteHTML).join('<br>');
    const more = st.notes.length > 2 ? `<br><span class="more">+${st.notes.length - 2} more</span>` : '';

    return `<li><a class="subject-row" href="#/s/${esc(s.id)}" aria-label="${esc(s.id)} ${esc(s.name)}, status ${LEVEL_LABEL[st.level]}">
      <span class="c-id"><span class="no mono">${specimenNo(s.id)}</span><span class="sub mono">${esc(s.id)}</span></span>
      <span class="c-name"><span class="name">${esc(s.name)}</span><span class="sub mono" title="${esc(U.SEX[s.sex])}">${esc(s.sex)} · ${esc(U.ageLabel(s.ageYears, s.ageRecordedOn, today))}</span></span>
      <span class="c-species">${latinName(s.species) ? `<span class="latin">${esc(latinName(s.species))}</span>` : esc(s.species)}<span class="sub">${esc(s.breed || s.species)}</span></span>
      <span class="c-last mono">${last ? `${U.fmtDate(last.date)}<span class="sub${stale ? ' stale' : ''}">${U.fmtAgo(last.date, today)}</span>` : '<span class="sub">—</span>'}</span>
      <span class="c-spark">${sequence(a, today)}</span>
      <span class="c-signal">${notes}${more}</span>
      <span class="c-status">${pill(st.level)}</span>
    </a></li>`;
  }

  function storageBanner() {
    return S.isPersistent() ? '' : `<div class="banner" role="alert">Browser storage is unavailable (private mode or storage full). Changes will be lost on reload — use Export to keep them.</div>`;
  }

  /* ======================================================================
     Subject
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

    const html = `<section class="view">
      ${storageBanner()}
      <nav class="crumbs" aria-label="Breadcrumb"><a href="#/">Subjects</a><span aria-hidden="true">/</span><span class="mono">${esc(s.id)}</span></nav>

      <header class="s-head">
        <div>
          <div class="s-idrow">
            <span class="eyebrow">Specimen ${specimenNo(s.id)}</span>
            <span class="mono s-id">${esc(s.id)}</span>
            ${pill(st.level)}
          </div>
          <h1 class="s-name">${esc(s.name)}</h1>
          ${latinName(s.species) ? `<p class="s-latin">${esc(latinName(s.species))}</p>` : ''}
          <dl class="facts">
            <div><dt>Species</dt><dd>${esc(s.species)}</dd></div>
            ${s.breed ? `<div><dt>Breed</dt><dd>${esc(s.breed)}</dd></div>` : ''}
            <div><dt>Sex</dt><dd class="mono" title="${esc(U.SEX[s.sex])}">${esc(s.sex)}</dd></div>
            <div><dt>Age</dt><dd class="mono">${esc(U.ageLabel(s.ageYears, s.ageRecordedOn, today))}</dd></div>
            <div><dt>Record</dt><dd class="mono">${a.entries.length} ${a.entries.length === 1 ? 'entry' : 'entries'}${first ? ` · since ${U.fmtDate(first.date)}` : ''}</dd></div>
          </dl>
        </div>
        <div class="s-actions">
          <button type="button" class="btn" data-action="edit-subject" data-id="${esc(s.id)}">Edit</button>
          <button type="button" class="btn btn-danger" data-action="delete-subject" data-id="${esc(s.id)}">Delete</button>
        </div>
      </header>

      ${signalPanel(st)}
      ${H.envViews.subjectPanel(s)}
      ${baselinePanel(a)}

      <section class="section" aria-labelledby="trends-h">
        <div class="section-head">
          <h2 class="eyebrow" id="trends-h">Trends</h2>
          <div class="seg" role="group" aria-label="Chart range">
            ${RANGES.map(([k, l]) => `<button type="button" class="seg-btn" data-action="range" data-range="${k}" aria-pressed="${state.range === k}">${l}</button>`).join('')}
          </div>
        </div>
        <div class="charts">
          ${chartCard('energy', 'Energy', '1–5', a, st)}
          ${chartCard('activity', 'Activity', 'min', a, st)}
        </div>
      </section>

      <section class="section" aria-labelledby="entry-h">
        <div class="section-head">
          <h2 class="eyebrow" id="entry-h">Entry · Today</h2>
          <span class="section-meta mono">${U.fmtDateLong(today)}${todays ? ' · recorded' : ''}</span>
        </div>
        <div class="panel panel-body form-wrap">
          ${entryForm({ subjectId: s.id, entry: todays, date: today, prefix: 'today', mode: 'inline' })}
        </div>
      </section>

      ${logPanel(a, state)}
    </section>`;

    return {
      title: `${s.id} · ${s.name} · Herd`,
      html,
      mount(root) {
        root.querySelectorAll('[data-chart]').forEach((el) => C.mount(el, cfgs[el.dataset.chart]));
      },
    };
  }

  function notFound(id) {
    return {
      title: 'Not found · Herd',
      html: `<section class="view">
        <nav class="crumbs"><a href="#/">Subjects</a></nav>
        <div class="panel empty" style="margin-top:24px">
          <p>No subject with ID <span class="mono">${esc(id)}</span>.</p>
          <p class="muted">It may have been deleted, or the data in this browser was replaced by an import.</p>
          <p><a href="#/">Back to subjects</a></p>
        </div>
      </section>`,
    };
  }

  function signalPanel(st) {
    const when = st.latest ? `Latest entry <span class="mono">${U.fmtDate(st.latest.date)}</span>` : '';
    return `<section class="panel signal" aria-label="Current signal">
      <span class="eyebrow" style="line-height:22px">Signal</span>
      <ul class="signal-notes">${st.notes.map((n) => `<li class="${n.level === 'flag' || n.level === 'watch' ? 't-' + n.level : ''}"><span style="color:var(--text)">${noteHTML(n)}</span></li>`).join('')}</ul>
      <span class="signal-when">${when}</span>
    </section>`;
  }

  function baselinePanel(a) {
    const c = a.current;
    const head = (meta) => `<div class="section-head">
        <h2 class="eyebrow" id="baseline-h">Baseline · 14D</h2>
        <span class="section-meta">${meta}</span>
      </div>`;

    if (!c) {
      return `<section class="section" aria-labelledby="baseline-h">${head('No entries yet')}
        <div class="panel panel-body muted">The baseline forms from the first ${B.CONFIG.minEntries} entries. Record today's entry below to begin.</div></section>`;
    }

    const meta = `<span class="mono">${U.fmtDate(c.from)} – ${U.fmtDate(c.to)}</span> · <span class="mono">n=${c.n}</span> · reference for <span class="mono">${U.fmtDate(c.date)}</span>`;

    if (!c.ready) {
      return `<section class="section" aria-labelledby="baseline-h">${head(meta)}
        <div class="panel panel-body muted">Calibrating: ${c.n} of ${B.CONFIG.minEntries} entries in the window. Energy and activity checks start at ${B.CONFIG.minEntries}; low intake is flagged from day one.</div></section>`;
    }

    const stat = (k, v, u, sub) => `<div class="stat"><span class="eyebrow">${k}</span><span class="stat-v">${v}${u ? `<span class="u">${u}</span>` : ''}</span><span class="stat-s">${sub}</span></div>`;
    const e = c.energy;
    const act = c.activity;
    const w = c.wake;

    return `<section class="section" aria-labelledby="baseline-h">${head(meta)}
      <div class="hairgrid stats">
        ${stat('Energy <span class="greek">μ</span>', U.fmtNum(e.mean, 1), '/ 5', `σ ${U.fmtNum(e.sd, 2)} · range ${e.min}–${e.max}`)}
        ${stat('Activity <span class="greek">μ</span>', U.fmtNum(act.mean, 0), 'min', `σ ${U.fmtNum(act.sd, 1)} · range ${act.min}–${act.max}`)}
        ${stat('Wake <span class="greek">μ</span>', w ? U.minToTime(w.mean) : '—', '', w ? `σ ${Math.round(w.sd)} min · n=${w.n}` : 'no wake times logged')}
        ${stat('Intake full', U.fmtNum(c.intakeFull * 100, 0), '%', `${Math.round(c.intakeFull * c.n)} of ${c.n} days`)}
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
      <div class="panel-head">
        <div>
          <h3 class="eyebrow">${label} <span class="mono" style="letter-spacing:0;text-transform:none">${unitLabel}</span></h3>
        </div>
        <div class="readout" title="Latest entry vs its 14-day baseline">${readout}</div>
      </div>
      <div class="chart" data-chart="${key}" tabindex="0"></div>
      <div class="legend" aria-hidden="true">
        <span><i class="lg lg-line"></i>Daily</span>
        <span><i class="lg lg-band"></i>Baseline μ ± 1σ</span>
        <span><i class="lg lg-thr"></i>${U.MINUS}30% flag</span>
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
    // Baseline band = mean ± 1 SD; reference lines = mean and the −30% flag threshold.
    const band = (key) => (c ? { lo: c[key].mean - c[key].sd, hi: c[key].mean + c[key].sd } : null);
    const lines = (key) => (c ? [
      { value: c[key].mean, kind: 'mean', label: 'μ' },
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

    return `<form class="entry-form" data-form="entry" data-subject="${esc(o.subjectId)}" data-entry-id="${esc(e.id || '')}" data-mode="${o.mode}" novalidate>
      <div class="ef-a">
        <div class="field f-date">
          <label for="${p}-date">Date</label>
          <input class="input mono" type="date" id="${p}-date" name="date" value="${esc(date)}" max="${today}" required>
        </div>
        <div class="field f-wake">
          <label for="${p}-wake">Wake</label>
          <input class="input mono" type="time" id="${p}-wake" name="wake" value="${esc(e.wake || '')}">
        </div>
        <div class="field f-activity">
          <label for="${p}-activity">Activity<span class="unit">min</span></label>
          <input class="input mono" type="number" id="${p}-activity" name="activity" inputmode="numeric" min="0" max="1440" step="1" placeholder="0" value="${e.activity != null ? esc(e.activity) : ''}" required>
        </div>
        <fieldset class="field f-intake">
          <legend>Food intake</legend>
          ${radios(p, 'intake', [['full', 'Full'], ['partial', 'Partial'], ['low', 'Low']], e.intake)}
        </fieldset>
        <fieldset class="field f-energy">
          <legend>Energy<span class="unit">1–5</span></legend>
          ${radios(p, 'energy', [[1, '1'], [2, '2'], [3, '3'], [4, '4'], [5, '5']], e.energy, 'mono')}
        </fieldset>
      </div>
      <div class="ef-b">
        <div class="field">
          <label for="${p}-behavior">Behavior note</label>
          <textarea class="input" id="${p}-behavior" name="behavior" rows="2" maxlength="500" placeholder="Routine, mood, exercise, context">${esc(e.behavior || '')}</textarea>
        </div>
        <div class="field">
          <label for="${p}-anomaly">Anomaly note</label>
          <textarea class="input" id="${p}-anomaly" name="anomaly" rows="2" maxlength="500" placeholder="Anything unusual: appetite, gait, stool, sleep">${esc(e.anomaly || '')}</textarea>
        </div>
      </div>
      <div class="ef-foot">
        <div class="preview" data-preview aria-live="polite"></div>
        <div class="ef-actions">
          ${o.mode === 'dialog' ? '<button type="button" class="btn" data-action="close-dialog">Cancel</button>' : ''}
          <button type="submit" class="btn btn-primary" data-submit data-label="${isEdit ? 'Update entry' : 'Save entry'}">${isEdit ? 'Update entry' : 'Save entry'}</button>
        </div>
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
     its date, so the user sees a flag before saving it. */
  function updatePreview(form) {
    const out = form.querySelector('[data-preview]');
    const submit = form.querySelector('[data-submit]');
    if (!out) return;

    const subjectId = form.dataset.subject;
    const entryId = form.dataset.entryId || null;
    const { values } = readEntryForm(form);
    const all = S.entries(subjectId);
    const parts = [];

    const clash = U.isISO(values.date) ? all.find((e) => e.date === values.date && e.id !== entryId) : null;
    if (submit) submit.textContent = clash ? 'Save & replace' : submit.dataset.label;

    if (!U.isISO(values.date)) {
      out.innerHTML = '<span class="pv-label">Choose a date to preview.</span>';
      return;
    }

    const base = B.baselineFor(all, values.date, entryId);
    const complete = U.INTAKE[values.intake] && values.energy >= 1 && String(values.activity).trim() !== '' && Number.isFinite(Number(values.activity));

    if (complete) {
      const ev = B.evaluate({ intake: values.intake, energy: Number(values.energy), activity: Number(values.activity) }, base);
      parts.push(`<span class="pv-label">Preview</span>${pill(ev.level)}`);
      parts.push(`<span>${ev.notes.length ? ev.notes.map(noteHTML).join(' · ') : (base.ready ? 'Within 14-day baseline' : 'Intake normal')}</span>`);
    } else {
      parts.push('<span class="pv-label">Set intake, energy and activity to preview the signal.</span>');
    }

    if (base.ready) {
      parts.push(`<span class="pv-base mono">vs μ energy ${U.fmtNum(base.energy.mean, 1)} · activity ${U.fmtNum(base.activity.mean, 0)} min · n=${base.n}</span>`);
    } else {
      parts.push(`<span class="pv-base mono">baseline calibrating · n=${base.n}/${B.CONFIG.minEntries}</span>`);
    }
    if (clash) parts.push(`<span class="pv-warn">Replaces the existing entry for <span class="mono">${U.fmtDate(values.date)}</span>.</span>`);

    out.innerHTML = parts.join('');
  }

  /* ---------- Log -------------------------------------------------------- */

  function logPanel(a, state) {
    const rows = a.entries.slice().reverse();
    const shown = state.logAll ? rows : rows.slice(0, LOG_PAGE);
    const meta = rows.length
      ? `<span class="mono">${rows.length}</span> ${rows.length === 1 ? 'entry' : 'entries'} · newest first`
      : 'No entries';

    let body;
    if (!rows.length) {
      body = '<div class="panel empty"><p>No entries yet.</p><p class="muted">Use the form above to record the first day.</p></div>';
    } else {
      body = `<div class="panel">
        <div class="log-wrap">
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
        ${rows.length > shown.length ? `<div class="log-foot"><button type="button" class="btn btn-sm" data-action="log-all">Show all ${rows.length} entries</button></div>` : ''}
      </div>`;
    }

    return `<section class="section" aria-labelledby="log-h">
      <div class="section-head">
        <h2 class="eyebrow" id="log-h">Log</h2>
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
      ? `<ul class="sig-notes">${ev.notes.map((n) => `<li>${noteHTML(n)}</li>`).join('')}</ul>`
      : (ev.calibrating ? `<ul class="sig-notes"><li>Baseline <span class="mono">n=${ev.base.n}/${B.CONFIG.minEntries}</span></li></ul>` : '');

    return `<tr class="lv-${ev.level}">
      <td class="c-date"><span class="mono v">${U.fmtDate(e.date)}</span><span class="d">${U.fmtWeekday(e.date)}</span></td>
      <td class="c-wake" data-label="Wake"><span class="mono v">${e.wake ? esc(e.wake) : '—'}</span>${wakeDelta}</td>
      <td class="c-intake" data-label="Intake"><span class="intake-${e.intake}">${U.INTAKE[e.intake]}</span></td>
      <td class="c-energy r" data-label="Energy"><span class="mono v">${e.energy}</span>${delta(dE)}</td>
      <td class="c-activity r" data-label="Activity"><span class="mono v">${e.activity}<span class="u">min</span></span>${delta(dA)}</td>
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
      <div class="dlg-head">
        <div>
          <p class="eyebrow">${isEdit ? 'Edit subject' : 'New subject'}</p>
          <h2 class="dlg-title" id="dialog-title"><span class="mono">${esc(s ? s.id : S.peekNextId())}</span></h2>
        </div>
        <button type="button" class="btn btn-quiet btn-sm" data-action="close-dialog" aria-label="Close">Close</button>
      </div>
      <div class="dlg-body">
        <div class="form-grid">
          <div class="field span-2">
            <label for="sf-name">Name</label>
            <input class="input" id="sf-name" name="name" maxlength="60" required value="${s ? esc(s.name) : ''}" placeholder="e.g. Dog 3" autocomplete="off">
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

  function entryDialog(subjectRec, entry) {
    return `<div class="dlg-head">
        <div>
          <p class="eyebrow">Edit entry · <span class="mono" style="letter-spacing:0">${esc(subjectRec.id)}</span></p>
          <h2 class="dlg-title" id="dialog-title">${esc(subjectRec.name)} · <span class="mono">${U.fmtDate(entry.date)}</span></h2>
        </div>
        <button type="button" class="btn btn-quiet btn-sm" data-action="close-dialog" aria-label="Close">Close</button>
      </div>
      <div class="dlg-body form-wrap">
        ${entryForm({ subjectId: subjectRec.id, entry, prefix: 'dlg', mode: 'dialog' })}
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
    readEntryForm, markErrors, updatePreview, noteHTML, pill, LEVEL_LABEL,
  };
})(window.Herd = window.Herd || {});
