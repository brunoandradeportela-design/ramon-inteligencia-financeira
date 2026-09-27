/* Shell da aplicação: roteamento por hash, sessão, tema (Claro/Escuro/Sistema) e navegação. */
import { api, DEMO, session, ApiError } from "./api.js";
import { esc, icon, errorBox, loading } from "./ui.js";
import * as V from "./views.js";
import { crm } from "./views_crm.js";

const NAV = [
  ["dashboard", "Início", "home"], ["patrimonio", "Patrimônio", "wealth"], ["financas", "Finanças", "finance"],
  ["tributacao", "Tributação", "tax"], ["simulador", "Simulador", "sim"], ["alertas", "Alertas", "bell"],
  ["documentos", "Documentos", "doc"], ["conexoes", "Conexões", "link"], ["assistente", "Assistente IA", "ai"],
];
const TITLES = Object.fromEntries(NAV.map(([k, t]) => [k, t]));
Object.assign(TITLES, { crm: "CRM · Clientes", planos: "Planos", configuracoes: "Configurações", privacidade: "Privacidade e auditoria" });
const PUBLIC = { entrar: V.login, cadastro: V.register };
const ADMIN_ROUTES = { crm, configuracoes: V.settings };
const ROUTES = {
  dashboard: V.dashboard, patrimonio: V.portfolio, financas: V.finance, tributacao: V.tax, simulador: V.simulator,
  alertas: V.alerts, documentos: V.documents, conexoes: V.connections, assistente: V.assistant, planos: V.plans,
  configuracoes: V.settings, privacidade: V.privacy,
};

/* ------------------------------------------------------------ tema */
const mq = matchMedia("(prefers-color-scheme: light)");
export const theme = {
  get pref() { try { return localStorage.getItem("ramon.theme") || "system"; } catch { return "system"; } },
  apply(pref = this.pref) {
    const resolved = pref === "system" ? (mq.matches ? "light" : "dark") : pref;
    document.documentElement.setAttribute("data-theme", resolved);
    document.querySelectorAll("[data-theme-btn]").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.themeBtn === pref)));
  },
  async set(pref) {
    try { localStorage.setItem("ramon.theme", pref); } catch {}
    this.apply(pref);
    if (session.token) api.put("/v1/theme-preference", { theme: pref }).catch(() => {});   // sincroniza com o perfil
  },
};
mq.addEventListener("change", () => theme.pref === "system" && theme.apply());
export const themeSwitch = () => `<div class="theme-switch" role="group" aria-label="Tema da interface">
  ${[["light", "sun", "Claro"], ["dark", "moon", "Escuro"], ["system", "auto", "Sistema"]].map(([k, ic, l]) =>
    `<button type="button" data-theme-btn="${k}" aria-pressed="${theme.pref === k}" title="Tema ${l}">${icon(ic)}<span class="lbl">${l}</span></button>`).join("")}</div>`;
document.addEventListener("click", e => {
  const b = e.target.closest("[data-theme-btn]");
  if (b) theme.set(b.dataset.themeBtn);
  if (e.target.closest("[data-burger]")) document.body.classList.toggle("nav-open");
  if (e.target.closest(".navi")) document.body.classList.remove("nav-open");
  if (e.target.closest("[data-logout]")) { api.post("/v1/auth/logout").catch(() => {}); session.set(null); me = null; location.hash = "#/entrar"; }
});

