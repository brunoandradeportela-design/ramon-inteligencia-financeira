/* E-mails automáticos (alertas importantes e AURION Daily), respeitando as preferências do cliente.
 * Roda no cron do Worker em lotes pequenos, de manhã (07h–12h59 de Brasília), uma vez por dia por cliente.
 * Usa o retrato salvo na última vez que o cliente abriu o app; sem retrato recente, calcula só prazos (DARF e
 * vencimentos), que é barato. Sem provedor de e-mail configurado, nada é enviado. */
import { kvGet, kvSet, nowIso, today } from "./shared.js";
import { mailConfigured, sendMail } from "./identity.js";
import { personalEvents } from "../../apps/web/app/js/event_engine.js";
import { dailyBriefing } from "../../apps/web/app/js/daily_engine.js";

export const MAIL_USERS_KEY = "notif_mail_users";
const PER_RUN = 6, FALLBACK_PER_RUN = 2, FALLBACK_MAX_TRADES = 1500, STALE_H = 48;
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const appUrl = env => (env.APP_URL || "https://aurionfinance.com.br/app/").replace(/\/?$/, "/");

/* itens da central de notificações (mesma regra da tela) */
export function notifItems({ alerts = [], tax = null, holdings = [], ref }) {
  const al = alerts.filter(a => a.status !== "resolvido" && ["critico", "alto"].includes(a.severity))
    .map(a => ({ id: "ntf_" + a.id, kind: "alerta", severity: a.severity, title: a.title, detail: a.detail || a.description || "", at: a.due_date || ref, link: "#/alertas" }));
  const ev = personalEvents({ tax, holdings, refDate: ref, horizonDays: 7, pastDays: 0 })
    .map(e => ({ id: ("ntf_" + e.kind + "_" + e.date + "_" + e.title.normalize("NFD").replace(/[^A-Za-z0-9]+/g, "")).slice(0, 72), kind: e.kind,
      severity: e.impact === "atenção" ? "alto" : "medio", title: e.title, detail: e.detail, at: e.date, link: e.link }));
  return [...al, ...ev];
}

/* guarda o retrato para o e-mail — só para quem ligou algum e-mail (evita escrita para todos) */
export async function cacheForMail(db, uid, { items, dash, events }) {
  const pref = await kvGet(db, "notif_prefs:" + uid, null);
  if (!pref || !(pref.email_alerts || pref.email_daily)) return;
  await kvSet(db, "notif_cache:" + uid, { at: nowIso(), items, dash, events });
}

/* mantém o índice de quem recebe e-mail (chamado ao salvar preferências) */
export async function syncMailIndex(db, uid, on) {
  const list = await kvGet(db, MAIL_USERS_KEY, []);
  const has = list.includes(uid);
  if (on && !has) { list.push(uid); await kvSet(db, MAIL_USERS_KEY, list.slice(-5000)); }
  if (!on && has) await kvSet(db, MAIL_USERS_KEY, list.filter(x => x !== uid));
}

export function alertsEmail(name, items, env) {
  const first = String(name || "").split(" ")[0] || "Olá";
  const rows = items.map(i => `<li style="margin:0 0 10px"><b>${esc(i.title)}</b>${i.detail ? `<br><span style="color:#555">${esc(i.detail)}</span>` : ""}</li>`).join("");
  return { subject: items.length === 1 ? `AURION: ${items[0].title}` : `AURION: ${items.length} pontos de atenção`,
    html: `<p>Olá, ${esc(first)}.</p><p>Itens importantes na sua conta:</p><ul>${rows}</ul><p><a href="${appUrl(env)}#/notificacoes">Abrir no AURION</a></p>${footer(env)}` };
}
export function dailyEmail(daily, env) {
  return { subject: `AURION Daily · ${daily.date.split("-").reverse().join("/")}`,
    html: `<p>${esc(daily.opening)}</p>${daily.sections.map(s => `<p><b>${esc(s.title)}.</b> ${esc(s.text)}</p>`).join("")}<p><a href="${appUrl(env)}#/noticias">Ver no AURION (com notícias e divulgações)</a></p>${footer(env, daily.disclaimer)}` };
}
const footer = (env, extra = "") => `<hr><p style="color:#777;font-size:12px">${esc(extra)} Você recebe este e-mail porque ativou as notificações por e-mail. Para parar, desmarque em Configurações: <a href="${appUrl(env)}#/configuracoes">${appUrl(env)}#/configuracoes</a>.</p>`;

