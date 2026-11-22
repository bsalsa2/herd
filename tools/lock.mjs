#!/usr/bin/env node
/* Herd · lock
   Builds docs/internal/index.html: the whole app, inlined and encrypted with a
   password (PBKDF2 → AES-256-GCM). The page shows a login gate and only
   decrypts in the browser when the password is right. The public site lives
   at docs/index.html; GitHub Pages serves /docs.

   Usage:
     HERD_PASSWORD='your passphrase' node tools/lock.mjs
     node tools/lock.mjs              (prompts for the password)
     node tools/lock.mjs --restyle    (rebuild the gate page around the existing
                                       ciphertext; no password needed)
     node tools/lock.mjs --new-salt   (encrypt with a fresh salt, which also
                                       signs out every remembered device)

   The password is never written to disk. Re-run any time to change it. */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { webcrypto as crypto } from 'node:crypto';
import { createInterface } from 'node:readline';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = join(root, 'docs', 'internal');
const OUT = join(OUT_DIR, 'index.html');
const LEGACY = join(root, 'docs', 'index.html'); // where the lock lived before the public site
const ITERATIONS = 310000;

const b64 = (u8) => Buffer.from(u8).toString('base64');

function write(page) {
  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(OUT, page);
  writeFileSync(join(root, 'docs', '.nojekyll'), '');
}

/* ---------- Restyle: keep the ciphertext, rebuild the page around it ---------- */
if (process.argv.includes('--restyle')) {
  const from = [OUT, LEGACY].find((f) => existsSync(f) && /var SALT = "/.test(readFileSync(f, 'utf8')));
  if (!from) { console.error('No locked page found to restyle. Run without --restyle to encrypt the app.'); process.exit(1); }
  const src = readFileSync(from, 'utf8');
  const pick = (re) => { const m = src.match(re); if (!m) { console.error(`Could not read ${re} from ${from}`); process.exit(1); } return m[1]; };
  const page = gatePage({
    salt: pick(/var SALT = "([A-Za-z0-9+/=]+)"/),
    iv: pick(/IV = "([A-Za-z0-9+/=]+)"/),
    it: Number(pick(/IT = (\d+)/)),
    ct: pick(/var CT = "([A-Za-z0-9+/=]+)"/),
  });
  write(page);
  console.log(`Restyled: docs/internal/index.html (${Math.round(page.length / 1024)} KB), same password as before.`);
  process.exit(0);
}

/* ---------- Encrypt ---------- */
async function askPassword() {
  if (process.env.HERD_PASSWORD) return process.env.HERD_PASSWORD;
  const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  rl._writeToOutput = (s) => { if (s.includes('Password')) process.stdout.write(s); };
  return new Promise((res) => rl.question('Password: ', (a) => { rl.close(); process.stdout.write('\n'); res(a); }));
}

const password = (await askPassword()).trim();
if (password.length < 12) {
  console.error('Use a password of at least 12 characters. A long passphrase is much safer.');
  process.exit(1);
}

// 1. Inline the app into one HTML document.
let html = readFileSync(join(root, 'index.html'), 'utf8');
const safe = (code) => code.replace(/<\/script/gi, '<\\/script');
html = html.replace(/<link rel="stylesheet" href="(assets\/css\/[^"]+)">/g, (_, f) => `<style>\n${readFileSync(join(root, f), 'utf8')}\n</style>`);
html = html.replace(/<script src="(assets\/js\/[^"]+)"><\/script>/g, (_, f) => `<script>\n${safe(readFileSync(join(root, f), 'utf8'))}\n</script>`);
if (/(href|src)="assets\//.test(html)) { console.error('Some assets were not inlined.'); process.exit(1); }

// 2. Encrypt. Reuse the published salt when there is one, so a device that
//    chose "keep me signed in" stays unlocked after a rebuild with the same
//    password. A changed password still locks every device out. --new-salt
//    forces a fresh one.
const enc = new TextEncoder();
let salt = crypto.getRandomValues(new Uint8Array(16));
if (!process.argv.includes('--new-salt') && existsSync(OUT)) {
  const prev = readFileSync(OUT, 'utf8');
  const s = prev.match(/var SALT = "([A-Za-z0-9+/=]+)"/);
  const it = prev.match(/IT = (\d+)/);
  if (s && it && Number(it[1]) === ITERATIONS) {
    const bytes = new Uint8Array(Buffer.from(s[1], 'base64'));
    if (bytes.length === 16) salt = bytes;
  }
}
const iv = crypto.getRandomValues(new Uint8Array(12));
const base = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveKey']);
const key = await crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: ITERATIONS, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt']);
const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(html)));

