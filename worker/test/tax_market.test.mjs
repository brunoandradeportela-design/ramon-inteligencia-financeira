import test from "node:test";
import assert from "node:assert/strict";
import { computeTax, darfDueDate, assetClassOf, taxDashboard } from "../../apps/web/app/js/tax_engine.js";
import { parseSgs, indicesSnapshot, parseYahooChart, parseBrapi, applyQuotes, tickersFrom, sgsUrl } from "../../apps/web/app/js/market.js";
import { parseNotaCorretagem } from "../../apps/web/app/js/importers.js";

const T = (date, ticker, side, quantity, price, fees = 0, extra = {}) => ({ date, ticker, side, quantity, price, value: quantity * price, fees, ...extra });
const REF = { year: 2026, refDate: "2026-12-15" };

test("classe do ativo pelo código", () => {
  assert.equal(assetClassOf("PETR4").cls, "acao"); assert.equal(assetClassOf("BOVA11").cls, "etf");
  assert.equal(assetClassOf("TAEE11").cls, "acao"); assert.equal(assetClassOf("AAPL34").cls, "bdr");
  assert.deepEqual(assetClassOf("HGLG11"), { cls: "fii", inferred: true }); assert.equal(assetClassOf("IMAB11").cls, "etf_rf");
  assert.deepEqual(assetClassOf("XPML11", { XPML11: "fii" }), { cls: "fii", inferred: false });
});

test("vencimento do DARF: último dia útil do mês seguinte, com feriados", () => {
  assert.equal(darfDueDate("2026-04"), "2026-05-29");     // 31/05 é domingo
  assert.equal(darfDueDate("2026-08"), "2026-09-30");
  assert.equal(darfDueDate("2026-12"), "2027-01-29");     // 31/01/2027 é domingo
  assert.equal(darfDueDate("2027-03"), "2027-04-30");
});

test("ações: isenção até R$ 20 mil de vendas no mês e tributação acima", () => {
  const r = computeTax([T("2026-03-02", "PETR4", "C", 1000, 30), T("2026-03-20", "PETR4", "V", 500, 36),
                        T("2026-05-04", "PETR4", "V", 500, 42)], REF);
  const mar = r.months.find(m => m.month === "2026-03"), mai = r.months.find(m => m.month === "2026-05");
  assert.equal(mar.exempt, true); assert.equal(mar.exempt_gain, "3000.00"); assert.equal(mar.tax_due, "0.00");
  assert.equal(mai.exempt, false);                                  // 500 × 42 = 21.000 > 20.000
  assert.equal(mai.base_comum, "6000.00"); assert.equal(mai.darf.valor, "898.05");     // 900 − IRRF de maio (1,05) e de março (0,90)
  assert.equal(r.total_exempt_gain, "3000.00"); assert.equal(r.events.find(e => e.date === "2026-03-20").status, "isento");
});

test("ações acima do limite: 15% sobre o ganho menos IRRF, DARF 6015", () => {
  const r = computeTax([T("2026-03-02", "VALE3", "C", 1000, 60, 10), T("2026-04-10", "VALE3", "V", 1000, 70, 10)], REF);
  const abr = r.months.find(m => m.month === "2026-04");
  assert.equal(abr.exempt, false);
  assert.equal(abr.result_comum, "9980.00");                        // 70.000 − 10 − 60.010
  assert.equal(abr.tax_due_gross, "1497.00");
  assert.equal(abr.irrf, "3.50");                                   // 0,005% de 70.000
  assert.equal(abr.darf.valor, "1493.50"); assert.equal(abr.darf.codigo, "6015"); assert.equal(abr.darf.vencimento, "2026-05-29");
  assert.equal(r.events[0].status, "calculado"); assert.equal(r.confidence, 1);
});

test("prejuízo compensa só a mesma modalidade e prejuízo anterior informado", () => {
  const trades = [T("2026-02-02", "ITUB4", "C", 2000, 30), T("2026-02-20", "ITUB4", "V", 2000, 25),   // −10.000 comum (vendas 50 mil)
                  T("2026-03-02", "HGLG11", "C", 100, 150), T("2026-03-25", "HGLG11", "V", 100, 170),  // +2.000 FII
                  T("2026-04-01", "WEGE3", "C", 1000, 40), T("2026-04-20", "WEGE3", "V", 1000, 52)];   // +12.000 comum (vendas 52 mil)
  const r = computeTax(trades, { ...REF, knownClasses: { HGLG11: "fii" } });
  const mar = r.months.find(m => m.month === "2026-03"), abr = r.months.find(m => m.month === "2026-04");
  assert.equal(mar.base_fii, "2000.00"); assert.equal(mar.tax_fii, "400.00");            // prejuízo comum não abate FII
  assert.equal(abr.base_comum, "2000.00"); assert.equal(abr.tax_comum, "300.00");        // 12.000 − 10.000
  const r2 = computeTax(trades, { ...REF, knownClasses: { HGLG11: "fii" }, priorLosses: { fii: "500" } });
  assert.equal(r2.months.find(m => m.month === "2026-03").base_fii, "1500.00");
  assert.match(r2.premises.at(-1), /fii R\$ 500,00/);
});

