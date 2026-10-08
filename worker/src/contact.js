/* Mensagens do formulário "Fale com a AURION" da página inicial.
 * Público e sem login: validação, campo-isca contra robôs, limite por IP (ratelimit.js, grupo "contato")
 * e retenção curta (últimas 300). Só o administrador lê. Nada vai para o CRM de clientes sem ação do administrador. */
import { Problem, Resp, kvGet, kvSet, nowIso, randomToken, str } from "./shared.js";

const TOPICS = { duvida: "Dúvida sobre a plataforma", planos: "Planos e contratação", profissional: "Contador ou assessor", privacidade: "Privacidade e dados (LGPD)", outro: "Outro" };
const KEY = "site_contacts", MAX = 300;
const escHtml = s => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

export async function publicContact(body, req, env, db, { audit, sendMail, mailConfigured, ownerEmail, ownerId }) {
  if (str(body.website, 200).trim()) return new Resp(202, { received: true });   // isca preenchida: robô — responde igual e descarta
  const name = str(body.name, 120).trim(), email = str(body.email, 160).trim().toLowerCase(), message = str(body.message, 2000).trim();
  const topic = TOPICS[body.topic] ? body.topic : "outro";
  const errors = [];
  if (name.length < 2) errors.push({ field: "name", msg: "Informe seu nome." });
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) errors.push({ field: "email", msg: "Informe um e-mail válido." });
  if (message.length < 10) errors.push({ field: "message", msg: "Escreva a mensagem (mínimo de 10 caracteres)." });
  if (errors.length) throw new Problem(422, "Dados inválidos", errors.map(e => e.msg).join(" "), { errors });
  const items = await kvGet(db, KEY, []);
  if (items.filter(x => x.email === email && Date.now() - Date.parse(x.created_at) < 3600e3).length >= 3)
    throw new Problem(429, "Muitas mensagens", "Recebemos suas mensagens. Aguarde a resposta antes de enviar outra.");
  const it = { id: "msg_" + randomToken(9).replace(/[-_]/g, ""), created_at: nowIso(), name, email, topic, topic_label: TOPICS[topic], message, status: "novo" };
  await kvSet(db, KEY, [it, ...items].slice(0, MAX));
  await audit(db, req, { user_id: ownerId, actor: "site", action: "site.contato_recebido", resource: "contact", entity_id: it.id, meta: { assunto: topic } });
  if (mailConfigured(env)) {
    try {
      await sendMail(env, ownerEmail(env), `Nova mensagem do site — ${TOPICS[topic]}`,
        `<p><b>${escHtml(name)}</b> (${escHtml(email)}) escreveu pelo site da AURION:</p><blockquote>${escHtml(message).replace(/\n/g, "<br>")}</blockquote><p>Responda direto para o e-mail acima. A mensagem também está no CRM, em Mensagens do site.</p>`);
    } catch { /* a mensagem fica guardada mesmo sem e-mail */ }
  }
  return new Resp(201, { received: true, id: it.id });
}

export async function adminContacts(m, p, body, db) {
  if (m === "GET" && p === "/v1/admin/contacts") { const items = await kvGet(db, KEY, []); return { items, novos: items.filter(x => x.status === "novo").length }; }
  const mm = p.match(/^\/v1\/admin\/contacts\/(msg_[A-Za-z0-9]+)$/);
  if (mm && m === "PATCH") {
    if (!["novo", "respondido", "arquivado"].includes(body.status)) throw new Problem(422, "Dados inválidos", "Status deve ser novo, respondido ou arquivado.");
    const items = await kvGet(db, KEY, []), it = items.find(x => x.id === mm[1]);
    if (!it) throw new Problem(404, "Mensagem não encontrada", mm[1]);
    it.status = body.status; it.updated_at = nowIso(); await kvSet(db, KEY, items);
    return it;
  }
  if (mm && m === "DELETE") { await kvSet(db, KEY, (await kvGet(db, KEY, [])).filter(x => x.id !== mm[1])); return new Resp(204); }
  return null;
}
