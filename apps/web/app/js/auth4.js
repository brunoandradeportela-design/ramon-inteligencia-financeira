/* AURION Financial Experience 4.0 — ambiente imersivo do login/cadastro (homologação: /app/?ui=4#/cadastro).
 * Esquerda: logotipo, painéis de cotações reais (atrasadas/fechamento, com fonte e horário), candles holográficos
 * do Ibovespa, touro low-poly, globo com B3/NYSE/Nasdaq clicáveis e o notebook com o dashboard de demonstração.
 * Direita: painel de vidro com o formulário. Tudo sincronizado pelo market_store (mesmos números em todos os lugares).
 * Sem WebGL: canvas 2D, SVG e transformações CSS. Com redução de movimento, tudo fica estático. */
import { api, ApiError, DEMO, HAS_API } from "./api.js";
import { onLogin } from "./app.js";
import { validateSignup, maskPhone, docValid, PRICE, PLAN_NAME, LEGAL_VERSION } from "./crm_rules.js";
import { market, subscribe, item, select, startMarket, history } from "./market_store.js";
import { INSTRUMENTS } from "./market_public.js";
import { createDash4 } from "./dash4.js";
import { toast } from "./ui.js";

const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const num = (v, d = 2) => (+v).toLocaleString("pt-BR", { minimumFractionDigits: d, maximumFractionDigits: d });
const pct = v => v == null || !isFinite(v) ? "—" : (v >= 0 ? "+" : "−") + Math.abs(v * 100).toFixed(2).replace(".", ",") + "%";
const hm = iso => iso ? new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "—";
const fmtQ = i => i?.ultimo == null ? "—" : i.tipo === "indice" ? num(i.ultimo, i.ultimo > 1e4 ? 0 : 2) : num(i.ultimo, i.tipo === "cambio" ? 4 : 2);
const cls = v => v == null ? "" : v >= 0 ? "up" : "down";
const RM = () => matchMedia("(prefers-reduced-motion: reduce)").matches || document.documentElement.classList.contains("a4-calm");
const LABEL = { IBOV: "IBOV", SPX: "S&P 500", NASDAQ: "NASDAQ", DJI: "DOW JONES", USDBRL: "USD/BRL", EURBRL: "EUR/BRL" };
const lbl = id => LABEL[id] || id;
const badge = i => !i ? "" : i.indisponivel ? `<em class="a4-b na">indisponível</em>` : i.desatualizado ? `<em class="a4-b na">desatualizado</em>`
  : `<em class="a4-b ${i.dado === "fechamento" ? "fe" : "at"}">${i.dado === "fechamento" ? "fechamento" : "atrasado"}</em>`;
const EXCH = [
  { id: "B3", lat: -23.546, lon: -46.634, nome: "B3 — Brasil, Bolsa, Balcão", cidade: "São Paulo", idx: "IBOV", dy: 0 },
  { id: "NYSE", lat: 40.707, lon: -74.011, nome: "New York Stock Exchange", cidade: "Nova York", idx: "SPX", dy: -14 },
  { id: "Nasdaq", lat: 40.757, lon: -73.986, nome: "Nasdaq Stock Market", cidade: "Nova York", idx: "NASDAQ", dy: 12 },
];

let shell = null;
export const shellMounted = () => !!shell;

