/* App instalável do AURION (PWA): instalação, atualização, modo offline e página "Instalar o app".
 * Nada aqui guarda dados financeiros: o service worker só guarda arquivos da interface (ADR-006). */
import { esc, icon } from "./ui.js";

/* ---------- funções puras (testadas em worker/test/pwa.test.mjs) */
export function platformOf(ua = "", maxTouch = 0) {
  const ios = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && maxTouch > 1);   // iPadOS se apresenta como Mac
  if (ios) return { os: "ios", browser: /CriOS|FxiOS|EdgiOS/.test(ua) ? "outro" : "safari" };
  if (/Android/.test(ua)) return { os: "android", browser: /SamsungBrowser/.test(ua) ? "samsung" : /Firefox/.test(ua) ? "firefox" : "chrome" };
  return { os: "desktop", browser: /Edg\//.test(ua) ? "edge" : /Firefox/.test(ua) ? "firefox" : /Safari/.test(ua) && !/Chrome/.test(ua) ? "safari" : "chrome" };
}
/* Como instalar: "prompt" (botão nativo), "ios" (Compartilhar → Tela de Início), "manual" (menu do navegador), "installed". */
export function installMode({ standalone, hasPrompt, platform }) {
  if (standalone) return "installed";
  if (hasPrompt) return "prompt";
  if (platform.os === "ios") return "ios";
  return "manual";
}
export const STEPS = {
  ios: ["No Safari, toque em Compartilhar (o quadrado com a seta para cima).", "Role a lista e escolha “Adicionar à Tela de Início”.", "Toque em Adicionar. O ícone do AURION aparece na tela inicial."],
  "ios-outro": ["No iPhone e no iPad, a instalação é feita pelo Safari.", "Abra aurionfinance.com.br/app no Safari, toque em Compartilhar e escolha “Adicionar à Tela de Início”."],
  android: ["Toque no menu ⋮ do navegador.", "Escolha “Instalar app” ou “Adicionar à tela inicial”.", "Confirme em Instalar."],
  desktop: ["Clique no ícone de instalar na barra de endereço (um monitor com uma seta) ou abra o menu do navegador.", "Escolha “Instalar AURION”.", "O app abre em janela própria e fica no menu Iniciar ou no Launchpad."],
  firefox: ["O Firefox para computador não instala apps da web.", "Use Chrome ou Edge para instalar, ou continue usando pelo navegador normalmente."],
};
export function stepsFor(platform) {
  if (platform.os === "ios") return platform.browser === "safari" ? STEPS.ios : STEPS["ios-outro"];
  if (platform.os === "android") return STEPS.android;
  return platform.browser === "firefox" || platform.browser === "safari" ? STEPS.firefox : STEPS.desktop;
}

/* ---------- estado no navegador */
const hasWin = typeof window !== "undefined";
let deferred = null;
const listeners = new Set();
const notify = () => listeners.forEach(f => { try { f(); } catch { /* ignora */ } });
export const pwa = {
  get standalone() { return hasWin && (matchMedia("(display-mode: standalone)").matches || navigator.standalone === true); },
  get platform() { return platformOf(navigator.userAgent, navigator.maxTouchPoints || 0); },
  get mode() { return installMode({ standalone: this.standalone, hasPrompt: !!deferred, platform: this.platform }); },
  onChange(f) { listeners.add(f); return () => listeners.delete(f); },
  async install() {
    if (!deferred) return "unavailable";
    deferred.prompt();
    const { outcome } = await deferred.userChoice.catch(() => ({ outcome: "dismissed" }));
    deferred = null; notify();
    return outcome;
  },
};

if (hasWin) {
  addEventListener("beforeinstallprompt", e => { e.preventDefault(); deferred = e; notify(); });
  addEventListener("appinstalled", () => { deferred = null; notify(); banner("Pronto: o AURION foi instalado. Abra pelo ícone na tela inicial.", "phone"); });
  document.documentElement.classList.toggle("is-standalone", pwa.standalone);
  matchMedia("(display-mode: standalone)").addEventListener?.("change", () => { document.documentElement.classList.toggle("is-standalone", pwa.standalone); notify(); });

  /* service worker + aviso de nova versão */
  if ("serviceWorker" in navigator && isSecureContext) addEventListener("load", async () => {
    try {
      const reg = await navigator.serviceWorker.register("sw.js");
      const offer = w => banner("Há uma nova versão do AURION.", "refresh", { label: "Atualizar", run: () => w.postMessage({ type: "SKIP_WAITING" }) }, "update");
      if (reg.waiting && navigator.serviceWorker.controller) offer(reg.waiting);
      reg.addEventListener("updatefound", () => {
        const w = reg.installing;
        w?.addEventListener("statechange", () => { if (w.state === "installed" && navigator.serviceWorker.controller) offer(w); });
      });
      let reloaded = false;
      navigator.serviceWorker.addEventListener("controllerchange", () => { if (!reloaded) { reloaded = true; location.reload(); } });
      setInterval(() => reg.update().catch(() => {}), 60 * 60 * 1000);   // procura versão nova a cada hora com o app aberto
    } catch { /* sem service worker: o site funciona normalmente */ }
  });

  /* sem internet */
  const net = () => navigator.onLine ? document.querySelector('[data-pwa-banner="offline"]')?.remove()
    : banner("Sem conexão. A interface continua aberta; os seus números voltam a carregar quando a internet voltar.", "offline", null, "offline");
  addEventListener("online", net); addEventListener("offline", net);
  if (!navigator.onLine) addEventListener("load", net);
}

