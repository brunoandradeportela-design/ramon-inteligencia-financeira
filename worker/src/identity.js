/* AURION Identity — login por e-mail ou CPF, recuperação de senha, MFA (TOTP), sessões/dispositivos,
 * trilha de auditoria encadeada e direitos do titular (LGPD). Módulo do modular monolith (ADR-001).
 *
 * Segredos opcionais (Cloudflare → Secrets):
 *   RESEND_API_KEY + MAIL_FROM   envio do e-mail de recuperação (desligado sem eles; o dono gera link manual no CRM)
 * Chaves internas (geradas na primeira vez e guardadas no D1, nunca no código): app_key (cifra do segredo MFA), cpf_pepper.
 */
import { count as metric } from "./metrics.js";
import { Resp, Problem, nowIso, enc, b64u, randomToken, sha256, safeEqual, hashPassword, checkPassword, kvGet, kvSet, str } from "./shared.js";

export const IDENTITY_SCHEMA = [
  "CREATE TABLE IF NOT EXISTS session_meta (token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL, created_at TEXT NOT NULL, last_seen_at TEXT NOT NULL, device TEXT, place TEXT)",
  "CREATE INDEX IF NOT EXISTS session_meta_user ON session_meta (user_id)",
  "CREATE TABLE IF NOT EXISTS audit_log (user_id TEXT NOT NULL, seq INTEGER NOT NULL, at TEXT NOT NULL, actor TEXT NOT NULL, action TEXT NOT NULL, resource TEXT, entity_id TEXT, meta TEXT, correlation_id TEXT, prev_hash TEXT, hash TEXT NOT NULL, PRIMARY KEY (user_id, seq))",
  "CREATE INDEX IF NOT EXISTS audit_log_at ON audit_log (at)",
];

/* ------------------------------------------------------------------ contexto da requisição (correlation id, origem) */
export const REQ = new WeakMap();
export function reqInfo(req) {
  if (!req) return { cid: null, device: null, place: null };
  const meta = REQ.get(req) || {};
  const ua = req.headers.get("User-Agent") || "";
  const device = /iPhone|iPad/.test(ua) ? "iPhone/iPad" : /Android/.test(ua) ? "Android" : /Windows/.test(ua) ? "Windows" : /Macintosh/.test(ua) ? "Mac" : /Linux/.test(ua) ? "Linux" : "Outro";
  const browser = /Edg\//.test(ua) ? "Edge" : /Chrome\//.test(ua) ? "Chrome" : /Firefox\//.test(ua) ? "Firefox" : /Safari\//.test(ua) ? "Safari" : "Navegador";
  const cf = req.cf || {};
  return { cid: meta.cid || null, device: `${browser} · ${device}`, place: [cf.city, cf.region, cf.country].filter(Boolean).join(", ") || null };
}

/* ------------------------------------------------------------------ trilha de auditoria (encadeada por cliente) */
export async function audit(db, req, { user_id, actor, action, resource = null, entity_id = null, meta = null }) {
  try {
    const last = await db.prepare("SELECT seq, hash FROM audit_log WHERE user_id=? ORDER BY seq DESC LIMIT 1").bind(user_id).first();
    const seq = (last?.seq || 0) + 1, at = nowIso(), info = reqInfo(req);
    const m = meta ? JSON.stringify(meta).slice(0, 2000) : null;
    const prev = last?.hash || "genesis";
    const hash = await sha256([prev, user_id, seq, at, actor, action, resource, entity_id, m].join("|"));
    await db.prepare("INSERT INTO audit_log (user_id,seq,at,actor,action,resource,entity_id,meta,correlation_id,prev_hash,hash) VALUES (?,?,?,?,?,?,?,?,?,?,?)")
      .bind(user_id, seq, at, actor || user_id, action, resource, entity_id, m, info.cid, prev, hash).run();
  } catch (e) { console.error("auditoria falhou", e.message || e); }      // auditoria nunca derruba a operação
}
export async function auditList(db, user_id, limit = 200) {
  const { results } = await db.prepare("SELECT * FROM audit_log WHERE user_id=? ORDER BY seq ASC").bind(user_id).all();
  let prev = "genesis", valid = true;
  for (const r of results) {
    const h = await sha256([prev, r.user_id, r.seq, r.at, r.actor, r.action, r.resource, r.entity_id, r.meta].join("|"));
    if (r.prev_hash !== prev || h !== r.hash) { valid = false; break; }
    prev = r.hash;
  }
  return { chain_valid: valid, total: results.length, items: results.slice(-limit).map(r => ({ seq: r.seq, at: r.at, actor: r.actor, action: r.action, resource: r.resource,
    entity_id: r.entity_id, meta: r.meta ? JSON.parse(r.meta) : null, correlation_id: r.correlation_id, hash: r.hash })) };
}

