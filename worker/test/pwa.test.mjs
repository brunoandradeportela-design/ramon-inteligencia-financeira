/* App instalável (PWA): detecção de plataforma, modo de instalação, manifesto e lista do service worker. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { platformOf, installMode, stepsFor } from "../../apps/web/app/js/pwa.js";

const APP = new URL("../../apps/web/app/", import.meta.url);
const UA = {
  iphone: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
  iphoneChrome: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/129.0 Mobile/15E148 Safari/604.1",
  ipad: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15",
  android: "Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Mobile Safari/537.36",
  windows: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36 Edg/129.0",
  firefox: "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:131.0) Gecko/20100101 Firefox/131.0",
};

test("detecta iPhone, iPad (que se apresenta como Mac), Android e computador", () => {
  assert.deepEqual(platformOf(UA.iphone), { os: "ios", browser: "safari" });
  assert.deepEqual(platformOf(UA.iphoneChrome), { os: "ios", browser: "outro" });
  assert.deepEqual(platformOf(UA.ipad, 5), { os: "ios", browser: "safari" });
  assert.equal(platformOf(UA.ipad, 0).os, "desktop");
  assert.deepEqual(platformOf(UA.android), { os: "android", browser: "chrome" });
  assert.deepEqual(platformOf(UA.windows), { os: "desktop", browser: "edge" });
  assert.equal(platformOf(UA.firefox).browser, "firefox");
});

test("modo de instalação: instalado > botão nativo > passos do iOS > passos manuais", () => {
  const ios = platformOf(UA.iphone), and = platformOf(UA.android);
  assert.equal(installMode({ standalone: true, hasPrompt: true, platform: and }), "installed");
  assert.equal(installMode({ standalone: false, hasPrompt: true, platform: and }), "prompt");
  assert.equal(installMode({ standalone: false, hasPrompt: false, platform: ios }), "ios");
  assert.equal(installMode({ standalone: false, hasPrompt: false, platform: and }), "manual");
  assert.match(stepsFor(ios).join(" "), /Compartilhar.*Tela de Início/);
  assert.match(stepsFor(platformOf(UA.iphoneChrome)).join(" "), /Safari/);
  assert.match(stepsFor(platformOf(UA.firefox)).join(" "), /Chrome ou Edge/);
});

test("manifesto: campos de instalação, ícones e capturas existem, atalhos apontam para rotas do app", () => {
  const m = JSON.parse(readFileSync(new URL("manifest.webmanifest", APP), "utf8"));
  for (const k of ["id", "name", "short_name", "start_url", "scope", "display", "theme_color", "background_color"]) assert.ok(m[k], k);
  assert.ok(m.icons.some(i => i.sizes === "512x512" && i.purpose === "maskable"), "ícone maskable 512");
  assert.ok(m.icons.some(i => i.sizes === "192x192"), "ícone 192");
  for (const f of [...m.icons, ...m.screenshots]) assert.ok(existsSync(new URL(f.src, APP)), f.src);
  assert.ok(m.screenshots.some(s => s.form_factor === "wide") && m.screenshots.some(s => s.form_factor === "narrow"));
  const app = readFileSync(new URL("js/app.js", APP), "utf8");
  for (const s of m.shortcuts) { const r = s.url.replace("./#/", ""); assert.match(app, new RegExp(`\\b${r}\\b`), s.url); }
});

test("service worker: guarda todo JS/CSS do app e nunca a API nem /data/", () => {
  const sw = readFileSync(new URL("sw.js", APP), "utf8");
  const list = JSON.parse(sw.match(/const PRECACHE = (\[[\s\S]*?\]);/)[1]);
  for (const dir of ["js", "css"]) for (const f of readdirSync(new URL(dir + "/", APP))) assert.ok(list.includes(`${dir}/${f}`), `${dir}/${f} fora da lista do service worker`);
  for (const f of list) assert.ok(existsSync(new URL(f === "./" ? "index.html" : f, APP)), f);
  assert.match(sw, /u\.origin !== location\.origin/);
  assert.match(sw, /\/data\//);
  assert.match(sw, /SKIP_WAITING/);
  assert.doesNotMatch(sw.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, ""), /skipWaiting\(\)\);?\s*\}\)\);?\s*$/m, "install não deve pular a espera");
});
