/* AURION Trader Intelligence (API). Registro e análise de operações, estratégias, diário, watchlists, mercado,
 * backtest, paper analysis e risco. NÃO existe rota de envio, cancelamento ou alteração de ordens (ADR-0009).
 * O mesmo TradeRecord (fin_items kind "trade") alimenta Finanças, Tributação e Trader — sem recadastro. */
import { Resp, Problem, nowIso, today, randomToken, sha256, kvGet, kvSet, str, numOrNull, isoDate, ageH } from "./shared.js";
import { audit } from "./identity.js";
import { tradeAnalytics, riskAnalytics, runBacktest, marketSnapshot, STRATEGY_TEMPLATES, TRADER_ENGINE_VERSION, traderRadar } from "../../apps/web/app/js/trader_engine.js";
import { isB3Ticker } from "../../apps/web/app/js/market.js";

export const TRADER_SCHEMA = ["CREATE TABLE IF NOT EXISTS candles (ticker TEXT PRIMARY KEY, data TEXT NOT NULL, fetched_at TEXT NOT NULL, provider TEXT, dataset TEXT)"];
const id = p => p + "_" + randomToken(9).replace(/[-_]/g, "").slice(0, 12);

/* ------------------------------------------------------------------ dados de mercado: candles diários (adapter → mapper → normalizer → cache) */
export function parseYahooCandles(json, ticker) {
  const r = json?.chart?.result?.[0];
  if (!r) throw new Error(json?.chart?.error?.description || `Sem histórico para ${ticker}`);
  const q = r.indicators?.quote?.[0] || {}, ts = r.timestamp || [];
  const out = ts.map((t, i) => ({ date: new Date((t - 3 * 3600) * 1000).toISOString().slice(0, 10), open: q.open?.[i], high: q.high?.[i], low: q.low?.[i], close: q.close?.[i], volume: q.volume?.[i] ?? 0 }))
    .filter(c => [c.open, c.high, c.low, c.close].every(v => v != null && isFinite(v) && v > 0))
    .map(c => ({ ...c, open: +(+c.open).toFixed(4), high: +(+c.high).toFixed(4), low: +(+c.low).toFixed(4), close: +(+c.close).toFixed(4) }));
  const dedup = []; for (const c of out) { if (dedup.length && dedup.at(-1).date === c.date) dedup[dedup.length - 1] = c; else dedup.push(c); }
  return dedup;
}
export async function getCandles(env, db, ticker, { force = false } = {}) {
  const t = String(ticker || "").toUpperCase();
  if (!isB3Ticker(t)) throw new Problem(422, "Ativo inválido", "Use o código de negociação da B3 (ex.: PETR4).");
  const row = await db.prepare("SELECT data, fetched_at, provider, dataset FROM candles WHERE ticker=?").bind(t).first();
  if (row && !force && ageH(row.fetched_at) < 6) return { ticker: t, candles: JSON.parse(row.data), fetched_at: row.fetched_at, provider: row.provider, dataset: row.dataset, cached: true };
  try {
    const base = (env.YAHOO_BASE_URL || "https://query1.finance.yahoo.com").replace(/\/$/, "");
    const r = await fetch(`${base}/v8/finance/chart/${encodeURIComponent(t)}.SA?range=2y&interval=1d`, { headers: { "User-Agent": "Mozilla/5.0 (compatible; AurionBot/1.0)" }, signal: AbortSignal.timeout(12000) });
    if (!r.ok) throw new Error("HTTP " + r.status);
    const candles = parseYahooCandles(await r.json(), t);
    if (candles.length < 2) throw new Error("histórico vazio");
    const dataset = "ds_" + (await sha256(JSON.stringify(candles))).slice(0, 16);
    await db.prepare("INSERT INTO candles (ticker,data,fetched_at,provider,dataset) VALUES (?,?,?,?,?) ON CONFLICT(ticker) DO UPDATE SET data=excluded.data, fetched_at=excluded.fetched_at, provider=excluded.provider, dataset=excluded.dataset")
      .bind(t, JSON.stringify(candles), nowIso(), "Yahoo Finance", dataset).run();
    return { ticker: t, candles, fetched_at: nowIso(), provider: "Yahoo Finance", dataset, cached: false };
  } catch (e) {
    if (row) return { ticker: t, candles: JSON.parse(row.data), fetched_at: row.fetched_at, provider: row.provider, dataset: row.dataset, cached: true, stale: true, error: e.message };   // falha não apaga o último estado válido
    throw new Problem(503, "Mercado indisponível", `Não foi possível obter o histórico de ${t} agora (${e.message}). Tente mais tarde.`);
  }
}

