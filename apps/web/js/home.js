/* AURION — tela inicial imersiva 4.0
 * Componentes reais: notebook com dashboard de demonstração navegável, hologramas que abrem painéis de análise,
 * apresentação "Ver como funciona", conteúdo público e formulário de contato. Sem dependências externas
 * (canvas 2D e SVG; nada de WebGL), com redução de movimento e pausa fora da tela.
 * Todos os números do notebook e dos hologramas são da DEMONSTRAÇÃO (dados fictícios, assets/data/home-demo.json). */

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const RM = matchMedia("(prefers-reduced-motion: reduce)").matches;
const FINE = matchMedia("(pointer: fine)").matches;
const API = (window.RAMON_API_BASE || "").replace(/\/$/, "");
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const nf = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const brl = v => nf.format(+v || 0);
const brlShort = v => { const n = +v || 0, a = Math.abs(n); return a >= 1e6 ? "R$ " + (n / 1e6).toFixed(2).replace(".", ",") + " mi" : a >= 1e4 ? "R$ " + Math.round(n / 1e3) + " mil" : brl(n); };
const pct = (v, d = 1) => ((+v || 0) * 100).toFixed(d).replace(".", ",") + "%";
const sgn = (v, d = 1) => (v >= 0 ? "+" : "−") + pct(Math.abs(v), d);
const MES = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];
const mesBr = mk => MES[+mk.slice(5, 7) - 1] + " " + mk.slice(0, 4);
const mesCurto = mk => MES[+mk.slice(5, 7) - 1];
const dbr = iso => iso ? iso.slice(0, 10).split("-").reverse().join("/") : "";
const COLORS = ["#0866FF", "#08CEFF", "#3be08f", "#e8edf5", "#ffc233"];
const SEV = { critico: "Crítico", alto: "Alto", atencao: "Atenção", informativo: "Informativo", oportunidade: "Oportunidade" };

const ICON = {
  home: '<path d="M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z"/>',
  wealth: '<path d="M3 21h18M5 21V10l7-5 7 5v11M9 21v-6h6v6"/>',
  finance: '<path d="M4 7h16v12H4zM4 11h16M8 15h3"/>',
  tax: '<path d="M7 3h7l4 4v14H7zM14 3v4h4M10 12h5M10 16h5"/>',
  sim: '<path d="M4 6h16M4 12h16M4 18h16"/><circle cx="9" cy="6" r="2"/><circle cx="15" cy="12" r="2"/><circle cx="11" cy="18" r="2"/>',
  bell: '<path d="M6 16v-5a6 6 0 0 1 12 0v5l2 2H4zM10 20a2 2 0 0 0 4 0"/>',
  doc: '<path d="M7 3h7l4 4v14H7zM14 3v4h4"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/>',
};
const ico = n => `<svg viewBox="0 0 24 24" aria-hidden="true">${ICON[n]}</svg>`;

/* ------------------------------------------------------------ dados e sessão */
let D = null;
const auth = { name: null, token: null };
async function loadDemo() {
  const r = await fetch("assets/data/home-demo.json", { cache: "no-cache" });
  if (!r.ok) throw new Error("demo indisponível");
  return r.json();
}
async function loadSession() {
  try { auth.token = localStorage.getItem("ramon.token"); } catch { auth.token = null; }
  if (!auth.token || !API) return;
  try {
    const r = await fetch(API + "/v1/me", { headers: { Authorization: "Bearer " + auth.token } });
    if (!r.ok) return;
    const me = await r.json();
    auth.name = String(me.name || "").split(" ")[0] || null;
    $$("[data-auth-link]").forEach(a => { a.textContent = "Minha conta"; a.href = "app/#/dashboard"; });
  } catch { /* segue como visitante */ }
}
async function logout() {
  try { if (API && auth.token) await fetch(API + "/v1/auth/logout", { method: "POST", headers: { Authorization: "Bearer " + auth.token } }); } catch { /* segue */ }
  try { localStorage.removeItem("ramon.token"); } catch { /* segue */ }
  location.reload();
}

/* ------------------------------------------------------------ gráficos SVG */
function areaPath(values, w, h, pad = 6) {
  const min = Math.min(...values), max = Math.max(...values), r = max - min || 1;
  const pts = values.map((v, i) => [i * (w / Math.max(values.length - 1, 1)), pad + (1 - (v - min) / r) * (h - pad * 2)]);
  return { pts, line: pts.map((p, i) => (i ? "L" : "M") + p[0].toFixed(1) + " " + p[1].toFixed(1)).join(" ") };
}
let gid = 0;
function areaSvg(values, { w = 220, h = 70, dots = true, cls = "" } = {}) {
  const { pts, line } = areaPath(values, w, h), g = "ga" + ++gid;
  return `<svg class="${cls}" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-hidden="true" style="width:100%;height:${h}px;overflow:visible">
    <defs><linearGradient id="${g}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#08CEFF" stop-opacity=".45"/><stop offset="1" stop-color="#0866FF" stop-opacity="0"/></linearGradient></defs>
    <path d="${line} L${w} ${h} L0 ${h}Z" fill="url(#${g})"/><path d="${line}" fill="none" stroke="#08CEFF" stroke-width="2" vector-effect="non-scaling-stroke" style="filter:drop-shadow(0 0 4px #08CEFF)"/>
    ${dots ? pts.map((p, i) => `<circle cx="${p[0].toFixed(1)}" cy="${p[1].toFixed(1)}" r="${i === pts.length - 1 ? 3.6 : 2.4}" fill="${i === pts.length - 1 ? "#fff" : "#08CEFF"}"/>`).join("") : ""}</svg>`;
}
function donutSvg(items, sel, size = 150, stroke = 24) {
  const r = (size - stroke) / 2, c = size / 2;
  let a0 = -Math.PI / 2;
  return `<svg class="d-donut" viewBox="0 0 ${size} ${size}" style="width:${size}px;height:${size}px" role="group" aria-label="Alocação por classe">${items.map((it, i) => {
    const a1 = a0 + it.weight * Math.PI * 2, large = a1 - a0 > Math.PI ? 1 : 0;
    const p = (a, rr) => [c + rr * Math.cos(a), c + rr * Math.sin(a)];
    const [x0, y0] = p(a0, r), [x1, y1] = p(a1 - 0.012, r);
    const d = `M${x0.toFixed(2)} ${y0.toFixed(2)} A${r} ${r} 0 ${large} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`;
    a0 = a1;
    return `<path d="${d}" fill="none" stroke="${COLORS[i % 5]}" stroke-width="${sel === i ? stroke + 6 : stroke}" opacity="${sel == null || sel === i ? 1 : .35}" tabindex="0" role="button" data-alloc="${i}" aria-selected="${sel === i}" aria-label="${esc(it.group)}: ${pct(it.weight, 1)}"/>`;
  }).join("")}</svg>`;
}
/* arredondamento que fecha 100% (maior resto) */
function pctsTo100(ws, dec = 0) {
  const f = 10 ** dec, raw = ws.map(w => w * 100 * f), fl = raw.map(Math.floor);
  let rest = 100 * f - fl.reduce((a, b) => a + b, 0);
  raw.map((v, i) => [v - fl[i], i]).sort((a, b) => b[0] - a[0]).forEach(([, i]) => { if (rest-- > 0) fl[i]++; });
  return fl.map(v => (v / f).toFixed(dec).replace(".", ",") + "%");
}

/* ------------------------------------------------------------ dashboard de demonstração (notebook e apresentação) */
const SECS = [["inicio", "Início", "home"], ["patrimonio", "Patrimônio", "wealth"], ["financas", "Finanças", "finance"], ["tributacao", "Tributação", "tax"],
  ["simulador", "Simulador", "sim"], ["alertas", "Alertas", "bell"], ["documentos", "Documentos", "doc"]];
