/* Professional Hub: o cliente concede acesso SOMENTE LEITURA ao seu contador/assessor (por e-mail).
 * O profissional entra com a própria conta e envia X-Act-As: <id do cliente>. Cada leitura fica na trilha de
 * auditoria do cliente. Sem escrita, sem segurança/privacidade/pagamentos em nome do cliente. Revogável a qualquer momento. */
import { Problem, kvGet, kvSet, nowIso, randomToken, str } from "./shared.js";
import { audit } from "./identity.js";

const READ_PATHS = /^\/v1\/(dashboard|finance\/(summary|transactions|categories)|portfolio\/consolidated|allocation|data-quality|tax\/(summary|events|calculations|rules|darfs|settings|irpf-report)|alerts|events|trader\/(overview|trades|performance|tax|risk|journal|strategies|watchlists|market)|me)(\/|\?|$)/;
const MAX_DAYS = 365;

const active = g => !g.revoked_at && (!g.expires_at || g.expires_at > nowIso());

/* chamada pelo authUser quando há X-Act-As */
export async function actAs(db, req, u, clientId, { getCustomer, meFromCustomer }) {
  const path = new URL(req.url).pathname;
  if (u.owner) throw new Problem(403, "Acesso negado", "O administrador não usa acesso delegado.");
  if (req.method !== "GET") throw new Problem(403, "Somente leitura", "O acesso concedido pelo cliente é somente leitura.");
  if (!READ_PATHS.test(path)) throw new Problem(403, "Fora do escopo", "Esta área não faz parte do acesso concedido pelo cliente.");
  const grants = await kvGet(db, "grants:" + clientId, []);
  const g = grants.find(x => active(x) && x.professional_email === u.me.email.toLowerCase());
  if (!g) throw new Problem(403, "Acesso não concedido", "Este cliente não concedeu acesso à sua conta ou o acesso foi revogado.");
  const c = await getCustomer(db, clientId);
  if (!c) throw new Problem(403, "Acesso não concedido", "Cliente não encontrado.");
  await audit(db, req, { user_id: clientId, actor: u.me.id, action: "profissional.leitura", resource: path, entity_id: g.id, meta: { professional_email: u.me.email } });
  const me = meFromCustomer(c);
  return { owner: false, sid: u.sid, c, me: { ...me, acting: { professional_id: u.me.id, professional_name: u.me.name, grant_id: g.id, scope: "leitura" } }, actor: u.me };
}

export async function sharingRoute(m, p, body, req, u, db, getCustomer) {
  const uid = u.me.id;
  if (u.me.acting) throw new Problem(403, "Somente leitura", "Gerencie compartilhamentos com a sua própria conta.");
  if (p === "/v1/sharing/grants" && m === "GET") return { items: (await kvGet(db, "grants:" + uid, [])).map(g => ({ ...g, active: active(g) })) };
  if (p === "/v1/sharing/grants" && m === "POST") {
    const email = str(body.email, 160).trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Problem(422, "Dados inválidos", "Informe o e-mail do profissional.");
    if (email === u.me.email.toLowerCase()) throw new Problem(422, "Dados inválidos", "Informe o e-mail de outra pessoa.");
    const days = Math.min(Math.max(+body.expires_days || 90, 1), MAX_DAYS);
    const grants = await kvGet(db, "grants:" + uid, []);
    if (grants.some(g => active(g) && g.professional_email === email)) throw new Problem(409, "Conflito", "Este profissional já tem acesso ativo.");
    const g = { id: "grt_" + randomToken(9).replace(/[-_]/g, ""), professional_email: email, role: str(body.role, 40) || "contador", scope: "leitura",
      created_at: nowIso(), expires_at: new Date(Date.now() + days * 864e5).toISOString(), revoked_at: null };
    grants.unshift(g); await kvSet(db, "grants:" + uid, grants.slice(0, 20));
    const idx = await kvGet(db, "pro_idx:" + email, []); if (!idx.includes(uid)) { idx.push(uid); await kvSet(db, "pro_idx:" + email, idx.slice(-500)); }
    await audit(db, req, { user_id: uid, actor: uid, action: "compartilhamento.concedido", entity_id: g.id, meta: { professional_email: email, expires_at: g.expires_at } });
    return { ...g, active: true, note: "O profissional precisa ter conta no AURION com este e-mail. O acesso é somente leitura e pode ser revogado a qualquer momento." };
  }
  const mDel = p.match(/^\/v1\/sharing\/grants\/(grt_[A-Za-z0-9]+)$/);
  if (mDel && m === "DELETE") {
    const grants = await kvGet(db, "grants:" + uid, []), g = grants.find(x => x.id === mDel[1]);
    if (!g) throw new Problem(404, "Não encontrado", "Compartilhamento não encontrado.");
    if (!g.revoked_at) { g.revoked_at = nowIso(); await kvSet(db, "grants:" + uid, grants); await audit(db, req, { user_id: uid, actor: uid, action: "compartilhamento.revogado", entity_id: g.id }); }
    return { ...g, active: false };
  }
  if (p === "/v1/sharing/clients" && m === "GET") {
    const email = u.me.email.toLowerCase(), out = [];
    for (const cid of await kvGet(db, "pro_idx:" + email, [])) {
      const g = (await kvGet(db, "grants:" + cid, [])).find(x => active(x) && x.professional_email === email);
      if (!g) continue;
      const c = await getCustomer(db, cid);
      if (c) out.push({ client_id: c.id, name: c.name, email: c.email, grant_id: g.id, scope: g.scope, expires_at: g.expires_at });
    }
    return { items: out, note: "Acesso somente leitura concedido pelos próprios clientes. Cada consulta fica registrada na auditoria do cliente." };
  }
  throw new Problem(404, "Não encontrado", p);
}
