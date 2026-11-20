#!/usr/bin/env node
/* Herd · lock
   Builds docs/index.html: the whole app, inlined and encrypted with a password
   (PBKDF2 → AES-256-GCM). The page shows a login box and only decrypts in the
   browser when the password is right. GitHub Pages serves /docs.

   Usage:   HERD_PASSWORD='your passphrase' node tools/lock.mjs
        or: node tools/lock.mjs          (prompts for the password)

   The password is never written to disk. Re-run any time to change it. */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { webcrypto as crypto } from 'node:crypto';
import { createInterface } from 'node:readline';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const ITERATIONS = 310000;

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

// 2. Encrypt.
const enc = new TextEncoder();
const salt = crypto.getRandomValues(new Uint8Array(16));
const iv = crypto.getRandomValues(new Uint8Array(12));
const base = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveKey']);
const key = await crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: ITERATIONS, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt']);
const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(html)));
const b64 = (u8) => Buffer.from(u8).toString('base64');

// 3. Login page.
const page = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="robots" content="noindex, nofollow">
<meta name="color-scheme" content="light dark">
<title>Herd</title>
<style>
:root{color-scheme:light dark;--bg:#F2EFF6;--text:#0B0B0F;--text2:#5B5B66;--glass:rgba(255,255,255,.34);--hi:rgba(255,255,255,.95);--shadow:rgba(70,55,110,.2);--accent:#4F5BD5;--bad:#C4282D;--a:rgba(247,170,130,.85);--b:rgba(150,140,248,.8);--c:rgba(140,196,244,.75)}
@media(prefers-color-scheme:dark){:root{--bg:#08080C;--text:#EDEDEF;--text2:#B4B4C0;--glass:rgba(255,255,255,.06);--hi:rgba(255,255,255,.3);--shadow:rgba(0,0,0,.6);--accent:#8B93FF;--bad:#FF7B80;--a:rgba(140,86,58,.55);--b:rgba(76,84,210,.6);--c:rgba(30,124,144,.55)}}
*{box-sizing:border-box}
body{margin:0;min-height:100vh;min-height:100dvh;display:grid;place-items:center;padding:24px;background:var(--bg);color:var(--text);font:15px/1.5 Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif;-webkit-font-smoothing:antialiased}
body::before{content:"";position:fixed;inset:-12%;z-index:-1;background:radial-gradient(34% 30% at 14% 12%,var(--a),transparent 70%),radial-gradient(34% 30% at 88% 24%,var(--b),transparent 72%),radial-gradient(32% 30% at 60% 94%,var(--c),transparent 72%);filter:blur(18px)}
form{width:min(380px,100%);padding:30px 28px 26px;border-radius:30px;background:var(--glass);-webkit-backdrop-filter:blur(22px) saturate(2);backdrop-filter:blur(22px) saturate(2);box-shadow:inset 0 1px 0 var(--hi),inset 0 0 24px rgba(255,255,255,.08),0 20px 50px var(--shadow)}
h1{margin:0;font-size:22px;font-weight:600;letter-spacing:-.03em}
p{margin:6px 0 20px;color:var(--text2);font-size:14px}
label{display:block;margin-bottom:6px;font-size:13px;color:var(--text2)}
input[type=password]{width:100%;height:46px;padding:0 16px;border:1px solid rgba(255,255,255,.5);border-radius:14px;background:rgba(255,255,255,.18);color:var(--text);font:inherit;font-size:16px}
input[type=password]:focus{outline:2px solid var(--accent);outline-offset:1px}
.row{display:flex;align-items:center;gap:8px;margin:14px 0 0;font-size:13.5px;color:var(--text2)}
.row input{width:16px;height:16px;accent-color:var(--accent)}
button{width:100%;height:46px;margin-top:18px;border:0;border-radius:999px;background:var(--accent);color:#fff;font:inherit;font-weight:600;cursor:pointer;box-shadow:inset 0 1px 0 rgba(255,255,255,.4),0 10px 24px rgba(79,91,213,.3)}
button[disabled]{opacity:.6;cursor:wait}
#err{min-height:20px;margin:12px 0 0;font-size:13.5px;color:var(--bad)}
</style>
</head>
<body>
<form id="f" autocomplete="on">
  <h1>Herd</h1>
  <p>Private. Enter the password to continue.</p>
  <label for="pw">Password</label>
  <input id="pw" type="password" autocomplete="current-password" required autofocus>
  <div class="row"><input id="keep" type="checkbox"><label for="keep" style="margin:0">Keep me signed in on this device</label></div>
  <button id="go" type="submit">Unlock</button>
  <p id="err" role="alert"></p>
</form>
<script>
(function () {
  var SALT = "${b64(salt)}", IV = "${b64(iv)}", IT = ${ITERATIONS};
  var CT = "${b64(cipher)}";
  var KEY = "herd:unlock";
  var B = function (s) { return Uint8Array.from(atob(s), function (c) { return c.charCodeAt(0); }); };
  var err = document.getElementById("err"), go = document.getElementById("go");
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
      if (document.getElementById("keep").checked) {
        var raw = new Uint8Array(await crypto.subtle.exportKey("raw", key));
        try { localStorage.setItem(KEY, btoa(String.fromCharCode.apply(null, raw))); } catch (e) {}
      }
      await show(key);
    } catch (e) {
      err.textContent = "Wrong password.";
      go.disabled = false; go.textContent = "Unlock";
    }
  });
  if (!window.crypto || !crypto.subtle) { err.textContent = "This browser can't unlock the page. Open it over https."; }
  else remembered();
})();
</script>
</body>
</html>
`;
mkdirSync(join(root, 'docs'), { recursive: true });
writeFileSync(join(root, 'docs', 'index.html'), page);
writeFileSync(join(root, 'docs', '.nojekyll'), '');
console.log(`Locked: docs/index.html (${Math.round(page.length / 1024)} KB). Set GitHub Pages to main, /docs.`);
