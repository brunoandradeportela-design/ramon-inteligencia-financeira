/* Aurion API (Cloudflare Workers + D1) — contas, CRM e pagamentos Asaas em tempo real.
 *
 * Rotas reais: autenticação, perfil, CRM do dono, pagamentos (Asaas: checkout, webhook, sincronização).
 * Os módulos de análise do app (finanças, impostos, simulações…) continuam rodando no navegador.
 *
 * Secrets (Cloudflare → Worker → Settings → Variables and Secrets, tipo "Secret"):
 *   OWNER_PASSWORD         senha do Ramon (10+ caracteres, letras e números)
 *   ASAAS_API_KEY          chave da API do Asaas ($aact_prod_… ou $aact_hmlg_…)
 *   ASAAS_WEBHOOK_TOKEN    token escolhido no cadastro do webhook no Asaas
 * Variáveis (wrangler.toml): OWNER_EMAIL, OWNER_NAME, ALLOWED_ORIGINS
 */
import { financeSummary, transactionsList, portfolioSummary, dashboardSummary, categorize } from "../../apps/web/app/js/fin_engine.js";
import { validateSignup, localCustomer, metricsFrom, addMonth, PRICE, PLAN_NAME, paymentsFrom, docValid, normalizePhone } from "../../apps/web/app/js/crm_rules.js";

const FEATURES = {
  free: ["alertas_limitados", "conexoes", "dashboard", "documentos", "financas", "orcamento", "patrimonio"],
  pro: ["assistente_ia", "conexoes", "dashboard", "documentos", "financas", "inteligencia_financeira", "inteligencia_tributaria", "orcamento", "patrimonio", "radar", "simulacao"],
  premium: ["assistente_ia", "automacao", "cenarios_avancados", "conexoes", "dashboard", "documentos", "financas", "inteligencia_financeira", "inteligencia_patrimonial", "inteligencia_tributaria", "orcamento", "patrimonio", "radar", "simulacao", "suporte_prioritario"],
};
const STATUS_MAP = {
  RECEIVED: "pago", CONFIRMED: "pago", RECEIVED_IN_CASH: "pago", DUNNING_RECEIVED: "pago",
  PENDING: "pendente", AWAITING_RISK_ANALYSIS: "pendente", AUTHORIZED: "pendente",
  OVERDUE: "atrasado", DUNNING_REQUESTED: "atrasado",
  REFUNDED: "estornado", REFUND_REQUESTED: "estornado", REFUND_IN_PROGRESS: "estornado",
  CHARGEBACK_REQUESTED: "estornado", CHARGEBACK_DISPUTE: "estornado", AWAITING_CHARGEBACK_REVERSAL: "estornado",
};
const METHOD_MAP = { PIX: "pix", BOLETO: "boleto", CREDIT_CARD: "cartao", DEBIT_CARD: "cartao", UNDEFINED: "a_definir", TRANSFER: "transferencia", DEPOSIT: "transferencia" };
const SESSION_DAYS = 30;
const OWNER_ID = "usr_owner";

/* ------------------------------------------------------------------ utilitários */
class Resp { constructor(status, body = null) { this.status = status; this.body = body; } }
class Problem extends Error {
  constructor(status, title, detail, extra = {}) { super(detail); this.status = status; this.title = title; this.detail = detail; this.extra = extra; }
}
const nowIso = () => new Date().toISOString();
const today = () => nowIso().slice(0, 10);
const money = v => (Math.round(Number(v || 0) * 100) / 100).toFixed(2);
const enc = new TextEncoder();
const b64u = buf => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const randomToken = (n = 32) => b64u(crypto.getRandomValues(new Uint8Array(n)));
async function sha256(s) { return b64u(await crypto.subtle.digest("SHA-256", enc.encode(s))); }
function safeEqual(a, b) {
  a = String(a || ""); b = String(b || "");
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
}
async function hashPassword(pw, salt = randomToken(16), iter = 100000) {
  const key = await crypto.subtle.importKey("raw", enc.encode(pw), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: enc.encode(salt), iterations: iter }, key, 256);
  return `pbkdf2$${iter}$${salt}$${b64u(bits)}`;
}
async function checkPassword(pw, stored) {
  const [, iter, salt] = String(stored || "").split("$");
  if (!iter) return false;
  return safeEqual(await hashPassword(pw, salt, +iter), stored);
}

/* ------------------------------------------------------------------ banco (D1) */
const SCHEMA = [
  "CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL, pw TEXT NOT NULL, data TEXT NOT NULL, created_at TEXT NOT NULL)",
  "CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL, expires_at TEXT NOT NULL)",
  "CREATE TABLE IF NOT EXISTS gw_payments (id TEXT PRIMARY KEY, data TEXT NOT NULL, updated_at TEXT NOT NULL)",
  "CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT NOT NULL)",
  "CREATE TABLE IF NOT EXISTS login_fails (email TEXT PRIMARY KEY, n INTEGER NOT NULL, until TEXT)",
  "CREATE TABLE IF NOT EXISTS fin_items (user_id TEXT NOT NULL, kind TEXT NOT NULL, id TEXT NOT NULL, import_id TEXT NOT NULL, data TEXT NOT NULL, PRIMARY KEY (user_id, kind, id))",
  "CREATE INDEX IF NOT EXISTS fin_items_import ON fin_items (user_id, import_id)",
];
let schemaReady = false;
async function ensureSchema(db) {
  if (schemaReady) return;
  await db.batch(SCHEMA.map(s => db.prepare(s)));
  schemaReady = true;
}
const kvGet = async (db, k, d = null) => { const r = await db.prepare("SELECT v FROM kv WHERE k=?").bind(k).first(); return r ? JSON.parse(r.v) : d; };
const kvSet = (db, k, v) => db.prepare("INSERT INTO kv (k,v) VALUES (?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v").bind(k, JSON.stringify(v)).run();
async function getCustomer(db, id) { const r = await db.prepare("SELECT data FROM users WHERE id=?").bind(id).first(); return r ? JSON.parse(r.data) : null; }
async function getCustomerByEmail(db, email) { const r = await db.prepare("SELECT data FROM users WHERE email=?").bind(email).first(); return r ? JSON.parse(r.data) : null; }
async function allCustomers(db) { const { results } = await db.prepare("SELECT data FROM users").all(); return results.map(r => JSON.parse(r.data)); }
async function saveCustomer(db, c) {
  recompute(c);
  await db.prepare("UPDATE users SET data=? WHERE id=?").bind(JSON.stringify(c), c.id).run();
  return c;
}

