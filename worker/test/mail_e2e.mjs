// E-mails automáticos ponta a ponta (provedor simulado na porta 9913): preferência → índice → lote do cron → um envio por dia.
import assert from "node:assert/strict";
import http from "node:http";
const mails = [];
const srv = http.createServer((q, s) => { let b = ""; q.on("data", c => b += c); q.on("end", () => { mails.push(JSON.parse(b)); s.writeHead(200, { "Content-Type": "application/json" }); s.end('{"id":"m1"}'); }); }).listen(9913);
const B = process.env.AURION_TEST_URL || "http://localhost:8799";
const call = async (method, path, body, token) => { const r = await fetch(B + path, { method, body: body ? JSON.stringify(body) : undefined, headers: { "Content-Type": "application/json", ...(token ? { Authorization: "Bearer " + token } : {}) } });
  return { status: r.status, body: r.status === 204 ? null : await r.json() }; };
const st = Date.now();
const reg = async (n) => (await call("POST", "/v1/auth/register", { name: "Marina Costa Lima", email: `mail${n}.${st}@exemplo.com`, profession: "Engenheira", phone: "(69) 99855-" + String(st + n).slice(-4), password: "senhaSegura123", accept_terms: true, plan: "pro" })).body;
const a = await reg(1), b = await reg(2), c = await reg(3);
const y = new Date().getFullYear();
const soon = new Date(Date.now() + 4 * 864e5).toISOString().slice(0, 10);
// A: abre o app (retrato salvo), quer alertas e Daily
await call("PUT", "/v1/notifications/preferences", { email_alerts: true, email_daily: true }, a.token);
await call("POST", "/v1/imports", { filename: "carteira", holdings: [{ name: "CDB Banco Teste", asset_class: "renda_fixa", value: 5000, invested: 4800, custodian: "Banco Teste", maturity: soon }] }, a.token);
assert.equal((await call("GET", "/v1/dashboard", null, a.token)).status, 200);
// B: nunca abriu o app depois de ligar o Daily (usa o cálculo leve de prazos)
await call("PUT", "/v1/notifications/preferences", { email_daily: true }, b.token);
await call("POST", "/v1/imports", { filename: "notas", trades: [{ date: `${y}-01-05`, side: "C", ticker: "PETR4", quantity: 1000, price: 30, value: 30000 }, { date: `${y}-01-20`, side: "V", ticker: "PETR4", quantity: 1000, price: 40, value: 40000 }] }, b.token);
// C: sem e-mail
await call("GET", "/v1/dashboard", null, c.token);

const own = (await call("POST", "/v1/auth/login", { email: "RamonJunio07@gmail.com", password: "senhaDonoTeste2026" })).body.token;
assert.equal((await call("POST", "/v1/admin/mail/run", null, a.token)).status, 403, "só o administrador dispara");
const r1 = (await call("POST", "/v1/admin/mail/run", null, own)).body;
assert.equal(r1.errors, 0, JSON.stringify(r1));
const to = e => mails.filter(m => m.to[0] === e);
const ma = to(a.user.email), mb = to(b.user.email);
assert.ok(ma.some(m => /Vencimento: CDB Banco Teste/.test(m.subject + m.html)), "alerta do vencimento para A");
assert.ok(ma.some(m => /^AURION Daily/.test(m.subject) && /Bom dia, Marina/.test(m.html)), "Daily de A com retrato do app");
assert.ok(mb.length === 1 && /^AURION Daily/.test(mb[0].subject), "B recebe só o Daily");
assert.match(mb[0].html, /DARF/, "B: Daily calculado a partir das negociações (DARF vencido)");
assert.equal(to(c.user.email).length, 0, "C não pediu e-mail");
for (const m of [...ma, ...mb]) { assert.match(m.html, /Configurações/); assert.ok(!/(compre|venda agora|recomendamos)/i.test(m.html)); }
// segunda rodada no mesmo dia: nada novo
const n = mails.length;
await call("POST", "/v1/admin/mail/run", null, own);
assert.equal(mails.length, n, "um envio por dia por cliente");
// desligar: sai do índice
await call("PUT", "/v1/notifications/preferences", { email_alerts: false, email_daily: false }, a.token);
const pr = (await call("GET", "/v1/notifications/preferences", null, a.token)).body;
assert.equal(pr.email_daily, false);
srv.close();
console.log("MAIL E2E OK — preferências, retrato do app, cálculo leve sem retrato, alerta e Daily, um envio por dia, só o administrador dispara");
