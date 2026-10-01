import test from "node:test";
import assert from "node:assert/strict";
import { parseOFX, parseCSV, parseB3Workbook, parseNotaCorretagem, parseNumber, parseDate } from "../../apps/web/app/js/importers.js";
import { financeSummary, portfolioSummary, dashboardSummary, categorize, averageCost } from "../../apps/web/app/js/fin_engine.js";

test("números e datas no padrão brasileiro", () => {
  assert.equal(parseNumber("1.234,56"), 1234.56); assert.equal(parseNumber("-R$ 10,00"), -10);
  assert.equal(parseNumber("(50,00)"), -50); assert.equal(parseNumber("1,234.56"), 1234.56); assert.equal(parseNumber("3.050"), 3050);
  assert.equal(parseNumber("99,90 D"), -99.9); assert.equal(parseDate("05/09/2026"), "2026-09-05");
  assert.equal(parseDate("20260915120000[-3:BRT]"), "2026-09-15"); assert.equal(parseDate(46290), "2026-09-25");
});

const OFX_SGML = `OFXHEADER:100
DATA:OFXSGML
<OFX><SIGNONMSGSRSV1><SONRS><FI><ORG>ITAU<FID>341</FI></SONRS></SIGNONMSGSRSV1>
<BANKMSGSRSV1><STMTTRNRS><STMTRS><CURDEF>BRL<BANKACCTFROM><BANKID>0341<ACCTID>12345-6<ACCTTYPE>CHECKING</BANKACCTFROM>
<BANKTRANLIST><DTSTART>20260901
<STMTTRN><TRNTYPE>CREDIT<DTPOSTED>20260905<TRNAMT>12500.00<FITID>A1<MEMO>SALARIO EMPRESA X</STMTTRN>
<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20260906120000[-3:BRT]<TRNAMT>-1095,40<FITID>A2<MEMO>SUPERMERCADO PAGUE MENOS</STMTTRN>
<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20260910<TRNAMT>-5000.00<FITID>A3<MEMO>APLICACAO CDB</STMTTRN>
</BANKTRANLIST><LEDGERBAL><BALAMT>8421.77<DTASOF>20260930</LEDGERBAL></STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>`;

test("OFX 1.x (SGML) de conta corrente", () => {
  const r = parseOFX(OFX_SGML);
  assert.equal(r.accounts.length, 1); assert.equal(r.accounts[0].balance, 8421.77); assert.equal(r.accounts[0].institution, "ITAU");
  assert.equal(r.transactions.length, 3); assert.equal(r.transactions[1].amount, -1095.4); assert.equal(r.transactions[1].date, "2026-09-06");
});

test("OFX 2.x (XML) de cartão de crédito", () => {
  const xml = `<?xml version="1.0"?><OFX><CREDITCARDMSGSRSV1><CCSTMTTRNRS><CCSTMTRS><CCACCTFROM><ACCTID>5555</ACCTID></CCACCTFROM><BANKTRANLIST>
  <STMTTRN><TRNTYPE>DEBIT</TRNTYPE><DTPOSTED>20260912</DTPOSTED><TRNAMT>-55.90</TRNAMT><FITID>c1</FITID><NAME>NETFLIX.COM</NAME></STMTTRN>
  </BANKTRANLIST></CCSTMTRS></CCSTMTTRNRS></CREDITCARDMSGSRSV1></OFX>`;
  const r = parseOFX(xml);
  assert.equal(r.accounts[0].type, "cartao"); assert.equal(r.transactions[0].description, "NETFLIX.COM"); assert.equal(r.transactions[0].amount, -55.9);
});

