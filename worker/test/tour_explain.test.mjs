/* Frases do tour da Tributação: cada número explicado vem dos dados (summary, events, rules), nunca de texto fixo. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as X from "../../apps/web/app/js/tour_explain.js";
import { stepsTributacao } from "../../apps/web/app/js/tour_tributacao.js";

const demo = JSON.parse(readFileSync(new URL("../../apps/web/app/data/demo.json", import.meta.url)));
const rules = demo.tax_rules;
const mes = (month, o = {}) => ({ month, sales_acoes: "0.00", exempt: true, result_comum: "0.00", result_acoes: "0.00", result_daytrade: "0.00", result_fii: "0.00", exempt_gain: "0.00",
  base_comum: "0.00", base_daytrade: "0.00", base_fii: "0.00", irrf: "0.00", tax_due_gross: "0.00", tax_due: "0.00", darf: null, confidence: 1, ...o });
const T = (months, o = {}) => ({ year: 2026, reference_date: "2026-10-08", months, total_tax_due: "0.00", total_irrf: "0.00", total_exempt_gain: "0.00",
  losses_available: { comum: "0.00", daytrade: "0.00", fii: "0.00" }, confidence: 1, premises: [], limitations: ["Estimativa: não substitui a apuração oficial nem a revisão de um contador."], snapshot_hash: "abc", ...o });
const semCusto = { id: "x", date: "2026-03-12", ticker: "PETR4", asset_class: "acao", kind: "dado_incompleto", sale_value: "4200.00", cost_basis: "?", result: "?", rule: { code: "BR-IRPF-RV-COMUM", version: "2026.1" }, confidence: 0.3, status: "pendente_dado" };

test("confiança 55%: cita ativo, data e o caminho para elevar", () => {
  const t = T([mes("2026-03", { sales_acoes: "4200.00", confidence: 0.55 })], { confidence: 0.55, limitations: ["Há vendas sem o histórico de compras: …"] });
  const s = X.confianca(t, { items: [semCusto] });
  assert.match(s, /55%/); assert.match(s, /PETR4/); assert.match(s, /12\/03\/2026/); assert.match(s, /mar\/2026/);
  assert.match(s, /Importe o relatório de Negociação/); assert.match(s, /menor valor entre os meses, não a média/);
});
test("confiança 80%: classe deduzida, cita a posição da B3", () => {
  const t = T([mes("2026-04", { confidence: 0.8 })], { confidence: 0.8, limitations: ["Alguns ativos tiveram a classe (ação, FII, ETF) inferida pelo código; importe a posição da B3 para confirmar."] });
  const s = X.confianca(t, { items: [] });
  assert.match(s, /80%/); assert.match(s, /deduzida/); assert.match(s, /posição da B3/);
});
test("confiança 50%: ano sem regra validada, cita a regra", () => {
  const nota = "Não há versão de regra validada com vigência em 2027; usados os parâmetros da versão 2026.1 como referência.";
  const t = T([mes("2027-01")], { year: 2027, confidence: 0.5, limitations: [nota] });
  const s = X.confianca(t, { items: [] });
  assert.match(s, /50%/); assert.ok(s.includes(nota)); assert.match(s, /versão validada da regra/);
});
test("confiança 100%: não sugere ação", () => {
  const s = X.confianca(T([mes("2026-02")]), { items: [] });
  assert.match(s, /^100%/); assert.doesNotMatch(s, /Para elevar|Importe/);
});
test("imposto zero: três motivos diferentes", () => {
  const isento = X.impostoEstimado(T([mes("2026-02", { sales_acoes: "15000.00", result_acoes: "900.00", exempt_gain: "900.00" })], { total_exempt_gain: "900.00" }), rules);
  const prejuizo = X.impostoEstimado(T([mes("2026-04", { sales_acoes: "30000.00", exempt: false, result_comum: "-1200.00", result_acoes: "-1200.00" })]), rules);
  const nada = X.impostoEstimado(T([]), rules);
  assert.match(isento, /limite de isenção/); assert.match(prejuizo, /prejuízo/); assert.match(nada, /Ainda não há negociações/);
  assert.equal(new Set([isento, prejuizo, nada]).size, 3);
});
test("imposto positivo: soma as guias, alíquotas e mínimo vindos das regras", () => {
  const s = X.impostoEstimado(demo.tax, rules);
  assert.match(s, /R\$ 1\.419,88/); assert.match(s, /15% em operações comuns/); assert.match(s, /20% em day trade/); assert.match(s, /R\$ 10,00/);
  assert.match(s, /ago\/2026: R\$ 396,20 \(em aberto\)/);
});
test("isenção segue o motor (<=): R$ 19.999,99 isento e R$ 20.000,01 tributável", () => {
  const a = X.mesDarf(mes("2026-05", { sales_acoes: "19999.99", exempt: true, exempt_gain: "800.00" }), rules);
  const b = X.mesDarf(mes("2026-06", { sales_acoes: "20000.01", exempt: false, result_comum: "800.00", base_comum: "800.00", tax_due_gross: "120.00",
    darf: { codigo: "6015", valor: "119.00", vencimento: "2026-07-31", status: "aberto" } }), rules);
  assert.match(a, /R\$ 19\.999,99/); assert.match(a, /dentro do limite de R\$ 20\.000,00/); assert.match(a, /isento/);
  assert.match(b, /R\$ 20\.000,01/); assert.match(b, /acima do limite/); assert.match(b, /31\/07\/2026/);
});
test("DARF abaixo de R$ 10: acumula para o mês seguinte", () => {
  const s = X.mesDarf(mes("2026-07", { sales_acoes: "25000.00", exempt: false, result_comum: "40.00", base_comum: "40.00", tax_due_gross: "6.00" }), rules);
  assert.match(s, /acumula para o mês seguinte/);
  assert.match(X.impostoEstimado(T([mes("2026-07", { sales_acoes: "25000.00", exempt: false, result_comum: "40.00", base_comum: "40.00", tax_due_gross: "6.00" })]), rules), /acumulado/);
});
test("modo demonstração: todas as frases começam com 'Exemplo ilustrativo'", () => {
  const o = { demo: true }, t = demo.tax, ev = demo.tax_events;
  for (const s of [X.abertura(t, o), X.impostoEstimado(t, rules, o), X.irrf(t, rules, o), X.ganhosIsentos(t, rules, o), X.confianca(t, ev, o), X.prejuizos(t, o),
    X.mesDarf(t.months[0], rules, o), X.evento(ev.items[0], o), X.vendasSemCompra(ev, o), X.resumoFinal(t, ev, t.reference_date, o).texto])
    assert.ok(s.startsWith("Exemplo ilustrativo"), s);
});
test("resumo final: até 3 pendências, DARF a vencer e venda sem compra", () => {
  const r = X.resumoFinal(demo.tax, demo.tax_events, demo.tax.reference_date);
  assert.ok(r.itens.length >= 1 && r.itens.length <= 3);
  assert.match(r.itens[0].texto, /ago\/2026/); assert.equal(r.itens[0].href, "#/tributacao?competencia=2026-08");
  assert.ok(r.itens.some(x => /TAEE11/.test(x.texto) && x.href === "#/importar"));
  assert.match(X.resumoFinal(T([mes("2026-02")]), { items: [] }, "2026-10-08").texto, /completa para os dados enviados/);
});
test("DARF vencido aparece primeiro", () => {
  const t = T([mes("2026-08", { darf: { codigo: "6015", valor: "50.00", vencimento: "2026-09-30", status: "vencido" } }), mes("2026-09", { confidence: 0.55 })], { confidence: 0.55 });
  const r = X.resumoFinal(t, { items: [semCusto] }, "2026-10-08");
  assert.match(r.itens[0].texto, /venceu em 30\/09\/2026/);
});

/* nenhum número inventado: todo número da frase existe nos dados (valores, datas, percentuais de parâmetros) ou é contagem */
function numerosDosDados(...objs) {
  const set = new Set(), add = v => set.add(String(v));
  const walk = v => {
    if (v == null) return;
    if (typeof v === "object") return Object.values(v).forEach(walk);
    const s = String(v); add(s);
    if (/^-?\d+(\.\d+)?$/.test(s)) { const x = +s; add(X.brl(Math.abs(x)).replace("R$ ", "")); add(X.brl(x).replace("R$ ", "")); add(Math.round(x * 100)); add(String(x).replace(".", ",")); add(X.pctParam(x).replace("%", "")); add(Math.trunc(x)); }
    for (const d of s.match(/\d{4}-\d{2}(-\d{2})?/g) || []) { const [y, m, dd] = d.split("-"); add(y); add(m); if (dd) { add(dd); add(`${dd}/${m}/${y}`); } }
  };
  objs.forEach(walk);
  return set;
}
test("as frases só usam números presentes nos dados (amostragem)", () => {
  const t = demo.tax, ev = demo.tax_events, ok = numerosDosDados(t, ev, rules);
  const frases = [X.impostoEstimado(t, rules), X.irrf(t, rules), X.ganhosIsentos(t, rules), X.confianca(t, ev), X.prejuizos(t), ...t.months.map(m => X.mesDarf(m, rules)), ...ev.items.map(e => X.evento(e))];
  const contagemMax = Math.max(t.months.length, ev.items.length);
  for (const f of frases) for (const num of f.replace(/\b[A-Z]{4}\d{1,2}\b/g, "").replace(/BR-IRPF-[A-Z-]+/g, "").match(/\d[\d.,/]*\d|\d/g) || []) {
    const limpo = num.replace(/[.,]$/, "");
    const partes = limpo.includes("/") && !/^\d{2}\/\d{2}\/\d{4}$/.test(limpo) ? limpo.split("/") : [limpo];   // "mai/2026" vira "2026"
    for (const p of partes) {
      const inteiro = /^\d+$/.test(p) && +p <= contagemMax;   // contagens (ex.: "7 meses")
      assert.ok(ok.has(p) || inteiro || p === "100", `número "${p}" não está nos dados: ${f}`);
    }
  }
});

test("catálogo: todo passo tem título e os blocos não estouram ~60 palavras", () => {
  const ctx = { t: demo.tax, ev: demo.tax_events, rules, demo: false, real: true, hoje: demo.tax.reference_date };
  const st = stepsTributacao();
  assert.ok(st.length >= 30, "cerca de 30 passos");
  assert.equal(new Set(st.map(s => s.id)).size, st.length, "ids únicos");
  for (const s of st) {
    if (s.when && !s.when(ctx)) continue;
    assert.ok(typeof s.titulo === "function" ? s.titulo(ctx) : s.titulo, s.id);
    for (const k of ["porque", "faz", "representa"]) {
      const v = typeof s[k] === "function" ? s[k](ctx) : s[k];
      if (v) assert.ok(v.split(/\s+/).length <= 60, `${s.id}.${k} longo demais`);
    }
  }
});
