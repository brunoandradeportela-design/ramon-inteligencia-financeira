// Teste ponta a ponta local: wrangler dev (D1 local) + simulador do Asaas.
import { spawn } from "node:child_process";
import assert from "node:assert/strict";
import { start, KEY, state, addPayment } from "./fake_asaas.mjs";

const OWNER_PW = "senhaDonoTeste2026", WH = process.env.AURION_TEST_URL ? "whk" : "whk_teste_local_123", PORT = 8799;
const fake = await start(9911);
const dev = process.env.AURION_TEST_URL ? { kill() {}, stdout: { on() {} }, stderr: { on() {} } } : spawn("npx", ["wrangler", "dev", "--local", "--port", String(PORT), "--persist-to", "/tmp/aurion-d1-test",
  "--var", `OWNER_PASSWORD:${OWNER_PW}`, "--var", `ASAAS_API_KEY:${KEY}`, "--var", `ASAAS_WEBHOOK_TOKEN:${WH}`,
  "--var", "ASAAS_BASE_URL:http://127.0.0.1:9911/v3", "--var", "ALLOWED_ORIGINS:https://aurionfinance.com.br"], { stdio: ["ignore", "pipe", "pipe"] });
let log = ""; dev.stdout.on("data", d => log += d); dev.stderr.on("data", d => log += d);
const B = process.env.AURION_TEST_URL || `http://127.0.0.1:${PORT}`;
for (let i = 0; i < 120; i++) { try { if ((await fetch(B + "/health")).ok) break; } catch {} await new Promise(r => setTimeout(r, 500)); }
const call = async (method, path, body, token, headers = {}) => {
  const r = await fetch(B + path, { method, body: body ? JSON.stringify(body) : undefined,
    headers: { "Content-Type": "application/json", Origin: "https://aurionfinance.com.br", ...(token ? { Authorization: "Bearer " + token } : {}), ...headers } });
  return { status: r.status, body: r.status === 204 ? null : await r.json(), cors: r.headers.get("access-control-allow-origin") };
};
try {
  const email = `marina.${Date.now()}@exemplo.com`;
  let r = await call("POST", "/v1/auth/register", { name: "Marina Costa Lima", email, profession: "Engenheira", phone: "(69) 99876-5432", password: "senhaSegura123", accept_terms: true });
  assert.equal(r.status, 201, JSON.stringify(r.body)); if (!process.env.AURION_TEST_URL) assert.equal(r.cors, "https://aurionfinance.com.br");
  const cli = r.body.token, uid = r.body.user.id;
  assert.equal((await call("POST", "/v1/auth/register", { name: "Marina Costa Lima", email, profession: "Engenheira", phone: "(69) 99876-5432", password: "senhaSegura123", accept_terms: true })).status, 409);
  assert.equal((await call("POST", "/v1/auth/login", { email: "ramonjunio07@gmail.com", password: "errada" })).status, 401);
  r = await call("POST", "/v1/auth/login", { email: "RamonJunio07@gmail.com", password: OWNER_PW });
  assert.equal(r.status, 200); const own = r.body.token; assert.deepEqual(r.body.user.roles, ["admin", "owner"]);
  assert.equal((await call("GET", "/v1/admin/crm/customers", null, cli)).status, 403, "cliente não acessa CRM");
  assert.equal((await call("POST", "/v1/billing/checkout", { plan: "pro", cpf_cnpj: "111.111.111-11" }, cli)).status, 422);
  r = await call("POST", "/v1/billing/checkout", { plan: "pro", cpf_cnpj: "529.982.247-25" }, cli);
  assert.equal(r.status, 200, JSON.stringify(r.body)); assert.match(r.body.invoice_url, /^https:\/\/www\.asaas\.com\/i\//);
  const cust = Object.values(state.customers)[0]; assert.equal(cust.externalReference, uid); assert.equal(cust.mobilePhone, "69998765432");
  r = await call("GET", `/v1/admin/crm/customers/${uid}`, null, own);
  assert.equal(r.body.stage, "aguardando_pagamento"); assert.equal(r.body.payments[0].status, "pendente");
  const pay = Object.values(state.pays)[0]; Object.assign(pay, { status: "RECEIVED", billingType: "PIX", paymentDate: pay.dueDate, clientPaymentDate: pay.dueDate });
  const evt = { id: "evt_1", event: "PAYMENT_RECEIVED", payment: pay };
  assert.equal((await call("POST", "/v1/webhooks/asaas", evt)).status, 401);
  assert.equal((await call("POST", "/v1/webhooks/asaas", evt, null, { "asaas-access-token": "errado" })).status, 401);
  r = await call("POST", "/v1/webhooks/asaas", evt, null, { "asaas-access-token": WH });
  assert.equal(r.body.status, "pago"); assert.equal(r.body.matched, true);
  assert.equal((await call("POST", "/v1/webhooks/asaas", evt, null, { "asaas-access-token": WH })).body.duplicate, true);
  r = await call("GET", `/v1/admin/crm/customers/${uid}`, null, own);
  assert.equal(r.body.stage, "pagante"); assert.equal(r.body.total_paid, "89.90"); assert.equal(r.body.payments.length, 1); assert.equal(r.body.payments[0].method, "pix");
  r = await call("GET", "/v1/admin/crm/metrics", null, own); assert.ok(r.body.paying >= 1); assert.ok(+r.body.mrr >= 89.9);
  state.customers.cus_ext = { id: "cus_ext", name: "Cliente Direto Asaas", email: "direto@exemplo.com" };
  addPayment({ customer: "cus_ext", value: 149.9, status: "CONFIRMED", billing: "CREDIT_CARD" });
  r = await call("POST", "/v1/admin/payments/sync", {}, own); assert.equal(r.body.ok, true); assert.ok(r.body.unmatched >= 1);
  r = await call("GET", "/v1/admin/payments?origin=sem_vinculo", null, own);
  assert.ok(r.body.items.some(x => x.customer_name === "Cliente Direto Asaas" && x.method === "cartao"));
  r = await call("GET", "/v1/admin/payments?q=" + encodeURIComponent(email), null, own); assert.equal(r.body.items[0].status, "pago");
  r = await call("GET", "/v1/admin/payments/gateway?live=true", null, own);
  assert.equal(r.body.connection, "ok"); assert.equal(r.body.balance, "1234.56"); assert.ok(!JSON.stringify(r.body).includes(KEY));
  r = await call("POST", "/v1/auth/login", { email, password: "senhaSegura123" }); assert.equal(r.status, 200); assert.equal(r.body.user.plan, "pro");
  assert.equal((await call("POST", "/v1/auth/logout", null, cli)).status, 204);
  assert.equal((await call("GET", "/v1/me", null, cli)).status, 401);
  console.log("E2E OK — cadastro, login do dono, checkout Asaas, webhook em tempo real, CRM, sincronização e segurança");
} catch (e) { console.error(e); console.error(log.slice(-3000)); process.exitCode = 1; }
finally { dev.kill(); fake.close(); }
