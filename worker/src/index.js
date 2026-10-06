/* Aurion API (Cloudflare Workers + D1) — contas, CRM e pagamentos Asaas em tempo real.
 *
 * Rotas reais: autenticação, perfil, CRM do dono, pagamentos (Asaas: checkout, webhook, sincronização).
 * Os módulos de análise do app (finanças, impostos, simulações…) continuam rodando no navegador.
 *
 * Secrets (Cloudflare → Worker → Settings → Variables and Secrets, tipo "Secret"):
 *   OWNER_PASSWORD         senha do Ramon (10+ caracteres, letras e números)
 *   ASAAS_API_KEY          chave da API do Asaas ($aact_prod_… ou $aact_hmlg_…)
 *   ASAAS_WEBHOOK_TOKEN    token escolhido no cadastro do webhook no Asaas
 *   PLUGGY_CLIENT_ID / PLUGGY_CLIENT_SECRET   credenciais do agregador Open Finance (Pluggy) — liga as conexões automáticas
 *   PLUGGY_WEBHOOK_TOKEN   (opcional) token secreto na URL do webhook da Pluggy
 *   BRAPI_TOKEN            (opcional) token gratuito da brapi.dev — reserva para as cotações se o Yahoo falhar
 * Variáveis (wrangler.toml): OWNER_EMAIL, OWNER_NAME, ALLOWED_ORIGINS
 */
import { IDENTITY_SCHEMA, REQ, audit, identityRoute, newSession as idNewSession, touchSession, privacyExport, privacyDelete } from "./identity.js";
import { Resp, Problem, nowIso, today, money, enc, b64u, randomToken, sha256, safeEqual, hashPassword, checkPassword, kvGet, kvSet, str, numOrNull, isoDate, ageH } from "./shared.js";
import { financeSummary, transactionsList, portfolioSummary, dashboardSummary, categorize } from "../../apps/web/app/js/fin_engine.js";
import { computeTax, taxDashboard } from "../../apps/web/app/js/tax_engine.js";
import { buildAlerts } from "../../apps/web/app/js/alert_engine.js";
import { simulateSale, simulatePgbl } from "../../apps/web/app/js/sim_engine.js";
import { normalizeItem, itemView, PLUGGY_WIDGET } from "../../apps/web/app/js/openfinance.js";
import { answer as assistantAnswer, DISCLAIMER as ASSIST_DISCLAIMER } from "../../apps/web/app/js/assistant_engine.js";
import { classifyDoc, guessYear, irpfChecklist, sniff, ALLOWED, DOC_KINDS } from "../../apps/web/app/js/doc_engine.js";
import { SGS, sgsLastUrl, parseSgs, indicesSnapshot, yahooUrl, brapiUrl, parseYahooChart, parseBrapi, applyQuotes, tickersFrom } from "../../apps/web/app/js/market.js";
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