const APP_ROUTE = { inicio: "dashboard", patrimonio: "patrimonio", financas: "financas", tributacao: "tributacao", simulador: "simulador", alertas: "alertas", documentos: "documentos", configuracoes: "configuracoes" };
const KEYWORDS = { patrimonio: "patrimonio carteira investimentos custodia", financas: "financas gastos despesas receitas", tributacao: "tributacao imposto ir darf irpf", simulador: "simulador simulacao cenario",
  alertas: "alertas radar prazos", documentos: "documentos informe nota", configuracoes: "configuracoes conta perfil seguranca tema", inicio: "inicio visao geral" };
const norm = s => String(s).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

function createDash(root) {
  const st = { sec: "inicio", hist: [], month: D.patrimonio.series.at(-1).month, sel: null, pop: null };
  const months = D.patrimonio.series.map(s => s.month);
  const at = () => { const i = months.indexOf(st.month); return { i, nw: +D.patrimonio.series[i].value, prev: i ? +D.patrimonio.series[i - 1].value : null }; };
  const taxTo = () => D.impostos.monthly.filter(m => m.month <= st.month).reduce((s, m) => s + +m.value, 0);
  const openApp = sec => `<a class="d-open" href="app/#/${APP_ROUTE[sec]}">Abrir no aplicativo ↗</a>`;
  const back = () => st.hist.length ? `<button class="d-back" type="button" data-back>← Voltar</button>` : "";
  const go = sec => { if (sec === st.sec) return; st.hist.push(st.sec); st.sec = sec; st.pop = null; draw(); };
  root.goto = sec => { st.hist = sec === "inicio" ? [] : ["inicio"]; st.sec = sec; st.pop = null; draw(); };

  const S = {
    inicio() {
      const { nw, prev } = at(), d = prev ? nw / prev - 1 : 0, tx = taxTo(), alloc = D.alocacao, labels = pctsTo100(alloc.map(a => a.weight));
      return `<div class="d-hello"><div><h4>Olá, ${esc(auth.name || D.nome)}!</h4><p>Aqui está um resumo da sua vida financeira.</p></div><span class="d-tag">Demonstração · ${esc(mesBr(st.month))}</span></div>
        <div class="d-grid d-g3">
          <button class="d-card" type="button" data-go="patrimonio"><h5>${ico("wealth")}Patrimônio total</h5><div class="d-kpi">${brl(nw)}</div>${prev ? `<span class="d-delta ${d >= 0 ? "d-up" : "d-down"}">${d >= 0 ? "▲" : "▼"} ${sgn(d)}</span>` : ""}
            ${areaSvg(D.patrimonio.series.filter(s => s.month <= st.month).map(s => +s.value), { h: 46 })}</button>
          <button class="d-card" type="button" data-go="tributacao"><h5>${ico("tax")}Impostos estimados (ano)</h5><div class="d-kpi">${brl(tx)}</div><span class="d-delta d-neu">estimativa até ${esc(mesCurto(st.month))}</span>
            <div class="d-bars" style="height:46px">${D.impostos.monthly.map(m => `<div><i class="${m.month === st.month ? "hi" : ""}" style="height:${Math.max(3, +m.value / Math.max(...D.impostos.monthly.map(x => +x.value), 1) * 40)}px;opacity:${m.month <= st.month ? 1 : .25}"></i></div>`).join("")}</div></button>
          <button class="d-card" type="button" data-go="alertas"><h5>${ico("bell")}Alertas</h5><div class="d-kpi d-red" style="font-size:30px">${D.alertas.open}</div><p class="d-mut">pontos de atenção · <b class="d-red">${D.alertas.critical} prioritários</b></p><p class="d-mut" style="margin-top:6px">Ver central ›</p></button>
        </div>
        <div class="d-grid d-g2" style="margin-top:12px">
          <div class="d-card"><h5>Minha alocação</h5><div style="display:flex;gap:14px;align-items:center;margin-top:8px">${donutSvg(alloc, st.sel, 132, 20)}
            <ul class="d-legend" style="flex:1">${alloc.map((a, i) => `<li aria-selected="${st.sel === i}"><i style="background:${COLORS[i % 5]}"></i><button type="button" data-alloc="${i}"><span>${esc(a.group)}</span></button><b>${labels[i]}</b><span class="d-mut">${brlShort(a.value)}</span></li>`).join("")}</ul></div>
            <p class="d-mut" style="margin-top:6px">${st.sel != null ? `${esc(alloc[st.sel].group)}: ${brl(alloc[st.sel].value)} (${labels[st.sel]})` : `Total ${brl(alloc.reduce((s, a) => s + +a.value, 0))} · posição de ${dbr(D.referencia)}`}</p></div>
          <div class="d-card"><h5>Próximas ações</h5><ul class="d-list">${D.proximas_acoes.slice(0, 3).map(a => `<li><span class="d-sev s-${a.severity}" aria-hidden="true">!</span><div><b>${esc(a.title)}</b><span>${esc(a.detail.slice(0, 70))}${a.detail.length > 70 ? "…" : ""}</span></div>
            ${a.action ? `<a class="d-go" href="app/#${esc(a.action.route)}">${esc(a.action.label)} ↗</a>` : ""}</li>`).join("")}</ul></div>
        </div>`;
    },
    patrimonio() {
      const ser = D.patrimonio.series.filter(s => s.month <= st.month), { nw, prev } = at(), first = +ser[0].value, max = Math.max(...D.custodia.map(c => +c.value));
      return `${back()}<div class="d-hello"><div><h4>Patrimônio</h4><p>Evolução ${esc(D.patrimonio.series_kind)}.</p></div><span class="d-tag">Demonstração · ${esc(mesBr(st.month))}</span></div>
        <div class="d-grid d-g2"><div class="d-card"><h5>Evolução</h5><div class="d-kpi">${brl(nw)}</div><span class="d-delta ${nw >= first ? "d-up" : "d-down"}">${sgn(nw / first - 1)} desde ${esc(mesCurto(ser[0].month))}</span>${prev ? ` <span class="d-mut">· ${sgn(nw / prev - 1)} no mês</span>` : ""}
          ${areaSvg(ser.map(s => +s.value), { h: 110 })}<div style="display:flex;justify-content:space-between" class="d-mut">${ser.map(s => `<span>${mesCurto(s.month)}</span>`).join("")}</div></div>
          <div class="d-card"><h5>Por instituição</h5><table class="d-tbl" style="margin-top:6px">${D.custodia.map(c => `<tr><td>${esc(c.custodian)}<div style="height:4px;border-radius:4px;margin-top:3px;width:${(+c.value / max * 100).toFixed(0)}%;background:linear-gradient(90deg,#0866FF,#08CEFF)"></div></td><td class="n">${brlShort(c.value)}</td></tr>`).join("")}</table></div></div>
        ${openApp("patrimonio")}`;
    },
    financas() {
      const t = D.financas.totais;
      return `${back()}<div class="d-hello"><div><h4>Finanças</h4><p>Período ${esc(mesBr(D.financas.periodo.from))} a ${esc(mesBr(D.financas.periodo.to))}.</p></div><span class="d-tag">Demonstração</span></div>
        <div class="d-grid d-g3"><div class="d-card"><h5>Entradas</h5><div class="d-kpi" style="color:#3be08f">${brl(t.income)}</div></div><div class="d-card"><h5>Saídas</h5><div class="d-kpi">${brl(t.expense)}</div></div>
          <div class="d-card"><h5>Saldo</h5><div class="d-kpi">${brl(t.net)}</div><span class="d-delta d-neu">poupança ${pct(t.savings_rate, 0)}</span></div></div>
        <div class="d-card" style="margin-top:12px"><h5>Liquidez</h5><p style="margin-top:6px">${brl(D.liquidez.cash)} em conta cobrem cerca de ${(+D.liquidez.months_covered).toFixed(1).replace(".", ",")} mês(es) da despesa média de ${brl(D.liquidez.avg_monthly_expense)}.</p></div>
        ${openApp("financas")}`;
    },
    tributacao() {
      const max = Math.max(...D.impostos.monthly.map(m => +m.value), 1);
      return `${back()}<div class="d-hello"><div><h4>Tributação</h4><p>Renda variável — estimativa, não é valor pago nem obrigação definitiva.</p></div><span class="d-tag">Demonstração</span></div>
        <div class="d-grid d-g2"><div class="d-card"><h5>Imposto estimado por mês</h5><div class="d-bars" style="height:120px">${D.impostos.monthly.map(m => `<div><span>${+m.value ? brlShort(m.value) : "—"}</span><i class="${m.month === st.month ? "hi" : ""}" style="height:${Math.max(3, +m.value / max * 80)}px"></i>${mesCurto(m.month)}</div>`).join("")}</div></div>
          <div class="d-card"><h5>Resumo ${D.impostos.year}</h5><table class="d-tbl"><tr><td>Imposto estimado no ano</td><td class="n">${brl(D.impostos.estimated)}</td></tr><tr><td>Até ${esc(mesCurto(st.month))}</td><td class="n">${brl(taxTo())}</td></tr>
            <tr><td>Ganhos isentos</td><td class="n">${brl(D.impostos.exempt)}</td></tr><tr><td>Confiança do cálculo</td><td class="n">${pct(D.impostos.confidence, 0)}</td></tr></table>
            <p class="d-mut" style="margin-top:8px">Como calculamos: preço médio, regras versionadas, IRRF compensado e DARF de R$ 10,00 ou mais com vencimento no último dia útil do mês seguinte.</p></div></div>
        <a class="d-open" href="app/#/tributacao?tab=guias">Gerar DARF no aplicativo ↗</a> ${openApp("tributacao")}`;
    },
    simulador() {
      return `${back()}<div class="d-hello"><div><h4>Simulador</h4><p>Compare cenários antes de decidir. Simulação não é garantia de resultado.</p></div><span class="d-tag">Demonstração</span></div>
        <div class="d-grid d-g2"><div class="d-card"><h5>Cenários de patrimônio</h5><p class="d-mut" style="margin-top:6px">Aporte mensal, prazo e taxa — compare três hipóteses lado a lado.</p><button class="d-open" type="button" data-holo-open="cenarios">Abrir cenários simulados</button></div>
          <div class="d-card"><h5>Venda de ativos e PGBL</h5><p class="d-mut" style="margin-top:6px">No aplicativo: imposto, isenção usada, prejuízo e liquidez de uma venda hipotética; efeito de aporte em PGBL na declaração.</p>${openApp("simulador")}</div></div>`;
    },
    alertas() {
      return `${back()}<div class="d-hello"><div><h4>Central de alertas</h4><p>${D.alertas.open} pontos de atenção · ${D.alertas.critical} prioritários.</p></div><span class="d-tag">Demonstração</span></div>
        <div class="d-card"><ul class="d-list">${D.alertas.itens.map(a => `<li><span class="d-sev s-${a.severidade}" aria-hidden="true">!</span><div><b>${esc(a.titulo)}</b><span>${esc(SEV[a.severidade] || "")}${a.prazo ? " · prazo " + dbr(a.prazo) : ""} — ${esc(a.detalhe.slice(0, 90))}${a.detalhe.length > 90 ? "…" : ""}</span></div>${a.rota ? `<a class="d-go" href="app/#${esc(a.rota)}">Abrir ↗</a>` : ""}</li>`).join("")}</ul></div>
        ${openApp("alertas")}`;
    },
    documentos() {
      return `${back()}<div class="d-hello"><div><h4>Documentos</h4><p>Notas, informes e comprovantes lidos e conferidos.</p></div><span class="d-tag">Demonstração</span></div>
        <div class="d-card"><table class="d-tbl">${D.documentos.map(x => `<tr><td>${esc(x.titulo)}</td><td class="n"><span class="d-delta ${x.status === "validado" ? "d-up" : "d-neu"}">${esc(x.status)}</span></td></tr>`).join("")}</table></div>
        ${openApp("documentos")}`;
    },
    configuracoes() {
      return `${back()}<div class="d-hello"><div><h4>Configurações</h4><p>Perfil, segurança, tema e compartilhamento com seu contador.</p></div><span class="d-tag">Demonstração</span></div>
        <div class="d-card"><p>As configurações ficam na sua conta: verificação em duas etapas, sessões, tema claro/escuro, acesso somente leitura para o contador e exportação dos seus dados.</p>${openApp("configuracoes")}</div>`;
    },
  };

  function popHtml() {
    if (st.pop === "bell") return `<div class="d-pop" role="dialog" aria-label="Avisos"><p class="t">Avisos e pendências</p>${D.alertas.itens.slice(0, 4).map(a => `<button type="button" data-go="alertas">${esc(a.titulo)}</button>`).join("")}<button type="button" data-go="alertas"><b>Ver central de alertas ›</b></button></div>`;
    if (st.pop === "user") return `<div class="d-pop" role="menu" aria-label="Conta">${auth.name
      ? `<p class="t">Olá, ${esc(auth.name)}</p><a href="app/#/dashboard" role="menuitem">Abrir minha conta</a><a href="app/#/configuracoes" role="menuitem">Configurações da conta</a><button type="button" role="menuitem" data-logout>Sair com segurança</button>`
      : `<p class="t">Visitante</p><a href="app/#/entrar" role="menuitem">Entrar</a><a href="app/#/cadastro" role="menuitem">Criar conta</a><button type="button" role="menuitem" data-go="configuracoes">Ver configurações (demonstração)</button>`}</div>`;
    if (st.pop && st.pop.startsWith("busca:")) {
      const q = norm(st.pop.slice(6)), hits = [...SECS, ["configuracoes", "Configurações", "gear"]].filter(([k, t]) => norm(t).includes(q) || (KEYWORDS[k] || "").includes(q));
      return `<div class="d-pop" style="left:188px;right:auto" role="listbox" aria-label="Resultados">${hits.length ? hits.map(([k, t]) => `<button type="button" role="option" data-go="${k}">${esc(t)}</button>`).join("") : `<p class="t">Nada encontrado</p>`}</div>`;
    }
    return "";
  }
  function draw() {
    const focusSel = document.activeElement && root.contains(document.activeElement) ? (document.activeElement.dataset.nav ? `[data-nav="${document.activeElement.dataset.nav}"]` : document.activeElement.id ? "#" + document.activeElement.id : null) : null;
    const uid = root.dataset.dash;
    root.innerHTML = `<nav class="d-side" aria-label="Menu da demonstração"><span class="d-logo">AURION</span>
        ${SECS.map(([k, t, ic]) => `<button class="d-nav" type="button" data-nav="${k}" aria-current="${st.sec === k}">${ico(ic)}${t}${k === "alertas" ? `<span class="cnt">${D.alertas.open}</span>` : ""}</button>`).join("")}
        <button class="d-nav d-nav--bottom" type="button" data-nav="configuracoes" aria-current="${st.sec === "configuracoes"}">${ico("gear")}Configurações</button></nav>
      <div class="d-main"><div class="d-top">
          <label class="d-search"><span class="sr-only" style="position:absolute;left:-999px">Buscar na demonstração</span>${ico("search")}<input id="q-${uid}" type="search" placeholder="Buscar no Aurion…" autocomplete="off"></label>
          <span class="d-sp"></span>
          <select class="d-sel" id="m-${uid}" aria-label="Período de referência">${months.map(m => `<option value="${m}" ${m === st.month ? "selected" : ""}>${mesBr(m)}</option>`).join("")}</select>
          <button class="d-ib" type="button" id="b-${uid}" data-pop="bell" aria-label="Notificações" aria-expanded="${st.pop === "bell"}">${ico("bell")}<span class="dt"></span></button>
          <button class="d-av" type="button" id="u-${uid}" data-pop="user" aria-label="Conta" aria-expanded="${st.pop === "user"}">${esc((auth.name || D.nome || "A")[0])}</button>
        </div>${popHtml()}${S[st.sec]()}
        <div class="d-foot"><span>${esc(D.aviso)}</span></div></div>`;
    if (focusSel) root.querySelector(focusSel)?.focus({ preventScroll: true });
    root.resize?.();
  }
  root.addEventListener("click", e => {
    const t = e.target.closest("[data-nav],[data-go],[data-back],[data-pop],[data-alloc],[data-logout],[data-holo-open]");
    if (!t) { if (st.pop && !e.target.closest(".d-pop,.d-search")) { st.pop = null; draw(); } return; }
    if (t.dataset.nav) { st.hist = t.dataset.nav === "inicio" ? [] : st.sec === t.dataset.nav ? st.hist : [...st.hist, st.sec]; st.sec = t.dataset.nav; st.pop = null; draw(); }
    else if (t.dataset.go) go(t.dataset.go);
    else if (t.hasAttribute("data-back")) { st.sec = st.hist.pop() || "inicio"; st.pop = null; draw(); }
    else if (t.dataset.pop) { st.pop = st.pop === t.dataset.pop ? null : t.dataset.pop; draw(); }
    else if (t.dataset.alloc != null) { const i = +t.dataset.alloc; st.sel = st.sel === i ? null : i; draw(); }
    else if (t.hasAttribute("data-logout")) logout();
    else if (t.dataset.holoOpen) openHolo(t.dataset.holoOpen, t);
  });
  root.addEventListener("keydown", e => {
    const p = e.target.closest("path[data-alloc]");
    if (p && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); p.dispatchEvent(new MouseEvent("click", { bubbles: true })); }
    if (e.key === "Escape" && st.pop) { e.stopPropagation(); st.pop = null; draw(); }
    if (e.target.matches("input[type=search]") && e.key === "Enter") {
      const q = norm(e.target.value.trim()); if (!q) return;
      const hit = [...SECS, ["configuracoes", "Configurações"]].find(([k, t]) => norm(t).includes(q) || (KEYWORDS[k] || "").includes(q));
      if (hit) go(hit[0]); else { st.pop = "busca:" + e.target.value; draw(); }
    }
  });
  root.addEventListener("input", e => { if (e.target.matches("input[type=search]") && e.target.value.trim().length >= 2) { const v = e.target.value; st.pop = "busca:" + v; draw(); const i = root.querySelector("input[type=search]"); i.value = v; i.focus(); } });
  root.addEventListener("change", e => { if (e.target.matches("select.d-sel")) { st.month = e.target.value; draw(); root.querySelector("select.d-sel")?.focus(); } });
  // escala o dashboard (desenhado em 1000×625) para o tamanho da tela do notebook
  // no celular, troca para o layout compacto (uma coluna, menu em abas) em vez de miniaturizar a tela inteira
  const fit = root.parentElement, screen = fit.parentElement;
  const resize = () => {
    const w = fit.clientWidth || screen.clientWidth, compact = innerWidth <= 760;
    root.classList.toggle("dash--compact", compact); screen.classList.toggle("is-compact", compact);
    root.style.setProperty("--ds", (w / (compact ? 440 : 1000)).toFixed(4));
    fit.style.height = compact ? (root.offsetHeight * w / 440) + "px" : "";
  };
  new ResizeObserver(resize).observe(screen); addEventListener("resize", resize);
  root.resize = resize;
  draw();
  return root;
}

