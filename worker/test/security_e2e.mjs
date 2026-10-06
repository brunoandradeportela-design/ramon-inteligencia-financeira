// Segurança de sessão: acesso de aparelho novo gera aviso no sino, na auditoria e por e-mail (provedor simulado na 9913).
import assert from "node:assert/strict";
import http from "node:http";
const mails = [];
const srv = http.createServer((q, s) => { let b = ""; q.on("data", c => b += c); q.on("end", () => { mails.push(JSON.parse(b)); s.writeHead(200, { "Content-Type": "application/json" }); s.end('{"id":"m1"}'); }); }).listen(9913);
const B = process.env.AURION_TEST_URL || "http://localhost:8799";
const WIN = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36";
const IPH = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
const call = async (method, path, body, token, ua = WIN) => { const r = await fetch(B + path, { method, body: body ? JSON.stringify(body) : undefined, headers: { "Content-Type": "application/json", "User-Agent": ua, ...(token ? { Authorization: "Bearer " + token } : {}) } });
  return { status: r.status, body: r.status === 204 ? null : await r.json() }; };
const st = Date.now(), email = `sec.${st}@exemplo.com`;
const u = (await call("POST", "/v1/auth/register", { name: "Rita Moura Leal", email, profession: "Dentista", phone: "(69) 99899-" + String(st).slice(-4), password: "senhaSegura123", accept_terms: true, plan: "pro" })).body;
const n0 = mails.length;
const l1 = (await call("POST", "/v1/auth/login", { identifier: email, password: "senhaSegura123" })).body;
assert.ok(l1.token); assert.equal(mails.length, n0, "mesmo aparelho: sem aviso");
let nt = (await call("GET", "/v1/notifications", null, l1.token)).body;
assert.ok(!nt.items.some(i => i.kind === "seguranca"));
const l2 = (await call("POST", "/v1/auth/login", { identifier: email, password: "senhaSegura123" }, null, IPH)).body;
assert.ok(l2.token);
await new Promise(r => setTimeout(r, 300));
assert.ok(mails.some(m => m.to[0] === email && /novo acesso/i.test(m.subject) && /Safari · iPhone\/iPad/.test(m.html)), "e-mail de novo acesso");
nt = (await call("GET", "/v1/notifications", null, l1.token)).body;
assert.ok(nt.items.some(i => i.kind === "seguranca" && /Novo acesso/.test(i.title)), "aviso no sino");
assert.ok((await call("GET", "/v1/audit", null, l1.token)).body.items.some(i => i.action === "login.novo_dispositivo"));
// voltar ao mesmo iPhone não repete o aviso
const n1 = mails.length; await call("POST", "/v1/auth/login", { identifier: email, password: "senhaSegura123" }, null, IPH);
await new Promise(r => setTimeout(r, 200)); assert.equal(mails.length, n1);
srv.close();
console.log("SECURITY E2E OK — aparelho novo avisado no sino, na auditoria e por e-mail; aparelho conhecido não repete");