/* ------------------------------------------------------------------ banco (D1) */
const SCHEMA = [
  "CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL, pw TEXT NOT NULL, data TEXT NOT NULL, created_at TEXT NOT NULL)",
  "CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL, expires_at TEXT NOT NULL)",
  "CREATE TABLE IF NOT EXISTS gw_payments (id TEXT PRIMARY KEY, data TEXT NOT NULL, updated_at TEXT NOT NULL)",
  "CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT NOT NULL)",
  "CREATE TABLE IF NOT EXISTS login_fails (email TEXT PRIMARY KEY, n INTEGER NOT NULL, until TEXT)",
  "CREATE TABLE IF NOT EXISTS fin_items (user_id TEXT NOT NULL, kind TEXT NOT NULL, id TEXT NOT NULL, import_id TEXT NOT NULL, data TEXT NOT NULL, PRIMARY KEY (user_id, kind, id))",
  "CREATE TABLE IF NOT EXISTS docs (user_id TEXT NOT NULL, id TEXT NOT NULL, data TEXT NOT NULL, size INTEGER NOT NULL, PRIMARY KEY (user_id, id))",
  "CREATE TABLE IF NOT EXISTS doc_chunks (doc_id TEXT NOT NULL, n INTEGER NOT NULL, bytes BLOB NOT NULL, PRIMARY KEY (doc_id, n))",
  "CREATE TABLE IF NOT EXISTS quotes (ticker TEXT PRIMARY KEY, data TEXT NOT NULL, fetched_at TEXT NOT NULL)",
  "CREATE INDEX IF NOT EXISTS fin_items_import ON fin_items (user_id, import_id)",
  ...IDENTITY_SCHEMA,
];
let schemaReady = false;
async function ensureSchema(db) {
  if (schemaReady) return;
  await db.batch(SCHEMA.map(s => db.prepare(s)));
  schemaReady = true;
}
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
      const sid = await sha256(token);
      await touchSession(db, sid);
      if (s.user_id === OWNER_ID) return { owner: true, sid, me: ownerMe(env, await kvGet(db, "owner_theme", "system")) };
      const c = await getCustomer(db, s.user_id);
      if (c) return { owner: false, sid, c, me: meFromCustomer(c) };
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
const newSession = (db, userId, req) => idNewSession(db, userId, req);
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
async function route(req, env, db, url, ctx) {
  const m = req.method, p = url.pathname.replace(/\/$/, "") || "/";
  const rawUpload = m === "POST" && p === "/v1/documents" && !/json/.test(req.headers.get("Content-Type") || "");
  const body = ["POST", "PUT", "PATCH"].includes(m) && !rawUpload ? await req.json().catch(() => ({})) : {};
  const q = Object.fromEntries(url.searchParams);

  if (p === "/health" || p === "/") return { status: "ok", service: "aurion-api", time: nowIso(), gateway: !!env.ASAAS_API_KEY };

  /* ---- identidade: login por e-mail/CPF, MFA, recuperação, sessões, auditoria (identity.js) */
  const D = { OWNER_ID, ownerEmail, ownerMe, getCustomer, getCustomerByEmail, saveCustomer, meFromCustomer, validateSignup, localCustomer, recompute, docValid, throttle, loginFailed, authUser };
  if (/^\/v1\/(auth\/(register|login|mfa\/verify|recover|reset|logout|password)|security|sessions|audit$|admin\/users\/[^/]+\/reset-link$|admin\/audit$)/.test(p)) {
    const out = await identityRoute(m, p, body, q, req, env, db, D);
    if (out !== null) return out;
  }
  if (m === "GET" && p === "/v1/privacy/export") { const u = await authUser(req, env, db); await audit(db, req, { user_id: u.me.id, actor: u.me.id, action: "dados.exportados", resource: "user" }); return privacyExport(db, u.me.id, D); }
  if (m === "POST" && p === "/v1/privacy/delete-account") {
    const u = await authUser(req, env, db);
    if (u.owner) throw new Problem(409, "Não permitido", "A conta do administrador não pode ser eliminada por aqui.");
    const row = await db.prepare("SELECT pw FROM users WHERE id=?").bind(u.me.id).first();
    if (!(await checkPassword(String(body.password || ""), row?.pw))) throw new Problem(401, "Senha incorreta", "Confirme com a sua senha para eliminar a conta.");
    await privacyDelete(db, req, u.me.id, D);
    return new Resp(204);
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
    await audit(db, req, { user_id: OWNER_ID, actor: OWNER_ID, action: "admin.primeiro_acesso", resource: "user" });
    return new Resp(201, { token: await newSession(db, OWNER_ID, req), user: ownerMe(env, await kvGet(db, "owner_theme", "system")) });
  }
  if (m === "GET" && p === "/v1/me") return (await authUser(req, env, db)).me;
  if (p === "/v1/theme-preference") {
    const u = await authUser(req, env, db);
    if (m === "GET") return { theme: u.me.theme };
    const theme = ["light", "dark", "system"].includes(body.theme) ? body.theme : "system";
    if (u.owner) await kvSet(db, "owner_theme", theme); else { u.c.theme = theme; await saveCustomer(db, u.c); }
    return { theme };
  }


  /* ---- Open Finance (Pluggy) */
  if (m === "POST" && p === "/v1/webhooks/pluggy") return pluggyWebhook(env, db, body, q, ctx);
  if (p === "/v1/openfinance" || p.startsWith("/v1/openfinance/")) {
    const u = await authUser(req, env, db);
    return ofRoute(m, p, body, u, env, db, url, req);
  }

  /* ---- mercado (público): índices do Banco Central e situação das cotações */
  if (m === "GET" && p === "/v1/market/indices") return marketPublic(env, db);
  if (m === "POST" && p === "/v1/market/refresh") {
    const u = await authUser(req, env, db);
    if (!u.owner) throw new Problem(403, "Acesso negado", "Apenas o administrador.");
    return { refreshed: await refreshMarket(env, db, { force: true }) };
  }

  /* ---- dados financeiros reais do cliente (importação de arquivos; futuramente Open Finance) */
  if (p.startsWith("/v1/documents")) { const u = await authUser(req, env, db); return docRoute(m, p, body, q, u, db, req); }
  if (p.startsWith("/v1/imports") || p.startsWith("/v1/tax/") || p.startsWith("/v1/alerts") || p === "/v1/simulations" || p === "/v1/assistant/query" || ["/v1/finance/summary", "/v1/finance/transactions", "/v1/portfolio/consolidated", "/v1/dashboard"].includes(p)) {
    const u = await authUser(req, env, db);
    return finRoute(m, p, body, q, u, db, req);
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
        await saveCustomer(db, c);
        await audit(db, req, { user_id: c.id, actor: OWNER_ID, action: "admin.cliente_alterado", resource: "crm", entity_id: c.id, meta: body });
        const { billing, ...rest } = c; return rest;
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
        await saveCustomer(db, c);
        await audit(db, req, { user_id: c.id, actor: OWNER_ID, action: "admin.pagamento_registrado", resource: "payment", entity_id: pay.id, meta: { valor: pay.amount, status: pay.status } });
        return pay;
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
           "Access-Control-Allow-Headers": "Content-Type,Authorization,X-Correlation-ID,Idempotency-Key,X-Filename,X-Doc-Kind,X-Doc-Year",
           "Access-Control-Expose-Headers": "X-Correlation-ID,Content-Disposition", "Access-Control-Max-Age": "86400" };
}
function json(data, status, extra) {
  return new Response(status === 204 ? null : JSON.stringify(data),
    { status, headers: { "Content-Type": status >= 400 ? "application/problem+json" : "application/json; charset=utf-8",
                         "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", ...extra } });
}

export default {
  async fetch(req, env, ctx) {
    const cors = corsHeaders(req, env);
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    const url = new URL(req.url);
    const cid = req.headers.get("X-Correlation-ID") || randomToken(8);
    REQ.set(req, { cid });
    try {
      await ensureSchema(env.DB);
      const out = await route(req, env, env.DB, url, ctx);
      if (out instanceof Response) { const h = new Headers(out.headers); Object.entries(cors).forEach(([k, v]) => h.set(k, v)); return new Response(out.body, { status: out.status, headers: h }); }
      if (out instanceof Resp) return json(out.body, out.status, { ...cors, "X-Correlation-ID": cid });
      return json(out, 200, { ...cors, "X-Correlation-ID": cid });
    } catch (e) {
      if (!(e instanceof Problem)) { console.error("erro interno", cid, e && e.stack || e); e = new Problem(500, "Erro interno", "Falha inesperada. Tente novamente."); }
      return json({ type: "about:blank", title: e.title, status: e.status, detail: e.detail, instance: url.pathname, correlation_id: cid, ...e.extra },
                  e.status, { ...cors, "X-Correlation-ID": cid });
    }
  },
  // rede de segurança: sincroniza todas as cobranças do Asaas a cada 15 min (caso algum webhook se perca)
  // e mantém cotações (a cada 4 h) e índices do Banco Central (a cada 6 h) atualizados
  async scheduled(_evt, env, ctx) {
    ctx.waitUntil((async () => {
      await ensureSchema(env.DB);
      if (env.ASAAS_API_KEY) { try { await sync(env, env.DB); } catch (e) { console.error("sync falhou", e.detail || e); } }
      try { await refreshMarket(env, env.DB); } catch (e) { console.error("mercado falhou", e.message || e); }
      if (ofConfigured(env)) { try { await ofCron(env, env.DB); } catch (e) { console.error("open finance falhou", e.message || e); } }
    })());
  },
};