/* ------------------------------------------------------------ roteador */
let me = null, alertsOpen = 0;
function parse() {
  const h = location.hash.replace(/^#\/?/, "") || "dashboard";
  const [path, qs] = h.split("?");
  const parts = path.split("/");
  return { name: parts[0], sub: parts[1], params: new URLSearchParams(qs || "") };
}

async function render() {
  const r = parse();
  const root = document.getElementById("root");
  if (PUBLIC[r.name]) { root.innerHTML = ""; await PUBLIC[r.name](root, r); document.title = `Fintechs — ${r.name === "entrar" ? "Entrar" : "Cadastro"}`; return; }
  if (!session.token) { location.hash = `#/entrar?next=${encodeURIComponent(r.name)}`; return; }
  try {
    if (!me) me = await api.get("/v1/me");
    const admin = me.roles?.includes("admin");
    if (admin && !ADMIN_ROUTES[r.name]) { location.hash = "#/crm"; return; }
    if (!admin && r.name === "crm") { location.hash = "#/dashboard"; return; }
    const view = admin ? ADMIN_ROUTES[r.name] : (ROUTES[r.name] || ROUTES.dashboard);
    const sh = document.querySelector(".shell");
    if (!sh || sh.dataset.role !== (admin ? "admin" : "client")) root.innerHTML = shell(admin);
    alertsOpen = admin ? 0 : (await api.get("/v1/alerts").catch(() => ({ items: [] }))).items.filter(a => a.status === "novo").length;
    updateShell(r.name);
    const main = document.getElementById("view");
    main.innerHTML = loading();
    document.title = `Fintechs — ${TITLES[r.name] || "Início"}`;
    await view(main, r, { me, refresh: () => render() });
    main.focus({ preventScroll: true });
  } catch (e) {
    if (e instanceof ApiError && e.status === 401) { session.set(null); me = null; location.hash = "#/entrar"; return; }
    const main = document.getElementById("view") || root;
    main.innerHTML = errorBox(e);
    console.error(e);
  }
}

function shell(admin = false) {
  const nav = admin ? `<p class="eyebrow" style="padding:0 12px 8px">Administração</p><a class="navi" href="#/crm" data-nav="crm">${icon("wealth")}<span>CRM · Clientes</span></a>`
    : NAV.map(([k, t, ic]) => `<a class="navi" href="#/${k}" data-nav="${k}">${icon(ic)}<span>${t}</span>${k === "alertas" ? '<span class="count" data-alert-count hidden></span>' : ""}</a>`).join("");
  return `<div class="shell" data-role="${admin ? "admin" : "client"}">
    <aside class="side" aria-label="Navegação">
      <a class="side__logo" href="../index.html" title="Página inicial">Fintechs</a>
      <nav>${nav}</nav>
      <div class="side__bottom">
        <div class="side__sep"></div>
        ${admin ? "" : `<a class="navi" href="#/planos" data-nav="planos">${icon("plan")}<span>Planos</span></a>
        <a class="navi" href="#/privacidade" data-nav="privacidade">${icon("shield")}<span>Privacidade</span></a>`}
        <a class="navi" href="#/configuracoes" data-nav="configuracoes">${icon("gear")}<span>Configurações</span></a>
      </div>
    </aside>
    <div class="main">
      ${DEMO ? `<div class="demo-bar" role="note"><b>Modo demonstração</b> — dados fictícios calculados pelos motores do backend (snapshot de 27/09/2026). Nenhum dado real é coletado.</div>` : ""}
      <header class="top">
        <button class="icon-btn burger" data-burger aria-label="Abrir menu">${icon("menu")}</button>
        <h1 data-title>Início</h1>
        <div class="top__spacer"></div>
        <span class="chip hide-m" title="Data de referência dos cálculos">Set 2026</span>
        ${themeSwitch()}
        <a class="icon-btn" href="#/alertas" aria-label="Alertas">${icon("bell")}<span class="dot" data-dot hidden></span></a>
        <div class="avatar" title="${esc(me?.name || "")}" aria-label="Usuário ${esc(me?.name || "")}">${esc((me?.name || "?")[0])}</div>
        <button class="icon-btn" data-logout aria-label="Sair">${icon("logout")}</button>
      </header>
      <main class="content" id="view" tabindex="-1"></main>
    </div></div>`;
}

function updateShell(name) {
  document.querySelectorAll("[data-nav]").forEach(a => a.dataset.nav === name ? a.setAttribute("aria-current", "page") : a.removeAttribute("aria-current"));
  const t = document.querySelector("[data-title]"); if (t) t.textContent = TITLES[name] || "Início";
  const c = document.querySelector("[data-alert-count]"); if (c) { c.textContent = alertsOpen; c.hidden = !alertsOpen; }
  const d = document.querySelector("[data-dot]"); if (d) d.hidden = !alertsOpen;
  theme.apply();
}

export function onLogin(token, user) { session.set(token); me = user; document.querySelector(".shell")?.remove(); }
window.addEventListener("hashchange", render);
theme.apply();
render();
