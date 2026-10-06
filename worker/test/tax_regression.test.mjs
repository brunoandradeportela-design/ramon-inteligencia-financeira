// Suíte de regressão do Tax Engine por versão de regra (v6.0 §13/§26: 100% deve passar antes de publicar).
import test from "node:test";
import assert from "node:assert/strict";
import { computeTax, RULES, rulesForYear, ENGINE_VERSION } from "../../apps/web/app/js/tax_engine.js";
import { RULE_VERSIONS, validateRuleDefinition, ruleAt, ruleListing } from "../../apps/web/app/js/tax_rules.js";
import { simulateScenarios, simulatePgbl } from "../../apps/web/app/js/sim_engine.js";
import fs from "node:fs";

const T = (date, ticker, side, quantity, price, extra = {}) => ({ date, ticker, side, quantity, price, value: quantity * price, fees: 0, ...extra });
const O = { year: 2026, refDate: "2026-12-20" };

test("registro: toda regra validada tem fonte, vigência, definição declarativa válida e teste", () => {
  for (const r of RULE_VERSIONS.filter(r => r.status === "validated")) {
    assert.deepEqual(validateRuleDefinition(r), [], r.code); assert.ok(r.sources.length, r.code); assert.ok(r.tests.length, r.code);
  }
  assert.equal(ruleListing().items.find(r => r.code === "BR-IRPF-TABELA-ANUAL").usable_in_calculation, false, "regra pendente nunca entra no cálculo");
  assert.equal(ruleAt("BR-IRPF-RV-COMUM", "2025-06-01"), null, "sem versão vigente antes de 2026");
});
test("o motor usa exatamente os parâmetros do registro (sem alíquota própria)", () => {
  const c = RULE_VERSIONS.find(r => r.code === "BR-IRPF-RV-COMUM");
  assert.equal(RULES["BR-IRPF-RV-COMUM"].aliquota, +c.parameters.aliquota); assert.equal(RULES["BR-IRPF-RV-COMUM"].limite_isencao, +c.parameters.limite_isencao_vendas_mes);
  assert.equal(RULES["BR-IRPF-RV-DAYTRADE"].irrf_ganho, +RULE_VERSIONS.find(r => r.code === "BR-IRPF-RV-DAYTRADE").parameters.irrf_aliquota_sobre_ganho);
  assert.ok(rulesForYear(2026)); assert.equal(rulesForYear(2024), null);
  const src = fs.readFileSync(new URL("../../apps/web/app/js/tax_engine.js", import.meta.url), "utf8");
  assert.ok(!/aliquota:\s*0\.\d/.test(src), "alíquota fixa no código do motor");
});
// casos dourados por regra (equivalentes aos testes Python citados no catálogo)
test("BR-IRPF-RV-COMUM@2026.1 — isenção até 20 mil, tributação acima e compensação", () => {
  let t = computeTax([T("2026-03-02", "PETR4", "C", 600, 30), T("2026-03-20", "PETR4", "V", 600, 33)], O);
  assert.equal(t.months[0].exempt, true); assert.equal(t.total_exempt_gain, "1800.00"); assert.equal(t.total_tax_due, "0.00");
  t = computeTax([T("2026-03-02", "PETR4", "C", 1000, 30), T("2026-03-20", "PETR4", "V", 1000, 33)], O);
  assert.equal(t.months[0].base_comum, "3000.00"); assert.equal(t.months[0].tax_comum, "450.00"); assert.equal(t.months[0].darf.valor, "448.35");
  t = computeTax([T("2026-02-02", "ITUB4", "C", 1000, 30), T("2026-02-20", "ITUB4", "V", 1000, 28), T("2026-03-02", "PETR4", "C", 1000, 30), T("2026-03-20", "PETR4", "V", 1000, 33)], O);
  assert.equal(t.months[1].base_comum, "1000.00", "prejuízo de 2.000 compensado");
});
test("BR-IRPF-RV-DAYTRADE@2026.1 — 20% e IRRF de 1% sobre o ganho", () => {
  const t = computeTax([T("2026-05-10", "VALE3", "C", 100, 60), T("2026-05-10", "VALE3", "V", 100, 65)], O);
  assert.equal(t.months[0].tax_daytrade, "100.00"); assert.equal(t.months[0].irrf, "5.00"); assert.equal(t.months[0].darf.valor, "95.00");
});
test("BR-IRPF-FII@2026.1 — 20%, sem isenção, prejuízo só abate FII", () => {
  const t = computeTax([T("2026-04-01", "HGLG11", "C", 100, 150, { asset_class: "fii" }), T("2026-04-20", "HGLG11", "V", 100, 160, { asset_class: "fii" })], O);
  assert.equal(t.months[0].exempt, true); assert.equal(t.months[0].tax_fii, "200.00");
});
test("reprodutibilidade: mesma entrada + regra + motor = mesmo hash; motor declarado", () => {
  const tr = [T("2026-03-02", "PETR4", "C", 1000, 30), T("2026-03-20", "PETR4", "V", 1000, 33)];
  const a = computeTax(tr, O), b = computeTax(JSON.parse(JSON.stringify(tr)), O);
  assert.equal(a.snapshot_hash, b.snapshot_hash); assert.equal(a.engine_version, ENGINE_VERSION);
  assert.notEqual(a.snapshot_hash, computeTax(tr, { ...O, priorLosses: { comum: 100 } }).snapshot_hash);
  assert.ok(a.quality.factors.every(f => f.ok));
});
test("ano sem regra vigente: usa referência, avisa e limita a confiança", () => {
  const t = computeTax([T("2025-03-02", "PETR4", "C", 1000, 30), T("2025-03-20", "PETR4", "V", 1000, 33)], { year: 2025, refDate: "2025-12-20" });
  assert.match(t.limitations[0], /Não há versão de regra validada com vigência em 2025/); assert.ok(t.confidence <= 0.5);
  assert.equal(t.quality.factors.find(f => f.factor === "Versão da regra").ok, false);
});
test("simulador: cenários B e C com estrutura completa (v5.0 §9.2)", () => {
  const r = simulateScenarios({ trades: [T("2026-03-02", "PETR4", "C", 1000, 30)], positions: [{ ticker: "PETR4", quantity: 1000, value: 36000, price: 36 }],
    scenarios: [{ name: "B", operations: [{ ticker: "PETR4", quantity: 500, date: "2026-11-10" }] }, { name: "C", operations: [{ ticker: "PETR4", quantity: 1000, date: "2026-11-10" }] }], opts: { refDate: "2026-11-01" } });
  assert.equal(r.results.length, 3); assert.equal(r.results[1].tax_difference_vs_base, "0.00"); assert.equal(r.results[2].tax_difference_vs_base, "898.20");
  for (const k of ["name", "inputs", "assumptions", "rule_versions", "calculation_version", "result", "delta_vs_baseline", "confidence", "limitations", "audit_artifact"]) assert.ok(k in r.results[2].scenario, k);
  assert.match(simulatePgbl({ taxable_income: "100000", current_contributions: "0", extra_contribution: "1000", marginal_rate: "0.275", full_model: true, contributes_social_security: true }).premises.join(" "), /VGBL não é dedutível/);
});