export const _internals = { recompute, hashPassword, checkPassword, STATUS_MAP, normalizePhone };

/* ------------------------------------------------------------------ dados financeiros (importação) */
const FIN_KINDS = ["transaction", "account", "holding", "trade"];
const LIMITS = { transaction: 20000, account: 50, holding: 500, trade: 10000 };
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
             as_of: isoDate(x.as_of) || today(), maturity: isoDate(x.maturity), indexer: str(x.indexer, 40), source: src };
  }
  if (kind === "trade") {
    const date = isoDate(x.date), q = numOrNull(x.quantity), price = numOrNull(x.price);
    if (!date || !q || !["C", "V"].includes(x.side) || !str(x.ticker).trim()) return null;
    return { date, ticker: str(x.ticker, 20).toUpperCase().trim(), side: x.side, quantity: q, price: price ?? 0,
             value: numOrNull(x.value) ?? q * (price ?? 0), fees: numOrNull(x.fees) ?? 0, market: str(x.market, 40), custodian: str(x.custodian, 80),
             ...(x.daytrade === true ? { daytrade: true } : {}), ...(["acao", "fii", "etf", "bdr"].includes(x.asset_class) ? { asset_class: x.asset_class } : {}), source: src };
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
async function finStmts(db, uid, importId, src, body) {
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
  return { stmts, counts, total };
}
async function finLoad(db, uid, kind) {
  const { results } = await db.prepare("SELECT id, data FROM fin_items WHERE user_id=? AND kind=?").bind(uid, kind).all();
  return results.map(r => ({ id: r.id, ...JSON.parse(r.data) }));
}

async function finRoute(m, p, body, q, u, db, req) {
  const A = (action, o = {}) => audit(db, req, { user_id: u.me.id, actor: u.me.id, action, ...o });
  const uid = u.me.id;
  if (m === "POST" && p === "/v1/imports") {
    const src = str(body.source, 60) || "arquivo";
    const filename = str(body.filename, 160) || "arquivo";
    const importId = "imp_" + randomToken(9).replace(/[-_]/g, "");
    const { stmts, counts, total } = await finStmts(db, uid, importId, src, body);
    if (!total) throw new Problem(422, "Nada para importar", "Não encontramos registros válidos neste arquivo.");
    // posição é uma foto: uma nova posição da mesma origem substitui a anterior
    if (body.replace_holdings && counts.holdings)
      stmts.unshift(db.prepare("DELETE FROM fin_items WHERE user_id=? AND kind='holding' AND json_extract(data,'$.source')=?").bind(uid, src));
    const rec = { id: importId, filename, source: src, kind: str(body.kind, 40), counts, created_at: nowIso() };
    stmts.push(db.prepare("INSERT INTO fin_items (user_id,kind,id,import_id,data) VALUES (?,?,?,?,?)").bind(uid, "import", importId, importId, JSON.stringify(rec)));
    for (let i = 0; i < stmts.length; i += 90) await db.batch(stmts.slice(i, i + 90));
    await A("importacao.criada", { resource: "import", entity_id: importId, meta: { arquivo: filename, tipo: rec.kind, registros: counts } });
    return new Resp(201, rec);
  }
  if (m === "GET" && p === "/v1/imports") {
    const items = (await finLoad(db, uid, "import")).sort((a, b) => b.created_at.localeCompare(a.created_at));
    return { items };
  }
  const del = p.match(/^\/v1\/imports\/(imp_[A-Za-z0-9]+)$/);
  if (m === "DELETE" && del) {
    await db.prepare("DELETE FROM fin_items WHERE user_id=? AND import_id=?").bind(uid, del[1]).run();
    await A("importacao.apagada", { resource: "import", entity_id: del[1] });
    return new Resp(204);
  }
  if (m === "DELETE" && p === "/v1/imports") {
    await db.prepare("DELETE FROM fin_items WHERE user_id=?").bind(uid).run();
    await A("importacao.apagadas_todas", { resource: "import" });
    return new Resp(204);
  }
  /* ---- preferências da apuração: prejuízos de anos anteriores e DARFs pagos */
  const prefKey = "tax_prefs:" + uid;
  if (p === "/v1/tax/settings") {
    if (m === "GET") return await kvGet(db, prefKey, { prior_losses: {}, paid_darfs: {} });
    if (m === "PUT") {
      const prefs = await kvGet(db, prefKey, { prior_losses: {}, paid_darfs: {} });
      const pl = body.prior_losses || {};
      for (const k of ["comum", "daytrade", "fii"]) {
        const v = numOrNull(String(pl[k] ?? "").replace(",", "."));
        if (v !== null && v < 0) throw new Problem(422, "Dados inválidos", "Prejuízo deve ser um valor positivo.");
        if (pl[k] !== undefined) prefs.prior_losses[k] = v ? money(v) : "0.00";
      }
      await kvSet(db, prefKey, prefs);
      await A("tributacao.prejuizos_informados", { resource: "tax_settings", meta: prefs.prior_losses });
      return prefs;
    }
  }
  const darf = p.match(/^\/v1\/tax\/darfs\/(\d{4}-\d{2})$/);
  if (darf && (m === "PUT" || m === "DELETE")) {
    const prefs = await kvGet(db, prefKey, { prior_losses: {}, paid_darfs: {} });
    if (m === "DELETE") delete prefs.paid_darfs[darf[1]];
    else {
      const v = numOrNull(String(body.paid_value ?? "").replace(",", "."));
      if (!(v > 0)) throw new Problem(422, "Dados inválidos", "Informe o valor pago no DARF.");
      prefs.paid_darfs[darf[1]] = money(v);
    }
    await kvSet(db, prefKey, prefs);
    await A(m === "DELETE" ? "darf.desmarcado" : "darf.marcado_pago", { resource: "darf", entity_id: darf[1], meta: m === "DELETE" ? null : { valor: prefs.paid_darfs[darf[1]] } });
    return new Resp(m === "DELETE" ? 204 : 200, m === "DELETE" ? null : prefs);
  }
  /* ---- radar: status dos alertas */
  const al = p.match(/^\/v1\/alerts\/(alr_[a-f0-9]+)$/);
  if (al && m === "PATCH") {
    if (!["novo", "visto", "resolvido"].includes(body.status)) throw new Problem(422, "Dados inválidos", "Status deve ser novo, visto ou resolvido.");
    const st = await kvGet(db, "alerts_status:" + uid, {});
    st[al[1]] = body.status; await kvSet(db, "alerts_status:" + uid, st);
    await A("alerta.status", { resource: "alert", entity_id: al[1], meta: { status: body.status } });
    return { id: al[1], status: body.status };
  }
  const ents = u.me.entitlements || [];
  if (p === "/v1/simulations" && m === "GET") return { items: await kvGet(db, "sims:" + uid, []) };
  if (m !== "GET" && p !== "/v1/simulations" && p !== "/v1/assistant/query") throw new Problem(405, "Método não permitido", `${m} ${p}`);
  const [txs, accounts, holdings, trades] = await Promise.all(FIN_KINDS.map(k => finLoad(db, uid, k)));
  const fin = financeSummary(txs, accounts);
  if (p === "/v1/finance/summary") return fin;
  if (p === "/v1/finance/transactions") return { has_data: txs.length > 0, ...transactionsList(txs, Math.min(+q.limit || 60, 500)) };

  const ref = today();
  const known = Object.fromEntries(holdings.filter(h => h.ticker).map(h => [h.ticker, h.asset_class]));
  const prefs = await kvGet(db, prefKey, { prior_losses: {}, paid_darfs: {} });
  const year = /^\d{4}$/.test(q.year || "") ? +q.year : +ref.slice(0, 4);
  const tax = computeTax(trades, { year, refDate: ref, knownClasses: known, priorLosses: prefs.prior_losses, paidDarfs: prefs.paid_darfs });
  if (p === "/v1/simulations" && m === "POST") {
    if (!ents.includes("simulacao")) throw new Problem(402, "Recurso do plano Pro", "O simulador de cenários faz parte dos planos Pro e Premium.", { required_plan: "Pro" });
    let res;
    try {
      if (body.kind === "pgbl") res = simulatePgbl(body);
      else {
        const quotes = await loadQuotes(db, tickersFrom([...holdings, ...trades]));
        const hasRv = holdings.some(h => ["acao", "fii", "etf", "bdr"].includes(h.asset_class));
        const positions = applyQuotes(holdings, quotes, hasRv ? {} : tax.positions_cost);
        const ops = (body.scenarios?.[0]?.operations || []).slice(0, 10).map(o => ({ ticker: str(o.ticker, 20), quantity: numOrNull(o.quantity), date: isoDate(o.date), price: numOrNull(String(o.price ?? "").replace(",", ".")) }));
        res = simulateSale({ trades, positions, ops, opts: { refDate: ref, knownClasses: known, priorLosses: prefs.prior_losses, paidDarfs: prefs.paid_darfs } });
      }
    } catch (e) { if (e.status === 422) throw new Problem(422, "Simulação inválida", e.message); throw e; }
    res = { id: "sim_" + randomToken(8).replace(/[-_]/g, ""), created_at: nowIso(), ...res };
    const list = await kvGet(db, "sims:" + uid, []);
    await A("simulacao.executada", { resource: "simulation", entity_id: res.id, meta: { tipo: res.kind, hash: res.reproducibility_hash || null } });
    await kvSet(db, "sims:" + uid, [{ id: res.id, kind: res.kind, created_at: res.created_at, reproducibility_hash: res.reproducibility_hash || null, results: res.results.map(r => ({ name: r.name })) }, ...list].slice(0, 10));
    return new Resp(201, res);
  }
  if (p.startsWith("/v1/tax/")) {
    if (!(u.me.entitlements || []).includes("inteligencia_tributaria"))
      throw new Problem(402, "Recurso do plano Pro", "A apuração de imposto sobre as suas negociações faz parte dos planos Pro e Premium.", { required_plan: "Pro" });
    if (p === "/v1/tax/summary") { const { events, ...rest } = tax; return rest; }
    if (p === "/v1/tax/events") return { has_data: tax.has_data, year, items: tax.events };
    throw new Problem(404, "Não encontrado", p);
  }
  const quotes = await loadQuotes(db, tickersFrom([...holdings, ...trades]));
  // a posição da B3 é a fonte de verdade; sem ela, as negociações formam as posições de bolsa
  const hasRvPosition = holdings.some(h => ["acao", "fii", "etf", "bdr"].includes(h.asset_class));
  const port = portfolioSummary(applyQuotes(holdings, quotes, hasRvPosition ? {} : tax.positions_cost), trades);
  port.market = await kvGet(db, "market_indices", null);
  port.quotes_as_of = Object.values(quotes).map(x => x.date).sort().at(-1) || null;
  if (p === "/v1/portfolio/consolidated") return port;
  const alertsFor = async () => buildAlerts({ fin, port, tax, refDate: ref, statuses: await kvGet(db, "alerts_status:" + uid, {}) });
  if (p === "/v1/assistant/query" && m === "POST") {
    if (!ents.includes("assistente_ia")) throw new Problem(402, "Recurso do plano Pro", "O assistente faz parte dos planos Pro e Premium.", { required_plan: "Pro" });
    const qtext = str(body.question, 800).trim();
    if (!qtext) throw new Problem(422, "Dados inválidos", "Escreva a pergunta.");
    const t0 = Date.now();
    const docsMeta = (await db.prepare("SELECT data FROM docs WHERE user_id=?").bind(uid).all()).results.map(r => JSON.parse(r.data));
    const hasRv = holdings.some(h => ["acao", "fii", "etf", "bdr"].includes(h.asset_class));
    const positions = applyQuotes(holdings, quotes, hasRv ? {} : tax.positions_cost);
    const checklist = irpfChecklist({ year: +ref.slice(0, 4), accounts, holdings, txs, tax, docs: docsMeta, hasTrades: trades.some(t => t.date.startsWith(ref.slice(0, 4))), trades });
    const a = assistantAnswer(qtext, { fin, port, tax, alerts: await alertsFor(), name: u.me.name, trades, positions, refDate: ref, documents: docsMeta, checklist,
      taxOpts: { knownClasses: known, priorLosses: prefs.prior_losses, paidDarfs: prefs.paid_darfs } });
    a.tool_calls.forEach(t => { t.latency_ms = Date.now() - t0; });
    return { id: "ans_" + randomToken(8).replace(/[-_]/g, ""), thread_id: str(body.thread_id, 40) || "thr_" + randomToken(6).replace(/[-_]/g, ""), question: qtext, created_at: nowIso(),
             provider: "motor determinístico sobre os seus dados", disclaimer: ASSIST_DISCLAIMER, has_data: fin.has_data || port.has_data || tax.has_data, ...a };
  }
  if (p === "/v1/alerts") {
    const items = await alertsFor(), limited = !ents.includes("radar");
    return { has_data: fin.has_data || port.has_data || tax.has_data, limited, items: limited ? items.slice(0, 3) : items };
  }
  if (p === "/v1/dashboard") {
    const d = dashboardSummary({ name: u.me.name, fin, port, refDate: ref });
    if (tax.has_data) d.tax = taxDashboard(tax);
    const open = (await alertsFor()).filter(a => a.status !== "resolvido");
    d.alerts = { open: open.length, critical: open.filter(a => a.severity === "critico").length };
    return d;
  }
  throw new Problem(404, "Não encontrado", p);
}

/* ------------------------------------------------------------------ mercado: cotações e índices (M3) */
async function loadQuotes(db, tickers) {
  if (!tickers.length) return {};
  const out = {};
  for (let i = 0; i < tickers.length; i += 90) {
    const part = tickers.slice(i, i + 90);
    const { results } = await db.prepare(`SELECT ticker, data FROM quotes WHERE ticker IN (${part.map(() => "?").join(",")})`).bind(...part).all();
    results.forEach(r => { const q = JSON.parse(r.data); if (+q.close > 0) out[r.ticker] = q; });
  }
  return out;
}
async function getJson(url, headers = {}, timeout = 9000) {
  const r = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 (compatible; AurionBot/1.0; +https://aurionfinance.com.br)", Accept: "application/json", ...headers },
                               signal: AbortSignal.timeout(timeout), cf: { cacheTtl: 300 } });
  if (!r.ok) throw new Error(`HTTP ${r.status} em ${new URL(url).host}`);
  return r.json();
}
const marketState = db => kvGet(db, "market_state", { indices_at: null, quotes_at: null, quotes_ok: 0, quotes_fail: 0, errors: [] });