test("day trade identificado pelas datas, excedente vai para o preço médio", () => {
  const r = computeTax([T("2026-06-10", "PETR4", "C", 300, 30), T("2026-06-10", "PETR4", "V", 200, 32)], REF);
  const jun = r.months.find(m => m.month === "2026-06");
  assert.equal(jun.result_daytrade, "400.00"); assert.equal(jun.tax_daytrade, "80.00"); assert.equal(jun.irrf, "4.00");
  assert.equal(jun.darf.valor, "76.00");
  assert.deepEqual(r.positions_cost.PETR4, { quantidade: "100", custo_total: "3000.00", preco_medio: "30.00", classe: "acao" });
});

test("imposto abaixo de R$ 10 acumula para o mês seguinte", () => {
  const r = computeTax([T("2026-07-01", "BOVA11", "C", 10, 100), T("2026-07-15", "BOVA11", "V", 10, 105),
                        T("2026-08-01", "BOVA11", "C", 10, 100), T("2026-08-15", "BOVA11", "V", 10, 106)], REF);
  const jul = r.months.find(m => m.month === "2026-07"), ago = r.months.find(m => m.month === "2026-08");
  assert.equal(jul.darf, null); assert.equal(ago.carry_in, "7.45");                     // 7,50 − 0,05 de IRRF
  assert.equal(ago.darf.valor, "16.39");
});

test("venda sem compra registrada fica pendente e reduz a confiança", () => {
  const r = computeTax([T("2026-09-01", "BBAS3", "V", 1000, 25)], REF);
  assert.equal(r.events[0].status, "pendente_dado"); assert.equal(r.events[0].cost_basis, "?");
  assert.equal(r.confidence, 0.55); assert.match(r.limitations[0], /Há vendas sem o histórico/);
});

test("compras de anos anteriores formam o preço médio; opções ficam fora", () => {
  const r = computeTax([T("2025-05-02", "WEGE3", "C", 1000, 30), T("2026-03-10", "WEGE3", "V", 1000, 45),
                        T("2026-03-11", "PETRC300", "C", 100, 1, 0, { market: "opcao de compra" })], REF);
  assert.equal(r.months.length, 1); assert.equal(r.months[0].base_comum, "15000.00");
  assert.ok(r.limitations.some(l => /fora do escopo/.test(l)));
  const d = taxDashboard(r); assert.equal(d.estimated, r.total_tax_due); assert.equal(d.next_darf.competencia, "2026-03");
});

test("mesmo conjunto de negociações = mesmo hash", () => {
  const a = computeTax([T("2026-03-02", "VALE3", "C", 10, 60)], REF), b = computeTax([T("2026-03-02", "VALE3", "C", 10, 60)], REF);
  const c = computeTax([T("2026-03-02", "VALE3", "C", 11, 60)], REF);
  assert.equal(a.snapshot_hash, b.snapshot_hash); assert.notEqual(a.snapshot_hash, c.snapshot_hash);
});

test("nota de corretagem: marcação D vira day trade", () => {
  const txt = `Data pregão 10/06/2026 XP INVESTIMENTOS
1-BOVESPA C VISTA PETROBRAS PN N2 D 300 30,00 9.000,00 D
1-BOVESPA V VISTA PETROBRAS PN N2 D 200 32,00 6.400,00 C`;
  const n = parseNotaCorretagem(txt);
  assert.equal(n.trades.length, 2); assert.equal(n.trades[0].daytrade, true); assert.equal(n.trades[1].quantity, 200);
});