// 3. Gate page.
const page = gatePage({ salt: b64(salt), iv: b64(iv), it: ITERATIONS, ct: b64(cipher) });
write(page);
console.log(`Locked: docs/internal/index.html (${Math.round(page.length / 1024)} KB). Pages serves main, /docs.`);

/* ---------- The gate ---------- */
function gatePage({ salt, iv, it, ct }) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="robots" content="noindex, nofollow">
<meta name="theme-color" content="#07100B">
<title>Herd · Internal</title>
<link rel="icon" href="../assets/favicon.svg" type="image/svg+xml">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Host+Grotesk:wght@300..700&family=Martian+Mono:wdth,wght@75..112.5,200..600&display=swap">
<style>
:root{--bg:#07100B;--fg:#F2F1EC;--fg2:rgba(242,241,236,.62);--rule:rgba(242,241,236,.16);--flag:#FF4B2B;--nominal:#B6F03C;--sans:"Host Grotesk",ui-sans-serif,system-ui,sans-serif;--mono:"Martian Mono",ui-monospace,"SF Mono",Menlo,monospace}
*{box-sizing:border-box}
html,body{margin:0;min-height:100%;background:var(--bg);color:var(--fg)}
body{min-height:100vh;min-height:100dvh;display:grid;grid-template-rows:auto 1fr auto;font:15px/1.5 var(--sans);-webkit-font-smoothing:antialiased}
body::before{content:"";position:fixed;inset:0;pointer-events:none;background:radial-gradient(60% 50% at 50% 110%,rgba(232,51,90,.18),transparent 70%),radial-gradient(40% 40% at 50% 115%,rgba(255,143,31,.16),transparent 70%)}
.top{display:flex;align-items:center;justify-content:space-between;gap:16px;height:64px;padding:0 clamp(16px,4vw,40px);border-bottom:1px solid var(--rule)}
.brand{display:flex;align-items:center;gap:12px;color:inherit;text-decoration:none;font-size:13px;line-height:1.15;color:var(--fg2)}
.brand svg{width:34px;height:34px;color:var(--fg)}
.top a.back{font:500 11px/1 var(--mono);letter-spacing:.04em;text-transform:uppercase;color:var(--fg2);text-decoration:none}
.top a.back:hover,.top a.back:focus-visible{color:var(--fg)}
main{display:grid;place-items:center;padding:48px clamp(16px,4vw,40px)}
form{width:min(520px,100%)}
.tag{display:inline-block;padding:4px 8px;border:1px solid var(--rule);font:500 10.5px/1 var(--mono);letter-spacing:.06em;text-transform:uppercase;color:var(--fg2)}
.hatch{display:inline-block;width:120px;height:9px;margin-left:12px;vertical-align:middle;background:repeating-linear-gradient(-60deg,var(--fg2) 0 1px,transparent 1px 4px);opacity:.5}
h1{margin:28px 0 0;font:300 clamp(44px,9vw,84px)/.92 var(--mono);font-variation-settings:"wdth" 100;letter-spacing:-.05em;text-transform:uppercase}
p.lead{margin:20px 0 40px;max-width:40ch;color:var(--fg2);font-size:16px}
label.pw{display:block;font:500 10.5px/1 var(--mono);letter-spacing:.06em;text-transform:uppercase;color:var(--fg2)}
input[type=password]{width:100%;height:56px;margin-top:10px;padding:0;border:0;border-bottom:1px solid var(--rule);border-radius:0;background:transparent;color:var(--fg);font:400 20px var(--mono);letter-spacing:.1em;outline:none}
input[type=password]:focus{border-bottom-color:var(--fg)}
.row{display:flex;align-items:center;justify-content:space-between;gap:16px;flex-wrap:wrap;margin-top:28px}
.keep{display:flex;align-items:center;gap:10px;font-size:14px;color:var(--fg2);cursor:pointer}
.keep input{width:16px;height:16px;margin:0;accent-color:var(--nominal)}
button{display:inline-flex;align-items:center;gap:28px;height:64px;padding:0 30px 0 34px;border:1px solid var(--fg);border-radius:999px;background:transparent;color:var(--fg);font:400 16px var(--sans);cursor:pointer;transition:background .25s,color .25s}
button span{font:300 22px/1 var(--mono)}
button:hover,button:focus-visible{background:var(--fg);color:var(--bg);outline:none}
button[disabled]{opacity:.6;cursor:wait}
#err{min-height:20px;margin:22px 0 0;font:500 11px/1.4 var(--mono);letter-spacing:.06em;text-transform:uppercase;color:var(--flag)}
.foot{display:flex;justify-content:space-between;gap:16px;flex-wrap:wrap;padding:18px clamp(16px,4vw,40px);border-top:1px solid var(--rule);font:500 10px/1.6 var(--mono);letter-spacing:.06em;text-transform:uppercase;color:var(--fg2)}
.dot{display:inline-block;width:6px;height:6px;margin-right:8px;border-radius:50%;background:var(--nominal);vertical-align:1px}
</style>
</head>
<body>
<header class="top">
  <a class="brand" href="../" aria-label="Herd, public site">
    <svg viewBox="0 0 40 40" fill="currentColor" aria-hidden="true"><circle cx="14" cy="9" r="3.6"/><circle cx="26" cy="9" r="3.6"/><circle cx="8" cy="20" r="3.6"/><circle cx="20" cy="20" r="3.6"/><circle cx="32" cy="20" r="4.6" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="14" cy="31" r="3.6"/><circle cx="26" cy="31" r="3.6"/></svg>
    <span>Herd Lifecycle<br>&amp; Environment Records</span>
  </a>
  <a class="back" href="../">&larr; Public site</a>
</header>
<main>
<form id="f" autocomplete="on">
  <span class="tag">009-00 · Restricted</span><span class="hatch" aria-hidden="true"></span>
  <h1>Internal</h1>
  <p class="lead">Owner access only. The records app decrypts in this browser when the passphrase is right.</p>
  <input type="text" name="username" value="herd" autocomplete="username" hidden>
  <label class="pw" for="pw">Passphrase</label>
  <input id="pw" type="password" autocomplete="current-password" required autofocus>
  <div class="row">
    <label class="keep"><input id="keep" type="checkbox">Keep me signed in on this device</label>
    <button id="go" type="submit">Unlock <span aria-hidden="true">+</span></button>
  </div>
  <p id="err" role="alert"></p>
</form>
</main>
<footer class="foot">
  <span><i class="dot" aria-hidden="true"></i>AES-256-GCM · PBKDF2-SHA256 · ${it.toLocaleString('en-US')} iterations</span>
  <span>Nothing leaves this browser</span>
</footer>
<script>
(function () {
  var SALT = "${salt}", IV = "${iv}", IT = ${it};
  var CT = "${ct}";
  var KEY = "herd:unlock";
  var B = function (s) { return Uint8Array.from(atob(s), function (c) { return c.charCodeAt(0); }); };
  var err = document.getElementById("err"), go = document.getElementById("go");
  var label = go.innerHTML;
  async function show(key) {
    var buf = await crypto.subtle.decrypt({ name: "AES-GCM", iv: B(IV) }, key, B(CT));
    var html = new TextDecoder().decode(buf);
    document.open(); document.write(html); document.close();
  }
  async function derive(pw) {
    var base = await crypto.subtle.importKey("raw", new TextEncoder().encode(pw), "PBKDF2", false, ["deriveKey"]);
    return crypto.subtle.deriveKey({ name: "PBKDF2", salt: B(SALT), iterations: IT, hash: "SHA-256" }, base, { name: "AES-GCM", length: 256 }, true, ["decrypt"]);
  }
  async function remembered() {
    try {
      var raw = localStorage.getItem(KEY);
      if (!raw) return;
      var key = await crypto.subtle.importKey("raw", B(raw), "AES-GCM", false, ["decrypt"]);
      await show(key);
    } catch (e) { try { localStorage.removeItem(KEY); } catch (e2) {} }
  }
  document.getElementById("f").addEventListener("submit", async function (ev) {
    ev.preventDefault();
    err.textContent = ""; go.disabled = true; go.textContent = "Unlocking…";
    try {
      var key = await derive(document.getElementById("pw").value);
      var buf = await crypto.subtle.decrypt({ name: "AES-GCM", iv: B(IV) }, key, B(CT));
      if (document.getElementById("keep").checked) {
        var raw = new Uint8Array(await crypto.subtle.exportKey("raw", key));
        try { localStorage.setItem(KEY, btoa(String.fromCharCode.apply(null, raw))); } catch (e) {}
      }
      var html = new TextDecoder().decode(buf);
      document.open(); document.write(html); document.close();
    } catch (e) {
      err.textContent = "Wrong passphrase.";
      go.disabled = false; go.innerHTML = label;
    }
  });
  if (!window.crypto || !crypto.subtle) { err.textContent = "This browser can't unlock the page. Open it over https."; }
  else remembered();
})();
</script>
</body>
</html>
`;
}