async function refreshMarket(env, db, { force = false } = {}) {
  const st = await marketState(db), errors = [];
  const done = { indices: false, quotes: 0 };
  // índices do Banco Central (4 consultas leves; o SGS costuma ser lento — guarda o que vier e tenta o resto depois)
  if (force || ageH(st.indices_at) >= 6) {
    const prev = await kvGet(db, "market_indices", null);
    const raw = (await kvGet(db, "market_raw", null)) || {};
    const want = { cdi_m: sgsLastUrl(SGS.cdi_m, 13), cdi_aa: sgsLastUrl(SGS.cdi_aa, 1), selic_meta: sgsLastUrl(SGS.selic_meta, 1), ipca: sgsLastUrl(SGS.ipca, 13) };
    const res = await Promise.allSettled(Object.values(want).map(u => getJson(u, {}, 25000).then(parseSgs)));
    let okAll = true;
    Object.keys(want).forEach((k, i) => {
      if (res[i].status === "fulfilled" && res[i].value.length) raw[k] = res[i].value;
      else { okAll = false; errors.push(`Banco Central (${k}): ${res[i].reason?.message || "sem dados"}`); }
    });
    if (Object.keys(raw).length) {
      await kvSet(db, "market_raw", raw);
      await kvSet(db, "market_indices", { ...(prev || {}), ...Object.fromEntries(Object.entries(indicesSnapshot(raw, today())).filter(([, v]) => v !== null)) });
      done.indices = true;
    }
    if (okAll) st.indices_at = nowIso();
  }
  // cotações: até 20 por execução (limite de subrequisições do plano gratuito), as mais antigas primeiro
  const { results } = await db.prepare("SELECT DISTINCT json_extract(data,'$.ticker') AS t FROM fin_items WHERE kind IN ('holding','trade')").all();
  const tickers = tickersFrom(results.map(r => ({ ticker: r.t })));
  if (tickers.length) {
    const have = {};
    for (let i = 0; i < tickers.length; i += 90) {
      const part = tickers.slice(i, i + 90);
      const r = await db.prepare(`SELECT ticker, fetched_at FROM quotes WHERE ticker IN (${part.map(() => "?").join(",")})`).bind(...part).all();
      r.results.forEach(x => { have[x.ticker] = x.fetched_at; });
    }
    const stale = tickers.filter(t => force || ageH(have[t]) >= 4).sort((a, b) => (have[a] || "").localeCompare(have[b] || "")).slice(0, 20);
    let ok = 0, fail = 0;
    const stmts = [];
    await Promise.all(stale.map(async t => {
      let q = null;
      try { q = parseYahooChart(await getJson(yahooUrl(t)), t); }
      catch (e) {
        if (env.BRAPI_TOKEN) { try { q = parseBrapi(await getJson(brapiUrl([t], env.BRAPI_TOKEN)))[0] || null; } catch (e2) { /* segue */ } }
        if (!q) errors.push(`${t}: ${e.message || e}`);
      }
      if (q) { ok++; stmts.push(db.prepare("INSERT INTO quotes (ticker,data,fetched_at) VALUES (?,?,?) ON CONFLICT(ticker) DO UPDATE SET data=excluded.data, fetched_at=excluded.fetched_at").bind(t, JSON.stringify(q), nowIso())); }
      else { fail++; stmts.push(db.prepare("INSERT INTO quotes (ticker,data,fetched_at) VALUES (?,?,?) ON CONFLICT(ticker) DO UPDATE SET fetched_at=excluded.fetched_at").bind(t, JSON.stringify({ ticker: t, close: null }), nowIso())); }
    }));
    if (stmts.length) await db.batch(stmts);
    if (stale.length) { st.quotes_at = nowIso(); st.quotes_ok = ok; st.quotes_fail = fail; }
    done.quotes = ok;
  }
  st.errors = errors.slice(0, 10);
  await kvSet(db, "market_state", st);
  return done;
}
async function marketPublic(env, db) {
  let indices = await kvGet(db, "market_indices", null);
  const st = await marketState(db);
  if (!indices && ageH(st.tried_at) > 0.1) {      // primeira chamada após a publicação: busca na hora
    await kvSet(db, "market_state", { ...st, tried_at: nowIso() });
    try { await refreshMarket(env, db); } catch (e) { /* registrado no estado */ }
    indices = await kvGet(db, "market_indices", null);
  }
  const n = await db.prepare("SELECT COUNT(*) AS n, MAX(json_extract(data,'$.date')) AS d FROM quotes WHERE json_extract(data,'$.close') IS NOT NULL").first();
  const s = await marketState(db);
  return { indices, quotes: { tickers: n?.n || 0, latest_date: n?.d || null, last_refresh: s.quotes_at, ok: s.quotes_ok, fail: s.quotes_fail },
           indices_refreshed_at: s.indices_at, errors: s.errors || [], brapi_fallback: !!env.BRAPI_TOKEN };
}

