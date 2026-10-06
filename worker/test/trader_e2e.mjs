// Trader Intelligence ponta a ponta (histórico simulado na porta 9914). Nenhuma rota de ordem existe.
import assert from "node:assert/strict";
import { start } from "./fake_market.mjs";
const mkt = await start(9914);
const B = process.env.AURION_TEST_URL || "http://localhost:8799";
const call = async (method, path, body, token, h = {}) => {
  const r = await fetch(B + path, { method, body: body ? JSON.stringify(body) : undefined, headers: { "Content-Type": "application/json", ...(token ? { Authorization: "Bearer " + token } : {}), ...h } });
  return { status: r.status, body: r.status === 204 ? null : await r.json() };
};
const reg = async (n, plan = "pro") => (await call("POST", "/v1/auth/register", { name: "Rafael Gomes Teles", email: `tr${n}.${Date.now()}@exemplo.com`, profession: "Trader", phone: "(69) 99811-60" + (10 + n), password: "senhaSegura123", accept_terms: true, plan })).body;
const a = await reg(1), tk = a.token, y = new Date().getFullYear(), d = (m, dd) => `${y}-${String(m).padStart(2, "0")}-${String(dd).padStart(2, "0")}`;
assert.equal((await call("GET", "/v1/trader/overview", null, (await reg(2, "free")).token)).status, 402);
// registro de operação: idempotência obrigatória
const t1 = { ticker: "PETR4", side: "BUY", quantity: "1000", price: "30", fees: "5", executed_at: d(3, 2) + "T11:30:00Z" };
assert.equal((await call("POST", "/v1/trader/trades", t1, tk)).status, 400, "sem Idempotency-Key");
let r = await call("POST", "/v1/trader/trades", t1, tk, { "Idempotency-Key": "key-0001-a" });
assert.equal(r.status, 201); assert.equal(r.body.data.status, "RECORDED"); assert.equal(r.body.data.tax_analysis_status, "COMPUTED");
const again = await call("POST", "/v1/trader/trades", t1, tk, { "Idempotency-Key": "key-0001-a" });
assert.equal(again.status, 200); assert.equal(again.body.meta.replayed, true); assert.equal(again.body.data.trade_id, r.body.data.trade_id);
assert.equal((await call("POST", "/v1/trader/trades", { ...t1, executed_at: "2099-01-01" }, tk, { "Idempotency-Key": "key-0002-b" })).status, 422);
assert.equal((await call("POST", "/v1/trader/trades", { ...t1, ticker: "XX" }, tk, { "Idempotency-Key": "key-0003-c" })).status, 422);
const st = (await call("POST", "/v1/trader/strategies", { name: "Swing de médias", template: "sma_cross", params: { fast: 9, slow: 21 }, rules_text: "compra no cruzamento" }, tk)).body;
r = await call("POST", "/v1/trader/trades", { ticker: "PETR4", side: "SELL", quantity: 1000, price: 33, fees: 5, executed_at: d(3, 20), strategy_id: st.id }, tk, { "Idempotency-Key": "key-0004-d" });
const sellId = r.body.data.trade_id;
await call("POST", "/v1/trader/trades", { ticker: "VALE3", side: "BUY", quantity: 100, price: 60, executed_at: d(4, 7) + "T10:05:00Z" }, tk, { "Idempotency-Key": "key-0005-e" });
await call("POST", "/v1/trader/trades", { ticker: "VALE3", side: "SELL", quantity: 100, price: 58, executed_at: d(4, 7) + "T15:40:00Z" }, tk, { "Idempotency-Key": "key-0006-f" });
// Trade-to-Tax: o mesmo registro alimenta a Tributação
let tax = (await call("GET", `/v1/tax/summary?year=${y}`, null, tk)).body;
assert.equal(tax.months.find(m => m.month === d(3, 1).slice(0, 7)).base_comum, "2990.00");
// correção gera nova versão; a original fica guardada e sai dos cálculos
r = await call("PUT", `/v1/trader/trades/${sellId}`, { price: 34, reason: "preço da nota" }, tk);
assert.equal(r.body.data.version, 2); assert.equal(r.body.data.previous_id, sellId);
tax = (await call("GET", `/v1/tax/summary?year=${y}`, null, tk)).body;
assert.equal(tax.months.find(m => m.month === d(3, 1).slice(0, 7)).base_comum, "3990.00");
const list = (await call("GET", "/v1/trader/trades", null, tk)).body.items;
assert.ok(list.find(t => t.id === sellId).superseded_by); assert.equal(list.length, 5);
assert.equal((await call("PUT", `/v1/trader/trades/${sellId}`, { price: 35 }, tk)).status, 409, "versão antiga não é editável");
// análise de operações
const perf = (await call("GET", "/v1/trader/performance", null, tk)).body;
assert.equal(perf.totals.trades, 2); assert.equal(perf.totals.gross_pnl, 3800); assert.equal(perf.totals.net_pnl, 3790); assert.equal(perf.win_rate, 0.5);
assert.ok(perf.by_strategy.some(s => s.key === "Swing de médias")); assert.ok(perf.by_type.some(s => s.key === "day trade"));
assert.equal(perf.closed.find(x => x.ticker === "VALE3").daytrade, true); assert.equal(perf.max_drawdown, -200);
const ttax = (await call("GET", "/v1/trader/tax", null, tk)).body;
assert.equal(ttax.per_trade.find(x => x.ticker === "PETR4").tax_estimate, 598.5); assert.match(ttax.note, /estimativa/);
// diário, watchlist, mercado
const j = (await call("POST", "/v1/trader/journal", { trade_id: sellId, context: "rompimento", justification: "sinal de saída", tags: ["disciplina"] }, tk)).body;
assert.ok(j.id); assert.equal((await call("GET", "/v1/trader/journal", null, tk)).body.items.length, 1);
const wl = (await call("POST", "/v1/trader/watchlists", { name: "Bancos", tickers: ["ITUB4", "bbas3", "INVALIDO", "ITUB4"] }, tk)).body;
assert.deepEqual(wl.tickers, ["ITUB4", "BBAS3"]);
const wls = (await call("GET", "/v1/trader/watchlists", null, tk)).body;
assert.ok(wls.items[0].quotes.every(q => q.close > 0)); assert.match(wls.note, /não sugere/);
const mk = (await call("GET", "/v1/trader/market?ticker=PETR4&range=6m", null, tk)).body;
assert.equal(mk.candles.length, 126); assert.equal(mk.provider, "Yahoo Finance"); assert.ok(mk.fetched_at); assert.ok(mk.snapshot.rsi14 >= 0 && mk.snapshot.rsi14 <= 100);
assert.equal((await call("GET", "/v1/trader/market?ticker=XX", null, tk)).status, 422);
// risco
const risk = (await call("GET", "/v1/trader/risk", null, tk)).body;
assert.match(risk.disclaimer, /não autoriza, envia ou executa ordens/); assert.ok("exposure" in risk);
// backtest reproduzível
const btReq = { ticker: "PETR4", template: "sma_cross", params: { fast: 9, slow: 21 }, capital: 10000, fee_pct: 0.0005, slippage_pct: 0.001, strategy_id: st.id };
const bt = (await call("POST", "/v1/trader/backtests", btReq, tk)).body;
assert.ok(bt.backtest_id.startsWith("bt_")); assert.ok(bt.result.operations > 0); assert.ok("out_of_sample" in bt && "in_sample" in bt);
assert.match(bt.warnings.join(" "), /não garante/); assert.equal(bt.assumptions.execution.includes("abertura do pregão seguinte"), true);
const bt2 = (await call("POST", "/v1/trader/backtests", btReq, tk)).body;
assert.equal(bt2.backtest_id, bt.backtest_id); assert.equal(bt2.result.final_equity, bt.result.final_equity);
assert.equal((await call("GET", `/v1/trader/backtests/${bt.backtest_id}/reproduce`, null, tk)).body.reproducible, true);
assert.equal((await call("POST", "/v1/trader/backtests", { ...btReq, template: "robo_magico" }, tk)).status, 422);
// paper analysis fora do imposto
await call("POST", "/v1/trader/paper", { ticker: "WEGE3", side: "BUY", quantity: 10, price: 40, executed_at: d(5, 2) }, tk);
await call("POST", "/v1/trader/paper", { ticker: "WEGE3", side: "SELL", quantity: 10, price: 50, executed_at: d(5, 9) }, tk);
assert.equal((await call("GET", "/v1/trader/paper", null, tk)).body.analytics.totals.net_pnl, 100);
assert.ok(!(await call("GET", `/v1/tax/events?year=${y}`, null, tk)).body.items.some(e => e.ticker === "WEGE3"), "paper não entra no imposto");
// isolamento e ausência de rotas de ordem
const b = await reg(3);
assert.equal((await call("GET", `/v1/trader/strategies/${st.id}`, null, b.token)).status, 404);
assert.equal((await call("PUT", `/v1/trader/trades/${list[0].id}`, { price: 1 }, b.token)).status, 404);
for (const path of ["/v1/trader/orders", "/v1/trader/submit_order", "/v1/orders"]) assert.equal((await call("POST", path, {}, tk)).status, 404, path);
const ov = (await call("GET", "/v1/trader/overview", null, tk)).body;
assert.equal(ov.backtests, 1); assert.match(ov.disclaimer, /não executa/);
assert.ok((await call("GET", "/v1/audit", null, tk)).body.items.some(i => i.action === "trader.operacao_corrigida"));
// eventos: exposição inclui operações e watchlists; outro titular não vê
const evs = (await call("GET", "/v1/events", null, tk)).body;
assert.ok(evs.exposure.length > 0); assert.match(evs.disclaimer, /não é recomendação/);
assert.deepEqual((await call("GET", "/v1/events", null, b.token)).body.exposure, []);
const rad = (await call("GET", "/v1/trader/radar", null, tk)).body;
assert.ok(Array.isArray(rad.items)); assert.match(rad.note, /Não é recomendação/);
mkt.close();
console.log("TRADER E2E OK — registro idempotente, Trade-to-Tax, versões, analytics, diário, watchlist, mercado, risco, backtest reproduzível, paper fora do imposto, isolamento, sem rotas de ordem");