/** monta (uma vez) o ambiente persistente e devolve o contêiner do formulário */
export function mountShell(root) {
  if (shell && root.contains(shell.el)) return shell.form;
  root.innerHTML = `<div class="a4" id="a4">
    <div class="a4-sky" aria-hidden="true"><i class="a4-grid"></i><i class="a4-glow1"></i><i class="a4-glow2"></i></div>
    <section class="a4-world" aria-label="Ambiente financeiro de demonstração">
      <header class="a4-brand"><a href="../index.html" class="a4-logo" data-text="AURION" aria-label="AURION — voltar ao site"><span>AURION</span></a>
        <p>INTELIGÊNCIA FINANCEIRA PARA O SEU PRÓXIMO NÍVEL</p></header>
      <div class="a4-tickwrap"><div class="a4-tick" role="list" aria-label="Cotações (dados atrasados ou de fechamento)"></div>
        <p class="a4-tsrc" aria-live="polite"></p></div>
      <div class="a4-stage">
        <figure class="a4-holo a4-candles"><figcaption><b>IBOVESPA</b> <span data-cap>histórico de 1 mês</span></figcaption><canvas aria-label="Candles do Ibovespa no último mês" role="img"></canvas></figure>
        <img class="a4-bull" src="img/bull.svg" alt="" width="290" height="210" decoding="async">
        <figure class="a4-holo a4-globe"><canvas aria-label="Globo com as bolsas B3, NYSE e Nasdaq" role="img"></canvas>
          <div class="a4-exch" role="group" aria-label="Bolsas">${EXCH.map(x => `<button type="button" data-exch="${x.id}">${x.id}</button>`).join("")}</div>
          <div class="a4-ginfo" hidden role="dialog" aria-label="Detalhes da bolsa"></div></figure>
        <div class="a4-laptop"><div class="a4-lid"><div class="a4-screen"><div class="d4" id="d4"></div></div></div><div class="a4-base" aria-hidden="true"></div></div>
      </div>
      <p class="a4-msg"><b>SEU DINHEIRO GERA DADOS.</b> <span>Nossa inteligência mostra o que eles significam.</span></p>
    </section>
    <aside class="a4-side"><button type="button" class="a4-demo-t" aria-expanded="false" aria-controls="a4">Ver demonstração financeira</button><div id="a4-form"></div></aside>
  </div>`;
  const el = root.querySelector("#a4"), off = [];
  document.documentElement.classList.add("a4-on");
  startMarket();

  /* logotipo: reflexo segue o ponteiro */
  const logo = el.querySelector(".a4-logo");
  logo.addEventListener("pointermove", e => { const r = logo.getBoundingClientRect(); logo.style.setProperty("--mx", ((e.clientX - r.left) / r.width * 100).toFixed(1) + "%"); });

  /* faixa de cotações */
  const tick = el.querySelector(".a4-tick"), tsrc = el.querySelector(".a4-tsrc");
  const drawTick = () => {
    tick.innerHTML = INSTRUMENTS.map(x => { const i = item(x.id);
      return `<button type="button" role="listitem" class="a4-tc ${cls(i?.variacao_pct)}" data-tick="${x.id}" aria-pressed="${market.selected === x.id}"
        aria-label="${esc(x.nome)}: ${i?.ultimo != null ? fmtQ(i) : "indisponível"} ${i?.variacao_pct != null ? pct(i.variacao_pct) : ""}. Abrir em Mercados">
        <span class="s">${esc(lbl(x.id))}</span><b>${i ? fmtQ(i) : "…"}</b><span class="v">${i?.indisponivel ? "—" : pct(i?.variacao_pct)}</span>${badge(i)}<small>${i?.horario ? hm(i.horario) : ""}</small></button>`; }).join("");
    tsrc.textContent = market.status === "sem_api" ? "Cotações disponíveis no site oficial (API de mercado não configurada neste ambiente)."
      : market.status === "erro" ? "Cotações indisponíveis no momento — tentando reconectar."
      : market.snap ? `Fonte: ${market.snap.fonte}. Não é tempo real. Consulta: ${hm(market.snap.at)}${market.status === "reconectando" ? " · reconectando…" : ""}.` : "Carregando cotações…";
  };
  tick.addEventListener("click", e => { const b = e.target.closest("[data-tick]"); if (!b) return; select(b.dataset.tick); el.querySelector(".a4-laptop").scrollIntoView({ block: "nearest", behavior: RM() ? "auto" : "smooth" }); });
  let tickRaf = 0, paused = false, tlast = 0;
  const auto = t => { if (!paused && !RM() && tick.scrollWidth > tick.clientWidth + 4) { tick.scrollLeft += Math.min((t - tlast) / 1000, .05) * 18; if (tick.scrollLeft + tick.clientWidth >= tick.scrollWidth - 1) tick.scrollLeft = 0; } tlast = t; tickRaf = requestAnimationFrame(auto); };
  ["pointerenter", "focusin", "touchstart"].forEach(ev => tick.addEventListener(ev, () => paused = true, { passive: true }));
  ["pointerleave", "focusout"].forEach(ev => tick.addEventListener(ev, () => paused = false));
  tickRaf = requestAnimationFrame(t => { tlast = t; auto(t); });

  /* candles holográficos com o histórico real do Ibovespa */
  const cv = el.querySelector(".a4-candles canvas"); let pts = null;
  const drawCandles = () => {
    const d = Math.min(devicePixelRatio || 1, 2), w = cv.clientWidth, h = cv.clientHeight; if (!w || !h) return;
    cv.width = w * d; cv.height = h * d; const c = cv.getContext("2d"); c.scale(d, d); c.clearRect(0, 0, w, h);
    c.strokeStyle = "rgba(32,217,255,.12)"; c.lineWidth = 1;
    for (let k = 1; k < 4; k++) { c.beginPath(); c.moveTo(0, h * k / 4); c.lineTo(w, h * k / 4); c.stroke(); }
    if (!pts?.length) { c.fillStyle = "rgba(218,232,245,.6)"; c.font = "12px Figtree, system-ui"; c.fillText(market.status === "sem_api" ? "histórico disponível no site oficial" : "histórico indisponível", 10, h / 2); return; }
    const lo = Math.min(...pts.map(p => p.l)), hi = Math.max(...pts.map(p => p.h)), r = hi - lo || 1, bw = w / pts.length, Y = v => 6 + (1 - (v - lo) / r) * (h - 12);
    pts.forEach((p, i) => { const x = i * bw + bw / 2, up = p.c >= p.o, col = up ? "#20D58A" : "#ff5470";
      c.strokeStyle = col; c.fillStyle = col; c.shadowColor = col; c.shadowBlur = 8; c.globalAlpha = .95;
      c.beginPath(); c.moveTo(x, Y(p.h)); c.lineTo(x, Y(p.l)); c.stroke();
      c.fillRect(x - bw * .3, Math.min(Y(p.o), Y(p.c)), bw * .6, Math.max(1.5, Math.abs(Y(p.o) - Y(p.c)))); });
    c.shadowBlur = 0; c.globalAlpha = 1;
  };
  const loadCandles = () => history("IBOV", "1M").then(h => { pts = h.pontos; el.querySelector("[data-cap]").textContent = `1 mês · diário · ${h.desatualizado ? "desatualizado" : "fechamentos"}`; drawCandles(); })
    .catch(() => { pts = null; drawCandles(); });
  const ro = new ResizeObserver(() => drawCandles()); ro.observe(cv);

  /* globo com as bolsas */
  let globe = null; const ginfo = el.querySelector(".a4-ginfo");
  const showExch = id => {
    const x = EXCH.find(e => e.id === id); if (!x) return;
    const its = INSTRUMENTS.filter(i => i.bolsa === x.id || (x.id === "NYSE" && i.id === "DJI")).map(i => item(i.id)).filter(Boolean), ix = item(x.idx);
    ginfo.innerHTML = `<button type="button" class="a4-x" data-gclose aria-label="Fechar">×</button><h4>${esc(x.nome)}</h4><p>${esc(x.cidade)} · ${esc(ix?.situacao || "situação indisponível")}</p>
      <ul>${its.map(i => `<li><b>${esc(lbl(i.id))}</b><span>${fmtQ(i)}</span><span class="${cls(i.variacao_pct)}">${pct(i.variacao_pct)}</span></li>`).join("") || "<li>Cotações indisponíveis.</li>"}</ul>
      <button type="button" class="a4-btn2" data-gopen="${x.idx}">Ver ${esc(lbl(x.idx))} no painel</button>`;
    ginfo.hidden = false; ginfo.querySelector("[data-gopen]").focus();
    el.querySelectorAll("[data-exch]").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.exch === id)));
    EXCH.forEach(e => e.selected = e.id === id); globe?.redraw();
  };
  const closeExch = () => { ginfo.hidden = true; EXCH.forEach(e => e.selected = false); el.querySelectorAll("[data-exch]").forEach(b => b.setAttribute("aria-pressed", "false")); globe?.redraw(); };
  el.querySelector(".a4-globe").addEventListener("click", e => {
    const b = e.target.closest("[data-exch],[data-gclose],[data-gopen]"); if (!b) return;
    if (b.dataset.exch) showExch(b.dataset.exch); else if (b.dataset.gopen) { select(b.dataset.gopen); closeExch(); el.querySelector(".a4-laptop").scrollIntoView({ block: "nearest" }); } else closeExch();
  });
  ginfo.addEventListener("keydown", e => { if (e.key === "Escape") { const id = EXCH.find(x => x.selected)?.id; closeExch(); el.querySelector(`[data-exch="${id}"]`)?.focus(); } });
  import("../../js/globe.js").then(({ makeGlobe }) => {
    if (!shell) return;
    let fps = 60, fr = 0, t0 = performance.now();
    globe = makeGlobe(el.querySelector(".a4-globe canvas"), { speed: 0, tilt: -0.2, lon0: -1.05, landUrl: "../assets/data/land-mask.json", orbit: true,
      cities: [[-23.55, -46.63], [40.71, -74.0], [51.5, -0.12], [35.68, 139.69]],
      markers: EXCH.map(x => ({ ...x, get selected() { return x.selected; }, label: () => { const i = item(x.idx); return i?.ultimo != null ? `${x.id} ${pct(i.variacao_pct)}` : x.id; } })),
      onSelect: mk => showExch(mk.id),
      lite: () => { fr++; const n = performance.now(); if (n - t0 > 2000) { fps = fr * 1000 / (n - t0); fr = 0; t0 = n; el.classList.toggle("a4-lite", fps < 40); } return fps < 40; } });
  }).catch(() => {});

  /* notebook */
  const dash = createDash4(el.querySelector("#d4"), { onAccount: () => el.querySelector("#a4-form input")?.focus() });

  /* celular: formulário primeiro; a demonstração abre sob demanda */
  const demoT = el.querySelector(".a4-demo-t");
  demoT.addEventListener("click", () => { const on = el.classList.toggle("a4-show-demo"); demoT.setAttribute("aria-expanded", String(on)); demoT.textContent = on ? "Ocultar demonstração" : "Ver demonstração financeira"; if (on) el.querySelector(".a4-world").scrollIntoView({ behavior: RM() ? "auto" : "smooth" }); });

  let candlesLoaded = false;
  off.push(subscribe(() => { drawTick(); if (market.snap && !candlesLoaded) { candlesLoaded = true; loadCandles(); } else if (!market.snap && market.status !== "carregando") drawCandles(); globe?.redraw(); }));
  shell = { el, form: el.querySelector("#a4-form"), destroy: () => { off.forEach(f => f()); cancelAnimationFrame(tickRaf); ro.disconnect(); globe?.destroy(); dash.destroy(); } };
  return shell.form;
}

