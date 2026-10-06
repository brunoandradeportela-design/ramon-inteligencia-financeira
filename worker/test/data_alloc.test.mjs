import test from "node:test";
import assert from "node:assert/strict";
import { dedupeTransactions, reconcilePositions, reconcileAccounts, qualityIndicators } from "../../apps/web/app/js/data_quality.js";
import { allocationView } from "../../apps/web/app/js/allocation.js";
import { portfolioSummary } from "../../apps/web/app/js/fin_engine.js";

test("deduplicação: mesma transação em fontes diferentes conta uma vez; repetição na mesma fonte é legítima", () => {
  const t = (id, imp, src, desc = "CAFE", amt = -8) => ({ id, import_id: imp, source: src, date: "2026-09-10", description: desc, amount: amt });
  const r = dedupeTransactions([t("a", "imp_1", "ofx"), t("b", "imp_1", "ofx"), t("c", "of_x", "open_finance:itau"), t("d", "imp_2", "csv", "OUTRO", -5)]);
  assert.equal(r.kept.length, 3); assert.equal(r.duplicates.length, 1);
  assert.ok(r.kept.some(x => x.id === "c"), "Open Finance é a fonte preferida"); assert.equal(r.duplicates[0].duplicate_of, "c");
  const r2 = dedupeTransactions([t("a", "imp_1", "ofx"), t("b", "imp_1", "ofx")]);
  assert.equal(r2.kept.length, 2); assert.equal(r2.duplicates.length, 0);
});
test("reconciliação de posições e contas", () => {
  const rec = reconcilePositions([{ ticker: "PETR4", asset_class: "acao", quantity: 100 }, { ticker: "VALE3", asset_class: "acao", quantity: 50 }, { ticker: "ITUB4", asset_class: "acao", quantity: 10 }],
    { PETR4: { quantidade: "100" }, VALE3: { quantidade: "20" }, BBAS3: { quantidade: "5" } });
  assert.deepEqual(rec.map(r => [r.key, r.state]), [["PETR4", "matched"], ["VALE3", "partial"], ["ITUB4", "unresolved"], ["BBAS3", "conflict"]]);
  const acc = reconcileAccounts([{ name: "Conta", type: "conta", external_id: "1", balance: 900, balance_date: "2026-09-30", previous_balance: { value: 1000, date: "2026-09-01" } }],
    [{ account_id: "1", date: "2026-09-10", amount: -100 }]);
  assert.equal(acc[0].state, "matched");
});
test("indicadores de qualidade e dicas", () => {
  const q = qualityIndicators({ imports: [{ created_at: "2026-09-28T10:00:00Z", counts: { transactions: 9 }, rejected: 1 }], txs: [{ date: "2026-07-01" }, { date: "2026-09-01" }],
    duplicates: [{}], reconciliation: [{ state: "matched" }, { state: "conflict" }], refDate: "2026-10-01" });
  assert.equal(q.month_gaps, 1); assert.equal(q.freshness_days, 3); assert.equal(q.indicators.validity, 0.9); assert.equal(q.indicators.consistency, 0.5);
  assert.ok(q.tips.length >= 3); assert.ok(q.overall > 0 && q.overall < 1);
});
test("alocação: instituição, vencimentos, aportes × performance", () => {
  const port = portfolioSummary([{ id: "1", name: "CDB X", asset_class: "renda_fixa", custodian: "Itaú", value: 10000, invested: 9000, maturity: "2027-01-01" },
    { id: "2", ticker: "PETR4", asset_class: "acao", custodian: "XP", quantity: 100, value: 5000, invested: 4000 }]);
  const v = allocationView({ port, snapshots: [{ date: "2026-08-01", total: "12000.00" }, { date: "2026-10-01", total: "15000.00" }],
    txs: [{ date: "2026-09-05", category: "Investimentos", amount: -2000 }], refDate: "2026-10-01" });
  assert.equal(v.by_institution[0].institution, "Itaú"); assert.equal(v.maturity_ladder[0].value, "10000.00");
  assert.equal(v.flows.net_contributions, "2000.00"); assert.equal(v.flows.performance, "1000.00"); assert.match(v.disclaimer, /Não é recomendação/);
});