/* ------------------------------------------------------------ globo (canvas 2D, projeção ortográfica) */
let LAND = null;
async function landPoints() {
  if (LAND) return LAND;
  const m = await (await fetch("assets/data/land-mask.json")).json();
  const bytes = Uint8Array.from(atob(m.bits), c => c.charCodeAt(0)), pts = [];
  for (let r = 0; r < m.rows; r++) for (let c = 0; c < m.cols; c++) {
    const i = r * m.cols + c;
    if (bytes[i >> 3] & (1 << (7 - (i & 7)))) pts.push([(m.lat0 - r * m.step - m.step / 2) * Math.PI / 180, (-180 + c * m.step + m.step / 2) * Math.PI / 180]);
  }
  return (LAND = pts);
}
const CITIES = [[-23.55, -46.63], [40.71, -74.0], [51.5, -0.12], [35.68, 139.69], [1.35, 103.82], [-33.86, 151.2], [19.43, -99.13]].map(([a, b]) => [a * Math.PI / 180, b * Math.PI / 180]);
function makeGlobe(canvas, { speed = 0.12, tilt = -0.32 } = {}) {
  const ctx = canvas.getContext("2d");
  let lon0 = -0.87, raf = 0, running = false, last = 0;
  const size = () => { const d = Math.min(devicePixelRatio || 1, 2), w = canvas.clientWidth || 220; canvas.width = w * d; canvas.height = w * d; return d; };
  let dpr = size();
  const proj = (lat, lon) => { // ortográfica com inclinação
    const x = Math.cos(lat) * Math.sin(lon - lon0), y0 = Math.sin(lat), z0 = Math.cos(lat) * Math.cos(lon - lon0);
    const y = y0 * Math.cos(tilt) - z0 * Math.sin(tilt), z = y0 * Math.sin(tilt) + z0 * Math.cos(tilt);
    return [x, -y, z];
  };
  function frame(t) {
    if (!LAND) return;
    const W = canvas.width, R = W * 0.42, C = W / 2;
    ctx.clearRect(0, 0, W, W);
    const g = ctx.createRadialGradient(C - R * .3, C - R * .35, R * .1, C, C, R * 1.12);
    g.addColorStop(0, "rgba(8,206,255,.28)"); g.addColorStop(.7, "rgba(8,102,255,.12)"); g.addColorStop(1, "rgba(8,102,255,0)");
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(C, C, R * 1.1, 0, 7); ctx.fill();
    ctx.strokeStyle = "rgba(8,206,255,.75)"; ctx.lineWidth = 1.2 * dpr; ctx.shadowColor = "#08CEFF"; ctx.shadowBlur = 10 * dpr;
    ctx.beginPath(); ctx.arc(C, C, R, 0, 7); ctx.stroke(); ctx.shadowBlur = 0;
    ctx.strokeStyle = "rgba(8,206,255,.16)"; ctx.lineWidth = 0.7 * dpr;   // malha
    for (let lon = 0; lon < 180; lon += 30) { ctx.beginPath(); let first = true; for (let lat = -90; lat <= 90; lat += 6) { const [x, y, z] = proj(lat * Math.PI / 180, lon * Math.PI / 180); if (z < 0) { first = true; continue; } first ? ctx.moveTo(C + x * R, C + y * R) : ctx.lineTo(C + x * R, C + y * R); first = false; } ctx.stroke(); }
    for (let lon = 180; lon < 360; lon += 30) { ctx.beginPath(); let first = true; for (let lat = -90; lat <= 90; lat += 6) { const [x, y, z] = proj(lat * Math.PI / 180, lon * Math.PI / 180); if (z < 0) { first = true; continue; } first ? ctx.moveTo(C + x * R, C + y * R) : ctx.lineTo(C + x * R, C + y * R); first = false; } ctx.stroke(); }
    for (let lat = -60; lat <= 60; lat += 30) { ctx.beginPath(); let first = true; for (let lon = 0; lon <= 360; lon += 6) { const [x, y, z] = proj(lat * Math.PI / 180, lon * Math.PI / 180); if (z < 0) { first = true; continue; } first ? ctx.moveTo(C + x * R, C + y * R) : ctx.lineTo(C + x * R, C + y * R); first = false; } ctx.stroke(); }
    for (const [lat, lon] of LAND) {   // continentes
      const [x, y, z] = proj(lat, lon); if (z <= 0) continue;
      ctx.fillStyle = `rgba(${120 + 100 * z | 0},${220 + 30 * z | 0},255,${0.25 + 0.7 * z})`;
      const s = (0.9 + 1.4 * z) * dpr * (W / (220 * dpr));
      ctx.fillRect(C + x * R - s / 2, C + y * R - s / 2, s, s);
    }
    const vis = CITIES.map(c => proj(...c)).filter(p => p[2] > 0.05);   // conexões ilustrativas
    ctx.lineWidth = 1 * dpr;
    for (let i = 1; i < vis.length; i++) {
      const a = vis[0], b = vis[i], mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2, lift = 1.25;
      ctx.strokeStyle = "rgba(8,206,255,.55)"; ctx.beginPath(); ctx.moveTo(C + a[0] * R, C + a[1] * R); ctx.quadraticCurveTo(C + mx * R * lift, C + my * R * lift, C + b[0] * R, C + b[1] * R); ctx.stroke();
    }
    for (const p of vis) { ctx.fillStyle = "#ffffff"; ctx.shadowColor = "#08CEFF"; ctx.shadowBlur = 8 * dpr; ctx.beginPath(); ctx.arc(C + p[0] * R, C + p[1] * R, 2.2 * dpr, 0, 7); ctx.fill(); ctx.shadowBlur = 0; }
    if (running && !RM && !(LITE && canvas.id === "globe-small" && Math.random() < .5)) { lon0 -= speed * Math.min((t - last) / 1000, .05) ; last = t; raf = requestAnimationFrame(frame); }
  }
  const start = () => { if (running) return; running = true; last = performance.now(); raf = requestAnimationFrame(frame); };
  const stop = () => { running = false; cancelAnimationFrame(raf); };
  landPoints().then(() => { frame(performance.now()); if (!RM) start(); });
  new IntersectionObserver(es => es.forEach(e => (e.isIntersecting && !RM ? start() : stop()))).observe(canvas);
  addEventListener("resize", () => { dpr = size(); frame(performance.now()); });
  return { stop, start };
}

