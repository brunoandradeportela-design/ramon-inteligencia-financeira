/* Cliente da API v1 + backend de demonstração (sem servidor).
   Em modo demo, todos os números vêm de data/demo.json, gerado pelos motores Python
   (tools/export_demo.py). O JS não recalcula imposto — só consulta a grade pré-calculada. */

import { validateSignup, localCustomer, metricsFrom, addMonth, formatPhone, PRICE, PLAN_NAME, paymentsFrom, docValid } from "./crm_rules.js";

const BASE = (window.RAMON_API_BASE || "").replace(/\/$/, "");
export const DEMO = !BASE;
/* Modo híbrido (API na nuvem): contas, CRM e pagamentos são reais; os módulos de análise
   (finanças, impostos, carteira, simulações) usam o snapshot de demonstração até o Open Finance. */
export const ANALYTICS_DEMO = true;
const REAL = p => !!BASE && /^\/v1\/(auth|me|theme-preference|admin|billing|imports|market|tax\/settings|tax\/darfs|tax\/rules|tax\/calculations|simulations|openfinance|documents|assistant|security|sessions|audit|privacy|consents|institutions|data-quality|allocation|finance\/categories|finance\/transactions\/tra_[A-Za-z0-9_-]+|alerts\/alr_[a-f0-9]+)(\/|\?|$)/.test(p);
/* painéis que usam os dados importados pelo cliente; sem dados próprios, mostram o exemplo */
const HYBRID_DATA = p => !!BASE && /^\/v1\/(finance\/summary|finance\/transactions|portfolio\/consolidated|dashboard|tax\/summary|tax\/events|alerts)(\?|$)/.test(p);
async function hybridGet(p) {
  const r = await http("GET", p);
  if (r && r.has_data === false) return { ...(await demoCall("GET", p)), sample: true };
  return r;
}
const TOKEN_KEY = "ramon.token";
let demoData = null;

export class ApiError extends Error {
  constructor(problem) { super(problem.detail || problem.title); this.problem = problem; this.status = problem.status; }
}

function cid() { return (crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2)).replace(/-/g, ""); }
export const session = {
  get token() { try { return localStorage.getItem(TOKEN_KEY); } catch { return null; } },
  set(t) { try { t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY); } catch {} },
};

async function http(method, path, body, headers = {}) {
  const res = await fetch(BASE + path, {
    method, body: body !== undefined ? JSON.stringify(body) : undefined,
    headers: { "Content-Type": "application/json", "X-Correlation-ID": cid(),
               ...(session.token ? { Authorization: `Bearer ${session.token}` } : {}), ...headers },
  });
  if (res.status === 204) return null;
  const data = await res.json().catch(() => ({ title: "Erro", detail: res.statusText, status: res.status }));
  if (!res.ok) throw new ApiError(data);
  return data;
}

/* ---------------------------------------------------------------- demo backend */
const LS = {
  get(k, d) { try { return JSON.parse(localStorage.getItem("ramon.demo." + k)) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem("ramon.demo." + k, JSON.stringify(v)); } catch {} },
};
async function demo() {
  if (!demoData) demoData = await (await fetch(new URL("../data/demo.json", import.meta.url))).json();
  return demoData;
}
const norm = s => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
function classify(q, pats) {
  const t = norm(q);
  const any = list => list.some(p => new RegExp(p.replace(/\\b/g, "\\b")).test(t));
  if (any(pats.injection) || any(pats.credential)) return any(pats.injection) ? "bloqueado" : "credencial";
  if (any(pats.advice)) return "investimento_individual";
  const order = ["simulacao", "tributaria", "alertas", "patrimonio", "financeira", "documento"];
  let best = "geral", score = 0;
  for (const k of order) { const n = pats.intents[k].filter(p => new RegExp(p).test(t)).length; if (n > score) { best = k; score = n; } }
  return best;
}
function problem(status, title, detail) { return new ApiError({ status, title, detail }); }

