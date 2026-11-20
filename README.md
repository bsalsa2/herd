# Herd

Herd keeps a continuous lifecycle record for each individual animal. Every
subject has a profile of daily entries, and Herd flags when an animal deviates
from **its own** baseline — not a breed average, not a population norm.

It also watches the environment each animal lives in (temperature, humidity,
CO₂, ammonia, heat stress) against what that species, and that individual,
needs.

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
- **Environment hub** — spaces, species-aware climate needs, and one place to
  connect and control sensors (Bluetooth, Wi‑Fi/HTTP, manual, simulated). See
  [Environment and sensors](#environment-and-sensors).
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

## Environment and sensors

The **Environment** tab is the hub for every sensor: connect, pause, calibrate,
read on demand, and remove them in one place, and see whether each space suits
the animals living in it.

### How it fits together

- **Spaces** are rooms, barns, stalls, kennels or enclosures. Each animal lives
  in one space; each sensor sits in one.
- **Needs** come from a species preset (below), overridable per animal on its
  page via **Space & needs**. Overrides are for breed, age, coat, health or vet
  advice, for example a lowered maximum for a heavy-coated breed.
- **A shared space must suit every resident.** Herd uses the highest minimum and
  lowest maximum among them, names the animal whose limit binds, and flags a
  conflict outright when no range works (a brooder of chicks needing 32 °C
  cannot share with a dog capped at 24 °C).
- Each animal's page shows the space's live readings against **that animal's
  own** needs, including its own 24-hour time in range.

### What's checked

| Measurement | Flag | Watch |
|---|---|---|
| Temperature | Outside the range | Within 1 °C of either limit |
| Humidity | Outside the range | Within 5 % RH of either limit |
| CO₂ | At or above the limit | At or above the watch level |
| Ammonia (NH₃) | At or above 25 ppm | At or above 10 ppm |
| THI (cattle) | At or above 72 | At or above 68 |

THI is the temperature–humidity index (NRC 1971), the standard heat-stress
measure for livestock, computed from temperature and humidity. A reading with
no update for 3 sampling intervals (minimum 15 min) shows as stale and stops
counting; manual readings stay valid for 12 hours. Each space also reports the
share of the last 24 hours spent in range, which catches the afternoon spike a
spot check misses.

### Species presets

Starting points, not veterinary advice. Confirm with your vet and override per
animal.

| Species | Temperature | Humidity | CO₂ watch / limit | Source |
|---|---|---|---|---|
| Dog, Cat | 18–29 °C | 30–70 % | 1,500 / 2,500 ppm | *Guide for the Care and Use of Laboratory Animals*, 8th ed., Table 3.1 |
| Rabbit | 16–22 °C | 30–70 % | 1,500 / 2,500 ppm | Same |
| Chicken (adult) | 16–27 °C | 30–70 % | 2,500 / 3,000 ppm | Same |
| Pig (grower–finisher) | 16–22 °C | 40–70 % | 2,500 / 3,000 ppm | Thermal comfort zone |
| Horse | 5–25 °C | 40–80 % | 2,500 / 3,000 ppm | Thermoneutral zone, adult |
| Cattle | −5–25 °C | 40–80 % | 2,500 / 3,000 ppm | Thermoneutral zone + THI, dairy |
| Sheep | 5–25 °C | 40–80 % | 2,500 / 3,000 ppm | Thermoneutral zone, fleeced adult |
| Goat | 10–27 °C | 40–80 % | 2,500 / 3,000 ppm | Thermoneutral zone, adult |

Ammonia guidance (watch 10, limit 25 ppm) applies to every species. Any species
without a preset gets a generic indoor range (15–28 °C, 30–70 %) and a prompt to
set its own. Presets live in `assets/js/environment.js`.

### Connecting sensors

Herd has no server, so the browser talks to sensors directly. There are four
connection types:

**Bluetooth.** Pair from **Add sensor → Bluetooth**. Works in Chrome and Edge on
Windows, macOS, ChromeOS and Android. Not available in Safari, Firefox, or any
browser on iPhone (third-party iOS browsers such as Bluefy add it). The sensor
must expose the standard Environmental Sensing service (0x181A). Good options:

- Xiaomi LYWSD03MMC (inexpensive) flashed with the open
  [pvvx firmware](https://github.com/pvvx/ATC_MiThermometer)
- ESP32 boards running firmware that implements Environmental Sensing

Most brand-name sensors (Govee, SensorPush, stock Xiaomi) use their own
encrypted Bluetooth formats. Connect those through Home Assistant instead.
Browsers require a click to reconnect Bluetooth after a reload, so a
**Connect** button appears on the sensor.

**Wi‑Fi / HTTP.** Herd polls a URL that returns JSON and reads a number from it.

- *Home Assistant (recommended).* It already integrates most sensor brands,
  including Govee, SensorPush, Aqara, Shelly, Zigbee and Z-Wave.
  1. In Home Assistant: **Profile → Security → Long-lived access tokens →
     Create token**.
  2. Allow Herd's address in `configuration.yaml`, then restart:
     ```yaml
     http:
       cors_allowed_origins:
         - https://<you>.github.io
     ```
  3. In Herd: **Add sensor → Wi‑Fi / HTTP → Home Assistant**. One URL per
     measurement, e.g.
     `https://<your-ha-address>/api/states/sensor.barn_temperature`, JSON path
     `state`. Paste the token. Set *Source temperature unit* to °F if Home
     Assistant shows °F.
  4. Press **Test connection** before saving.
- *ESPHome.* Uses the `web_server` endpoint `/sensor/<id>`, JSON path `value`.
- *Generic JSON.* Any URL plus a dot path such as `data.temperature` or
  `readings[0].value`.

Two browser rules apply to every Wi‑Fi sensor:

- **CORS:** the device must allow requests from Herd's address.
- **Mixed content:** an `https` page (GitHub Pages) cannot call a plain-`http`
  device such as `http://192.168.1.40`. Either reach the device through `https`
  (Home Assistant with a certificate or Nabu Casa), or run Herd from your own
  computer (`python3 -m http.server`, then `http://localhost:8000`), which may
  call local `http` devices. Data at `localhost` is separate from your
  `github.io` copy; use Export and Import to move it.

**Manual.** Type readings from any thermometer, hygrometer or gas meter. Works
on every device, and it's the right tool for spot checks such as an ammonia
meter in a barn.

**Simulated.** Demo sensors with a realistic daily cycle, so you can see the hub
working before buying hardware. Remove them whenever you like.

### Limits worth knowing

- **Sensors are read only while Herd is open in a tab.** Background tabs are
  throttled by the browser, so intervals below a minute may slow down when the
  tab is hidden. For 24/7 capture, let Home Assistant record and point Herd at
  it.
- Run sensors from **one tab**. Two tabs polling the same sensors work, but
  waste requests.
- Readings are stored in 5-minute buckets for 14 days, about 200 KB per sensor,
  in their own storage key so they can never crowd out animal records.
- **Calibration:** compare against a reference meter. If a sensor reads 0.5°
  high, enter −0.5. The offset applies to every reading it records.
- **Access tokens stay in this browser and are never included in exports.**
  After importing a backup on a new device, re-enter tokens for Wi‑Fi sensors.

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

The Environment tab starts empty ("No sensors connected yet"). Add a space and
a sensor, or a simulated sensor to see it working, whenever you're ready.

**Reset sample data** in the footer restores the seed at any time.

## Your data

Records live in your browser's `localStorage`, under the key `herd:data:v1`
(sensor configuration and readings under `herd:env:v1`).
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

Exports also carry an `environment` section: spaces, sensors (without access
tokens), per-animal needs, and up to 14 days of readings. Older exports without
it still import; your current spaces and sensors are then left untouched.

Import validates every row, skips anything malformed (and tells you how many),
and asks before replacing what's in the browser. One entry per subject per day;
saving onto a date that already has an entry replaces it, and the form warns
you first.

## Run it locally

Open `index.html` (the landing page) or `app.html` (the app) directly in a browser. Both work from `file://`.

Or serve the folder, which matches GitHub Pages more closely:

```bash
python3 -m http.server 8000
```

Then visit <http://localhost:8000>.

## Deploy to GitHub Pages

Herd is already shaped for Pages: the landing page `index.html` is at the repository root (the app is `app.html`),
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
index.html              Landing page
app.html                App shell
.nojekyll               Serve files as-is on GitHub Pages
assets/css/landing.css  Landing page layout
assets/css/herd.css     Design system: tokens, light/dark, layout, components
assets/js/util.js       Dates, formatting, escaping
assets/js/seed.js       Sample subjects and 14 days of entries each
assets/js/store.js      localStorage persistence, validation, import/export
assets/js/baseline.js   Baseline windows, deviation rules, subject status
assets/js/charts.js     SVG sparkline and time-axis line chart (no library)
assets/js/env-store.js  Spaces, sensors, needs, readings (separate storage key)
assets/js/environment.js Species presets, needs, shared-space limits, THI, evaluation
assets/js/sensors.js    Sensor runtime: Bluetooth, HTTP/JSON, manual, simulated
assets/js/views.js      Overview, subject page, forms, log
assets/js/env-views.js  Environment hub, subject environment panel, sensor dialogs
assets/js/app.js        Routing, events, dialogs, toasts, live refresh
```

Scripts are plain classic scripts sharing one `window.Herd` namespace, loaded
in dependency order, so the app also works when opened from `file://`.

## Customize

- **Thresholds** — `CONFIG` in `assets/js/baseline.js` (window length, minimum
  entries, flag and watch drops, recovery days).
- **Species presets** — `PROFILES` in `assets/js/environment.js`.
- **Accent color** — `--accent` and `--band` in `assets/css/herd.css`, once in
  `:root` and once in the dark-mode block.
- **Fonts** — Inter and JetBrains Mono load from Google Fonts. To make zero
  third-party requests, delete the three font `<link>` tags in `index.html` and `app.html`;
  Herd falls back to the system UI font and SF Mono / Menlo / Consolas.

## Accessibility

Keyboard reachable throughout, visible focus rings, labelled form controls,
status always shown as text and not color alone, charts readable with arrow
keys (focus a chart, then ← / →), and a skip link.

## License

MIT — see [LICENSE](LICENSE).
