/* Notebook da experiência 4.0 — dashboard de demonstração do AURION.
 * Cotações: reais, do serviço centralizado (market_store.js), sempre com fonte, horário e rótulo atrasado/fechamento.
 * Patrimônio e carteira: FICTÍCIOS (quantidades inventadas) valorizados pelas cotações reais. Nada de dados de clientes,
 * nenhuma ordem, nenhuma movimentação: é um ambiente público e isolado da sessão do usuário. */
import { market, subscribe, item, select, history, setInterval_, refreshNow } from "./market_store.js";
import { INSTRUMENTS, TIPO_LABEL } from "./market_public.js";

const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const nf = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const brl = v => nf.format(+v || 0);
const num = (v, d = 2) => (+v).toLocaleString("pt-BR", { minimumFractionDigits: d, maximumFractionDigits: d });
const pct = (v, d = 2) => v == null || !isFinite(v) ? "—" : (v >= 0 ? "+" : "−") + Math.abs(v * 100).toFixed(d).replace(".", ",") + "%";
const hora = iso => iso ? new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "—";
const fmtQ = i => i?.ultimo == null ? "—" : i.tipo === "indice" ? num(i.ultimo, 0) + " pts" : i.tipo === "cambio" ? "R$ " + num(i.ultimo, 4) : "R$ " + num(i.ultimo, 2);
let VAR_ABS = false;
const varTxt = i => i?.indisponivel ? "indisp." : VAR_ABS && i?.variacao != null ? (i.variacao >= 0 ? "+" : "−") + num(Math.abs(i.variacao), i.tipo === "cambio" ? 4 : 2) : pct(i?.variacao_pct);
const cls = v => v == null ? "" : v >= 0 ? "up" : "down";
const RM = () => document.documentElement.classList.contains("a4-calm") || matchMedia("(prefers-reduced-motion: reduce)").matches;

/* carteira de demonstração: quantidades FICTÍCIAS; preço médio = primeira cotação do último ano (simulação) */
export const CARTEIRA = [{ id: "PETR4", qtd: 400 }, { id: "VALE3", qtd: 250 }, { id: "ITUB4", qtd: 600 }, { id: "BBDC4", qtd: 800 }, { id: "B3SA3", qtd: 1200 }];
export const RENDA_FIXA = 180000, CAIXA = 25000;
const PERS = ["1D", "1S", "1M", "1A", "5A"];
const PER_LABEL = { "1D": "um dia", "1S": "uma semana", "1M": "um mês", "1A": "um ano", "5A": "cinco anos" };
const ICO = {
  inicio: '<path d="M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z"/>', patrimonio: '<path d="M3 21h18M5 21V10l7-5 7 5v11M9 21v-6h6v6"/>',
  mercados: '<path d="M4 19V9M9 19V5M14 19v-8M19 19V7"/>', carteira: '<path d="M4 7h16v12H4zM4 11h16M16 15h1"/>', analises: '<path d="M4 19l5-6 4 3 7-9"/><path d="M15 7h5v5"/>',
  oportunidades: '<circle cx="11" cy="11" r="6"/><path d="M20 20l-4.5-4.5"/>', simulador: '<path d="M4 6h16M4 12h16M4 18h16"/><circle cx="9" cy="6" r="2"/><circle cx="15" cy="12" r="2"/><circle cx="11" cy="18" r="2"/>',
  alertas: '<path d="M6 16v-5a6 6 0 0 1 12 0v5l2 2H4zM10 20a2 2 0 0 0 4 0"/>', documentos: '<path d="M7 3h7l4 4v14H7zM14 3v4h4"/>',
  configuracoes: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1"/>',
};
const SECS = [["inicio", "Início"], ["patrimonio", "Patrimônio"], ["mercados", "Mercados"], ["carteira", "Carteira"], ["analises", "Análises"], ["oportunidades", "Oportunidades"],
  ["simulador", "Simulador"], ["alertas", "Alertas"], ["documentos", "Documentos"]];
const ico = k => `<svg viewBox="0 0 24 24" aria-hidden="true">${ICO[k]}</svg>`;

