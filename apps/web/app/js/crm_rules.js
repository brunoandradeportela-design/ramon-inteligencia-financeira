/* Regras de cadastro (espelham services/identity/service.py) e CRM do modo demonstração. */
const DDD = new Set([11,12,13,14,15,16,17,18,19,21,22,24,27,28,31,32,33,34,35,37,38,41,42,43,44,45,46,47,48,49,51,53,54,55,
  61,62,63,64,65,66,67,68,69,71,73,74,75,77,79,81,82,83,84,85,86,87,88,89,91,92,93,94,95,96,97,98,99]);

export function normalizePhone(raw) {
  let d = String(raw || "").replace(/\D/g, "");
  if (d.startsWith("55") && (d.length === 12 || d.length === 13)) d = d.slice(2);
  if (![10, 11].includes(d.length) || !DDD.has(+d.slice(0, 2))) return null;
  if (d.length === 11 && d[2] !== "9") return null;
  return "+55" + d;
}
export function formatPhone(e164) {
  const d = String(e164 || "").replace(/^\+55/, "");
  return d ? `(${d.slice(0, 2)}) ${d.slice(2, -4)}-${d.slice(-4)}` : "";
}
export function maskPhone(v) {
  const d = String(v).replace(/\D/g, "").slice(0, 11);
  if (d.length <= 2) return d.length ? `(${d}` : "";
  if (d.length <= 6) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
  if (d.length <= 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
}
export function isFullName(n) {
  const parts = String(n || "").trim().split(/\s+/).filter(Boolean);
  return parts.length >= 2 && parts[0].length >= 2 && parts.every(p => /^[A-Za-zÀ-ÿ'.-]+$/.test(p));
}
export function validateSignup(d) {
  const errors = [];
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(d.email || "")) errors.push({ field: "email", msg: "E-mail inválido" });
  if (!isFullName(d.name)) errors.push({ field: "name", msg: "Informe o nome completo (nome e sobrenome)" });
  if ((d.profession || "").trim().length < 3) errors.push({ field: "profession", msg: "Informe sua profissão" });
  if (!normalizePhone(d.phone)) errors.push({ field: "phone", msg: "Telefone inválido: informe DDD + número, ex. (69) 99999-9999" });
  if ((d.password || "").length < 10 || !/\d/.test(d.password) || !/[a-z]/i.test(d.password)) errors.push({ field: "password", msg: "Senha com 10+ caracteres, letras e números" });
  if (!d.accept_terms) errors.push({ field: "accept_terms", msg: "É necessário aceitar os termos e a política de privacidade" });
  return errors;
}

/* ------------------------------------------------------------------ CRM demo (estado local deste navegador) */
export const STAGES = [["novo_cadastro", "Novo cadastro"], ["ativado", "Ativado"], ["aguardando_pagamento", "Aguardando pagamento"],
  ["pagante", "Pagante"], ["inadimplente", "Inadimplente"], ["cancelado", "Cancelado"]];
const PRICE = { free: "0.00", pro: "89.90", premium: "149.90" }, PLAN_NAME = { free: "Free", pro: "Pro", premium: "Premium" };
const REF = new Date("2026-09-27T12:00:00");

export function metricsFrom(items) {
  const count = k => items.filter(i => i.stage === k).length;
  const paying = items.filter(i => i.stage === "pagante");
  const mrr = paying.reduce((s, i) => s + +i.subscription.price_month, 0);
  const created = items.map(i => new Date(i.created_at));
  const days = n => created.filter(c => (REF - c) / 864e5 < n).length;
  const monday = new Date(REF); monday.setDate(REF.getDate() - ((REF.getDay() + 6) % 7)); monday.setHours(0, 0, 0, 0);
  const weeks = [];
  for (let w = 7; w >= 0; w--) {
    const s = new Date(monday - w * 7 * 864e5), e = new Date(+s + 7 * 864e5);
    weeks.push({ week_start: s.toISOString().slice(0, 10), signups: created.filter(c => c >= s && c < e).length });
  }
  const month = "2026-09";
  const revenue = items.flatMap(i => i.payments || []).filter(p => p.status === "pago" && p.date.startsWith(month)).reduce((s, p) => s + +p.amount, 0);
  const prof = {}; items.forEach(i => prof[i.profession] = (prof[i.profession] || 0) + 1);
  const total = items.length;
  return {
    total, new_7d: days(7), new_30d: days(30), paying: paying.length, mrr: mrr.toFixed(2), arr: (mrr * 12).toFixed(2),
    ticket_medio: paying.length ? (mrr / paying.length).toFixed(2) : "0.00", ticket_target: "80.00", ticket_ok: paying.length > 0 && mrr / paying.length > 80,
    revenue_month: revenue.toFixed(2), overdue: count("inadimplente"),
    overdue_value: items.filter(i => i.stage === "inadimplente").reduce((s, i) => s + +i.subscription.price_month, 0).toFixed(2),
    conversion: total ? paying.length / total : 0, activation: total ? items.filter(i => i.stage !== "novo_cadastro").length / total : 0,
    stages: STAGES.map(([key, label]) => ({ key, label, count: count(key) })), signups_by_week: weeks,
    by_profession: Object.entries(prof).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([profession, count]) => ({ profession, count })),
    by_plan: ["free", "pro", "premium"].map(p => ({ plan: PLAN_NAME[p], count: items.filter(i => i.plan === p).length })),
    pricing_note: "Modo demonstração: alterações ficam só neste navegador.",
  };
}

export function localCustomer(body) {
  const phone = normalizePhone(body.phone), now = new Date().toISOString(), plan = body.plan || "free";
  return {
    id: "usr_local_" + Date.now(), name: body.name.trim().replace(/\s+/g, " "), email: body.email.trim().toLowerCase(), phone,
    phone_display: formatPhone(phone), whatsapp_url: "https://wa.me/" + phone.slice(1), profession: body.profession.trim(),
    plan, plan_name: PLAN_NAME[plan], origin: "site (este navegador)",
    stage: plan === "free" ? "novo_cadastro" : "aguardando_pagamento", stage_auto: plan === "free" ? "novo_cadastro" : "aguardando_pagamento",
    stage_overridden: false, subscription: { plan, price_month: PRICE[plan], started_at: now.slice(0, 10), status: plan === "free" ? "gratuita" : "aguardando_pagamento", next_due: plan === "free" ? null : now.slice(0, 10) },
    created_at: now, last_login_at: now, activity: { connections: 0, documents: 0, trades: 0, transactions: 0, simulations: 0, ai_questions: 0 },
    total_paid: "0.00", last_payment: null, tags: ["cadastro local"], next_action: "", next_action_date: null, payments: [], notes: [],
    timeline: [{ at: now, kind: "cadastro", text: `Cadastro no plano ${PLAN_NAME[plan]} (origem: site)` }],
  };
}

export function addMonth(iso) {
  const d = new Date(iso + "T12:00:00"); d.setMonth(d.getMonth() + 1); if (d.getDate() > 28) d.setDate(28);
  return d.toISOString().slice(0, 10);
}
export { PRICE, PLAN_NAME };

/* ------------------------------------------------------------------ pagamentos (visão geral do dono) */
export const PAY_STATUS = [["pago", "Pago"], ["pendente", "Pendente"], ["atrasado", "Atrasado"], ["estornado", "Estornado"]];
export const PAY_METHOD = { pix: "Pix", boleto: "Boleto", cartao: "Cartão", transferencia: "Transferência", a_definir: "A definir" };

export function paymentsFrom(items, gatewayRows, f = {}) {
  const map = new Map();
  (gatewayRows || []).forEach(r => { if (r.status !== "cancelado") map.set(r.id, { ...r }); });
  items.forEach(c => (c.payments || []).forEach(p => {
    if (map.has(p.id)) return;
    map.set(p.id, { id: p.id, user_id: c.id, customer_name: c.name, customer_email: c.email, value: p.amount, net_value: p.amount,
      method: p.method, status: p.status, status_gateway: null, due_date: p.due_date || p.date, paid_date: p.status === "pago" ? p.date : null,
      invoice_url: p.invoice_url || null, description: `Período ${p.period}`, origin: p.origin || "manual", created_at: p.recorded_at || p.date });
  }));
  const ref = r => (r.paid_date || r.due_date || "").slice(0, 10);
  let rows = [...map.values()];
  if (f.status) rows = rows.filter(r => r.status === f.status);
  if (f.method) rows = rows.filter(r => r.method === f.method);
  if (f.origin) rows = rows.filter(r => r.origin === f.origin || (f.origin === "sem_vinculo" && !r.user_id));
  if (f.q) { const q = f.q.toLowerCase(); rows = rows.filter(r => (r.customer_name || "").toLowerCase().includes(q) || (r.customer_email || "").toLowerCase().includes(q) || r.id.toLowerCase().includes(q)); }
  if (f.date_from) rows = rows.filter(r => ref(r) >= f.date_from);
  if (f.date_to) rows = rows.filter(r => ref(r) <= f.date_to);
  rows.sort((a, b) => ref(b).localeCompare(ref(a)));
  const sum = (st, k = "value") => rows.filter(r => r.status === st).reduce((s, r) => s + +r[k], 0).toFixed(2);
  return { total: rows.length, items: rows, totals: { recebido: sum("pago"), recebido_liquido: sum("pago", "net_value"), pendente: sum("pendente"),
    atrasado: sum("atrasado"), estornado: sum("estornado"), sem_vinculo: rows.filter(r => !r.user_id).length,
    count: Object.fromEntries(PAY_STATUS.map(([k]) => [k, rows.filter(r => r.status === k).length])) } };
}

export function docValid(v) {
  const d = String(v || "").replace(/\D/g, "");
  if (d.length === 11 && !/^(\d)\1+$/.test(d)) {
    const n = [...d].map(Number);
    for (const k of [9, 10]) { const s = n.slice(0, k).reduce((a, x, i) => a + x * (k + 1 - i), 0); if ((s * 10) % 11 % 10 !== n[k]) return false; }
    return true;
  }
  if (d.length === 14 && !/^(\d)\1+$/.test(d)) {
    const n = [...d].map(Number), w1 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2], w2 = [6, ...w1];
    const dv = (w, k) => { const r = w.reduce((a, x, i) => a + x * n[i], 0) % 11; return r < 2 ? 0 : 11 - r; };
    return dv(w1, 12) === n[12] && dv(w2, 13) === n[13];
  }
  return false;
}
