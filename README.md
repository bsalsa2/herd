# Herd

Herd keeps a continuous lifecycle record for each individual animal. Every
subject has a profile of daily entries, and Herd flags when an animal deviates
from **its own** baseline — not a breed average, not a population norm.

It is a static web app: plain HTML, CSS, and vanilla JavaScript. No framework,
no build step, no server, no account. It runs on GitHub Pages as-is.

---

## Features

- **Overview** — every subject with its ID, species, last entry, a 14-day
  energy sparkline, the current signal, and a status of **Nominal**, **Watch**,
  or **Flag**. The status counters double as filters.
- **Subject page** — ID and status header, the current signal in plain
  language, 14-day baseline statistics, energy and activity charts (hand-drawn
  SVG) with a shaded baseline band, a form for today's entry, and the full log.
- **Live preview** — while you fill in an entry, Herd shows the flag it will
  raise before you save it.
- **Add, edit, delete** subjects and entries. Subject IDs (`HRD-0001`, …) are
  permanent and never reused, even after a delete.
- **Export / Import** the whole dataset as JSON for backup or moving devices.
- **Design** — minimal biotech: white field, hairline borders, one teal accent,
  monospace for data. Follows the system dark mode, works on a phone, and
  respects `prefers-reduced-motion`.

## How the baseline works

Each entry is compared with the same subject's entries from the **14 calendar
days before it**. An entry is never part of its own baseline.

| Level   | Trigger |
|---------|---------|
| **Flag**  | Energy or activity **≥ 30% below** the baseline mean, or food intake **low** |
| **Watch** | Energy or activity **20–29% below** the baseline mean, or food intake **partial** |
| **Watch** | Subject-level only: the subject was flagged within the last **3 days** (recovering) |
| Nominal | Everything else |

Every deviation comes with a short, exact note, for example
`Activity −42% vs 14-day baseline`. Percentages are rounded before thresholds
are applied, so the number in a note always agrees with the level it produced.

- **Calibration.** Energy and activity checks start once the 14-day window holds
  at least 3 entries. Low intake is flagged from the first day.
- **Subject status** comes from the most recent entry. The baseline shown on the
  subject page and the chart band are the ones that entry was judged against,
  so the numbers always reconcile.
- **Chart band** = baseline mean ± 1 standard deviation. The dashed line is the
  mean; the dotted red line is the −30% flag threshold.
- **Wake time** is logged and summarized (the log shows shifts of 30+ minutes)
  but does not raise flags.

Thresholds live in one place, `CONFIG` at the top of
[`assets/js/baseline.js`](assets/js/baseline.js).

## Sample data

On first load Herd seeds two subjects with 14 days each, ending yesterday so
today's form starts empty:

| ID | Name | Species / breed | Sex | Age | Story |
|----|------|-----------------|-----|-----|-------|
| `HRD-0001` | Dog 1 | Dog · Bernese mountain dog | MN | 5 y | One off day (low intake, slight limp), now recovering → **Watch** |
| `HRD-0002` | Dog 2 | Dog · Poodle (standard) | FS | 3 y | Food-transition dip early on; lethargic on the latest day → **Flag** |

Sex uses veterinary shorthand: `M` intact male, `MN` neutered male, `F` intact
female, `FS` spayed female, `U` unknown. Age is stored as "N years as of a date"
and advances on its own.

**Reset sample data** in the footer restores the seed at any time.

## Your data

Records live in your browser's `localStorage`, under the key `herd:data:v1`.
Nothing is sent anywhere. That has real consequences worth knowing:

- Data is **per browser and per device**. Your phone and laptop do not share it.
  Use Export on one and Import on the other.
- Clearing site data or browsing history **deletes it**.
- **Safari may erase it** for a site you haven't opened in 7 days (WebKit's
  storage policy). Adding Herd to your Home Screen exempts it; regular exports
  protect you everywhere.
- Private windows may not persist anything. Herd shows a banner when storage is
  unavailable.

The footer shows when you last exported. Treat it as a backup reminder.

### Export format