test("CSV Nubank conta e cartão; CSV com débito/crédito separados", () => {
  const conta = parseCSV("Data,Valor,Identificador,Descrição\n05/09/2026,-120.50,abc,Pix enviado João\n06/09/2026,3000.00,def,Transferência recebida\n", { filename: "NU_2026.csv" });
  assert.equal(conta.transactions.length, 2); assert.equal(conta.transactions[0].amount, -120.5); assert.equal(conta.accounts[0].institution, "Nubank");
  const cartao = parseCSV("date,title,amount\n2026-09-03,Uber *Trip,23.40\n2026-09-04,Pagamento recebido,-500.00\n");
  assert.equal(cartao.accounts[0].type, "cartao"); assert.equal(cartao.transactions[0].amount, -23.4); assert.equal(cartao.transactions[1].amount, 500);
  const bb = parseCSV(`"Extrato conta corrente"\n"Data";"Histórico";"Crédito (R$)";"Débito (R$)";"Saldo"\n"01/09/2026";"Saldo Anterior";"";"";"1.000,00"\n"02/09/2026";"Conta de energia";"";"250,30";"749,70"\n"03/09/2026";"Pix recebido";"1.500,00";"";"2.249,70"\n`);
  assert.equal(bb.transactions.length, 2); assert.equal(bb.transactions[0].amount, -250.3); assert.equal(bb.transactions[1].amount, 1500);
});

test("B3: posição (ações, FII, Tesouro, renda fixa), negociação e movimentação", () => {
  const pos = parseB3Workbook({
    "Acoes": [["Produto", "Instituição", "Conta", "Código de Negociação", "CNPJ da Empresa", "Código ISIN / Distribuição", "Tipo", "Escriturador", "Quantidade", "Quantidade Disponível", "Quantidade Indisponível", "Motivo", "Preço de Fechamento", "Valor Atualizado"],
              ["PETR4 - PETROLEO BRASILEIRO S.A. PETROBRAS", "XP INVESTIMENTOS CCTVM S/A", "123", "PETR4", "", "", "PN", "", "300", "300", "0", "", "38,12", "11.436,00"],
              ["", "", "", "", "", "", "", "", "", "", "", "", "Total", "11.436,00"]],
    "Fundo de Investimento": [["Produto", "Instituição", "Conta", "Código de Negociação", "CNPJ do Fundo", "Código ISIN / Distribuição", "Tipo", "Administrador", "Quantidade", "Quantidade Disponível", "Quantidade Indisponível", "Motivo", "Preço de Fechamento", "Valor Atualizado"],
              ["HGLG11 - CSHG LOGISTICA", "XP INVESTIMENTOS CCTVM S/A", "123", "HGLG11", "", "", "Cotas", "", "50", "50", "0", "", "160,50", "8.025,00"]],
    "Tesouro Direto": [["Produto", "Instituição", "Código ISIN", "Indexador", "Vencimento", "Quantidade", "Quantidade Disponível", "Quantidade Indisponível", "Motivo", "Valor Aplicado", "Valor bruto", "Valor líquido", "Valor Atualizado"],
              ["Tesouro IPCA+ 2035", "NU INVEST CORRETORA", "BRSTN", "IPCA", "15/05/2035", "2,5", "2,5", "0", "", "5.000,00", "5.600,00", "5.480,00", "5.600,00"]],
    "Renda Fixa": [["Produto", "Instituição", "Emissor", "Código", "Indexador", "Tipo de regime", "Data de Emissão", "Vencimento", "Quantidade", "Quantidade Disponível", "Quantidade Indisponível", "Motivo", "Contraparte", "Preço Atualizado MTM", "Valor Atualizado MTM", "Preço Atualizado CURVA", "Valor Atualizado CURVA"],
              ["CDB - CDB123", "XP INVESTIMENTOS", "BANCO MASTER", "CDB123", "DI", "", "01/01/2025", "01/01/2028", "10", "10", "0", "", "", "1.100,00", "11.000,00", "1.090,00", "10.900,00"]],
  });
  assert.equal(pos.holdings.length, 4); assert.ok(pos.replace_holdings);
  const petr = pos.holdings.find(h => h.ticker === "PETR4"); assert.equal(petr.value, 11436); assert.equal(petr.asset_class, "acao"); assert.equal(petr.quantity, 300);
  assert.equal(pos.holdings.find(h => h.ticker === "HGLG11").asset_class, "fii");
  const td = pos.holdings.find(h => h.asset_class === "tesouro"); assert.equal(td.invested, 5000); assert.equal(td.maturity, "2035-05-15");
  assert.equal(pos.holdings.find(h => h.asset_class === "renda_fixa").value, 11000);

  const neg = parseB3Workbook({ "Negociação": [["Data do Negócio", "Tipo de Movimentação", "Mercado", "Prazo/Vencimento", "Instituição", "Código de Negociação", "Quantidade", "Preço", "Valor"],
    ["10/03/2026", "Compra", "Mercado à Vista", "-", "XP", "PETR4", "200", "35,00", "7.000,00"],
    ["12/05/2026", "Compra", "Mercado Fracionário", "-", "XP", "PETR4F", "100", "38,00", "3.800,00"],
    ["20/06/2026", "Venda", "Mercado à Vista", "-", "XP", "PETR4", "100", "40,00", "4.000,00"]] });
  assert.equal(neg.trades.length, 3); assert.equal(neg.trades[1].ticker, "PETR4");
  const mov = parseB3Workbook({ "Movimentação": [["Entrada/Saída", "Data", "Movimentação", "Produto", "Instituição", "Quantidade", "Preço unitário", "Valor da Operação"],
    ["Credito", "10/03/2026", "Transferência - Liquidação", "PETR4 - PETROBRAS", "XP", "200", "35,00", "7.000,00"],
    ["Credito", "15/03/2026", "Dividendo", "PETR4 - PETROBRAS", "XP", "200", "0,50", "100,00"]] });
  assert.equal(mov.trades.length, 1); assert.equal(mov.trades[0].side, "C");

  // custo médio: 200@35 + 100@38 = 10.800 / 300 = 36; vende 100 → 200 a 36 = 7.200
  const avg = averageCost(neg.trades); assert.equal(avg.PETR4.qty, 200); assert.equal(Math.round(avg.PETR4.cost), 7200);
  const port = portfolioSummary(pos.holdings, neg.trades);
  const p = port.positions.find(x => x.ticker === "PETR4");
  assert.equal(p.invested, (36 * 300).toFixed(2)); assert.equal(p.result, (11436 - 10800).toFixed(2));
  assert.ok(port.positions.find(x => x.ticker === "HGLG11").invested === null);
  assert.equal(port.allocation[0].group, "Renda Variável");
});