async function demoCall(method, path, body) {
  const d = await demo();
  const [p, qs] = path.split("?");
  const alertStatus = LS.get("alerts", {});
  const revoked = LS.get("revoked", []);
  const extraConns = LS.get("conns", []);
  const mapConn = c => revoked.includes(c.id) ? { ...c, status: "revogado", consent: { ...c.consent, status: "revogado" } } : c;
  const R = {
    "POST /v1/auth/login": () => {
      const email = norm(body.email || "");
      if (email === d.admin_me.email && body.password === "ramon2026crm") { LS.set("role", "admin"); return { token: "demo-admin", user: d.admin_me }; }
      if (email !== "demo@ramon.app" || body.password !== "demo2026ramon")
        throw problem(401, "Não autenticado", "E-mail ou senha incorretos.");
      LS.set("role", "client"); LS.set("name", null);
      return { token: "demo-token", user: d.me };
    },
    "POST /v1/auth/register": () => {
      const errors = validateSignup(body);
      if (errors.length) throw new ApiError({ status: 422, title: "Dados inválidos", detail: "Cadastro inválido", errors });
      const all = [...LS.get("crm_local", []), ...d.crm.customers.items];
      if (all.some(c => c.email === body.email.trim().toLowerCase())) throw problem(409, "Conflito", "Já existe uma conta com este e-mail.");
      LS.set("crm_local", [localCustomer(body), ...LS.get("crm_local", [])]);
      LS.set("name", body.name.trim()); LS.set("role", "client");
      return { token: "demo-token", user: { ...d.me, name: body.name, email: body.email, profession: body.profession, phone: body.phone } };
    },
    "POST /v1/auth/logout": () => { LS.set("role", null); return null; },
    "GET /v1/me": () => LS.get("role", "client") === "admin" ? { ...d.admin_me, theme: LS.get("theme", "system") }
      : { ...d.me, name: LS.get("name", null) || d.me.name, theme: LS.get("theme", d.me.theme) },
    "GET /v1/admin/crm/metrics": () => metricsFrom(crmItems()),
    "GET /v1/admin/payments": () => paymentsFrom(crmItems(), d.gateway_payments || [], Object.fromEntries(new URLSearchParams(qs || ""))),
    "GET /v1/admin/payments/gateway": () => ({ provider: "Asaas", demo: true, configured: false, env: null, webhooks: 0, last_webhook_at: null, last_sync_at: null }),
    "POST /v1/admin/payments/sync": () => { throw problem(409, "Indisponível na demonstração", "A sincronização com o Asaas funciona com a API hospedada e a chave configurada no servidor."); },
    "POST /v1/billing/checkout": () => {
      if (!docValid(body.cpf_cnpj)) throw problem(422, "Dados inválidos", "CPF ou CNPJ inválido.");
      return { invoice_url: null, demo: true, subscription_id: null };
    },
    "GET /v1/admin/team": () => ({ items: [{ id: d.admin_me.id, name: d.admin_me.name, email: d.admin_me.email, roles: d.admin_me.roles }] }),
    "GET /v1/admin/crm/customers": () => {
      const q = new URLSearchParams(qs || ""), term = norm(q.get("q") || ""), dg = term.includes("@") ? "" : term.replace(/\D/g, ""), digits = dg.length >= 4 ? dg : "";
      let items = crmItems().map(({ payments, notes, timeline, ...rest }) => rest);
      if (term) items = items.filter(i => norm(i.name).includes(term) || i.email.includes(term) || norm(i.profession).includes(term) || (digits && i.phone.includes(digits)));
      if (q.get("stage")) items = items.filter(i => i.stage === q.get("stage"));
      if (q.get("plan")) items = items.filter(i => i.plan === q.get("plan"));
      items.sort((a, b) => b.created_at.localeCompare(a.created_at));
      return { total: items.length, items };
    },
    "GET /v1/dashboard": () => {
      const al = R["GET /v1/alerts"]().items.filter(a => a.status !== "resolvido");
      return { ...d.dashboard, greeting: LS.get("name", d.dashboard.greeting).split(" ")[0],
               alerts: { open: al.length, critical: al.filter(a => ["critico", "alto"].includes(a.severity)).length },
               next_actions: al.slice(0, 3).map(a => ({ title: a.title, detail: a.detail, severity: a.severity, action: a.action })) };
    },
    "GET /v1/finance/summary": () => d.finance,
    "GET /v1/finance/transactions": () => d.transactions,
    "GET /v1/portfolio/consolidated": () => d.portfolio,
    "GET /v1/tax/summary": () => d.tax,
    "GET /v1/tax/events": () => d.tax_events,
    "GET /v1/tax/rules": () => d.tax_rules,
    "GET /v1/plans": () => d.plans,
    "GET /v1/institutions": () => d.institutions,
    "GET /v1/audit": () => d.audit,
    "GET /v1/consents": () => d.consents,
    "GET /v1/alerts": () => ({ ...d.alerts, items: d.alerts.items.map(a => ({ ...a, status: alertStatus[a.id] || a.status })) }),
    "GET /v1/documents": () => ({ items: [...LS.get("docs", []), ...d.documents.items] }),
    "POST /v1/documents": () => {
      const ext = body.filename.split(".").pop().toLowerCase();
      if (!["pdf", "png", "jpg", "jpeg", "csv"].includes(ext)) throw problem(422, "Dados inválidos", "Extensão não permitida. Aceitos: PDF, PNG, JPG e CSV.");
      const kinds = [[/informe|rendimento/, "informe_rendimentos", "Informe de rendimentos"], [/corretagem|nota/, "nota_corretagem", "Nota de corretagem"],
                     [/darf/, "darf", "DARF"], [/extrato/, "extrato", "Extrato"], [/previd|pgbl|vgbl/, "previdencia", "Previdência"]];
      const k = kinds.find(([re]) => re.test(norm(body.filename))) || [0, "outro", "Documento"];
      const doc = { id: "doc_demo_" + Date.now(), filename: body.filename, mime: body.mime, size: body.size || 0, kind: k[1], title: k[2],
                    status: "classificado", uploaded_at: new Date().toISOString(), extraction: {}, links: [],
                    detail: "Modo demonstração: arquivo classificado localmente; nada é enviado a servidores." };
      LS.set("docs", [doc, ...LS.get("docs", [])]);
      return doc;
    },
    "GET /v1/connections": () => ({ ...d.connections, items: [...d.connections.items, ...extraConns].map(mapConn) }),
    "POST /v1/connections/consents": () => {
      const inst = d.institutions.institutions.find(i => i.id === body.institution_id);
      if (!body.scope?.length) throw problem(422, "Dados inválidos", "Selecione ao menos um tipo de dado para compartilhar.");
      const id = "con_demo_" + Date.now(), consent = "cns_demo_" + Date.now();
      LS.set("pending", { id, consent, inst, scope: body.scope });
      return { connection_id: id, consent_id: consent, mode: "sandbox",
               redirect_url: `#/conexoes/retorno?consent=${consent}&institution=${inst.id}&sandbox=1` };
    },
    "POST /v1/connections/consents/confirm": () => {
      const pend = LS.get("pending", null);
      if (!pend || pend.consent !== body.consent_id) throw problem(409, "Consentimento em estado inválido", "Consentimento não encontrado.");
      const now = new Date().toISOString(), exp = new Date(Date.now() + 360 * 864e5).toISOString();
      const conn = { id: pend.id, institution_id: pend.inst.id, institution: pend.inst.name, institution_type: pend.inst.type,
                     consent_id: pend.consent, scope: pend.scope, status: "ativo", mode: "sandbox", last_sync_at: now,
                     data_quality_score: 1, created_at: now, updated_at: now,
                     sync_runs: [{ id: "sync_demo", started_at: now, result: "ok", stats: {} }],
                     consent: { id: pend.consent, status: "ativo", expires_at: exp,
                                purpose: "Consolidar contas e investimentos para diagnóstico financeiro e tributário",
                                scope_labels: pend.scope } };
      LS.set("conns", [...extraConns.filter(c => c.institution_id !== conn.institution_id), conn]);
      LS.set("pending", null);
      return { connection: conn, stats: { note: "sandbox: dados fictícios" } };
    },
    "GET /v1/simulations": () => ({ items: LS.get("sims", []) }),
    "POST /v1/simulations": () => {
      let res;
      if (body.kind === "pgbl") {
        const rule = d.tax_rules.items.find(r => r.code === "BR-IRPF-PGBL-DEDUCAO");
        const lim = +body.taxable_income * +rule.parameters.limite_percentual;
        const eligible = body.full_model && body.contributes_social_security;
        const cur = +body.current_contributions, ext = +body.extra_contribution, rate = +body.marginal_rate;
        const now = eligible ? Math.min(cur, lim) : 0, after = eligible ? Math.min(cur + ext, lim) : 0;
        const eff = (after - now) * rate, f = v => v.toFixed(2);
        const notes = [];
        if (!body.full_model) notes.push("No modelo simplificado a contribuição ao PGBL não é dedutível.");
        if (!body.contributes_social_security) notes.push("A dedução exige contribuição ao regime geral ou próprio de previdência.");
        if (cur + ext > lim) notes.push(`Contribuições acima de 12% (${f(lim)}) não geram dedução adicional.`);
        res = { kind: "pgbl", id: "sim_demo_" + Date.now(), created_at: new Date().toISOString(), kind_label: "estimativa",
                limit_12pct: f(lim), remaining_room: eligible ? f(Math.max(0, lim - cur)) : "0.00", difference: f(eff),
                results: [{ name: "Cenário atual", contributions: f(cur), deductible: f(now), tax_effect_estimate: "0.00", liquidity_committed: f(cur) },
                          { name: "Cenário com aporte adicional", contributions: f(cur + ext), deductible: f(after), tax_effect_estimate: f(eff), liquidity_committed: f(cur + ext) }],
                premises: [`Alíquota marginal informada pelo titular: ${(rate * 100).toFixed(1).replace(".", ",")}%`,
                           "Efeito é diferimento: o valor deduzido será tributado no resgate/benefício conforme regime escolhido.",
                           "Tabela progressiva anual não é recalculada (regra BR-IRPF-TABELA-ANUAL pendente).", ...notes],
                rule: { code: rule.code, version: rule.version, title: rule.title, sources: rule.sources.map(s => s.id) },
                confidence: eligible ? 0.8 : 0.5,
                disclaimer: "Simulação informativa. Mostra consequências estimadas de cenários; não é recomendação de investimento nem substitui a análise de um contador." };
      } else {
        const op = body.scenarios?.[0]?.operations?.[0];
        const key = op && `${op.ticker}|${op.fraction}|${op.date}`;
        res = key && d.simulation_grid[key];
        if (!res) throw problem(422, "Cenário indisponível no modo demonstração",
                                "No modo demonstração use as frações pré-calculadas (25/50/75/100%). Com a API conectada, qualquer quantidade é aceita.");
        res = { ...res, id: "sim_demo_" + Date.now(), created_at: new Date().toISOString() };
      }
      LS.set("sims", [res, ...LS.get("sims", [])].slice(0, 10));
      return res;
    },
    "POST /v1/assistant/query": () => {
      const intent = classify(body.question, d.assistant_patterns);
      const tpl = intent === "credencial" ? { ...d.assistant.bloqueado, guardrail: "credencial",
        answer: "Nunca informe senhas ou tokens de banco aqui. A conexão com instituições acontece pelo Open Finance, com autenticação feita diretamente no ambiente da instituição. Veja em Conexões." }
        : d.assistant[intent] || d.assistant.geral;
      return { ...tpl, question: body.question, id: "ans_demo_" + Date.now(), created_at: new Date().toISOString(),
               provider: tpl.provider + " (snapshot demo)" };
    },
    "GET /v1/theme-preference": () => ({ theme: LS.get("theme", "system") }),
    "PUT /v1/theme-preference": () => { LS.set("theme", body.theme); return { theme: body.theme }; },
  };
  function crmItems() {
    const over = LS.get("crm_over", {});
    return [...LS.get("crm_local", []), ...d.crm.customers.items.map(c => d.crm.details[c.id])].map(c => over[c.id] || c);
  }
  function crmSave(c) {
    if (c.id.startsWith("usr_local_")) LS.set("crm_local", LS.get("crm_local", []).map(x => x.id === c.id ? c : x));
    else { const o = LS.get("crm_over", {}); o[c.id] = c; LS.set("crm_over", o); }
    return c;
  }
  function crmGet(id) { const c = crmItems().find(x => x.id === id); if (!c) throw problem(404, "Recurso não encontrado", "Cliente"); return structuredClone(c); }
  let m = R[`${method} ${p}`];
  if (!m) {
    let mm;
    const cm = p.match(/^\/v1\/admin\/crm\/customers\/([^/]+)(?:\/(notes|payments))?$/);
    if (cm && !cm[2] && method === "GET") m = () => crmGet(cm[1]);
    else if (cm && !cm[2] && method === "PATCH") m = () => {
      const c = crmGet(cm[1]);
      if (body.plan && body.plan !== c.plan) { c.plan = body.plan; c.plan_name = PLAN_NAME[body.plan]; c.subscription.plan = body.plan; c.subscription.price_month = PRICE[body.plan]; }
      if (body.stage) { c.stage = body.stage; c.stage_overridden = true; }
      if (body.clear_override) { c.stage = c.stage_auto; c.stage_overridden = false; }
      if (body.tags) c.tags = body.tags;
      if (body.next_action !== undefined) c.next_action = body.next_action;
      if (body.next_action_date !== undefined) c.next_action_date = body.next_action_date || null;
      return crmSave(c);
    };
    else if (cm && cm[2] === "notes") m = () => {
      const c = crmGet(cm[1]);
      if (!String(body.text || "").trim()) throw problem(422, "Dados inválidos", "Escreva a anotação.");
      const n = { id: "nte_" + Date.now(), at: new Date().toISOString(), kind: body.kind, text: body.text.trim(), author: "Ramon Administrador" };
      c.notes = [n, ...(c.notes || [])]; c.timeline = [{ at: n.at, kind: n.kind, text: n.text, author: n.author }, ...(c.timeline || [])];
      crmSave(c); return n;
    };
    else if (cm && cm[2] === "payments") m = () => {
      const c = crmGet(cm[1]), amt = +String(body.amount).replace(",", ".");
      if (!(amt > 0)) throw problem(422, "Dados inválidos", "Valor deve ser positivo.");
      const pay = { id: "pay_" + Date.now(), date: body.date, amount: amt.toFixed(2), method: body.method, status: body.status, period: body.period,
                    reference: body.reference || "", recorded_by: "Ramon Administrador", origin: "manual", recorded_at: new Date().toISOString() };
      c.payments = [pay, ...(c.payments || [])]; c.last_payment = pay;
      c.timeline = [{ at: pay.date, kind: "pagamento", text: `Pagamento ${pay.status}: R$ ${pay.amount} via ${pay.method} (${pay.period})` }, ...(c.timeline || [])];
      if (pay.status === "pago") {
        c.total_paid = (+c.total_paid + amt).toFixed(2); c.subscription.status = "ativa";
        c.subscription.next_due = addMonth(c.subscription.next_due || body.date);
        c.stage_auto = "pagante"; if (!c.stage_overridden) c.stage = "pagante";
      } else if (pay.status === "atrasado") { c.subscription.status = "inadimplente"; c.stage_auto = "inadimplente"; if (!c.stage_overridden) c.stage = "inadimplente"; }
      crmSave(c); return pay;
    };
    if (!m) {
    if ((mm = p.match(/^\/v1\/alerts\/(.+)$/)) && method === "PATCH") m = () => { alertStatus[mm[1]] = body.status; LS.set("alerts", alertStatus); return { id: mm[1], status: body.status }; };
    else if ((mm = p.match(/^\/v1\/connections\/(.+)\/revoke$/))) m = () => { LS.set("revoked", [...new Set([...revoked, mm[1]])]); return mapConn({ ...[...d.connections.items, ...extraConns].find(c => c.id === mm[1]) }); };
    else if ((mm = p.match(/^\/v1\/connections\/(.+)\/refresh$/))) m = () => {
      if (revoked.includes(mm[1])) throw problem(409, "Conexão inativa", "Status: revogado");
      const c = [...d.connections.items, ...extraConns].find(c => c.id === mm[1]);
      return { connection: { ...c, last_sync_at: new Date().toISOString() }, stats: { replayed: 1, note: "sandbox: sem dados novos" } };
    };
  }
  }
  if (!m) throw problem(404, "Não encontrado", `${method} ${p}`);
  await new Promise(r => setTimeout(r, 120));   // latência simulada p/ estados de carregamento
  return structuredClone(m());
}

