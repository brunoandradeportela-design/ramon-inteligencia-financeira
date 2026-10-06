// Onda 2: categorias auditáveis, rastreabilidade, deduplicação entre fontes, consentimentos, cobertura, alocação e qualidade.
import assert from "node:assert/strict";
import { start } from "./fake_pluggy.mjs";
import { parseOFX, parseB3Workbook } from "../../apps/web/app/js/importers.js";
const fake = await start(9912);
const B = process.env.AURION_TEST_URL || "http://localhost:8799";
const call = async (method, path, body, token) => {
  const r = await fetch(B + path, { method, body: body ? JSON.stringify(body) : undefined, headers: { "Content-Type": "application/json", ...(token ? { Authorization: "Bearer " + token } : {}) } });
  return { status: r.status, body: r.status === 204 ? null : await r.json() };
};
const reg = async n => (await call("POST", "/v1/auth/register", { name: "Clara Matos Reis", email: `cf${n}.${Date.now()}@exemplo.com`, profession: "Arquiteta", phone: "(69) 99811-40" + (10 + n), password: "senhaSegura123", accept_terms: true, plan: "pro" })).body;
const a = await reg(1), tk = a.token;
// arquivo OFX com o mesmo salário que virá do Open Finance
const ofx = parseOFX(`<OFX><STMTRS><BANKACCTFROM><BANKID>0341<ACCTID>777</BANKACCTFROM><BANKTRANLIST>
<STMTTRN><DTPOSTED>20260905<TRNAMT>12000.00<FITID>X1<MEMO>SALARIO EMPRESA X</STMTTRN>
<STMTTRN><DTPOSTED>20260920<TRNAMT>-150.00<FITID>X2<MEMO>FARMACIA DROGASIL</STMTTRN></BANKTRANLIST><LEDGERBAL><BALAMT>9000<DTASOF>20260930</LEDGERBAL></STMTRS></OFX>`);
let r = await call("POST", "/v1/imports", { filename: "itau.ofx", ...ofx, transactions: [...ofx.transactions, { date: "lixo", description: "", amount: "x" }] }, tk);
assert.equal(r.status, 201); assert.equal(r.body.rejected, 1, "registro inválido recusado e contado"); assert.ok(r.body.checksum);
const itemId = (await (await fetch("http://127.0.0.1:9912/__test/items", { method: "POST", body: JSON.stringify({ clientUserId: a.user.id }) })).json()).id;
r = await call("POST", "/v1/openfinance/items", { item_id: itemId }, tk); assert.equal(r.status, 201);
// deduplicação entre fontes: salário de setembro aparece no OFX e no Open Finance, conta uma vez
const txs = (await call("GET", "/v1/finance/transactions?limit=100", null, tk)).body.items;
assert.equal(txs.filter(t => t.description.startsWith("SALARIO") && t.date === "2026-09-05").length, 1);
const fin = (await call("GET", "/v1/finance/summary", null, tk)).body;
assert.equal(fin.series.find(s => s.month === "2026-09").income, "12050.00", "salário 12.000 + estorno 50, sem duplicar");
const dq = (await call("GET", "/v1/data-quality", null, tk)).body;
assert.equal(dq.duplicates, 1); assert.equal(dq.rejected, 1); assert.ok(dq.overall > 0 && dq.overall <= 1); assert.equal(dq.sources.length, 2);
assert.ok(dq.tips.some(t => /repetido/.test(t)));
// categoria corrigida: original preservado, histórico, auditoria, rastreabilidade até o dado bruto
const ifood = txs.find(t => t.description.startsWith("IFOOD"));
assert.equal(ifood.category, "Restaurantes");
r = await call("PATCH", `/v1/finance/transactions/${ifood.id}`, { category: "Alimentação", reason: "mercado pelo app" }, tk);
assert.equal(r.body.category, "Alimentação"); assert.equal(r.body.original_category, "Restaurantes"); assert.equal(r.body.history.length, 1);
const after = (await call("GET", "/v1/finance/transactions?limit=100", null, tk)).body.items.find(t => t.id === ifood.id);
assert.equal(after.category, "Alimentação"); assert.equal(after.original_category, "Restaurantes"); assert.equal(after.category_overridden, true);
const lin = (await call("GET", `/v1/finance/transactions/${ifood.id}/lineage`, null, tk)).body;
assert.equal(lin.original.category, "Restaurantes"); assert.equal(lin.origin.type, "Open Finance"); assert.ok(lin.origin.checksum); assert.equal(lin.origin.payload_version, "pluggy-v1");
assert.equal(lin.corrections[0].reason, "mercado pelo app");
const b = await reg(2);
assert.equal((await call("PATCH", `/v1/finance/transactions/${ifood.id}`, { category: "Lazer" }, b.token)).status, 404, "outra conta não corrige lançamento alheio");
assert.ok((await call("GET", "/v1/audit", null, tk)).body.items.some(i => i.action === "categoria.corrigida"));
assert.ok((await call("GET", "/v1/finance/categories", null, tk)).body.items.includes("Moradia"));
// consentimento e matriz de cobertura
let cons = (await call("GET", "/v1/consents", null, tk)).body.items;
assert.equal(cons.length, 1); assert.equal(cons[0].status, "ativo"); assert.ok(cons[0].scope.includes("Investimentos")); assert.ok(cons[0].expires_at > cons[0].created_at);
const inst = (await call("GET", "/v1/institutions", null, tk)).body;
assert.equal(inst.configured, true); assert.ok(inst.items.some(i => i.name === "Banco Teste" && i.investments)); assert.ok(!inst.items.some(i => i.name === "Pluggy Bank"), "sandbox fora da produção");
const st = (await call("GET", "/v1/openfinance", null, tk)).body.items[0];
assert.equal(st.connection_state, "HEALTHY"); assert.ok(st.last_raw);
// alocação: classe, instituição, vencimentos, benchmark
const b3 = parseB3Workbook({ "Tesouro Direto": [["Produto", "Instituição", "Quantidade", "Vencimento", "Valor Aplicado", "Valor Atualizado"], ["Tesouro IPCA+ 2035", "XP", "2", "15/05/2035", "5.000,00", "6.100,00"]],
  "Acoes": [["Produto", "Instituição", "Código de Negociação", "Quantidade", "Preço de Fechamento", "Valor Atualizado"], ["VALE3 - VALE", "XP", "VALE3", "100", "60,00", "6.000,00"]] });
