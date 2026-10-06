/* AURION Trader Intelligence — motores puros (API e testes). "AURION não executa a operação. AURION entende a operação."
 * Nada aqui envia, cancela ou altera ordens. Indicadores, análise de operações, risco e backtest sobre dados registrados/importados. */

import { assetClassOf } from "./tax_engine.js";
export const TRADER_ENGINE_VERSION = "trader-engine@1.0.0";
const r2 = v => Math.round((+v || 0) * 100) / 100;
const day = d => String(d || "").slice(0, 10);

/* ------------------------------------------------------------------ indicadores (candles: [{date, open, high, low, close, volume}]) */
export function sma(values, n) { const out = []; let s = 0; values.forEach((v, i) => { s += v; if (i >= n) s -= values[i - n]; out.push(i >= n - 1 ? s / n : null); }); return out; }
export function rsi(values, n = 14) {
  const out = Array(values.length).fill(null); let g = 0, l = 0;
  for (let i = 1; i < values.length; i++) {
    const d = values[i] - values[i - 1], up = Math.max(d, 0), dn = Math.max(-d, 0);
    if (i <= n) { g += up; l += dn; if (i === n) { g /= n; l /= n; out[i] = l === 0 ? 100 : 100 - 100 / (1 + g / l); } }
    else { g = (g * (n - 1) + up) / n; l = (l * (n - 1) + dn) / n; out[i] = l === 0 ? 100 : 100 - 100 / (1 + g / l); }
  }
  return out;
}
export function returns(closes) { return closes.slice(1).map((c, i) => c / closes[i] - 1); }
export function volatility(closes, periods = 252) {
  const r = returns(closes); if (r.length < 2) return null;
  const m = r.reduce((s, x) => s + x, 0) / r.length, v = r.reduce((s, x) => s + (x - m) ** 2, 0) / (r.length - 1);
  return Math.sqrt(v) * Math.sqrt(periods);
}
export function maxDrawdown(curve) {
  let peak = -Infinity, mdd = 0, mddAbs = 0;
  for (const v of curve) { if (v > peak) peak = v; const dd = peak > 0 ? (v - peak) / peak : 0; if (dd < mdd) mdd = dd; if (v - peak < mddAbs) mddAbs = v - peak; }
  return { pct: mdd, abs: mddAbs };
}
export function marketSnapshot(candles) {
  const c = candles.map(x => x.close), last = candles.at(-1), prev = candles.at(-2);
  const s20 = sma(c, 20).at(-1), s50 = sma(c, 50).at(-1), r = rsi(c, 14).at(-1);
  const hi52 = Math.max(...candles.slice(-252).map(x => x.high)), lo52 = Math.min(...candles.slice(-252).map(x => x.low));
  const vol20 = candles.slice(-20).reduce((s, x) => s + (+x.volume || 0), 0) / Math.min(20, candles.length);
  return { last: last?.close ?? null, date: last?.date ?? null, change: prev ? last.close / prev.close - 1 : null, sma20: s20, sma50: s50, rsi14: r,
    high_52w: hi52, low_52w: lo52, avg_volume_20d: vol20, volatility_annual: volatility(c.slice(-253)) };
}

