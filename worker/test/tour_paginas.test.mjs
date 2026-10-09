/* Tours de Visão Geral, Patrimônio, Finanças, Radar e Simulador: frases com números vindos dos dados da tela. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as Y from "../../apps/web/app/js/tour_explain2.js";
import { guiaResultado, brl } from "../../apps/web/app/js/tour_explain.js";
import { stepsDashboard, stepsPatrimonio, stepsFinancas, stepsRadar, stepsSimulador } from "../../apps/web/app/js/tour_paginas.js";

const demo = JSON.parse(readFileSync(new URL("../../apps/web/app/data/demo.json", import.meta.url)));
const { dashboard: d, portfolio: p, finance: f, alerts: res } = demo;

test("patrimônio total = investimentos + saldo, com a variação da curva", () => {
  const s = Y.patrimonioTotal(d);
  const inv = +d.net_worth.total - +d.liquidity.cash;
  assert.ok(s.includes(brl(d.net_worth.total)) && s.includes(brl(inv)) && s.includes(brl(d.liquidity.cash)));
  assert.match(s, /variação de/); assert.match(s, /desconta, mês a mês/);
  assert.match(Y.patrimonioTotal({ net_worth: { total: 100, series: [] }, liquidity: { cash: 100 } }), /mais de um mês/);
});
test("liquidez: saldo ÷ despesa média = meses de cobertura", () => {
  const s = Y.liquidez(d);
  assert.ok(s.includes(brl(d.liquidity.cash)) && s.includes(brl(d.liquidity.avg_monthly_expense)));
  assert.ok(s.includes((Math.round(d.liquidity.months_covered * 10) / 10).toLocaleString("pt-BR")));
  assert.match(Y.liquidez({ liquidity: { cash: 10, avg_monthly_expense: 0 } }), /quando houver despesas/);
});
test("alertas do painel e prioridade do Radar seguem a fórmula do motor", () => {
  assert.match(Y.alertasPainel(d), new RegExp(`${d.alerts.open} pontos? de atenção`));
  const a = res.items[0], s = Y.alertaPrioridade(a);
  assert.match(s, new RegExp(`Prioridade ${String(a.priority).replace(".", ",")}`));
  assert.ok(Math.abs(a.impact * a.urgency * a.relevance * a.confidence * 100 - a.priority) < 0.11, "a fórmula explicada é a do motor");
  assert.match(Y.radarResumo(res), /alertas? em aberto/);
});
test("patrimônio: custo, cobertura, resultado, D+2 e HHI", () => {
  assert.ok(Y.resultado(p).includes(brl(p.result)) && Y.resultado(p).includes(brl(p.invested)));
  assert.match(Y.concentracao(p), /HHI/); assert.match(Y.concentracao(p), /0,25/);
  assert.match(Y.liquidezD2(p), /2 dias úteis/);
  const parcial = { ...p, result_coverage: 0.7, positions: [...p.positions, { name: "XPTO3", invested: null, value: 10 }] };
  assert.match(Y.aplicado(parcial), /70% do valor/); assert.match(Y.posicoes(parcial), /1 posição está sem custo de compra \(XPTO3\), por isso aparece/);
  assert.doesNotMatch(Y.aplicado({ ...p, result_coverage: undefined }), /conhecido para 0%/, "sem cobertura informada não inventa 0%");
});
test("finanças: taxa de poupança = saldo ÷ entradas; categorias e recorrências", () => {
  const s = Y.saldoPeriodo(f);
  assert.ok(s.includes(brl(f.totals.net)) && s.includes(brl(f.totals.income)));
  assert.match(s, new RegExp(Math.round(f.totals.savings_rate * 100) + "%"));
  assert.match(Y.saldoPeriodo({ totals: { income: 100, expense: 150, net: -50, savings_rate: -0.5 } }), /negativa/);
  assert.match(Y.categorias(f), /Participação/); assert.match(Y.recorrencias(f), /3 ou mais meses/);
  assert.match(Y.mudancas([]), /30% e R\$ 100/);
});
test("modo demonstração: frases começam com 'Exemplo ilustrativo'", () => {
  const o = { demo: true };
  for (const s of [Y.patrimonioTotal(d, o), Y.impostosAno(d, o), Y.alertasPainel(d, o), Y.alocacao(d, o), Y.liquidez(d, o), Y.mudancas(d.changes, o), Y.proximasAcoes(d, o),
    Y.consolidado(p, o), Y.aplicado(p, o), Y.resultado(p, o), Y.concentracao(p, o), Y.entradas(f, o), Y.saidas(f, o), Y.saldoPeriodo(f, o), Y.radarResumo(res, o)])
    assert.ok(s.startsWith("Exemplo ilustrativo"), s);
});
test("guia exibida: no prazo, em atraso (multa e juros dos dados) e sem guia", () => {
  const atraso = { tipo: "DARF", receita: { codigo: "6015" }, situacao: "em_atraso", vencimento: "2026-04-30", pagamento: "2026-10-09",
    valores: { principal: "1573.43", multa: "314.69", juros: "15.73", total: "1903.85", multa_pct: 20, juros_pct: 1, atraso_dias: 162 } };
  const s = guiaResultado(atraso);
  for (const x of ["30/04/2026", "162 dia", "R$ 1.573,43", "20%", "R$ 314,69", "R$ 15,73", "R$ 1.903,85", "09/10/2026"]) assert.ok(s.includes(x), x);
  assert.match(guiaResultado({ ...atraso, situacao: "no_prazo", vencimento: "2026-10-30", valores: { principal: "100.00", total: "100.00" } }), /no prazo: pague R\$ 100,00 até 30\/10\/2026/);
  assert.match(guiaResultado(null, []), /Nenhuma guia gerada/);
  assert.match(guiaResultado(null, [{ tipo: "DARF", receita: { codigo: "6015" }, total: "50.00", vencimento: "2026-11-30" }]), /mais recente da lista é DARF 6015 de R\$ 50,00/);
});
test("catálogos: ids únicos, títulos e blocos curtos em todas as páginas", () => {
  const ctxs = { dashboard: [stepsDashboard, { d }], patrimonio: [stepsPatrimonio, { p }], financas: [stepsFinancas, { f, tx: { total: 10 } }], radar: [stepsRadar, { res }],
    simulador: [stepsSimulador, { pf: p, sims: { items: [] }, real: false }] };
  for (const [nome, [fn, base]] of Object.entries(ctxs)) {
    const st = fn(), ctx = { ...base, demo: false };
    assert.ok(st.length >= 6, nome);
    assert.equal(new Set(st.map(s => s.id)).size, st.length, nome + ": ids únicos");
    for (const s of st) {
      if (s.when && !s.when(ctx)) continue;
      assert.ok(typeof s.titulo === "function" ? s.titulo(ctx) : s.titulo, `${nome}.${s.id}`);
      for (const k of ["porque", "faz", "representa", "numero"]) {
        const v = typeof s[k] === "function" ? s[k](ctx) : s[k];
        if (v) assert.ok(v.split(/\s+/).length <= 80, `${nome}.${s.id}.${k} longo demais`);
      }
      if (s.final) { const r = s.final(ctx); assert.ok(Array.isArray(r.itens) && r.itens.length <= 3, `${nome}: até 3 pendências`); }
    }
  }
});
