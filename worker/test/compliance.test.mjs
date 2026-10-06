// Critérios de aceite de compliance (v6.0 §34, ADR-0009): nenhum módulo executa ordens; IA não recebe rota de execução.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
const roots = ["worker/src", "apps/web/app/js"].map(r => path.resolve(path.dirname(new URL(import.meta.url).pathname), "../..", r));
const files = roots.flatMap(r => fs.readdirSync(r).filter(f => f.endsWith(".js")).map(f => path.join(r, f)));
test("nenhuma rota ou função de envio/cancelamento/substituição de ordem", () => {
  const forbidden = /(submit_?order|cancel_?order|replace_?order|broker_?execute|place_?order|send_?order|\/orders?\b)/i;
  for (const f of files) {
    const src = fs.readFileSync(f, "utf8").split("\n").filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l)).join("\n");
    assert.ok(!forbidden.test(src), `rota/função de ordem encontrada em ${path.basename(f)}`);
  }
});
test("nenhum segredo embutido no código", () => {
  for (const f of files) {
    const src = fs.readFileSync(f, "utf8");
    assert.ok(!/\$aact_(prod|hmlg)_[A-Za-z0-9]{20,}/.test(src), `chave Asaas em ${path.basename(f)}`);
    assert.ok(!/re_[A-Za-z0-9]{24,}/.test(src), `chave Resend em ${path.basename(f)}`);
    assert.ok(!/\b\d{3}\.\d{3}\.\d{3}-\d{2}\b/.test(src.replace(/000\.000\.000-00/g, "")), `CPF literal em ${path.basename(f)}`);
  }
});

import { checkRate, _reset } from "../src/ratelimit.js";
test("limite de requisições por IP e grupo de rota", () => {
  _reset(); const t = Date.UTC(2026, 9, 6, 12, 0, 5);
  for (let i = 0; i < 20; i++) assert.equal(checkRate("1.1.1.1", "POST", "/v1/auth/login", { now: t }).ok, true);
  const r = checkRate("1.1.1.1", "POST", "/v1/auth/login", { now: t });
  assert.equal(r.ok, false); assert.equal(r.policy, "auth"); assert.equal(r.retry_after, 55);
  assert.equal(checkRate("2.2.2.2", "POST", "/v1/auth/login", { now: t }).ok, true, "outro IP não é afetado");
  assert.equal(checkRate("1.1.1.1", "GET", "/v1/me", { now: t }).ok, true, "grupo geral separado");
  assert.equal(checkRate("1.1.1.1", "POST", "/v1/auth/login", { now: t + 60000 }).ok, true, "nova janela");
  assert.equal(checkRate("1.1.1.1", "POST", "/v1/documents", { now: t }).policy, "pesado");
  _reset(); for (let i = 0; i < 25; i++) checkRate("3.3.3.3", "POST", "/v1/auth/register", { now: t, scale: 50 });
  assert.equal(checkRate("3.3.3.3", "POST", "/v1/auth/register", { now: t, scale: 50 }).ok, true, "escala para testes");
});