/* ------------------------------------------------------------------ Open Finance via Pluggy (M5) */
const ofConfigured = env => !!(env.PLUGGY_CLIENT_ID && env.PLUGGY_CLIENT_SECRET);
const ofBase = env => (env.PLUGGY_BASE_URL || "https://api.pluggy.ai").replace(/\/$/, "");
async function pluggyKey(env, db, force = false) {
  const c = await kvGet(db, "pluggy_key", null);
  if (!force && c && Date.parse(c.exp) > Date.now()) return c.key;
  const r = await fetch(ofBase(env) + "/auth", { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ clientId: env.PLUGGY_CLIENT_ID, clientSecret: env.PLUGGY_CLIENT_SECRET }), signal: AbortSignal.timeout(15000) });
  if (!r.ok) throw new Problem(502, "Open Finance indisponível", "Não foi possível autenticar no agregador. Confira PLUGGY_CLIENT_ID e PLUGGY_CLIENT_SECRET.");
  const { apiKey } = await r.json();
  await kvSet(db, "pluggy_key", { key: apiKey, exp: new Date(Date.now() + 100 * 60e3).toISOString() });
  return apiKey;
}
async function pluggy(env, db, method, path, body, retry = true) {
  const r = await fetch(ofBase(env) + path, { method, headers: { "Content-Type": "application/json", "X-API-KEY": await pluggyKey(env, db) },
    body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(20000) });
  if (r.status === 401 && retry) { await pluggyKey(env, db, true); return pluggy(env, db, method, path, body, false); }
  if (r.status === 204) return null;
  const data = await r.json().catch(() => ({}));
  if (!r.ok) { const e = new Problem(r.status === 404 ? 404 : 502, "Open Finance", data.message || `Erro ${r.status} no agregador`); e.upstream = r.status; throw e; }
  return data;
}
const ofItems = (db, uid) => kvGet(db, "of_items:" + uid, []);
const saveOfItems = (db, uid, items) => kvSet(db, "of_items:" + uid, items);
async function ofUpsertMeta(db, uid, patch) {
  const items = await ofItems(db, uid), i = items.findIndex(x => x.id === patch.id);
  if (i >= 0) items[i] = { ...items[i], ...patch }; else items.unshift({ created_at: nowIso(), ...patch });
  await saveOfItems(db, uid, items);
}

