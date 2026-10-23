/* Service worker do app AURION.
 * Guarda SÓ a interface (HTML, CSS, JS, ícones e fontes do próprio site) para o app abrir rápido e funcionar sem internet.
 * Respostas da API (outro domínio) e a pasta /data/ nunca são guardadas: dados financeiros só vêm da rede (ADR-006).
 * A lista PRECACHE é conferida por worker/test/pwa.test.mjs: todo arquivo de app/js e app/css precisa estar nela. */
const VERSION = "aurion-app-v6";
const PRECACHE = [
  "./",
  "index.html",
  "manifest.webmanifest",
  "icons/icon-192.png",
  "icons/icon-512.png",
  "icons/apple-touch-180.png",
  "img/glass-city.svg",
  "img/bull.svg",
  "../css/fonts.css",
  "../assets/img/favicon.svg",
  "../assets/brand/aurion-symbol.svg",
  "../assets/brand/aurion-symbol-dark.svg",
  "../assets/fonts/montserrat-latin-700-normal.woff2",
  "js/alert_engine.js",
  "js/allocation.js",
  "js/api.js",
  "js/app.js",
  "js/assistant_engine.js",
  "js/auth4.js",
  "js/brand.js",
  "js/config.js",
  "js/crm_rules.js",
  "js/daily_engine.js",
  "js/dash4.js",
  "js/data_quality.js",
  "js/doc_engine.js",
  "js/doc_extract.js",
  "js/event_engine.js",
  "js/fin_engine.js",
  "js/guia_engine.js",
  "js/importers.js",
  "js/irpf_report.js",
  "js/knowledge.js",
  "js/market.js",
  "js/market_public.js",
  "js/market_store.js",
  "js/openfinance.js",
  "js/pwa.js",
  "js/sim_engine.js",
  "js/tax_engine.js",
  "js/tax_rules.js",
  "js/tour.js",
  "js/tour_admin.js",
  "js/tour_explain.js",
  "js/tour_explain2.js",
  "js/tour_explain3.js",
  "js/tour_explain4.js",
  "js/tour_paginas.js",
  "js/tour_paginas2.js",
  "js/tour_trader.js",
  "js/tour_tributacao.js",
  "js/trader_engine.js",
  "js/ui.js",
  "js/ui4.js",
  "js/views.js",
  "js/views_crm.js",
  "js/views_docread.js",
  "js/views_docs.js",
  "js/views_finance2.js",
  "js/views_guias.js",
  "js/views_hub.js",
  "js/views_identity.js",
  "js/views_import.js",
  "js/views_openfinance.js",
  "js/views_ops.js",
  "js/views_payments.js",
  "js/views_public.js",
  "js/views_tax2.js",
  "js/views_trader.js",
  "css/app.css",
  "css/auth4.css",
  "css/brand.css",
  "css/glass.css",
  "css/pwa.css",
  "css/tour.css"
];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(VERSION).then(c => Promise.all(PRECACHE.map(u => c.add(new Request(u, { cache: "reload" })).catch(() => null)))));
  // sem skipWaiting aqui: a versão nova espera o usuário tocar em "Atualizar" (a primeira instalação ativa sozinha)
});
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("message", e => { if (e.data?.type === "SKIP_WAITING") self.skipWaiting(); });

const put = (req, res) => { if (res && res.ok && res.type === "basic") { const copy = res.clone(); caches.open(VERSION).then(c => c.put(req, copy)); } return res; };

self.addEventListener("fetch", e => {
  const req = e.request, u = new URL(req.url);
  if (req.method !== "GET" || u.origin !== location.origin || u.pathname.includes("/data/")) return;   // API e dados: sempre pela rede
  if (req.mode === "navigate") {   // páginas: rede primeiro; sem internet, a casca do app
    e.respondWith(fetch(req).then(r => put(req, r)).catch(async () => (await caches.match(req, { ignoreSearch: true })) || caches.match("index.html")));
    return;
  }
  // arquivos estáticos: rede primeiro (o site publica versões novas várias vezes por dia); sem internet, a cópia guardada
  e.respondWith(fetch(req).then(r => put(req, r)).catch(() => caches.match(req, { ignoreSearch: true })));
});