test("nota de corretagem SINACOR (texto do PDF)", () => {
  const nota = `NOTA DE NEGOCIAÇÃO Nr. nota Folha Data pregão 12/05/2026 XP INVESTIMENTOS CCTVM S.A.
Negócios realizados Q Negociação C/V Tipo mercado Prazo Especificação do título Obs. (*) Quantidade Preço / Ajuste Valor Operação / Valor Ajuste D/C
1-BOVESPA C VISTA PETROBRAS PN N2 PETR4 100 38,00 3.800,00 D
1-BOVESPA V FRACIONARIO VALE ON NM 5 62,10 310,50 C
Total Custos / Despesas 1,23`;
  const r = parseNotaCorretagem(nota);
  assert.equal(r.trades.length, 2); assert.equal(r.trades[0].ticker, "PETR4"); assert.equal(r.trades[0].quantity, 100);
  assert.equal(r.trades[1].side, "V"); assert.equal(r.trades[0].date, "2026-05-12"); assert.ok(r.trades[0].fees > 0);
});

test("motor de finanças: neutraliza aplicações, categoriza e calcula liquidez", () => {
  const o = parseOFX(OFX_SGML);
  assert.equal(categorize("APLICACAO CDB", -5000), "Investimentos");
  const f = financeSummary(o.transactions, o.accounts, "2026-09-30");
  assert.equal(f.period.to, "2026-09"); assert.equal(f.totals.income, "12500.00"); assert.equal(f.totals.expense, "1095.40");
  assert.equal(f.liquidity.cash, "8421.77"); assert.equal(f.by_category[0].category, "Alimentação");
  const d = dashboardSummary({ name: "Marina Costa", fin: f, port: portfolioSummary([], []), refDate: "2026-09-30" });
  assert.equal(d.greeting, "Marina"); assert.equal(d.net_worth.total, "8421.77"); assert.ok(d.next_actions.some(a => /B3/.test(a.title)));
});