/* ------------------------------------------------------------ simulação de cenários (juros compostos, hipóteses explícitas) */
function scenarios({ inicial, aporte, anos, taxas }) {
  return taxas.map(a => {
    const im = (1 + a / 100) ** (1 / 12) - 1, n = anos * 12, fvP = inicial * (1 + im) ** n, fvA = im ? aporte * (((1 + im) ** n - 1) / im) : aporte * n;
    const anual = Array.from({ length: anos + 1 }, (_, y) => { const k = y * 12; return inicial * (1 + im) ** k + (im ? aporte * (((1 + im) ** k - 1) / im) : aporte * k); });
    return { taxa: a, final: fvP + fvA, investido: inicial + aporte * n, anual };
  });
}

/* ------------------------------------------------------------ hologramas (miniaturas) */
function drawHoloMinis() {
  const s = D.patrimonio.series.map(x => +x.value), g = s.at(-1) / s[0] - 1;
  $("#h-growth").textContent = (g >= 0 ? "+" : "−") + pct(Math.abs(g));
  $("#h-growth-chart").innerHTML = areaSvg(s, { w: 220, h: 90 }).replace(/^<svg[^>]*>|<\/svg>$/g, "") +
    `<path d="M196 18 L214 6 M214 6 L206 7 M214 6 L212 14" stroke="#fff" stroke-width="2.4" fill="none" stroke-linecap="round" style="filter:drop-shadow(0 0 4px #08CEFF)"/>`;
  const sc = scenarios({ inicial: 0, aporte: 1000, anos: 12, taxas: [10] })[0].anual.slice(1), max = Math.max(...sc);
  $("#h-scen-chart").innerHTML = sc.map((v, i) => { const h = 10 + v / max * 74, x = 6 + i * 18; return `<rect x="${x}" y="${90 - h}" width="11" height="${h}" rx="2" fill="url(#hb)" opacity="${.55 + .45 * i / sc.length}"/>`; }).join("") +
    `<defs><linearGradient id="hb" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#8ff0ff"/><stop offset="1" stop-color="#0866FF" stop-opacity=".2"/></linearGradient></defs>`;
}

