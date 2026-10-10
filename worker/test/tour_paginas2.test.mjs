/* Tours de Notícias, Trader, Inteligência, Documentos, Importar, Conexões e Configurações. */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as Z from "../../apps/web/app/js/tour_explain3.js";
import { stepsNoticias, stepsTrader, stepsInteligencia, stepsDocumentos, stepsImportar, stepsConexoes, stepsConfiguracoes } from "../../apps/web/app/js/tour_paginas2.js";

const o = { has_data: true, totals: { trades: 8, gross_pnl: "1500.00", costs: "120.00", net_pnl: "1380.00", tax_estimate: "207.00" }, win_rate: 0.625, profit_factor: 2.4,
  max_drawdown: "-430.00", tax: { total_tax_due: "250.00", next_darf: { competencia: "2026-09", valor: "250.00", vencimento: "2026-10-30", status: "aberto" } },
  open: [{ ticker: "PETR4" }], by_strategy: [], watched: ["VALE3"], journal_entries: 2, backtests: 1 };

test("trader: resultado = bruto − custos; acerto, profit factor e drawdown em valor absoluto", () => {
  const r = Z.traderResultado(o);
  for (const x of ["R$ 1.500,00", "R$ 120,00", "R$ 1.380,00", "8 operações fechadas"]) assert.ok(r.includes(x), x);
  const a = Z.traderAcerto(o);
  assert.match(a, /5 de 8 operações com lucro = 62,5%|5 de 8 operações com lucro = 63%/); assert.match(a, /2,40/);
  assert.match(Z.traderAcerto({ ...o, profit_factor: null }), /sem perdas/);
  assert.match(Z.traderDrawdown(o), /^R\$ 430,00 foi a maior queda/);
  assert.match(Z.traderImposto(o), /15% em operações comuns, 20% em day trade/); assert.match(Z.traderImposto(o), /R\$ 250,00/);
  assert.match(Z.traderResultado({ totals: { trades: 0 } }), /Nenhuma operação fechada/);
});
test("notícias: contagem, regra de pontuação e fontes fora do ar", () => {
  const s = Z.noticias([{ relevance: 4, why: "menciona PETR4" }, { relevance: 0 }], [{ name: "Receita", status: "ok" }, { name: "CVM", status: "desatualizado" }]);
  assert.match(s, /2 notícias coletadas de 2 fontes oficiais; 1 está ligada/); assert.match(s, /3 pontos por ativo/); assert.match(s, /menciona PETR4/); assert.match(s, /CVM/);
});
test("documentos e importações", () => {
  const ck = { year: 2026, delivery_year: 2027, done: 3, total: 8, items: [{ title: "Informe do banco", done: false }, { title: "DARF", done: true }] };
  const s = Z.checklistIR(ck); assert.match(s, /3 de 8 itens prontos para a declaração de 2027 \(ano-calendário 2026\), 38%/); assert.match(s, /Faltam: Informe do banco/);
  assert.match(Z.documentosLista({ items: [{ status: "conferido" }, {}], used_bytes: 2097152, quota_bytes: 52428800 }), /2 documentos guardados, 1 com leitura conferida.*2 MB de 50 MB/);
  const imp = Z.importacoes({ items: [{ filename: "itau.ofx", counts: { transactions: 30 }, created_at: "2026-10-01" }, { filename: "b3.xlsx", counts: { holdings: 3, trades: 4 }, created_at: "2026-10-05" }] });
  assert.match(imp, /2 importações somando 30 lançamentos, 3 posições e 4 negociações/); assert.match(imp, /Mais recente: b3.xlsx/);
  assert.match(Z.importacoes({ items: [] }), /Nenhuma importação/);
});
test("conexões: Open Finance desligado e nota de qualidade ponderada", () => {
  assert.match(Z.openFinance({ configured: false }), /contrato com o agregador/);
  const s = Z.qualidadeDados({ overall: 0.86, indicators: { freshness: 1, completeness: 0.8, validity: 1, consistency: 0.75, duplicates: 1 }, freshness_days: 3, tips: ["Importe mais meses."] });
  assert.match(s, /Nota geral 86%/); assert.match(s, /Atualização 100% \(peso 20%\)/); assert.match(s, /Consistência 75% \(peso 25%\)/); assert.match(s, /há 3 dia/);
  const pesos = [20, 25, 15, 25, 15].reduce((a, b) => a + b, 0); assert.equal(pesos, 100, "pesos somam 100% como no motor");
});
test("catálogos das sete páginas: ids únicos e blocos curtos", () => {
  const ctx = { daily: { date: "2026-10-10", sections: [{ title: "Patrimônio" }], version: "daily@1" }, ranked: [], sources: [], o, res: { items: [], checklist: { year: 2026, delivery_year: 2027, done: 0, total: 1, items: [] } },
    list: { items: [] }, st: { configured: false }, dq: { overall: 0.5, indicators: {}, tips: [] } };
  for (const fn of [stepsNoticias, stepsTrader, stepsInteligencia, stepsDocumentos, stepsImportar, stepsConexoes, stepsConfiguracoes]) {
    const st = fn(); assert.ok(st.length >= 3, fn.name); assert.equal(new Set(st.map(s => s.id)).size, st.length, fn.name);
    for (const s of st) for (const k of ["titulo", "porque", "faz", "representa", "numero"]) {
      const v = typeof s[k] === "function" ? s[k](ctx) : s[k];
      if (k === "titulo") assert.ok(v, `${fn.name}.${s.id}`);
      if (v) assert.ok(String(v).split(/\s+/).length <= 90, `${fn.name}.${s.id}.${k}`);
    }
  }
});
