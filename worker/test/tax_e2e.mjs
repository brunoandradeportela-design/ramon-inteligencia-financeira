// Tax ponta a ponta: cálculo persistido e reproduzível, artefato de auditoria, regras versionadas, cenários B/C, isolamento.
import assert from "node:assert/strict";
const B = process.env.AURION_TEST_URL || "http://localhost:8799";
const call = async (method, path, body, token) => {
  const r = await fetch(B + path, { method, body: body ? JSON.stringify(body) : undefined, headers: { "Content-Type": "application/json", ...(token ? { Authorization: "Bearer " + token } : {}) } });
  return { status: r.status, body: r.status === 204 ? null : await r.json() };
};
const reg = async n => (await call("POST", "/v1/auth/register", { name: "Tiago Ramos Leal", email: `tx${n}.${Date.now()}@exemplo.com`, profession: "Engenheiro", phone: "(69) 99811-50" + (10 + n), password: "senhaSegura123", accept_terms: true, plan: "pro" })).body;
const a = await reg(1), tk = a.token;
const y = new Date().getFullYear();
await call("POST", "/v1/imports", { filename: "neg.xlsx", trades: [{ date: `${y}-03-02`, side: "C", ticker: "PETR4", quantity: 1000, price: 30, value: 30000, custodian: "XP" },
  { date: `${y}-03-20`, side: "V", ticker: "PETR4", quantity: 500, price: 45, value: 22500, custodian: "XP" }] }, tk);
const s1 = (await call("GET", `/v1/tax/summary?year=${y}`, null, tk)).body;
assert.ok(s1.calculation_id.startsWith("tcal_")); assert.equal(s1.engine_version, "tax-engine-js@1.1.0"); assert.ok(s1.quality.factors.length >= 4);
const s2 = (await call("GET", `/v1/tax/summary?year=${y}`, null, tk)).body;
assert.equal(s2.calculation_id, s1.calculation_id, "mesma entrada = mesmo cálculo (idempotente)");
const list = (await call("GET", "/v1/tax/calculations", null, tk)).body.items;
assert.equal(list.length, 1); assert.match(list[0].reproducibility_key, /BR-IRPF-RV-COMUM@2026\.1/);
const v = (await call("GET", `/v1/tax/calculations/${s1.calculation_id}/verify`, null, tk)).body;
assert.equal(v.reproducible, true); assert.equal(v.recomputed.total_tax_due, s1.total_tax_due);
const art = (await call("GET", `/v1/tax/calculations/${s1.calculation_id}/artifact`, null, tk)).body;
for (const k of ["resumo", "entradas", "premissas", "regras", "calculos", "resultado", "fontes", "auditoria"]) assert.ok(Array.isArray(art[k]) && art[k].length, k);
assert.equal(art.aliquotas.comum, 0.15); assert.equal(art.entradas.length, 2); assert.ok(art.fontes.some(f => /planalto/.test(f[2])));
assert.ok(art.auditoria.some(r => r[0] === "reprocessado agora e conferido" && /sim/.test(r[1])));
const b = await reg(2);
assert.equal((await call("GET", `/v1/tax/calculations/${s1.calculation_id}`, null, b.token)).status, 404, "cálculo de outra conta");
const rules = (await call("GET", "/v1/tax/rules", null, tk)).body;
assert.ok(rules.items.find(r => r.code === "BR-IRPF-RV-COMUM").rule_definition.steps.some(s => s.op === "exempt_if"));
assert.deepEqual(rules.items.find(r => r.code === "BR-IRPF-RV-COMUM").definition_errors, []);
// nova negociação → novo cálculo; o anterior continua guardado
await call("POST", "/v1/imports", { filename: "neg2.xlsx", trades: [{ date: `${y}-04-10`, side: "V", ticker: "PETR4", quantity: 100, price: 40, value: 4000, custodian: "XP" }] }, tk);
const s3 = (await call("GET", `/v1/tax/summary?year=${y}`, null, tk)).body;
assert.notEqual(s3.calculation_id, s1.calculation_id); assert.equal((await call("GET", "/v1/tax/calculations", null, tk)).body.items.length, 2);
assert.equal((await call("GET", `/v1/tax/calculations/${s1.calculation_id}/verify`, null, tk)).body.reproducible, true, "cálculo antigo segue reproduzível");
// cenários B e C
const future = new Date(Date.now() + 3 * 864e5).toISOString().slice(0, 10);
const sim = (await call("POST", "/v1/simulations", { kind: "venda_ativos", scenarios: [{ name: "B", operations: [{ ticker: "PETR4", quantity: 100, date: future, price: "40" }] },
  { name: "C", operations: [{ ticker: "PETR4", quantity: 400, date: future, price: "40" }] }] }, tk)).body;
assert.equal(sim.results.length, 3); assert.equal(sim.results[2].scenario.calculation_version, "tax-engine-js@1.1.0");
assert.ok((await call("GET", "/v1/audit", null, tk)).body.items.some(i => i.action === "tributacao.calculo_verificado"));
// relatório de apoio à declaração
const y0 = new Date().getFullYear();
const ir = await call("GET", `/v1/tax/irpf-report?year=${y0}`, null, tk);
assert.equal(ir.status, 200, JSON.stringify(ir.body)); assert.equal(ir.body.renda_variavel.mensal.length, 12); assert.ok(Array.isArray(ir.body.bens_e_direitos));
assert.equal((await call("GET", "/v1/tax/irpf-report?year=1999", null, tk)).status, 422);
console.log("TAX E2E OK — cálculo persistido e idempotente, reprodutibilidade verificada, artefato de 8 abas, regras versionadas com DSL, cenários B/C, isolamento e auditoria");
