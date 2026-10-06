/* Integrações contratadas: prontas e DESLIGADAS até o segredo ser configurado no painel (ADR-0011/0013).
 * - Voz (TTS): Google Cloud Text-to-Speech (TTS_API_KEY). Sem chave, o app usa a voz do navegador.
 * - Power BI Embedded: client credentials do Azure AD + GenerateToken com RLS por usuário (PBI_*). Sem chave, gráficos próprios.
 * - E-mail de notificações: Resend (RESEND_API_KEY + MAIL_FROM).
 * Nenhuma chave aparece em resposta, log ou front-end. */
import { Problem, kvGet, kvSet, nowIso, today, str } from "./shared.js";
import { audit, mailConfigured, sendMail } from "./identity.js";
import { syncMailIndex } from "./mailer.js";

export const ttsConfigured = env => !!env.TTS_API_KEY;
export const pbiConfigured = env => !!(env.PBI_TENANT_ID && env.PBI_CLIENT_ID && env.PBI_CLIENT_SECRET && env.PBI_WORKSPACE_ID && env.PBI_REPORT_ID);
const TTS_DAILY_LIMIT = 20;

export function integrationsStatus(env) {
  return { items: [
    { id: "voz", name: "Voz neural (TTS)", configured: ttsConfigured(env), fallback: "voz do navegador (gratuita)", secrets: ["TTS_API_KEY"] },
    { id: "powerbi", name: "Power BI Embedded", configured: pbiConfigured(env), fallback: "gráficos próprios do AURION", secrets: ["PBI_TENANT_ID", "PBI_CLIENT_ID", "PBI_CLIENT_SECRET", "PBI_WORKSPACE_ID", "PBI_REPORT_ID", "PBI_DATASET_ID"] },
    { id: "email", name: "E-mail transacional (Resend)", configured: mailConfigured(env), fallback: "sem e-mail; avisos ficam no app", secrets: ["RESEND_API_KEY", "MAIL_FROM"] },
    { id: "openfinance", name: "Open Finance (Pluggy)", configured: !!(env.PLUGGY_CLIENT_ID && env.PLUGGY_CLIENT_SECRET), fallback: "importação de arquivos", secrets: ["PLUGGY_CLIENT_ID", "PLUGGY_CLIENT_SECRET"] },
    { id: "pagamentos", name: "Pagamentos (Asaas)", configured: !!env.ASAAS_API_KEY, fallback: "planos sem cobrança automática", secrets: ["ASAAS_API_KEY", "ASAAS_WEBHOOK_TOKEN"] },
    { id: "noticias_licenciadas", name: "Notícias licenciadas", configured: !!env.NEWS_API_KEY, fallback: "RSS públicos oficiais", secrets: ["NEWS_API_KEY"] },
  ], note: "Segredos são cadastrados só no painel do Cloudflare (Workers → Settings → Variables and Secrets)." };
}

