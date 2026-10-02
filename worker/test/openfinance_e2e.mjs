// Open Finance ponta a ponta: wrangler dev em AURION_TEST_URL com PLUGGY_BASE_URL apontando para o simulador (porta 9912).
import assert from "node:assert/strict";
import { start, state } from "./fake_pluggy.mjs";
const fake = await start(9912);
const B = process.env.AURION_TEST_URL || "http://localhost:8799";
const call = async (method, path, body, token) => {
  const r = await fetch(B + path, { method, body: body ? JSON.stringify(body) : undefined, headers: { "Content-Type": "application/json", ...(token ? { Authorization: "Bearer " + token } : {}) } });
  return { status: r.status, body: r.status === 204 ? null : await r.json() };
};
const reg = async n => (await call("POST", "/v1/auth/register", { name: "Marina Costa Alves", email: `of${n}.${Date.now()}@exemplo.com`, profession: "Engenheira", phone: "(69) 99811-22" + (30 + n), password: "senhaSegura123", accept_terms: true, plan: "pro" })).body;
const a = await reg(1), tk = a.token, uid = a.user.id;
let st = (await call("GET", "/v1/openfinance", null, tk)).body;
assert.equal(st.configured, true); assert.deepEqual(st.items, []);
assert.equal((await call("GET", "/v1/openfinance")).status, 401);
const ct = (await call("POST", "/v1/openfinance/connect-token", {}, tk)).body;
assert.equal(ct.access_token, "ct-" + uid); assert.match(ct.widget_url, /pluggy-connect/);
// o widget cria o item na Pluggy; simulamos isso no simulador
const itemId = (await (await fetch("http://127.0.0.1:9912/__test/items", { method: "POST", body: JSON.stringify({ clientUserId: uid }) })).json()).id;
let r = await call("POST", "/v1/openfinance/items", { item_id: itemId }, tk);
assert.equal(r.status, 201, JSON.stringify(r.body)); assert.equal(r.body.synced, true);
assert.deepEqual(r.body.counts, { transactions: 8, accounts: 2, holdings: 2, trades: 0 });
const f = (await call("GET", "/v1/finance/summary", null, tk)).body;
assert.equal(f.has_data, true); assert.equal(f.liquidity.cash, "15234.50");
const txs = (await call("GET", "/v1/finance/transactions?limit=50", null, tk)).body.items;
assert.equal(txs.find(t => t.description.startsWith("IFOOD")).amount, "-89.90"); assert.equal(txs.find(t => t.description === "ESTORNO LOJA").amount, "50.00");
const p = (await call("GET", "/v1/portfolio/consolidated", null, tk)).body;
assert.equal(p.total, "32300.00"); assert.equal(p.positions.find(x => x.ticker === "PETR4").invested, "6000.00");
// sincronizar de novo não duplica; o webhook dispara a sincronização
assert.equal((await call("POST", `/v1/openfinance/items/${itemId}/sync`, null, tk)).body.counts.transactions, 8);
assert.equal((await call("GET", "/v1/finance/transactions?limit=50", null, tk)).body.total, 8);
assert.equal((await call("POST", "/v1/webhooks/pluggy", { event: "item/updated", itemId })).body.received, true);
assert.equal((await call("POST", "/v1/webhooks/pluggy", { event: "item/updated", itemId: "item-desconhecido-0000" })).body.ignored, "item desconhecido");
st = (await call("GET", "/v1/openfinance", null, tk)).body;
assert.equal(st.items.length, 1); assert.equal(st.items[0].institution, "Banco Teste"); assert.equal(st.items[0].state, "ativo");
// outra conta não consegue se apropriar do item nem mexer nele
const b = await reg(2);
assert.equal((await call("POST", "/v1/openfinance/items", { item_id: itemId }, b.token)).status, 403);
assert.equal((await call("POST", `/v1/openfinance/items/${itemId}/sync`, null, b.token)).status, 404);
assert.equal((await call("DELETE", `/v1/openfinance/items/${itemId}`, null, b.token)).status, 404);
// item ainda carregando: registra e espera
const slow = (await (await fetch("http://127.0.0.1:9912/__test/items", { method: "POST", body: JSON.stringify({ clientUserId: b.user.id, status: "UPDATING", name: "Corretora Lenta" }) })).json()).id;
r = await call("POST", "/v1/openfinance/items", { item_id: slow }, b.token);
assert.equal(r.body.synced, false); assert.equal(r.body.state, "sincronizando");
// desconectar apaga os dados e o item na Pluggy
assert.equal((await call("DELETE", `/v1/openfinance/items/${itemId}`, null, tk)).status, 204);
assert.equal((await call("GET", "/v1/finance/summary", null, tk)).body.has_data, false);
assert.ok(!state.items[itemId]); assert.deepEqual((await call("GET", "/v1/openfinance", null, tk)).body.items, []);
fake.close();
console.log("OPEN FINANCE E2E OK — token de conexão, item, sincronização, deduplicação, webhook, isolamento entre contas, item pendente e desconexão");