/* ------------------------------------------------------------------ operações → operações fechadas (FIFO, compradas e vendidas) */
const cmp = (a, b) => a < b ? -1 : a > b ? 1 : 0;   // datas ISO: ordem de código, sem colação ICU (mais barato)
export function roundTrips(trades) {
  const active = (trades || []).filter(t => !t.superseded_by && t.status !== "voided" && +t.quantity > 0);
  const sorted = [...active].sort((a, b) => cmp(a.executed_at || a.date, b.executed_at || b.date) || (a.side === "C" ? -1 : 1));
  const book = {}, closed = [];
  for (const t of sorted) {
    const tk = String(t.ticker).toUpperCase(), q0 = +t.quantity, price = (+t.value || q0 * +t.price) / q0, feePer = (+t.fees || 0) / q0;
    const lots = book[tk] || (book[tk] = []);
    let q = q0;
    const dir = t.side === "C" ? 1 : -1;
    while (q > 1e-9 && lots.length && Math.sign(lots[0].q) === -dir) {           // fecha posição oposta (FIFO)
      const lot = lots[0], m = Math.min(q, Math.abs(lot.q));
      const long = lot.q > 0, entry = lot.price, exit = price;
      const gross = (long ? exit - entry : entry - exit) * m, costs = (lot.feePer + feePer) * m;
      const ed = lot.at, xd = t.executed_at || t.date;
      closed.push({ ticker: tk, side: long ? "long" : "short", quantity: m, entry_date: day(ed), exit_date: day(xd), entry_price: r2(entry), exit_price: r2(exit),
        gross_pnl: r2(gross), costs: r2(costs), net_pnl: r2(gross - costs), holding_days: Math.round((Date.parse(day(xd)) - Date.parse(day(ed))) / 864e5),
        daytrade: day(ed) === day(xd), strategy_id: t.strategy_id || lot.strategy_id || null, exit_time: (t.executed_at || "").slice(11, 16) || null, source: t.source || lot.source });
      lot.q -= Math.sign(lot.q) * m; q -= m;
      if (Math.abs(lot.q) < 1e-9) lots.shift();
    }
    if (q > 1e-9) lots.push({ q: dir * q, price, feePer, at: t.executed_at || t.date, strategy_id: t.strategy_id || null, source: t.source });
  }
  const open = Object.entries(book).filter(([, l]) => l.length).map(([tk, l]) => {
    const q = l.reduce((s, x) => s + x.q, 0), cost = l.reduce((s, x) => s + x.q * x.price, 0);
    return { ticker: tk, quantity: q, side: q > 0 ? "long" : "short", avg_price: r2(cost / q) };
  });
  return { closed: closed.sort((a, b) => cmp(a.exit_date, b.exit_date)), open };
}

/* ------------------------------------------------------------------ Trade Analytics (v5.0 §12.1) */
const WD = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];
export function tradeAnalytics(trades, { tax = null, strategies = [] } = {}) {
  const { closed, open } = roundTrips(trades);
  const sum = (a, k) => a.reduce((s, x) => s + +x[k], 0);
  const wins = closed.filter(x => x.net_pnl > 0), losses = closed.filter(x => x.net_pnl < 0);
  const avgW = wins.length ? sum(wins, "net_pnl") / wins.length : 0, avgL = losses.length ? -sum(losses, "net_pnl") / losses.length : 0;
  let cum = 0; const curve = [0, ...closed.map(x => (cum += x.net_pnl))];
  const dd = maxDrawdown(curve.map(v => v + 1e6));                             // curva em valor absoluto sobre base fixa
  let streak = 0, bestW = 0, bestL = 0;
  for (const x of closed) { streak = x.net_pnl > 0 ? (streak > 0 ? streak + 1 : 1) : x.net_pnl < 0 ? (streak < 0 ? streak - 1 : -1) : 0; bestW = Math.max(bestW, streak); bestL = Math.min(bestL, streak); }
  const group = key => { const g = {}; closed.forEach(x => { const k = key(x) ?? "—"; (g[k] = g[k] || []).push(x); });
    return Object.entries(g).map(([k, l]) => ({ key: k, trades: l.length, net_pnl: r2(sum(l, "net_pnl")), win_rate: l.filter(x => x.net_pnl > 0).length / l.length })).sort((a, b) => b.net_pnl - a.net_pnl); };
  const sname = Object.fromEntries(strategies.map(s => [s.id, s.name]));
  // impacto tributário estimado por operação: alíquota da modalidade, isenção do mês para ações comuns (estimativa, não valor final)
  const monthExempt = Object.fromEntries((tax?.months || []).map(m => [m.month, m.exempt]));
  closed.forEach(x => {
    const cls = assetClassOf(x.ticker).cls;
    const rate = x.daytrade ? 0.2 : cls === "fii" ? 0.2 : 0.15;
    const exempt = !x.daytrade && cls === "acao" && monthExempt[x.exit_date.slice(0, 7)];
    x.tax_estimate = r2(x.net_pnl > 0 && !exempt ? x.net_pnl * rate : 0); x.tax_rate = exempt ? 0 : rate; x.after_tax = r2(x.net_pnl - x.tax_estimate);
  });
  return {
    has_data: closed.length > 0 || open.length > 0, engine_version: TRADER_ENGINE_VERSION,
    totals: { trades: closed.length, gross_pnl: r2(sum(closed, "gross_pnl")), costs: r2(sum(closed, "costs")), net_pnl: r2(sum(closed, "net_pnl")),
      tax_estimate: r2(sum(closed, "tax_estimate")), after_tax: r2(sum(closed, "after_tax")), tax_engine_year_due: tax ? +tax.total_tax_due : null },
    win_rate: closed.length ? wins.length / closed.length : 0, payoff: avgL ? avgW / avgL : null,
    profit_factor: losses.length ? sum(wins, "net_pnl") / -sum(losses, "net_pnl") : (wins.length ? null : 0),
    expectancy: closed.length ? sum(closed, "net_pnl") / closed.length : 0, avg_win: r2(avgW), avg_loss: r2(avgL),
    max_drawdown: r2(dd.abs), streaks: { max_wins: bestW, max_losses: -bestL },
    equity_curve: closed.map((x, i) => ({ date: x.exit_date, value: r2(curve[i + 1]) })),
    by_asset: group(x => x.ticker), by_strategy: group(x => x.strategy_id ? sname[x.strategy_id] || x.strategy_id : "sem estratégia"),
    by_weekday: group(x => WD[new Date(x.exit_date + "T12:00:00Z").getUTCDay()]), by_hour: group(x => x.exit_time ? x.exit_time.slice(0, 2) + "h" : null),
    by_type: group(x => x.daytrade ? "day trade" : "swing"),
    closed: [...closed].reverse(), open,
    notes: ["Resultado bruto, custos, resultado líquido e impacto tributário estimado aparecem separados; o valor tributário definitivo é o da Tributação (Tax Engine).",
      "Operações casadas por FIFO por ativo; vendas a descoberto são tratadas como operações vendidas."],
  };
}

