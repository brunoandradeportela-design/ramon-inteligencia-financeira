import test from "node:test";
import assert from "node:assert/strict";
import { irpfReport } from "../../apps/web/app/js/irpf_report.js";

const T = [
  { date: "2025-03-02", ticker: "PETR4", side: "C", quantity: 1000, price: 30, value: 30000, fees: 5, custodian: "XP INVESTIMENTOS" },
  { date: "2026-03-20", ticker: "PETR4", side: "V", quantity: 500, price: 45, value: 22500, fees: 5, custodian: "XP INVESTIMENTOS" },
  { date: "2026-04-02", ticker: "HGLG11", side: "C", quantity: 10, price: 150, value: 1500, custodian: "XP INVESTIMENTOS" },
  { date: "2026-05-04", ticker: "HGLG11", side: "V", quantity: 5, price: 170, value: 850 },
  { date: "2026-06-02", ticker: "VALE3", side: "C", quantity: 100, price: 60, value: 6000 },
  { date: "2026-06-10", ticker: "VALE3", side: "V", quantity: 100, price: 70, value: 7000 },
];
test("relatório IRPF: bens pelo custo em 31/12, renda variável mês a mês, isentos e premissas", () => {
  const r = irpfReport({ trades: T, year: 2026, refDate: "2027-02-10" });
  assert.equal(r.partial, false); assert.equal(r.renda_variavel.mensal.length, 12);
  const mar = r.renda_variavel.mensal[2]; assert.equal(mar.competencia, "2026-03"); assert.ok(+mar.resultado_comum > 7000, "venda acima de 20 mil tributada");
  const jun = r.renda_variavel.mensal[5]; assert.equal(+jun.ganho_isento, 1000, "venda de R$ 7 mil em junho: ganho isento");
  assert.equal(+r.rendimentos_isentos.ganhos_acoes_ate_20_mil, 1000);
  const petr = r.bens_e_direitos.find(b => b.ticker === "PETR4"), hglg = r.bens_e_direitos.find(b => b.ticker === "HGLG11"), vale = r.bens_e_direitos.find(b => b.ticker === "VALE3");
  assert.deepEqual([petr.grupo, petr.codigo, petr.situacao_anterior, petr.situacao_atual], ["03", "01", "30005.00", "15002.50"]);
  assert.match(petr.discriminacao, /500 ações de PETR4, custodiadas em XP INVESTIMENTOS/);
  assert.deepEqual([hglg.grupo, hglg.codigo, hglg.situacao_anterior, hglg.situacao_atual], ["07", "03", "0.00", "750.00"]);
  assert.equal(vale, undefined, "posição aberta e fechada no ano não vira bem");
  assert.equal(r.totais_bens.situacao_atual, "15752.50");
  assert.ok(r.premissas.some(p => /custo de aquisição/.test(p))); assert.match(r.disclaimer, /contador/);
  const parcial = irpfReport({ trades: T, year: 2026, refDate: "2026-05-01" });
  assert.equal(parcial.partial, true); assert.ok(!parcial.bens_e_direitos.find(b => b.ticker === "HGLG11" && +b.situacao_atual === 750), "ano em andamento considera só até a data");
});
