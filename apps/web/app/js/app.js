import { importData } from "./views_import.js";
/* Shell da aplicação: roteamento por hash, sessão, tema (Claro/Escuro/Sistema) e navegação. */
import { api, DEMO, ANALYTICS_DEMO, HAS_API, session, ApiError, actAs } from "./api.js";
import { esc, icon, errorBox, loading } from "./ui.js";
import * as V from "./views.js";
import { crm } from "./views_crm.js";
import { payments } from "./views_payments.js";
import { trader } from "./views_trader.js";
import { news, notifications } from "./views_hub.js";
import { ops } from "./views_ops.js";

const NAV = [
  ["dashboard", "Visão Geral", "grid"], ["financas", "Finanças", "wallet"], ["patrimonio", "Patrimônio", "wealth"], ["alocacao", "Minha Alocação", "layers"],
  ["tributacao", "Tributação", "receipt"], ["simulador", "Simulador", "sim"], ["alertas", "Radar", "radar"],
  ["noticias", "Notícias", "news"], ["trader", "Trader Intelligence", "candle"], ["assistente", "Inteligência", "ai"], ["documentos", "Documentos", "file"], ["importar", "Importar dados", "upload"], ["conexoes", "Conexões", "link"],
];
const PRIMARY = ["dashboard", "financas", "patrimonio", "tributacao", "simulador", "alertas", "noticias"];
const ADMIN_NAV = [["crm", "CRM · Clientes", "target"], ["pagamentos", "Pagamentos", "finance"], ["operacoes", "Operações", "chart"]];
const ACCOUNT = [["configuracoes", "Configurações", "gear"], ["privacidade", "Privacidade", "shield"], ["planos", "Planos", "plan"]];
const SUBS = {
  financas: "Entradas, saídas, categorias e a origem de cada lançamento.", patrimonio: "Posições consolidadas por classe, instituição e liquidez.",
  alocacao: "Como o seu patrimônio está distribuído e para onde está indo.", tributacao: "Apuração estimada, DARFs, eventos e relatório de apoio ao IRPF.",
  simulador: "Simule decisões antes de tomá-las: venda de ativos, PGBL e mais.", alertas: "Pontos de atenção com evidência, prioridade e próximo passo.",
  noticias: "Fontes oficiais e públicas, com data e link de origem.", trader: "Desempenho, risco, imposto e diário das suas operações — sem execução de ordens.",
  assistente: "Pergunte sobre seus números; a IA explica com fonte e premissas.", documentos: "Notas, informes, DARFs e recibos lidos e conferidos.",
  importar: "Envie extratos e relatórios da B3 para consolidar seus números reais.", conexoes: "Bancos e corretoras conectados via Open Finance.",
  notificacoes: "Avisos do sistema, de segurança e dos seus alertas.", planos: "Escolha o plano que acompanha o seu momento.",
  configuracoes: "Perfil, segurança, preferências e compartilhamento.", privacidade: "Consentimentos, auditoria e controle dos seus dados.",
  crm: "Clientes, funil e relacionamento.", pagamentos: "Cobranças, assinaturas e conciliação.", operacoes: "Saúde da plataforma, SLOs, jobs e eventos.",
};
const TITLES = Object.fromEntries(NAV.map(([k, t]) => [k, t]));
Object.assign(TITLES, { operacoes: "Operações", notificacoes: "Notificações", crm: "CRM · Clientes", pagamentos: "Pagamentos", planos: "Planos", configuracoes: "Configurações", privacidade: "Privacidade e auditoria" });
const PUBLIC = { entrar: V.login, cadastro: V.register, recuperar: V.recoverView, redefinir: V.resetView };
const ROUTES = {
  dashboard: V.dashboard, patrimonio: V.portfolio, financas: V.finance, tributacao: V.tax, simulador: V.simulator,
  alertas: V.alerts, documentos: V.documents, conexoes: V.connections, assistente: V.assistant, planos: V.plans,
  configuracoes: V.settings, privacidade: V.privacy, importar: importData, alocacao: V.allocation, trader, noticias: news, notificacoes: notifications,
};
const ADMIN_ROUTES = { ...ROUTES, crm, pagamentos: payments, operacoes: ops };