/* ------------------------------------------------------------ diálogos */
let opener = null;
function openDlg(dlg, from) {
  opener = from || document.activeElement;
  dlg.classList.remove("is-closing");
  dlg.showModal();
}
function closeDlg(dlg) {
  if (!dlg.open) return;
  const done = () => { dlg.classList.remove("is-closing"); dlg.close(); opener?.focus?.({ preventScroll: true }); };
  if (RM) return done();
  dlg.classList.add("is-closing"); setTimeout(done, 200);
}
function wireDialogs() {
  $$("dialog.panel").forEach(d => {
    d.addEventListener("cancel", e => { e.preventDefault(); closeDlg(d); });
    d.addEventListener("click", e => { if (e.target === d || e.target.closest("[data-close]")) closeDlg(d); });
  });
  $("#dlg-tour").addEventListener("close", () => tour.pause(true));
}

function svgChart(hist, proj, { w = 860, h = 240 } = {}) {
  const all = [...hist.map(x => x.v), ...proj.map(x => x.v)], min = Math.min(...all) * .985, max = Math.max(...all) * 1.01, n = hist.length + proj.length;
  const X = i => 40 + i * ((w - 60) / (n - 1)), Y = v => 14 + (1 - (v - min) / (max - min)) * (h - 50);
  const hl = hist.map((p, i) => (i ? "L" : "M") + X(i) + " " + Y(p.v)).join(" ");
  const pl = proj.length ? "M" + X(hist.length - 1) + " " + Y(hist.at(-1).v) + " " + proj.map((p, i) => "L" + X(hist.length + i) + " " + Y(p.v)).join(" ") : "";
  const grid = [0, .25, .5, .75, 1].map(f => { const v = min + (max - min) * f; return `<line x1="40" x2="${w - 20}" y1="${Y(v)}" y2="${Y(v)}" stroke="rgba(120,190,255,.12)"/><text x="0" y="${Y(v) + 4}" fill="#93a7c0" font-size="11">${brlShort(v)}</text>`; }).join("");
  const lab = [...hist, ...proj].map((p, i) => `<text x="${X(i)}" y="${h - 8}" fill="${i >= hist.length ? "#08CEFF" : "#93a7c0"}" font-size="11" text-anchor="middle">${p.l}</text>`).join("");
  return `<svg class="chart-big" viewBox="0 0 ${w} ${h}" role="img" aria-label="Evolução do patrimônio de demonstração${proj.length ? " e projeção ilustrativa" : ""}">${grid}
    <path d="${hl} L${X(hist.length - 1)} ${h - 36} L${X(0)} ${h - 36}Z" fill="rgba(8,206,255,.12)"/><path d="${hl}" fill="none" stroke="#08CEFF" stroke-width="3" style="filter:drop-shadow(0 0 6px #08CEFF)"/>
    ${pl ? `<path d="${pl}" fill="none" stroke="#8ff0ff" stroke-width="2.5" stroke-dasharray="7 6"/>` : ""}
    ${hist.map((p, i) => `<circle cx="${X(i)}" cy="${Y(p.v)}" r="4" fill="#fff"><title>${p.l}: ${brl(p.v)}</title></circle>`).join("")}${lab}</svg>`;
}