/* ------------------------------------------------------------ gráficos */
let gid = 0;
function lineChart(pts, { w = 520, h = 150, area = true, labels = true, unidade = "" } = {}) {
  if (!pts || pts.length < 2) return `<p class="d4-mut">Dados insuficientes para o gráfico.</p>`;
  const vs = pts.map(p => p.c), min = Math.min(...vs), max = Math.max(...vs), r = max - min || 1, g = "l" + ++gid;
  const X = i => i * (w / (pts.length - 1)), Y = v => 8 + (1 - (v - min) / r) * (h - 24);
  const d = pts.map((p, i) => (i ? "L" : "M") + X(i).toFixed(1) + " " + Y(p.c).toFixed(1)).join(" ");
  const up = vs.at(-1) >= vs[0], col = up ? "#20D58A" : "#ff5470";
  const lab = labels ? [0, Math.floor(pts.length / 2), pts.length - 1].map(i => `<text x="${Math.min(Math.max(X(i), 18), w - 18)}" y="${h - 2}" text-anchor="middle">${esc(shortT(pts[i].t, pts))}</text>`).join("") : "";
  return `<svg class="d4-chart" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" role="img" aria-label="Gráfico de ${pts.length} pontos, de ${num(vs[0])} a ${num(vs.at(-1))}">
    <defs><linearGradient id="${g}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${col}" stop-opacity=".35"/><stop offset="1" stop-color="${col}" stop-opacity="0"/></linearGradient></defs>
    ${[.25, .5, .75].map(f => `<line x1="0" x2="${w}" y1="${8 + f * (h - 24)}" y2="${8 + f * (h - 24)}" class="d4-grid"/>`).join("")}
    ${area ? `<path d="${d} L${w} ${h - 16} L0 ${h - 16}Z" fill="url(#${g})"/>` : ""}<path d="${d}" fill="none" stroke="${col}" stroke-width="2" vector-effect="non-scaling-stroke" class="d4-glow"/>
    <circle cx="${X(pts.length - 1)}" cy="${Y(vs.at(-1))}" r="3.5" fill="#fff"/>${lab}
    <text x="${w - 2}" y="12" text-anchor="end" class="d4-tag">${esc(unidade)}${num(vs.at(-1))}</text></svg>`;
}
function candles(pts, { w = 520, h = 160 } = {}) {
  if (!pts || pts.length < 2) return `<p class="d4-mut">Dados insuficientes para o gráfico.</p>`;
  const lo = Math.min(...pts.map(p => p.l)), hi = Math.max(...pts.map(p => p.h)), r = hi - lo || 1, bw = w / pts.length;
  const Y = v => 6 + (1 - (v - lo) / r) * (h - 22);
  return `<svg class="d4-chart" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" role="img" aria-label="Candles de ${pts.length} períodos">
    ${pts.map((p, i) => { const x = i * bw + bw / 2, up = p.c >= p.o, c = up ? "#20D58A" : "#ff5470";
      return `<line x1="${x}" x2="${x}" y1="${Y(p.h)}" y2="${Y(p.l)}" stroke="${c}" stroke-width="1" vector-effect="non-scaling-stroke"/><rect x="${x - bw * .32}" y="${Math.min(Y(p.o), Y(p.c))}" width="${bw * .64}" height="${Math.max(1, Math.abs(Y(p.o) - Y(p.c)))}" fill="${c}" opacity=".9"/>`; }).join("")}
    ${[0, Math.floor(pts.length / 2), pts.length - 1].map(i => `<text x="${Math.min(Math.max(i * bw + bw / 2, 18), w - 18)}" y="${h - 2}" text-anchor="middle">${esc(shortT(pts[i].t, pts))}</text>`).join("")}</svg>`;
}
function shortT(iso, pts) {
  const d = new Date(iso), span = Date.parse(pts.at(-1).t) - Date.parse(pts[0].t);
  if (span < 2 * 864e5) return d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  if (span < 400 * 864e5) return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
  return d.toLocaleDateString("pt-BR", { month: "2-digit", year: "2-digit" });
}
export function spark(vals, { w = 90, h = 26 } = {}) {
  if (!vals || vals.length < 2) return "";
  const min = Math.min(...vals), max = Math.max(...vals), r = max - min || 1, col = vals.at(-1) >= vals[0] ? "#20D58A" : "#ff5470";
  return `<svg class="spark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-hidden="true"><path d="${vals.map((v, i) => (i ? "L" : "M") + (i * w / (vals.length - 1)).toFixed(1) + " " + (2 + (1 - (v - min) / r) * (h - 4)).toFixed(1)).join(" ")}" fill="none" stroke="${col}" stroke-width="1.6" vector-effect="non-scaling-stroke"/></svg>`;
}

/* ------------------------------------------------------------ cálculos sobre histórico real */
const rets = cs => cs.slice(1).map((c, i) => c / cs[i] - 1);
const std = a => { const m = a.reduce((s, x) => s + x, 0) / a.length; return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / Math.max(a.length - 1, 1)); };
const maxDD = cs => { let pk = cs[0], dd = 0; for (const c of cs) { pk = Math.max(pk, c); dd = Math.min(dd, c / pk - 1); } return dd; };
export async function carteiraSerie(period) {
  const hs = await Promise.all(CARTEIRA.map(p => history(p.id, period)));
  const n = Math.min(...hs.map(h => h.pontos.length));
  return Array.from({ length: n }, (_, k) => {
    const idx = h => h.pontos[h.pontos.length - n + k];
    return { t: idx(hs[0]).t, c: CARTEIRA.reduce((s, p, j) => s + p.qtd * idx(hs[j]).c, 0) + RENDA_FIXA + CAIXA };
  });
}
export async function metricas(id) {
  const h = await history(id, "1A"), cs = h.pontos.map(p => p.c);
  return { id, ret: cs.at(-1) / cs[0] - 1, vol: std(rets(cs)) * Math.sqrt(52), dd: maxDD(cs), media: cs.reduce((s, x) => s + x, 0) / cs.length, primeiro: cs[0], ultimo: cs.at(-1) };
}

