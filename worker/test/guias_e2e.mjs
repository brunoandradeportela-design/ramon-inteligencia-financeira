// Guias ponta a ponta: DARF manual (PF e PJ), DARF 6015 a partir da apuração, mínimo de R$ 10, DARE RO,
// CPF conferido com a conta, documento cifrado/mascarado, isolamento, auditoria, Integra Contador desligado.
import assert from "node:assert/strict";
const B = process.env.AURION_TEST_URL || "http://localhost:8799";
const call = async (method, path, body, token) => {
  const r = await fetch(B + path, { method, body: body ? JSON.stringify(body) : undefined, headers: { "Content-Type": "application/json", ...(token ? { Authorization: "Bearer " + token } : {}) } });
  return { status: r.status, body: r.status === 204 ? null : await r.json() };
};
const CPF = "39053344705", CNPJ = "11222333000181";
const reg = async (n, plan = "pro", cpf) => (await call("POST", "/v1/auth/register", { name: "Larissa Gomes Prado", email: `gu${n}.${Date.now()}@exemplo.com`, profession: "Contadora",
  phone: "(69) 99733-41" + (10 + n), password: "senhaSegura123", accept_terms: true, plan, ...(cpf ? { cpf } : {}) })).body;
const a = await reg(1, "pro", CPF), tk = a.token;
const hoje = new Date(Date.now() - 3 * 3600e3).toISOString().slice(0, 10), y = +hoje.slice(0, 4), mo = +hoje.slice(5, 7);
const prevMonth = mo === 1 ? `${y - 1}-12` : `${y}-${String(mo - 1).padStart(2, "0")}`;

const rec = (await call("GET", "/v1/tax/guias/receitas", null, tk)).body;
assert.ok(rec.darf.some(r => r.codigo === "6015") && rec.dare.RO.receitas.some(r => r.codigo === "3112")); assert.equal(rec.integra_contador, false);

// DARF manual PF no prazo
const g = await call("POST", "/v1/tax/guias/darf", { codigo: "0190", documento: "390.533.447-05", nome: "Larissa Gomes Prado", periodo: prevMonth, principal: "812,40".replace(",", ".") }, tk);
assert.equal(g.status, 201, JSON.stringify(g.body)); assert.equal(g.body.campos["04"].valor, "0190"); assert.equal(g.body.campos["03"].valor, "390.533.447-05");
assert.equal(g.body.cpf_da_conta, true); assert.equal(g.body.codigo_barras, null); assert.ok(g.body.como_pagar[0].includes("DARF sem código de barras"));
// lista com documento mascarado; detalhe devolve o documento completo ao dono
const list = (await call("GET", "/v1/tax/guias", null, tk)).body.items;
assert.equal(list.length, 1); assert.equal(list[0].documento, "***.533.447-**");
const det = (await call("GET", `/v1/tax/guias/${g.body.id}`, null, tk)).body;
assert.equal(det.contribuinte.documento, CPF); assert.ok(!("documento_cifrado" in det));

// validações
const pj = await call("POST", "/v1/tax/guias/darf", { codigo: "2089", documento: CPF, nome: "Larissa", periodo: `${y}-T1`, principal: 100 }, tk);
assert.equal(pj.status, 422); assert.ok(pj.body.errors.some(e => e.field === "documento"));
const min = await call("POST", "/v1/tax/guias/darf", { codigo: "6015", documento: CPF, nome: "Larissa Gomes Prado", periodo: prevMonth, principal: 7.5 }, tk);
assert.equal(min.status, 422); assert.equal(min.body.title, "Abaixo do valor mínimo");
const okPj = await call("POST", "/v1/tax/guias/darf", { codigo: "2089", documento: CNPJ, nome: "Prado Serviços Ltda", periodo: `${y - 1}-T4`, principal: 1500 }, tk);
assert.equal(okPj.status, 201); assert.equal(okPj.body.situacao, "em_atraso"); assert.equal(okPj.body.valores.multa_pct, 20);
assert.ok(+okPj.body.valores.total > 1800, "multa de 20% + juros"); assert.ok(okPj.body.avisos.some(x => /Selic/.test(x)), "sem Selic carregada (testes offline), avisa");

// DARF 6015 a partir da apuração do próprio sistema
await call("POST", "/v1/imports", { filename: "neg.xlsx", trades: [{ date: `${y - 1}-02-03`, side: "C", ticker: "VALE3", quantity: 2000, price: 50, value: 100000, custodian: "XP" },
  { date: `${y - 1}-03-10`, side: "V", ticker: "VALE3", quantity: 1000, price: 60, value: 60000, custodian: "XP" }] }, tk);
const ap = await call("POST", "/v1/tax/guias/darf", { origem: "apuracao", periodo: `${y - 1}-03`, documento: CPF, nome: "Larissa Gomes Prado" }, tk);
assert.equal(ap.status, 201, JSON.stringify(ap.body)); assert.equal(ap.body.receita.codigo, "6015"); assert.equal(ap.body.origem, "apuracao");
assert.ok(+ap.body.valores.principal > 1400 && +ap.body.valores.principal < 1600, ap.body.valores.principal);   // 15% de ~R$ 10 mil menos IRRF
assert.equal(ap.body.situacao, "em_atraso"); assert.equal(ap.body.vencimento, `${y - 1}-04-30`);
assert.equal((await call("POST", "/v1/tax/guias/darf", { origem: "apuracao", periodo: `${y - 1}-05`, documento: CPF, nome: "Larissa Gomes Prado" }, tk)).status, 422, "mês sem imposto");

// DARE Rondônia
const dare = await call("POST", "/v1/tax/guias/dare", { uf: "RO", codigo: "3112", documento: CPF, nome: "Larissa Gomes Prado", referencia: "ITCD 2026/001", vencimento: `${y + 1}-01-15`, principal: 3200 }, tk);
assert.equal(dare.status, 201); assert.equal(dare.body.portal, "https://www.sefin.ro.gov.br"); assert.equal(dare.body.codigo_barras, null);
assert.equal((await call("POST", "/v1/tax/guias/dare", { uf: "RO", codigo: "1212", documento: CPF, nome: "Larissa", vencimento: `${y + 1}-01-15`, principal: 10 }, tk)).status, 422);

// Integra Contador sem contrato → 501 com o caminho do Sicalc
const of = await call("POST", `/v1/tax/guias/${g.body.id}/oficial`, {}, tk);
assert.equal(of.status, 501); assert.match(of.body.sicalc_url, /sicalc/);

// isolamento, plano e auditoria
const b = await reg(2);
assert.equal((await call("GET", `/v1/tax/guias/${g.body.id}`, null, b.token)).status, 404);
const free = await reg(3, "free");
assert.equal((await call("GET", "/v1/tax/guias", null, free.token)).status, 402);
const aud = (await call("GET", "/v1/audit", null, tk)).body.items.map(i => i.action);
assert.ok(aud.includes("guia.darf_gerado") && aud.includes("guia.dare_gerado") && aud.includes("guia.consultada"));
assert.equal((await call("DELETE", `/v1/tax/guias/${dare.body.id}`, null, tk)).status, 204);
assert.equal((await call("GET", "/v1/tax/guias", null, tk)).body.items.length, 3);
console.log("GUIAS E2E OK — DARF PF/PJ com código e vencimento legais, multa e juros, mínimo de R$ 10, 6015 da apuração, DARE RO, CPF cifrado, isolamento e auditoria");
