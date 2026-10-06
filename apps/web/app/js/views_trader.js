/* AURION Trader Intelligence — telas. "AURION não executa a operação. AURION entende a operação."
 * Não há botão de comprar/vender ordem: registrar uma operação é anotar algo que você já fez na sua corretora. */
import { api, ApiError, HAS_API } from "./api.js";
import { areaChart, brl, dt, dtm, empty, esc, num, pct, toast } from "./ui.js";

const msg = e => e instanceof ApiError ? (e.problem.detail || e.problem.title) + (e.problem.errors?.length ? " — " + e.problem.errors.map(x => x.msg).join("; ") : "") : String(e.message || e);
const TABS = [["visao", "Visão Trader"], ["mercado", "Mercado"], ["watchlist", "Watchlist"], ["operacoes", "Operações"], ["estrategias", "Estratégias"], ["backtest", "Backtest"],
  ["performance", "Performance"], ["impostos", "Análise Tributária"], ["risco", "Risco"], ["divulgacoes", "Divulgações públicas"], ["eventos", "Eventos"], ["diario", "Journal"], ["paper", "Paper"]];
const sign = v => `<span class="${+v < 0 ? "neg" : +v > 0 ? "pos" : ""}">${brl(v)}</span>`;
const kpi = (t, v, sub = "") => `<div class="card"><h3>${t}</h3><div class="kpi" style="font-size:24px">${v}</div>${sub ? `<p class="small muted">${sub}</p>` : ""}</div>`;
const today = () => new Date(Date.now() - 3 * 3600e3).toISOString().slice(0, 10);
const banner = `<p class="trust-line" style="margin-bottom:12px"><span><b>AURION não executa a operação. AURION entende a operação.</b> Não enviamos, cancelamos nem automatizamos ordens, e não há recomendação individualizada de compra ou venda.</span></p>`;

/* candles em SVG com alternativa textual */
function candleChart(cs, { h = 220 } = {}) {
  if (!cs.length) return "";
  const w = Math.max(cs.length * 5, 300), lo = Math.min(...cs.map(c => c.low)), hi = Math.max(...cs.map(c => c.high)), y = v => h - 8 - (v - lo) / (hi - lo || 1) * (h - 16), bw = w / cs.length;
  const bars = cs.map((c, i) => { const up = c.close >= c.open, x = i * bw + bw / 2, col = up ? "var(--pos)" : "var(--neg)";
    return `<line x1="${x}" x2="${x}" y1="${y(c.high)}" y2="${y(c.low)}" stroke="${col}" stroke-width="1"/><rect x="${x - bw * 0.35}" y="${Math.min(y(c.open), y(c.close))}" width="${bw * 0.7}" height="${Math.max(1, Math.abs(y(c.open) - y(c.close)))}" fill="${col}"/>`; }).join("");
  return `<div style="overflow-x:auto"><svg viewBox="0 0 ${w} ${h}" width="100%" height="${h}" preserveAspectRatio="none" role="img" aria-label="Gráfico de candles de ${dt(cs[0].date)} a ${dt(cs.at(-1).date)}: mínima ${brl(lo)}, máxima ${brl(hi)}, último ${brl(cs.at(-1).close)}">${bars}</svg></div>`;
}

export async function trader(el, r) {
  if (!HAS_API) { el.innerHTML = `<section class="card">${empty("O Trader Intelligence funciona com a sua conta no site oficial.")}</section>`; return; }
  const tab = TABS.some(([k]) => k === r.params.get("tab")) ? r.params.get("tab") : "visao";
  el.innerHTML = `${banner}<div class="tabs" role="tablist" style="flex-wrap:wrap">${TABS.map(([k, l]) => `<a role="tab" aria-selected="${k === tab}" href="#/trader?tab=${k}" class="${k === tab ? "on" : ""}" style="padding:8px 12px;text-decoration:none">${l}</a>`).join("")}</div><div id="tb" class="section"></div>`;
  const box = el.querySelector("#tb");
  try { await (VIEWS[tab] || VIEWS.visao)(box, r); }
  catch (e) { box.innerHTML = e.status === 402 ? `<div class="card"><h3>Trader Intelligence faz parte do plano Pro</h3><p class="small muted" style="margin-top:6px">${esc(msg(e))}</p><a class="btn btn--primary" style="margin-top:12px" href="#/planos">Conhecer os planos</a></div>` : `<div class="card" role="alert">${esc(msg(e))}</div>`; }
}