/* ------------------------------------------------------------ tema */
const mq = matchMedia("(prefers-color-scheme: light)");
const THEMES = [["light", "sun", "Claro"], ["dark", "moon", "Escuro"], ["system", "auto", "Sistema"]];
export const theme = {
  get pref() { try { return localStorage.getItem("ramon.theme") || "light"; } catch { return "light"; } },
  apply(pref = this.pref) {
    const resolved = pref === "system" ? (mq.matches ? "light" : "dark") : pref;
    document.documentElement.setAttribute("data-theme", resolved);
    document.querySelectorAll("[data-theme-btn]").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.themeBtn === pref)));
    const t = THEMES.find(x => x[0] === pref) || THEMES[0];
    document.querySelectorAll("[data-theme-lbl]").forEach(el => { el.innerHTML = `${icon(t[1])}<span class="tlbl">${t[2]}</span>${icon("chevd")}`; });
  },
  async set(pref) {
    try { localStorage.setItem("ramon.theme", pref); } catch {}
    this.apply(pref);
    if (session.token) api.put("/v1/theme-preference", { theme: pref }).catch(() => {});   // sincroniza com o perfil
  },
};
mq.addEventListener("change", () => theme.pref === "system" && theme.apply());
export const themeSwitch = () => `<div class="theme-switch" role="group" aria-label="Tema da interface">
  ${THEMES.map(([k, ic, l]) => `<button type="button" data-theme-btn="${k}" aria-pressed="${theme.pref === k}" title="Tema ${l}">${icon(ic)}<span class="lbl">${l}</span></button>`).join("")}</div>`;

const closeMenus = (except) => document.querySelectorAll(".dd.open").forEach(d => { if (d !== except) { d.classList.remove("open"); d.querySelector("[aria-expanded]")?.setAttribute("aria-expanded", "false"); } });
document.addEventListener("click", e => {
  const b = e.target.closest("[data-theme-btn]");
  if (b) theme.set(b.dataset.themeBtn);
  const ddb = e.target.closest("[data-dd]");
  if (ddb) { const dd = ddb.closest(".dd"), open = !dd.classList.contains("open"); closeMenus(dd); dd.classList.toggle("open", open); ddb.setAttribute("aria-expanded", String(open)); }
  else if (!e.target.closest(".dd>.menu") || e.target.closest("a,button")) closeMenus();
  if (e.target.closest("[data-burger]")) document.body.classList.toggle("nav-open");
  else if (e.target.closest(".gnav__menu a") || (document.body.classList.contains("nav-open") && !e.target.closest(".gnav__menu"))) document.body.classList.remove("nav-open");
  if (e.target.closest("[data-cmdk]")) { e.preventDefault(); palette.open(); }
  if (e.target.closest("[data-exit-actas]")) { e.preventDefault(); actAs.set(null); location.hash = "#/configuracoes"; location.reload(); }
  if (e.target.closest("[data-logout]")) { actAs.set(null); api.post("/v1/auth/logout").catch(() => {}); session.set(null); me = null; location.hash = "#/entrar"; }
});
document.addEventListener("keydown", e => {
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k" && session.token && !PUBLIC[parse().name]) { e.preventDefault(); palette.toggle(); }
  if (e.key === "Escape") { closeMenus(); document.body.classList.remove("nav-open"); }
});