const HOLO = {
  crescimento(body) {
    const ser = D.patrimonio.series; let per = ser.length, proj = true;
    const draw = () => {
      const h = ser.slice(-per).map(s => ({ l: mesCurto(s.month), v: +s.value })), first = h[0].v, last = h.at(-1).v;
      const mm = (last / first) ** (1 / Math.max(h.length - 1, 1)) - 1;
      const lastMk = ser.at(-1).month;
      const p = proj ? Array.from({ length: 6 }, (_, i) => { const d = new Date(+lastMk.slice(0, 4), +lastMk.slice(5, 7) - 1 + i + 1, 1); return { l: MES[d.getMonth()] + "*", v: last * (1 + mm) ** (i + 1) }; }) : [];
      body.innerHTML = `<div class="row" style="display:flex;flex-wrap:wrap;gap:10px;align-items:center;justify-content:space-between">
          <div class="seg" role="group" aria-label="Período">${[[3, "3 meses"], [ser.length, `${ser.length} meses`]].map(([k, l]) => `<button type="button" data-per="${k}" aria-pressed="${per === k}">${l}</button>`).join("")}</div>
          <label style="display:flex;gap:8px;align-items:center;font-size:14px;color:var(--ink-2)"><input type="checkbox" data-proj ${proj ? "checked" : ""}> Mostrar projeção de 6 meses</label></div>
        <div class="kpis"><div><span>Patrimônio em ${esc(mesBr(lastMk))}</span><b>${brl(last)}</b></div><div><span>Variação no período</span><b>${sgn(last / first - 1)}</b></div>
          <div><span>Média mensal</span><b>${sgn(mm, 2)}</b></div>${proj ? `<div><span>Projeção em 6 meses*</span><b>${brlShort(p.at(-1).v)}</b></div>` : ""}</div>
        ${svgChart(h, p)}
        <p class="warn">Evolução ${esc(D.patrimonio.series_kind)} do patrimônio de demonstração. *A projeção repete a variação média mensal do período escolhido: é ilustrativa e não é garantia de resultado.</p>
        <p><a class="lnk" href="app/#/patrimonio">Ver a análise patrimonial no aplicativo →</a></p>`;
    };
    body.onclick = e => { const b = e.target.closest("[data-per]"); if (b) { per = +b.dataset.per; draw(); } };
    body.onchange = e => { if (e.target.matches("[data-proj]")) { proj = e.target.checked; draw(); } };
    draw();
  },
  cenarios(body) {
    const v = { inicial: Math.round(+D.patrimonio.total / 1000) * 1000, aporte: 2000, anos: 10, t1: 8, t2: 10, t3: 12 };
    const draw = () => {
      const res = scenarios({ inicial: v.inicial, aporte: v.aporte, anos: v.anos, taxas: [v.t1, v.t2, v.t3] }), max = Math.max(...res.map(r => r.final));
      const names = ["Conservador", "Moderado", "Arrojado"];
      body.querySelector("#scen-out").innerHTML = `
        <svg class="chart-big" viewBox="0 0 860 220" role="img" aria-label="Comparação de três cenários simulados">${res.map((r, i) => r.anual.map((val, y) => {
          const bw = 860 / (v.anos + 1) / 3.6, x = 30 + y * (820 / (v.anos + 1)) + i * (bw + 2), h = val / max * 180;
          return `<rect x="${x.toFixed(1)}" y="${(196 - h).toFixed(1)}" width="${bw.toFixed(1)}" height="${h.toFixed(1)}" rx="2" fill="${["#0866FF", "#08CEFF", "#8ff0ff"][i]}" opacity=".9"><title>${names[i]} · ano ${y}: ${brl(val)}</title></rect>`; }).join("")).join("")}
          ${Array.from({ length: v.anos + 1 }, (_, y) => `<text x="${(30 + y * (820 / (v.anos + 1)) + 10).toFixed(0)}" y="214" fill="#93a7c0" font-size="11">${y}</text>`).join("")}</svg>
        <table class="tbl"><thead><tr><th>Cenário</th><th class="n">Taxa a.a.</th><th class="n">Total aportado</th><th class="n">Valor ao fim de ${v.anos} anos</th><th class="n">Diferença</th></tr></thead>
          <tbody>${res.map((r, i) => `<tr><td><span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${["#0866FF", "#08CEFF", "#8ff0ff"][i]}"></span> ${names[i]}</td><td class="n">${String(r.taxa).replace(".", ",")}%</td><td class="n">${brl(r.investido)}</td><td class="n"><b>${brl(r.final)}</b></td><td class="n">${brl(r.final - res[0].final)}</td></tr>`).join("")}</tbody></table>`;
    };
    body.innerHTML = `<p>Compare três hipóteses de rentabilidade para o mesmo plano de aportes. Altere as variáveis e o resultado é recalculado.</p>
      <form class="form-row" id="scen-f" novalidate>
        <label>Valor inicial (R$)<input inputmode="decimal" name="inicial" value="${v.inicial}"></label><label>Aporte mensal (R$)<input inputmode="decimal" name="aporte" value="${v.aporte}"></label>
        <label>Prazo (anos)<input inputmode="numeric" name="anos" value="${v.anos}"></label><label>Conservador (% a.a.)<input inputmode="decimal" name="t1" value="${v.t1}"></label>
        <label>Moderado (% a.a.)<input inputmode="decimal" name="t2" value="${v.t2}"></label><label>Arrojado (% a.a.)<input inputmode="decimal" name="t3" value="${v.t3}"></label></form>
      <div id="scen-out"></div>
      <p class="warn">Hipóteses: taxas nominais constantes, aportes no fim de cada mês, sem impostos, custos ou inflação. É uma simulação educativa: não é promessa de rentabilidade nem recomendação de investimento.</p>
      <p><a class="lnk" href="app/#/simulador">Simular venda de ativos e PGBL, com imposto, no aplicativo →</a></p>`;
    body.querySelector("#scen-f").addEventListener("input", e => {
      const n = e.target.name, raw = String(e.target.value).replace(/\./g, "").replace(",", "."), x = +raw;
      const ok = isFinite(x) && x >= 0 && (n !== "anos" || (Number.isInteger(x) && x >= 1 && x <= 40)) && (!n.startsWith("t") || x <= 50) && (n !== "inicial" || x <= 1e9) && (n !== "aporte" || x <= 1e7);
      e.target.setAttribute("aria-invalid", String(!ok));
      if (ok) { v[n] = x; draw(); }
    });
    draw();
  },
  globo(body) {
    const tot = D.posicoes.reduce((s, p) => s + +p.valor, 0), mk = {};
    D.posicoes.forEach(p => { mk[p.mercado] = (mk[p.mercado] || 0) + +p.valor; });
    body.innerHTML = `<canvas class="globe globe-big" id="globe-big" width="360" height="360" aria-hidden="true"></canvas>
      <div class="kpis">${Object.entries(mk).map(([k, val]) => `<div><span>${esc(k)}</span><b>${pct(val / tot, 0)}</b></div>`).join("")}<div><span>Exposição internacional</span><b>0%</b></div><div><span>Posições</span><b>${D.posicoes.length}</b></div></div>
      <p>Na carteira de demonstração, todas as ${D.posicoes.length} posições estão no Brasil (B3, Tesouro Direto e bancos). Por isso o mapa não mostra exposição internacional — o globo aqui é ilustrativo e as linhas de conexão não representam movimentações.</p>
      <table class="tbl"><thead><tr><th>Instituição</th><th class="n">Valor</th><th class="n">Peso</th></tr></thead><tbody>${D.custodia.map(c => `<tr><td>${esc(c.custodian)}</td><td class="n">${brl(c.value)}</td><td class="n">${pct(+c.value / tot, 1)}</td></tr>`).join("")}</tbody></table>
      <p class="warn">Quando a sua carteira tiver BDRs, ETFs internacionais ou investimentos no exterior, a distribuição geográfica aparece com os seus dados no aplicativo.</p>
      <p><a class="lnk" href="app/#/alocacao">Ver alocação no aplicativo →</a></p>`;
    makeGlobe(body.querySelector("#globe-big"), { speed: .18 });
  },
};
const HOLO_T = { crescimento: "Projeção de crescimento", cenarios: "Cenários simulados", globo: "Globo financeiro" };
function openHolo(k, from) {
  const dlg = $("#dlg-holo");
  if (tourDlgOpen()) closeDlg($("#dlg-tour"));
  $("#dlg-holo-t").textContent = HOLO_T[k];
  HOLO[k]($("#dlg-holo-b"));
  openDlg(dlg, from);
}
const tourDlgOpen = () => $("#dlg-tour").open;

/* ------------------------------------------------------------ informações de confiança (verificáveis) */
const INFO = {
  lgpd: ["Seus dados protegidos (LGPD)", `<ul class="dots"><li>O CPF é guardado só como impressão protegida (HMAC), nunca em texto aberto; nas guias de pagamento, fica cifrado.</li>
    <li>Verificação em duas etapas (TOTP), gestão de sessões e aviso de acesso por aparelho novo.</li><li>Trilha de auditoria encadeada por hash de cada ação relevante.</li>
    <li>Você exporta seus dados e exclui a conta em Privacidade, dentro do aplicativo.</li><li>Senhas de banco nunca são pedidas nem guardadas.</li></ul>
    <p><a class="lnk" href="app/#/privacidade">Ver Privacidade e auditoria →</a></p>`],
  openfinance: ["Integração via Open Finance", `<p>A conexão bancária segue o modelo de consentimento do Open Finance: você autoriza no ambiente da própria instituição, pode revogar a qualquer momento e a AURION guarda só o identificador da conexão — nunca a senha.</p>
    <p class="warn">Situação atual: a integração por agregador autorizado está pronta no sistema e é ativada quando o contrato com o agregador for concluído. Enquanto isso, seus dados entram por arquivos: extratos OFX/CSV e relatórios da B3.</p>
    <p><a class="lnk" href="app/#/conexoes">Ver Conexões →</a> · <a class="lnk" href="app/#/importar">Importar arquivos →</a></p>`],
  inteligencia: ["Inteligência para melhores decisões", `<ul class="dots"><li>Motores determinísticos com regras versionadas: o mesmo dado gera sempre o mesmo resultado, com hash de reprodutibilidade.</li>
    <li>Simulador de cenários, radar de alertas com evidência e guias DARF/DARE com multa e juros calculados.</li><li>Assistente que explica números com fonte e recusa recomendação de compra ou venda.</li></ul>
    <p><button class="lnk" type="button" data-open-tour>Ver como funciona →</button></p>`],
};

/* ------------------------------------------------------------ "Ver como funciona" */
const STEPS = [
  { sec: "inicio", h: "Visão geral", p: "Patrimônio, impostos estimados e alertas em uma tela. Troque o período no seletor do topo e clique nos cartões para detalhar.", app: "dashboard" },
  { sec: "patrimonio", h: "Patrimônio consolidado", p: "Evolução mês a mês e distribuição por instituição. No aplicativo, também por classe e liquidez.", app: "patrimonio" },
  { sec: "financas", h: "Finanças", p: "Entradas, saídas, poupança e liquidez a partir dos seus extratos, com a origem de cada lançamento.", app: "financas" },
  { sec: "tributacao", h: "Inteligência tributária", p: "Imposto da bolsa estimado mês a mês, isenção, prejuízos e DARF com código, vencimento, multa e juros. Estimativa: não é obrigação definitiva.", app: "tributacao" },
  { sec: "alertas", h: "Radar de alertas", p: "Prazos e riscos com evidência, prioridade e o próximo passo — como o DARF que vence em poucos dias.", app: "alertas" },
  { sec: "simulador", h: "Simulador de cenários", p: "Compare hipóteses antes de decidir. Toda simulação mostra premissas e não é garantia de resultado.", app: "simulador" },
  { sec: "documentos", h: "Documentos e IR", p: "Notas de corretagem, informes e comprovantes de DARF lidos, conferidos e ligados ao checklist do imposto de renda.", app: "documentos" },
];
const tour = (() => {
  let i = 0, playing = true, t0 = 0, raf = 0, dash = null;
  const DUR = 7000;
  const show = () => {
    const s = STEPS[i];
    dash.goto(s.sec);
    $("#tour-n").textContent = `Etapa ${i + 1} de ${STEPS.length}`;
    $("#tour-h").textContent = s.h; $("#tour-p").textContent = s.p;
    $("#tour-app").href = "app/#/" + s.app;
    $('[data-tour="prev"]').disabled = i === 0;
    $('[data-tour="next"]').textContent = i === STEPS.length - 1 ? "Concluir ✓" : "Avançar ›";
    t0 = performance.now();
  };
  const tick = t => { const f = Math.min((t - t0) / DUR, 1); $("#tour-bar").style.width = (playing ? f * 100 : $("#tour-bar").style.width.replace("%", "") || 0) + "%"; if (playing && f >= 1) { if (i < STEPS.length - 1) { i++; show(); } else setPlay(false); } raf = requestAnimationFrame(tick); };
  const setPlay = p => { playing = p && !RM; const b = $('[data-tour="play"]'); b.textContent = playing ? "❚❚ Pausar" : "▶ Reproduzir"; b.setAttribute("aria-label", playing ? "Pausar apresentação" : "Reproduzir apresentação"); if (playing) t0 = performance.now() - (parseFloat($("#tour-bar").style.width) || 0) / 100 * DUR; };
  return {
    open(step = 0, from) {
      if (!dash) dash = createDash($("#dash-tour"));
      if ($("#dlg-holo").open) closeDlg($("#dlg-holo"));
      i = Math.max(0, Math.min(step, STEPS.length - 1)); setPlay(!RM); show();
      openDlg($("#dlg-tour"), from); cancelAnimationFrame(raf); raf = requestAnimationFrame(tick);
    },
    next() { if (i < STEPS.length - 1) { i++; show(); } else closeDlg($("#dlg-tour")); },
    prev() { if (i > 0) { i--; show(); } },
    toggle() { setPlay(!playing); },
    pause(stopLoop) { setPlay(false); if (stopLoop) cancelAnimationFrame(raf); },
  };
})();

/* ------------------------------------------------------------ conteúdo público, planos, contato */
async function loadNews() {
  const ul = $("#news");
  try {
    const r = await fetch("app/data/public/news.json", { cache: "no-cache" });
    const d = r.ok ? await r.json() : { items: [] };
    const items = (d.items || []).slice(0, 6);
    ul.innerHTML = items.length ? items.map(n => `<li><a href="${esc(n.url)}" target="_blank" rel="noopener noreferrer">${esc(n.title)}</a><small>${esc(n.source)}${n.published_at ? " · " + dbr(n.published_at) : ""}</small></li>`).join("")
      : `<li class="news__empty">Nenhuma publicação recente das fontes oficiais.</li>`;
  } catch { ul.innerHTML = `<li class="news__empty">Não foi possível carregar as publicações agora.</li>`; }
}
const FEAT = [["dashboard", "Dashboard"], ["patrimonio", "Patrimônio"], ["financas", "Finanças"], ["orcamento", "Orçamento"], ["documentos", "Documentos"], ["conexoes", "Conexões"],
  ["alertas_limitados", "Alertas (limitados)"], ["radar", "Radar de alertas completo"], ["inteligencia_financeira", "Inteligência financeira"], ["inteligencia_tributaria", "Inteligência tributária e guias"],
  ["simulacao", "Simulação de cenários"], ["assistente_ia", "Assistente com IA"], ["cenarios_avancados", "Cenários avançados"], ["inteligencia_patrimonial", "Inteligência patrimonial"], ["automacao", "Automação"]];
function planCompare() {
  const P = D.planos, has = (p, f) => p.recursos.includes(f);
  $("#plan-compare").innerHTML = `<table class="cmp"><thead><tr><th>Recurso</th>${P.map(p => `<th>${esc(p.nome)}<br><small>${+p.preco ? "R$ " + p.preco.replace(".", ",") + "/mês" : "R$ 0"}</small></th>`).join("")}</tr></thead>
    <tbody>${FEAT.filter(([f]) => P.some(p => has(p, f))).map(([f, l]) => `<tr><td>${l}</td>${P.map(p => has(p, f) ? `<td class="y" aria-label="incluído">✓</td>` : `<td class="n" aria-label="não incluído">—</td>`).join("")}</tr>`).join("")}</tbody></table>`;
}
function wireContact() {
  const f = $("#contact"), msg = f.querySelector(".contact__msg"), btn = f.querySelector("button[type=submit]");
  f.addEventListener("submit", async e => {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(f));
    const bad = [];
    if (String(data.name).trim().length < 2) bad.push("name");
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(data.email).trim())) bad.push("email");
    if (String(data.message).trim().length < 10) bad.push("message");
    f.querySelectorAll("[aria-invalid]").forEach(x => x.removeAttribute("aria-invalid"));
    bad.forEach(n => f.elements[n].setAttribute("aria-invalid", "true"));
    msg.className = "contact__msg";
    if (bad.length) { msg.classList.add("err"); msg.textContent = "Confira nome, e-mail e mensagem (mínimo de 10 caracteres)."; f.elements[bad[0]].focus(); return; }
    if (!API) { msg.classList.add("err"); msg.textContent = "Envio indisponível neste ambiente de demonstração. No site oficial, a mensagem chega à equipe AURION."; return; }
    btn.setAttribute("aria-busy", "true"); btn.textContent = "Enviando…";
    try {
      const r = await fetch(API + "/v1/public/contact", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) });
      const out = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(out.detail || "Não foi possível enviar agora.");
      msg.classList.add("ok"); msg.textContent = "Mensagem recebida. Vamos responder no e-mail informado."; f.reset();
    } catch (x) { msg.classList.add("err"); msg.textContent = x.message || "Não foi possível enviar agora. Tente novamente em instantes."; }
    finally { btn.removeAttribute("aria-busy"); btn.textContent = "Enviar mensagem"; }
  });
}

/* ------------------------------------------------------------ casca: menu, parallax, logo, partículas */
function wireShell() {
  const body = document.body, burger = $(".burger");
  burger.addEventListener("click", () => { const o = body.classList.toggle("menu-open"); burger.setAttribute("aria-expanded", String(o)); burger.setAttribute("aria-label", o ? "Fechar menu" : "Abrir menu"); });
  $$("#menu a").forEach(a => a.addEventListener("click", () => { body.classList.remove("menu-open"); burger.setAttribute("aria-expanded", "false"); }));
  addEventListener("keydown", e => { if (e.key === "Escape" && body.classList.contains("menu-open")) { body.classList.remove("menu-open"); burger.setAttribute("aria-expanded", "false"); burger.focus(); } });
  const top = $(".topbar");
  const onScroll = () => { top.classList.toggle("is-scrolled", scrollY > 20); if (!RM) document.documentElement.style.setProperty("--sy", Math.min(scrollY / innerHeight, 1.2).toFixed(3)); };
  addEventListener("scroll", onScroll, { passive: true }); onScroll();
  // item ativo do menu conforme a seção visível
  const links = new Map($$("#menu a").map(a => [a.getAttribute("href").slice(1), a]));
  [...links.keys()].forEach(id => { const el = document.getElementById(id); if (el) io.observe(el); });
  // parallax sutil (só com mouse e sem redução de movimento)
  if (FINE && !RM) {
    let px = 0, py = 0, pend = 0;
    addEventListener("pointermove", e => { px = e.clientX / innerWidth * 2 - 1; py = e.clientY / innerHeight * 2 - 1; if (!pend) pend = requestAnimationFrame(() => { pend = 0; const s = document.documentElement.style; s.setProperty("--px", px.toFixed(3)); s.setProperty("--py", py.toFixed(3)); }); }, { passive: true });
  }
  // logotipo: varredura de luz no carregamento e reflexo que acompanha o mouse
  $$(".logo").forEach(l => {
    if (!RM) { l.classList.add("is-sweep"); setTimeout(() => l.classList.remove("is-sweep"), 1900); }
    l.addEventListener("pointermove", e => { const r = l.getBoundingClientRect(); l.style.setProperty("--mx", ((e.clientX - r.left) / r.width * 100).toFixed(1) + "%"); });
  });
  // parâmetros comerciais (utm_*, plano) seguem para o cadastro
  const qs = new URLSearchParams(location.search), keep = [...qs].filter(([k]) => k.startsWith("utm_") || k === "plano" || k === "ref");
  if (keep.length) $$('a[href^="app/#/cadastro"]').forEach(a => { const [base, q = ""] = a.getAttribute("href").split("?"), p = new URLSearchParams(q); keep.forEach(([k, v]) => { if (!p.has(k)) p.set(k, v); }); a.href = base + "?" + p; });
}
const io = new IntersectionObserver(es => es.forEach(e => {
  if (!e.isIntersecting) return;
  const a = document.querySelector(`#menu a[href="#${e.target.id}"]`);
  if (a) { $$("#menu a").forEach(x => x.removeAttribute("aria-current")); a.setAttribute("aria-current", "true"); }
}), { rootMargin: "-45% 0px -50% 0px" });