/* ------------------------------------------------------------------ regras do CRM */
function recompute(c) {
  const pays = c.payments || [];
  const paid = pays.filter(p => p.status === "pago");
  c.total_paid = money(paid.reduce((s, p) => s + +p.amount, 0));
  c.last_payment = [...pays].sort((a, b) => (b.date || "").localeCompare(a.date || ""))[0] || null;
  const sub = c.subscription || (c.subscription = {});
  let st;
  if (sub.status === "cancelada") st = "cancelado";
  else if (sub.status === "inadimplente" || pays.some(p => p.status === "atrasado")) st = "inadimplente";
  else if (paid.length && sub.status === "ativa") st = "pagante";
  else if (c.plan !== "free") st = "aguardando_pagamento";
  else st = c.last_login_at && c.last_login_at.slice(0, 16) !== c.created_at.slice(0, 16) ? "ativado" : "novo_cadastro";
  c.stage_auto = st;
  if (!c.stage_overridden) c.stage = st;
  return c;
}
function setPlan(c, plan, status) {
  c.plan = plan; c.plan_name = PLAN_NAME[plan];
  c.subscription = { ...(c.subscription || {}), plan, price_month: PRICE[plan] };
  if (status) c.subscription.status = status;
  else if (plan === "free") { c.subscription.status = "gratuita"; c.subscription.next_due = null; }
}
function upsertGatewayPayment(c, gid, rec) {
  const prev = (c.payments || []).find(p => p.id === gid);
  const due = (rec.due_date || today()).slice(0, 10);
  const p = { id: gid, date: (rec.paid_date || due).slice(0, 10), due_date: due, amount: rec.value, method: rec.method, status: rec.status,
              period: due.slice(0, 7), reference: gid, recorded_by: "Asaas", origin: "asaas", invoice_url: rec.invoice_url,
              recorded_at: prev?.recorded_at || nowIso(), updated_at: nowIso() };
  c.payments = [p, ...(c.payments || []).filter(x => x.id !== gid)];
  const sub = c.subscription || (c.subscription = {});
  if (p.status === "pago") {
    sub.status = "ativa";
    const nxt = addMonth(p.due_date);
    if (!sub.next_due || nxt > sub.next_due || sub.next_due <= p.due_date) sub.next_due = nxt;
    if (!prev || prev.status !== "pago") c.timeline = [{ at: nowIso(), kind: "pagamento", text: `Pagamento confirmado no Asaas: R$ ${p.amount} via ${p.method}` }, ...(c.timeline || [])];
  } else if (p.status === "atrasado") {
    sub.status = "inadimplente";
  }
}
function meFromCustomer(c) {
  return { id: c.id, email: c.email, name: c.name, roles: ["titular"], plan: c.plan, phone: c.phone, profession: c.profession,
           profile: {}, theme: c.theme || "system", created_at: c.created_at, entitlements: FEATURES[c.plan] || FEATURES.free };
}
function ownerMe(env, theme = "system") {
  return { id: OWNER_ID, email: ownerEmail(env), name: env.OWNER_NAME || "Ramon Junio Araujo Pereira", roles: ["admin", "owner"], plan: "premium",
           phone: "", profession: "Proprietário da plataforma", profile: { cpf_masked: null, cpf_configured: false }, theme,
           created_at: "2026-09-28T00:00:00+00:00", entitlements: FEATURES.premium };
}
const ownerEmail = env => (env.OWNER_EMAIL || "ramonjunio07@gmail.com").trim().toLowerCase();

