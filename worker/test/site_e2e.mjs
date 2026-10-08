// Página inicial: formulário de contato público (validação, isca contra robôs, limite por e-mail), leitura só pelo administrador
// e auditoria. Também confere que nenhum dado de cliente aparece na demonstração pública.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const B = process.env.AURION_TEST_URL || "http://localhost:8799";
const call = async (method, path, body, token) => {
  const r = await fetch(B + path, { method, body: body ? JSON.stringify(body) : undefined, headers: { "Content-Type": "application/json", ...(token ? { Authorization: "Bearer " + token } : {}) } });
  return { status: r.status, body: r.status === 204 ? null : await r.json() };
};
const em = `visitante.${Date.now()}@exemplo.com`;
const ok = await call("POST", "/v1/public/contact", { name: "Marina Teles", email: em, topic: "planos", message: "Quero saber como funciona o plano Pro para contadores." });
assert.equal(ok.status, 201, JSON.stringify(ok.body)); assert.ok(ok.body.id.startsWith("msg_"));
const bad = await call("POST", "/v1/public/contact", { name: "M", email: "x", message: "curta" });
assert.equal(bad.status, 422); assert.deepEqual(bad.body.errors.map(e => e.field).sort(), ["email", "message", "name"]);
const bot = await call("POST", "/v1/public/contact", { name: "Robo", email: "robo@exemplo.com", message: "mensagem automática de robô", website: "http://spam" });
assert.equal(bot.status, 202);
for (let i = 0; i < 2; i++) assert.equal((await call("POST", "/v1/public/contact", { name: "Marina Teles", email: em, message: "Segunda e terceira mensagem do mesmo e-mail." })).status, 201);
assert.equal((await call("POST", "/v1/public/contact", { name: "Marina Teles", email: em, message: "Quarta mensagem na mesma hora." })).status, 429, "limite por e-mail");
// só o administrador lê
const cli = (await call("POST", "/v1/auth/register", { name: "Paulo Cesar Lima", email: `pc.${Date.now()}@exemplo.com`, profession: "Analista", phone: "(69) 99712-4410", password: "senhaSegura123", accept_terms: true, plan: "free" })).body;
assert.equal((await call("GET", "/v1/admin/contacts", null, cli.token)).status, 403);
assert.equal((await call("GET", "/v1/admin/contacts")).status, 401);
const own = (await call("POST", "/v1/auth/login", { email: "RamonJunio07@gmail.com", password: "senhaDonoTeste2026" })).body.token;
const list = (await call("GET", "/v1/admin/contacts", null, own)).body;
assert.ok(list.items.some(x => x.id === ok.body.id && x.topic_label === "Planos e contratação"));
assert.ok(!list.items.some(x => x.email === "robo@exemplo.com"), "isca descartada");
const upd = await call("PATCH", `/v1/admin/contacts/${ok.body.id}`, { status: "respondido" }, own);
assert.equal(upd.body.status, "respondido");
assert.equal((await call("PATCH", `/v1/admin/contacts/${ok.body.id}`, { status: "x" }, own)).status, 422);
// demonstração pública: só dados fictícios
const demo = JSON.parse(readFileSync(new URL("../../apps/web/assets/data/home-demo.json", import.meta.url)));
assert.match(demo.aviso, /DEMONSTRAÇÃO/);
const txt = JSON.stringify(demo);
assert.ok(!/\b\d{3}\.\d{3}\.\d{3}-\d{2}\b|\b\d{11}\b/.test(txt), "sem CPF na demonstração");
assert.ok(!/@/.test(txt), "sem e-mail na demonstração");
console.log("SITE E2E OK — contato público validado, isca contra robôs, limite por e-mail, leitura só do administrador, demonstração sem dados reais");