/* ------------------------------------------------------------ paleta de comandos (⌘K / Ctrl+K) */
const norm = t => String(t || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const palette = {
  el: null, sel: 0, items: [],
  build() {
    const admin = me?.roles?.includes("admin");
    const pages = [...(admin ? ADMIN_NAV : []), ...NAV, ...ACCOUNT, ...(HAS_API && !admin ? [["notificacoes", "Notificações", "bell"]] : [])]
      .map(([k, t, ic]) => ({ grp: "Páginas", label: t, ic, kw: SUBS[k] || "", run: () => { location.hash = "#/" + k; } }));
    const acts = [
      ["Importar extratos e relatórios da B3", "upload", "#/importar"], ["Simular venda de ativos", "sim", "#/simulador"],
      ["Ver apuração mensal e DARFs", "receipt", "#/tributacao"], ["Relatório de apoio ao IRPF", "file", "#/tributacao"],
      ["Ver regras e fontes do cálculo", "bulb", "#/tributacao?tab=regras"], ["Conectar banco (Open Finance)", "link", "#/conexoes"],
      ["Compartilhar com meu contador", "shield", "#/configuracoes"],
    ].map(([label, ic, h]) => ({ grp: "Ações", label, ic, kw: h === "#/tributacao" ? "imposto darf ir" : "", run: () => { location.hash = h; } }));
    const th = THEMES.map(([k, ic, l]) => ({ grp: "Aparência", label: "Tema " + l, ic, run: () => theme.set(k) }));
    return [...pages, ...(admin ? [] : acts), ...th, { grp: "Conta", label: "Sair", ic: "logout", run: () => document.querySelector("[data-logout]")?.click() }];
  },
  ensure() {
    if (this.el) return;
    this.el = document.createElement("div");
    this.el.className = "cmdk"; this.el.setAttribute("role", "dialog"); this.el.setAttribute("aria-modal", "true"); this.el.setAttribute("aria-label", "Buscar e executar comandos");
    this.el.innerHTML = `<div class="cmdk__box"><label class="cmdk__in">${icon("search")}<input type="text" placeholder="Buscar páginas, ações ou perguntar ao assistente…" aria-label="Buscar" autocomplete="off"><span class="kbd">Esc</span></label>
      <div class="cmdk__list" role="listbox"></div><div class="cmdk__foot"><span>↑↓ navegar</span><span>↵ abrir</span><span>Esc fechar</span></div></div>`;
    document.body.appendChild(this.el);
    const inp = this.el.querySelector("input");
    inp.addEventListener("input", () => { this.sel = 0; this.draw(inp.value); });
    inp.addEventListener("keydown", e => {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); this.sel = (this.sel + (e.key === "ArrowDown" ? 1 : -1) + this.items.length) % (this.items.length || 1); this.mark(); }
      if (e.key === "Enter") { e.preventDefault(); this.items[this.sel]?.run(); this.close(); }
      if (e.key === "Escape") this.close();
    });
    this.el.addEventListener("click", e => {
      if (e.target === this.el) return this.close();
      const it = e.target.closest("[data-i]"); if (it) { this.items[+it.dataset.i]?.run(); this.close(); }
    });
  },
  draw(q) {
    const all = this.build(), nq = norm(q).trim();
    this.items = nq ? all.filter(x => nq.split(/\s+/).every(w => norm(x.label + " " + x.grp + " " + (x.kw || "")).includes(w))) : all;
    const admin = me?.roles?.includes("admin");
    if (nq && !admin) this.items.push({ grp: "Assistente", label: `Perguntar ao assistente: “${q.trim()}”`, ic: "ai", run: () => { location.hash = "#/assistente?q=" + encodeURIComponent(q.trim()); } });
    let g = "";
    this.el.querySelector(".cmdk__list").innerHTML = this.items.length ? this.items.map((x, i) => `${x.grp !== g ? `<div class="cmdk__grp">${esc(g = x.grp)}</div>` : ""}<button type="button" class="cmdk__it" role="option" data-i="${i}" aria-selected="${i === this.sel}">${icon(x.ic)}<span>${esc(x.label)}</span></button>`).join("")
      : `<p class="muted small" style="padding:14px">Nada encontrado.</p>`;
  },
  mark() { this.el.querySelectorAll("[data-i]").forEach(b => b.setAttribute("aria-selected", String(+b.dataset.i === this.sel))); this.el.querySelector(`[data-i="${this.sel}"]`)?.scrollIntoView({ block: "nearest" }); },
  open(q = "") { this.ensure(); this.sel = 0; const inp = this.el.querySelector("input"); inp.value = q; this.draw(q); this.el.classList.add("open"); inp.focus(); },
  close() { this.el?.classList.remove("open"); },
  toggle() { this.el?.classList.contains("open") ? this.close() : this.open(); },
};
export const searchPill = (ph = "Buscar ativos, relatórios ou simulações…") => `<button type="button" class="search-pill" data-cmdk aria-label="Abrir busca (Ctrl+K)">${icon("search")}<span>${esc(ph)}</span><kbd>${/Mac|iPhone|iPad/.test(navigator.platform) ? "⌘K" : "Ctrl K"}</kbd></button>`;