const VIEWS = {
  async visao(el) {
    const o = await api.get("/v1/trader/overview");
    el.innerHTML = `<div class="grid g-4">${kpi("Resultado líquido (fechadas)", sign(o.totals.net_pnl), `bruto ${brl(o.totals.gross_pnl)} · custos ${brl(o.totals.costs)}`)}
      ${kpi("Imposto estimado das operações", brl(o.totals.tax_estimate), `apuração do ano: ${brl(o.tax.total_tax_due)}`)}${kpi("Taxa de acerto", pct(o.win_rate, 0), `profit factor ${o.profit_factor == null ? "—" : o.profit_factor.toFixed(2).replace(".", ",")}`)}
      ${kpi("Drawdown máximo", sign(o.max_drawdown), `${o.totals.trades} operações fechadas`)}</div>
      <div class="grid g-2 section"><section class="card"><h3>Posições abertas</h3>${o.open.length ? `<ul class="stack small" style="margin-top:10px">${o.open.map(p => `<li class="row between"><span><b>${esc(p.ticker)}</b> · ${p.side === "long" ? "comprado" : "vendido"} ${num(Math.abs(p.quantity))}</span><span>preço médio ${brl(p.avg_price)}</span></li>`).join("")}</ul>` : `<p class="small muted" style="margin-top:8px">Nenhuma posição aberta pelas operações registradas.</p>`}</section>
      <section class="card"><h3>Performance por estratégia</h3>${o.by_strategy.length ? `<ul class="stack small" style="margin-top:10px">${o.by_strategy.map(s => `<li class="row between"><span>${esc(s.key)} · ${s.trades} op.</span>${sign(s.net_pnl)}</li>`).join("")}</ul>` : `<p class="small muted" style="margin-top:8px">Associe operações a estratégias para comparar.</p>`}</section></div>
      <div class="grid g-3 section">${kpi("Ativos acompanhados", o.watched.length, o.watched.slice(0, 6).join(", ") || "crie uma watchlist")}${kpi("Registros no journal", o.journal_entries)}${kpi("Backtests", o.backtests)}</div>
      ${o.tax.next_darf ? `<section class="card section"><h3>Próximo DARF</h3><p class="small" style="margin-top:6px">${brl(o.tax.next_darf.valor)} · competência ${esc(o.tax.next_darf.competencia)} · vence ${dt(o.tax.next_darf.vencimento)} (${esc(o.tax.next_darf.status)})</p></section>` : ""}
      ${o.has_data ? "" : `<section class="card section">${empty("Registre operações (Operações) ou importe as negociações da B3 em Importar dados.")}</section>`}`;
  },

  async mercado(el, r) {
    const tk = (r.params.get("ativo") || "PETR4").toUpperCase(), range = r.params.get("periodo") || "6m";
    el.innerHTML = `<form id="mf" class="row wrap" style="gap:8px;margin-bottom:12px"><label class="sr-only" for="mt">Ativo</label><input class="input" id="mt" value="${esc(tk)}" style="max-width:140px;text-transform:uppercase" placeholder="PETR4">
      <select class="input" id="mr" style="max-width:120px">${["3m", "6m", "1y", "2y"].map(x => `<option ${x === range ? "selected" : ""}>${x}</option>`).join("")}</select><button class="btn btn--primary btn--sm">Ver</button></form><div id="mx"><div class="skeleton" style="height:200px"></div></div>`;
    el.querySelector("#mf").onsubmit = e => { e.preventDefault(); location.hash = `#/trader?tab=mercado&ativo=${encodeURIComponent(el.querySelector("#mt").value.trim())}&periodo=${el.querySelector("#mr").value}`; };
    const box = el.querySelector("#mx");
    try {
      const m = await api.get(`/v1/trader/market?ticker=${encodeURIComponent(tk)}&range=${range}`), s = m.snapshot;
      box.innerHTML = `<div class="grid g-4">${kpi(esc(m.ticker), brl(s.last), `${s.change == null ? "" : `<span class="${s.change < 0 ? "neg" : "pos"}">${pct(s.change)}</span> no dia · `}${dt(s.date)}`)}
        ${kpi("Média 20 / 50", `${brl(s.sma20)} / ${s.sma50 ? brl(s.sma50) : "—"}`)}${kpi("IFR (14)", s.rsi14 == null ? "—" : s.rsi14.toFixed(0))}${kpi("Volatilidade anual", s.volatility_annual == null ? "—" : pct(s.volatility_annual, 0), `máx. 52s ${brl(s.high_52w)} · mín. ${brl(s.low_52w)}`)}</div>
        <section class="card section"><h3>${esc(m.ticker)} · diário · ${m.candles.length} pregões</h3>${candleChart(m.candles)}
          <p class="note">Fonte: ${esc(m.provider)} · coletado em ${dtm(m.fetched_at)}${m.stale ? " · <b>dado possivelmente desatualizado</b>" : ""} · conjunto ${esc(m.dataset)}. ${esc(m.note)}</p></section>`;
    } catch (x) { box.innerHTML = `<div class="card" role="alert">${esc(msg(x))}</div>`; }
  },

  async watchlist(el) {
    const w = await api.get("/v1/trader/watchlists");
    el.innerHTML = `<form id="wf" class="row wrap" style="gap:8px;margin-bottom:12px"><input class="input" id="wn" placeholder="Nome da lista" style="max-width:200px"><input class="input" id="wt" placeholder="Códigos separados por vírgula (ex.: PETR4, VALE3)" style="flex:1;min-width:240px"><button class="btn btn--primary btn--sm">Criar lista</button></form>
      <p class="small muted">${esc(w.note || "Listas criadas por você.")}</p>
      <div class="grid g-2 section">${w.items.map(l => `<section class="card"><h3>${esc(l.name)} <button class="btn btn--ghost btn--sm right" data-wdel="${esc(l.id)}">Arquivar</button></h3>
        <div class="table-wrap"><table class="table" style="margin-top:8px"><thead><tr><th>Ativo</th><th class="num">Último</th><th class="num">Dia</th><th>Data</th><th></th></tr></thead><tbody>${(l.quotes || []).map(q => `<tr><td><a href="#/trader?tab=mercado&ativo=${esc(q.ticker)}">${esc(q.ticker)}</a></td><td class="num">${q.close ? brl(q.close) : "—"}</td><td class="num">${q.change == null ? "—" : `<span class="${q.change < 0 ? "neg" : "pos"}">${pct(q.change)}</span>`}</td><td class="small muted">${q.date ? dt(q.date) : "—"}</td>
          <td><button class="btn btn--ghost btn--sm" data-wrm="${esc(l.id)}" data-t="${esc(q.ticker)}" aria-label="Remover ${esc(q.ticker)}">×</button></td></tr>`).join("")}</tbody></table></div>
        <form class="row" data-wadd="${esc(l.id)}" style="gap:6px;margin-top:8px"><input class="input" name="t" placeholder="Adicionar código" style="max-width:160px"><button class="btn btn--ghost btn--sm">Adicionar</button></form></section>`).join("") || empty("Nenhuma lista ainda.")}</div>`;
    const list = id => w.items.find(x => x.id === id);
    const save = async (id, tickers) => { try { await api.put(`/v1/trader/watchlists/${id}`, { tickers }); VIEWS.watchlist(el); } catch (x) { toast(msg(x)); } };
    el.querySelector("#wf").onsubmit = async e => { e.preventDefault(); try { await api.post("/v1/trader/watchlists", { name: el.querySelector("#wn").value, tickers: el.querySelector("#wt").value.split(/[,\s;]+/) }); toast("Lista criada."); VIEWS.watchlist(el); } catch (x) { toast(msg(x)); } };
    el.querySelectorAll("[data-wadd]").forEach(f => f.onsubmit = e => { e.preventDefault(); save(f.dataset.wadd, [...list(f.dataset.wadd).tickers, f.t.value]); });
    el.querySelectorAll("[data-wrm]").forEach(b => b.onclick = () => save(b.dataset.wrm, list(b.dataset.wrm).tickers.filter(t => t !== b.dataset.t)));
    el.querySelectorAll("[data-wdel]").forEach(b => b.onclick = async () => { await api.del(`/v1/trader/watchlists/${b.dataset.wdel}`); VIEWS.watchlist(el); });
  },

  async operacoes(el) {
    const [t, s] = await Promise.all([api.get("/v1/trader/trades"), api.get("/v1/trader/strategies")]);
    el.innerHTML = `<section class="card"><h3>Registrar operação já realizada</h3><p class="small muted" style="margin-top:4px">Anote aqui operações feitas na sua corretora (ou importe as negociações da B3). O registro alimenta Finanças, Tributação e Trader de uma vez.</p>
      <form id="of" class="form-grid" style="margin-top:12px">
        <div class="field"><label for="ot">Ativo</label><input class="input" id="ot" required placeholder="PETR4" style="text-transform:uppercase"></div>
        <div class="field"><label for="os">Lado</label><select class="input" id="os"><option value="BUY">Compra</option><option value="SELL">Venda</option></select></div>
        <div class="field"><label for="oq">Quantidade</label><input class="input" id="oq" inputmode="decimal" required></div>
        <div class="field"><label for="op">Preço</label><input class="input" id="op" inputmode="decimal" required></div>
        <div class="field"><label for="ofe">Custos (corretagem + emolumentos)</label><input class="input" id="ofe" inputmode="decimal" value="0"></div>
        <div class="field"><label for="od">Data e hora</label><input class="input" id="od" type="datetime-local" max="${today()}T23:59" value="${today()}T10:00"></div>
        <div class="field"><label for="oe">Estratégia</label><select class="input" id="oe"><option value="">—</option>${s.items.map(x => `<option value="${esc(x.id)}">${esc(x.name)}</option>`).join("")}</select></div>
        <div class="field" style="align-self:end"><button class="btn btn--primary">Registrar</button></div></form><p class="err" id="oerr" role="alert"></p></section>
      <section class="card section"><h3>Operações <span class="right small muted">${t.total}</span></h3>${t.items.length ? `<div class="table-wrap"><table class="table" style="margin-top:8px"><thead><tr><th>Data</th><th>Ativo</th><th>Lado</th><th class="num">Qtd.</th><th class="num">Preço</th><th class="num">Custos</th><th>Origem</th><th>Situação</th><th></th></tr></thead>
        <tbody>${t.items.map(x => `<tr${x.superseded_by || x.status === "voided" ? ' style="opacity:.55"' : ""}><td class="small">${dtm(x.executed_at || x.date)}</td><td><b>${esc(x.ticker)}</b></td><td>${esc(x.side_label)}</td><td class="num">${num(x.quantity)}</td><td class="num">${brl(x.price || x.value / x.quantity)}</td><td class="num">${brl(x.fees || 0)}</td>
          <td class="small">${esc(x.origin)}${x.version > 1 ? ` · v${x.version}` : ""}</td><td class="small">${x.superseded_by ? "substituída (histórico)" : x.status === "voided" ? "anulada (histórico)" : "ativa"}</td>
          <td>${!x.superseded_by && x.status !== "voided" ? `<button class="btn btn--ghost btn--sm" data-edit="${esc(x.id)}" data-p="${x.price || ""}">Corrigir preço</button>${x.origin === "manual" ? ` <button class="btn btn--ghost btn--sm" data-void="${esc(x.id)}">Anular</button>` : ""}` : ""}</td></tr>`).join("")}</tbody></table></div>
        <p class="note">Correções criam nova versão; a original fica no histórico e na trilha de auditoria.</p>` : empty("Nenhuma operação ainda.")}</section>`;
    el.querySelector("#of").onsubmit = async e => { e.preventDefault(); const err = el.querySelector("#oerr"); err.textContent = "";
      const v = id => el.querySelector(id).value.replace(/\./g, "").replace(",", ".");
      try { await api.post("/v1/trader/trades", { ticker: el.querySelector("#ot").value.trim(), side: el.querySelector("#os").value, quantity: v("#oq"), price: v("#op"), fees: v("#ofe"),
          executed_at: el.querySelector("#od").value, strategy_id: el.querySelector("#oe").value || null }, { "Idempotency-Key": crypto.randomUUID?.() || String(Date.now()) });
        toast("Operação registrada."); VIEWS.operacoes(el); } catch (x) { err.textContent = msg(x); } };
    el.querySelectorAll("[data-edit]").forEach(b => b.onclick = () => {
      const cell = b.parentElement; cell.innerHTML = `<form class="row" style="gap:6px"><input class="input" name="p" value="${esc(b.dataset.p)}" style="max-width:90px;padding:3px 6px" aria-label="Novo preço"><input class="input" name="r" placeholder="motivo" style="max-width:120px;padding:3px 6px"><button class="btn btn--primary btn--sm">Salvar</button></form>`;
      cell.querySelector("form").onsubmit = async e => { e.preventDefault(); try { await api.put(`/v1/trader/trades/${b.dataset.edit}`, { price: e.target.p.value.replace(",", "."), reason: e.target.r.value }); toast("Nova versão registrada."); VIEWS.operacoes(el); } catch (x) { toast(msg(x)); } };
    });
    el.querySelectorAll("[data-void]").forEach(b => b.onclick = async () => { if (b.dataset.armed !== "1") { b.dataset.armed = "1"; b.textContent = "Confirmar"; return; } try { await api.del(`/v1/trader/trades/${b.dataset.void}`); toast("Operação anulada (fica no histórico)."); VIEWS.operacoes(el); } catch (x) { toast(msg(x)); } });
  },

  async estrategias(el) {
    const [s, bt] = await Promise.all([api.get("/v1/trader/strategies"), api.get("/v1/trader/backtests")]);
    el.innerHTML = `<section class="card"><h3>Strategy Lab</h3><p class="small muted" style="margin-top:4px">Descreva suas regras de estudo e, se quiser, ligue a um modelo testável no Backtest. Estratégia é hipótese de estudo — não é recomendação.</p>
      <form id="sf" class="stack" style="margin-top:12px"><div class="form-grid"><div class="field"><label for="sn">Nome</label><input class="input" id="sn" required></div>
        <div class="field"><label for="stp">Modelo testável (opcional)</label><select class="input" id="stp"><option value="">—</option>${Object.entries(bt.templates).map(([k, v]) => `<option value="${k}">${esc(v.name)}</option>`).join("")}</select></div></div>
        <div class="field"><label for="sr">Regras (texto)</label><textarea class="input" id="sr" rows="3" placeholder="Ex.: entro quando… saio quando… stop em…"></textarea></div><button class="btn btn--primary" style="align-self:flex-start">Salvar estratégia</button></form></section>
      <div class="grid g-2 section">${s.items.map(x => `<section class="card"><h3>${esc(x.name)} <button class="btn btn--ghost btn--sm right" data-sdel="${esc(x.id)}">Arquivar</button></h3>
        <p class="small" style="margin-top:6px">${esc(x.rules_text || "—")}</p>${x.template ? `<p class="small muted">Modelo: ${esc(bt.templates[x.template]?.name || x.template)} <a href="#/trader?tab=backtest&estrategia=${esc(x.id)}">testar ›</a></p>` : ""}</section>`).join("") || empty("Nenhuma estratégia.")}</div>`;
    el.querySelector("#sf").onsubmit = async e => { e.preventDefault(); try { await api.post("/v1/trader/strategies", { name: el.querySelector("#sn").value, template: el.querySelector("#stp").value || null, rules_text: el.querySelector("#sr").value }); toast("Estratégia salva."); VIEWS.estrategias(el); } catch (x) { toast(msg(x)); } };
    el.querySelectorAll("[data-sdel]").forEach(b => b.onclick = async () => { await api.del(`/v1/trader/strategies/${b.dataset.sdel}`); VIEWS.estrategias(el); });
  },

  async backtest(el, r) {
    const [bt, s] = await Promise.all([api.get("/v1/trader/backtests"), api.get("/v1/trader/strategies")]);
    const pre = s.items.find(x => x.id === r.params.get("estrategia"));
    const tpl = pre?.template || "sma_cross";
    const pf = k => Object.entries(bt.templates[k].params).map(([n, v]) => `<div class="field"><label for="bp_${n}">${esc(n)}</label><input class="input" id="bp_${n}" inputmode="numeric" value="${esc((pre?.params || {})[n] ?? v)}"></div>`).join("");
    el.innerHTML = `<section class="card"><h3>Backtest</h3><form id="bf" class="stack" style="margin-top:10px"><div class="form-grid">
        <div class="field"><label for="bt">Ativo</label><input class="input" id="bt" value="PETR4" style="text-transform:uppercase"></div>
        <div class="field"><label for="btp">Modelo</label><select class="input" id="btp">${Object.entries(bt.templates).map(([k, v]) => `<option value="${k}" ${k === tpl ? "selected" : ""}>${esc(v.name)}</option>`).join("")}</select></div>
        <div class="field"><label for="bcap">Capital inicial (R$)</label><input class="input" id="bcap" value="10000"></div>
        <div class="field"><label for="bfee">Custo por operação (%)</label><input class="input" id="bfee" value="0,03"></div>
        <div class="field"><label for="bsl">Slippage (%)</label><input class="input" id="bsl" value="0,1"></div>
        <div class="field"><label for="boos">Fora da amostra (%)</label><input class="input" id="boos" value="30"></div></div>
        <div class="form-grid" id="bparams">${pf(tpl)}</div><button class="btn btn--primary" style="align-self:flex-start">Rodar backtest</button></form><p class="err" id="berr" role="alert"></p></section>
      <div id="bres" class="section"></div>
      ${bt.items.length ? `<section class="card section"><h3>Execuções anteriores</h3><ul class="stack small" style="margin-top:8px">${bt.items.slice(0, 10).map(b => `<li class="row between"><span>${dtm(b.created_at)} · <b>${esc(b.ticker)}</b> · ${esc(b.strategy.name)} (${esc(Object.entries(b.strategy.params).map(([k, v]) => k + "=" + v).join(", "))})</span><span>${pct(b.result.total_return)} · <button class="btn btn--ghost btn--sm" data-rep="${esc(b.backtest_id)}">Reproduzir</button></span></li>`).join("")}</ul></section>` : ""}`;
    const tsel = el.querySelector("#btp"); tsel.onchange = () => { el.querySelector("#bparams").innerHTML = pf(tsel.value); };
    const n = id => +el.querySelector(id).value.replace(",", ".");
    el.querySelector("#bf").onsubmit = async e => { e.preventDefault(); const err = el.querySelector("#berr"); err.textContent = ""; const res = el.querySelector("#bres"); res.innerHTML = `<div class="skeleton" style="height:140px"></div>`;
      try {
        const params = Object.fromEntries(Object.keys(bt.templates[tsel.value].params).map(k => [k, n("#bp_" + k)]));
        const b = await api.post("/v1/trader/backtests", { ticker: el.querySelector("#bt").value.trim(), template: tsel.value, params, capital: n("#bcap"), fee_pct: n("#bfee") / 100, slippage_pct: n("#bsl") / 100, oos_share: n("#boos") / 100, strategy_id: pre?.id || null });
        const st = x => `<ul class="stack small" style="margin-top:8px"><li>Período ${dt(x.start)} a ${dt(x.end)}</li><li>Retorno <b>${pct(x.total_return)}</b> · ao ano ${pct(x.cagr)}</li><li>Drawdown máx. ${pct(x.max_drawdown)} · ${x.operations} operações · acerto ${pct(x.win_rate, 0)}</li><li>Comprar e segurar no período: ${pct(x.buy_and_hold)}</li></ul>`;
        res.innerHTML = `<div class="grid g-3"><section class="card"><h3>Período completo</h3>${st(b.result)}</section><section class="card"><h3>Dentro da amostra</h3>${st(b.in_sample)}</section><section class="card"><h3>Fora da amostra</h3>${st(b.out_of_sample)}</section></div>
          <section class="card section"><h3>Curva de capital</h3>${areaChart(b.equity_curve.map(x => x.equity), { h: 120, w: 640, label: `Curva de capital de ${brl(b.assumptions.capital)} a ${brl(b.result.final_equity)}` })}
            <p class="small" style="margin-top:8px"><b>Regra:</b> ${esc(b.strategy.rule)}</p>
            <p class="small"><b>Premissas:</b> ${esc(b.assumptions.execution)}; ${esc(b.assumptions.sizing)}; custo ${pct(b.assumptions.fee_pct, 2)} e slippage ${pct(b.assumptions.slippage_pct, 2)} por lado.</p>
            <p class="small"><b>Conjunto de dados:</b> ${esc(b.dataset.provider)} · ${esc(b.dataset.timeframe)} · ${b.dataset.bars} pregões · ${esc(b.dataset.id)} · motor ${esc(b.engine_version)} · chave ${esc(b.reproducibility_key)}</p>
            <ul class="stack small" style="margin-top:8px">${b.warnings.map(w => `<li>⚠ ${esc(w)}</li>`).join("")}</ul></section>`;
      } catch (x) { res.innerHTML = ""; err.textContent = msg(x); } };
    el.querySelectorAll("[data-rep]").forEach(b => b.onclick = async () => { try { const v = await api.get(`/v1/trader/backtests/${b.dataset.rep}/reproduce`); toast(v.reproducible ? "Reproduzido: mesmo resultado." : `Resultado diferente${v.same_dataset ? "" : " (o conjunto de dados mudou desde a execução)"}.`); } catch (x) { toast(msg(x)); } });
  },

  async performance(el) {
    const a = await api.get("/v1/trader/performance");
    if (!a.has_data) { el.innerHTML = `<section class="card">${empty("Sem operações fechadas ainda.")}</section>`; return; }
    const tbl = (title, rows) => `<section class="card"><h3>${title}</h3><div class="table-wrap"><table class="table" style="margin-top:8px"><thead><tr><th></th><th class="num">Op.</th><th class="num">Acerto</th><th class="num">Líquido</th></tr></thead><tbody>${rows.map(x => `<tr><td>${esc(x.key)}</td><td class="num">${x.trades}</td><td class="num">${pct(x.win_rate, 0)}</td><td class="num">${sign(x.net_pnl)}</td></tr>`).join("")}</tbody></table></div></section>`;
    el.innerHTML = `<div class="grid g-4">${kpi("Resultado bruto", sign(a.totals.gross_pnl))}${kpi("Custos", brl(a.totals.costs))}${kpi("Resultado líquido", sign(a.totals.net_pnl))}${kpi("Imposto estimado", brl(a.totals.tax_estimate), `após imposto: ${brl(a.totals.after_tax)}`)}</div>
      <div class="grid g-4 section">${kpi("Taxa de acerto", pct(a.win_rate, 0))}${kpi("Payoff", a.payoff == null ? "—" : a.payoff.toFixed(2).replace(".", ","), `ganho médio ${brl(a.avg_win)} · perda média ${brl(a.avg_loss)}`)}${kpi("Profit factor", a.profit_factor == null ? "—" : a.profit_factor.toFixed(2).replace(".", ","))}${kpi("Expectativa por operação", sign(a.expectancy), `sequências: ${a.streaks.max_wins} ganhos · ${a.streaks.max_losses} perdas`)}</div>
      <section class="card section"><h3>Resultado acumulado <span class="right small muted">drawdown máx. ${brl(a.max_drawdown)}</span></h3>${areaChart(a.equity_curve.map(x => x.value), { h: 120, w: 640, label: "Resultado líquido acumulado das operações fechadas" })}</section>
      <div class="grid g-2 section">${tbl("Por ativo", a.by_asset)}${tbl("Por estratégia", a.by_strategy)}${tbl("Por dia da semana", a.by_weekday)}${tbl("Por tipo / horário", [...a.by_type, ...a.by_hour.filter(x => x.key !== "—")])}</div>
      <section class="card section"><h3>Operações fechadas</h3><div class="table-wrap"><table class="table" style="margin-top:8px"><thead><tr><th>Ativo</th><th>Entrada</th><th>Saída</th><th class="num">Qtd.</th><th class="num">Bruto</th><th class="num">Custos</th><th class="num">Líquido</th><th class="num">Imposto est.</th></tr></thead>
        <tbody>${a.closed.slice(0, 100).map(x => `<tr><td><b>${esc(x.ticker)}</b> <span class="small muted">${x.daytrade ? "day trade" : "swing"} · ${x.side === "long" ? "comprado" : "vendido"}</span></td><td class="small">${dt(x.entry_date)} · ${brl(x.entry_price)}</td><td class="small">${dt(x.exit_date)} · ${brl(x.exit_price)}</td><td class="num">${num(x.quantity)}</td><td class="num">${sign(x.gross_pnl)}</td><td class="num">${brl(x.costs)}</td><td class="num">${sign(x.net_pnl)}</td><td class="num">${brl(x.tax_estimate)}</td></tr>`).join("")}</tbody></table></div>
        <ul class="stack small" style="margin-top:8px">${a.notes.map(n => `<li>${esc(n)}</li>`).join("")}</ul></section>`;
  },

  async impostos(el) {
    const t = await api.get("/v1/trader/tax");
    el.innerHTML = `<div class="grid g-3">${kpi(`Imposto do ano (${t.year})`, brl(t.total_tax_due), "apuração do Tax Engine")}${kpi("Prejuízos a compensar", brl(Object.values(t.losses_available).reduce((s, v) => s + +v, 0)))}${kpi("Qualidade", pct(t.quality?.score || 0, 0))}</div>
      <section class="card section"><h3>Impacto estimado por operação</h3>${t.per_trade.length ? `<div class="table-wrap"><table class="table" style="margin-top:8px"><thead><tr><th>Saída</th><th>Ativo</th><th>Tipo</th><th class="num">Bruto</th><th class="num">Custos</th><th class="num">Líquido</th><th class="num">Alíquota</th><th class="num">Imposto est.</th><th class="num">Após imposto</th></tr></thead>
        <tbody>${t.per_trade.map(x => `<tr><td>${dt(x.exit_date)}</td><td><b>${esc(x.ticker)}</b></td><td>${esc(x.type)}</td><td class="num">${sign(x.gross_pnl)}</td><td class="num">${brl(x.costs)}</td><td class="num">${sign(x.net_pnl)}</td><td class="num">${pct(x.tax_rate, 0)}</td><td class="num">${brl(x.tax_estimate)}</td><td class="num">${sign(x.after_tax)}</td></tr>`).join("")}</tbody></table></div>` : empty("Sem operações fechadas.")}
        <p class="note">${esc(t.note)} <a href="#/tributacao">Ver apuração mensal ›</a></p></section>`;
  },

  async risco(el) {
    const k = await api.get("/v1/trader/risk");
    el.innerHTML = `<div class="grid g-4">${kpi("Exposição em bolsa", brl(k.exposure_total))}${kpi("Maior posição", esc(k.concentration.largest || "—"), pct(k.concentration.largest_weight, 0) + " · HHI " + String(k.concentration.hhi).replace(".", ","))}
      ${kpi("VaR 95% (1 dia, soma)", brl(k.portfolio_var95_1d_sum))}${kpi("Drawdown máx. (operações)", sign(k.max_drawdown))}</div>
      <div class="grid g-4 section">${kpi("Pior dia", k.worst_day ? sign(k.worst_day.pnl) : "—", k.worst_day ? dt(k.worst_day.date) : "")}${kpi("Pior semana", k.worst_week ? sign(k.worst_week.pnl) : "—", k.worst_week ? "semana de " + dt(k.worst_week.week_of) : "")}${kpi("Operações", k.operations)}${kpi("Tamanho médio", brl(k.avg_position_size), "perda média " + brl(k.risk_per_operation))}</div>
      <section class="card section"><h3>Exposição por ativo</h3>${k.exposure.length ? `<div class="table-wrap"><table class="table" style="margin-top:8px"><thead><tr><th>Ativo</th><th class="num">Valor</th><th class="num">Peso</th><th class="num">Volatilidade anual</th><th class="num">VaR 95% 1 dia</th></tr></thead><tbody>${k.exposure.map(e => `<tr><td><b>${esc(e.ticker)}</b></td><td class="num">${brl(e.value)}</td><td class="num">${pct(e.weight)}</td><td class="num">${e.volatility_annual == null ? "—" : pct(e.volatility_annual, 0)}</td><td class="num">${e.var95_1d == null ? "—" : brl(e.var95_1d)}</td></tr>`).join("")}</tbody></table></div>` : empty("Sem posições em bolsa.")}
        <p class="note">${esc(k.method)}</p><p class="trust-line" style="margin-top:8px"><span>${esc(k.disclaimer)}</span></p></section>`;
  },

  async diario(el) {
    const [j, t] = await Promise.all([api.get("/v1/trader/journal"), api.get("/v1/trader/trades?limit=100")]);
    el.innerHTML = `<section class="card"><h3>Novo registro</h3><form id="jf" class="stack" style="margin-top:10px"><div class="form-grid">
        <div class="field"><label for="jd">Data</label><input class="input" type="date" id="jd" value="${today()}"></div>
        <div class="field"><label for="jt">Operação</label><select class="input" id="jt"><option value="">—</option>${t.items.filter(x => !x.superseded_by && x.status !== "voided").slice(0, 60).map(x => `<option value="${esc(x.id)}">${dt(x.date)} · ${esc(x.side_label)} ${esc(x.ticker)} ${num(x.quantity)}</option>`).join("")}</select></div>
        <div class="field"><label for="jg">Tags</label><input class="input" id="jg" placeholder="disciplina, ansiedade, plano"></div></div>
        <div class="field"><label for="jc">Contexto</label><textarea class="input" id="jc" rows="2"></textarea></div><div class="field"><label for="jj">Justificativa</label><textarea class="input" id="jj" rows="2"></textarea></div>
        <div class="field"><label for="jr">Resultado e observações</label><textarea class="input" id="jr" rows="2"></textarea></div><button class="btn btn--primary" style="align-self:flex-start">Salvar no journal</button></form>
        <p class="note">Para anexar um print, guarde a imagem em Documentos e cite o nome aqui.</p></section>
      <section class="card section"><h3>Journal <span class="right small muted">${j.items.length}</span></h3>${j.items.length ? `<ul class="stack" style="margin-top:10px">${j.items.map(x => `<li class="card" style="box-shadow:none"><div class="row between"><b class="small">${dt(x.date)}${x.trade_id ? " · operação vinculada" : ""}</b><span class="small muted">${esc((x.tags || []).join(", "))}</span></div>
        ${x.context ? `<p class="small" style="margin-top:6px"><b>Contexto:</b> ${esc(x.context)}</p>` : ""}${x.justification ? `<p class="small"><b>Justificativa:</b> ${esc(x.justification)}</p>` : ""}${x.observations || x.result_note ? `<p class="small"><b>Resultado:</b> ${esc(x.observations || x.result_note)}</p>` : ""}</li>`).join("")}</ul>` : empty("Nenhum registro.")}</section>`;
    el.querySelector("#jf").onsubmit = async e => { e.preventDefault(); try { await api.post("/v1/trader/journal", { date: el.querySelector("#jd").value, trade_id: el.querySelector("#jt").value || null, tags: el.querySelector("#jg").value.split(",").map(s => s.trim()).filter(Boolean),
      context: el.querySelector("#jc").value, justification: el.querySelector("#jj").value, observations: el.querySelector("#jr").value }); toast("Registro salvo."); VIEWS.diario(el); } catch (x) { toast(msg(x)); } };
  },

  async paper(el) {
    const p = await api.get("/v1/trader/paper");
    el.innerHTML = `<section class="card"><h3>Paper analysis</h3><p class="small muted" style="margin-top:4px">${esc(p.note)} Útil para estudar decisões sem dinheiro envolvido.</p>
      <form id="pf" class="row wrap" style="gap:8px;margin-top:10px"><input class="input" id="pt" placeholder="Ativo" style="max-width:110px;text-transform:uppercase"><select class="input" id="ps" style="max-width:120px"><option value="BUY">Compra</option><option value="SELL">Venda</option></select>
        <input class="input" id="pq" placeholder="Qtd." style="max-width:90px"><input class="input" id="pp" placeholder="Preço" style="max-width:100px"><input class="input" type="date" id="pd" value="${today()}" style="max-width:160px"><button class="btn btn--primary btn--sm">Registrar simulação</button></form></section>
      <div class="grid g-3 section">${kpi("Resultado simulado", sign(p.analytics.totals.net_pnl))}${kpi("Acerto", pct(p.analytics.win_rate, 0))}${kpi("Operações fechadas", p.analytics.totals.trades)}</div>
      <section class="card section"><h3>Registros</h3>${p.items.length ? `<ul class="stack small" style="margin-top:8px">${p.items.map(x => `<li class="row between"><span>${dt(x.date)} · ${x.side === "C" ? "compra" : "venda"} ${esc(x.ticker)} ${num(x.quantity)} a ${brl(x.price)}</span><button class="btn btn--ghost btn--sm" data-pdel="${esc(x.id)}">Remover</button></li>`).join("")}</ul>` : empty("Nenhuma simulação.")}</section>`;
    el.querySelector("#pf").onsubmit = async e => { e.preventDefault(); try { await api.post("/v1/trader/paper", { ticker: el.querySelector("#pt").value, side: el.querySelector("#ps").value, quantity: el.querySelector("#pq").value.replace(",", "."), price: el.querySelector("#pp").value.replace(",", "."), executed_at: el.querySelector("#pd").value }); VIEWS.paper(el); } catch (x) { toast(msg(x)); } };
    el.querySelectorAll("[data-pdel]").forEach(b => b.onclick = async () => { await api.del(`/v1/trader/paper/${b.dataset.pdel}`); VIEWS.paper(el); });
  },

  async divulgacoes(el) { const m = await import("./views_public.js"); return m.disclosuresView(el); },
  async eventos(el) { const m = await import("./views_public.js"); return m.eventsView(el); },
};