function particles() {
  const c = $("#particles"), ctx = c.getContext("2d");
  const N = innerWidth < 760 ? 26 : 70, P = [];
  let W, H, raf = 0, run = !RM;
  const size = () => { const d = Math.min(devicePixelRatio || 1, 2); W = c.width = innerWidth * d; H = c.height = innerHeight * d; };
  size(); addEventListener("resize", size);
  for (let i = 0; i < N; i++) P.push({ x: Math.random(), y: Math.random(), r: .4 + Math.random() * 1.4, v: .00004 + Math.random() * .00012, a: .2 + Math.random() * .6 });
  const frame = () => {
    ctx.clearRect(0, 0, W, H);
    for (const p of P) { p.y -= p.v * 16; if (p.y < -0.02) { p.y = 1.02; p.x = Math.random(); } ctx.fillStyle = `rgba(8,206,255,${p.a})`; ctx.beginPath(); ctx.arc(p.x * W, p.y * H, p.r * (W / innerWidth), 0, 7); ctx.fill(); }
    if (run && !LITE) raf = requestAnimationFrame(frame);
  };
  frame();
  document.addEventListener("visibilitychange", () => { run = !document.hidden && !RM; cancelAnimationFrame(raf); if (run) raf = requestAnimationFrame(frame); });
}

