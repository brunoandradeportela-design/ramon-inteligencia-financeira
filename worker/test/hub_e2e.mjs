// Professional Hub (leitura delegada), notificações, eventos e integrações contratadas (simuladas na porta 9915).
import assert from "node:assert/strict";
import { start, seen } from "./fake_tts_pbi.mjs";
const fake = await start(9915);
const B = process.env.AURION_TEST_URL || "http://localhost:8799";
const call = async (method, path, body, token, h = {}) => {
  const r = await fetch(B + path, { method, body: body ? JSON.stringify(body) : undefined, headers: { "Content-Type": "application/json", ...(token ? { Authorization: "Bearer " + token } : {}), ...h } });
  return { status: r.status, body: r.status === 204 ? null : await r.json() };
};
const stamp = Date.now();
const reg = async (n, plan = "pro") => { const email = `hub${n}.${stamp}@exemplo.com`; const b = (await call("POST", "/v1/auth/register", { name: ["Carla Nunes Prado", "Paulo Contador Silva", "Outro Usuario Teste"][(n - 1) % 3], email, profession: "Teste", phone: "(69) 99811-70" + (10 + n), password: "senhaSegura123", accept_terms: true, plan })).body; return { ...b, email }; };
const cli = await reg(1), pro = await reg(2), other = await reg(3);
const y = new Date().getFullYear();
await call("POST", "/v1/imports", { filename: "notas", trades: [{ date: `${y}-02-03`, side: "C", ticker: "PETR4", quantity: 1000, price: 30, value: 30000 }, { date: `${y}-02-20`, side: "V", ticker: "PETR4", quantity: 1000, price: 40, value: 40000 }],
  holdings: [{ name: "CDB Banco Teste", asset_class: "renda_fixa", value: 5000, invested: 4800, custodian: "Banco Teste", maturity: new Date(Date.now() + 5 * 864e5).toISOString().slice(0, 10) }] }, cli.token);

// sem concessão: profissional não lê
const AS = { "X-Act-As": cli.user.id };
assert.equal((await call("GET", "/v1/dashboard", null, pro.token, AS)).status, 403);
// concessão
assert.equal((await call("POST", "/v1/sharing/grants", { email: cli.email }, cli.token)).status, 422, "não pode conceder a si mesmo");
const g = (await call("POST", "/v1/sharing/grants", { email: pro.email.toUpperCase(), expires_days: 30 }, cli.token)).body;
assert.equal(g.scope, "leitura"); assert.equal(g.active, true);
assert.equal((await call("POST", "/v1/sharing/grants", { email: pro.email }, cli.token)).status, 409);
const cl = (await call("GET", "/v1/sharing/clients", null, pro.token)).body.items;
assert.equal(cl.length, 1); assert.equal(cl[0].client_id, cli.user.id);
// leitura delegada: vê os dados do cliente, não escreve, não entra em segurança
const me = (await call("GET", "/v1/me", null, pro.token, AS)).body;
assert.equal(me.id, cli.user.id); assert.equal(me.acting.professional_id, pro.user.id);
const tx = (await call("GET", "/v1/tax/summary?year=" + y, null, pro.token, AS)).body;
assert.ok(+tx.total_tax_due > 0, "lê a tributação do cliente");
assert.equal((await call("POST", "/v1/imports", { filename: "x", trades: [] }, pro.token, AS)).status, 403);
assert.equal((await call("GET", "/v1/security", null, pro.token, AS)).status, 403);
assert.equal((await call("GET", "/v1/privacy/export", null, pro.token, AS)).status, 403);
assert.equal((await call("GET", "/v1/sharing/grants", null, pro.token, AS)).status, 403);
assert.equal((await call("GET", "/v1/dashboard", null, other.token, AS)).status, 403, "terceiro sem concessão");
const aud = (await call("GET", "/v1/audit", null, cli.token)).body.items;
assert.ok(aud.some(i => i.action === "profissional.leitura" && i.actor === pro.user.id), "leitura registrada na auditoria do cliente");
// revogação
assert.equal((await call("DELETE", `/v1/sharing/grants/${g.id}`, null, cli.token)).body.active, false);
assert.equal((await call("GET", "/v1/dashboard", null, pro.token, AS)).status, 403);
assert.equal((await call("GET", "/v1/sharing/clients", null, pro.token)).body.items.length, 0);

// notificações: prazo de vencimento em 5 dias; marcar como lida
const n = (await call("GET", "/v1/notifications", null, cli.token)).body;
assert.ok(n.items.some(i => i.kind === "vencimento"), JSON.stringify(n)); assert.ok(n.unread >= 1);
await call("POST", "/v1/notifications/read", { ids: n.items.map(i => i.id) }, cli.token);
assert.equal((await call("GET", "/v1/notifications", null, cli.token)).body.unread, 0);
assert.ok(!(await call("GET", "/v1/notifications", null, other.token)).body.items.some(i => i.kind === "vencimento"), "isolamento");
const pr = (await call("PUT", "/v1/notifications/preferences", { email_alerts: true }, cli.token)).body;
assert.equal(pr.email_alerts, true); assert.equal(pr.email_daily, false);
// eventos
const ev = (await call("GET", "/v1/events", null, cli.token)).body;
assert.ok(ev.exposure.includes("PETR4")); assert.ok(ev.items.some(i => i.kind === "vencimento"));

// integrações contratadas (ligadas neste ambiente de teste com simuladores)
const st = (await call("GET", "/v1/integrations", null, cli.token)).body;
assert.ok(st.items.every(i => !("secrets" in i)), "cliente não vê nomes de segredos");
assert.ok(!JSON.stringify(st).includes("tts-chave-ficticia"));
const tts = await call("POST", "/v1/voice/tts", { text: "Bom dia. Este é o seu AURION Daily." }, cli.token);
assert.equal(tts.status, 200, JSON.stringify(tts.body)); assert.equal(Buffer.from(tts.body.audio_base64, "base64").toString(), "ID3-audio-ficticio");
const emb = (await call("GET", "/v1/analytics/embed", null, cli.token)).body;
assert.equal(emb.configured, true); assert.equal(emb.token, "emb-" + cli.user.id, "RLS pelo id do próprio usuário");
assert.equal(seen.gen.at(-1).accessLevel, "View");
assert.equal((await call("GET", "/v1/analytics/embed", null, (await reg(4, "free")).token)).status, 402);
fake.close();
console.log("HUB E2E OK — concessão/revogação, leitura delegada auditada e somente leitura, notificações, eventos, voz neural e Power BI com RLS (simulados)");
