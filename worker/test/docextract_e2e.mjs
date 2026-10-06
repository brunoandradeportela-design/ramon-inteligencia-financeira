// Extração de documentos ponta a ponta: nota de corretagem → revisão → importação idempotente; comprovante de DARF → apuração.
import assert from "node:assert/strict";
import { NOTA } from "./fixtures_docs.mjs";
const B = process.env.AURION_TEST_URL || "http://localhost:8799";
const call = async (method, path, body, token) => { const r = await fetch(B + path, { method, body: body ? JSON.stringify(body) : undefined, headers: { "Content-Type": "application/json", ...(token ? { Authorization: "Bearer " + token } : {}) } });
  return { status: r.status, body: r.status === 204 ? null : await r.json() }; };
const st = Date.now();
const reg = async n => (await call("POST", "/v1/auth/register", { name: "Lucas Andrade Melo", email: `dx${n}.${st}@exemplo.com`, profession: "Advogado", phone: "(69) 99877-" + String(st + n).slice(-4), password: "senhaSegura123", accept_terms: true, plan: "pro" })).body;
const a = await reg(1), b = await reg(2);
const pdf = new TextEncoder().encode("%PDF-1.4\n% nota de corretagem de teste\n%%EOF");
const up = async (name, tk) => (await (await fetch(B + "/v1/documents", { method: "POST", body: pdf, headers: { "Content-Type": "application/pdf", "X-Filename": name, Authorization: "Bearer " + tk } })).json());
const doc = await up("nota_45871.pdf", a.token);
// sem texto legível
assert.equal((await call("PUT", `/v1/documents/${doc.id}/extraction`, { lines: ["", "  "] }, a.token)).status, 422);
// extração: FII sem código → bloqueia
let x = (await call("PUT", `/v1/documents/${doc.id}/extraction`, { lines: NOTA }, a.token)).body.extraction;
assert.equal(x.type, "nota_corretagem"); assert.equal(x.negocios.length, 5); assert.equal(x.validation.ok, false);
assert.ok(x.validation.checks.some(c => c.id === "ativos" && !c.ok));
assert.equal((await call("POST", `/v1/documents/${doc.id}/extraction/confirm`, null, a.token)).status, 422, "não confirma com pendência");
assert.equal((await call("GET", `/v1/documents/${doc.id}/extraction`, null, b.token)).status, 404, "isolamento");
// cliente informa o código; o servidor guarda o mapa e revalida
x = (await call("PATCH", `/v1/documents/${doc.id}/extraction`, { ticker_overrides: { "FII XP LOG CI": "xplg11" } }, a.token)).body.extraction;
assert.equal(x.validation.ok, true, JSON.stringify(x.validation.checks.filter(c => !c.ok)));
const c1 = await call("POST", `/v1/documents/${doc.id}/extraction/confirm`, null, a.token);
assert.equal(c1.status, 200, JSON.stringify(c1.body)); assert.equal(c1.body.result.imported, 5);
assert.equal((await call("POST", `/v1/documents/${doc.id}/extraction/confirm`, null, a.token)).status, 409, "confirmação única");
const ev = (await call("GET", "/v1/tax/events?year=2026", null, a.token)).body;
assert.ok(ev.items.some(e => e.ticker === "ITUB4" && e.modality === "daytrade"), "day trade da nota na apuração");
const imps = (await call("GET", "/v1/imports", null, a.token)).body.items;
assert.ok(imps.some(i => i.source === "nota_corretagem" && i.document_id === doc.id));
const docs = (await call("GET", "/v1/documents", null, a.token)).body.items;
assert.equal(docs.find(d => d.id === doc.id).status, "conferido"); assert.equal(docs.find(d => d.id === doc.id).kind, "nota_corretagem");
// mesma nota enviada de novo: mapa lembrado e negócios já existentes não duplicam
const doc2 = await up("nota_45871_copia.pdf", a.token);
x = (await call("PUT", `/v1/documents/${doc2.id}/extraction`, { lines: NOTA }, a.token)).body.extraction;
assert.equal(x.negocios[4].ticker, "XPLG11"); assert.equal(x.negocios[4].ticker_origem, "mapa_do_cliente");
const c2 = (await call("POST", `/v1/documents/${doc2.id}/extraction/confirm`, null, a.token)).body;
assert.equal(c2.result.imported, 0); assert.equal(c2.result.skipped_duplicates, 5);
// comprovante de DARF marca a competência como paga
const d3 = await up("darf_marco.pdf", a.token);
await call("PUT", `/v1/documents/${d3.id}/extraction`, { lines: ["Comprovante de Arrecadação", "Documento de Arrecadação de Receitas Federais", "Código da Receita 6015", "Período de Apuração 31/03/2026", "Data de Arrecadação 28/04/2026", "Valor Total 120,50"] }, a.token);
const c3 = (await call("POST", `/v1/documents/${d3.id}/extraction/confirm`, null, a.token)).body;
assert.equal(c3.result.darf_marcado_pago, "2026-03");
assert.equal((await call("GET", "/v1/tax/settings", null, a.token)).body.paid_darfs["2026-03"], "120.50");
assert.ok((await call("GET", "/v1/audit", null, a.token)).body.items.some(i => i.action === "documento.extracao_confirmada"));
// apagar o documento remove a extração
assert.equal((await call("DELETE", `/v1/documents/${d3.id}`, null, a.token)).status, 204);
assert.equal((await call("GET", `/v1/documents/${d3.id}/extraction`, null, a.token)).status, 404);
console.log("DOC EXTRACT E2E OK — nota lida e revalidada no servidor, pendência bloqueia, mapa do cliente, importação única sem duplicar, DARF baixado, auditoria");