/* ícone nos títulos dos cartões (decoração, sem alterar conteúdo) */
const TITLE_ICONS = [[/imposto|tribut|darf|irrf|irpf|apura|isent|prejuí/i, "receipt"], [/alerta|radar|aten|risco/i, "radar"], [/patrim|posi|consolid|custód|concentra/i, "wealth"],
  [/aloca|composi|classe/i, "layers"], [/liquidez|caixa|reserva/i, "drop"], [/regra|calcul|premissa|limita|fonte|como /i, "bulb"], [/ação|ações|próxim|tarefa/i, "target"],
  [/mudou|variaç|evolu|desempenho|resultado|perform|mercado|cota/i, "trend"], [/despes|gasto|categor|transa|lançament|extrato|receita|entrada|saída/i, "wallet"],
  [/document|nota|informe|arquivo|import/i, "file"], [/notícia|divulga|evento/i, "news"], [/conex|banco|instituiç|open finance/i, "link"], [/segur|privac|sess|audit|consent/i, "shield"],
  [/simula|cenário|backtest|estratég/i, "sim"], [/plano|assinatura|pagamento|cobran/i, "plan"], [/assistente|ia\b|intelig|pergunt/i, "ai"], [/cliente|crm|funil/i, "target"], [/notifica|e-mail|aviso/i, "bell"]];
function decorate(root) {
  root.querySelectorAll(".card > h3, .card > .row > h3, section.card > h3").forEach(h => {
    if (h.querySelector(".ttl-ico") || h.closest(".card-h")) return;
    const first = h.firstElementChild;
    if (first && first.tagName.toLowerCase() === "svg" && h.firstChild === first) { const t = document.createElement("span"); t.className = "ttl-ico"; h.insertBefore(t, first); t.appendChild(first); return; }
    const txt = h.textContent || "", m = TITLE_ICONS.find(([re]) => re.test(txt));
    h.insertAdjacentHTML("afterbegin", `<span class="ttl-ico" aria-hidden="true">${icon(m ? m[1] : "chart")}</span>`);
  });
}

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
  if (PUBLIC[r.name]) { root.innerHTML = ""; await PUBLIC[r.name](root, r); document.title = `Aurion — ${({ entrar: "Entrar", cadastro: "Cadastro", recuperar: "Recuperar acesso", redefinir: "Nova senha" })[r.name]}`; return; }
  if (!session.token) { location.hash = `#/entrar?next=${encodeURIComponent(r.name)}`; return; }
  try {
    if (!me) me = await api.get("/v1/me");
    const admin = me.roles?.includes("admin");
    if (admin && !ADMIN_ROUTES[r.name]) { location.hash = "#/crm"; return; }
    if (!admin && (r.name === "crm" || r.name === "pagamentos" || r.name === "operacoes")) { location.hash = "#/dashboard"; return; }
    const view = admin ? ADMIN_ROUTES[r.name] : (ROUTES[r.name] || ROUTES.dashboard);
    const sh = document.querySelector(".shell");
    if (!sh || sh.dataset.role !== (admin ? "admin" : "client")) root.innerHTML = shell(admin);
    alertsOpen = HAS_API && !admin ? (await api.get("/v1/notifications").catch(() => ({ unread: 0 }))).unread
      : (await api.get("/v1/alerts").catch(() => ({ items: [] }))).items.filter(a => a.status === "novo").length;
    updateShell(r.name);
    const main = document.getElementById("view");
    main.innerHTML = loading();
    document.title = `AURION — ${TITLES[r.name] || "Início"}`;
    await view(main, r, { me, refresh: () => render() });
    decorate(main);
    if (!main._deco) { let pend = 0; main._deco = new MutationObserver(() => { if (!pend) pend = requestAnimationFrame(() => { pend = 0; decorate(main); }); }); main._deco.observe(main, { childList: true, subtree: true }); }
    main.focus({ preventScroll: true });
  } catch (e) {
    if (e instanceof ApiError && e.status === 401) { session.set(null); me = null; location.hash = "#/entrar"; return; }
    const main = document.getElementById("view") || root;
    main.innerHTML = errorBox(e);
    console.error(e);
  }
}

