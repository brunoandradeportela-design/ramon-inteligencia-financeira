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