/* ------------------------------------------------------------------ Risk Analytics (v5.0 §14.3) — informa e monitora; não autoriza nem executa */
export function riskAnalytics({ positions = [], analytics, candlesBy = {} }) {
  const rv = positions.filter(p => ["acao", "fii", "etf", "bdr"].includes(p.asset_class));
  const total = rv.reduce((s, p) => s + +p.value, 0);
  const exposure = rv.map(p => { const c = candlesBy[p.ticker]; const vol = c ? volatility(c.slice(-253).map(x => x.close)) : null;
    return { ticker: p.ticker || p.name, value: r2(p.value), weight: total ? +p.value / total : 0, volatility_annual: vol, var95_1d: vol != null ? r2(+p.value * vol / Math.sqrt(252) * 1.645) : null }; })
    .sort((a, b) => b.value - a.value);
  const byDay = {}; (analytics?.closed || []).forEach(x => { byDay[x.exit_date] = (byDay[x.exit_date] || 0) + x.net_pnl; });
  const days = Object.entries(byDay).sort(), worstDay = days.reduce((m, [d, v]) => v < m.v ? { d, v } : m, { d: null, v: 0 });
  const week = d => { const x = new Date(d + "T12:00:00Z"); x.setUTCDate(x.getUTCDate() - ((x.getUTCDay() + 6) % 7)); return x.toISOString().slice(0, 10); };
  const byWeek = {}; days.forEach(([d, v]) => { byWeek[week(d)] = (byWeek[week(d)] || 0) + v; });
  const worstWeek = Object.entries(byWeek).reduce((m, [d, v]) => v < m.v ? { d, v } : m, { d: null, v: 0 });
  const closed = analytics?.closed || [];
  const hhi = exposure.reduce((s, e) => s + e.weight ** 2, 0);
  return { exposure_total: r2(total), exposure, concentration: { largest: exposure[0]?.ticker || null, largest_weight: exposure[0]?.weight || 0, hhi: Math.round(hhi * 1000) / 1000 },
    portfolio_var95_1d_sum: r2(exposure.reduce((s, e) => s + (e.var95_1d || 0), 0)),
    worst_day: worstDay.d ? { date: worstDay.d, pnl: r2(worstDay.v) } : null, worst_week: worstWeek.d ? { week_of: worstWeek.d, pnl: r2(worstWeek.v) } : null,
    operations: closed.length, avg_position_size: closed.length ? r2(closed.reduce((s, x) => s + x.quantity * x.entry_price, 0) / closed.length) : 0,
    risk_per_operation: analytics?.avg_loss || 0, max_drawdown: analytics?.max_drawdown || 0,
    method: "Volatilidade anualizada pelo desvio dos retornos diários (até 252 pregões). VaR 95% de 1 dia paramétrico por ativo, somado sem diversificação (visão conservadora).",
    disclaimer: "Risk Analytics informa e monitora; não autoriza, envia ou executa ordens." };
}