/* ------------------------------------------------------------------ Asaas */
function asaasBase(env) {
  const key = env.ASAAS_API_KEY || "";
  const envName = (env.ASAAS_ENV || "").toLowerCase() || (key.startsWith("$aact_hmlg_") ? "sandbox" : "production");
  const url = env.ASAAS_BASE_URL || (envName === "sandbox" ? "https://api-sandbox.asaas.com/v3" : "https://api.asaas.com/v3");  // ASAAS_BASE_URL só para testes locais
  return { key, envName, url };
}
async function asaas(env, method, path, body) {
  const { key, url } = asaasBase(env);
  if (!key) throw new Problem(503, "Gateway não configurado", "Pagamentos online indisponíveis: defina o secret ASAAS_API_KEY no Worker.", { code: "gateway_off" });
  let r;
  try {
    r = await fetch(url + path, { method, headers: { access_token: key, "User-Agent": "aurion-worker/1.0", "Content-Type": "application/json", Accept: "application/json" },
                                  body: body ? JSON.stringify(body) : undefined });
  } catch (e) { throw new Problem(502, "Erro no gateway de pagamento (Asaas)", "Sem comunicação com o Asaas.", { code: "asaas_unreachable" }); }
  if (r.status === 401) throw new Problem(502, "Erro no gateway de pagamento (Asaas)", "Chave de API do Asaas inválida, revogada ou de outro ambiente.", { code: "asaas_unauthorized" });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    const msg = (data.errors || []).map(e => `${e.code}: ${e.description}`).join("; ") || `HTTP ${r.status}`;
    throw new Problem(r.status >= 500 ? 502 : 422, "Erro no gateway de pagamento (Asaas)", msg, { code: "asaas_rejected" });
  }
  return data;
}
async function asaasList(env, path, params = {}) {
  const out = []; let offset = 0;
  for (;;) {
    const qs = new URLSearchParams({ ...params, offset: String(offset), limit: "100" });
    const page = await asaas(env, "GET", `${path}?${qs}`);
    const data = page.data || [];
    out.push(...data);
    if (!page.hasMore || !data.length || out.length >= 5000) return out;
    offset += data.length;
  }
}

async function customerForPayment(env, db, p) {
  const ref = p.externalReference || "";
  if (ref.startsWith("usr_") && ref !== OWNER_ID) { const c = await getCustomer(db, ref); if (c) return c; }
  const cust = p.customer;
  if (!cust) return null;
  const mapped = await kvGet(db, "asaas_customer:" + cust);
  if (mapped) return getCustomer(db, mapped);
  const info = await customerInfo(env, db, cust);
  let c = null;
  if ((info.externalReference || "").startsWith("usr_")) c = await getCustomer(db, info.externalReference);
  if (!c && info.email) c = await getCustomerByEmail(db, info.email.trim().toLowerCase());
  if (c) await kvSet(db, "asaas_customer:" + cust, c.id);
  return c;
}
async function customerInfo(env, db, cust) {
  let info = await kvGet(db, "asaas_cache:" + cust);
  if (info === null) {
    try { const c = await asaas(env, "GET", `/customers/${cust}`); info = { name: c.name, email: c.email, externalReference: c.externalReference }; }
    catch { info = {}; }
    await kvSet(db, "asaas_cache:" + cust, info);
  }
  return info;
}
function planForValue(v) { return +v >= +PRICE.premium - 0.01 ? "premium" : "pro"; }

async function ingest(env, db, p, deleted = false) {
  const c = await customerForPayment(env, db, p);
  const statusGw = deleted || p.deleted ? "DELETED" : (p.status || "PENDING");
  const status = statusGw === "DELETED" ? "cancelado" : (STATUS_MAP[statusGw] || "pendente");
  const due = p.dueDate || (p.dateCreated || "").slice(0, 10);
  const paidOn = p.clientPaymentDate || p.paymentDate || p.confirmedDate || null;
  const info = !c && p.customer ? await customerInfo(env, db, p.customer) : {};
  const rec = { id: p.id, user_id: c ? c.id : null, customer_id: p.customer || null, customer_name: c ? c.name : info.name || null,
                customer_email: c ? c.email : info.email || null, value: money(p.value), net_value: money(p.netValue ?? p.value),
                method: METHOD_MAP[p.billingType || "UNDEFINED"] || "a_definir", status, status_gateway: statusGw, due_date: due,
                paid_date: paidOn, invoice_url: p.invoiceUrl || null, description: p.description || "", subscription_id: p.subscription || null,
                created_at: p.dateCreated || null, updated_at: nowIso(), origin: "asaas" };
  await db.prepare("INSERT INTO gw_payments (id,data,updated_at) VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data, updated_at=excluded.updated_at")
    .bind(rec.id, JSON.stringify(rec), rec.updated_at).run();
  if (c) {
    if (c.plan === "free" && ["pago", "pendente", "atrasado"].includes(status)) setPlan(c, planForValue(rec.value), "aguardando_pagamento");
    if (status === "cancelado") c.payments = (c.payments || []).filter(x => x.id !== rec.id);
    else upsertGatewayPayment(c, rec.id, rec);
    await saveCustomer(db, c);
  }
  return rec;
}
const gwState = db => kvGet(db, "gateway_state", { last_sync_at: null, last_sync: null, last_webhook_at: null, webhooks: 0, last_error: null });
const saveGwState = async (db, patch) => kvSet(db, "gateway_state", { ...(await gwState(db)), ...patch });

async function sync(env, db) {
  const started = nowIso();
  try {
    const items = await asaasList(env, "/payments");
    let matched = 0;
    for (const p of items) if ((await ingest(env, db, p)).user_id) matched++;
    const summary = { ok: true, fetched: items.length, matched, unmatched: items.length - matched, started_at: started };
    await saveGwState(db, { last_sync_at: started, last_sync: summary, last_error: null });
    return summary;
  } catch (e) {
    await saveGwState(db, { last_sync_at: started, last_sync: { ok: false, error: e.detail || String(e) }, last_error: e.detail || String(e) });
    throw e;
  }
}

