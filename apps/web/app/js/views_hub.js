/* Notícias + AURION Daily (texto e voz), central de notificações, compartilhamento com profissional,
 * modo profissional (leitura delegada) e painel Power BI (desligado sem contrato). */
import { registerTour } from "./tour.js";
import { stepsNoticias, TOUR_PAGINAS2_VERSAO } from "./tour_paginas2.js";
import { api, ApiError, HAS_API, actAs } from "./api.js";
import { dt, dtm, empty, esc, toast } from "./ui.js";
import { loadDisclosures } from "./views_public.js";
import { dailyBriefing, personalizeNews } from "./daily_engine.js";

const msg = e => e instanceof ApiError ? (e.problem.detail || e.problem.title) : String(e.message || e);
const today = () => new Date(Date.now() - 3 * 3600e3).toISOString().slice(0, 10);
async function loadNews() {
  const r = await fetch(new URL("../data/public/news.json", import.meta.url), { cache: "no-cache" }).catch(() => null);
  return r && r.ok ? r.json() : { generated_at: null, sources: [], items: [] };
}
const CLASS_OF = { acao: "acao", fii: "fii", etf: "etf", bdr: "bdr", tesouro: "tesouro", renda_fixa: "renda_fixa", fundo: "fundo", previdencia: "previdencia", cripto: "cripto" };

/* ------------------------------------------------------------------ voz: navegador (grátis) ou neural (se contratada) */
let speaking = null;
function stopVoice() { try { speechSynthesis.cancel(); } catch {} if (speaking?.pause) speaking.pause(); speaking = null; }
async function speak(text, btn) {
  if (speaking || (window.speechSynthesis && speechSynthesis.speaking)) { stopVoice(); btn.textContent = "Ouvir o Daily"; return; }
  btn.textContent = "Parar";
  const st = await api.get("/v1/integrations").catch(() => ({ items: [] }));
  if (st.items.some(i => i.id === "voz" && i.configured)) {
    try { const a = await api.post("/v1/voice/tts", { text }); const au = new Audio(`data:${a.mime};base64,${a.audio_base64}`); speaking = au; au.onended = () => { speaking = null; btn.textContent = "Ouvir o Daily"; }; await au.play(); return; }
    catch (x) { toast("Voz neural indisponível; usando a voz do navegador."); }
  }
  if (!window.speechSynthesis) { toast("Seu navegador não tem leitura em voz alta."); btn.textContent = "Ouvir o Daily"; return; }
  const u = new SpeechSynthesisUtterance(text); u.lang = "pt-BR"; u.rate = 1.02;
  const v = speechSynthesis.getVoices().find(x => /pt(-|_)BR/i.test(x.lang)); if (v) u.voice = v;
  u.onend = () => { btn.textContent = "Ouvir o Daily"; }; speechSynthesis.speak(u);
}