await call("POST", "/v1/imports", { filename: "posicao.xlsx", ...b3 }, tk);
await call("POST", "/v1/imports", { filename: "neg.xlsx", trades: [{ date: "2026-03-02", side: "C", ticker: "VALE3", quantity: 60, price: 55, value: 3300, custodian: "XP" }] }, tk);
const al = (await call("GET", "/v1/allocation", null, tk)).body;
assert.equal(al.has_data, true); assert.ok(al.by_institution.some(i => i.institution === "XP"));
assert.ok(al.maturities.some(m => m.maturity === "2035-05-15")); assert.equal(al.maturities[0].maturity, "2028-01-10", "ordenado por vencimento"); assert.equal(al.maturity_ladder.find(l => l.label === "acima de 5 anos").value, "6100.00");
assert.match(al.performance.method, /custo conhecido/); assert.match(al.disclaimer, /Não é recomendação/);
const rec = (await call("GET", "/v1/data-quality", null, tk)).body.reconciliation_items.find(x => x.key === "VALE3");
assert.equal(rec.state, "partial"); assert.equal(rec.trades_qty, 60);
// revogar a conexão mantém o histórico do consentimento e a trilha
assert.equal((await call("DELETE", `/v1/openfinance/items/${itemId}`, null, tk)).status, 204);
cons = (await call("GET", "/v1/consents", null, tk)).body.items;
assert.equal(cons[0].status, "revogado"); assert.ok(cons[0].revoked_at);
assert.equal((await call("GET", "/v1/finance/transactions?limit=100", null, tk)).body.items.filter(t => t.description.startsWith("SALARIO")).length, 1, "volta a valer o OFX");
fake.close();
console.log("CONNECT/FINANCE E2E OK — dedupe entre fontes, validação, categorias auditáveis, rastreabilidade até o bruto, consentimento e revogação, cobertura, alocação, reconciliação e qualidade");