/* ------------------------------------------------------------------ autenticação */
async function authUser(req, env, db, { required = true } = {}) {
  const h = req.headers.get("Authorization") || "";
  const token = h.toLowerCase().startsWith("bearer ") ? h.slice(7).trim() : "";
  if (token) {
    const s = await db.prepare("SELECT user_id, expires_at FROM sessions WHERE token_hash=?").bind(await sha256(token)).first();
    if (s && s.expires_at > nowIso()) {
      if (s.user_id === OWNER_ID) return { owner: true, me: ownerMe(env, await kvGet(db, "owner_theme", "system")) };
      const c = await getCustomer(db, s.user_id);
      if (c) return { owner: false, c, me: meFromCustomer(c) };
    }
  }
  if (required) throw new Problem(401, "Não autenticado", "Sessão ausente ou expirada. Entre novamente.");
  return null;
}
async function requireOwner(req, env, db) {
  const u = await authUser(req, env, db);
  if (!u.owner) throw new Problem(403, "Acesso negado", "Área exclusiva do administrador.");
  return u;
}
async function newSession(db, userId) {
  const token = randomToken();
  const exp = new Date(Date.now() + SESSION_DAYS * 864e5).toISOString();
  await db.prepare("INSERT INTO sessions (token_hash,user_id,expires_at) VALUES (?,?,?)").bind(await sha256(token), userId, exp).run();
  return token;
}
async function throttle(db, email) {
  const r = await db.prepare("SELECT n, until FROM login_fails WHERE email=?").bind(email).first();
  if (r?.until && r.until > nowIso()) throw new Problem(429, "Muitas tentativas", "Muitas tentativas de login. Aguarde 15 minutos.");
}
async function loginFailed(db, email) {
  const r = await db.prepare("SELECT n FROM login_fails WHERE email=?").bind(email).first();
  const n = (r?.n || 0) + 1;
  const until = n >= 5 ? new Date(Date.now() + 15 * 60e3).toISOString() : null;
  await db.prepare("INSERT INTO login_fails (email,n,until) VALUES (?,?,?) ON CONFLICT(email) DO UPDATE SET n=excluded.n, until=excluded.until")
    .bind(email, until ? 0 : n, until).run();
}