/* ------------------------------------------------------------------ Backtest (v5.0 §13; v6.0 §17) */
export const STRATEGY_TEMPLATES = {
  sma_cross: { name: "Cruzamento de médias", params: { fast: 9, slow: 21 }, describe: p => `Compra quando a média de ${p.fast} cruza acima da de ${p.slow}; sai quando cruza abaixo.` },
  breakout: { name: "Rompimento de máxima", params: { entry: 20, exit: 10 }, describe: p => `Compra quando o fechamento supera a máxima de ${p.entry} pregões; sai abaixo da mínima de ${p.exit}.` },
  rsi_reversion: { name: "Reversão por IFR", params: { period: 14, buy_below: 30, sell_above: 55 }, describe: p => `Compra com IFR(${p.period}) abaixo de ${p.buy_below}; sai acima de ${p.sell_above}.` },
};
function signals(template, p, candles) {
  const c = candles.map(x => x.close), want = Array(candles.length).fill(null);   // true = quer estar comprado após este pregão
  if (template === "sma_cross") { const f = sma(c, +p.fast), s = sma(c, +p.slow); for (let i = 1; i < c.length; i++) if (f[i] != null && s[i] != null && f[i - 1] != null && s[i - 1] != null) { if (f[i - 1] <= s[i - 1] && f[i] > s[i]) want[i] = true; if (f[i - 1] >= s[i - 1] && f[i] < s[i]) want[i] = false; } }
  if (template === "breakout") for (let i = +p.entry; i < c.length; i++) { const hi = Math.max(...candles.slice(i - +p.entry, i).map(x => x.high)), lo = Math.min(...candles.slice(Math.max(0, i - +p.exit), i).map(x => x.low)); if (c[i] > hi) want[i] = true; else if (c[i] < lo) want[i] = false; }
  if (template === "rsi_reversion") { const r = rsi(c, +p.period); for (let i = 0; i < c.length; i++) if (r[i] != null) { if (r[i] < +p.buy_below) want[i] = true; else if (r[i] > +p.sell_above) want[i] = false; } }
  return want;
}
function simulate(candles, want, { capital, fee_fixed, fee_pct, slippage_pct }) {
  let cash = capital, qty = 0, entry = null; const trades = [], curve = [];
  for (let i = 0; i < candles.length; i++) {
    // sinal do pregão anterior executa na abertura deste (sem olhar o futuro)
    const sig = i > 0 ? want[i - 1] : null, bar = candles[i];
    if (sig === true && qty === 0) {
      const px = bar.open * (1 + slippage_pct), q = Math.floor((cash - fee_fixed) / (px * (1 + fee_pct)));
      if (q > 0) { const cost = q * px * (1 + fee_pct) + fee_fixed; cash -= cost; qty = q; entry = { date: bar.date, price: px, cost }; }
    } else if (sig === false && qty > 0) {
      const px = bar.open * (1 - slippage_pct), got = qty * px * (1 - fee_pct) - fee_fixed;
      trades.push({ entry_date: entry.date, exit_date: bar.date, entry_price: r2(entry.price), exit_price: r2(px), quantity: qty, pnl: r2(got - entry.cost), return: got / entry.cost - 1 });
      cash += got; qty = 0; entry = null;
    }
    curve.push({ date: bar.date, equity: r2(cash + qty * bar.close) });
  }
  if (qty > 0) { const bar = candles.at(-1), px = bar.close * (1 - slippage_pct), got = qty * px * (1 - fee_pct) - fee_fixed;
    trades.push({ entry_date: entry.date, exit_date: bar.date, entry_price: r2(entry.price), exit_price: r2(px), quantity: qty, pnl: r2(got - entry.cost), return: got / entry.cost - 1, open_at_end: true }); }
  return { trades, curve };
}
function stats(trades, curve, capital, candles) {
  const end = curve.at(-1)?.equity ?? capital, years = Math.max((Date.parse(candles.at(-1).date) - Date.parse(candles[0].date)) / (365.25 * 864e5), 1 / 365);
  const wins = trades.filter(t => t.pnl > 0), loss = trades.filter(t => t.pnl < 0);
  const inMkt = curve.length ? trades.reduce((s, t) => s + candles.filter(c => c.date >= t.entry_date && c.date <= t.exit_date).length, 0) / curve.length : 0;
  return { start: candles[0].date, end: candles.at(-1).date, final_equity: r2(end), total_return: end / capital - 1, cagr: (end / capital) ** (1 / years) - 1,
    max_drawdown: maxDrawdown(curve.map(c => c.equity)).pct, operations: trades.length, win_rate: trades.length ? wins.length / trades.length : 0,
    profit_factor: loss.length ? wins.reduce((s, t) => s + t.pnl, 0) / -loss.reduce((s, t) => s + t.pnl, 0) : null, exposure: inMkt,
    buy_and_hold: candles.at(-1).close / candles[0].open - 1 };
}
function fnv(s) { let h = 0x811c9dc5; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619) >>> 0; return h.toString(16).padStart(8, "0"); }
export function datasetVersion(candles) { return "ds_" + fnv(JSON.stringify(candles.map(c => [c.date, c.open, c.high, c.low, c.close]))) + fnv(String(candles.length) + candles[0]?.date + candles.at(-1)?.date); }