/* baixa contas, 12 meses de lançamentos e investimentos do item e substitui os dados dele */
async function ofSync(env, db, uid, itemId) {
  const item = await pluggy(env, db, "GET", `/items/${itemId}`);
  const view = itemView(item);
  if (["UPDATING", "CREATED"].includes(item.status) || item.status === "LOGIN_ERROR" || item.status === "WAITING_USER_INPUT") {
    await ofUpsertMeta(db, uid, { ...view, checked_at: nowIso() });
    return { synced: false, ...view };
  }
  const accounts = (await pluggy(env, db, "GET", `/accounts?itemId=${itemId}`)).results || [];
  const from = new Date(Date.now() - 365 * 864e5).toISOString().slice(0, 10);
  const transactions = {};
  for (const a of accounts.slice(0, 8)) {
    transactions[a.id] = [];
    for (let page = 1; page <= 6; page++) {
      const r = await pluggy(env, db, "GET", `/transactions?accountId=${a.id}&from=${from}&pageSize=500&page=${page}`);
      transactions[a.id].push(...(r.results || []));
      if (!r.totalPages || page >= r.totalPages) break;
    }
  }
  let investments = [];
  try { investments = (await pluggy(env, db, "GET", `/investments?itemId=${itemId}`)).results || []; } catch (e) { if (e.upstream !== 404) throw e; }
  const norm = normalizeItem({ item, accounts, transactions, investments });
  const importId = "of_" + itemId.replace(/[^A-Za-z0-9]/g, "").slice(0, 40);
  const src = "open_finance:" + (item.connector?.name || "instituicao").toLowerCase().replace(/[^a-z0-9]+/g, "_").slice(0, 30);
  const { stmts, counts } = await finStmts(db, uid, importId, src, norm);
  stmts.unshift(db.prepare("DELETE FROM fin_items WHERE user_id=? AND import_id=?").bind(uid, importId));
  for (let i = 0; i < stmts.length; i += 90) await db.batch(stmts.slice(i, i + 90));
  await ofUpsertMeta(db, uid, { ...view, counts, last_sync_at: nowIso(), checked_at: nowIso() });
  return { synced: true, ...view, counts };
}