/* ------------------------------------------------------------------ rotas */
async function route(req, env, db, url) {
  const m = req.method, p = url.pathname.replace(/\/$/, "") || "/";
  const body = ["POST", "PUT", "PATCH"].includes(m) ? await req.json().catch(() => ({})) : {};
  const q = Object.fromEntries(url.searchParams);

  if (p === "/health" || p === "/") return { status: "ok", service: "aurion-api", time: nowIso(), gateway: !!env.ASAAS_API_KEY };

  /* ---- autenticação */
  if (m === "POST" && p === "/v1/auth/register") {
    const errors = validateSignup(body);
    if (errors.length) throw new Problem(422, "Dados inválidos", "Cadastro inválido", { errors });
    const email = body.email.trim().toLowerCase();
    if (email === ownerEmail(env) || await getCustomerByEmail(db, email)) throw new Problem(409, "Conflito", "Já existe uma conta com este e-mail.");
    const c = localCustomer({ ...body, plan: ["pro", "premium"].includes(body.plan) ? body.plan : "free" });
    c.id = "usr_" + randomToken(12).replace(/[-_]/g, "").slice(0, 16).toLowerCase();
    c.origin = body.origin || "site"; c.tags = [];
    c.timeline = [{ at: c.created_at, kind: "cadastro", text: `Cadastro no plano ${c.plan_name} (origem: ${c.origin})` }];
    recompute(c);
    await db.prepare("INSERT INTO users (id,email,pw,data,created_at) VALUES (?,?,?,?,?)")
      .bind(c.id, c.email, await hashPassword(body.password), JSON.stringify(c), c.created_at).run();
    return new Resp(201, { token: await newSession(db, c.id), user: meFromCustomer(c) });
  }
  if (m === "POST" && p === "/v1/auth/login") {
    const email = String(body.email || "").trim().toLowerCase(), pw = String(body.password || "");
    await throttle(db, email);
    if (email === ownerEmail(env)) {
      const stored = await kvGet(db, "owner_pw");                       // senha definida pelo próprio Ramon no primeiro acesso
      if (!env.OWNER_PASSWORD && !stored)
        throw new Problem(409, "Primeiro acesso do administrador", "Defina sua senha com o código de ativação.", { code: "owner_setup_required" });
      const ok = stored ? await checkPassword(pw, stored) : safeEqual(pw, env.OWNER_PASSWORD);
      if (!ok) { await loginFailed(db, email); throw new Problem(401, "Não autenticado", "E-mail ou senha incorretos."); }
      await db.prepare("DELETE FROM login_fails WHERE email=?").bind(email).run();
      return { token: await newSession(db, OWNER_ID), user: ownerMe(env, await kvGet(db, "owner_theme", "system")) };
    }
    const row = await db.prepare("SELECT pw, data FROM users WHERE email=?").bind(email).first();
    if (!row || !(await checkPassword(pw, row.pw))) { await loginFailed(db, email); throw new Problem(401, "Não autenticado", "E-mail ou senha incorretos."); }
    await db.prepare("DELETE FROM login_fails WHERE email=?").bind(email).run();
    const c = JSON.parse(row.data); c.last_login_at = nowIso(); await saveCustomer(db, c);
    return { token: await newSession(db, c.id), user: meFromCustomer(c) };
  }
  /* primeiro acesso do dono: código de ativação de uso único (só o hash fica no código) → Ramon define a própria senha */
  if (m === "POST" && p === "/v1/auth/owner/setup") {
    const email = String(body.email || "").trim().toLowerCase(), pw = String(body.password || ""), code = String(body.code || "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
    await throttle(db, "setup:" + email);
    if (email !== ownerEmail(env)) throw new Problem(403, "Acesso negado", "Este primeiro acesso é exclusivo do administrador.");
    if (await kvGet(db, "owner_pw") || env.OWNER_PASSWORD) throw new Problem(409, "Já ativado", "O acesso do administrador já foi ativado. Entre com sua senha.");
    if (!env.OWNER_SETUP_HASH || !safeEqual(await sha256(code), env.OWNER_SETUP_HASH)) { await loginFailed(db, "setup:" + email); throw new Problem(401, "Código inválido", "Código de ativação incorreto."); }
    if (pw.length < 10 || !/\d/.test(pw) || !/[a-z]/i.test(pw)) throw new Problem(422, "Senha fraca", "Use 10+ caracteres, com letras e números.");
    await kvSet(db, "owner_pw", await hashPassword(pw));
    return new Resp(201, { token: await newSession(db, OWNER_ID), user: ownerMe(env, await kvGet(db, "owner_theme", "system")) });
  }
  if (m === "POST" && p === "/v1/auth/logout") {
    const h = req.headers.get("Authorization") || "";
    if (h.toLowerCase().startsWith("bearer ")) await db.prepare("DELETE FROM sessions WHERE token_hash=?").bind(await sha256(h.slice(7).trim())).run();
    return new Resp(204);
  }
  if (m === "GET" && p === "/v1/me") return (await authUser(req, env, db)).me;
  if (p === "/v1/theme-preference") {
    const u = await authUser(req, env, db);
    if (m === "GET") return { theme: u.me.theme };
    const theme = ["light", "dark", "system"].includes(body.theme) ? body.theme : "system";
    if (u.owner) await kvSet(db, "owner_theme", theme); else { u.c.theme = theme; await saveCustomer(db, u.c); }
    return { theme };
  }


  /* ---- dados financeiros reais do cliente (importação de arquivos; futuramente Open Finance) */
  if (p.startsWith("/v1/imports") || ["/v1/finance/summary", "/v1/finance/transactions", "/v1/portfolio/consolidated", "/v1/dashboard"].includes(p)) {
    const u = await authUser(req, env, db);
    return finRoute(m, p, body, q, u, db);
  }

  /* ---- assinatura do cliente */
  if (m === "POST" && p === "/v1/billing/checkout") {
    const u = await authUser(req, env, db);
    if (u.owner) throw new Problem(422, "Dados inválidos", "O administrador não assina planos.");
    const plan = body.plan;
    if (!["pro", "premium"].includes(plan)) throw new Problem(422, "Dados inválidos", "Escolha um plano pago (Pro ou Premium).");
    const doc = String(body.cpf_cnpj || "").replace(/\D/g, "");
    if (!docValid(doc)) throw new Problem(422, "Dados inválidos", "CPF ou CNPJ inválido.", { errors: [{ field: "cpf_cnpj", msg: "Informe um CPF ou CNPJ válido" }] });
    const c = u.c, link = c.billing || {};
    if (link.subscription_id && link.plan === plan && link.status === "ativa") {
      const pend = (await asaasList(env, `/subscriptions/${link.subscription_id}/payments`)).filter(x => ["PENDING", "OVERDUE"].includes(x.status));
      if (pend.length) { await ingest(env, db, pend[0]); return { invoice_url: pend[0].invoiceUrl, subscription_id: link.subscription_id, reused: true }; }
    }
    let custId = link.customer_id;
    if (!custId) {
      const found = (await asaas(env, "GET", `/customers?externalReference=${encodeURIComponent(c.id)}&limit=1`)).data?.[0]
                 || (await asaas(env, "GET", `/customers?cpfCnpj=${doc}&limit=1`)).data?.[0];
      custId = found ? found.id : (await asaas(env, "POST", "/customers", { name: c.name, cpfCnpj: doc, email: c.email,
        mobilePhone: (c.phone || "").replace(/^\+55/, ""), externalReference: c.id, notificationDisabled: false })).id;
    }
    if (link.subscription_id && link.status === "ativa") { try { await asaas(env, "DELETE", `/subscriptions/${link.subscription_id}`); } catch {} }
    const sub = await asaas(env, "POST", "/subscriptions", { customer: custId, billingType: "UNDEFINED", value: +PRICE[plan], nextDueDate: today(),
      cycle: "MONTHLY", description: `Aurion · Plano ${PLAN_NAME[plan]} (mensal)`, externalReference: c.id });
    c.billing = { customer_id: custId, subscription_id: sub.id, plan, status: "ativa", doc_masked: doc.length === 11 ? `***.${doc.slice(3, 6)}.${doc.slice(6, 9)}-**` : `**.${doc.slice(2, 5)}.***/****-${doc.slice(12)}`, created_at: nowIso() };
    await kvSet(db, "asaas_customer:" + custId, c.id);
    setPlan(c, plan, "aguardando_pagamento");
    c.subscription.next_due = today(); c.subscription.gateway = "asaas";
    c.timeline = [{ at: nowIso(), kind: "assinatura", text: `Iniciou assinatura ${PLAN_NAME[plan]} no Asaas` }, ...(c.timeline || [])];
    await saveCustomer(db, c);
    const pays = await asaasList(env, `/subscriptions/${sub.id}/payments`);
    for (const x of pays) await ingest(env, db, x);
    const first = pays.find(x => x.invoiceUrl);
    return { invoice_url: first ? first.invoiceUrl : null, subscription_id: sub.id, reused: false };
  }
  if (m === "GET" && p === "/v1/billing/subscription") {
    const u = await authUser(req, env, db);
    if (u.owner) return { plan: "premium", status: "dono" };
    return { ...u.c.subscription, plan: u.c.plan, payer_doc: u.c.billing?.doc_masked || null, payments: u.c.payments || [] };
  }

  /* ---- webhook do Asaas (tempo real) */
  if (m === "POST" && p === "/v1/webhooks/asaas") {
    if (!env.ASAAS_WEBHOOK_TOKEN) throw new Problem(503, "Webhook não configurado", "Defina o secret ASAAS_WEBHOOK_TOKEN no Worker.");
    if (!safeEqual(req.headers.get("asaas-access-token"), env.ASAAS_WEBHOOK_TOKEN)) throw new Problem(401, "Não autorizado", "Token do webhook inválido.");
    const evtId = body.id || "", event = body.event || "";
    if (evtId && await kvGet(db, "evt:" + evtId)) return { received: true, duplicate: true };
    const result = { received: true, event };
    if (body.payment) {
      const rec = await ingest(env, db, body.payment, event === "PAYMENT_DELETED");
      Object.assign(result, { payment_id: rec.id, status: rec.status, matched: !!rec.user_id });
    } else if (body.subscription && ["SUBSCRIPTION_DELETED", "SUBSCRIPTION_INACTIVATED"].includes(event)) {
      const c = await customerForPayment(env, db, { externalReference: body.subscription.externalReference, customer: body.subscription.customer });
      if (c && c.billing?.subscription_id === body.subscription.id) {
        c.billing.status = "cancelada"; c.subscription.status = "cancelada";
        await saveCustomer(db, c); result.cancelled_user = c.id;
      }
    }
    if (evtId) await kvSet(db, "evt:" + evtId, nowIso());
    const st = await gwState(db);
    await saveGwState(db, { last_webhook_at: nowIso(), webhooks: (st.webhooks || 0) + 1 });
    return result;
  }

  /* ---- área do administrador */
  if (p.startsWith("/v1/admin/")) {
    await requireOwner(req, env, db);
    const items = await allCustomers(db);
    if (m === "GET" && p === "/v1/admin/team") return { items: [{ id: OWNER_ID, name: env.OWNER_NAME || "Ramon Junio Araujo Pereira", email: ownerEmail(env), roles: ["admin", "owner"] }] };
    if (m === "GET" && p === "/v1/admin/crm/metrics") return metricsFrom(items, new Date(), "Dados reais do banco; pagamentos do Asaas entram em tempo real pelo webhook.");
    if (m === "GET" && p === "/v1/admin/crm/customers") {
      const term = (q.q || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
      const dg = term.includes("@") ? "" : term.replace(/\D/g, ""), digits = dg.length >= 4 ? dg : "";
      const norm = s => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
      let rows = items.map(({ payments, notes, timeline, billing, ...rest }) => rest);
      if (term) rows = rows.filter(i => norm(i.name).includes(term) || i.email.includes(term) || norm(i.profession).includes(term) || (digits && (i.phone || "").includes(digits)));
      if (q.stage) rows = rows.filter(i => i.stage === q.stage);
      if (q.plan) rows = rows.filter(i => i.plan === q.plan);
      rows.sort((a, b) => b.created_at.localeCompare(a.created_at));
      return { total: rows.length, items: rows };
    }
    const cm = p.match(/^\/v1\/admin\/crm\/customers\/([^/]+)(?:\/(notes|payments))?$/);
    if (cm) {
      const c = await getCustomer(db, cm[1]);
      if (!c) throw new Problem(404, "Recurso não encontrado", "Cliente");
      if (!cm[2] && m === "GET") { const { billing, ...rest } = c; return rest; }
      if (!cm[2] && m === "PATCH") {
        if (body.plan && body.plan !== c.plan && PRICE[body.plan]) setPlan(c, body.plan);
        if (body.stage) { c.stage = body.stage; c.stage_overridden = true; }
        if (body.clear_override) c.stage_overridden = false;
        if (Array.isArray(body.tags)) c.tags = body.tags.slice(0, 20).map(t => String(t).slice(0, 30));
        if (body.next_action !== undefined) c.next_action = String(body.next_action || "").slice(0, 200);
        if (body.next_action_date !== undefined) c.next_action_date = body.next_action_date || null;
        await saveCustomer(db, c); const { billing, ...rest } = c; return rest;
      }
      if (cm[2] === "notes" && m === "POST") {
        const text = String(body.text || "").trim();
        if (!text) throw new Problem(422, "Dados inválidos", "Escreva a anotação.");
        const n = { id: "nte_" + randomToken(6), at: nowIso(), kind: body.kind || "nota", text: text.slice(0, 2000), author: env.OWNER_NAME || "Administrador" };
        c.notes = [n, ...(c.notes || [])];
        c.timeline = [{ at: n.at, kind: n.kind, text: n.text, author: n.author }, ...(c.timeline || [])];
        await saveCustomer(db, c); return n;
      }
      if (cm[2] === "payments" && m === "POST") {
        const amt = +String(body.amount).replace(",", ".");
        if (!(amt > 0)) throw new Problem(422, "Dados inválidos", "Valor deve ser positivo.");
        const pay = { id: "pay_" + randomToken(6), date: body.date || today(), amount: money(amt), method: body.method, status: body.status, period: body.period,
                      reference: body.reference || "", recorded_by: env.OWNER_NAME || "Administrador", origin: "manual", recorded_at: nowIso() };
        c.payments = [pay, ...(c.payments || [])];
        c.timeline = [{ at: pay.date, kind: "pagamento", text: `Pagamento ${pay.status}: R$ ${pay.amount} via ${pay.method} (${pay.period})` }, ...(c.timeline || [])];
        if (pay.status === "pago") { c.subscription.status = "ativa"; c.subscription.next_due = addMonth(c.subscription.next_due || pay.date); }
        else if (pay.status === "atrasado") c.subscription.status = "inadimplente";
        await saveCustomer(db, c); return pay;
      }
    }
    if (m === "GET" && p === "/v1/admin/payments") {
      const { results } = await db.prepare("SELECT data FROM gw_payments").all();
      return paymentsFrom(items, results.map(r => JSON.parse(r.data)), q);
    }
    if (m === "GET" && p === "/v1/admin/payments/gateway") {
      const { key, envName } = asaasBase(env);
      const out = { provider: "Asaas", demo: false, configured: !!key, env: key ? envName : null,
                    key_fingerprint: key ? key.slice(0, 10) + "…" + (await sha256(key)).slice(0, 8) : null,
                    webhook_token_configured: !!env.ASAAS_WEBHOOK_TOKEN,
                    webhook_url: `${url.origin}/v1/webhooks/asaas`, ...(await gwState(db)) };
      if (q.live === "true" && key) {
        try {
          out.balance = money((await asaas(env, "GET", "/finance/balance")).balance); out.connection = "ok";
          try { const i = await asaas(env, "GET", "/myAccount/commercialInfo/"); out.account_name = i.companyName || i.name; } catch { out.account_name = null; }
        } catch (e) { out.connection = "erro"; out.connection_error = e.detail; await saveGwState(db, { last_error: e.detail }); }
      }
      return out;
    }
    if (m === "POST" && p === "/v1/admin/payments/sync") return sync(env, db);
  }
  throw new Problem(404, "Não encontrado", `${m} ${p}`);
}

/* ------------------------------------------------------------------ entrada HTTP + CORS + cron */
function corsHeaders(req, env) {
  const origin = req.headers.get("Origin") || "";
  const allowed = (env.ALLOWED_ORIGINS || "").split(",").map(s => s.trim()).filter(Boolean);
  const ok = allowed.includes(origin);
  return { "Access-Control-Allow-Origin": ok ? origin : allowed[0] || "*", Vary: "Origin",
           "Access-Control-Allow-Methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS",
           "Access-Control-Allow-Headers": "Content-Type,Authorization,X-Correlation-ID,Idempotency-Key",
           "Access-Control-Expose-Headers": "X-Correlation-ID", "Access-Control-Max-Age": "86400" };
}
function json(data, status, extra) {
  return new Response(status === 204 ? null : JSON.stringify(data),
    { status, headers: { "Content-Type": status >= 400 ? "application/problem+json" : "application/json; charset=utf-8",
                         "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", ...extra } });
}

export default {
  async fetch(req, env) {
    const cors = corsHeaders(req, env);
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    const url = new URL(req.url);
    const cid = req.headers.get("X-Correlation-ID") || randomToken(8);
    try {
      await ensureSchema(env.DB);
      const out = await route(req, env, env.DB, url);
      if (out instanceof Resp) return json(out.body, out.status, { ...cors, "X-Correlation-ID": cid });
      return json(out, 200, { ...cors, "X-Correlation-ID": cid });
    } catch (e) {
      if (!(e instanceof Problem)) { console.error("erro interno", cid, e && e.stack || e); e = new Problem(500, "Erro interno", "Falha inesperada. Tente novamente."); }
      return json({ type: "about:blank", title: e.title, status: e.status, detail: e.detail, instance: url.pathname, correlation_id: cid, ...e.extra },
                  e.status, { ...cors, "X-Correlation-ID": cid });
    }
  },
  // rede de segurança: sincroniza todas as cobranças do Asaas a cada 15 min (caso algum webhook se perca)
  async scheduled(_evt, env, ctx) {
    if (!env.ASAAS_API_KEY) return;
    ctx.waitUntil((async () => { await ensureSchema(env.DB); try { await sync(env, env.DB); } catch (e) { console.error("sync falhou", e.detail || e); } })());
  },
};

export const _internals = { recompute, hashPassword, checkPassword, STATUS_MAP, normalizePhone };

/* ------------------------------------------------------------------ dados financeiros (importação) */
const FIN_KINDS = ["transaction", "account", "holding", "trade"];
const LIMITS = { transaction: 20000, account: 50, holding: 500, trade: 10000 };
const str = (v, n = 200) => String(v ?? "").slice(0, n);
const numOrNull = v => (v === null || v === undefined || v === "" || !isFinite(+v)) ? null : Math.round(+v * 1e6) / 1e6;
const isoDate = v => /^\d{4}-\d{2}-\d{2}$/.test(String(v || "")) ? String(v) : null;
const ASSET_CLASSES = ["acao", "fii", "etf", "bdr", "tesouro", "renda_fixa", "fundo", "previdencia", "cripto", "outro"];

function cleanItem(kind, x, src) {
  if (!x || typeof x !== "object") return null;
  if (kind === "transaction") {
    const date = isoDate(x.date), amount = numOrNull(x.amount);
    if (!date || amount === null || !str(x.description).trim()) return null;
    return { date, description: str(x.description).trim(), amount, category: str(x.category, 40) || categorize(x.description, amount),
             account_id: str(x.account_id, 80), fitid: str(x.fitid, 80), source: src };
  }
  if (kind === "account") {
    return { name: str(x.name, 80) || "Conta", institution: str(x.institution, 80), type: x.type === "cartao" ? "cartao" : "conta",
             balance: numOrNull(x.balance) ?? 0, balance_date: isoDate(x.balance_date), external_id: str(x.external_id, 80), source: src };
  }
  if (kind === "holding") {
    const value = numOrNull(x.value);
    if (value === null || value <= 0 || !str(x.name || x.ticker).trim()) return null;
    return { name: str(x.name || x.ticker, 120).trim(), ticker: str(x.ticker, 20).toUpperCase(), asset_class: ASSET_CLASSES.includes(x.asset_class) ? x.asset_class : "outro",
             custodian: str(x.custodian, 80), quantity: numOrNull(x.quantity) ?? 1, value, invested: numOrNull(x.invested), price: numOrNull(x.price),
             as_of: isoDate(x.as_of), maturity: isoDate(x.maturity), indexer: str(x.indexer, 40), source: src };
  }
  if (kind === "trade") {
    const date = isoDate(x.date), q = numOrNull(x.quantity), price = numOrNull(x.price);
    if (!date || !q || !["C", "V"].includes(x.side) || !str(x.ticker).trim()) return null;
    return { date, ticker: str(x.ticker, 20).toUpperCase().trim(), side: x.side, quantity: q, price: price ?? 0,
             value: numOrNull(x.value) ?? q * (price ?? 0), fees: numOrNull(x.fees) ?? 0, market: str(x.market, 40), custodian: str(x.custodian, 80), source: src };
  }
  return null;
}
async function itemId(kind, it) {
  const key = kind === "transaction" ? [it.account_id, it.date, it.amount, it.description, it.fitid].join("|")
    : kind === "account" ? [it.institution, it.name, it.external_id].join("|")
    : kind === "holding" ? [it.source, it.custodian, it.ticker || it.name, it.maturity, it.indexer].join("|")
    : [it.date, it.ticker, it.side, it.quantity, it.price, it.custodian].join("|");
  return kind.slice(0, 3) + "_" + (await sha256(key)).slice(0, 22);
}
async function finLoad(db, uid, kind) {
  const { results } = await db.prepare("SELECT id, data FROM fin_items WHERE user_id=? AND kind=?").bind(uid, kind).all();
  return results.map(r => ({ id: r.id, ...JSON.parse(r.data) }));
}

async function finRoute(m, p, body, q, u, db) {
  const uid = u.me.id;
  if (m === "POST" && p === "/v1/imports") {
    const src = str(body.source, 60) || "arquivo";
    const filename = str(body.filename, 160) || "arquivo";
    const importId = "imp_" + randomToken(9).replace(/[-_]/g, "");
    const counts = {}, stmts = [];
    let total = 0;
    for (const kind of FIN_KINDS) {
      const raw = Array.isArray(body[kind + "s"]) ? body[kind + "s"] : [];
      if (raw.length > LIMITS[kind]) throw new Problem(422, "Arquivo grande demais", `Máximo de ${LIMITS[kind]} registros do tipo ${kind} por importação.`);
      counts[kind + "s"] = 0;
      for (const x of raw) {
        const it = cleanItem(kind, x, src);
        if (!it) continue;
        const id = await itemId(kind, it);
        stmts.push(db.prepare("INSERT INTO fin_items (user_id,kind,id,import_id,data) VALUES (?,?,?,?,?) ON CONFLICT(user_id,kind,id) DO UPDATE SET data=excluded.data, import_id=excluded.import_id")
          .bind(uid, kind, id, importId, JSON.stringify(it)));
        counts[kind + "s"]++; total++;
      }
    }
    if (!total) throw new Problem(422, "Nada para importar", "Não encontramos registros válidos neste arquivo.");
    // posição é uma foto: uma nova posição da mesma origem substitui a anterior
    if (body.replace_holdings && counts.holdings)
      stmts.unshift(db.prepare("DELETE FROM fin_items WHERE user_id=? AND kind='holding' AND json_extract(data,'$.source')=?").bind(uid, src));
    const rec = { id: importId, filename, source: src, kind: str(body.kind, 40), counts, created_at: nowIso() };
    stmts.push(db.prepare("INSERT INTO fin_items (user_id,kind,id,import_id,data) VALUES (?,?,?,?,?)").bind(uid, "import", importId, importId, JSON.stringify(rec)));
    for (let i = 0; i < stmts.length; i += 90) await db.batch(stmts.slice(i, i + 90));
    return new Resp(201, rec);
  }
  if (m === "GET" && p === "/v1/imports") {
    const items = (await finLoad(db, uid, "import")).sort((a, b) => b.created_at.localeCompare(a.created_at));
    return { items };
  }
  const del = p.match(/^\/v1\/imports\/(imp_[A-Za-z0-9]+)$/);
  if (m === "DELETE" && del) {
    await db.prepare("DELETE FROM fin_items WHERE user_id=? AND import_id=?").bind(uid, del[1]).run();
    return new Resp(204);
  }
  if (m === "DELETE" && p === "/v1/imports") {
    await db.prepare("DELETE FROM fin_items WHERE user_id=?").bind(uid).run();
    return new Resp(204);
  }
  if (m !== "GET") throw new Problem(405, "Método não permitido", `${m} ${p}`);
  const [txs, accounts, holdings, trades] = await Promise.all(FIN_KINDS.map(k => finLoad(db, uid, k)));
  const fin = financeSummary(txs, accounts);
  if (p === "/v1/finance/summary") return fin;
  if (p === "/v1/finance/transactions") return { has_data: txs.length > 0, ...transactionsList(txs, Math.min(+q.limit || 60, 500)) };
  const port = portfolioSummary(holdings, trades);
  if (p === "/v1/portfolio/consolidated") return port;
  if (p === "/v1/dashboard") return dashboardSummary({ name: u.me.name, fin, port });
  throw new Problem(404, "Não encontrado", p);
}