async function realPost(p, b, h) {
  const r = await http("POST", p, b, h);
  if (/^\/v1\/auth\/(login|register|owner\/setup)$/.test(p) && r?.user?.name) { LS.set("name", r.user.name); LS.set("role", r.user.roles?.includes("admin") ? "admin" : "client"); }
  return r;
}
export const HAS_API = !!BASE;
export const api = {
  get: p => REAL(p) ? http("GET", p) : HYBRID_DATA(p) ? hybridGet(p) : demoCall("GET", p),
  post: (p, b, h) => REAL(p) ? realPost(p, b, h) : demoCall("POST", p, b),
  put: (p, b) => REAL(p) ? http("PUT", p, b) : demoCall("PUT", p, b),
  patch: (p, b) => REAL(p) ? http("PATCH", p, b) : demoCall("PATCH", p, b),
  del: p => REAL(p) ? http("DELETE", p) : Promise.reject(new ApiError({ status: 409, title: "Indisponível", detail: "Solicite pelo suporte: exportação/exclusão de dados é feita pelo administrador." })),
  demo: p => demoCall("GET", p),
  demoPost: (p, b) => demoCall("POST", p, b),
  demoPatch: (p, b) => demoCall("PATCH", p, b),
  /* envio binário (documentos): sem base64, sem JSON */
  upload: async (p, file, meta = {}) => {
    const res = await fetch(BASE + p, { method: "POST", body: file, headers: { "Content-Type": file.type || "application/octet-stream", "X-Filename": encodeURIComponent(file.name),
      ...(meta.kind ? { "X-Doc-Kind": meta.kind } : {}), ...(meta.year ? { "X-Doc-Year": String(meta.year) } : {}), ...(session.token ? { Authorization: `Bearer ${session.token}` } : {}) } });
    const data = await res.json().catch(() => ({ title: "Erro", detail: res.statusText, status: res.status }));
    if (!res.ok) throw new ApiError(data);
    return data;
  },
  download: async p => {
    const res = await fetch(BASE + p, { headers: session.token ? { Authorization: `Bearer ${session.token}` } : {} });
    if (!res.ok) throw new ApiError(await res.json().catch(() => ({ title: "Erro", detail: res.statusText, status: res.status })));
    return res.blob();
  },   // simulador de vendas: continua sobre a grade pré-calculada do exemplo
  demoGrid: async () => ANALYTICS_DEMO ? (await demo()).simulation_grid : null,
};