/* modo leve: sem aceleração gráfica (quadros lentos) desliga desfoques, brilhos animados e partículas */
let LITE = false;
function adaptive() {
  if (RM) return;
  let n = 0; const t = performance.now();
  const f = () => { n++; if (performance.now() - t < 1500) requestAnimationFrame(f); else if (n / 1.5 < 40) { LITE = true; document.documentElement.classList.add("lite"); } };
  setTimeout(() => requestAnimationFrame(f), 1200);
}

/* ------------------------------------------------------------ início */
async function main() {
  wireShell(); wireDialogs(); wireContact(); particles(); loadNews(); adaptive();
  document.addEventListener("click", e => {
    const t = e.target.closest("[data-open-tour],[data-tour-step],[data-tour],[data-holo],[data-info]");
    if (!t) return;
    if (t.matches("[data-open-tour]")) { if ($("#dlg-info").open) closeDlg($("#dlg-info")); setTimeout(() => tour.open(0, t), $("#dlg-info").open ? 220 : 0); }
    else if (t.dataset.tourStep) tour.open(+t.dataset.tourStep, t);
    else if (t.dataset.tour) tour[t.dataset.tour === "play" ? "toggle" : t.dataset.tour]();
    else if (t.dataset.holo) openHolo(t.dataset.holo, t);
    else if (t.dataset.info) { const [h, html] = INFO[t.dataset.info]; $("#dlg-info-t").textContent = h; $("#dlg-info-b").innerHTML = html; openDlg($("#dlg-info"), t); }
  });
  $("#dlg-tour").addEventListener("keydown", e => { if (e.key === "ArrowRight") tour.next(); if (e.key === "ArrowLeft") tour.prev(); });
  try {
    [D] = await Promise.all([loadDemo(), loadSession()]);
    createDash($("#dash")); drawHoloMinis(); planCompare();
    makeGlobe($("#globe-small"));
  } catch (e) {
    $("#dash").innerHTML = `<p style="padding:30px">Demonstração indisponível no momento. Os links e o cadastro continuam funcionando.</p>`;
    $$("[data-holo],[data-open-tour],[data-tour-step]").forEach(b => { b.disabled = true; b.title = "Demonstração indisponível no momento"; });
    console.error(e);
  }
}
main();