export function runBacktest({ ticker, candles, template, params = {}, capital = 10000, fee_fixed = 0, fee_pct = 0.0003, slippage_pct = 0.001, oos_share = 0.3, dataset }) {
  if (!STRATEGY_TEMPLATES[template]) throw Object.assign(new Error("Modelo de estratégia desconhecido."), { status: 422 });
  if (!candles || candles.length < 60) throw Object.assign(new Error("Histórico insuficiente (mínimo de 60 pregões)."), { status: 422 });
  const p = { ...STRATEGY_TEMPLATES[template].params, ...Object.fromEntries(Object.entries(params).filter(([k]) => k in STRATEGY_TEMPLATES[template].params).map(([k, v]) => [k, +v])) };
  if (Object.values(p).some(v => !(v > 0) || v > 400)) throw Object.assign(new Error("Parâmetros fora da faixa permitida (1 a 400)."), { status: 422 });
  const cfg = { capital: +capital, fee_fixed: +fee_fixed, fee_pct: +fee_pct, slippage_pct: +slippage_pct };
  const cut = Math.floor(candles.length * (1 - oos_share));
  const run = cs => { const w = signals(template, p, cs); const s = simulate(cs, w, cfg); return { ...s, stats: stats(s.trades, s.curve, cfg.capital, cs) }; };
  const full = run(candles), ins = run(candles.slice(0, cut)), oos = run(candles.slice(cut));
  const ds = dataset || { id: datasetVersion(candles), ticker, provider: "Yahoo Finance", timeframe: "1d", bars: candles.length, from: candles[0].date, to: candles.at(-1).date };
  const key = fnv(JSON.stringify({ template, p, cfg, ds: ds.id, v: TRADER_ENGINE_VERSION, oos_share }));
  return { backtest_id: "bt_" + key + fnv(key + ds.id), ticker, strategy: { template, name: STRATEGY_TEMPLATES[template].name, params: p, rule: STRATEGY_TEMPLATES[template].describe(p) },
    dataset: ds, assumptions: { ...cfg, execution: "sinal no fechamento, execução na abertura do pregão seguinte (sem olhar o futuro)", sizing: "100% do capital disponível, só compra (long)", oos_share },
    result: full.stats, in_sample: ins.stats, out_of_sample: oos.stats, trades: full.trades, equity_curve: full.curve.filter((_, i, a) => i % Math.ceil(a.length / 300) === 0 || i === a.length - 1),
    engine_version: TRADER_ENGINE_VERSION, reproducibility_key: key,
    warnings: ["Resultado passado não garante resultado futuro.", "Não é recomendação de compra ou venda.", "Viés de sobrevivência não controlado: o histórico é do ativo escolhido hoje.",
      oos.stats.total_return < ins.stats.total_return - 0.1 ? "Desempenho fora da amostra bem pior que dentro da amostra: sinal de sobreajuste." : "Compare sempre dentro e fora da amostra; não otimize parâmetros no mesmo período que valida."] };
}

/* ------------------------------------------------------------------ Radar Trader (v5.0 §21.2): pontos de atenção sobre as próprias operações.
 * Descreve fatos do histórico e prazos; não sugere entrar, sair ou ajustar posição. */