/* ------------------------------------------------------------------ rotas */
export async function traderRoute(m, p, body, q, req, u, db, env, D) {
  const uid = u.me.id;
  const ents = u.me.entitlements || [];
  if (!ents.includes("inteligencia_tributaria")) throw new Problem(402, "Recurso do plano Pro", "O Trader Intelligence faz parte dos planos Pro e Premium.", { required_plan: "Pro" });
  const A = (action, o = {}) => audit(db, req, { user_id: uid, actor: uid, action, ...o });
  const load = kind => D.finLoad(db, uid, kind);
  const put = (kind, rid, data, imp = "manual") => db.prepare("INSERT INTO fin_items (user_id,kind,id,import_id,data) VALUES (?,?,?,?,?) ON CONFLICT(user_id,kind,id) DO UPDATE SET data=excluded.data, import_id=excluded.import_id").bind(uid, kind, rid, imp, JSON.stringify(data)).run();
  const getOne = async (kind, rid) => { const r = await db.prepare("SELECT import_id, data FROM fin_items WHERE user_id=? AND kind=? AND id=?").bind(uid, kind, rid).first(); if (!r) throw new Problem(404, "Não encontrado", rid); return { import_id: r.import_id, ...JSON.parse(r.data), id: rid }; };
  const active = ts => ts.filter(t => !t.superseded_by && t.status !== "voided");

  /* ---- operações (TradeRecord) */
  if (p === "/v1/trader/trades" && m === "GET") {
    const all = (await load("trade")).sort((a, b) => (b.executed_at || b.date).localeCompare(a.executed_at || a.date));
    return { items: all.slice(0, Math.min(+q.limit || 300, 2000)).map(t => ({ ...t, side_label: t.side === "C" ? "Compra" : "Venda", origin: t.import_id === "manual" ? "manual" : "importada" })), total: all.length };
  }
  const tradeInput = b => {
    const side = { BUY: "C", SELL: "V", C: "C", V: "V" }[String(b.side || "").toUpperCase()];
    const ticker = str(b.ticker || b.asset_id, 20).toUpperCase().trim(), quantity = numOrNull(b.quantity), price = numOrNull(b.price), fees = numOrNull(b.fees) ?? 0;
    const at = String(b.executed_at || b.date || ""), date = isoDate(at.slice(0, 10));
    const errs = [];
    if (!side) errs.push({ field: "side", msg: "Lado deve ser compra (BUY) ou venda (SELL)" });
    if (!isB3Ticker(ticker)) errs.push({ field: "ticker", msg: "Código de negociação inválido" });
    if (!(quantity > 0)) errs.push({ field: "quantity", msg: "Quantidade deve ser positiva" });
    if (!(price > 0)) errs.push({ field: "price", msg: "Preço deve ser positivo" });
    if (fees < 0) errs.push({ field: "fees", msg: "Custos não podem ser negativos" });
    if (!date || date > today()) errs.push({ field: "executed_at", msg: "Data inválida ou futura" });
    if (errs.length) throw new Problem(422, "Dados inválidos", "Operação inválida.", { errors: errs });
    return { date, executed_at: /T\d{2}:\d{2}/.test(at) ? at.slice(0, 19) : date, ticker, side, quantity, price, value: Math.round(quantity * price * 100) / 100, fees,
      strategy_id: str(b.strategy_id, 40) || null, tags: (b.tags || []).slice(0, 10).map(x => str(x, 30)), note: str(b.note, 300) || null, daytrade: b.daytrade === true || undefined,
      market: str(b.market, 40) || "vista", custodian: str(b.custodian, 80) || "", source: "manual", confidence: 1 };
  };
  if (p === "/v1/trader/trades" && m === "POST") {
    const key = req.headers.get("Idempotency-Key");
    if (!key || key.length < 8 || key.length > 80) throw new Problem(400, "Idempotency-Key obrigatório", "Envie o cabeçalho Idempotency-Key em registros de operação.");
    const prev = await kvGet(db, `idem:${uid}:${key}`);
    if (prev) return new Resp(200, { ...prev, meta: { ...prev.meta, replayed: true } });
    const t = { ...tradeInput(body), version: 1, recorded_at: nowIso() };
    const tid = id("trd");
    await put("trade", tid, t);
    const out = { data: { trade_id: tid, status: "RECORDED", tax_analysis_status: "COMPUTED" }, meta: { trace_id: null } };
    await kvSet(db, `idem:${uid}:${key}`, out);
    await A("trader.operacao_registrada", { resource: "trade", entity_id: tid, meta: { ativo: t.ticker, lado: t.side, quantidade: t.quantity, preco: t.price } });
    return new Resp(201, out);
  }
  const tm = p.match(/^\/v1\/trader\/trades\/([A-Za-z0-9_-]+)$/);
  if (tm && (m === "PUT" || m === "DELETE")) {
    const old = await getOne("trade", tm[1]);
    if (old.superseded_by || old.status === "voided") throw new Problem(409, "Versão antiga", "Esta operação já foi substituída ou anulada.");
    if (old.import_id !== "manual" && m === "DELETE") throw new Problem(409, "Operação importada", "Operações importadas saem apagando a importação de origem (Importar dados).");
    const { id: _i, import_id, ...oldData } = old;
    if (m === "DELETE") {
      await put("trade", tm[1], { ...oldData, status: "voided", voided_at: nowIso() }, import_id);
      await A("trader.operacao_anulada", { resource: "trade", entity_id: tm[1] });
      return new Resp(204);
    }
    const t = { ...tradeInput({ ...oldData, ...body, side: body.side || oldData.side }), version: (oldData.version || 1) + 1, previous_id: tm[1], recorded_at: nowIso(), correction_reason: str(body.reason, 200) || null };
    if (import_id !== "manual") t.source = (oldData.source || "importação") + " (corrigida)";
    const nid = id("trd");
    await db.batch([db.prepare("INSERT INTO fin_items (user_id,kind,id,import_id,data) VALUES (?,?,?,?,?)").bind(uid, "trade", nid, import_id === "manual" ? "manual" : import_id, JSON.stringify(t)),
      db.prepare("UPDATE fin_items SET data=? WHERE user_id=? AND kind='trade' AND id=?").bind(JSON.stringify({ ...oldData, superseded_by: nid, superseded_at: nowIso() }), uid, tm[1])]);
    await A("trader.operacao_corrigida", { resource: "trade", entity_id: nid, meta: { substitui: tm[1], versao: t.version, motivo: t.correction_reason } });
    return { data: { trade_id: nid, previous_id: tm[1], version: t.version, status: "RECORDED", tax_analysis_status: "RECOMPUTED" } };
  }

  /* ---- estratégias, diário, watchlists (CRUD simples, sempre do próprio titular) */
  const crud = async (kind, path, shape, label) => {
    if (p === path && m === "GET") return { items: (await load(kind)).filter(x => !x.archived).sort((a, b) => (b.updated_at || b.created_at).localeCompare(a.updated_at || a.created_at)) };
    if (p === path && m === "POST") { const x = { ...shape(body), created_at: nowIso() }; const xid = id(kind.slice(0, 3)); await put(kind, xid, x); await A(`trader.${label}_criado`, { resource: kind, entity_id: xid }); return new Resp(201, { id: xid, ...x }); }
    const mm = p.match(new RegExp(`^${path.replace(/\//g, "\\/")}\\/([A-Za-z0-9_-]+)$`));
    if (mm) {
      const cur = await getOne(kind, mm[1]); const { id: _x, import_id, ...data } = cur;
      if (m === "PUT") { const x = { ...data, ...shape({ ...data, ...body }), updated_at: nowIso() }; await put(kind, mm[1], x); await A(`trader.${label}_alterado`, { resource: kind, entity_id: mm[1] }); return { id: mm[1], ...x }; }
      if (m === "DELETE") { await put(kind, mm[1], { ...data, archived: true, archived_at: nowIso() }); await A(`trader.${label}_arquivado`, { resource: kind, entity_id: mm[1] }); return new Resp(204); }
      if (m === "GET") return cur;
    }
    return null;
  };
  const strategyShape = b => { const name = str(b.name, 80).trim(); if (!name) throw new Problem(422, "Dados inválidos", "Dê um nome à estratégia.");
    return { name, description: str(b.description, 1000), rules_text: str(b.rules_text, 2000), template: STRATEGY_TEMPLATES[b.template] ? b.template : null,
      params: b.params && typeof b.params === "object" ? Object.fromEntries(Object.entries(b.params).slice(0, 8).map(([k, v]) => [str(k, 20), numOrNull(v)])) : {}, tags: (b.tags || []).slice(0, 10).map(x => str(x, 30)) }; };
  const journalShape = b => ({ date: isoDate(b.date) || today(), trade_id: str(b.trade_id, 40) || null, strategy_id: str(b.strategy_id, 40) || null, context: str(b.context, 2000),
    justification: str(b.justification, 2000), result_note: str(b.result_note, 1000), observations: str(b.observations, 2000), screenshot_doc_id: str(b.screenshot_doc_id, 40) || null,
    tags: (b.tags || []).slice(0, 10).map(x => str(x, 30)), mood: str(b.mood, 30) || null });
  const watchShape = b => { const name = str(b.name, 60).trim() || "Minha lista";
    const tickers = [...new Set((b.tickers || []).map(x => String(x).toUpperCase().trim()).filter(isB3Ticker))].slice(0, 40); return { name, tickers }; };
  for (const [kind, path, shape, label] of [["strategy", "/v1/trader/strategies", strategyShape, "estrategia"], ["journal", "/v1/trader/journal", journalShape, "diario"], ["watchlist", "/v1/trader/watchlists", watchShape, "watchlist"]]) {
    if (p === path || p.startsWith(path + "/")) {
      const r = await crud(kind, path, shape, label);
      if (r) {
        if (kind === "watchlist" && p === path && m === "GET") {       // cotações dos ativos acompanhados (busca até 5 faltantes por chamada)
          const tick = [...new Set(r.items.flatMap(w => w.tickers))];
          const quotes = await D.loadQuotes(db, tick);
          for (const t of tick.filter(t => !quotes[t]).slice(0, 5)) { try { const c = await getCandles(env, db, t); const last = c.candles.at(-1), prev = c.candles.at(-2);
            quotes[t] = { close: last.close, prev_close: prev?.close ?? null, date: last.date, source: c.provider }; } catch { /* sem cotação agora */ } }
          r.items.forEach(w => { w.quotes = w.tickers.map(t => ({ ticker: t, ...(quotes[t] || {}), change: quotes[t]?.prev_close ? quotes[t].close / quotes[t].prev_close - 1 : null })); });
          r.note = "Lista criada por você. O AURION não sugere quais ativos acompanhar.";
        }
        return r;
      }
    }
  }

  /* ---- mercado */
  if (p === "/v1/trader/market" && m === "GET") {
    const c = await getCandles(env, db, q.ticker);
    const range = { "3m": 63, "6m": 126, "1y": 252, "2y": 504 }[q.range || "1y"] || 252;
    return { ticker: c.ticker, provider: c.provider, fetched_at: c.fetched_at, dataset: c.dataset, stale: !!c.stale, timeframe: "1d", candles: c.candles.slice(-range), snapshot: marketSnapshot(c.candles),
      note: "Cotações de fechamento com atraso; fonte e horário da coleta informados. Informação, não recomendação." };
  }

  /* ---- performance, risco e impacto tributário (Trade-to-Tax) */
  const [trades, strategies] = await Promise.all([load("trade"), load("strategy")]);
  const tax = await D.taxFor(uid, active(trades));
  const analytics = tradeAnalytics(active(trades), { tax, strategies });
  if (p === "/v1/trader/performance" && m === "GET") return analytics;
  if (p === "/v1/trader/tax" && m === "GET") return { year: tax.year, months: tax.months, total_tax_due: tax.total_tax_due, losses_available: tax.losses_available, quality: tax.quality,
    per_trade: analytics.closed.map(x => ({ ticker: x.ticker, exit_date: x.exit_date, type: x.daytrade ? "day trade" : "swing", gross_pnl: x.gross_pnl, costs: x.costs, net_pnl: x.net_pnl, tax_rate: x.tax_rate, tax_estimate: x.tax_estimate, after_tax: x.after_tax })),
    note: "Por operação: estimativa pela alíquota da modalidade e isenção do mês. O valor de referência é a apuração mensal do Tax Engine (Tributação)." };
  if (p === "/v1/trader/radar" && m === "GET") return traderRadar({ analytics, tax, journal: await load("journal"), refDate: today() });
  if (p === "/v1/trader/risk" && m === "GET") {
    const positions = await D.positionsFor(uid);
    const candlesBy = {};
    for (const pos of positions.filter(x => x.ticker).slice(0, 8)) { try { candlesBy[pos.ticker] = (await getCandles(env, db, pos.ticker)).candles; } catch { /* sem histórico */ } }
    return riskAnalytics({ positions, analytics, candlesBy });
  }
  if (p === "/v1/trader/overview" && m === "GET") {
    const [wl, jr, bt] = await Promise.all([load("watchlist"), load("journal"), load("backtest")]);
    return { has_data: analytics.has_data, totals: analytics.totals, win_rate: analytics.win_rate, profit_factor: analytics.profit_factor, max_drawdown: analytics.max_drawdown,
      open: analytics.open, by_strategy: analytics.by_strategy, tax: { year: tax.year, total_tax_due: tax.total_tax_due, next_darf: tax.months.map(x => x.darf).filter(d => d && d.status !== "pago").sort((a, b) => a.vencimento.localeCompare(b.vencimento))[0] || null, confidence: tax.confidence },
      watched: [...new Set(wl.filter(w => !w.archived).flatMap(w => w.tickers))], journal_entries: jr.filter(x => !x.archived).length, backtests: bt.length, data_quality: { confidence: tax.confidence, sources: [...new Set(trades.map(t => t.source))] },
      disclaimer: "AURION não executa a operação. AURION entende a operação. Sem recomendação individualizada." };
  }

  /* ---- backtest (Strategy Lab) */
  if (p === "/v1/trader/backtests" && m === "GET") return { items: (await load("backtest")).sort((a, b) => b.created_at.localeCompare(a.created_at)).map(({ trades, equity_curve, ...b }) => b), templates: Object.fromEntries(Object.entries(STRATEGY_TEMPLATES).map(([k, v]) => [k, { name: v.name, params: v.params }])) };
  if (p === "/v1/trader/backtests" && m === "POST") {
    const c = await getCandles(env, db, body.ticker);
    let candles = c.candles;
    if (isoDate(body.from)) candles = candles.filter(x => x.date >= body.from);
    if (isoDate(body.to)) candles = candles.filter(x => x.date <= body.to);
    let r;
    try { r = runBacktest({ ticker: c.ticker, candles, template: body.template, params: body.params || {}, capital: numOrNull(body.capital) || 10000, fee_fixed: numOrNull(body.fee_fixed) ?? 0,
      fee_pct: numOrNull(body.fee_pct) ?? 0.0003, slippage_pct: numOrNull(body.slippage_pct) ?? 0.001, oos_share: Math.min(Math.max(numOrNull(body.oos_share) ?? 0.3, 0.1), 0.5),
      dataset: { id: c.dataset + ":" + candles[0]?.date + ":" + candles.at(-1)?.date, ticker: c.ticker, provider: c.provider, timeframe: "1d", bars: candles.length, from: candles[0]?.date, to: candles.at(-1)?.date, fetched_at: c.fetched_at } }); }
    catch (e) { if (e.status === 422) throw new Problem(422, "Backtest inválido", e.message); throw e; }
    const rec = { ...r, strategy_id: str(body.strategy_id, 40) || null, created_at: nowIso() };
    await put("backtest", r.backtest_id, rec, "backtest");
    await A("trader.backtest_executado", { resource: "backtest", entity_id: r.backtest_id, meta: { ativo: r.ticker, modelo: r.strategy.template, dataset: r.dataset.id, chave: r.reproducibility_key } });
    return new Resp(201, rec);
  }
  const bm = p.match(/^\/v1\/trader\/backtests\/(bt_[a-f0-9]+)(\/reproduce)?$/);
  if (bm && m === "GET") {
    const b = await getOne("backtest", bm[1]);
    if (!bm[2]) return b;
    const c = await getCandles(env, db, b.ticker);
    const candles = c.candles.filter(x => x.date >= b.dataset.from && x.date <= b.dataset.to);
    const again = runBacktest({ ticker: b.ticker, candles, template: b.strategy.template, params: b.strategy.params, capital: b.assumptions.capital, fee_fixed: b.assumptions.fee_fixed,
      fee_pct: b.assumptions.fee_pct, slippage_pct: b.assumptions.slippage_pct, oos_share: b.assumptions.oos_share, dataset: b.dataset });
    return { backtest_id: b.backtest_id, reproducible: again.reproducibility_key === b.reproducibility_key && again.result.final_equity === b.result.final_equity,
      same_dataset: (await sha256(JSON.stringify(c.candles))).slice(0, 16) === b.dataset.id.slice(3, 19), recomputed_final_equity: again.result.final_equity, stored_final_equity: b.result.final_equity };
  }

  /* ---- paper analysis: registro de decisões simuladas, sem movimentação financeira e fora do imposto */
  if (p === "/v1/trader/paper" && m === "GET") { const items = (await load("paper_trade")).filter(x => x.status !== "voided"); return { items, analytics: tradeAnalytics(items), note: "Operações simuladas: não entram em Finanças nem na Tributação." }; }
  if (p === "/v1/trader/paper" && m === "POST") { const t = { ...tradeInput(body), source: "paper", recorded_at: nowIso() }; const pid = id("ppr"); await put("paper_trade", pid, t, "paper"); await A("trader.paper_registrado", { resource: "paper_trade", entity_id: pid }); return new Resp(201, { id: pid, ...t }); }
  const pm = p.match(/^\/v1\/trader\/paper\/([A-Za-z0-9_-]+)$/);
  if (pm && m === "DELETE") { const cur = await getOne("paper_trade", pm[1]); const { id: _x, import_id, ...d } = cur; await put("paper_trade", pm[1], { ...d, status: "voided" }, "paper"); return new Resp(204); }

  throw new Problem(404, "Não encontrado", `${m} ${p}`);
}