/* ------------------------------------------------------------------ Notícias + Daily */
export async function news(el) {
  if (!HAS_API) { el.innerHTML = `<section class="card">${empty("Notícias e o AURION Daily funcionam com a sua conta no site oficial.")}</section>`; return; }
  const [nw, disc, ev, dash, idx, port] = await Promise.all([loadNews(), loadDisclosures(), api.get("/v1/events").catch(() => ({ items: [], exposure: [] })),
    api.get("/v1/dashboard").catch(() => null), api.get("/v1/market/indices").catch(() => null), api.get("/v1/portfolio/consolidated").catch(() => null)]);
  const classes = [...new Set((port?.positions || port?.items || []).map(p => CLASS_OF[p.asset_class]).filter(Boolean))];
  const dashboard = dash && !dash.sample ? dash : null;
  const daily = dailyBriefing({ date: today(), dashboard, events: ev, indices: idx?.indices || null, news: nw.items, disclosures: disc.items, classes });
  const ranked = personalizeNews(nw.items, { exposure: ev.exposure || [], classes });
  let mode = "voce";
  const draw = () => {
    const list = (mode === "voce" ? ranked.filter(n => n.relevance > 0) : ranked).slice(0, 80);
    el.querySelector("#nl").innerHTML = list.length ? `<ul class="stack">${list.map(n => `<li style="border-bottom:1px solid var(--line);padding-bottom:8px">
        <a href="${esc(n.url)}" target="_blank" rel="noopener"><b>${esc(n.title)}</b></a>
        <div class="small muted">${esc(n.source)}${n.published_at ? " · " + dtm(n.published_at) : ""}${n.why ? ` · <span class="pill">${esc(n.why)}</span>` : ""}</div></li>`).join("")}</ul>`
      : empty(mode === "voce" ? "Nenhuma notícia ligada aos seus ativos ou temas agora. Veja todas." : "As fontes ainda não foram coletadas.");
  };
  el.innerHTML = `
    <section class="card" data-tour="news-daily">
      <div class="row wrap" style="gap:10px;justify-content:space-between;align-items:center"><h3>AURION Daily · ${dt(daily.date)}</h3>
        <button class="btn btn--primary btn--sm" id="say" data-tour="news-ouvir">Ouvir o Daily</button></div>
      <p style="margin-top:8px">${esc(daily.opening)}</p>
      <ul class="stack" style="margin-top:10px">${daily.sections.map(s => `<li><b>${esc(s.title)}.</b> ${esc(s.text)}</li>`).join("")}</ul>
      <p class="note">${esc(daily.disclaimer)} Gerado sem IA generativa (${esc(daily.version)}): os mesmos dados produzem o mesmo texto.</p>
    </section>
    <section class="card section" data-tour="news-lista">
      <div class="row wrap" style="gap:10px;justify-content:space-between;align-items:center"><h3>Notícias</h3>
        <div class="tabs" role="tablist" data-tour="news-filtro"><button role="tab" class="btn btn--sm" data-m="voce" aria-selected="true">Para você</button> <button role="tab" class="btn btn--ghost btn--sm" data-m="todas" aria-selected="false">Todas</button></div></div>
      <div id="nl" class="section"></div>
      <p class="note" data-tour="news-fontes">Fontes públicas: ${nw.sources.length ? Object.entries(nw.sources.reduce((g, s) => { g[s.name] = g[s.name] === "ok" || s.status === "ok" ? "ok" : (g[s.name] || s.status); return g; }, {})).map(([n, st]) => `${esc(n)}${st === "ok" ? "" : st === "desatualizado" ? " (sem publicações recentes no feed)" : " (indisponível na última coleta)"}`).join("; ") : "aguardando a primeira coleta"}. ${nw.generated_at ? "Atualizado em " + dtm(nw.generated_at) + "." : ""} Mostramos só título e link; o conteúdo é da fonte. A seleção “Para você” usa seus ativos e temas no próprio aparelho.</p>
    </section>`;
  el.querySelector("#say").onclick = e => speak(daily.voice_script, e.target);
  el.querySelectorAll("[data-m]").forEach(b => b.onclick = () => { mode = b.dataset.m; el.querySelectorAll("[data-m]").forEach(x => { x.setAttribute("aria-selected", x === b); x.className = "btn btn--sm" + (x === b ? "" : " btn--ghost"); }); draw(); });
  draw();
  window.addEventListener("hashchange", stopVoice, { once: true });
  registerTour("noticias", TOUR_PAGINAS2_VERSAO, stepsNoticias(), { daily, ranked, sources: nw.sources }, { autostart: /[?&]tour=1/.test(location.hash) });
}