/* lote do cron. deps: { getCustomer, finLoad, computeTax } */
export async function mailCron(env, db, deps, { now = new Date(), force = false } = {}) {
  if (!mailConfigured(env)) return { skipped: "email_desligado" };
  const hBr = (now.getUTCHours() + 21) % 24;                       // hora de Brasília (UTC−3)
  if (!force && (hBr < 7 || hBr > 12)) return { skipped: "fora_da_janela" };
  const day = today(), out = { sent: 0, checked: 0, errors: 0 };
  const users = await kvGet(db, MAIL_USERS_KEY, []);
  let budget = PER_RUN, fallbacks = FALLBACK_PER_RUN;
  const indices = await kvGet(db, "market_indices", null);
  for (const uid of users) {
    if (budget <= 0) break;
    const st = await kvGet(db, "mail_state:" + uid, { day: null, alerted: [] });
    if (st.day === day) continue;
    const pref = await kvGet(db, "notif_prefs:" + uid, null), c = await deps.getCustomer(db, uid);
    if (!c || !pref || !(pref.email_alerts || pref.email_daily)) { await syncMailIndex(db, uid, false); continue; }
    budget--; out.checked++;
    let cache = await kvGet(db, "notif_cache:" + uid, null);
    if (!cache || (Date.now() - Date.parse(cache.at)) / 36e5 > STALE_H) {
      if (fallbacks <= 0) { budget++; out.checked--; continue; }      // fica para a próxima rodada
      fallbacks--;
      const [holdings, tradesAll] = await Promise.all([deps.finLoad(db, uid, "holding"), deps.finLoad(db, uid, "trade")]);
      const trades = tradesAll.filter(t => !t.superseded_by && t.status !== "voided");
      const tp = await kvGet(db, "tax_prefs:" + uid, { prior_losses: {}, paid_darfs: {} });
      const tax = trades.length && trades.length <= FALLBACK_MAX_TRADES ? deps.computeTax(trades, { refDate: day, knownClasses: Object.fromEntries(holdings.filter(h => h.ticker).map(h => [h.ticker, h.asset_class])), priorLosses: tp.prior_losses, paidDarfs: tp.paid_darfs }) : null;
      const items = notifItems({ tax, holdings, ref: day });
      cache = { at: nowIso(), items, dash: null, events: personalEvents({ tax, holdings, refDate: day }), partial: true };
    }
    try {
      if (pref.email_alerts) {
        const fresh = cache.items.filter(i => ["critico", "alto"].includes(i.severity) && !st.alerted.includes(i.id));
        if (fresh.length) { const m = alertsEmail(c.name, fresh, env); await sendMail(env, c.email, m.subject, m.html); out.sent++; st.alerted = [...fresh.map(i => i.id), ...st.alerted].slice(0, 300); }
      }
      if (pref.email_daily) {
        const daily = dailyBriefing({ date: day, dashboard: cache.dash, events: { items: cache.events || [], exposure: [] }, indices });
        const m = dailyEmail(daily, env); await sendMail(env, c.email, m.subject, m.html); out.sent++;
      }
      st.day = day; st.last_at = nowIso(); await kvSet(db, "mail_state:" + uid, st);
    } catch (e) { out.errors++; console.error("e-mail falhou", uid, e.message || e); }
  }
  return out;
}