export function unmount() {
  if (!shell) return;
  shell.destroy(); shell = null;
  document.documentElement.classList.remove("a4-on");
}

/* ================================================================ cadastro 4.0 */
const SVG = {
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 4-6 8-6s8 2 8 6"/>', mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/>',
  work: '<rect x="3" y="7" width="18" height="13" rx="2"/><path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>', phone: '<path d="M5 3h4l2 5-3 2a12 12 0 0 0 6 6l2-3 5 2v4a2 2 0 0 1-2 2A18 18 0 0 1 3 5a2 2 0 0 1 2-2z"/>',
  id: '<rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="9" cy="12" r="2.5"/><path d="M14 10h4M14 14h3"/>', lock: '<rect x="4" y="10" width="16" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>',
  eye: '<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>', eyeoff: '<path d="M3 3l18 18M10.6 6.1A10 10 0 0 1 12 6c6 0 10 6 10 6a17 17 0 0 1-3.2 3.8M6.6 6.6C3.8 8.4 2 12 2 12s4 7 10 7a9.6 9.6 0 0 0 4.4-1"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/>',
};
const ic = k => `<svg viewBox="0 0 24 24" aria-hidden="true">${SVG[k]}</svg>`;
const maskCpf = v => { const d = String(v).replace(/\D/g, "").slice(0, 11); return d.replace(/(\d{3})(\d)/, "$1.$2").replace(/(\d{3})(\d)/, "$1.$2").replace(/(\d{3})(\d{1,2})$/, "$1-$2"); };
const problemMsg = e => e instanceof ApiError ? (e.problem.detail || e.problem.title) : String(e.message || e);
const PLANS = [
  { id: "free", d: "Organização financeira, importação de extratos e diagnóstico inicial." },
  { id: "pro", d: "Apuração de IR em renda variável, guias DARF, alertas e simulador completo." },
  { id: "premium", d: "Tudo do Pro, mais acesso para o seu contador e Trader Intelligence." },
];
const field = (id, label, icon, input, hint = "") => `<div class="a4-f" data-f="${id}"><label for="${id}">${label}</label>
  <div class="a4-in">${ic(icon)}${input}</div>${hint}<p class="a4-err" id="e-${id}" role="alert"></p></div>`;

