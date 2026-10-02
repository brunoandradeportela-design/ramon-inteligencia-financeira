import test from "node:test";
import assert from "node:assert/strict";
import { computeTax } from "../../apps/web/app/js/tax_engine.js";
import { buildAlerts } from "../../apps/web/app/js/alert_engine.js";
import { simulateSale, simulatePgbl } from "../../apps/web/app/js/sim_engine.js";
import { financeSummary, portfolioSummary } from "../../apps/web/app/js/fin_engine.js";

const T = (date, ticker, side, quantity, price) => ({ date, ticker, side, quantity, price, value: quantity * price, fees: 0 });

test("radar: DARF a vencer, venda sem custo, limite de isenção e prejuízo", () => {
  const trades = [T("2026-08-03", "VALE3", "C", 1000, 60), T("2026-08-20", "VALE3", "V", 1000, 70),
                  T("2026-09-02", "PETR4", "C", 600, 30), T("2026-09-15", "PETR4", "V", 600, 29),     // prejuízo, vendas 17.400 no mês
                  T("2026-09-16", "BBAS3", "V", 10, 25)];
  const tax = computeTax(trades, { refDate: "2026-09-20" });
  const a = buildAlerts({ fin: financeSummary([]), port: portfolioSummary([]), tax, refDate: "2026-09-20" });
  const codes = a.map(x => x.code);
  assert.ok(codes.includes("DARF_VENCIMENTO")); assert.equal(a[0].code, "DARF_VENCIMENTO"); assert.equal(a[0].severity, "alto");   // vence 30/09, 10 dias
  assert.ok(codes.includes("DADO_INCOMPLETO")); assert.ok(codes.includes("ISENCAO_LIMITE")); assert.ok(codes.includes("PREJUIZO_DISPONIVEL"));
  assert.ok(codes.includes("IMPORTAR_EXTRATO")); assert.ok(!codes.includes("IMPORTAR_B3"));
  const late = buildAlerts({ fin: financeSummary([]), port: portfolioSummary([]), tax: computeTax(trades, { refDate: "2026-10-05" }), refDate: "2026-10-05" });
  assert.equal(late[0].code, "DARF_VENCIDO"); assert.equal(late[0].severity, "critico");
  // status salvo pelo cliente prevalece e o id é estável
  const again = buildAlerts({ fin: financeSummary([]), port: portfolioSummary([]), tax, refDate: "2026-09-20", statuses: { [a[0].id]: "resolvido" } });
  assert.equal(again.find(x => x.id === a[0].id).status, "resolvido"); assert.equal(again.at(-1).status, "resolvido");
});

test("radar: reserva curta, gasto que subiu e concentração", () => {
  const txs = [];
  for (const m of ["04", "05", "06", "07", "08", "09"]) {
    txs.push({ date: `2026-${m}-05`, description: "SALARIO", amount: 10000 });
    txs.push({ date: `2026-${m}-10`, description: "RESTAURANTE BOM", amount: m === "09" ? -2500 : -800 });
    txs.push({ date: `2026-${m}-12`, description: "ALUGUEL", amount: -3000 });
  }
  const fin = financeSummary(txs, [{ name: "Conta", type: "conta", balance: 5000 }]);
  const port = portfolioSummary([{ id: "h", ticker: "PETR4", asset_class: "acao", quantity: 100, value: 9000 }, { id: "t", name: "Tesouro", asset_class: "tesouro", quantity: 1, value: 1000 }]);
  const codes = buildAlerts({ fin, port, tax: computeTax([]), refDate: "2026-09-30" }).map(x => x.code);
  for (const c of ["RESERVA_CURTA", "GASTO_SUBIU", "CONCENTRACAO", "SEM_CUSTO_MEDIO"]) assert.ok(codes.includes(c), c);
});

test("simulação de venda: compara com o cenário atual e mostra o mês afetado", () => {
  const trades = [T("2026-03-02", "PETR4", "C", 1000, 30)];
  const r = simulateSale({ trades, positions: [{ ticker: "PETR4", quantity: 1000, value: 36000, price: 36 }], ops: [{ ticker: "PETR4", quantity: 500, date: "2026-10-15" }], opts: { refDate: "2026-10-01" } });
  assert.equal(r.results[0].tax_year, "0.00");
  assert.equal(r.results[1].months[0].exempt, true); assert.equal(r.results[1].tax_difference_vs_base, "0.00");      // 18.000 ≤ 20 mil
  const big = simulateSale({ trades, positions: [{ ticker: "PETR4", quantity: 1000, value: 36000, price: 36 }], ops: [{ ticker: "PETR4", quantity: 1000, date: "2026-10-15" }], opts: { refDate: "2026-10-01" } });
  assert.equal(big.results[1].tax_difference_vs_base, "898.20");                                                   // 6.000 × 15% − IRRF 1,80
  assert.equal(big.results[1].liquidity_generated, "36000.00"); assert.equal(big.results[1].net_liquidity_after_tax, "35101.80");
  assert.throws(() => simulateSale({ trades, positions: [], ops: [{ ticker: "PETR4", quantity: 10, date: "2026-09-01" }], opts: { refDate: "2026-10-01" } }), /hoje ou futura/);
});

test("simulação usa o valor aplicado da posição quando faltam negociações", () => {
  const r = simulateSale({ trades: [], positions: [{ ticker: "WEGE3", quantity: 1000, value: 50000, price: 50, invested: 40000 }],
    ops: [{ ticker: "WEGE3", quantity: 1000, date: "2026-10-20" }], opts: { refDate: "2026-10-01" } });
  assert.equal(r.results[1].tax_difference_vs_base, "1497.50"); assert.ok(r.premises.some(p => /valor aplicado/.test(p)));
});

test("PGBL: limite de 12% e elegibilidade", () => {
  const r = simulatePgbl({ taxable_income: "420000", current_contributions: "18000", extra_contribution: "40000", marginal_rate: "0.275", full_model: true, contributes_social_security: true });
  assert.equal(r.limit_12pct, "50400.00"); assert.equal(r.results[1].deductible, "50400.00"); assert.equal(r.difference, "8910.00");
  assert.equal(simulatePgbl({ taxable_income: "100000", current_contributions: "0", extra_contribution: "5000", marginal_rate: "0.275", full_model: false, contributes_social_security: true }).difference, "0.00");
});