export function traderRadar({ analytics, tax = null, journal = [], refDate }) {
  const out = [], push = (id, severity, title, detail, action = null) => out.push({ id: "trd_" + id, severity, title, detail, action });
  const brl = v => "R$ " + (+v || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  for (const m of tax?.months || []) {
    const d = m.darf; if (!d || d.status === "pago") continue;
    if (d.status === "vencido") push("darf_" + d.competencia, "critico", `DARF ${d.competencia.split("-").reverse().join("/")} vencido`, `Valor estimado ${brl(d.valor)}, venceu em ${d.vencimento.split("-").reverse().join("/")}. Pagamento em atraso tem multa e juros.`, { label: "Ver apuração", route: "/tributacao" });
    else if (d.dias_para_vencimento <= 10) push("darf_" + d.competencia, "alto", `DARF vence em ${d.dias_para_vencimento} dia(s)`, `Valor estimado ${brl(d.valor)} (competência ${d.competencia.split("-").reverse().join("/")}).`, { label: "Ver apuração", route: "/tributacao" });
  }
  const closed = [...(analytics?.closed || [])].sort((a, b) => cmp(a.exit_date, b.exit_date));
  let cur = 0; for (let i = closed.length - 1; i >= 0 && closed[i].net_pnl < 0; i--) cur++;
  if (cur >= 3) push("streak", "atencao", `${cur} operações seguidas com prejuízo`, "Sequência atual de resultados negativos nas operações registradas. Revise o journal e as regras da estratégia.", { label: "Abrir journal", route: "/trader?tab=diario" });
  const curve = analytics?.equity_curve || [];
  if (curve.length) { const peak = Math.max(0, ...curve.map(x => +x.value)), last = +curve.at(-1).value, dd = last - peak;
    if (dd < 0 && Math.abs(dd) >= 2 * (+analytics.avg_loss || Infinity)) push("drawdown", "atencao", "Resultado abaixo do pico", `O resultado acumulado está ${brl(-dd)} abaixo do melhor momento.`, { label: "Ver performance", route: "/trader?tab=performance" }); }
  const t = analytics?.totals || {};
  if (+t.costs > 0 && Math.abs(+t.gross_pnl) > 0 && +t.costs / Math.abs(+t.gross_pnl) >= 0.3)
    push("custos", "atencao", "Custos relevantes", +t.costs > Math.abs(+t.gross_pnl) ? `Corretagem e emolumentos somam ${brl(t.costs)}, mais que o resultado bruto de ${brl(t.gross_pnl)}.` : `Corretagem e emolumentos somam ${brl(t.costs)}, ${Math.round(+t.costs / Math.abs(+t.gross_pnl) * 100)}% do resultado bruto.`, { label: "Ver operações", route: "/trader?tab=operacoes" });
  const la = tax?.losses_available || {}, totalLoss = (+la.comum || 0) + (+la.daytrade || 0) + (+la.fii || 0);
  if (totalLoss > 0) push("prejuizo", "informativo", "Prejuízo a compensar", `Saldo de prejuízo acumulado: comum ${brl(la.comum)}, day trade ${brl(la.daytrade)}, FII ${brl(la.fii)}. Ele reduz o imposto de ganhos futuros da mesma modalidade.`, { label: "Ver apuração", route: "/tributacao" });
  const noStrat = closed.filter(x => !x.strategy_id).length;
  if (closed.length >= 5 && noStrat / closed.length > 0.5) push("estrategia", "informativo", "Operações sem estratégia", `${noStrat} de ${closed.length} operações encerradas não estão ligadas a uma estratégia; a comparação por estratégia fica incompleta.`, { label: "Estratégias", route: "/trader?tab=estrategias" });
  const since = new Date(Date.parse(refDate) - 30 * 864e5).toISOString().slice(0, 10);
  const recent = closed.filter(x => x.exit_date >= since).length, notes = journal.filter(j => !j.archived && (j.date || "") >= since).length;
  if (recent >= 3 && notes === 0) push("journal", "informativo", "Journal sem registros recentes", `${recent} operações encerradas nos últimos 30 dias e nenhum registro no journal.`, { label: "Abrir journal", route: "/trader?tab=diario" });
  const order = { critico: 0, alto: 1, atencao: 2, informativo: 3 };
  return { items: out.sort((a, b) => order[a.severity] - order[b.severity]), ref_date: refDate, engine_version: TRADER_ENGINE_VERSION,
    note: "Fatos sobre o seu histórico e prazos. Não é recomendação de compra, venda ou ajuste de posição." };
}