/* faixa discreta no rodapé (acima da barra de abas no celular) */
function banner(msg, ic, action, id = "info") {
  document.querySelector(`[data-pwa-banner="${id}"]`)?.remove();
  const b = document.createElement("div");
  b.className = "pwa-banner"; b.dataset.pwaBanner = id; b.setAttribute("role", "status");
  b.innerHTML = `${icon(ic)}<span>${esc(msg)}</span>${action ? `<button type="button" class="btn btn--sm">${esc(action.label)}</button>` : ""}<button type="button" class="pwa-x" aria-label="Fechar aviso">×</button>`;
  b.querySelector(".btn")?.addEventListener("click", () => { action.run(); b.remove(); });
  b.querySelector(".pwa-x").addEventListener("click", () => b.remove());
  document.body.appendChild(b);
  if (id === "info") setTimeout(() => b.remove(), 7000);
}

/* ---------- item de menu "Instalar o app" (avatar e menu lateral) */
export const installMenuItem = () => pwa.standalone ? "" : `<a href="#/instalar" role="menuitem" data-install-item>${icon("phone")}<span>Instalar o app</span></a>`;

/* ---------- página #/instalar (pública: funciona antes do login) */
const FEATURES = [
  ["phone", "Ícone na tela inicial", "Abre direto no AURION, em tela cheia, sem barra do navegador."],
  ["shield", "Mesma segurança", "Mesmo login, verificação em duas etapas e criptografia do site. Nada fica guardado no aparelho além da interface."],
  ["refresh", "Sempre atualizado", "Não há loja nem download de atualização: o app avisa quando houver versão nova."],
  ["offline", "Abre sem internet", "A interface abre mesmo offline; os números carregam quando a conexão voltar."],
];
export async function installView(root) {
  const draw = () => {
    const p = pwa.platform, mode = pwa.mode;
    const action = mode === "installed" ? `<p class="pwa-ok">${icon("phone")} Você já está usando o app instalado.</p><a class="btn" href="#/dashboard">Abrir o AURION</a>`
      : mode === "prompt" ? `<button type="button" class="btn btn--lg" data-do-install>${icon("download")} Instalar o AURION</button><p class="muted small">Grátis. Ocupa menos de 2 MB.</p>`
      : `<ol class="pwa-steps">${stepsFor(p).map(s => `<li>${esc(s)}</li>`).join("")}</ol>`;
    root.innerHTML = `<section class="pwa-page" aria-labelledby="pwa-h">
      <a class="pwa-back" href="${location.hash.includes("de=site") ? "../index.html" : "#/dashboard"}">← Voltar</a>
      <div class="pwa-hero">
        <img src="icons/icon-192.png" width="88" height="88" alt="" class="pwa-icon">
        <div><p class="eyebrow">App AURION</p><h1 id="pwa-h">Seu painel financeiro e tributário no bolso</h1>
          <p class="muted">Instale o AURION no celular ou no computador. É o mesmo sistema do site, com a sua conta e os seus dados, em um app.</p></div>
      </div>
      <div class="pwa-action card">${action}
        <p class="muted small pwa-plat">Detectado: ${esc({ ios: "iPhone ou iPad", android: "Android", desktop: "computador" }[p.os])}${mode === "manual" || mode === "ios" ? " · siga os passos acima" : ""}</p></div>
      <ul class="pwa-feats">${FEATURES.map(([ic, t, d]) => `<li class="card">${icon(ic)}<div><b>${esc(t)}</b><p class="muted small">${esc(d)}</p></div></li>`).join("")}</ul>
      <details class="card pwa-other"><summary>Instalar em outro aparelho</summary>
        <h3>iPhone e iPad (Safari)</h3><ol>${STEPS.ios.map(s => `<li>${esc(s)}</li>`).join("")}</ol>
        <h3>Android (Chrome, Samsung Internet)</h3><ol>${STEPS.android.map(s => `<li>${esc(s)}</li>`).join("")}</ol>
        <h3>Computador (Chrome ou Edge)</h3><ol>${STEPS.desktop.map(s => `<li>${esc(s)}</li>`).join("")}</ol>
      </details>
    </section>`;
    root.querySelector("[data-do-install]")?.addEventListener("click", async () => { await pwa.install(); draw(); });
  };
  draw();
  const off = pwa.onChange(() => { if (root.isConnected) draw(); else off(); });
  document.title = "AURION — Instalar o app";
}

/* ---------- barra de abas inferior (celular e app instalado) */
export function tabBar(items, moreLabel = "Mais") {
  return `<nav class="tabbar" aria-label="Navegação rápida">${items.map(([k, t, ic]) => `<a href="#/${k}" data-tab="${k}">${icon(ic)}<span>${esc(t)}</span>${k === "alertas" ? '<i class="tab-dot" data-tab-dot hidden></i>' : ""}</a>`).join("")}
    <button type="button" data-burger data-tab="__mais">${icon("dots")}<span>${esc(moreLabel)}</span></button></nav>`;
}