async function ofRoute(m, p, body, u, env, db, url, req) {
  const A = (action, o = {}) => audit(db, req, { user_id: u.me.id, actor: u.me.id, resource: "connection", ...o, action });
  const uid = u.me.id;
  if (m === "GET" && p === "/v1/openfinance")
    return { configured: ofConfigured(env), provider: "Pluggy", widget_url: PLUGGY_WIDGET, sandbox: env.PLUGGY_SANDBOX === "1", items: await ofItems(db, uid) };
  if (!ofConfigured(env)) throw new Problem(409, "Conexão automática ainda não ativada", "O Open Finance será ativado em breve. Enquanto isso, envie seus extratos e relatórios em Importar dados.");
  if (m === "POST" && p === "/v1/openfinance/connect-token") {
    const items = await ofItems(db, uid);
    if (!body.item_id && items.length >= 10) throw new Problem(422, "Limite de conexões", "Máximo de 10 instituições conectadas.");
    if (body.item_id && !items.some(x => x.id === body.item_id)) throw new Problem(404, "Conexão não encontrada", "Item de outra conta.");
    const hook = `${url.origin}/v1/webhooks/pluggy${env.PLUGGY_WEBHOOK_TOKEN ? "?token=" + encodeURIComponent(env.PLUGGY_WEBHOOK_TOKEN) : ""}`;
    const r = await pluggy(env, db, "POST", "/connect_token", { ...(body.item_id ? { itemId: body.item_id } : {}), options: { clientUserId: uid, webhookUrl: hook, avoidDuplicates: true } });
    return { access_token: r.accessToken, widget_url: PLUGGY_WIDGET, sandbox: env.PLUGGY_SANDBOX === "1" };
  }
  if (m === "POST" && p === "/v1/openfinance/items") {
    const id = str(body.item_id, 80);
    if (!/^[A-Za-z0-9-]{8,80}$/.test(id)) throw new Problem(422, "Dados inválidos", "Identificador da conexão inválido.");
    const item = await pluggy(env, db, "GET", `/items/${id}`);
    if (item.clientUserId && item.clientUserId !== uid) throw new Problem(403, "Acesso negado", "Esta conexão pertence a outra conta.");
    await kvSet(db, "of_owner:" + id, uid);
    await ofUpsertMeta(db, uid, itemView(item));
    const res = await ofSync(env, db, uid, id);
    await A("conexao.criada", { entity_id: id, meta: { instituicao: res.institution, sincronizado: res.synced, registros: res.counts || null } });
    return new Resp(201, res);
  }
  const mm = p.match(/^\/v1\/openfinance\/items\/([A-Za-z0-9-]{8,80})(\/sync)?$/);
  if (mm) {
    const items = await ofItems(db, uid);
    if (!items.some(x => x.id === mm[1])) throw new Problem(404, "Conexão não encontrada", "Esta conexão não existe nesta conta.");
    if (m === "POST" && mm[2]) { const r = await ofSync(env, db, uid, mm[1]); await A("conexao.sincronizada", { entity_id: mm[1], meta: { registros: r.counts || null } }); return r; }
    if (m === "DELETE" && !mm[2]) {
      try { await pluggy(env, db, "DELETE", `/items/${mm[1]}`); } catch (e) { if (e.upstream !== 404) throw e; }
      await db.prepare("DELETE FROM fin_items WHERE user_id=? AND import_id=?").bind(uid, "of_" + mm[1].replace(/[^A-Za-z0-9]/g, "").slice(0, 40)).run();
      await saveOfItems(db, uid, items.filter(x => x.id !== mm[1]));
      await db.prepare("DELETE FROM kv WHERE k=?").bind("of_owner:" + mm[1]).run();
      await A("conexao.revogada", { entity_id: mm[1] });
      return new Resp(204);
    }
  }
  throw new Problem(404, "Não encontrado", `${m} ${p}`);
}

/* a Pluggy avisa quando terminou de atualizar um item; buscamos os dados na hora */
async function pluggyWebhook(env, db, body, q, ctx) {
  if (env.PLUGGY_WEBHOOK_TOKEN && !safeEqual(q.token, env.PLUGGY_WEBHOOK_TOKEN)) throw new Problem(401, "Não autorizado", "Token do webhook inválido.");
  if (!ofConfigured(env)) return { received: true, ignored: "não configurado" };
  const itemId = str(body.itemId || body.item?.id, 80), event = str(body.event, 60);
  const uid = itemId ? await kvGet(db, "of_owner:" + itemId, null) : null;
  if (!uid) return { received: true, ignored: "item desconhecido" };
  const job = (async () => {
    try {
      if (/^item\/(deleted)$/.test(event)) { await saveOfItems(db, uid, (await ofItems(db, uid)).filter(x => x.id !== itemId)); return; }
      await ofSync(env, db, uid, itemId);
    } catch (e) { await ofUpsertMeta(db, uid, { id: itemId, error: e.detail || e.message, checked_at: nowIso() }); }
  })();
  if (ctx?.waitUntil) ctx.waitUntil(job); else await job;
  return { received: true, event };
}

/* rede de segurança: sincroniza até 2 conexões por execução que estejam há mais de 20 h sem atualização */
async function ofCron(env, db) {
  const { results } = await db.prepare("SELECT k, v FROM kv WHERE k LIKE 'of_items:%'").all();
  const due = [];
  for (const r of results) for (const it of JSON.parse(r.v)) if (ageH(it.last_sync_at || it.checked_at) >= 20) due.push([r.k.slice(9), it.id]);
  for (const [uid, id] of due.slice(0, 2)) {
    try { await ofSync(env, db, uid, id); } catch (e) { await ofUpsertMeta(db, uid, { id, error: e.detail || e.message, checked_at: nowIso() }); }
  }
}