```json
{
  "app": "herd",
  "version": 1,
  "exportedAt": "2026-11-20T09:12:00.000Z",
  "meta": { "nextSeq": 3 },
  "subjects": [
    { "id": "HRD-0001", "name": "Dog 1", "species": "Dog", "breed": "Bernese mountain dog",
      "sex": "MN", "ageYears": 5, "ageRecordedOn": "2026-11-20", "createdAt": "…" }
  ],
  "entries": [
    { "id": "e_…", "subjectId": "HRD-0001", "date": "2026-11-19", "wake": "06:40",
      "intake": "full", "energy": 4, "activity": 58,
      "behavior": "Near normal.", "anomaly": "" }
  ]
}
```

Import validates every row, skips anything malformed (and tells you how many),
and asks before replacing what's in the browser. One entry per subject per day;
saving onto a date that already has an entry replaces it, and the form warns
you first.

## Run it locally

Open `index.html` directly in a browser — it works from `file://`.

Or serve the folder, which matches GitHub Pages more closely:

```bash
python3 -m http.server 8000
```

Then visit <http://localhost:8000>.

## Deploy to GitHub Pages

Herd is already shaped for Pages: `index.html` is at the repository root,
routing uses URL hashes (`#/s/HRD-0001`) so no server rewrites are needed, and
`.nojekyll` tells Pages to serve the files untouched.

### 1. Get the code onto `main`

If you are working from a feature branch, merge it into `main` — either open a
pull request on GitHub and merge it, or from your machine:

```bash
git checkout main
```

```bash
git pull
```

```bash
git merge <your-branch>
```

```bash
git push origin main
```

Starting from scratch with a new repository instead:

```bash
git init
git add .
git commit -m "Initial commit"
git branch -M main
git remote add origin https://github.com/<you>/herd.git
git push -u origin main
```

### 2. Turn on Pages

1. Open the repository on GitHub.
2. Go to **Settings → Pages** (left sidebar, under *Code and automation*).
3. Under **Build and deployment → Source**, choose **Deploy from a branch**.
4. Under **Branch**, choose **`main`** and folder **`/ (root)`**, then **Save**.
5. Wait about a minute. The **Actions** tab shows a *pages build and deployment*
   run; when it turns green, the Pages settings page shows your URL:
   `https://<you>.github.io/herd/`

Every later push to `main` redeploys automatically.

> Pages on a **private** repository needs a paid GitHub plan. On the free plan,
> make the repository public (Settings → General → Danger Zone → Change
> visibility), or keep it private and run Herd locally.

### Troubleshooting

- **404 right after enabling** — the first deploy takes a minute or two.
  Hard-refresh.
- **Unstyled page** — check that `assets/` was committed and that the Pages
  folder is `/ (root)`, not `/docs`.
- **Old version showing** — Pages caches for ~10 minutes. Hard-refresh
  (Cmd/Ctrl + Shift + R).
- **Your data didn't follow you** — data is per browser and per origin. Data
  entered at `localhost` does not appear on `github.io`. Export, then Import.

## Project structure

```
index.html              App shell
.nojekyll               Serve files as-is on GitHub Pages
assets/css/herd.css     Design system: tokens, light/dark, layout, components
assets/js/util.js       Dates, formatting, escaping
assets/js/seed.js       Sample subjects and 14 days of entries each
assets/js/store.js      localStorage persistence, validation, import/export
assets/js/baseline.js   Baseline windows, deviation rules, subject status
assets/js/charts.js     SVG sparkline and line chart (no library)
assets/js/views.js      Overview, subject page, forms, log
assets/js/app.js        Routing, events, dialogs, toasts
```

Scripts are plain classic scripts sharing one `window.Herd` namespace, loaded
in dependency order, so the app also works when opened from `file://`.

## Customize

- **Thresholds** — `CONFIG` in `assets/js/baseline.js` (window length, minimum
  entries, flag and watch drops, recovery days).
- **Accent color** — `--accent` and `--band` in `assets/css/herd.css`, once in
  `:root` and once in the dark-mode block.
- **Fonts** — Inter and JetBrains Mono load from Google Fonts. To make zero
  third-party requests, delete the three font `<link>` tags in `index.html`;
  Herd falls back to the system UI font and SF Mono / Menlo / Consolas.

## Accessibility

Keyboard reachable throughout, visible focus rings, labelled form controls,
status always shown as text and not color alone, charts readable with arrow
keys (focus a chart, then ← / →), and a skip link.

## License

MIT — see [LICENSE](LICENSE).
