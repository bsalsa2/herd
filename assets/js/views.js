/* Herd · views
   Pure render functions: data in, HTML string out. Every user-supplied string
   passes through esc(). Charts are mounted after the HTML is in the DOM.
   Each page returns { title, crumbs, html, mount? }.

   Words over jargon: the stored values stay technical (energy 1–5, minutes,
   intake full/partial/low) but everything a person reads or taps is plain. */
(function (H) {
  'use strict';

  const U = H.util;
  const B = H.baseline;
  const S = H.store;
  const C = H.charts;
  const esc = U.esc;

  const LEVEL_LABEL = { nominal: 'Nominal', watch: 'Watch', flag: 'Flag', none: 'No data', calib: 'Learning' };
  const RANK = { flag: 0, watch: 1, nominal: 2, none: 3 };
  const RANGES = [['14', '14D'], ['30', '30D'], ['90', '90D'], ['all', 'All']];
  const LOG_PAGE = 30;
  const ENERGY = { 1: 'Very low', 2: 'Low', 3: 'Moderate', 4: 'Good', 5: 'High' };
  const INTAKE_PLAIN = { full: 'All of it', partial: 'Some of it', low: 'Little or none' };
  const SIGNS = ['Limping', 'Vomiting', 'Loose stool', 'Coughing', 'Not drinking', 'Itching', 'Hiding', 'Restless'];
  const ACT_CHIPS = [[0, 'None'], [15, '15 min'], [30, '30 min'], [45, '45 min'], [60, '1 h'], [90, '1½ h'], [120, '2 h'], [180, '3 h']];

  const pill = (level, big) => `<span class="pill ${level}${big ? ' big' : ''}">${LEVEL_LABEL[level]}</span>`;
  const round5 = (v) => Math.round(v / 5) * 5;

  /* 100 → "1 h 40 min", 45 → "45 min", 0 → "None" */
  function fmtDur(min) {
    const m = Math.round(Number(min));
    if (!(m > 0)) return 'None';
    const h = Math.floor(m / 60);
    const r = m % 60;
    return h ? `${h} h${r ? ` ${r} min` : ''}` : `${r} min`;
  }

  /* Signal notes in everyday words. compact: short form for tight cells. */
  function notePlain(n, compact) {
    if (n.kind === 'delta') {
      if (compact) return `${n.label} ${U.fmtPct(n.pct)}`;
      const much = n.level === 'flag';
      const words = n.metric === 'activity'
        ? (much ? 'Much less active than usual' : 'Less active than usual')
        : (much ? 'Much lower energy than usual' : 'Lower energy than usual');
      return `${words} · ${U.fmtPct(n.pct)}`;
    }
    if (n.kind === 'intake') return n.level === 'flag' ? 'Barely ate' : 'Ate only some of the food';
    if (n.kind === 'recovery') return `Recovering · flagged ${U.fmtDate(n.date)}`;
    if (n.kind === 'calibrating') return `Still learning the usual · ${n.n} of ${n.min} days`;
    if (n.text === 'Within 14-day baseline') return 'Their usual self';
    if (n.text === 'No entries recorded yet') return 'No check-ins yet';
    return n.text;
  }
  const noteHTML = (n, compact) => esc(notePlain(n, compact));

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
          <p class="big">No animals yet.</p>
          <p class="muted">Add one and Herd learns what normal looks like for it, check-in by check-in.</p>
          <button type="button" class="btn btn-primary" data-action="new-subject"><span class="plus">+</span> New animal</button>
        </div>`;
    } else if (!shown.length) {
      list = `<div class="panel empty"><p class="big">No animals on ${esc(LEVEL_LABEL[filter])}.</p>
          <button type="button" class="btn btn-sm" data-action="filter" data-filter="all">Show all</button></div>`;
    } else {
      list = `<div class="ix" role="list" aria-label="Animals">
          <div class="ix-head micro" aria-hidden="true">
            <span></span><span>ID</span><span>Animal</span><span>Last check-in</span><span>Active · 14 days</span><span>How they&rsquo;re doing</span><span>Status</span><span></span>
          </div>
          ${shown.map((it) => subjectRow(it, today)).join('')}
        </div>`;
    }

    const actions = `<button type="button" class="btn" data-action="palette">Search <kbd>&#8984;K</kbd></button>
      <button type="button" class="btn btn-primary" data-action="new-subject"><span class="plus">+</span> New animal</button>`;

    return {
      title: 'Herd · Field',
      crumbs: [{ label: 'Field' }],
      html: `<section class="view">
        ${storageBanner()}
        ${vhead('000 · Field', 'Field', `${esc(U.fmtDateLong(today))} · ${items.length} ${items.length === 1 ? 'animal' : 'animals'} on record`, actions)}
        <div class="tally" role="group" aria-label="Filter animals by status">
          ${tally('all', 'Animals', counts.all, 'On record')}
          ${tally('nominal', 'Nominal', counts.nominal, 'Their usual self')}
          ${tally('watch', 'Watch', counts.watch, 'A little off, or recovering')}
          ${tally('flag', 'Flag', counts.flag, 'A big change from usual')}
        </div>
        ${items.length ? rounds(items, today) : ''}
        <section class="section" aria-labelledby="ix-h">
          <div class="section-head"><h2 id="ix-h"><span class="n">001</span>Animals</h2><span class="section-meta">Most urgent first${filter !== 'all' ? ` · showing ${esc(LEVEL_LABEL[filter])}` : ''}</span></div>
          ${list}
        </section>
        ${H.envViews.overviewSummary()}
      </section>`,
    };
  }

  /* Today's rounds: who still needs today's check-in. */
  function rounds(items, today) {
    const due = items.filter((it) => !S.entryOn(it.s.id, today));
    const done = items.length - due.length;
    const segs = items.length <= 32
      ? items.map((_, i) => `<i class="${i < done ? 'on' : ''}"></i>`).join('')
      : `<i class="on" style="flex:${done}"></i><i style="flex:${due.length}"></i>`;
    const list = due.length
      ? `<ul class="rounds-list">${due.slice(0, 6).map(({ s, a }) => {
        const last = a.status.latest;
        const why = last ? `Last check-in ${U.fmtDate(last.date)} · ${U.fmtAgo(last.date, today)}` : 'No check-ins yet';
        return `<li class="rounds-item">
            ${sil(s.species, a.status.level)}
            <a class="who" href="#/s/${esc(s.id)}"><b>${esc(s.id)}</b><span>${esc(s.name)}</span><span class="why">${esc(why)}</span></a>
            <button type="button" class="btn btn-sm" data-action="log-entry" data-id="${esc(s.id)}">Check in</button>
          </li>`;
      }).join('')}${due.length > 6 ? `<li class="rounds-item"><span></span><span class="muted">and ${due.length - 6} more</span><span></span></li>` : ''}</ul>`
      : '<p class="rounds-done"><i class="dot nominal"></i>Everyone has been checked in today.</p>';
    return `<section class="rounds" aria-labelledby="rounds-h">
      <div>
        <div class="rounds-k"><span class="dot ${due.length ? 'watch' : 'nominal'}"></span><h2 class="micro" id="rounds-h">Today&rsquo;s rounds</h2></div>
        <p class="rounds-v num">${done}<small>/ ${items.length} checked in</small></p>
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
      label: `Time active, last ${recent.length} check-ins${recent.length ? `, latest ${fmtDur(recent[recent.length - 1].activity)}` : ''}`,
    });
    const stale = last && U.daysBetween(last.date, today) > 2;
    const notes = st.notes.slice(0, 2).map((n) => noteHTML(n)).join('<br>');
    const more = st.notes.length > 2 ? `<br><span class="more">+${st.notes.length - 2} more</span>` : '';
    const sub = [speciesLine(s), `${esc(s.sex)} · ${esc(U.ageLabel(s.ageYears, s.ageRecordedOn, today))}`].filter(Boolean).join(' · ');

    return `<a class="ix-row" role="listitem" href="#/s/${esc(s.id)}" aria-label="${esc(s.id)} ${esc(s.name)}, status ${LEVEL_LABEL[st.level]}">
      ${sil(s.species, st.level)}
      <span class="ix-id">${esc(s.id)}</span>
      <span class="ix-name"><b data-id="${esc(s.id)}">${esc(s.name)}</b><span>${sub}</span></span>
      <span class="ix-last">${last ? `<b>${U.fmtDate(last.date)}</b><span class="${stale ? 'stale' : ''}">${U.fmtAgo(last.date, today)}</span>` : '<span>No check-ins</span>'}</span>
      <span class="ix-spark">${spark}</span>
      <span class="ix-sig">${notes}${more}</span>
      <span class="ix-status">${pill(st.level)}</span>
      <span class="ix-go" aria-hidden="true">&rarr;</span>
    </a>`;
  }

  /* ======================================================================
     Animal record
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
    const env = H.envViews.subjectPanel(s);

    const html = `<section class="view">
      ${storageBanner()}
      <header class="rec-head">
        <div class="rec-frame" data-level="${st.level}">${sil(s.species, st.level)}</div>
        <div>
          <div class="rec-id"><span class="tag">Animal record</span>${pill(st.level, true)}</div>
          <h1 class="rec-title">${esc(s.id)}</h1>
          <p class="rec-name">${esc(s.name)}${s.breed ? ` <span>· ${esc(s.breed)}</span>` : ''}</p>
          <dl class="facts">
            ${fact('Species', esc(s.species))}
            ${fact('Sex', `<span title="${esc(U.SEX[s.sex])}">${esc(U.SEX[s.sex] || s.sex)}</span>`)}
            ${fact('Age', esc(U.ageLabel(s.ageYears, s.ageRecordedOn, today)))}
            ${fact('Check-ins', String(a.entries.length))}
            ${fact('Since', first ? U.fmtDate(first.date) : '—')}
          </dl>
        </div>
        <div class="rec-actions">
          <button type="button" class="btn btn-primary" data-action="focus-entry">${todays ? 'Edit today' : 'Check in'} <kbd>L</kbd></button>
          <div class="row">
            <button type="button" class="btn btn-sm" data-action="edit-subject" data-id="${esc(s.id)}">Edit</button>
            <button type="button" class="btn btn-sm btn-danger" data-action="delete-subject" data-id="${esc(s.id)}">Delete</button>
          </div>
        </div>
      </header>

      ${signalPanel(st, today)}

      <section class="section" id="entry" aria-labelledby="entry-h">
        <div class="section-head"><h2 id="entry-h"><span class="n">001</span>Today&rsquo;s check-in</h2><span class="section-meta">${esc(U.fmtDateLong(today))}${todays ? ' · saved, change anything below' : ' · about 20 seconds'}</span></div>
        <div class="panel ci-panel">
          ${entryForm({ subjectId: s.id, entry: todays, date: today, prefix: 'today', mode: 'inline' })}
        </div>
      </section>

      ${baselinePanel(a, s)}

      <section class="section" aria-labelledby="trends-h">
        <div class="section-head">
          <h2 id="trends-h"><span class="n">003</span>Trends</h2>
          <div class="seg" role="group" aria-label="Chart range">
            ${RANGES.map(([k, l]) => `<button type="button" class="seg-btn" data-action="range" data-range="${k}" aria-pressed="${state.range === k}">${l}</button>`).join('')}
          </div>
        </div>
        <div class="charts">
          ${chartCard('energy', 'Energy', '1 very low – 5 high', a, st)}
          ${chartCard('activity', 'Time active', 'minutes', a, st)}
        </div>
      </section>

      ${env ? `<div class="section">${env}</div>` : ''}
      ${logPanel(a, state, env ? '005' : '004')}
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
        ${vhead('404', 'Not found', `No animal with ID <span class="mono">${esc(id)}</span>. It may have been deleted, or the data in this browser was replaced by an import.`, '<a class="btn" href="#/">Back to the field</a>')}
      </section>`,
    };
  }

  function signalPanel(st, today) {
    const when = st.latest ? `Last check-in ${U.fmtDate(st.latest.date)}<br>${U.fmtAgo(st.latest.date, today)}` : 'No check-ins yet';
    return `<section class="signal" data-level="${st.level}" aria-label="How they are doing">
      <span class="signal-level">${LEVEL_LABEL[st.level]}</span>
      <ul class="signal-notes">${st.notes.map((n) => `<li class="${n.level === 'flag' || n.level === 'watch' ? 't-' + n.level : ''}"><span>${noteHTML(n)}</span></li>`).join('')}</ul>
      <span class="signal-when">${when}</span>
    </section>`;
  }

  function baselinePanel(a, s) {
    const c = a.current;
    const head = (meta) => `<div class="section-head">
        <h2 id="baseline-h"><span class="n">002</span>${esc(s.name)}&rsquo;s normal</h2>
        <span class="section-meta">${meta}</span>
      </div>`;
    const bar = (n) => `<div class="calib-bar" aria-hidden="true">${Array.from({ length: B.CONFIG.minEntries }, (_, i) => `<i class="${i < n ? 'on' : ''}"></i>`).join('')}</div>`;

    if (!c) {
      return `<section class="section" aria-labelledby="baseline-h">${head('No check-ins yet')}
        <div class="calib">Herd learns ${esc(s.name)}&rsquo;s normal from the first ${B.CONFIG.minEntries} check-ins, then compares every new day with the two weeks before it.${bar(0)}</div></section>`;
    }

    const meta = `From the 14 days before ${U.fmtDate(c.date)} · ${c.n} ${c.n === 1 ? 'check-in' : 'check-ins'}`;

    if (!c.ready) {
      return `<section class="section" aria-labelledby="baseline-h">${head(meta)}
        <div class="calib">Still learning: ${c.n} of ${B.CONFIG.minEntries} check-ins so far. Energy and activity are compared once there are ${B.CONFIG.minEntries}; low appetite is flagged from day one.${bar(c.n)}</div></section>`;
    }

    const kpi = (k, v, u, sub) => `<div class="kpi"><span class="k">${k}</span><span class="v num">${v}${u ? `<span class="u">${u}</span>` : ''}</span><span class="s">${sub}</span></div>`;
    const e = c.energy;
    const act = c.activity;
    const w = c.wake;

    return `<section class="section" aria-labelledby="baseline-h">${head(meta)}
      <div class="kpis">
        ${kpi('Usual energy', U.fmtNum(e.mean, 1), '/ 5', `${ENERGY[Math.round(e.mean)]} · from ${ENERGY[e.min].toLowerCase()} to ${ENERGY[e.max].toLowerCase()}`)}
        ${kpi('Usually active', esc(fmtDur(round5(act.mean))), '', `a day · give or take ${Math.round(act.sd)} min`)}
        ${kpi('Usually up at', w ? U.minToTime(w.mean) : '—', '', w ? `give or take ${Math.round(w.sd)} min` : 'no wake-up times logged')}
        ${kpi('Finished meals', U.fmtNum(c.intakeFull * 100, 0), '%', `${Math.round(c.intakeFull * c.n)} of ${c.n} days`)}
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
      const v = key === 'energy' ? `${ENERGY[latest.energy]}` : fmtDur(latest.activity);
      readout = `<span class="readout-v${key === 'energy' ? ' sm' : ''}">${esc(v)}</span>`
        + (d != null ? `<span class="readout-d ${lv}" title="Compared with the usual">${U.fmtPct(d)}</span>` : '');
    }
    return `<article class="panel chart-card">
      <div class="chart-top">
        <h3>${label}<span>${unitLabel}</span></h3>
        <div class="readout" title="Latest check-in compared with the usual">${readout}</div>
      </div>
      <div class="chart" data-chart="${key}" tabindex="0"></div>
      <div class="legend" aria-hidden="true">
        <span><i class="lg"></i>Each day</span>
        <span><i class="lg lg-band"></i>Usual range</span>
        <span><i class="lg lg-warn"></i>Watch</span>
        <span><i class="lg lg-thr"></i>Flag</span>
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
    // Usual range = mean ± 1 SD; reference lines = usual, watch and flag thresholds.
    const band = (key) => (c ? { lo: c[key].mean - c[key].sd, hi: c[key].mean + c[key].sd } : null);
    const lines = (key) => (c ? [
      { value: c[key].mean, kind: 'mean', label: 'usual' },
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
    const mean = (key) => (c ? `Usual ${U.fmtNum(c[key].mean, 1)}.` : '');

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
        label: 'Time active', unit: 'min', ariaExtra: mean('activity'),
        points: actPts, domain: [0, actTicks[actTicks.length - 1]], ticks: actTicks, band: actBand, lines: lines('activity'),
      }),
    };
  }

  /* ======================================================================
     Check-in (the entry form)
     A few plain questions. The stored fields are unchanged: date, wake,
     intake (full/partial/low), energy (1–5), activity (minutes), behavior,
     anomaly.
     ====================================================================== */

  const BOWL = {
    full: '<path d="M8 12.5c2.5-6.5 21.5-6.5 24 0z" fill="currentColor"/>',
    partial: '<path d="M10 12.5c2.5-3 17.5-3 20 0z" fill="currentColor"/>',
    low: '<circle cx="17" cy="11.3" r="1.2" fill="currentColor"/><circle cx="22.5" cy="11.6" r="1" fill="currentColor"/>',
  };
  const bowl = (k) => `<svg class="bowl" viewBox="0 0 40 24" aria-hidden="true">${BOWL[k]}<path d="M3 12.5h34" stroke="currentColor" stroke-width="1.6"/><path d="M5 12.5l3.5 8h23l3.5-8" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>`;
  const bars = (n) => `<span class="bars" aria-hidden="true">${[1, 2, 3, 4, 5].map((i) => `<i class="${i <= n ? 'on' : ''}"></i>`).join('')}</span>`;

  function hasSign(text, sign) {
    return String(text || '').toLowerCase().split(/\s*[,;\n]\s*/).includes(sign.toLowerCase());
  }

  function entryForm(o) {
    const e = o.entry || {};
    const p = o.prefix;
    const s = S.subject(o.subjectId);
    const name = s ? esc(s.name) : 'this animal';
    const today = U.todayISO();
    const yesterday = U.addDays(today, -1);
    const date = e.date || o.date || today;
    const isEdit = Boolean(e.id);
    const label = isEdit ? 'Update check-in' : 'Save check-in';
    const base = B.baselineFor(S.entries(o.subjectId), date, e.id || null);
    const usualAct = base.ready ? round5(base.activity.mean) : null;
    const hasAct = e.activity != null && e.activity !== '';
    const max = Math.min(1440, Math.max(180, Math.ceil(((usualAct || 60) * 2) / 30) * 30, hasAct ? Math.ceil(e.activity / 30) * 30 : 0));
    const pos = hasAct ? Number(e.activity) : (usualAct != null ? usualAct : 60);
    const usualE = base.ready ? Math.round(base.energy.mean) : null;

    const energy = [1, 2, 3, 4, 5].map((v) => {
      const id = `${p}-energy-${v}`;
      return `<input type="radio" id="${id}" name="energy" value="${v}"${String(e.energy) === String(v) ? ' checked' : ''}>`
        + `<label for="${id}" class="${usualE === v ? 'is-usual' : ''}">${bars(v)}<b>${ENERGY[v]}</b></label>`;
    }).join('');

    const intake = ['full', 'partial', 'low'].map((v) => {
      const id = `${p}-intake-${v}`;
      return `<input type="radio" id="${id}" name="intake" value="${v}"${e.intake === v ? ' checked' : ''}>`
        + `<label for="${id}">${bowl(v)}<b>${INTAKE_PLAIN[v]}</b></label>`;
    }).join('');

    const usualMark = (v) => (v == null ? '' : `calc(11px + (100% - 22px) * ${(Math.min(v, max) / max).toFixed(4)})`);

    return `<form class="entry-form ci" data-form="entry" data-subject="${esc(o.subjectId)}" data-entry-id="${esc(e.id || '')}" data-mode="${o.mode}" data-name="${name}" novalidate>
      <div class="ci-head">
        <p class="ci-title">How was <b>${name}</b> <span data-when-text>${date === today ? 'today' : date === yesterday ? 'yesterday' : `on ${U.fmtDate(date)}`}</span>?</p>
        <div class="ci-days" role="group" aria-label="Which day">
          <button type="button" class="dchip" data-action="ef-day" data-date="${today}" aria-pressed="${date === today}">Today</button>
          <button type="button" class="dchip" data-action="ef-day" data-date="${yesterday}" aria-pressed="${date === yesterday}">Yesterday</button>
          <label class="dchip dchip-date" title="Pick another day"><span class="visually-hidden">Date</span><input class="dinput" type="date" id="${p}-date" name="date" value="${esc(date)}" max="${today}" required></label>
        </div>
      </div>

      <div class="ci-grid">
        <div class="ci-qs">
          <fieldset class="q" data-field="energy">
            <legend class="q-h"><span class="q-n">01</span>How was ${name}&rsquo;s energy?</legend>
            <p class="q-hint" data-hint-energy>${usualE ? `Usually <b>${ENERGY[usualE].toLowerCase()}</b>.` : 'Their general get-up-and-go today.'}</p>
            <div class="opts opts-5">${energy}</div>
          </fieldset>

          <div class="q" data-field="activity">
            <div class="q-h"><span class="q-n">02</span><label for="${p}-act-range">How long was ${name} active?</label></div>
            <p class="q-hint" data-hint-act>Walks, play, work and exercise, added up.${usualAct != null ? ` Usually about <b>${fmtDur(usualAct)}</b>.` : ''}</p>
            <div class="act${hasAct ? '' : ' unset'}" data-act>
              <output class="act-v" data-act-out for="${p}-act-range">${hasAct ? fmtDur(e.activity) : 'Slide or tap a time'}</output>
              <div class="act-track" style="--p:${((pos / max) * 100).toFixed(2)}%">
                <input type="range" id="${p}-act-range" min="0" max="${max}" step="5" value="${pos}" data-act-range aria-valuetext="${hasAct ? fmtDur(e.activity) : 'Not set'}">
                <i class="act-usual" data-act-usual style="left:${usualMark(usualAct) || '0'}"${usualAct == null ? ' hidden' : ''}><span>usual</span></i>
              </div>
              <div class="act-chips" role="group" aria-label="Quick times">${ACT_CHIPS.map(([m, l]) => `<button type="button" class="dchip" data-action="ef-act" data-min="${m}" aria-pressed="${hasAct && Number(e.activity) === m}">${l}</button>`).join('')}</div>
              <div class="act-exact"><label for="${p}-activity">Exact</label><input class="input mono" type="number" id="${p}-activity" name="activity" inputmode="numeric" min="0" max="1440" step="1" value="${hasAct ? esc(e.activity) : ''}" placeholder="—"><span>minutes</span></div>
            </div>
          </div>

          <fieldset class="q" data-field="intake">
            <legend class="q-h"><span class="q-n">03</span>How much did ${name} eat?</legend>
            <p class="q-hint">Compared with a normal meal.</p>
            <div class="opts opts-3 opts-intake">${intake}</div>
          </fieldset>

          <div class="q q-notes">
            <div class="q-h"><span class="q-n">04</span><label for="${p}-behavior">Anything worth noting?</label><span class="q-opt">Optional</span></div>
            <textarea class="input" id="${p}-behavior" name="behavior" rows="2" maxlength="500" placeholder="Long walk, napped all afternoon, played with the kids…">${esc(e.behavior || '')}</textarea>
            <p class="q-sub" id="${p}-signs-l">Did anything seem off?</p>
            <div class="tags" role="group" aria-labelledby="${p}-signs-l">${SIGNS.map((t) => `<button type="button" class="dchip sign" data-action="ef-tag" data-tag="${t}" aria-pressed="${hasSign(e.anomaly, t)}">${t}</button>`).join('')}</div>
            <textarea class="input" id="${p}-anomaly" name="anomaly" rows="2" maxlength="500" placeholder="Tap a sign above, or describe what seemed off" aria-labelledby="${p}-signs-l">${esc(e.anomaly || '')}</textarea>
          </div>
        </div>

        <div class="ci-aside">
          <div class="ci-result" data-preview aria-live="polite"></div>
          <details class="ci-more"${e.wake ? ' open' : ''}>
            <summary>Wake-up time <span class="q-opt">Optional</span></summary>
            <div class="ci-wake">
              <label for="${p}-wake">${name} got up at</label>
              <input class="input mono" type="time" id="${p}-wake" name="wake" value="${esc(e.wake || '')}">
              ${base.wake && base.n >= B.CONFIG.minEntries ? `<button type="button" class="dchip" data-action="ef-wake" data-time="${U.minToTime(base.wake.mean)}">Usual · ${U.minToTime(base.wake.mean)}</button>` : ''}
            </div>
          </details>
          <div class="ef-actions">
            ${o.mode === 'dialog' ? '<button type="button" class="btn" data-action="close-dialog">Cancel</button>' : ''}
            <button type="submit" class="btn btn-primary" data-submit data-label="${label}">${label}</button>
          </div>
          <p class="form-error" data-error role="alert"></p>
        </div>
      </div>
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
    if (!U.isISO(date)) errors.push({ field: 'date', msg: 'Pick the day this check-in is for.' });
    else if (date > today) errors.push({ field: 'date', msg: 'Check-ins can’t be in the future.' });

    const wake = get('wake');
    if (wake && !U.isTime(wake)) errors.push({ field: 'wake', msg: 'Wake-up time should look like 06:30.' });

    const energyRaw = get('energy');
    const energy = Number(energyRaw);
    if (!energyRaw || !(energy >= 1 && energy <= 5)) errors.push({ field: 'energy', msg: 'Choose how their energy was.' });

    const actRaw = String(get('activity')).trim();
    const activity = Number(actRaw);
    if (actRaw === '' || !Number.isFinite(activity) || activity < 0 || activity > 1440) {
      errors.push({ field: 'activity', msg: 'Set how long they were active.' });
    }

    const intake = get('intake');
    if (!U.INTAKE[intake]) errors.push({ field: 'intake', msg: 'Choose how much they ate.' });

    return {
      values: { date, wake, intake, energy, activity, behavior: get('behavior'), anomaly: get('anomaly') },
      errors,
    };
  }

  function markErrors(form, errors) {
    form.querySelectorAll('[aria-invalid]').forEach((el) => el.removeAttribute('aria-invalid'));
    errors.forEach((er) => {
      const box = form.querySelector(`[data-field="${er.field}"]`) || form.elements.namedItem(er.field);
      if (box && box.setAttribute) box.setAttribute('aria-invalid', 'true');
    });
    const out = form.querySelector('[data-error]');
    if (out) out.textContent = errors.map((er) => er.msg).join(' ');
  }

  /* Plain-language verdict for an in-progress or saved check-in. */
  function verdict(values, base, name) {
    const ev = B.evaluate({ intake: values.intake, energy: Number(values.energy), activity: Number(values.activity) }, base);
    const items = [];
    if (base.ready) {
      const dE = ev.deltas.energy;
      const lE = B.levelForPct(dE);
      items.push({
        level: lE,
        text: lE === 'flag' ? 'Much lower energy than usual' : lE === 'watch' ? 'Lower energy than usual' : dE >= 20 ? 'More energy than usual' : 'Energy about as usual',
        detail: `${ENERGY[values.energy]} · usually ${ENERGY[Math.round(base.energy.mean)].toLowerCase()} · ${U.fmtPct(dE)}`,
      });
      const dA = ev.deltas.activity;
      const lA = B.levelForPct(dA);
      items.push({
        level: lA,
        text: lA === 'flag' ? 'Much less active than usual' : lA === 'watch' ? 'Less active than usual' : dA >= 30 ? 'More active than usual' : 'About as active as usual',
        detail: `${fmtDur(values.activity)} · usually about ${fmtDur(round5(base.activity.mean))} · ${U.fmtPct(dA)}`,
      });
    }
    items.push(values.intake === 'low' ? { level: 'flag', text: 'Barely ate' }
      : values.intake === 'partial' ? { level: 'watch', text: 'Ate only some of the food' }
        : { level: 'nominal', text: 'Finished the food' });
    items.sort((a, b) => RANK[a.level] - RANK[b.level]);

    let head;
    if (ev.level === 'flag') head = `A big change for ${name}.`;
    else if (ev.level === 'watch') head = `A little off for ${name}.`;
    else if (!base.ready) head = `Herd is still learning ${name}’s normal.`;
    else head = `A normal day for ${name}.`;
    const foot = !base.ready
      ? `${base.n} of ${B.CONFIG.minEntries} check-ins so far. Energy and activity are compared once there are ${B.CONFIG.minEntries}.`
      : ev.level === 'flag' ? 'This will be flagged on the field.' : ev.level === 'watch' ? 'Herd will keep an eye on it.' : '';
    return { level: ev.level, head, items, foot, ev };
  }

  /* Live preview: evaluates the in-progress check-in against the usual for
     its day, so the verdict shows before it is saved. Also keeps the
     progress, hints and day chips in step with the form. */
  function updatePreview(form) {
    const out = form.querySelector('[data-preview]');
    const submit = form.querySelector('[data-submit]');
    if (!out) return;

    const subjectId = form.dataset.subject;
    const entryId = form.dataset.entryId || null;
    const name = form.dataset.name || 'this animal';
    const { values } = readEntryForm(form);
    const all = S.entries(subjectId);
    const today = U.todayISO();
    const yesterday = U.addDays(today, -1);

    // Day chips and title
    form.querySelectorAll('[data-action="ef-day"]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.date === values.date)));
    const when = form.querySelector('[data-when-text]');
    if (when) when.textContent = values.date === today ? 'today' : values.date === yesterday ? 'yesterday' : U.isISO(values.date) ? `on ${U.fmtDate(values.date)}` : 'that day';

    // Progress over the three required questions
    const answered = {
      energy: Boolean(values.energy >= 1),
      activity: String((form.elements.namedItem('activity') || {}).value || '').trim() !== '' && Number.isFinite(Number(values.activity)),
      intake: Boolean(U.INTAKE[values.intake]),
    };
    Object.keys(answered).forEach((k) => {
      const q = form.querySelector(`[data-field="${k}"]`);
      if (q) q.classList.toggle('answered', answered[k]);
    });
    const done = Object.values(answered).filter(Boolean).length;

    const clash = U.isISO(values.date) ? all.find((e) => e.date === values.date && e.id !== entryId) : null;
    if (submit) submit.textContent = clash ? 'Save & replace' : submit.dataset.label;

    const progress = `<span class="ci-prog" aria-label="${done} of 3 answered">${[0, 1, 2].map((i) => `<i class="${i < done ? 'on' : ''}"></i>`).join('')}<span>${done}/3</span></span>`;

    if (!U.isISO(values.date)) {
      out.dataset.level = '';
      out.innerHTML = `<div class="cr-top"><span class="cr-k">What Herd sees</span>${progress}</div><p class="cr-muted">Pick the day this check-in is for.</p>`;
      return;
    }

    const base = B.baselineFor(all, values.date, entryId);
    refreshHints(form, base);

    if (done < 3) {
      out.dataset.level = '';
      out.innerHTML = `<div class="cr-top"><span class="cr-k">What Herd sees</span>${progress}</div>
        <p class="cr-muted">${done ? 'Keep going' : 'Answer the three questions'} and Herd will tell you how ${values.date === today ? 'today' : 'this day'} compares with ${esc(name)}&rsquo;s usual.</p>`;
      return;
    }

    const v = verdict(values, base, name);
    out.dataset.level = v.level;
    out.innerHTML = `<div class="cr-top"><span class="cr-k">What Herd sees</span>${pill(v.level)}</div>
      <p class="cr-head">${esc(v.head)}</p>
      <ul class="cr-list">${v.items.map((it) => `<li data-level="${it.level}"><b>${esc(it.text)}</b>${it.detail ? `<span>${esc(it.detail)}</span>` : ''}</li>`).join('')}</ul>
      ${v.foot ? `<p class="cr-foot">${esc(v.foot)}</p>` : ''}
      ${clash ? `<p class="cr-warn">This replaces the check-in already saved for ${U.fmtDate(values.date)}.</p>` : ''}`;
  }

  /* Usual-energy and usual-activity hints follow the chosen day. */
  function refreshHints(form, base) {
    const usualE = base.ready ? Math.round(base.energy.mean) : null;
    form.querySelectorAll('.opts-5 label').forEach((l, i) => l.classList.toggle('is-usual', usualE === i + 1));
    const he = form.querySelector('[data-hint-energy]');
    if (he) he.innerHTML = usualE ? `Usually <b>${ENERGY[usualE].toLowerCase()}</b>.` : 'Their general get-up-and-go today.';
    const usualA = base.ready ? round5(base.activity.mean) : null;
    const ha = form.querySelector('[data-hint-act]');
    if (ha) ha.innerHTML = `Walks, play, work and exercise, added up.${usualA != null ? ` Usually about <b>${fmtDur(usualA)}</b>.` : ''}`;
    const range = form.querySelector('[data-act-range]');
    const mark = form.querySelector('[data-act-usual]');
    if (range && mark) {
      mark.hidden = usualA == null;
      if (usualA != null) mark.style.left = `calc(11px + (100% - 22px) * ${(Math.min(usualA, Number(range.max)) / Number(range.max)).toFixed(4)})`;
    }
  }

  /* Keep the slider, the exact-minutes field, the chips and the sign tags
     in step. `target` is the element the person just changed. */
  function syncEntry(form, target) {
    const range = form.querySelector('[data-act-range]');
    const exact = form.elements.namedItem('activity');
    if (target && target.matches('[data-act-range]')) exact.value = range.value;
    if (target && target === exact && exact.value !== '') {
      const n = Number(exact.value);
      if (Number.isFinite(n)) {
        if (n > Number(range.max)) range.max = String(Math.min(1440, Math.ceil(n / 30) * 30));
        range.value = String(Math.max(0, n));
      }
    }
    if (range && exact) {
      const set = exact.value !== '';
      const wrap = form.querySelector('[data-act]');
      wrap.classList.toggle('unset', !set);
      form.querySelector('[data-act-out]').textContent = set ? fmtDur(exact.value) : 'Slide or tap a time';
      range.setAttribute('aria-valuetext', set ? fmtDur(exact.value) : 'Not set');
      form.querySelector('.act-track').style.setProperty('--p', `${((Number(range.value) / Number(range.max)) * 100).toFixed(2)}%`);
      form.querySelectorAll('[data-action="ef-act"]').forEach((b) => b.setAttribute('aria-pressed', String(set && Number(b.dataset.min) === Number(exact.value))));
    }
    const anomaly = form.elements.namedItem('anomaly');
    if (anomaly) form.querySelectorAll('[data-action="ef-tag"]').forEach((b) => b.setAttribute('aria-pressed', String(hasSign(anomaly.value, b.dataset.tag))));
  }

  /* Chip and tag clicks inside a check-in. */
  function entryAction(form, btn) {
    const act = btn.dataset.action;
    if (act === 'ef-day') {
      form.elements.namedItem('date').value = btn.dataset.date;
    } else if (act === 'ef-act') {
      const exact = form.elements.namedItem('activity');
      exact.value = btn.dataset.min;
      syncEntry(form, exact);
    } else if (act === 'ef-tag') {
      const field = form.elements.namedItem('anomaly');
      const tag = btn.dataset.tag;
      const parts = String(field.value).split(/\s*,\s*/).map((x) => x.trim()).filter(Boolean);
      const i = parts.findIndex((x) => x.toLowerCase() === tag.toLowerCase());
      if (i >= 0) parts.splice(i, 1); else parts.push(tag);
      field.value = parts.join(', ');
    } else if (act === 'ef-wake') {
      form.elements.namedItem('wake').value = btn.dataset.time;
    }
    syncEntry(form, null);
    updatePreview(form);
  }

  /* ---------- Log -------------------------------------------------------- */

  function logPanel(a, state, num) {
    const rows = a.entries.slice().reverse();
    const shown = state.logAll ? rows : rows.slice(0, LOG_PAGE);
    const meta = rows.length ? `${rows.length} ${rows.length === 1 ? 'check-in' : 'check-ins'} · newest first` : 'Nothing yet';

    let body;
    if (!rows.length) {
      body = '<div class="panel empty"><p class="big">No check-ins yet.</p><p class="muted">Today&rsquo;s check-in above starts the record.</p></div>';
    } else {
      body = `<div class="log-wrap">
          <table class="log">
            <thead><tr>
              <th scope="col">Day</th>
              <th scope="col">Energy</th>
              <th scope="col">Active</th>
              <th scope="col">Ate</th>
              <th scope="col">Up at</th>
              <th scope="col">Notes</th>
              <th scope="col">How they were</th>
              <th scope="col"><span class="visually-hidden">Actions</span></th>
            </tr></thead>
            <tbody>${shown.map((e) => logRow(e, a.evals.get(e.id))).join('')}</tbody>
          </table>
        </div>
        ${rows.length > shown.length ? `<div class="log-foot"><button type="button" class="btn btn-sm" data-action="log-all">Show all ${rows.length} check-ins</button></div>` : ''}`;
    }

    return `<section class="section" aria-labelledby="log-h">
      <div class="section-head">
        <h2 id="log-h"><span class="n">${num || '004'}</span>Every check-in</h2>
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
      ? `<span class="d">${U.fmtMinDelta(wakeMin - wakeBase)} vs usual</span>` : '';
    const delta = (d) => (d == null ? '' : `<span class="d ${B.levelForPct(d)}">${U.fmtPct(d)}</span>`);
    const notes = (e.behavior ? esc(e.behavior) : '')
      + (e.anomaly ? `<span class="anomaly">${esc(e.anomaly)}</span>` : '');
    const signal = ev.notes.length
      ? `<ul class="sig-notes">${ev.notes.map((n) => `<li>${noteHTML(n, true)}</li>`).join('')}</ul>`
      : (ev.calibrating ? `<ul class="sig-notes"><li>Learning · ${ev.base.n} of ${B.CONFIG.minEntries}</li></ul>` : '');

    return `<tr class="lv-${ev.level}">
      <td class="c-date"><span class="v">${U.fmtDate(e.date)}</span><span class="d">${U.fmtWeekday(e.date)}</span></td>
      <td class="c-energy" data-label="Energy"><span class="v">${ENERGY[e.energy]}</span>${delta(dE)}</td>
      <td class="c-activity" data-label="Active"><span class="v">${esc(fmtDur(e.activity))}</span>${delta(dA)}</td>
      <td class="c-intake" data-label="Ate"><span class="intake-${e.intake}">${INTAKE_PLAIN[e.intake]}</span></td>
      <td class="c-wake" data-label="Up at"><span class="v">${e.wake ? esc(e.wake) : '—'}</span>${wakeDelta}</td>
      <td class="c-notes" data-label="Notes">${notes || '<span class="none">—</span>'}</td>
      <td class="c-signal">${pill(level)}${signal}</td>
      <td class="c-actions"><span class="row-actions">
        <button type="button" class="btn btn-quiet btn-sm" data-action="edit-entry" data-id="${esc(e.id)}" aria-label="Edit check-in ${U.fmtDate(e.date)}">Edit</button>
        <button type="button" class="btn btn-quiet btn-sm btn-danger" data-action="delete-entry" data-id="${esc(e.id)}" aria-label="Delete check-in ${U.fmtDate(e.date)}">Delete</button>
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
    const sexes = Object.keys(U.SEX).map((k) => `<option value="${k}"${s && s.sex === k ? ' selected' : ''}>${U.SEX[k]}</option>`).join('');

    return `<form data-form="subject" data-id="${s ? esc(s.id) : ''}" data-age-shown="${esc(ageShown)}" novalidate>
      ${dlgHead(isEdit ? 'Edit animal' : 'New animal · the ID is permanent', esc(s ? s.id : S.peekNextId()))}
      <div class="dlg-body">
        <div class="form-grid">
          <div class="field span-2">
            <label for="sf-name">Name</label>
            <input class="input" id="sf-name" name="name" maxlength="60" required value="${s ? esc(s.name) : ''}" placeholder="e.g. Bella" autocomplete="off" autofocus>
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
            <p class="hint">Counts up on its own.</p>
          </div>
        </div>
        <p class="form-error" data-error role="alert"></p>
        <div class="dlg-actions">
          <button type="button" class="btn" data-action="close-dialog">Cancel</button>
          <button type="submit" class="btn btn-primary">${isEdit ? 'Save changes' : 'Add animal'}</button>
        </div>
      </div>
    </form>`;
  }

  function entryDialog(subjectRec, entry, date) {
    const isEdit = Boolean(entry);
    const d = entry ? entry.date : date;
    return `${dlgHead(`${isEdit ? 'Edit check-in' : 'Check-in'} · <span class="lc">${esc(subjectRec.id)}</span>`, `${esc(subjectRec.name)} · ${U.fmtDate(d)}`)}
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
    readEntryForm, markErrors, updatePreview, syncEntry, entryAction, verdict,
    noteHTML, notePlain, pill, sil, dlgHead, vhead, fmtDur, LEVEL_LABEL, ENERGY,
  };
})(window.Herd = window.Herd || {});
