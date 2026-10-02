// Assistente e documentos ponta a ponta contra o Worker local (AURION_TEST_URL).
import assert from "node:assert/strict";
import { parseB3Workbook } from "../../apps/web/app/js/importers.js";
const B = process.env.AURION_TEST_URL || "http://localhost:8799";
const call = async (method, path, body, token) => {
  const r = await fetch(B + path, { method, body: body ? JSON.stringify(body) : undefined, headers: { "Content-Type": "application/json", ...(token ? { Authorization: "Bearer " + token } : {}) } });
  return { status: r.status, body: r.status === 204 ? null : await r.json() };
};
const up = (bytes, name, token, h = {}) => fetch(B + "/v1/documents", { method: "POST", body: bytes, headers: { "Content-Type": "application/octet-stream", "X-Filename": encodeURIComponent(name), Authorization: "Bearer " + token, ...h } });
const reg = async (plan, n) => (await call("POST", "/v1/auth/register", { name: "Paula Mendes Rocha", email: `da${n}.${Date.now()}@exemplo.com`, profession: "Dentista", phone: "(69) 99811-22" + (40 + n), password: "senhaSegura123", accept_terms: true, plan })).body;
const a = await reg("pro", 1), tk = a.token;
// assistente sem dados orienta a importar; com dados responde com números
let r = await call("POST", "/v1/assistant/query", { question: "Quanto eu tenho de patrimônio?" }, tk);
assert.equal(r.status, 200); assert.equal(r.body.has_data, false); assert.match(r.body.answer, /ainda não há dados/);
const neg = parseB3Workbook({ "Negociação": [["Data do Negócio", "Tipo de Movimentação", "Mercado", "Instituição", "Código de Negociação", "Quantidade", "Preço", "Valor"],
  ["02/03/2026", "Compra", "Mercado à Vista", "XP INVESTIMENTOS", "VALE3", "1000", "60,00", "60.000,00"], ["10/04/2026", "Venda", "Mercado à Vista", "XP INVESTIMENTOS", "VALE3", "1000", "70,00", "70.000,00"],
  ["05/05/2026", "Compra", "Mercado à Vista", "XP INVESTIMENTOS", "PETR4", "400", "30,00", "12.000,00"]] });
await call("POST", "/v1/imports", { filename: "neg.xlsx", ...neg }, tk);
r = await call("POST", "/v1/assistant/query", { question: "Quanto vou pagar de imposto?" }, tk);
assert.equal(r.body.intent, "tributaria"); assert.match(r.body.answer, /R\$ 1\.496,50/); assert.ok(r.body.evidence.length >= 3);
r = await call("POST", "/v1/assistant/query", { question: "simular venda de 400 PETR4 a 35" }, tk);
assert.equal(r.body.intent, "simulacao"); assert.match(r.body.answer, /gera R\$ 14\.000,00/);
r = await call("POST", "/v1/assistant/query", { question: "Devo comprar mais PETR4?" }, tk);
assert.equal(r.body.guardrail, "recomendacao");
const free = await reg("free", 2);
assert.equal((await call("POST", "/v1/assistant/query", { question: "oi" }, free.token)).status, 402);
// documentos: envio binário, conteúdo conferido, cota, download idêntico, checklist
const pdf = new Uint8Array(2_500_000); pdf.set(new TextEncoder().encode("%PDF-1.7\n")); for (let i = 9; i < pdf.length; i++) pdf[i] = i % 251;
let res = await up(pdf, "Informe_Rendimentos_XP_2026.pdf", tk);
assert.equal(res.status, 201); const doc = await res.json();
assert.equal(doc.kind, "informe_rendimentos"); assert.equal(doc.year, 2026); assert.equal(doc.size, 2_500_000);
res = await up(new TextEncoder().encode("isto não é pdf"), "falso.pdf", tk); assert.equal(res.status, 422);
res = await up(new Uint8Array([1, 2, 3]), "virus.exe", tk); assert.equal(res.status, 422);
res = await up(new Uint8Array(9 * 1024 * 1024).fill(65), "grande.txt", tk); assert.equal(res.status, 413);
const dl = await fetch(B + `/v1/documents/${doc.id}/download`, { headers: { Authorization: "Bearer " + tk } });
assert.equal(dl.status, 200); assert.match(dl.headers.get("content-disposition"), /Informe_Rendimentos_XP_2026\.pdf/);
const back = new Uint8Array(await dl.arrayBuffer()); assert.equal(back.length, pdf.length); assert.ok(back.every((v, i) => v === pdf[i]), "download idêntico");
let list = (await call("GET", "/v1/documents?year=2026", null, tk)).body;
assert.equal(list.items.length, 1); assert.equal(list.used_bytes, 2_500_000);
assert.equal(list.checklist.items.find(i => i.id === "informe:xp").done, true); assert.equal(list.checklist.items.find(i => i.id === "notas").done, false);
assert.equal((await call("PATCH", `/v1/documents/${doc.id}`, { kind: "nota_corretagem" }, tk)).body.kind, "nota_corretagem");
r = await call("POST", "/v1/assistant/query", { question: "Quais documentos faltam para o IR?" }, tk);
assert.equal(r.body.intent, "documento"); assert.match(r.body.answer, /Faltam: Informe de rendimentos 2026 — XP/);
// isolamento e exclusão
assert.equal((await fetch(B + `/v1/documents/${doc.id}/download`, { headers: { Authorization: "Bearer " + free.token } })).status, 404);
assert.equal((await call("DELETE", `/v1/documents/${doc.id}`, null, free.token)).status, 404);
assert.equal((await call("DELETE", `/v1/documents/${doc.id}`, null, tk)).status, 204);
assert.equal((await call("GET", "/v1/documents", null, tk)).body.items.length, 0);
console.log("DOCS + ASSISTENTE E2E OK — assistente com dados reais, guardrails, plano, upload binário, verificação de conteúdo, limites, download íntegro, checklist IRPF, isolamento e exclusão");