/* ------------------------------------------------------------------ documentos (D1, em blocos de 1 MB) */
const DOC_MAX = 8 * 1024 * 1024, DOC_QUOTA = 100 * 1024 * 1024, CHUNK = 1024 * 1024;
async function docRoute(m, p, body, q, u, db, req) {
  const uid = u.me.id;
  const load = async id => { const r = await db.prepare("SELECT data FROM docs WHERE user_id=? AND id=?").bind(uid, id).first(); if (!r) throw new Problem(404, "Documento não encontrado", id); return JSON.parse(r.data); };
  if (m === "GET" && p === "/v1/documents") {
    const items = (await db.prepare("SELECT data FROM docs WHERE user_id=?").bind(uid).all()).results.map(r => JSON.parse(r.data)).sort((a, b) => b.uploaded_at.localeCompare(a.uploaded_at));
    const year = /^\d{4}$/.test(q.year || "") ? +q.year : +today().slice(0, 4);
    const [txs, accounts, holdings, trades] = await Promise.all(FIN_KINDS.map(k => finLoad(db, uid, k)));
    const prefs = await kvGet(db, "tax_prefs:" + uid, { prior_losses: {}, paid_darfs: {} });
    const known = Object.fromEntries(holdings.filter(h => h.ticker).map(h => [h.ticker, h.asset_class]));
    const tax = computeTax(trades, { year, refDate: today(), knownClasses: known, priorLosses: prefs.prior_losses, paidDarfs: prefs.paid_darfs });
    return { items, kinds: DOC_KINDS, used_bytes: items.reduce((s, d) => s + d.size, 0), quota_bytes: DOC_QUOTA,
             checklist: irpfChecklist({ year, accounts, holdings, txs, tax, docs: items, hasTrades: trades.some(t => t.date.startsWith(String(year))), trades }) };
  }
  if (m === "POST" && p === "/v1/documents") {
    const filename = str(decodeURIComponent(req.headers.get("X-Filename") || ""), 160).replace(/[\\/]/g, "_").trim();
    const ext = filename.split(".").pop().toLowerCase();
    if (!filename || !ALLOWED[ext]) throw new Problem(422, "Arquivo não aceito", "Envie PDF, PNG, JPG, CSV, OFX, TXT, XLSX ou DOCX.");
    const buf = new Uint8Array(await req.arrayBuffer());
    if (!buf.length) throw new Problem(422, "Arquivo vazio", "O arquivo está vazio.");
    if (buf.length > DOC_MAX) throw new Problem(413, "Arquivo grande demais", "Máximo de 8 MB por arquivo.");
    const kindOk = sniff(buf.slice(0, 64));
    if (!ALLOWED[ext].includes(kindOk)) throw new Problem(422, "Conteúdo não confere", `O conteúdo do arquivo não corresponde à extensão .${ext}.`);
    const used = (await db.prepare("SELECT COALESCE(SUM(size),0) AS s FROM docs WHERE user_id=?").bind(uid).first()).s;
    if (used + buf.length > DOC_QUOTA) throw new Problem(413, "Espaço esgotado", "Você atingiu 100 MB de documentos. Apague arquivos antigos para enviar novos.");
    const id = "doc_" + randomToken(10).replace(/[-_]/g, "").slice(0, 16);
    const kindH = req.headers.get("X-Doc-Kind"), yearH = +req.headers.get("X-Doc-Year");
    const kind = DOC_KINDS[kindH] ? kindH : classifyDoc(filename);
    const year = yearH >= 2000 && yearH <= 2100 ? yearH : guessYear(filename, +today().slice(0, 4) - (kind === "informe_rendimentos" || kind === "declaracao" ? 1 : 0));
    const hash = b64u(await crypto.subtle.digest("SHA-256", buf.subarray(0, 262144))).slice(0, 22);   // impressão do início (poupa CPU do plano gratuito)
    const doc = { id, filename, mime: kindOk === "text/plain" ? "text/plain" : kindOk === "application/zip" ? "application/octet-stream" : kindOk, size: buf.length, checksum: hash,
                  kind, title: `${DOC_KINDS[kind]} ${year}`.replace(/^Outro documento/, filename.replace(/\.[^.]+$/, "").slice(0, 60)), year, status: "guardado", uploaded_at: nowIso() };
    const stmts = [db.prepare("INSERT INTO docs (user_id,id,data,size) VALUES (?,?,?,?)").bind(uid, id, JSON.stringify(doc), buf.length)];
    for (let i = 0, n = 0; i < buf.length; i += CHUNK, n++) stmts.push(db.prepare("INSERT INTO doc_chunks (doc_id,n,bytes) VALUES (?,?,?)").bind(id, n, buf.slice(i, i + CHUNK)));
    await db.batch(stmts);
    await audit(db, req, { user_id: uid, actor: uid, action: "documento.enviado", resource: "document", entity_id: id, meta: { arquivo: filename, tipo: kind, tamanho: buf.length, impressao: hash } });
    return new Resp(201, doc);
  }
  const mm = p.match(/^\/v1\/documents\/(doc_[A-Za-z0-9]+)(\/download)?$/);
  if (!mm) throw new Problem(404, "Não encontrado", p);
  const doc = await load(mm[1]);
  if (m === "GET" && mm[2]) {
    const { results } = await db.prepare("SELECT bytes FROM doc_chunks WHERE doc_id=? ORDER BY n").bind(doc.id).all();
    const parts = results.map(r => new Uint8Array(r.bytes)), out = new Uint8Array(parts.reduce((s, x) => s + x.length, 0));
    let off = 0; parts.forEach(x => { out.set(x, off); off += x.length; });
    return new Response(out, { status: 200, headers: { "Content-Type": doc.mime, "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(doc.filename)}`, "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
  }
  if (m === "PATCH" && !mm[2]) {
    if (body.kind && DOC_KINDS[body.kind]) doc.kind = body.kind;
    if (body.year && +body.year >= 2000 && +body.year <= 2100) doc.year = +body.year;
    if (body.title !== undefined) doc.title = str(body.title, 120).trim() || doc.title;
    if (body.institution !== undefined) doc.institution = str(body.institution, 80);
    await db.prepare("UPDATE docs SET data=? WHERE user_id=? AND id=?").bind(JSON.stringify(doc), uid, doc.id).run();
    await audit(db, req, { user_id: uid, actor: uid, action: "documento.alterado", resource: "document", entity_id: doc.id, meta: { tipo: doc.kind, ano: doc.year } });
    return doc;
  }
  if (m === "DELETE" && !mm[2]) {
    await db.batch([db.prepare("DELETE FROM docs WHERE user_id=? AND id=?").bind(uid, doc.id), db.prepare("DELETE FROM doc_chunks WHERE doc_id=?").bind(doc.id)]);
    await audit(db, req, { user_id: uid, actor: uid, action: "documento.apagado", resource: "document", entity_id: doc.id, meta: { arquivo: doc.filename } });
    return new Resp(204);
  }
  throw new Problem(405, "Método não permitido", `${m} ${p}`);
}
