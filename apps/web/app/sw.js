/* PWA do AURION: instala o app e abre offline a casca da interface.
 * Só guarda arquivos estáticos do próprio site (HTML/CSS/JS/ícones). Dados financeiros e respostas da API nunca são guardados (ADR-006). */
const VERSION = "aurion-shell-v3";
const SHELL = ["./", "index.html", "css/app.css", "css/glass.css", "css/auth4.css", "img/glass-city.svg", "../css/fonts.css", "js/config.js", "js/app.js", "manifest.webmanifest", "icons/icon-192.png", "../assets/img/favicon.svg"];
self.addEventListener("install", e => { e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener("activate", e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener("fetch", e => {
  const u = new URL(e.request.url);
  if (e.request.method !== "GET" || u.origin !== location.origin || u.pathname.includes("/data/")) return;     // API e dados: sempre pela rede
  e.respondWith(fetch(e.request).then(r => { if (r.ok) { const copy = r.clone(); caches.open(VERSION).then(c => c.put(e.request, copy)); } return r; })
    .catch(() => caches.match(e.request).then(m => m || caches.match("index.html"))));
});