const LOGO = `<svg viewBox="0 0 32 32" aria-hidden="true"><defs><linearGradient id="lg-a" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#6aa8ff"/><stop offset="1" stop-color="#1f5fe0"/></linearGradient><linearGradient id="lg-b" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#b9a2ff"/><stop offset="1" stop-color="#6a4cf0"/></linearGradient></defs>
  <path d="M16 3 L29 27 H3 Z" fill="url(#lg-a)"/><path d="M16 3 L29 27 H16 Z" fill="url(#lg-b)" opacity=".85"/><path d="M16 12 L22 23 H10 Z" fill="#fff" opacity=".9"/></svg>`;
const navLink = ([k, t, ic], cls = "") => `<a class="navi ${cls}" href="#/${k}" data-nav="${k}">${icon(ic)}<span>${t}</span>${k === "alertas" ? '<span class="count" data-alert-count hidden></span>' : ""}</a>`;
const refMonth = () => DEMO ? "Set 2026" : (() => { const s = new Date(Date.now() - 3 * 3600e3).toLocaleDateString("pt-BR", { month: "short", year: "numeric", timeZone: "UTC" }).replace(".", "").replace(" de ", " "); return s.charAt(0).toUpperCase() + s.slice(1); })();

function shell(admin = false) {
  const byKey = Object.fromEntries(NAV.map(n => [n[0], n]));
  const primary = admin ? ADMIN_NAV : PRIMARY.map(k => byKey[k]);
  const more = admin ? NAV : NAV.filter(n => !PRIMARY.includes(n[0]));
  const nav = `${primary.map(n => navLink(n, n[0] === "noticias" || n[0] === "simulador" ? "p-opt" : "")).join("")}
    <div class="dd dd--left more"><button type="button" class="navi more-btn" data-dd aria-expanded="false" aria-haspopup="true">${icon("dots")}<span>Mais</span>${icon("chevd", "chevd")}</button>
      <div class="menu" role="menu">${admin ? `<p class="lbl-sec">Plataforma</p>` : ""}${more.map(([k, t, ic]) => `<a href="#/${k}" data-nav="${k}" role="menuitem">${icon(ic)}<span>${t}</span></a>`).join("")}</div></div>`;
  return `<div class="shell" data-role="${admin ? "admin" : "client"}">
    <div class="main">
      <div class="gtop">
        <header class="gnav">
          <button class="icon-btn burger" data-burger aria-label="Abrir menu">${icon("menu")}</button>
          <a class="gnav__logo" href="../index.html" title="Página inicial">${LOGO}<span>AURION</span></a>
          <nav class="gnav__menu" aria-label="Navegação principal">${nav}</nav>
          <div class="gnav__right">
            <span class="chip hide-m" title="Data de referência dos cálculos">${refMonth()}</span>
            <div class="dd theme-dd"><button type="button" class="chip" data-dd data-theme-lbl aria-haspopup="true" aria-expanded="false" aria-label="Tema da interface"></button>
              <div class="menu" role="menu"><p class="lbl-sec">Tema</p>${THEMES.map(([k, ic, l]) => `<button type="button" role="menuitemradio" data-theme-btn="${k}" aria-pressed="${theme.pref === k}">${icon(ic)}<span>${l}</span></button>`).join("")}</div></div>
            <a class="icon-btn" href="${HAS_API && !admin ? "#/notificacoes" : "#/alertas"}" aria-label="Notificações">${icon("bell")}<span class="dot" data-dot hidden></span></a>
            <div class="dd"><button type="button" class="avatar-btn" data-dd aria-haspopup="true" aria-expanded="false" aria-label="Conta de ${esc(me?.name || "usuário")}"><span class="avatar">${esc((me?.name || "?")[0].toUpperCase())}</span>${icon("chevd")}</button>
              <div class="menu" role="menu"><p class="lbl-sec">${esc(me?.name || "Minha conta")}</p>${ACCOUNT.map(([k, t, ic]) => `<a href="#/${k}" data-nav="${k}" role="menuitem">${icon(ic)}<span>${t}</span></a>`).join("")}
                <div class="sep"></div><button type="button" data-logout role="menuitem">${icon("logout")}<span>Sair</span></button></div></div>
          </div>
        </header>
        ${DEMO ? `<div class="demo-bar" role="note"><b>Modo demonstração</b> — dados fictícios calculados pelos motores do backend (snapshot de 27/09/2026). Nenhum dado real é coletado.</div>` : ANALYTICS_DEMO && !admin ? `<div class="demo-bar" role="note"><b>Seus dados:</b> os painéis mostram os seus números quando você envia arquivos em <a href="#/importar">Importar dados</a> ou conecta seu banco em <a href="#/conexoes">Conexões</a>; até lá, exibem um exemplo.</div>` : ""}
        ${actAs.id ? `<div class="demo-bar" role="note"><b>Somente leitura:</b> você está vendo os dados de ${esc(actAs.name || "um cliente")}, que concedeu acesso. Cada consulta fica registrada na auditoria do cliente. <a href="#" data-exit-actas>Voltar à minha conta</a></div>` : ""}
      </div>
      <div class="content">
        <div class="pagehead" data-pagehead hidden><div><h1 data-title>Início</h1><p data-sub></p></div>${searchPill()}</div>
        <main id="view" tabindex="-1"></main>
      </div>
    </div></div>`;
}

function updateShell(name) {
  document.querySelectorAll("[data-nav]").forEach(a => a.dataset.nav === name ? a.setAttribute("aria-current", "page") : a.removeAttribute("aria-current"));
  const moreBtn = document.querySelector(".more-btn");
  if (moreBtn) document.querySelector(`.more .menu [data-nav="${name}"]`) ? moreBtn.setAttribute("aria-current", "page") : moreBtn.removeAttribute("aria-current");
  const t = document.querySelector("[data-title]"); if (t) t.textContent = TITLES[name] || "Início";
  const sub = document.querySelector("[data-sub]"); if (sub) sub.textContent = SUBS[name] || "";
  const ph = document.querySelector("[data-pagehead]"); if (ph) ph.hidden = name === "dashboard";
  const c = document.querySelector("[data-alert-count]"); if (c) { c.textContent = alertsOpen; c.hidden = !alertsOpen; }
  const d = document.querySelector("[data-dot]"); if (d) d.hidden = !alertsOpen;
  theme.apply();
}

export function onLogin(token, user) { session.set(token); me = user; document.querySelector(".shell")?.remove(); }
window.addEventListener("hashchange", render);
theme.apply();
render();