/* ------------------------------------------------------------------ mercado */
test("Banco Central: séries e indicadores acumulados", () => {
  const days = [];
  for (let d = new Date("2025-09-01T12:00:00Z"); d <= new Date("2026-09-30T12:00:00Z"); d.setUTCDate(d.getUTCDate() + 1))
    if (![0, 6].includes(d.getUTCDay())) days.push({ data: d.toISOString().slice(0, 10).split("-").reverse().join("/"), valor: "0.055131" });
  const cdi = parseSgs(days);
  assert.equal(cdi[0].date, "2025-09-01");
  const ipca = parseSgs(Array.from({ length: 13 }, (_, i) => ({ data: `01/${String((i + 8) % 12 + 1).padStart(2, "0")}/${i < 4 ? 2025 : 2026}`, valor: "0,40" })));
  const s = indicesSnapshot({ cdi, cdi_aa: parseSgs([{ data: "30/09/2026", valor: "14.90" }]), selic_meta: parseSgs([{ data: "30/09/2026", valor: "15.00" }]), ipca }, "2026-10-01");
  assert.equal(s.selic_meta.value, 0.15); assert.ok(Math.abs(s.cdi_12m.value - 0.1497) < 0.01);
  assert.ok(Math.abs(s.ipca_12m.value - (1.004 ** 12 - 1)) < 1e-9); assert.equal(s.ipca_month.month, "2026-09");
  assert.match(sgsUrl(12, "2025-09-01", "2026-10-01"), /bcdata\.sgs\.12\/dados\?formato=json&dataInicial=01\/09\/2025&dataFinal=01\/10\/2026/);
});

test("CDI mensal (consulta leve) e ordem decrescente do SGS", () => {
  const cdi_m = parseSgs(Array.from({ length: 13 }, (_, i) => ({ data: `01/${String((i + 8) % 12 + 1).padStart(2, "0")}/${i < 4 ? 2025 : 2026}`, valor: "1.10" })).reverse());
  assert.equal(cdi_m[0].date, "2025-09-01");
  const s = indicesSnapshot({ cdi_m }, "2026-10-01");
  assert.ok(Math.abs(s.cdi_12m.value - (1.011 ** 12 - 1)) < 1e-9); assert.equal(s.cdi_12m.monthly, true);
  assert.equal(s.cdi_ytd.to, "2026-09"); assert.ok(Math.abs(s.cdi_ytd.value - (1.011 ** 9 - 1)) < 1e-9);
});

test("Yahoo e brapi: última cotação e fechamento anterior", () => {
  const y = { chart: { result: [{ meta: { currency: "BRL", regularMarketPrice: 31.42, regularMarketTime: 1759262400 },
    timestamp: [1759089600, 1759176000, 1759262400], indicators: { quote: [{ close: [30.9, 31.1, 31.42] }] } }], error: null } };
  const q = parseYahooChart(y, "PETR4");
  assert.equal(q.close, 31.42); assert.equal(q.prev_close, 31.1); assert.equal(q.date, "2025-09-30");
  assert.throws(() => parseYahooChart({ chart: { result: null, error: { description: "No data found" } } }, "XXXX3"), /No data/);
  const b = parseBrapi({ results: [{ symbol: "VALE3", regularMarketPrice: 61.2, regularMarketPreviousClose: 60, regularMarketTime: "2026-09-30T20:07:00.000Z" }] });
  assert.deepEqual(b[0], { ticker: "VALE3", close: 61.2, prev_close: 60, date: "2026-09-30", currency: "BRL", source: "brapi.dev" });
});

test("carteira: cotação atualiza posição e negociações viram posição", () => {
  const holdings = [{ id: "h1", ticker: "PETR4", asset_class: "acao", quantity: 100, value: 3000, as_of: "2026-09-20" },
                    { id: "h2", name: "Tesouro Selic 2029", asset_class: "tesouro", quantity: 1, value: 10000 }];
  const quotes = { PETR4: { close: 32, prev_close: 31, date: "2026-09-30", source: "Yahoo Finance" }, VALE3: { close: 60, date: "2026-09-30", source: "Yahoo Finance" } };
  const out = applyQuotes(holdings, quotes, { VALE3: { quantidade: "10", custo_total: "550.00", classe: "acao" } });
  assert.equal(out[0].value, 3200); assert.equal(out[1].value, 10000);
  assert.equal(out[2].ticker, "VALE3"); assert.equal(out[2].value, 600); assert.equal(out[2].invested, 550);
  const failed = applyQuotes([holdings[0]], { PETR4: { ticker: "PETR4", close: null } }, { VALE3: { quantidade: "10", custo_total: "550.00", classe: "acao" } });
  assert.equal(failed[0].value, 3000); assert.equal(failed[1].value, 550);                // cotação que falhou não zera a posição
  const older = applyQuotes([{ ...holdings[0], as_of: "2026-10-01" }], quotes);
  assert.equal(older[0].value, 3000);                                                     // posição mais nova que a cotação
  assert.deepEqual(tickersFrom([{ ticker: "petr4" }, { ticker: "PETR4F" }, { ticker: "Tesouro" }, { ticker: "HGLG11" }]), ["HGLG11", "PETR4"]);
});
