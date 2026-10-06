import test from "node:test";
import assert from "node:assert/strict";
import { sma, rsi, maxDrawdown, roundTrips, tradeAnalytics, runBacktest } from "../../apps/web/app/js/trader_engine.js";
import { exposureOf, personalEvents, mergeDisclosures, eventsView } from "../../apps/web/app/js/event_engine.js";

test("indicadores básicos", () => {
  assert.deepEqual(sma([1, 2, 3, 4], 2), [null, 1.5, 2.5, 3.5]);
  assert.equal(rsi(Array.from({ length: 30 }, (_, i) => 10 + i)).at(-1), 100);
  const dd = maxDrawdown([100, 120, 90, 130]); assert.ok(Math.abs(dd.pct + 0.25) < 1e-9); assert.equal(dd.abs, -30);
});

test("FIFO: round trips, custos separados, day trade e versões substituídas/anuladas ignoradas", () => {
  const T = [
    { id: "1", ticker: "PETR4", side: "C", quantity: 100, price: 30, fees: 2, executed_at: "2026-03-02T10:00:00" },
    { id: "2", ticker: "PETR4", side: "V", quantity: 100, price: 32, fees: 2, executed_at: "2026-03-02T15:00:00" },
    { id: "3", ticker: "VALE3", side: "C", quantity: 10, price: 60, fees: 0, executed_at: "2026-03-03T10:00:00" },
    { id: "4", ticker: "VALE3", side: "V", quantity: 10, price: 55, fees: 0, executed_at: "2026-03-10T10:00:00" },
    { id: "5", ticker: "VALE3", side: "V", quantity: 999, price: 1, fees: 0, executed_at: "2026-03-11T10:00:00", status: "voided" },
    { id: "6", ticker: "ITUB4", side: "C", quantity: 5, price: 1, fees: 0, executed_at: "2026-03-11T10:00:00", superseded_by: "7" },
  ];
  const { closed, open } = roundTrips(T);
  assert.equal(closed.length, 2); assert.equal(open.length, 0);
  const p = closed.find(x => x.ticker === "PETR4");
  assert.equal(p.gross_pnl, 200); assert.equal(p.costs, 4); assert.equal(p.net_pnl, 196); assert.equal(p.daytrade, true);
  const a = tradeAnalytics(T);
  assert.equal(a.totals.trades, 2); assert.equal(a.win_rate, 0.5); assert.equal(a.totals.net_pnl, 146);
  assert.equal(p.tax_rate ?? a.closed.find(x => x.ticker === "PETR4").tax_rate, 0.2, "day trade estimado a 20%");
});

test("backtest determinístico e sem olhar o futuro", () => {
  const cs = Array.from({ length: 200 }, (_, i) => { const c = 50 + 10 * Math.sin(i / 9) + i * 0.05; return { date: new Date(Date.UTC(2025, 0, 1) + i * 864e5).toISOString().slice(0, 10), open: c - 0.2, high: c + 1, low: c - 1, close: c, volume: 1000 }; });
  const a = runBacktest({ ticker: "TEST3", candles: cs, template: "sma_cross" }), b = runBacktest({ ticker: "TEST3", candles: cs, template: "sma_cross" });
  assert.equal(a.backtest_id, b.backtest_id); assert.deepEqual(a.result, b.result);
  for (const t of a.trades) assert.ok(t.entry_date > cs[0].date, "entrada nunca no primeiro pregão (sinal só no fechamento anterior)");
  assert.ok(a.warnings.some(w => /não é recomendação/i.test(w)));
  assert.throws(() => runBacktest({ ticker: "X", candles: cs.slice(0, 10), template: "sma_cross" }), /insuficiente/);
});

test("eventos: DARF aberto, vencimento de título, exposição e divulgações só dos meus ativos", () => {
  const tax = { months: [{ darf: { codigo: "6015", competencia: "2026-09", valor: "45.10", vencimento: "2026-10-30", status: "aberto" } }, { darf: { codigo: "6015", competencia: "2026-08", valor: "10.00", vencimento: "2026-09-30", status: "pago" } }] };
  const holdings = [{ ticker: "PETR4" }, { name: "CDB Banco X", maturity: "2026-12-15", value: 5000, custodian: "Banco X" }, { name: "LCI", maturity: "2030-01-01" }];
  const ev = eventsView({ tax, holdings, trades: [{ ticker: "vale3" }], watchlists: [{ tickers: ["ITUB4", "XPTO"] }], refDate: "2026-10-06" });
  assert.deepEqual(ev.exposure, ["ITUB4", "PETR4", "VALE3"]);
  assert.deepEqual(ev.items.map(i => i.kind), ["darf", "vencimento"]);
  const merged = mergeDisclosures(ev.items, [{ date: "2026-10-01", company: "Petrobras", tickers: ["PETR4", "PETR3"], category_label: "Fato relevante", source: "CVM", url: "https://x" }, { date: "2026-10-02", company: "Outra", tickers: ["ABCD3"] }], ev.exposure);
  assert.equal(merged.length, 3); assert.equal(merged[0].kind, "divulgacao"); assert.equal(merged[0].impact, "PETR4");
  assert.equal(personalEvents({ tax: null, holdings: [], refDate: "2026-10-06" }).length, 0);
  assert.deepEqual(exposureOf({}), []);
});

import { dailyBriefing, personalizeNews } from "../../apps/web/app/js/daily_engine.js";
test("AURION Daily determinístico, sem recomendação, voz em reais; notícias personalizadas", () => {
  const inp = { date: "2026-10-06", dashboard: { has_data: true, greeting: "Ana", net_worth: { total: "125000.50", variation_pct: 0.031, series: [1, 2] }, liquidity: { months_covered: 4.2 },
    tax: { estimated: "300.00", next_darf: { codigo: "6015", competencia: "2026-09", valor: "300.00", vencimento: "2026-10-30", status: "aberto" } }, alerts: { open: 2, critical: 1 } },
    events: { items: [{ date: "2026-10-10", kind: "vencimento", title: "Vencimento: CDB", impact: "liquidez" }], exposure: ["PETR4"] },
    indices: { selic_meta: { value: 0.15 }, source: "Banco Central do Brasil — SGS" },
    news: [{ title: "Copom e juros", tags: ["juros"], source: "Agência Brasil", url: "u1" }, { title: "PETR4 anuncia", tags: [], tickers: ["PETR4"], source: "CVM", url: "u2" }, { title: "Futebol", tags: [], source: "X", url: "u3" }],
    disclosures: [{ company: "Petrobras", tickers: ["PETR4"], published_at: "2026-10-05", category_label: "Fato relevante", subject: "Dividendos" }], classes: ["renda_fixa"] };
  const a = dailyBriefing(inp), b = dailyBriefing(inp);
  assert.deepEqual(a, b);
  assert.deepEqual(a.sections.map(s => s.id), ["patrimonio", "tributos", "agenda", "alertas", "mercado", "divulgacoes", "noticias"]);
  assert.match(a.opening, /Bom dia, Ana/); assert.match(a.voice_script, /125\.000,50 reais/); assert.ok(!/R\$/.test(a.voice_script));
  assert.ok(!/(compre|venda|recomendamos)/i.test(a.sections.map(s => s.text).join(" "))); assert.match(a.disclaimer, /não é recomendação/i);
  const n = personalizeNews(inp.news, { exposure: ["PETR4"], classes: ["renda_fixa"] });
  assert.deepEqual(n.map(x => x.url), ["u2", "u1", "u3"]); assert.equal(n[2].relevance, 0);
  assert.match(dailyBriefing({ date: "2026-10-06" }).sections[0].text, /Importe/);
});
