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
// ---- imposto sobre negociações reais (M4)
assert.equal((await call("GET", "/v1/tax/summary", null, tk)).status, 402, "plano Free não tem apuração");
const pro = await call("POST", "/v1/auth/register", { name: "Julia Prado Reis", email: "pro" + email, profession: "Contadora", phone: "(69) 99811-2235", password: "senhaSegura123", accept_terms: true, plan: "pro" });
const tp = pro.body.token;
assert.equal((await call("GET", "/v1/tax/summary", null, tp)).body.has_data, false);
const neg = parseB3Workbook({ "Negociação": [["Data do Negócio", "Tipo de Movimentação", "Mercado", "Instituição", "Código de Negociação", "Quantidade", "Preço", "Valor"],
  ["02/03/2026", "Compra", "Mercado à Vista", "XP", "VALE3", "1000", "60,00", "60.000,00"], ["10/04/2026", "Venda", "Mercado à Vista", "XP", "VALE3", "1000", "70,00", "70.000,00"],
  ["10/06/2026", "Compra", "Mercado à Vista", "XP", "PETR4", "300", "30,00", "9.000,00"], ["10/06/2026", "Venda", "Mercado à Vista", "XP", "PETR4", "200", "32,00", "6.400,00"]] });
assert.equal((await call("POST", "/v1/imports", { filename: "negociacao.xlsx", ...neg }, tp)).status, 201);
let t = (await call("GET", "/v1/tax/summary?year=2026", null, tp)).body;
assert.equal(t.has_data, true); assert.equal(t.months.find(m => m.month === "2026-04").darf.valor, "1496.50");
assert.equal(t.months.find(m => m.month === "2026-06").result_daytrade, "400.00");
const ev = (await call("GET", "/v1/tax/events?year=2026", null, tp)).body;
assert.equal(ev.items.length, 2); assert.equal(ev.items[0].modality, "daytrade");
assert.equal((await call("PUT", "/v1/tax/settings", { prior_losses: { comum: "1.000,00".replace(/\./g, "").replace(",", ".") } }, tp)).body.prior_losses.comum, "1000.00");
assert.equal((await call("PUT", "/v1/tax/darfs/2026-04", { paid_value: "1346.50" }, tp)).status, 200);
t = (await call("GET", "/v1/tax/summary?year=2026", null, tp)).body;
const abr = t.months.find(m => m.month === "2026-04");
assert.equal(abr.base_comum, "9000.00"); assert.equal(abr.darf.status, "pago"); assert.equal(abr.darf.valor_pago, "1346.50");
assert.equal((await call("PUT", "/v1/tax/darfs/2026-04", { paid_value: "0" }, tp)).status, 422);
const dash = (await call("GET", "/v1/dashboard", null, tp)).body;
assert.equal(dash.tax.estimated, t.total_tax_due); assert.match(dash.tax.scope, /suas negociações/);
// posições criadas a partir das negociações (sem posição da B3 importada)
const pp = (await call("GET", "/v1/portfolio/consolidated", null, tp)).body;
assert.equal(pp.positions.length, 1); assert.equal(pp.positions[0].ticker, "PETR4"); assert.equal(pp.positions[0].quantity, "100");
// ---- radar e simulador sobre os dados reais (M6)
const al = (await call("GET", "/v1/alerts", null, tp)).body;
assert.equal(al.has_data, true); assert.equal(al.limited, false); assert.ok(al.items.some(x => x.code === "DARF_VENCIDO"));
const first = al.items[0];
assert.equal((await call("PATCH", `/v1/alerts/${first.id}`, { status: "resolvido" }, tp)).body.status, "resolvido");
assert.equal((await call("GET", "/v1/alerts", null, tp)).body.items.find(x => x.id === first.id).status, "resolvido");
assert.equal((await call("PATCH", `/v1/alerts/${first.id}`, { status: "xx" }, tp)).status, 422);
assert.equal((await call("GET", "/v1/alerts", null, tk)).body.limited, true);
const future = new Date(Date.now() + 5 * 864e5).toISOString().slice(0, 10);
const sim = await call("POST", "/v1/simulations", { kind: "venda_ativos", scenarios: [{ operations: [{ ticker: "PETR4", quantity: 100, date: future, price: "35,00" }] }] }, tp);
assert.equal(sim.status, 201, JSON.stringify(sim.body)); assert.equal(sim.body.results[1].liquidity_generated, "3500.00");
assert.equal((await call("POST", "/v1/simulations", { kind: "pgbl", taxable_income: "100000", current_contributions: "0", extra_contribution: "5000", marginal_rate: "0.275", full_model: true, contributes_social_security: true }, tp)).body.difference, "1375.00");
assert.equal((await call("GET", "/v1/simulations", null, tp)).body.items.length, 2);
assert.equal((await call("POST", "/v1/simulations", { kind: "pgbl", taxable_income: "1" }, tk)).status, 402);
assert.equal((await call("POST", "/v1/simulations", { kind: "venda_ativos", scenarios: [{ operations: [{ ticker: "PETR4", quantity: 1, date: "2020-01-01" }] }] }, tp)).status, 422);
// ---- mercado (M3): rota pública responde mesmo sem rede externa
const mk = await call("GET", "/v1/market/indices");
assert.equal(mk.status, 200); assert.ok("indices" in mk.body && "quotes" in mk.body);
assert.equal((await call("POST", "/v1/market/refresh", null, tp)).status, 403);
console.log("IMPORTS E2E OK — importação, deduplicação, custo médio, painéis reais, substituição de posição, isolamento, exclusão, imposto (M4), mercado (M3), radar e simulador (M6)");
