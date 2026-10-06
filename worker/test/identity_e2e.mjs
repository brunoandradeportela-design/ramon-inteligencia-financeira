// Identidade ponta a ponta: e-mail/CPF, recuperação (e-mail simulado na porta 9913), MFA TOTP, sessões, auditoria, LGPD.
import assert from "node:assert/strict";
import http from "node:http";
import { totp } from "../src/identity.js";
const B = process.env.AURION_TEST_URL || "http://localhost:8799";
const mails = [];
const mailSrv = http.createServer((q, s) => { let b = ""; q.on("data", c => b += c); q.on("end", () => { mails.push(JSON.parse(b)); s.writeHead(200, { "Content-Type": "application/json" }); s.end('{"id":"m1"}'); }); }).listen(9913);
const call = async (method, path, body, token) => {
  const r = await fetch(B + path, { method, body: body ? JSON.stringify(body) : undefined, headers: { "Content-Type": "application/json", "User-Agent": "Mozilla/5.0 (Windows NT 10.0) Chrome/120", ...(token ? { Authorization: "Bearer " + token } : {}) } });
  return { status: r.status, body: r.status === 204 ? null : await r.json() };
};
const n = Date.now() % 100000, email = `id${n}@exemplo.com`, cpf = "52998224725";   // CPF válido de teste (gerador)
let r = await call("POST", "/v1/auth/register", { name: "Lucas Nunes Prado", email, cpf: "529.982.247-25", profession: "Analista", phone: "(69) 99811-3001", password: "senhaForte2026", accept_terms: true, plan: "pro" });
assert.equal(r.status, 201, JSON.stringify(r.body)); let tk = r.body.token;
assert.equal((await call("POST", "/v1/auth/register", { name: "Outro Nome Silva", email: "x" + email, cpf, profession: "Analista", phone: "(69) 99811-3002", password: "senhaForte2026", accept_terms: true })).status, 409, "CPF duplicado");
assert.equal((await call("POST", "/v1/auth/register", { name: "Outro Nome Silva", email: "y" + email, cpf: "11111111111", profession: "Analista", phone: "(69) 99811-3003", password: "senhaForte2026", accept_terms: true })).status, 422, "CPF inválido");
// login por CPF formatado, por CPF puro e por e-mail
r = await call("POST", "/v1/auth/login", { identifier: "529.982.247-25", password: "senhaForte2026" }); assert.equal(r.status, 200); assert.equal(r.body.user.email, email);
r = await call("POST", "/v1/auth/login", { identifier: cpf, password: "errada123456" }); assert.equal(r.status, 401); assert.match(r.body.detail, /CPF ou senha/);
r = await call("POST", "/v1/auth/login", { email, password: "senhaForte2026" }); assert.equal(r.status, 200); const tk2 = r.body.token;
assert.equal((await call("GET", "/v1/security", null, tk)).body.cpf_masked, "***.982.247-**");
// recuperação: resposta igual para conta inexistente; link por e-mail; uso único; encerra sessões
const none = await call("POST", "/v1/auth/recover", { identifier: "naoexiste@exemplo.com" });
r = await call("POST", "/v1/auth/recover", { identifier: cpf });
assert.equal(r.status, 202); assert.deepEqual(Object.keys(none.body).sort(), Object.keys(r.body).sort()); assert.equal(r.body.message, none.body.message);
assert.equal(mails.length, 1); assert.equal(mails[0].to[0], email);
const token = mails[0].html.match(/token=([A-Za-z0-9_-]+)/)[1];
assert.equal((await call("POST", "/v1/auth/reset", { token, password: "fraca" })).status, 422);
r = await call("POST", "/v1/auth/reset", { token, password: "novaSenha2026x" }); assert.equal(r.status, 200); tk = r.body.token;
assert.equal((await call("POST", "/v1/auth/reset", { token, password: "novaSenha2026y" })).status, 400, "link de uso único");
assert.equal((await call("GET", "/v1/me", null, tk2)).status, 401, "sessões antigas encerradas");
assert.equal((await call("POST", "/v1/auth/login", { email, password: "senhaForte2026" })).status, 401);
// MFA
const setup = (await call("POST", "/v1/security/mfa/setup", null, tk)).body;
assert.match(setup.otpauth_uri, /^otpauth:\/\/totp\/Aurion/);
const step = () => Math.floor(Date.now() / 30000);
assert.equal((await call("POST", "/v1/security/mfa/enable", { code: "000000" }, tk)).status, 422);
r = await call("POST", "/v1/security/mfa/enable", { code: await totp(setup.secret, step()) }, tk);
assert.equal(r.body.enabled, true); assert.equal(r.body.recovery_codes.length, 8); const rcodes = r.body.recovery_codes;
r = await call("POST", "/v1/auth/login", { identifier: email, password: "novaSenha2026x" });
assert.equal(r.body.mfa_required, true); assert.ok(!r.body.token);
assert.equal((await call("POST", "/v1/auth/mfa/verify", { mfa_token: r.body.mfa_token, code: "123456" })).status, 401);
const r2 = await call("POST", "/v1/auth/mfa/verify", { mfa_token: r.body.mfa_token, code: await totp(setup.secret, step() + 1) });
assert.equal(r2.status, 200, JSON.stringify(r2.body)); assert.ok(r2.body.token);
let t3 = (await call("POST", "/v1/auth/login", { identifier: cpf, password: "novaSenha2026x" })).body;
assert.equal((await call("POST", "/v1/auth/mfa/verify", { mfa_token: t3.mfa_token, code: await totp(setup.secret, step() + 1) })).status, 401, "mesmo código não vale duas vezes");
t3 = (await call("POST", "/v1/auth/login", { identifier: cpf, password: "novaSenha2026x" })).body;
r = await call("POST", "/v1/auth/mfa/verify", { mfa_token: t3.mfa_token, code: rcodes[0] }); assert.equal(r.status, 200, "código de recuperação");
assert.equal((await call("GET", "/v1/security", null, tk)).body.recovery_codes_left, 7);
// sessões e dispositivos
const ss = (await call("GET", "/v1/sessions", null, tk)).body.items;
assert.ok(ss.length >= 3); assert.equal(ss.filter(s => s.current).length, 1); assert.match(ss[0].device, /Chrome · Windows/);
const other = ss.find(s => !s.current);
const b = (await call("POST", "/v1/auth/register", { name: "Bia Souza Lima", email: "b" + email, profession: "Analista", phone: "(69) 99811-3004", password: "senhaForte2026", accept_terms: true })).body;
assert.equal((await call("DELETE", `/v1/sessions/${other.id}`, null, b.token)).status, 404, "outra conta não encerra sessão alheia");
assert.equal((await call("DELETE", `/v1/sessions/${other.id}`, null, tk)).status, 204);
assert.equal((await call("DELETE", "/v1/sessions", null, tk)).body.revoked >= 1, true);
assert.equal((await call("GET", "/v1/sessions", null, tk)).body.items.length, 1);
// auditoria encadeada
const au = (await call("GET", "/v1/audit", null, tk)).body;
assert.equal(au.chain_valid, true);
for (const a of ["conta.criada", "login", "login.falhou", "senha.recuperacao_solicitada", "senha.redefinida", "mfa.ativado", "mfa.falhou", "sessao.encerrada"]) assert.ok(au.items.some(i => i.action === a), a);
assert.ok(!(await call("GET", "/v1/audit", null, b.token)).body.items.some(i => i.action === "mfa.ativado"), "auditoria isolada por titular");
// desativar MFA e alterar senha
assert.equal((await call("POST", "/v1/security/mfa/disable", { code: rcodes[1] }, tk)).body.enabled, false);
assert.equal((await call("POST", "/v1/auth/password", { current_password: "errada", new_password: "outraSenha2026" }, tk)).status, 401);
assert.equal((await call("POST", "/v1/auth/password", { current_password: "novaSenha2026x", new_password: "outraSenha2026" }, tk)).body.changed, true);
// administrador gera link de redefinição
const own = (await call("POST", "/v1/auth/login", { email: "ramonjunio07@gmail.com", password: "senhaDonoTeste2026" })).body.token;
assert.equal((await call("POST", `/v1/admin/users/${b.user.id}/reset-link`, null, tk)).status, 403);
const link = (await call("POST", `/v1/admin/users/${b.user.id}/reset-link`, null, own)).body;
assert.match(link.url, /#\/redefinir\?token=/);
assert.equal((await call("POST", "/v1/auth/reset", { token: link.url.split("token=")[1], password: "senhaDaBia2026" })).status, 200);
assert.ok((await call("GET", "/v1/admin/audit", null, own)).body.items.some(i => i.action === "senha.link_gerado_pelo_admin"));
// LGPD: exportar e eliminar
const ex = (await call("GET", "/v1/privacy/export", null, tk)).body;
assert.equal(ex.perfil.email, email); assert.equal(ex.seguranca.cpf, "***.982.247-**"); assert.ok(!JSON.stringify(ex).includes(cpf), "CPF nunca exportado em claro");
assert.equal((await call("POST", "/v1/privacy/delete-account", { password: "errada" }, tk)).status, 401);
assert.equal((await call("POST", "/v1/privacy/delete-account", { password: "outraSenha2026" }, tk)).status, 204);
assert.equal((await call("POST", "/v1/auth/login", { identifier: cpf, password: "outraSenha2026" })).status, 401);
assert.equal((await call("POST", "/v1/auth/register", { name: "Lucas Nunes Prado", email, cpf, profession: "Analista", phone: "(69) 99811-3001", password: "senhaForte2026", accept_terms: true })).status, 201, "CPF liberado após eliminação");
mailSrv.close();
console.log("IDENTITY E2E OK — e-mail/CPF, CPF protegido, recuperação de uso único, MFA TOTP com recuperação e anti-reuso, sessões/dispositivos, auditoria encadeada isolada, link do admin, exportação e eliminação LGPD");