/* ------------------------------------------------------------------ central de notificações */
export async function notifications(el) {
  if (!HAS_API) { location.hash = "#/alertas"; return; }
  const n = await api.get("/v1/notifications");
  el.innerHTML = `<section class="card"><div class="row wrap" style="justify-content:space-between;gap:10px"><h3>Notificações</h3>${n.unread ? `<button class="btn btn--ghost btn--sm" id="all">Marcar todas como lidas</button>` : ""}</div>
    ${n.items.length ? `<ul class="stack section">${n.items.map(i => `<li class="row wrap" style="gap:10px;align-items:flex-start;${i.read ? "opacity:.65" : ""}">
        <span class="pill">${esc(i.severity === "critico" ? "Crítico" : i.severity === "alto" ? "Alto" : "Prazo")}</span>
        <div style="flex:1;min-width:200px"><b>${esc(i.title)}</b>${i.detail ? `<div class="small">${esc(i.detail)}</div>` : ""}<div class="small muted">${dt(i.at)}${i.link ? ` · <a href="${esc(i.link)}">abrir</a>` : ""}</div></div></li>`).join("")}</ul>`
      : empty("Nada novo. Alertas importantes e prazos dos próximos 7 dias aparecem aqui.")}
    <p class="note">Preferências de e-mail em Configurações.</p></section>`;
  const all = el.querySelector("#all");
  if (all) all.onclick = async () => { await api.post("/v1/notifications/read", { ids: n.items.map(i => i.id) }); notifications(el); document.dispatchEvent(new Event("aurion:notif")); };
}

