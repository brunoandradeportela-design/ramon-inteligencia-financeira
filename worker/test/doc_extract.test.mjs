import test from "node:test";
import assert from "node:assert/strict";
import { NOTA } from "./fixtures_docs.mjs";
import { extract, notaToTrades, cnpjValid, cpfValid, resolveTicker, detectDocType } from "../../apps/web/app/js/doc_extract.js";


test("nota SINACOR: negócios, resumo, conferência e rateio de custos", () => {
  const x = extract(NOTA, { userMap: { "FII XP LOG CI": "XPLG11" }, refDate: "2026-10-06" });
  assert.equal(x.type, "nota_corretagem");
  assert.equal(x.header.numero, "45871"); assert.equal(x.header.data_pregao, "2026-03-16"); assert.equal(x.header.cnpj, "02.332.886/0001-04");
  assert.equal(x.negocios.length, 5);
  const [p, v, iv, ic, f] = x.negocios;
  assert.deepEqual([p.ticker, p.ticker_origem, p.quantidade, p.preco, p.valor], ["PETR4", "mapa_interno", 100, 30, 3000]);
  assert.equal(v.ticker, "VALE3"); assert.equal(v.mercado, "FRACIONARIO");
  assert.equal(iv.daytrade, true); assert.equal(iv.ticker, "ITUB4"); assert.equal(ic.side, "C");
  assert.equal(f.ticker, "XPLG11"); assert.equal(f.ticker_origem, "mapa_do_cliente"); assert.equal(f.classe, "fii");
  assert.equal(x.resumo.vendas_a_vista, 7100); assert.equal(x.resumo.compras_a_vista, 11300); assert.equal(x.resumo.irrf, 0.35);
  assert.equal(x.validation.ok, true, JSON.stringify(x.validation.checks.filter(c => !c.ok)));
  assert.ok(x.validation.checks.find(c => c.id === "liquido_final").ok, "líquido conferido");
  const t = notaToTrades(x);
  assert.equal(t.length, 5); assert.equal(Math.round(t.reduce((s, y) => s + y.fees, 0) * 100) / 100, 16.46, "custos rateados somam o total da nota");
  assert.ok(t.every(y => y.date === "2026-03-16" && y.nota === "45871")); assert.equal(t[2].daytrade, true);
});

test("nota com ativo desconhecido e soma divergente bloqueia a importação", () => {
  const bad = NOTA.map(l => l.replace("FII XP LOG CI 10 100,00 1.000,00", "FII XP LOG CI 10 100,00 1.010,00"));
  const x = extract(bad, { refDate: "2026-10-06" });
  assert.equal(x.validation.ok, false);
  const failed = x.validation.checks.filter(c => !c.ok).map(c => c.id);
  assert.ok(failed.includes("ativos") && failed.includes("linha_5") && failed.includes("compras"), failed.join(","));
});

test("DARF pago, informe e recibo com validação de CPF/CNPJ", () => {
  const darf = extract(["Comprovante de Arrecadação", "Documento de Arrecadação de Receitas Federais", "Código da Receita 6015", "Período de Apuração 31/03/2026",
    "Data de Vencimento 30/04/2026", "Data de Arrecadação 28/04/2026", "Valor do Principal 1.419,88", "Valor Total 1.419,88"], { refDate: "2026-10-06" });
  assert.equal(darf.type, "darf"); assert.equal(darf.competencia, "2026-03"); assert.equal(darf.valor_total, 1419.88); assert.equal(darf.validation.ok, true);
  const guia = extract(["Documento de Arrecadação de Receitas Federais", "Código da Receita 6015", "Período de Apuração 31/03/2026", "Valor Total 10,00"], { type: "darf" });
  assert.equal(guia.validation.ok, false, "guia sem pagamento não baixa DARF");
  const inf = extract(["INFORME DE RENDIMENTOS FINANCEIROS", "Ano-calendário 2025", "Fonte pagadora", "XP INVESTIMENTOS CCTVM S/A 02.332.886/0001-04",
    "Rendimentos isentos e não tributáveis 1.234,56", "Rendimentos sujeitos à tributação exclusiva 789,10", "Imposto retido na fonte 98,76", "Saldo em 31/12/2025 50.000,00"], { refDate: "2026-10-06" });
  assert.equal(inf.type, "informe_rendimentos"); assert.equal(inf.ano_calendario, 2025); assert.equal(inf.valores.rendimentos_isentos, 1234.56); assert.equal(inf.valores.irrf, 98.76);
  assert.equal(inf.validation.ok, true);
  assert.equal(cnpjValid("02.332.886/0001-04"), true); assert.equal(cnpjValid("02.332.886/0001-05"), false);
  assert.equal(cpfValid("529.982.247-25"), true); assert.equal(cpfValid("529.982.247-24"), false);
  const rec = extract(["RECIBO", "Recebi de Fulano a importância de R$ 350,00 referente a consulta", "Dra. Maria CPF 529.982.247-25", "Porto Velho, 10/05/2026"]);
  assert.equal(rec.type, "recibo"); assert.equal(rec.valor, 350); assert.equal(rec.validation.ok, true);
  assert.equal(detectDocType("cardápio do restaurante"), null);
  assert.equal(resolveTicker("BBAS3 ON NM").ticker, "BBAS3");
});
