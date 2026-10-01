// Importação ponta a ponta contra o Worker local (wrangler dev em AURION_TEST_URL).
import assert from "node:assert/strict";
import { parseOFX, parseB3Workbook } from "../../apps/web/app/js/importers.js";
const B = process.env.AURION_TEST_URL || "http://localhost:8799";
const call = async (method, path, body, token) => {
  const r = await fetch(B + path, { method, body: body ? JSON.stringify(body) : undefined, headers: { "Content-Type": "application/json", ...(token ? { Authorization: "Bearer " + token } : {}) } });
  return { status: r.status, body: r.status === 204 ? null : await r.json() };
};
const email = `imp.${Date.now()}@exemplo.com`;
const reg = await call("POST", "/v1/auth/register", { name: "Carla Souza Melo", email, profession: "Médica", phone: "(69) 99811-2233", password: "senhaSegura123", accept_terms: true });
assert.equal(reg.status, 201); const tk = reg.body.token;
// sem dados: painéis dizem has_data=false (o site mostra o exemplo)
assert.equal((await call("GET", "/v1/dashboard", null, tk)).body.has_data, false);
assert.equal((await call("GET", "/v1/finance/summary")).status, 401, "exige login");
const ofx = parseOFX(`<OFX><SIGNONMSGSRSV1><SONRS><FI><ORG>ITAU</FI></SONRS></SIGNONMSGSRSV1><STMTRS><BANKACCTFROM><BANKID>0341<ACCTID>999</BANKACCTFROM><BANKTRANLIST>
<STMTTRN><DTPOSTED>20260905<TRNAMT>12500.00<FITID>A1<MEMO>SALARIO</STMTTRN>
<STMTTRN><DTPOSTED>20260906<TRNAMT>-1095.40<FITID>A2<MEMO>SUPERMERCADO</STMTTRN>
<STMTTRN><DTPOSTED>20260810<TRNAMT>-900.00<FITID>A3<MEMO>SUPERMERCADO</STMTTRN>
</BANKTRANLIST><LEDGERBAL><BALAMT>20000.00<DTASOF>20260930</LEDGERBAL></STMTRS></OFX>`);
let r = await call("POST", "/v1/imports", { filename: "itau.ofx", ...ofx }, tk);
assert.equal(r.status, 201, JSON.stringify(r.body)); assert.equal(r.body.counts.transactions, 3);
r = await call("POST", "/v1/imports", { filename: "itau-de-novo.ofx", ...ofx }, tk);           // reimportar não duplica
assert.equal((await call("GET", "/v1/finance/transactions?limit=50", null, tk)).body.total, 3);
const b3 = parseB3Workbook({ "Acoes": [["Produto", "Instituição", "Código de Negociação", "Quantidade", "Preço de Fechamento", "Valor Atualizado"], ["PETR4 - PETROBRAS", "XP", "PETR4", "300", "38,12", "11.436,00"]],
  "Negociação": [["Data do Negócio", "Tipo de Movimentação", "Mercado", "Instituição", "Código de Negociação", "Quantidade", "Preço", "Valor"], ["10/03/2026", "Compra", "Vista", "XP", "PETR4", "300", "36,00", "10.800,00"]] });
r = await call("POST", "/v1/imports", { filename: "posicao-b3.xlsx", ...b3 }, tk);
assert.equal(r.status, 201); assert.equal(r.body.counts.holdings, 1); assert.equal(r.body.counts.trades, 1);
const f = (await call("GET", "/v1/finance/summary", null, tk)).body;
assert.equal(f.has_data, true); assert.equal(f.totals.income, "12500.00"); assert.equal(f.liquidity.cash, "20000.00");
const p = (await call("GET", "/v1/portfolio/consolidated", null, tk)).body;
assert.equal(p.total, "11436.00"); assert.equal(p.invested, "10800.00"); assert.equal(p.positions[0].result, "636.00");
const d = (await call("GET", "/v1/dashboard", null, tk)).body;
assert.equal(d.has_data, true); assert.equal(d.net_worth.total, "31436.00"); assert.equal(d.greeting, "Carla");
// nova posição da B3 substitui a anterior
const b3b = parseB3Workbook({ "Acoes": [["Produto", "Instituição", "Código de Negociação", "Quantidade", "Preço de Fechamento", "Valor Atualizado"], ["VALE3 - VALE", "XP", "VALE3", "100", "62,00", "6.200,00"]] });
await call("POST", "/v1/imports", { filename: "posicao-b3-out.xlsx", ...b3b }, tk);
const p2 = (await call("GET", "/v1/portfolio/consolidated", null, tk)).body;
assert.equal(p2.positions.length, 1); assert.equal(p2.positions[0].ticker, "VALE3");
// isolamento: outro cliente não vê nada
const other = await call("POST", "/v1/auth/register", { name: "Pedro Lima Alves", email: "o" + email, profession: "Advogado", phone: "(69) 99811-2234", password: "senhaSegura123", accept_terms: true });
assert.equal((await call("GET", "/v1/portfolio/consolidated", null, other.body.token)).body.has_data, false);
// apagar importação
const list = (await call("GET", "/v1/imports", null, tk)).body.items;
assert.equal(list.length, 4);
const ofxImp = list.find(i => i.filename === "itau-de-novo.ofx");
assert.equal((await call("DELETE", `/v1/imports/${ofxImp.id}`, null, tk)).status, 204);
assert.equal((await call("GET", "/v1/finance/summary", null, tk)).body.has_data, false, "lançamentos da última importação apagados");
assert.equal((await call("POST", "/v1/imports", { filename: "vazio.csv", transactions: [{ date: "x" }] }, tk)).status, 422);
console.log("IMPORTS E2E OK — importação, deduplicação, custo médio, painéis reais, substituição de posição, isolamento e exclusão");