export async function integrationsRoute(m, p, body, req, u, db, env) {
  const uid = u.me.id;
  if (p === "/v1/integrations" && m === "GET") { const st = integrationsStatus(env);
    return u.owner ? st : { items: st.items.filter(i => ["voz", "powerbi", "email"].includes(i.id)).map(({ secrets, ...i }) => i) }; }

  /* ---- voz neural */
  if (p === "/v1/voice/tts" && m === "POST") {
    if (!ttsConfigured(env)) throw new Problem(503, "Voz neural não configurada", "Use a voz do navegador. A voz neural é ativada quando a chave do provedor é cadastrada.", { fallback: "browser" });
    const text = str(body.text, 4800).trim();
    if (!text) throw new Problem(422, "Dados inválidos", "Texto vazio.");
    const key = `tts_use:${uid}:${today()}`, used = await kvGet(db, key, 0);
    if (used >= TTS_DAILY_LIMIT) throw new Problem(429, "Limite diário", "Limite diário de narrações atingido. A voz do navegador continua disponível.", { fallback: "browser" });
    const r = await fetch((env.TTS_BASE_URL || "https://texttospeech.googleapis.com") + "/v1/text:synthesize", { method: "POST", signal: AbortSignal.timeout(15000),
      headers: { "Content-Type": "application/json", "X-Goog-Api-Key": env.TTS_API_KEY },
      body: JSON.stringify({ input: { text }, voice: { languageCode: "pt-BR", name: env.TTS_VOICE || "pt-BR-Neural2-B" }, audioConfig: { audioEncoding: "MP3", speakingRate: 1.0 } }) });
    if (!r.ok) throw new Problem(502, "Falha no provedor de voz", `O provedor respondeu HTTP ${r.status}. Use a voz do navegador.`, { fallback: "browser" });
    const j = await r.json();
    await kvSet(db, key, used + 1);
    return { mime: "audio/mpeg", audio_base64: j.audioContent, provider: "google-tts", voice: env.TTS_VOICE || "pt-BR-Neural2-B" };
  }

  /* ---- Power BI Embedded (RLS: o usuário só vê os próprios dados) */
  if (p === "/v1/analytics/embed" && m === "GET") {
    if (!u.me.entitlements?.includes?.("inteligencia_tributaria") && !u.owner) throw new Problem(402, "Recurso do plano Pro", "Painéis avançados fazem parte dos planos Pro e Premium.", { required_plan: "Pro" });
    if (!pbiConfigured(env)) return { configured: false, fallback: "native", note: "Power BI Embedded ainda não contratado; o AURION mostra os gráficos próprios." };
    const login = env.PBI_LOGIN_URL || "https://login.microsoftonline.com", api = env.PBI_API_URL || "https://api.powerbi.com";
    const tk = await fetch(`${login}/${encodeURIComponent(env.PBI_TENANT_ID)}/oauth2/v2.0/token`, { method: "POST", signal: AbortSignal.timeout(10000),
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "client_credentials", client_id: env.PBI_CLIENT_ID, client_secret: env.PBI_CLIENT_SECRET, scope: "https://analysis.windows.net/powerbi/api/.default" }) });
    if (!tk.ok) throw new Problem(502, "Falha ao autenticar no Power BI", `HTTP ${tk.status}`);
    const access = (await tk.json()).access_token;
    const base = `${api}/v1.0/myorg/groups/${encodeURIComponent(env.PBI_WORKSPACE_ID)}/reports/${encodeURIComponent(env.PBI_REPORT_ID)}`;
    const rep = await fetch(base, { headers: { Authorization: "Bearer " + access }, signal: AbortSignal.timeout(10000) });
    if (!rep.ok) throw new Problem(502, "Relatório indisponível", `HTTP ${rep.status}`);
    const report = await rep.json();
    const gen = await fetch(base + "/GenerateToken", { method: "POST", signal: AbortSignal.timeout(10000), headers: { Authorization: "Bearer " + access, "Content-Type": "application/json" },
      body: JSON.stringify({ accessLevel: "View", identities: [{ username: uid, roles: [env.PBI_RLS_ROLE || "Cliente"], datasets: [env.PBI_DATASET_ID || report.datasetId] }] }) });
    if (!gen.ok) throw new Problem(502, "Falha ao gerar token de visualização", `HTTP ${gen.status}`);
    const g = await gen.json();
    await audit(db, req, { user_id: uid, actor: u.actor?.id || uid, action: "analytics.embed", entity_id: env.PBI_REPORT_ID });
    return { configured: true, report_id: report.id, embed_url: report.embedUrl, token: g.token, expires_at: g.expiration, rls_user: uid, access: "View" };
  }

  /* ---- preferências de notificação + e-mail de teste */
  if (p === "/v1/notifications/preferences") {
    const key = "notif_prefs:" + uid, cur = await kvGet(db, key, { email_alerts: false, email_daily: false, in_app: true });
    if (m === "GET") return { ...cur, email_enabled: mailConfigured(env) };
    if (m === "PUT") {
      const next = { email_alerts: !!body.email_alerts, email_daily: !!body.email_daily, in_app: true, updated_at: nowIso() };
      await kvSet(db, key, next); await syncMailIndex(db, uid, next.email_alerts || next.email_daily); await audit(db, req, { user_id: uid, actor: uid, action: "notificacoes.preferencias", meta: next });
      return { ...next, email_enabled: mailConfigured(env) };
    }
  }
  if (p === "/v1/notifications/test-email" && m === "POST") {
    if (!mailConfigured(env)) throw new Problem(503, "E-mail não configurado", "O envio de e-mails é ativado quando o provedor é configurado. Os avisos continuam no app.");
    await sendMail(env, u.me.email, "AURION — teste de notificação", `<p>Olá, ${u.me.name.split(" ")[0]}.</p><p>Este é um e-mail de teste das notificações do AURION.</p>`);
    return { sent: true, to: u.me.email };
  }
  throw new Problem(404, "Não encontrado", p);
}
