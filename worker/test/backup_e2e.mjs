// Ensaio de backup e restauração: exporta o ambiente A pelo script real (criptografado), restaura num ambiente B vazio
// e confere login, cálculos, documento binário (2 blocos) e a trilha de auditoria encadeada.
import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import fs from "node:fs";
const A = process.env.AURION_TEST_URL || "http://localhost:8799", PB = 8797, B = `http://localhost:${PB}`;
const TOKEN = "token-de-backup-somente-para-testes-0123456789", env = { ...process.env, BACKUP_TOKEN: TOKEN, BACKUP_PASSPHRASE: "frase-de-teste-do-backup" };
const call = async (base, method, path, body, token, h = {}) => { const r = await fetch(base + path, { method, body: body ? JSON.stringify(body) : undefined, headers: { "Content-Type": "application/json", ...(token ? { Authorization: "Bearer " + token } : {}), ...h } });
  return { status: r.status, body: r.status === 204 ? null : await r.json() }; };
const st = Date.now(), email = `backup.${st}@exemplo.com`, pw = "senhaSegura123";
const u = (await call(A, "POST", "/v1/auth/register", { name: "Helena Prado Souza", email, profession: "Médica", phone: "(69) 99866-" + String(st).slice(-4), password: pw, accept_terms: true, plan: "pro" })).body;
await call(A, "POST", "/v1/imports", { filename: "notas", trades: [{ date: "2026-03-02", side: "C", ticker: "VALE3", quantity: 1000, price: 60, value: 60000 }, { date: "2026-04-10", side: "V", ticker: "VALE3", quantity: 1000, price: 70, value: 70000 }] }, u.token);
const bytes = new Uint8Array(1536 * 1024); for (let i = 0; i < bytes.length; i++) bytes[i] = 32 + ((i * 7919) % 90);
const up = await fetch(A + "/v1/documents", { method: "POST", body: bytes, headers: { "Content-Type": "text/plain", "X-Filename": "extrato_grande.txt", Authorization: "Bearer " + u.token } });
assert.equal(up.status, 201, await up.clone().text()); const doc = await up.json();
const taxA = (await call(A, "GET", "/v1/tax/summary?year=2026", null, u.token)).body;
// sem token: negado; restauração desligada no ambiente A
assert.equal((await call(A, "GET", "/v1/admin/backup/manifest")).status, 403);
assert.equal((await call(A, "GET", "/v1/admin/backup/manifest", null, u.token)).status, 403, "cliente não exporta");
assert.equal((await call(A, "POST", "/v1/admin/restore/tabela/users", { rows: [{ id: "x" }] }, null, { "X-Backup-Token": TOKEN })).status, 409, "restauração desligada fora do destino");

// backup criptografado pelo script real
const file = "/tmp/aurion-backup-teste.enc";
execFileSync("python3", ["../scripts/backup/aurion_backup.py", "backup", "--api", A, "--out", file], { env, stdio: "inherit" });
assert.ok(!fs.readFileSync(file).includes(Buffer.from(email)), "arquivo de backup não contém dados em claro");

// ambiente B vazio, com restauração ligada
fs.rmSync("/tmp/d1-restore", { recursive: true, force: true });
const w = spawn("npx", ["wrangler", "dev", "--local", "--port", String(PB), "--persist-to", "/tmp/d1-restore", "--var", "RESTORE_ENABLED:1", "--var", `BACKUP_TOKEN:${TOKEN}`, "--var", "MARKET_OFFLINE:1", "--var", "OWNER_PASSWORD:senhaDonoTeste2026"], { stdio: "ignore", detached: true });
try {
  for (let i = 0; i < 90; i++) { try { if ((await fetch(B + "/health")).ok) break; } catch {} await new Promise(r => setTimeout(r, 1000)); }
  assert.equal((await call(B, "POST", "/v1/auth/login", { email, password: pw })).status, 401, "B começa vazio");
  execFileSync("python3", ["../scripts/backup/aurion_backup.py", "restore", "--api", B, "--in", file], { env, stdio: "inherit" });
  const lg = await call(B, "POST", "/v1/auth/login", { email, password: pw });
  assert.equal(lg.status, 200, "mesma senha funciona após restaurar");
  const tk = lg.body.token;
  const taxB = (await call(B, "GET", "/v1/tax/summary?year=2026", null, tk)).body;
  assert.equal(taxB.total_tax_due, taxA.total_tax_due); assert.equal(taxB.snapshot_hash, taxA.snapshot_hash);
  const dl = new Uint8Array(await (await fetch(B + `/v1/documents/${doc.id}/download`, { headers: { Authorization: "Bearer " + tk } })).arrayBuffer());
  assert.equal(dl.length, bytes.length); assert.ok(dl.every((x, i) => x === bytes[i]), "documento binário idêntico");
  const au = (await call(B, "GET", "/v1/audit", null, tk)).body;
  assert.equal(au.chain_valid, true, "trilha de auditoria íntegra após restaurar");
  const mA = (await call(A, "GET", "/v1/admin/backup/manifest", null, null, { "X-Backup-Token": TOKEN })).body, mB = (await call(B, "GET", "/v1/admin/backup/manifest", null, null, { "X-Backup-Token": TOKEN })).body;
  for (const t of ["users", "fin_items", "docs", "doc_chunks"]) assert.ok(mB.tables.find(x => x.name === t).rows >= 1 && mB.tables.find(x => x.name === t).rows <= mA.tables.find(x => x.name === t).rows, t);
} finally { try { process.kill(-w.pid); } catch {} fs.rmSync(file, { force: true }); }
console.log("BACKUP E2E OK — exportação criptografada, ambiente vazio restaurado, login, cálculo com mesmo hash, documento binário idêntico, auditoria íntegra");