export async function register4(root, r) {
  const plan0 = ["free", "pro", "premium"].includes(r.params.get("plano")) ? r.params.get("plano") : "free";
  const d = { plan: plan0, marketing_opt_in: false }, st = { step: 1, busy: false, emailOk: null, emailChecked: "" };
  const draw = () => {
    root.innerHTML = `<div class="a4-panel">
      <a href="../index.html" class="a4-back">← Voltar ao site</a>
      <div class="a4-steps" aria-label="Etapa ${st.step} de 2"><i class="on"></i><i class="${st.step > 1 ? "on" : ""}"></i><span>Etapa ${st.step} de 2</span></div>
      <h1>${st.step === 1 ? "Crie sua conta" : "Escolha seu plano"}</h1>
      <p class="a4-sub">${st.step === 1 ? "Comece a transformar dados em decisões inteligentes." : "Você pode mudar de plano quando quiser."}</p>
      <form id="f4" novalidate>${st.step === 1 ? step1() : step2()}</form>
      <p class="a4-alt">Já tem conta? <a href="#/entrar">Entrar</a></p></div>`;
    wire();
  };
  const step1 = () => `
    ${field("name", "Nome completo *", "user", `<input id="name" autocomplete="name" required maxlength="120" value="${esc(d.name || "")}" placeholder="Nome e sobrenome" aria-describedby="e-name">`)}
    ${field("email", "E-mail *", "mail", `<input id="email" type="email" autocomplete="email" required maxlength="160" value="${esc(d.email || "")}" placeholder="voce@email.com" aria-describedby="e-email">`, `<p class="a4-ok" id="ok-email" aria-live="polite"></p>`)}
    ${field("profession", "Profissão *", "work", `<input id="profession" list="profs4" required maxlength="80" value="${esc(d.profession || "")}" placeholder="Ex.: Médico, Advogada" aria-describedby="e-profession">
      <datalist id="profs4">${["Médico(a)", "Dentista", "Advogado(a)", "Engenheiro(a)", "Empresário(a)", "Arquiteto(a)", "Contador(a)", "Servidor(a) público(a)", "Psicólogo(a)", "Produtor(a) rural", "Analista de sistemas"].map(p => `<option value="${p}">`).join("")}</datalist>`)}
    ${field("phone", "Telefone (WhatsApp) *", "phone", `<input id="phone" type="tel" inputmode="numeric" autocomplete="tel-national" required value="${esc(d.phone || "")}" placeholder="(69) 99999-9999" aria-describedby="e-phone">`)}
    ${field("cpf", "CPF (opcional)", "id", `<input id="cpf" inputmode="numeric" autocomplete="off" value="${esc(d.cpf || "")}" placeholder="000.000.000-00" aria-describedby="e-cpf h-cpf">`, `<p class="a4-hint" id="h-cpf">Permite entrar também pelo CPF. Guardamos apenas uma impressão protegida, nunca o número em texto puro.</p>`)}
    ${field("pw", "Senha *", "lock", `<input id="pw" type="password" autocomplete="new-password" required minlength="10" aria-describedby="e-pw pwrules">
      <button type="button" class="a4-eye" data-eye aria-label="Mostrar senha" aria-pressed="false">${ic("eye")}</button>`,
      `<ul class="a4-rules" id="pwrules"><li data-r="len">10 ou mais caracteres</li><li data-r="let">letras</li><li data-r="dig">números</li></ul>`)}
    <label class="a4-ck" data-f="terms"><input type="checkbox" id="terms" ${d.accept_terms ? "checked" : ""} aria-describedby="e-terms"> <span>Li e aceito os <a href="../termos.html" target="_blank" rel="noopener">Termos de Uso</a> e a <a href="../privacidade.html" target="_blank" rel="noopener">Política de Privacidade</a> (LGPD) — versão ${LEGAL_VERSION}. *</span></label>
    <p class="a4-err" id="e-terms" role="alert"></p>
    <label class="a4-ck a4-ck--opt"><input type="checkbox" id="mkt" ${d.marketing_opt_in ? "checked" : ""}> <span>Opcional: quero receber conteúdos e novidades do AURION por e-mail ou WhatsApp. Posso cancelar quando quiser.</span></label>
    <p class="a4-err a4-err--g" id="err" role="alert"></p>
    <button class="a4-cta" type="submit">Continuar <span aria-hidden="true">→</span></button>
    <p class="a4-lock">${ic("lock")} Conexão segura. Nunca pedimos senha de banco.</p>`;
  const step2 = () => `<fieldset class="a4-plans"><legend class="sr">Plano</legend>${PLANS.map(p => `<label class="a4-plan ${d.plan === p.id ? "on" : ""}">
      <input type="radio" name="plan" value="${p.id}" ${d.plan === p.id ? "checked" : ""}><b>${PLAN_NAME[p.id]}</b><span class="pr">${p.id === "free" ? "Grátis" : "R$ " + PRICE[p.id].replace(".", ",") + "/mês"}</span><small>${p.d}</small></label>`).join("")}</fieldset>
    <p class="a4-hint">${d.plan === "free" ? "Sem cobrança. Você pode assinar um plano pago depois, em Planos." : "A assinatura fica aguardando pagamento; você conclui o pagamento com segurança na área de Planos, dentro da sua conta."}</p>
    <p class="a4-err a4-err--g" id="err" role="alert"></p>
    <div class="a4-row"><button type="button" class="a4-btn2" data-back>← Voltar</button><button class="a4-cta" type="submit">Criar minha conta</button></div>`;

  const setErr = (id, msg) => { const e = root.querySelector("#e-" + id), inp = root.querySelector("#" + id); if (e) e.textContent = msg || ""; inp?.setAttribute("aria-invalid", msg ? "true" : "false"); root.querySelector(`[data-f="${id}"]`)?.classList.toggle("bad", !!msg); };
  const read = () => Object.assign(d, { name: root.querySelector("#name").value.trim(), email: root.querySelector("#email").value.trim().toLowerCase(),
    profession: root.querySelector("#profession").value.trim(), phone: root.querySelector("#phone").value, password: root.querySelector("#pw").value,
    accept_terms: root.querySelector("#terms").checked, marketing_opt_in: root.querySelector("#mkt").checked, cpf: root.querySelector("#cpf").value.trim() });
  const errorsOf = () => { const errs = validateSignup(d), cd = (d.cpf || "").replace(/\D/g, "");
    if (d.cpf && (cd.length !== 11 || !docValid(cd))) errs.push({ field: "cpf", msg: "CPF inválido: confira os dígitos" });
    if (st.emailOk === false && st.emailChecked === d.email) errs.push({ field: "email", msg: "Este e-mail já tem conta. Entre ou recupere o acesso." });
    return errs.map(x => ({ ...x, field: { password: "pw", accept_terms: "terms" }[x.field] || x.field })); };
  async function checkEmail() {
    const v = root.querySelector("#email")?.value.trim().toLowerCase(), ok = root.querySelector("#ok-email");
    if (!v || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v) || !HAS_API || v === st.emailChecked) return;
    try {
      const r = await fetch((window.RAMON_API_BASE || "").replace(/\/$/, "") + "/v1/auth/email-available?email=" + encodeURIComponent(v));
      if (!r.ok) return;
      const j = await r.json(); st.emailChecked = v; st.emailOk = !!j.available;
      if (!root.querySelector("#email")) return;
      if (j.available) { setErr("email", ""); ok.textContent = "E-mail disponível"; }
      else { ok.textContent = ""; setErr("email", "Este e-mail já tem conta."); root.querySelector("#e-email").innerHTML = `Este e-mail já tem conta. <a href="#/entrar">Entrar</a> ou <a href="#/recuperar">recuperar o acesso</a>.`; }
    } catch { /* verificação é auxiliar; o servidor confirma no envio */ }
  }
  const rules = () => { const v = root.querySelector("#pw")?.value || "", m = { len: v.length >= 10, let: /[a-z]/i.test(v), dig: /\d/.test(v) };
    root.querySelectorAll("#pwrules [data-r]").forEach(li => li.classList.toggle("ok", m[li.dataset.r])); };
  function wire() {
    const f = root.querySelector("#f4");
    root.querySelector("#phone")?.addEventListener("input", e => { e.target.value = maskPhone(e.target.value); });
    root.querySelector("#cpf")?.addEventListener("input", e => { e.target.value = maskCpf(e.target.value); });
    root.querySelector("#pw")?.addEventListener("input", rules);
    root.querySelector("#email")?.addEventListener("blur", checkEmail);
    root.querySelector("#email")?.addEventListener("input", () => { root.querySelector("#ok-email").textContent = ""; });
    root.querySelector("[data-eye]")?.addEventListener("click", e => { const b = e.currentTarget, i = root.querySelector("#pw"), show = i.type === "password";
      i.type = show ? "text" : "password"; b.innerHTML = ic(show ? "eyeoff" : "eye"); b.setAttribute("aria-pressed", String(show)); b.setAttribute("aria-label", show ? "Ocultar senha" : "Mostrar senha"); });
    // validação ao sair de cada campo (sem acusar campos ainda não tocados)
    root.querySelectorAll("#f4 input:not([type=checkbox]):not([type=radio])").forEach(inp => inp.addEventListener("blur", () => {
      if (!inp.value) return; read(); const e = errorsOf().find(x => x.field === inp.id); setErr(inp.id, e?.msg || ""); }));
    root.querySelectorAll("[name=plan]").forEach(i => i.addEventListener("change", () => { d.plan = i.value; draw(); root.querySelector(`[name=plan][value=${d.plan}]`)?.focus(); }));
    root.querySelector("[data-back]")?.addEventListener("click", () => { st.step = 1; draw(); });
    f.addEventListener("submit", submit);
    rules();
  }
  async function submit(e) {
    e.preventDefault();
    if (st.busy) return;
    const gerr = root.querySelector("#err"); gerr.textContent = "";
    if (st.step === 1) {
      read();
      await checkEmail();
      const errs = errorsOf();
      ["name", "email", "profession", "phone", "cpf", "pw", "terms"].forEach(k => setErr(k, errs.find(x => x.field === k)?.msg || ""));
      if (st.emailOk === false && st.emailChecked === d.email) root.querySelector("#e-email").innerHTML = `Este e-mail já tem conta. <a href="#/entrar">Entrar</a> ou <a href="#/recuperar">recuperar o acesso</a>.`;
      if (errs.length) { gerr.textContent = `Revise ${errs.length === 1 ? "o campo destacado" : `os ${errs.length} campos destacados`}.`; root.querySelector("#" + errs[0].field)?.focus(); return; }
      st.step = 2; draw(); root.querySelector("h1")?.focus?.(); return;
    }
    const btn = e.target.querySelector(".a4-cta"); st.busy = true; btn.disabled = true; btn.setAttribute("aria-busy", "true"); btn.textContent = "Criando conta…";
    try {
      const res = await api.post("/v1/auth/register", { name: d.name, email: d.email, profession: d.profession, phone: d.phone, password: d.password,
        accept_terms: d.accept_terms, marketing_opt_in: d.marketing_opt_in, plan: d.plan, origin: "site", ...(d.cpf ? { cpf: d.cpf } : {}) });
      d.password = "";
      onLogin(res.token, res.user);
      unmount();
      toast(d.plan === "free" ? "Conta criada. Este é o seu primeiro diagnóstico." : `Conta criada no plano ${PLAN_NAME[d.plan]}. Conclua o pagamento em Planos quando quiser.`);
      location.hash = "#/dashboard?primeiro=1";
    } catch (x) {
      st.busy = false;
      const det = x instanceof ApiError && x.status === 409 ? x.problem.detail || "" : "";
      st.step = 1; draw();
      if (/CPF/i.test(det)) setErr("cpf", "Este CPF já está em outra conta. Entre ou recupere o acesso.");
      if (/e-mail/i.test(det)) { st.emailOk = false; st.emailChecked = d.email; setErr("email", "x"); root.querySelector("#e-email").innerHTML = `Este e-mail já tem conta. <a href="#/entrar">Entrar</a> ou <a href="#/recuperar">recuperar o acesso</a>.`; }
      root.querySelector("#err").textContent = problemMsg(x);
    }
  }
  draw();
}