/* ------------------------------------------------------------------ chaves internas */
async function appSecret(db, name, bytes = 32) {
  let v = await kvGet(db, name);
  if (!v) { v = b64u(crypto.getRandomValues(new Uint8Array(bytes))); await kvSet(db, name, v); }
  return v;
}
const unb64u = s => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4)), c => c.charCodeAt(0));
async function aesKey(db) { return crypto.subtle.importKey("raw", unb64u(await appSecret(db, "app_key")), "AES-GCM", false, ["encrypt", "decrypt"]); }
export async function seal(db, text) { const iv = crypto.getRandomValues(new Uint8Array(12)); const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await aesKey(db), enc.encode(text)); return b64u(iv) + "." + b64u(ct); }
export async function unseal(db, s) { const [iv, ct] = s.split("."); return new TextDecoder().decode(await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64u(iv) }, await aesKey(db), unb64u(ct))); }

/* CPF nunca é guardado em claro: índice por HMAC com pepper interno + versão mascarada para exibição */
export const cpfDigits = v => String(v || "").replace(/\D/g, "");
export const maskCpf = d => `***.${d.slice(3, 6)}.${d.slice(6, 9)}-**`;
export async function cpfHash(db, digits) {
  const key = await crypto.subtle.importKey("raw", enc.encode(await appSecret(db, "cpf_pepper")), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return b64u(await crypto.subtle.sign("HMAC", key, enc.encode(digits)));
}

/* ------------------------------------------------------------------ segurança da conta (mesmo formato para dono e clientes) */
export const getSec = (db, uid) => kvGet(db, "sec:" + uid, { mfa: null, cpf_hash: null, cpf_masked: null });
export const setSec = (db, uid, sec) => kvSet(db, "sec:" + uid, sec);

/* ------------------------------------------------------------------ TOTP (RFC 6238, 30 s, 6 dígitos, SHA-1) */
const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
export function base32(bytes) { let bits = 0, val = 0, out = ""; for (const b of bytes) { val = (val << 8) | b; bits += 8; while (bits >= 5) { out += B32[(val >>> (bits - 5)) & 31]; bits -= 5; } } if (bits > 0) out += B32[(val << (5 - bits)) & 31]; return out; }
export function unbase32(s) { const clean = s.toUpperCase().replace(/[^A-Z2-7]/g, ""); let bits = 0, val = 0; const out = []; for (const c of clean) { val = (val << 5) | B32.indexOf(c); bits += 5; if (bits >= 8) { out.push((val >>> (bits - 8)) & 255); bits -= 8; } } return new Uint8Array(out); }
export async function totp(secretB32, step) {
  const key = await crypto.subtle.importKey("raw", unbase32(secretB32), { name: "HMAC", hash: "SHA-1" }, false, ["sign"]);
  const msg = new ArrayBuffer(8); new DataView(msg).setUint32(4, step);  new DataView(msg).setUint32(0, Math.floor(step / 2 ** 32));
  const h = new Uint8Array(await crypto.subtle.sign("HMAC", key, msg)), o = h[19] & 15;
  return String((((h[o] & 127) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3]) % 1e6).padStart(6, "0");
}
async function checkTotp(db, uid, sec, code) {
  const c = String(code || "").replace(/\D/g, "");
  if (c.length === 6 && sec.mfa?.secret) {
    const secret = await unseal(db, sec.mfa.secret), now = Math.floor(Date.now() / 30000);
    for (const s of [now - 1, now, now + 1]) if (s > (sec.mfa.last_step || 0) && safeEqual(await totp(secret, s), c)) { sec.mfa.last_step = s; await setSec(db, uid, sec); return "totp"; }
  }
  const rc = String(code || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (rc.length === 10 && sec.mfa?.recovery?.length) {
    const h = await sha256("rc:" + rc), i = sec.mfa.recovery.indexOf(h);
    if (i >= 0) { sec.mfa.recovery.splice(i, 1); await setSec(db, uid, sec); return "recovery"; }
  }
  return null;
}

/* ------------------------------------------------------------------ sessões e dispositivos */
const SESSION_DAYS = 30;
export async function newSession(db, userId, req) {
  const token = randomToken(), th = await sha256(token), info = reqInfo(req), now = nowIso();
  await db.batch([
    db.prepare("INSERT INTO sessions (token_hash,user_id,expires_at) VALUES (?,?,?)").bind(th, userId, new Date(Date.now() + SESSION_DAYS * 864e5).toISOString()),
    db.prepare("INSERT INTO session_meta (token_hash,user_id,created_at,last_seen_at,device,place) VALUES (?,?,?,?,?,?)").bind(th, userId, now, now, info.device, info.place)]);
  return token;
}
/* acesso de navegador/aparelho e região novos: avisa no app (sino) e por e-mail, se configurado (v6.0 §24) */
export async function checkNewDevice(db, env, req, uid, user, first = false) {
  const info = reqInfo(req), region = (info.place || "").split(",").slice(-2).map(x => x.trim()).join(", ") || "local desconhecido";
  const fp = `${info.device || "?"}|${region}`, key = "known_devices:" + uid, list = await kvGet(db, key, []);
  if (list.includes(fp)) return false;
  await kvSet(db, key, [fp, ...list].slice(0, 20));
  if (first || !list.length) return false;
  const notice = { id: randomToken(6).replace(/[-_]/g, ""), at: nowIso(), device: info.device, place: info.place || region };
  await kvSet(db, "sec_notices:" + uid, [notice, ...(await kvGet(db, "sec_notices:" + uid, []))].slice(0, 10));
  await audit(db, req, { user_id: uid, actor: uid, action: "login.novo_dispositivo", resource: "session", meta: { dispositivo: info.device, local: notice.place } });
  if (mailConfigured(env) && user?.email) {
    const first = String(user.name || "").split(" ")[0] || "Olá";
    await sendMail(env, user.email, "AURION: novo acesso à sua conta", `<p>Olá, ${first}.</p><p>Houve um acesso à sua conta AURION em <b>${String(info.device || "").replace(/[<>&]/g, "")}</b>, ${String(notice.place).replace(/[<>&]/g, "")}, em ${new Date(notice.at).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}.</p><p>Se foi você, não precisa fazer nada. Se não foi, troque a senha e encerre as outras sessões em Configurações → Segurança: <a href="${appUrl(env)}#/configuracoes">${appUrl(env)}#/configuracoes</a>.</p>`).catch(e => console.error("e-mail de novo acesso falhou", e.message || e));
  }
  return true;
}
export async function touchSession(db, th) {
  try { await db.prepare("UPDATE session_meta SET last_seen_at=? WHERE token_hash=? AND last_seen_at < ?").bind(nowIso(), th, new Date(Date.now() - 10 * 60e3).toISOString()).run(); } catch { /* opcional */ }
}
async function revokeAll(db, uid, exceptTh = null) {
  const { results } = await db.prepare("SELECT token_hash FROM sessions WHERE user_id=?").bind(uid).all();
  const del = results.map(r => r.token_hash).filter(t => t !== exceptTh);
  for (const t of del) await db.batch([db.prepare("DELETE FROM sessions WHERE token_hash=?").bind(t), db.prepare("DELETE FROM session_meta WHERE token_hash=?").bind(t)]);
  return del.length;
}

/* ------------------------------------------------------------------ e-mail (adapter; desligado sem credencial) */
export const mailConfigured = env => !!(env.RESEND_API_KEY && env.MAIL_FROM);
export async function sendMail(env, to, subject, html) {
  const r = await fetch((env.RESEND_BASE_URL || "https://api.resend.com") + "/emails", { method: "POST", signal: AbortSignal.timeout(10000),
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json" }, body: JSON.stringify({ from: env.MAIL_FROM, to: [to], subject, html }) });
  if (!r.ok) throw new Error("falha no envio de e-mail: HTTP " + r.status);
}
const appUrl = env => (env.APP_URL || "https://aurionfinance.com.br/app/").replace(/\/?$/, "/");

/* ------------------------------------------------------------------ rotas de identidade */
export function strongPassword(pw) { return pw.length >= 10 && /\d/.test(pw) && /[a-z]/i.test(pw); }

export async function identityRoute(m, p, body, q, req, env, db, D) {
  const ip = req.headers.get("CF-Connecting-IP") || "local";
  /* resolve e-mail ou CPF → { uid, email } */
  async function resolve(identifier) {
    const raw = String(identifier || "").trim(), digits = cpfDigits(raw);
    if (!raw.includes("@") && digits.length === 11) {
      if (!D.docValid(digits)) return { kind: "cpf", uid: null };
      const uid = await kvGet(db, "cpf_idx:" + await cpfHash(db, digits));
      if (!uid) return { kind: "cpf", uid: null };
      if (uid === D.OWNER_ID) return { kind: "cpf", uid, email: D.ownerEmail(env) };
      const c = await D.getCustomer(db, uid); return { kind: "cpf", uid: c ? uid : null, email: c?.email };
    }
    const email = raw.toLowerCase();
    if (email === D.ownerEmail(env)) return { kind: "email", uid: D.OWNER_ID, email };
    const c = await D.getCustomerByEmail(db, email); return { kind: "email", uid: c?.id || null, email };
  }
  async function issue(uid, { first = false } = {}) {
    const token = await newSession(db, uid, req);
    const user = uid === D.OWNER_ID ? D.ownerMe(env, await kvGet(db, "owner_theme", "system")) : D.meFromCustomer(await D.getCustomer(db, uid));
    try { await checkNewDevice(db, env, req, uid, user, first); } catch (e) { console.error("aviso de novo acesso falhou", e.message || e); }
    return { token, user };
  }

  if (m === "POST" && p === "/v1/auth/register") {
    const errors = D.validateSignup(body);
    const cpf = cpfDigits(body.cpf);
    if (body.cpf && (cpf.length !== 11 || !D.docValid(cpf))) errors.push({ field: "cpf", msg: "CPF inválido" });
    if (errors.length) throw new Problem(422, "Dados inválidos", "Cadastro inválido", { errors });
    const email = body.email.trim().toLowerCase();
    if (email === D.ownerEmail(env) || await D.getCustomerByEmail(db, email)) throw new Problem(409, "Conflito", "Já existe uma conta com este e-mail.");
    let ch = null;
    if (cpf) { ch = await cpfHash(db, cpf); if (await kvGet(db, "cpf_idx:" + ch)) throw new Problem(409, "Conflito", "Já existe uma conta com este CPF."); }
    const c = D.localCustomer({ ...body, plan: ["pro", "premium"].includes(body.plan) ? body.plan : "free" });
    c.id = "usr_" + randomToken(12).replace(/[-_]/g, "").slice(0, 16).toLowerCase();
    c.origin = body.origin || "site"; c.tags = [];
    const at = nowIso();   // aceite registrado com versão e momento; comunicações opcionais ficam separadas
    c.consents = { termos_uso: { versao: D.LEGAL_VERSION, aceito_em: at }, politica_privacidade: { versao: D.LEGAL_VERSION, aceito_em: at },
      comunicacoes: body.marketing_opt_in === true ? { aceito_em: at } : null };
    c.timeline = [{ at: c.created_at, kind: "cadastro", text: `Cadastro no plano ${c.plan_name} (origem: ${c.origin})` }];
    D.recompute(c);
    await db.prepare("INSERT INTO users (id,email,pw,data,created_at) VALUES (?,?,?,?,?)").bind(c.id, c.email, await hashPassword(body.password), JSON.stringify(c), c.created_at).run();
    if (ch) { await kvSet(db, "cpf_idx:" + ch, c.id); await setSec(db, c.id, { mfa: null, cpf_hash: ch, cpf_masked: maskCpf(cpf) }); }
    await audit(db, req, { user_id: c.id, actor: c.id, action: "conta.criada", resource: "user", entity_id: c.id, meta: { plano: c.plan, cpf: !!ch, termos_versao: D.LEGAL_VERSION, comunicacoes: !!c.consents.comunicacoes } });
    return new Resp(201, await issue(c.id, { first: true }));
  }

  if (m === "POST" && p === "/v1/auth/login") {
    const ident = String(body.identifier ?? body.email ?? "").trim(), pw = String(body.password || "");
    const key = ident.toLowerCase().replace(/[.\-\s]/g, "");
    await D.throttle(db, key);
    const who = await resolve(ident);
    const fail = async () => {
      await D.loginFailed(db, key);
      metric("auth.login_falhou");
      if (who.uid) await audit(db, req, { user_id: who.uid, actor: "anônimo", action: "login.falhou", resource: "session", meta: { via: who.kind } });
      throw new Problem(401, "Não autenticado", `${who.kind === "cpf" ? "CPF" : "E-mail"} ou senha incorretos.`);
    };
    if (who.uid === D.OWNER_ID) {
      const stored = await kvGet(db, "owner_pw");
      if (!env.OWNER_PASSWORD && !stored) throw new Problem(409, "Primeiro acesso do administrador", "Defina sua senha com o código de ativação.", { code: "owner_setup_required" });
      if (!(stored ? await checkPassword(pw, stored) : safeEqual(pw, env.OWNER_PASSWORD))) await fail();
    } else {
      const row = who.uid ? await db.prepare("SELECT pw FROM users WHERE id=?").bind(who.uid).first() : null;
      if (!row || !(await checkPassword(pw, row.pw))) await fail();
    }
    await db.prepare("DELETE FROM login_fails WHERE email=?").bind(key).run();
    const sec = await getSec(db, who.uid);
    if (sec.mfa?.enabled) {
      const t = randomToken(24);
      await kvSet(db, "mfa_ticket:" + await sha256(t), { uid: who.uid, exp: Date.now() + 5 * 60e3, via: who.kind });
      return { mfa_required: true, mfa_token: t };
    }
    if (who.uid !== D.OWNER_ID) { const c = await D.getCustomer(db, who.uid); c.last_login_at = nowIso(); await D.saveCustomer(db, c); }
    await audit(db, req, { user_id: who.uid, actor: who.uid, action: "login", resource: "session", meta: { via: who.kind, mfa: false } });
    return issue(who.uid);
  }

  if (m === "POST" && p === "/v1/auth/mfa/verify") {
    const th = await sha256(String(body.mfa_token || "")), t = await kvGet(db, "mfa_ticket:" + th);
    await D.throttle(db, "mfa:" + th.slice(0, 16));
    if (!t || t.exp < Date.now()) throw new Problem(401, "Código expirado", "A etapa de verificação expirou. Entre novamente.");
    const sec = await getSec(db, t.uid), how = await checkTotp(db, t.uid, sec, body.code);
    if (!how) { await D.loginFailed(db, "mfa:" + th.slice(0, 16)); await audit(db, req, { user_id: t.uid, actor: t.uid, action: "mfa.falhou", resource: "session" }); throw new Problem(401, "Código incorreto", "Código de verificação incorreto."); }
    await db.prepare("DELETE FROM kv WHERE k=?").bind("mfa_ticket:" + th).run();
    if (t.uid !== D.OWNER_ID) { const c = await D.getCustomer(db, t.uid); c.last_login_at = nowIso(); await D.saveCustomer(db, c); }
    await audit(db, req, { user_id: t.uid, actor: t.uid, action: "login", resource: "session", meta: { via: t.via, mfa: how } });
    return issue(t.uid);
  }

  /* recuperação de senha: resposta sempre igual (não revela se a conta existe) */
  if (m === "POST" && p === "/v1/auth/recover") {
    await D.throttle(db, "rec:" + ip);
    await D.loginFailed(db, "rec:" + ip);                       // conta tentativas por IP (5 em 15 min)
    const who = await resolve(body.identifier ?? body.email);
    if (who.uid && mailConfigured(env)) {
      const t = randomToken(24);
      await kvSet(db, "reset:" + await sha256(t), { uid: who.uid, exp: Date.now() + 30 * 60e3 });
      const link = `${appUrl(env)}#/redefinir?token=${t}`;
      try {
        await sendMail(env, who.email, "Redefinição de senha — Aurion",
          `<p>Recebemos um pedido para redefinir sua senha.</p><p><a href="${link}">Criar nova senha</a> (válido por 30 minutos, uma única vez).</p><p>Se não foi você, ignore este e-mail.</p>`);
        await audit(db, req, { user_id: who.uid, actor: "anônimo", action: "senha.recuperacao_solicitada", resource: "user", meta: { via: who.kind } });
      } catch (e) { console.error(e.message); }
    }
    return new Resp(202, { accepted: true, email_enabled: mailConfigured(env),
      message: mailConfigured(env) ? "Se houver uma conta com esse dado, enviamos um link para o e-mail cadastrado. Ele vale por 30 minutos."
        : "A recuperação automática por e-mail ainda está em ativação. Fale com o suporte para receber um link seguro de redefinição." });
  }
  if (m === "POST" && p === "/v1/auth/reset") {
    const th = await sha256(String(body.token || "")), t = await kvGet(db, "reset:" + th);
    if (!t || t.exp < Date.now()) throw new Problem(400, "Link inválido", "Este link expirou ou já foi usado. Peça um novo.");
    const pw = String(body.password || "");
    if (!strongPassword(pw)) throw new Problem(422, "Senha fraca", "Use 10+ caracteres, com letras e números.");
    if (t.uid === D.OWNER_ID) await kvSet(db, "owner_pw", await hashPassword(pw));
    else await db.prepare("UPDATE users SET pw=? WHERE id=?").bind(await hashPassword(pw), t.uid).run();
    await db.prepare("DELETE FROM kv WHERE k=?").bind("reset:" + th).run();
    const n = await revokeAll(db, t.uid);
    await audit(db, req, { user_id: t.uid, actor: t.uid, action: "senha.redefinida", resource: "user", meta: { sessoes_encerradas: n } });
    return issue(t.uid);
  }

  /* ---- daqui para baixo exige sessão */
  const u = await D.authUser(req, env, db);
  const uid = u.me.id;

  if (m === "POST" && p === "/v1/auth/logout") {
    await db.batch([db.prepare("DELETE FROM sessions WHERE token_hash=?").bind(u.sid), db.prepare("DELETE FROM session_meta WHERE token_hash=?").bind(u.sid)]);
    await audit(db, req, { user_id: uid, actor: uid, action: "logout", resource: "session" });
    return new Resp(204);
  }
  if (m === "POST" && p === "/v1/auth/password") {
    const cur = String(body.current_password || ""), pw = String(body.new_password || "");
    const ok = u.owner ? await checkPassword(cur, await kvGet(db, "owner_pw")) : await checkPassword(cur, (await db.prepare("SELECT pw FROM users WHERE id=?").bind(uid).first())?.pw);
    if (!ok) throw new Problem(401, "Senha atual incorreta", "Confira a senha atual.");
    if (!strongPassword(pw)) throw new Problem(422, "Senha fraca", "Use 10+ caracteres, com letras e números.");
    if (u.owner) await kvSet(db, "owner_pw", await hashPassword(pw)); else await db.prepare("UPDATE users SET pw=? WHERE id=?").bind(await hashPassword(pw), uid).run();
    const n = await revokeAll(db, uid, u.sid);
    await audit(db, req, { user_id: uid, actor: uid, action: "senha.alterada", resource: "user", meta: { outras_sessoes_encerradas: n } });
    return { changed: true, other_sessions_revoked: n };
  }

  /* segurança: CPF e MFA */
  if (m === "GET" && p === "/v1/security") {
    const sec = await getSec(db, uid);
    return { cpf_masked: sec.cpf_masked, mfa_enabled: !!sec.mfa?.enabled, recovery_codes_left: sec.mfa?.enabled ? (sec.mfa.recovery || []).length : 0, email_recovery_enabled: mailConfigured(env) };
  }
  if (m === "PUT" && p === "/v1/security/cpf") {
    const d = cpfDigits(body.cpf);
    if (d.length !== 11 || !D.docValid(d)) throw new Problem(422, "Dados inválidos", "CPF inválido.", { errors: [{ field: "cpf", msg: "CPF inválido" }] });
    const sec = await getSec(db, uid), h = await cpfHash(db, d), other = await kvGet(db, "cpf_idx:" + h);
    if (other && other !== uid) throw new Problem(409, "Conflito", "Este CPF já está em outra conta.");
    if (sec.cpf_hash && sec.cpf_hash !== h) await db.prepare("DELETE FROM kv WHERE k=?").bind("cpf_idx:" + sec.cpf_hash).run();
    await kvSet(db, "cpf_idx:" + h, uid); sec.cpf_hash = h; sec.cpf_masked = maskCpf(d); await setSec(db, uid, sec);
    await audit(db, req, { user_id: uid, actor: uid, action: "cpf.definido", resource: "user", meta: { cpf: sec.cpf_masked } });
    return { cpf_masked: sec.cpf_masked };
  }
  if (m === "POST" && p === "/v1/security/mfa/setup") {
    const sec = await getSec(db, uid);
    if (sec.mfa?.enabled) throw new Problem(409, "MFA já ativo", "Desative antes de configurar de novo.");
    const secret = base32(crypto.getRandomValues(new Uint8Array(20)));
    sec.mfa = { enabled: false, secret: await seal(db, secret), pending_at: nowIso() }; await setSec(db, uid, sec);
    const label = encodeURIComponent(`Aurion:${u.me.email}`);
    return { secret, otpauth_uri: `otpauth://totp/${label}?secret=${secret}&issuer=Aurion&algorithm=SHA1&digits=6&period=30` };
  }
  if (m === "POST" && p === "/v1/security/mfa/enable") {
    const sec = await getSec(db, uid);
    if (!sec.mfa?.secret || sec.mfa.enabled) throw new Problem(409, "Configuração ausente", "Comece a configuração do MFA novamente.");
    if (!(await checkTotp(db, uid, sec, body.code))) throw new Problem(422, "Código incorreto", "O código do aplicativo autenticador não confere. Confira o horário do celular.");
    const codes = Array.from({ length: 8 }, () => base32(crypto.getRandomValues(new Uint8Array(7))).slice(0, 10));
    sec.mfa.enabled = true; sec.mfa.enabled_at = nowIso(); sec.mfa.recovery = await Promise.all(codes.map(c => sha256("rc:" + c)));
    await setSec(db, uid, sec);
    await audit(db, req, { user_id: uid, actor: uid, action: "mfa.ativado", resource: "user" });
    return { enabled: true, recovery_codes: codes.map(c => c.slice(0, 5) + "-" + c.slice(5)) };
  }
  if (m === "POST" && p === "/v1/security/mfa/disable") {
    const sec = await getSec(db, uid);
    if (!sec.mfa?.enabled) return { enabled: false };
    if (!(await checkTotp(db, uid, sec, body.code))) throw new Problem(422, "Código incorreto", "Informe um código do autenticador ou um código de recuperação.");
    sec.mfa = null; await setSec(db, uid, sec);
    await audit(db, req, { user_id: uid, actor: uid, action: "mfa.desativado", resource: "user" });
    return { enabled: false };
  }

  /* sessões e dispositivos */
  if (m === "GET" && p === "/v1/sessions") {
    const { results } = await db.prepare("SELECT m.token_hash, m.created_at, m.last_seen_at, m.device, m.place, s.expires_at FROM session_meta m JOIN sessions s ON s.token_hash=m.token_hash WHERE m.user_id=? AND s.expires_at > ? ORDER BY m.last_seen_at DESC")
      .bind(uid, nowIso()).all();
    return { items: results.map(r => ({ id: r.token_hash.slice(0, 16), current: r.token_hash === u.sid, device: r.device, place: r.place, created_at: r.created_at, last_seen_at: r.last_seen_at, expires_at: r.expires_at })) };
  }
  const sm = p.match(/^\/v1\/sessions\/([A-Za-z0-9_-]{16})$/);
  if (m === "DELETE" && sm) {
    const r = await db.prepare("SELECT token_hash FROM session_meta WHERE user_id=? AND substr(token_hash,1,16)=?").bind(uid, sm[1]).first();
    if (!r) throw new Problem(404, "Sessão não encontrada", sm[1]);
    await db.batch([db.prepare("DELETE FROM sessions WHERE token_hash=?").bind(r.token_hash), db.prepare("DELETE FROM session_meta WHERE token_hash=?").bind(r.token_hash)]);
    await audit(db, req, { user_id: uid, actor: uid, action: "sessao.encerrada", resource: "session", entity_id: sm[1] });
    return new Resp(204);
  }
  if (m === "DELETE" && p === "/v1/sessions") {
    const n = await revokeAll(db, uid, u.sid);
    await audit(db, req, { user_id: uid, actor: uid, action: "sessoes.encerradas", resource: "session", meta: { quantidade: n } });
    return { revoked: n };
  }

  /* trilha de auditoria do próprio titular */
  if (m === "GET" && p === "/v1/audit") return auditList(db, uid, Math.min(+q.limit || 200, 500));

  /* administrador: link de redefinição para um cliente (enquanto o e-mail não estiver ativo) e auditoria geral */
  const rl = p.match(/^\/v1\/admin\/users\/([^/]+)\/reset-link$/);
  if (m === "POST" && rl) {
    if (!u.owner) throw new Problem(403, "Acesso negado", "Área exclusiva do administrador.");
    const c = await D.getCustomer(db, rl[1]);
    if (!c) throw new Problem(404, "Cliente não encontrado", rl[1]);
    const t = randomToken(24);
    await kvSet(db, "reset:" + await sha256(t), { uid: c.id, exp: Date.now() + 24 * 3600e3 });
    await audit(db, req, { user_id: c.id, actor: uid, action: "senha.link_gerado_pelo_admin", resource: "user", entity_id: c.id });
    await audit(db, req, { user_id: uid, actor: uid, action: "admin.link_redefinicao", resource: "user", entity_id: c.id });
    return { url: `${appUrl(env)}#/redefinir?token=${t}`, expires_in_hours: 24 };
  }
  if (m === "GET" && p === "/v1/admin/audit") {
    if (!u.owner) throw new Problem(403, "Acesso negado", "Área exclusiva do administrador.");
    const { results } = await db.prepare("SELECT user_id, seq, at, actor, action, resource, entity_id, correlation_id FROM audit_log ORDER BY at DESC LIMIT ?").bind(Math.min(+q.limit || 300, 1000)).all();
    return { items: results };
  }
  return null;
}

/* exportação e eliminação (LGPD) */
export async function privacyExport(db, uid, D) {
  const c = uid === D.OWNER_ID ? null : await D.getCustomer(db, uid);
  const fin = (await db.prepare("SELECT kind, id, import_id, data FROM fin_items WHERE user_id=?").bind(uid).all()).results.map(r => ({ kind: r.kind, id: r.id, import_id: r.import_id, ...JSON.parse(r.data) }));
  const docs = (await db.prepare("SELECT data FROM docs WHERE user_id=?").bind(uid).all()).results.map(r => JSON.parse(r.data));
  const kv = (await db.prepare("SELECT k, v FROM kv WHERE k LIKE ? OR k LIKE ?").bind(`%:${uid}`, `%:${uid}:%`).all()).results
    .filter(r => !/^(sec|mfa_ticket|reset):/.test(r.k)).map(r => ({ chave: r.k.split(":")[0], valor: JSON.parse(r.v) }));
  const sec = await getSec(db, uid);
  const { password, pw, billing, ...profile } = c || {};
  return { exported_at: nowIso(), titular: uid, perfil: c ? profile : { id: uid, papel: "administrador" }, seguranca: { cpf: sec.cpf_masked, mfa: !!sec.mfa?.enabled },
    dados_financeiros: fin, documentos: docs.map(d => ({ ...d, conteudo: "baixe pela tela Documentos" })), preferencias_e_registros: kv, auditoria: (await auditList(db, uid, 5000)).items };
}
export async function privacyDelete(db, req, uid, D) {
  const docIds = [...(await db.prepare("SELECT id FROM docs WHERE user_id=?").bind(uid).all()).results.map(r => r.id),
    ...(await db.prepare("SELECT id FROM fin_items WHERE user_id=? AND kind='raw'").bind(uid).all()).results.map(r => r.id)];
  const sec = await getSec(db, uid);
  const stmts = [db.prepare("DELETE FROM fin_items WHERE user_id=?").bind(uid), db.prepare("DELETE FROM docs WHERE user_id=?").bind(uid),
    db.prepare("DELETE FROM sessions WHERE user_id=?").bind(uid), db.prepare("DELETE FROM session_meta WHERE user_id=?").bind(uid),
    db.prepare("DELETE FROM kv WHERE k LIKE ? OR k LIKE ?").bind(`%:${uid}`, `%:${uid}:%`), db.prepare("DELETE FROM users WHERE id=?").bind(uid)];
  if (sec.cpf_hash) stmts.push(db.prepare("DELETE FROM kv WHERE k=?").bind("cpf_idx:" + sec.cpf_hash));
  for (const id of docIds) stmts.push(db.prepare("DELETE FROM doc_chunks WHERE doc_id=?").bind(id));
  await db.batch(stmts);
  await audit(db, req, { user_id: uid, actor: uid, action: "conta.eliminada", resource: "user", meta: { documentos: docIds.length, retencao: "trilha de auditoria mantida por obrigação legal" } });
}