/* ------------------------------------------------------------------ Configurações: notificações, compartilhamento, modo profissional, integrações */
export async function settingsExtras(el, me) {
  if (!HAS_API) return;
  if (me.acting) { el.innerHTML = ""; return; }
  const [pref, grants, clients, integ] = await Promise.all([api.get("/v1/notifications/preferences").catch(() => null), api.get("/v1/sharing/grants").catch(() => ({ items: [] })),
    api.get("/v1/sharing/clients").catch(() => ({ items: [] })), api.get("/v1/integrations").catch(() => ({ items: [] }))]);
  el.innerHTML = `<div class="grid g-2 section">
    <section class="card" data-tour="cfg-email"><h3>Notificações por e-mail</h3>
      ${pref ? `<label class="check" style="margin-top:10px"><input type="checkbox" id="ea" ${pref.email_alerts ? "checked" : ""}> Alertas críticos e altos</label>
      <label class="check" style="margin-top:8px"><input type="checkbox" id="ed" ${pref.email_daily ? "checked" : ""}> AURION Daily por e-mail</label>
      <div class="row wrap" style="gap:8px;margin-top:10px"><button class="btn btn--primary btn--sm" id="sp">Salvar</button>${pref.email_enabled ? `<button class="btn btn--ghost btn--sm" id="te">Enviar e-mail de teste</button>` : ""}</div>
      <p class="note">${pref.email_enabled ? "Envio automático ativo: no máximo um e-mail de cada tipo por dia, de manhã (horário de Brasília)." : "O envio de e-mails será ativado pelo AURION; suas escolhas ficam salvas."} No app, os avisos já aparecem no sino.</p>` : `<p class="small muted">Indisponível.</p>`}</section>
    <section class="card" data-tour="cfg-compartilhar"><h3>Compartilhar com meu contador ou assessor</h3>
      <p class="small muted" style="margin-top:6px">Acesso <b>somente leitura</b> a finanças, patrimônio, tributação e Trader. Sem acesso a senha, segurança, documentos pessoais ou pagamentos. Cada consulta fica na sua auditoria.</p>
      <form id="gf" class="row wrap" style="gap:8px;margin-top:10px"><input class="input" id="ge" type="email" required placeholder="E-mail do profissional" aria-label="E-mail do profissional" style="max-width:260px">
        <select class="input" id="gd" aria-label="Validade" style="max-width:150px"><option value="30">30 dias</option><option value="90" selected>90 dias</option><option value="365">1 ano</option></select>
        <button class="btn btn--primary btn--sm">Conceder</button></form>
      <ul class="stack small section">${grants.items.map(g => `<li class="row wrap" style="gap:8px;justify-content:space-between"><span><b>${esc(g.professional_email)}</b> · ${g.active ? "ativo até " + dt(g.expires_at) : g.revoked_at ? "revogado em " + dt(g.revoked_at) : "expirado"}</span>${g.active ? `<button class="btn btn--ghost btn--sm" data-rv="${esc(g.id)}">Revogar</button>` : ""}</li>`).join("") || "<li class='muted'>Nenhum compartilhamento.</li>"}</ul></section>
    ${clients.items.length ? `<section class="card"><h3>Clientes que compartilharam com você</h3><ul class="stack small" style="margin-top:10px">${clients.items.map(c => `<li class="row wrap" style="gap:8px;justify-content:space-between"><span><b>${esc(c.name)}</b> · até ${dt(c.expires_at)}</span><button class="btn btn--primary btn--sm" data-as="${esc(c.client_id)}" data-name="${esc(c.name)}">Ver (somente leitura)</button></li>`).join("")}</ul><p class="note">${esc(clients.note)}</p></section>` : ""}
    <section class="card" data-tour="cfg-integracoes"><h3>Integrações</h3><ul class="stack small" style="margin-top:10px">${integ.items.map(i => `<li><b>${esc(i.name)}</b> · ${i.configured ? '<span class="pos">ativa</span>' : `não contratada — usando ${esc(i.fallback)}`}</li>`).join("")}</ul></section>
  </div>`;
  const q = s => el.querySelector(s);
  if (q("#sp")) q("#sp").onclick = async () => { try { await api.put("/v1/notifications/preferences", { email_alerts: q("#ea").checked, email_daily: q("#ed").checked }); toast("Preferências salvas."); } catch (x) { toast(msg(x)); } };
  if (q("#te")) q("#te").onclick = async () => { try { const r = await api.post("/v1/notifications/test-email", {}); toast("E-mail de teste enviado para " + r.to); } catch (x) { toast(msg(x)); } };
  q("#gf").onsubmit = async e => { e.preventDefault(); try { await api.post("/v1/sharing/grants", { email: q("#ge").value, expires_days: +q("#gd").value }); toast("Acesso concedido."); settingsExtras(el, me); } catch (x) { toast(msg(x)); } };
  el.querySelectorAll("[data-rv]").forEach(b => b.onclick = async () => { if (b.dataset.armed !== "1") { b.dataset.armed = "1"; b.textContent = "Confirmar"; return; } try { await api.del(`/v1/sharing/grants/${b.dataset.rv}`); toast("Acesso revogado."); settingsExtras(el, me); } catch (x) { toast(msg(x)); } });
  el.querySelectorAll("[data-as]").forEach(b => b.onclick = () => { actAs.set(b.dataset.as, b.dataset.name); location.hash = "#/dashboard"; location.reload(); });
}

/* ------------------------------------------------------------------ Power BI Embedded (só quando contratado) */
const PBI_URL = "https://cdn.jsdelivr.net/npm/powerbi-client@2.23.1/dist/powerbi.min.js";
export async function analyticsEmbed(el) {
  if (!HAS_API) return;
  const e = await api.get("/v1/analytics/embed").catch(() => null);
  if (!e?.configured) { el.innerHTML = ""; return; }
  el.innerHTML = `<section class="card section"><h3>Painéis avançados (Power BI)</h3><div id="pbi" style="height:560px;margin-top:10px"></div><p class="note">Você vê somente os seus dados (segurança por linha). Token válido até ${dtm(e.expires_at)}.</p></section>`;
  await new Promise((ok, ko) => { if (window.powerbi) return ok(); const s = document.createElement("script"); s.src = PBI_URL; s.onload = ok; s.onerror = ko; document.head.appendChild(s); });
  const models = window["powerbi-client"].models;
  window.powerbi.embed(el.querySelector("#pbi"), { type: "report", id: e.report_id, embedUrl: e.embed_url, accessToken: e.token, tokenType: models.TokenType.Embed, settings: { panes: { filters: { visible: false } } } });
}