/* ------------------------------------------------------------ componente */
export function createDash4(root, { onAccount } = {}) {
  const st = { sec: "inicio", hist: [], per: "1M", mper: "1M", sel: "IBOV", prefs: loadPrefs(), op: { queda: false, abaixo: true, vol: false, acima: false }, sim: { ini: 50000, mensal: 1500, anos: 10, taxa: 10 } };
  let disposed = false;
  const go = (sec, push = true) => { if (sec === st.sec) return; if (push) st.hist.push(st.sec); st.sec = sec; draw(true); };
  const back = () => st.hist.length ? `<button type="button" class="d4-back" data-back>← Voltar</button>` : "";
  const fonte = () => `<p class="d4-src">Fonte: ${esc(market.snap?.fonte || "serviço de cotações")}${market.snap?.at ? ` · consulta ${hora(market.snap.at)}` : ""}. Patrimônio e carteira são fictícios.</p>`;
  const q = id => item(id);
  const totalCarteira = () => CARTEIRA.reduce((s, p) => s + p.qtd * (q(p.id)?.ultimo || 0), 0) + RENDA_FIXA + CAIXA;
  const variacaoHoje = () => CARTEIRA.reduce((s, p) => s + p.qtd * (q(p.id)?.variacao || 0), 0);
  const marketOk = () => market.snap && CARTEIRA.every(p => q(p.id)?.ultimo != null);
  const loadInto = (sel, fn) => { const el = root.querySelector(sel); if (!el) return; fn().then(html => { if (!disposed && el.isConnected) el.innerHTML = html; }).catch(e => { if (el.isConnected) el.innerHTML = `<p class="d4-warn">${esc(e.message || "Dados indisponíveis")}. Tente novamente em instantes.</p>`; }); };
  const perTabs = (key, cur) => `<div class="d4-per" role="group" aria-label="Período">${PERS.map(p => `<button type="button" data-${key}="${p}" aria-pressed="${p === cur}">${p}</button>`).join("")}</div>`;
  const statusLine = i => i ? `<span class="d4-badge d4-${i.dado || "na"}">${i.indisponivel ? "indisponível" : i.dado === "fechamento" ? "fechamento" : "atrasado"}</span>${i.desatualizado ? ` <span class="d4-badge d4-na">desatualizado</span>` : ""}` : "";

  const S = {
    inicio() {
      if (!marketOk()) return noMarket();
      const tot = totalCarteira(), vh = variacaoHoje();
      return `<div class="d4-hello"><div><h4>Olá! Esta é a carteira de demonstração.</h4><p>Quantidades fictícias, valorizadas pelas cotações reais do mercado.</p></div></div>
        <div class="d4-g3">
          <button type="button" class="d4-card" data-go="patrimonio"><h5>${ico("patrimonio")}Patrimônio total <small>fictício</small></h5><b class="d4-kpi">${brl(tot)}</b><span class="d4-d ${cls(vh)}">${pct(vh / (tot - vh))} hoje</span></button>
          <button type="button" class="d4-card" data-go="patrimonio"><h5>${ico("analises")}Variação no mês</h5><b class="d4-kpi" id="d4-mes">…</b><span class="d4-mut" id="d4-mes-p">calculando com o histórico</span></button>
          <button type="button" class="d4-card" data-go="mercados" data-sel="IBOV"><h5>${ico("mercados")}Ibovespa</h5><b class="d4-kpi">${fmtQ(q("IBOV"))}</b><span class="d4-d ${cls(q("IBOV")?.variacao_pct)}">${pct(q("IBOV")?.variacao_pct)}</span> ${statusLine(q("IBOV"))}</button>
        </div>
        <div class="d4-g2">
          <div class="d4-card"><div class="d4-row"><h5>Evolução do patrimônio <small>fictício</small></h5>${perTabs("per", st.per)}</div><div id="d4-evo" class="d4-load">Carregando…</div></div>
          <div class="d4-card"><h5>Principais ativos</h5><ul class="d4-list">${CARTEIRA.map(p => { const i = q(p.id); return `<li><button type="button" data-go="mercados" data-sel="${p.id}"><b>${p.id}</b>${spark(i?.spark)}<span>${fmtQ(i)}</span><span class="d4-d ${cls(i?.variacao_pct)}">${varTxt(i)}</span><small>${hora(i?.horario)}</small></button></li>`; }).join("")}</ul></div>
        </div>${fonte()}`;
    },
    patrimonio() {
      if (!marketOk()) return noMarket();
      const tot = totalCarteira(), comp = [...CARTEIRA.map(p => ({ n: p.id, v: p.qtd * q(p.id).ultimo })), { n: "Renda fixa (fictícia)", v: RENDA_FIXA }, { n: "Caixa (fictício)", v: CAIXA }];
      return `${back()}<div class="d4-hello"><div><h4>Patrimônio</h4><p>Demonstrativo interativo da carteira fictícia: ${brl(tot)}.</p></div></div>
        <div class="d4-card"><div class="d4-row"><h5>Evolução</h5>${perTabs("per", st.per)}</div><div id="d4-evo" class="d4-load">Carregando…</div></div>
        <div class="d4-g2"><div class="d4-card"><h5>Composição</h5><table class="d4-tbl">${comp.map(c => `<tr><td>${esc(c.n)}<i style="width:${(c.v / tot * 100).toFixed(1)}%"></i></td><td class="n">${brl(c.v)}</td><td class="n">${(c.v / tot * 100).toFixed(1).replace(".", ",")}%</td></tr>`).join("")}</table></div>
          <div class="d4-card"><h5>Comparação de períodos</h5><div id="d4-cmp" class="d4-load">Calculando…</div></div></div>
        <p class="d4-mut">Renda fixa e caixa ficam com valor fixo (sem marcação a mercado) para não inventar rentabilidade.</p>${fonte()}`;
    },
    mercados() {
      const i = q(st.sel), grupos = [["Brasil — índice e ações", INSTRUMENTS.filter(x => x.bolsa === "B3")], ["Internacional — índices", INSTRUMENTS.filter(x => x.tipo === "indice" && x.bolsa !== "B3")], ["Câmbio", INSTRUMENTS.filter(x => x.tipo === "cambio")]];
      return `${back()}<div class="d4-hello"><div><h4>Mercados</h4><p>${esc(market.snap?.items?.some(x => x.mercado === "aberto") ? "Há pregão aberto — cotações com atraso." : "Bolsas fechadas — exibindo o último fechamento.")}</p></div>${st.hist.length || market.selected ? `<button type="button" class="d4-btn" data-geral>Voltar ao painel geral</button>` : ""}</div>
        <div class="d4-g2 d4-g2--m">
          <div class="d4-card${st.flash ? " d4-flash" : ""}" id="d4-sel"><div class="d4-row"><h5>${esc(i?.nome || st.sel)} <small>${esc(TIPO_LABEL[i?.tipo] || "")}</small></h5>${perTabs("mper", st.mper)}</div>
            <div class="d4-quote"><b>${fmtQ(i)}</b><span class="d4-d ${cls(i?.variacao_pct)}">${i?.variacao != null ? (i.variacao >= 0 ? "+" : "−") + num(Math.abs(i.variacao), i.tipo === "cambio" ? 4 : 2) : "—"} (${pct(i?.variacao_pct)})</span>${statusLine(i)}</div>
            <p class="d4-mut">${esc(i?.situacao || (i?.indisponivel ? "Cotação indisponível no momento." : ""))} · horário da cotação ${hora(i?.horario)} · período consultado: ${PER_LABEL[st.mper]}</p>
            <div id="d4-mchart" class="d4-load">Carregando…</div></div>
          <div class="d4-card"><h5>Cotações</h5>${grupos.map(([g, arr]) => `<p class="d4-grp">${g}</p><ul class="d4-list">${arr.map(x => { const v = q(x.id); return `<li><button type="button" data-sel="${x.id}" aria-pressed="${st.sel === x.id}"><b>${x.id}</b>${spark(v?.spark)}<span>${fmtQ(v)}</span><span class="d4-d ${cls(v?.variacao_pct)}">${varTxt(v)}</span></button></li>`; }).join("")}</ul>`).join("")}</div>
        </div>${fonte()}`;
    },
    carteira() {
      if (!marketOk()) return noMarket();
      return `${back()}<div class="d4-hello"><div><h4>Carteira de demonstração</h4><p>Posições fictícias. Preço médio simulado = cotação de um ano atrás.</p></div></div>
        <div class="d4-card"><div id="d4-cart" class="d4-load">Calculando desempenho…</div></div>${fonte()}`;
    },
    analises() {
      return `${back()}<div class="d4-hello"><div><h4>Análises</h4><p>Métricas de 12 meses calculadas sobre o histórico semanal real.</p></div></div>
        <div class="d4-card"><div id="d4-an" class="d4-load">Calculando…</div></div>
        <p class="d4-mut">Volatilidade anualizada = desvio-padrão dos retornos semanais × √52. Queda máxima = maior recuo a partir de um pico no período.</p>${fonte()}`;
    },
    oportunidades() {
      const C = [["queda", "Caiu mais de 2% hoje"], ["abaixo", "Abaixo da média das últimas 52 semanas"], ["vol", "Volatilidade anual abaixo de 30%"], ["acima", "Retorno em 12 meses acima do Ibovespa"]];
      return `${back()}<div class="d4-hello"><div><h4>Oportunidades — filtro por critérios</h4><p>Escolha os critérios; aparecem os ativos que atendem a todos.</p></div></div>
        <div class="d4-card"><div class="d4-crit">${C.map(([k, l]) => `<label><input type="checkbox" data-op="${k}" ${st.op[k] ? "checked" : ""}> ${l}</label>`).join("")}</div><div id="d4-op" class="d4-load">Calculando…</div></div>
        <p class="d4-warn">Filtro educativo por critérios objetivos e explícitos. Não é recomendação de compra ou venda (Resolução CVM 19/2021).</p>${fonte()}`;
    },
    simulador() {
      const s = st.sim, im = (1 + s.taxa / 100) ** (1 / 12) - 1, n = s.anos * 12, fv = s.ini * (1 + im) ** n + (im ? s.mensal * (((1 + im) ** n - 1) / im) : s.mensal * n), inv = s.ini + s.mensal * n;
      const serie = Array.from({ length: s.anos + 1 }, (_, y) => { const k = y * 12; return { t: new Date(Date.UTC(2026 + y, 0, 1)).toISOString(), c: s.ini * (1 + im) ** k + (im ? s.mensal * (((1 + im) ** k - 1) / im) : s.mensal * k) }; });
      return `${back()}<div class="d4-hello"><div><h4>Simulador</h4><p>Juros compostos com entradas editáveis — o cálculo é refeito a cada alteração.</p></div></div>
        <div class="d4-g2"><form class="d4-card d4-form" id="d4-sim" novalidate>
            <label>Valor inicial (R$)<input name="ini" inputmode="decimal" value="${s.ini}"></label><label>Aporte mensal (R$)<input name="mensal" inputmode="decimal" value="${s.mensal}"></label>
            <label>Prazo (anos)<input name="anos" inputmode="numeric" value="${s.anos}"></label><label>Taxa anual (%)<input name="taxa" inputmode="decimal" value="${s.taxa}"></label>
            <button type="button" class="d4-btn" data-usar>Usar o patrimônio fictício</button></form>
          <div class="d4-card"><h5>Resultado</h5><b class="d4-kpi">${brl(fv)}</b><p class="d4-mut">Total aportado ${brl(inv)} · juros ${brl(fv - inv)}</p>${lineChart(serie, { h: 120 })}</div></div>
        <p class="d4-warn">Hipóteses: taxa constante, aportes no fim do mês, sem impostos, custos ou inflação. Simulação não é garantia de resultado.</p>`;
    },
    alertas() {
      return `${back()}<div class="d4-hello"><div><h4>Alertas</h4><p>Eventos de mercado reais identificados e alertas fictícios de demonstração.</p></div></div>
        <div class="d4-card"><ul class="d4-al">${alertasMercado().map(a => `<li class="${a.cls}"><b>${esc(a.t)}</b><span>${esc(a.d)}</span><small>${esc(a.src)}</small></li>`).join("")}</ul><div id="d4-cvm"></div></div>`;
    },
    documentos() {
      return `${back()}<div class="d4-hello"><div><h4>Documentos</h4><p>Exemplos fictícios — esta demonstração não acessa arquivos de clientes.</p></div></div>
        <div class="d4-card"><table class="d4-tbl">${[["Nota de corretagem (exemplo)", "lida e conferida"], ["Informe de rendimentos (exemplo)", "validado"], ["Comprovante de DARF 6015 (exemplo)", "vinculado à apuração"], ["Recibo médico (exemplo)", "dedutível no IR"]]
          .map(([t, s]) => `<tr><td>${t}</td><td class="n"><span class="d4-badge d4-fechamento">${s}</span></td></tr>`).join("")}</table>
          <p class="d4-mut">Na sua conta, o AURION lê notas de corretagem, informes e comprovantes em PDF e liga cada um ao checklist do imposto de renda.</p></div>`;
    },
    configuracoes() {
      const p = st.prefs;
      return `${back()}<div class="d4-hello"><div><h4>Configurações da demonstração</h4><p>Preferências guardadas neste navegador.</p></div></div>
        <form class="d4-card d4-form" id="d4-cfg"><label>Atualização das cotações<select name="intervalo">${[[60, "a cada 60 s"], [120, "a cada 2 min"], [0, "manual"]].map(([v, l]) => `<option value="${v}" ${+p.intervalo === v ? "selected" : ""}>${l}</option>`).join("")}</select></label>
          <label>Variação dos ativos<select name="variacao"><option value="pct" ${p.variacao === "pct" ? "selected" : ""}>em %</option><option value="abs" ${p.variacao === "abs" ? "selected" : ""}>em valor</option></select></label>
          <label class="d4-chk"><input type="checkbox" name="calmo" ${p.calmo ? "checked" : ""}> Reduzir animações</label>
          <button type="button" class="d4-btn" data-refresh>Atualizar cotações agora</button>
          <p class="d4-mut">Última consulta: ${hora(market.ultima_tentativa)} · situação: ${esc({ ok: "conectado", reconectando: "reconectando", erro: "indisponível", sem_api: "API não configurada", carregando: "carregando" }[market.status])}</p></form>`;
    },
  };
  const noMarket = () => market.status === "carregando" ? `<p class="d4-load">Carregando cotações…</p>`
    : `<div class="d4-card"><p class="d4-warn">${market.status === "sem_api" ? "As cotações reais aparecem no site oficial; neste ambiente a API de mercado não está configurada." : "Cotações indisponíveis no momento. Tentando reconectar…"}</p><p class="d4-mut">Patrimônio e carteira dependem das cotações e não são exibidos sem elas — a demonstração nunca inventa preços.</p></div>`;
  function alertasMercado() {
    const out = [];
    for (const i of market.snap?.items || []) {
      if (i.indisponivel) out.push({ cls: "na", t: `${i.id}: cotação indisponível`, d: "O provedor não respondeu; o painel mostra apenas dados verificados.", src: "serviço de cotações" });
      else if (i.variacao_pct != null && Math.abs(i.variacao_pct) >= 0.02) out.push({ cls: i.variacao_pct > 0 ? "up" : "down", t: `${i.nome} ${i.variacao_pct > 0 ? "sobe" : "cai"} ${pct(i.variacao_pct)}`, d: `Cotação ${fmtQ(i)} às ${hora(i.horario)} (${i.dado === "fechamento" ? "fechamento" : "atrasada"}).`, src: "evento de mercado real" });
    }
    const b3 = item("IBOV");
    if (b3) out.push({ cls: "info", t: b3.mercado === "aberto" ? "B3: pregão aberto" : "B3: mercado fechado", d: b3.mercado === "aberto" ? "Cotações com atraso de pelo menos 15 minutos." : `Exibindo o último fechamento (${hora(b3.horario)}).`, src: "situação do pregão" });
    out.push({ cls: "demo", t: "DARF de renda variável vence em 5 dias", d: "Alerta fictício de demonstração: na sua conta, prazos e valores vêm da sua apuração.", src: "demonstração (fictício)" });
    return out;
  }

  /* --------- partes assíncronas */
  function after() {
    if (["inicio", "patrimonio"].includes(st.sec) && marketOk()) {
      loadInto("#d4-evo", async () => { const s = await carteiraSerie(st.per); const v = s.at(-1).c / s[0].c - 1;
        return `${lineChart(s, { h: st.sec === "inicio" ? 120 : 170, unidade: "R$ " })}<p class="d4-mut">Variação em ${PER_LABEL[st.per]}: <b class="d4-d ${cls(v)}">${pct(v)}</b></p>`; });
      if (st.sec === "inicio") carteiraSerie("1M").then(s => { const el = root.querySelector("#d4-mes"), p = root.querySelector("#d4-mes-p"); if (!el) return; const dv = s.at(-1).c - s[0].c; el.textContent = (dv >= 0 ? "+" : "−") + brl(Math.abs(dv)); p.innerHTML = `<span class="d4-d ${cls(dv)}">${pct(dv / s[0].c)}</span> em um mês`; })
        .catch(() => { const el = root.querySelector("#d4-mes-p"); if (el) el.textContent = "histórico indisponível agora"; });
      if (st.sec === "patrimonio") loadInto("#d4-cmp", async () => { const rows = [];
        for (const p of PERS) { try { const s = await carteiraSerie(p); rows.push([p, s.at(-1).c / s[0].c - 1]); } catch { rows.push([p, null]); } }
        return `<table class="d4-tbl">${rows.map(([p, v]) => `<tr><td>${PER_LABEL[p]}</td><td class="n d4-d ${cls(v)}">${v == null ? "sem dados suficientes" : pct(v)}</td></tr>`).join("")}</table>`; });
    }
    if (st.sec === "mercados") loadInto("#d4-mchart", async () => { const h = await history(st.sel, st.mper); const i = q(st.sel);
      const ch = ["1M", "1A", "5A"].includes(st.mper) ? candles(h.pontos) : lineChart(h.pontos, { unidade: i?.tipo === "acao" || i?.tipo === "cambio" ? "R$ " : "" });
      return ch + `<p class="d4-mut">${h.pontos.length} pontos · intervalo ${esc(h.intervalo)} · histórico consultado ${hora(h.at)}${h.desatualizado ? " · desatualizado" : ""}</p>`; });
    if (st.sec === "carteira") loadInto("#d4-cart", async () => {
      const ms = await Promise.all(CARTEIRA.map(p => metricas(p.id)));
      let tv = 0, tc = 0;
      const rows = CARTEIRA.map((p, k) => { const i = q(p.id), pm = ms[k].primeiro, v = p.qtd * i.ultimo, c = p.qtd * pm; tv += v; tc += c;
        return `<tr><td><b>${p.id}</b><small>${esc(i.nome)}</small></td><td class="n">${p.qtd}</td><td class="n">${brl(pm)}</td><td class="n">${brl(i.ultimo)}</td><td class="n">${brl(v)}</td><td class="n d4-d ${cls(v - c)}">${pct(v / c - 1)}</td></tr>`; });
      return `<table class="d4-tbl"><thead><tr><th>Ativo</th><th class="n">Qtd.</th><th class="n">Preço médio*</th><th class="n">Cotação</th><th class="n">Valor</th><th class="n">Resultado</th></tr></thead><tbody>${rows.join("")}</tbody>
        <tfoot><tr><td colspan="4">Ações (fictício)</td><td class="n">${brl(tv)}</td><td class="n d4-d ${cls(tv - tc)}">${pct(tv / tc - 1)}</td></tr></tfoot></table><p class="d4-mut">*Simulado: cotação de 12 meses atrás.</p>`; });
    if (st.sec === "analises") loadInto("#d4-an", async () => {
      const ids = ["IBOV", ...CARTEIRA.map(p => p.id)], ms = await Promise.all(ids.map(metricas)), ib = ms[0];
      return `<table class="d4-tbl"><thead><tr><th>Ativo</th><th class="n">Retorno 12m</th><th class="n">vs. Ibovespa</th><th class="n">Volatilidade</th><th class="n">Queda máx.</th></tr></thead><tbody>${ms.map(m =>
        `<tr><td><b>${m.id}</b></td><td class="n d4-d ${cls(m.ret)}">${pct(m.ret)}</td><td class="n">${m.id === "IBOV" ? "—" : pct(m.ret - ib.ret)}</td><td class="n">${pct(m.vol).replace("+", "")}</td><td class="n d4-d down">${pct(m.dd)}</td></tr>`).join("")}</tbody></table>`; });
    if (st.sec === "oportunidades") loadInto("#d4-op", async () => {
      const ib = await metricas("IBOV"), ms = await Promise.all(CARTEIRA.map(p => metricas(p.id)));
      const ok = ms.filter(m => { const i = q(m.id); return (!st.op.queda || (i?.variacao_pct ?? 0) <= -0.02) && (!st.op.abaixo || (i?.ultimo ?? m.ultimo) < m.media) && (!st.op.vol || m.vol < 0.30) && (!st.op.acima || m.ret > ib.ret); });
      if (!Object.values(st.op).some(Boolean)) return `<p class="d4-mut">Marque ao menos um critério.</p>`;
      return ok.length ? `<table class="d4-tbl"><thead><tr><th>Ativo</th><th class="n">Cotação</th><th class="n">Média 52s</th><th class="n">Vol.</th><th class="n">Ret. 12m</th></tr></thead><tbody>${ok.map(m => `<tr><td><b>${m.id}</b></td><td class="n">${fmtQ(q(m.id))}</td><td class="n">${brl(m.media)}</td><td class="n">${pct(m.vol).replace("+", "")}</td><td class="n d4-d ${cls(m.ret)}">${pct(m.ret)}</td></tr>`).join("")}</tbody></table>`
        : `<p class="d4-mut">Nenhum ativo da lista atende a todos os critérios escolhidos agora.</p>`; });
    if (st.sec === "alertas") fetch(new URL("../data/public/disclosures.json", import.meta.url), { cache: "no-cache" }).then(r => r.ok ? r.json() : { items: [] }).then(d => {
      const want = new Set(CARTEIRA.map(p => p.id)), its = (d.items || []).filter(i => (i.tickers || []).some(t => want.has(t))).slice(0, 4), el = root.querySelector("#d4-cvm");
      if (el && its.length) el.innerHTML = `<p class="d4-grp">Divulgações públicas da CVM</p><ul class="d4-al">${its.map(i => `<li class="info"><b>${esc(i.company)}</b><span>${esc(i.subject || i.category_label || "")}</span><small>${esc(i.date || "")} · ${i.url ? `<a href="${esc(i.url)}" target="_blank" rel="noopener">documento original</a>` : "CVM"}</small></li>`).join("")}</ul>`;
    }).catch(() => {});
  }
  function draw(anim = false) {
    if (disposed) return;
    root.innerHTML = `<nav class="d4-side" aria-label="Menu da demonstração"><span class="d4-logo">AURION</span>
        ${SECS.map(([k, t]) => `<button type="button" class="d4-nav" data-nav="${k}" aria-current="${st.sec === k}">${ico(k)}<span>${t}</span></button>`).join("")}
        <button type="button" class="d4-nav d4-nav--b" data-nav="configuracoes" aria-current="${st.sec === "configuracoes"}">${ico("configuracoes")}<span>Configurações</span></button></nav>
      <div class="d4-main"><div class="d4-top"><span class="d4-chip">${esc(new Date().toLocaleDateString("pt-BR", { month: "short", year: "numeric" }).replace(".", "").replace(" de ", " "))}</span>
          <span class="d4-live ${market.status}">${{ ok: "Cotações conectadas", reconectando: "Reconectando…", erro: "Cotações indisponíveis", sem_api: "Sem API de mercado", carregando: "Carregando…" }[market.status]}</span><span class="d4-sp"></span>
          <button type="button" class="d4-ib" data-nav="alertas" aria-label="Alertas">${ico("alertas")}<i></i></button>
          <button type="button" class="d4-av" data-account aria-label="Conta: criar conta ou entrar">D</button><span class="d4-tag">Demonstração</span></div>
        <div class="d4-body${anim && !RM() ? " d4-in" : ""}">${S[st.sec]()}</div></div>`;
    st.flash = false;
    after();
  }
  root.addEventListener("click", e => {
    const t = e.target.closest("[data-nav],[data-go],[data-back],[data-sel],[data-per],[data-mper],[data-geral],[data-account],[data-usar],[data-refresh]");
    if (!t) return;
    if (t.dataset.nav) { st.hist = t.dataset.nav === "inicio" ? [] : [...st.hist, st.sec]; st.sec = t.dataset.nav; draw(true); }
    else if (t.dataset.go) { if (t.dataset.sel) { st.sel = t.dataset.sel; select(st.sel); } go(t.dataset.go); }
    else if (t.dataset.sel) { st.sel = t.dataset.sel; select(st.sel); if (st.sec !== "mercados") go("mercados"); else draw(); }
    else if (t.hasAttribute("data-back")) { st.sec = st.hist.pop() || "inicio"; draw(true); }
    else if (t.dataset.per) { st.per = t.dataset.per; draw(); }
    else if (t.dataset.mper) { st.mper = t.dataset.mper; draw(); }
    else if (t.hasAttribute("data-geral")) { st.hist = []; st.sec = "inicio"; select(null); draw(true); }
    else if (t.hasAttribute("data-account")) onAccount?.();
    else if (t.hasAttribute("data-usar")) { st.sim.ini = Math.round(totalCarteira() || st.sim.ini); draw(); }
    else if (t.hasAttribute("data-refresh")) refreshNow();
  });
  root.addEventListener("change", e => {
    if (e.target.dataset.op) { st.op[e.target.dataset.op] = e.target.checked; after(); }
    const f = e.target.closest("#d4-cfg");
    if (f) { const d = new FormData(f); st.prefs = { intervalo: +d.get("intervalo"), variacao: d.get("variacao"), calmo: d.get("calmo") === "on" }; savePrefs(st.prefs); applyPrefs(st.prefs); draw(); }
  });
  root.addEventListener("input", e => {
    const f = e.target.closest("#d4-sim"); if (!f) return;
    const v = +String(e.target.value).replace(/\./g, "").replace(",", "."), n = e.target.name;
    const ok = isFinite(v) && v >= 0 && (n !== "anos" || (Number.isInteger(v) && v >= 1 && v <= 50)) && (n !== "taxa" || v <= 50) && v <= 1e9;
    e.target.setAttribute("aria-invalid", String(!ok)); if (!ok) return;
    st.sim[n] = v; const pos = e.target.selectionStart; draw(); const el = root.querySelector(`#d4-sim [name=${n}]`); el?.focus(); try { el.setSelectionRange(pos, pos); } catch {}
  });
  applyPrefs(st.prefs);
  let lastSel = market.selected;
  const unsub = subscribe(() => {
    if (market.selected && market.selected !== lastSel) { lastSel = st.sel = market.selected; st.flash = true; if (st.sec !== "mercados") { st.hist.push(st.sec); st.sec = "mercados"; } draw(true); return; }
    lastSel = market.selected;
    if (!root.contains(document.activeElement) || st.sec !== "simulador") draw();
  });
  return { goto: sec => { st.hist = []; st.sec = sec; draw(true); }, destroy: () => { disposed = true; unsub(); } };
}
function loadPrefs() { try { return { intervalo: 60, variacao: "pct", calmo: false, ...JSON.parse(localStorage.getItem("aurion.demo4") || "{}") }; } catch { return { intervalo: 60, variacao: "pct", calmo: false }; } }
function savePrefs(p) { try { localStorage.setItem("aurion.demo4", JSON.stringify(p)); } catch { /* sem armazenamento */ } }
function applyPrefs(p) { VAR_ABS = p.variacao === "abs"; document.documentElement.classList.toggle("a4-calm", !!p.calmo); if (market.intervaloSeg !== +p.intervalo) setInterval_(+p.intervalo); }
