// Login/cadastro 4.0 ponta a ponta: cotações públicas (serviço centralizado, cache, fechado/atrasado, indisponível),
// histórico por período, disponibilidade de e-mail, aceite dos termos com versão e momento, planos e autenticação.
import assert from "node:assert/strict";
import { start, quote } from "./fake_market.mjs";
import { LEGAL_VERSION } from "../../apps/web/app/js/crm_rules.js";
const B = process.env.AURION_TEST_URL || "http://localhost:8799";
const call = async (method, path, body, token) => {
  const r = await fetch(B + path, { method, body: body ? JSON.stringify(body) : undefined, headers: { "Content-Type": "application/json", ...(token ? { Authorization: "Bearer " + token } : {}) } });
  return { status: r.status, headers: r.headers, body: r.status === 204 ? null : await r.json() };
};
const mkt = await start(9914);
try {
  // cotações públicas
  const m = await call("GET", "/v1/public/market");
  assert.equal(m.status, 200); assert.match(m.headers.get("cache-control"), /public, max-age=30/);
  assert.equal(m.body.items.length, 11); assert.equal(m.body.tempo_real, false); assert.match(m.body.fonte, /atrasados/);
  const by = Object.fromEntries(m.body.items.map(i => [i.id, i]));
  assert.equal(by.PETR4.ultimo, quote("PETR4.SA").chart.result[0].meta.regularMarketPrice, "valor igual ao do provedor");
  assert.equal(by.IBOV.tipo, "indice"); assert.equal(by.USDBRL.tipo, "cambio"); assert.equal(by.PETR4.tipo, "acao");
  assert.equal(by.PETR4.dado, "atrasado"); assert.equal(by.DJI.mercado, "fechado"); assert.equal(by.DJI.dado, "fechamento");
  assert.equal(by.EURBRL.indisponivel, true); assert.equal(by.EURBRL.ultimo, null, "indisponível não inventa número");
  assert.ok(by.PETR4.spark.length > 10 && by.PETR4.horario);
  assert.ok(!JSON.stringify(m.body).includes("tempo real"), "nunca rotula como tempo real");
  // histórico por período
  const h = await call("GET", "/v1/public/market/history?id=PETR4&period=1M");
  assert.equal(h.status, 200); assert.equal(h.body.pontos.length, 22); assert.equal(h.body.periodo, "1M");
  for (const per of ["1D", "1S", "1A", "5A"]) assert.equal((await call("GET", `/v1/public/market/history?id=IBOV&period=${per}`)).status, 200, per);
  assert.equal((await call("GET", "/v1/public/market/history?id=XPTO&period=1M")).status, 422);
  assert.equal((await call("GET", "/v1/public/market/history?id=PETR4&period=2D")).status, 422);
  assert.equal((await call("GET", "/v1/public/market/history?id=EURBRL&period=1M")).status, 503, "provedor indisponível");
  // provedor fora do ar: cache continua servindo, e o que não está em cache responde indisponível
  await new Promise(r => mkt.close(r));
  assert.equal((await call("GET", "/v1/public/market/history?id=PETR4&period=1M")).body.cache, true);
  assert.equal((await call("GET", "/v1/public/market/history?id=VALE3&period=5A")).status, 503);
  assert.equal((await call("GET", "/v1/public/market")).status, 200);
} finally { try { mkt.close(); } catch {} }

// cadastro: disponibilidade de e-mail, validações, termos com versão, planos
const em = `a4.${Date.now()}@exemplo.com`;
assert.deepEqual((await call("GET", `/v1/auth/email-available?email=${encodeURIComponent(em)}`)).body, { email: em, available: true });
assert.equal((await call("GET", "/v1/auth/email-available?email=x")).status, 422);
const base = { name: "Rafaela Moura Lins", email: em, profession: "Advogada", phone: "(69) 99877-5521", password: "senhaSegura123", plan: "free" };
const noTerms = await call("POST", "/v1/auth/register", { ...base, accept_terms: false });
assert.equal(noTerms.status, 422); assert.ok(noTerms.body.errors.some(e => e.field === "accept_terms"));
assert.ok((await call("POST", "/v1/auth/register", { ...base, accept_terms: true, cpf: "123.456.789-00" })).body.errors.some(e => e.field === "cpf"));
assert.ok((await call("POST", "/v1/auth/register", { ...base, accept_terms: true, password: "curta1" })).body.errors.some(e => e.field === "password"));
assert.ok((await call("POST", "/v1/auth/register", { ...base, accept_terms: true, email: "invalido" })).body.errors.some(e => e.field === "email"));
const reg = await call("POST", "/v1/auth/register", { ...base, accept_terms: true, marketing_opt_in: true });
assert.equal(reg.status, 201); assert.equal(reg.body.user.plan, "free");
assert.equal((await call("GET", `/v1/auth/email-available?email=${encodeURIComponent(em)}`)).body.available, false);
assert.equal((await call("POST", "/v1/auth/register", { ...base, accept_terms: true })).status, 409, "duplicidade");
const aud = (await call("GET", "/v1/audit", null, reg.body.token)).body.items.find(i => i.action === "conta.criada");
assert.equal(aud.meta.termos_versao, LEGAL_VERSION); assert.equal(aud.meta.comunicacoes, true);
const pro = await call("POST", "/v1/auth/register", { ...base, email: "p." + em, phone: "(69) 99877-5522", accept_terms: true, plan: "pro" });
assert.equal(pro.body.user.plan, "pro");
// autenticação
const ok = await call("POST", "/v1/auth/login", { identifier: em, password: "senhaSegura123" });
assert.equal(ok.status, 200); assert.ok(ok.body.token);
const bad = await call("POST", "/v1/auth/login", { identifier: em, password: "errada1234567" });
assert.equal(bad.status, 401); assert.doesNotMatch(bad.body.detail, /não existe|inexistente/);
const rec = await call("POST", "/v1/auth/recover", { identifier: em });
assert.ok(rec.status === 200 || rec.status === 202);
assert.equal((await call("POST", "/v1/auth/logout", null, ok.body.token)).status < 300, true);
assert.equal((await call("GET", "/v1/me", null, ok.body.token)).status, 401, "sessão encerrada");
console.log("AUTH 4.0 E2E OK — cotações reais do provedor com cache, fechado/atrasado/indisponível, histórico por período, e-mail disponível, termos versionados, planos, login, recuperação e saída");
