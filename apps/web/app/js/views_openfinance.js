/* Conexões automáticas (Open Finance via Pluggy). O cliente autoriza no widget do agregador, dentro do
 * ambiente da própria instituição; a plataforma nunca vê a senha do banco. */
import { api, ApiError } from "./api.js";
import { dtm, esc, icon, toast, empty } from "./ui.js";

const msg = e => e instanceof ApiError ? (e.problem.detail || e.problem.title) : String(e.message || e);
const BADGE = { ativo: ["pago", "Sincronizado"], sincronizando: ["classificado", "Sincronizando"], erro: ["vencido", "Erro"], acao: ["aberto", "Ação necessária"],
  desatualizado: ["aberto", "Desatualizado"], desconhecido: ["classificado", "—"] };
const badge = (k, l) => `<span class="badge b-${esc(k)}">${esc(l)}</span>`;

function loadWidget(src) {
  return new Promise((ok, fail) => {
    if (window.PluggyConnect) return ok(window.PluggyConnect);
    const s = document.createElement("script"); s.src = src; s.async = true;
    s.onload = () => window.PluggyConnect ? ok(window.PluggyConnect) : fail(new Error("Widget de conexão indisponível."));
    s.onerror = () => fail(new Error("Não foi possível carregar o widget de conexão. Verifique sua internet ou bloqueadores."));
    document.head.appendChild(s);
  });
}

export async function connectionsReal(el) {
  const st = await api.get("/v1/openfinance");
  const trustLine = `<div class="trust-line" style="margin-top:16px">${icon("shield")}<span>Nunca pedimos nem guardamos a senha do seu banco. A autorização acontece no ambiente da instituição, pelo Open Finance regulado pelo Banco Central, e você pode desconectar quando quiser.</span></div>`;
  if (!st.configured) {
    el.innerHTML = `<section class="card" style="max-width:760px"><h3>${icon("link")} Conexão automática com bancos e corretoras</h3>
      <p class="small" style="margin-top:8px">Em breve você poderá conectar suas contas pelo <b>Open Finance</b> e manter extratos, cartões e investimentos atualizados todos os dias, sem enviar arquivos.</p>
      <p class="small muted" style="margin-top:8px">Enquanto a conexão automática é ativada, envie seus extratos (OFX/CSV) e os relatórios da B3 — os painéis, o imposto, os alertas e o simulador já funcionam com eles.</p>
      <a class="btn btn--primary" style="margin-top:14px" href="#/importar">Importar dados</a>${trustLine}</section>`;
    return;
  }
  const items = st.items || [];
  el.innerHTML = `
    <div class="row between wrap" style="margin-bottom:14px;gap:12px"><p class="muted small" style="max-width:720px">Conecte bancos, cartões e corretoras pelo Open Finance. Os dados chegam no mesmo formato das importações e alimentam patrimônio, finanças, imposto e alertas. Atualização automática diária.</p>
      <button class="btn btn--primary" id="add">+ Conectar banco ou corretora</button></div>
    <p class="err" id="oferr" role="alert"></p>
    <div class="grid g-3">${items.map(c => { const [k, l] = BADGE[c.state] || BADGE.desconhecido; return `<article class="card">
      <h3 style="display:flex;gap:10px;align-items:center">${c.logo ? `<img src="${esc(c.logo)}" alt="" width="28" height="28" style="border-radius:6px" onerror="this.remove()">` : icon("link")} ${esc(c.institution)} <span class="right">${badge(k, l)}</span></h3>
      <ul class="stack small" style="margin-top:12px">
        <li><b>Situação:</b> ${esc(c.label || "—")}${c.error ? ` · <span class="neg">${esc(c.error)}</span>` : ""}</li>
        <li><b>Última sincronização:</b> ${c.last_sync_at ? dtm(c.last_sync_at) : "aguardando a instituição"}</li>
        ${c.counts ? `<li><b>Dados:</b> ${c.counts.accounts || 0} conta(s) · ${c.counts.transactions || 0} lançamentos · ${c.counts.holdings || 0} investimentos</li>` : ""}</ul>
      <div class="row wrap" style="gap:8px;margin-top:14px">
        <button class="btn btn--ghost btn--sm" data-sync="${esc(c.id)}">Atualizar agora</button>
        ${["erro", "acao", "desatualizado"].includes(c.state) ? `<button class="btn btn--primary btn--sm" data-reconnect="${esc(c.id)}">Reconectar</button>` : ""}
        <button class="btn btn--danger btn--sm" data-del="${esc(c.id)}">Desconectar</button></div></article>`; }).join("") || empty("Nenhuma instituição conectada ainda.", "link")}</div>
    ${trustLine}`;
  const err = el.querySelector("#oferr");
  async function openWidget(itemId) {
    err.textContent = "";
    try {
      const tk = await api.post("/v1/openfinance/connect-token", itemId ? { item_id: itemId } : {});
      const PluggyConnect = await loadWidget(tk.widget_url);
      const w = new PluggyConnect({ connectToken: tk.access_token, includeSandbox: !!tk.sandbox, ...(itemId ? { updateItem: itemId } : {}),
        onSuccess: async data => {
          try { const r = await api.post("/v1/openfinance/items", { item_id: data.item.id });
            toast(r.synced ? `${r.institution} conectado: ${r.counts.transactions} lançamentos e ${r.counts.holdings} investimentos.` : `${r.institution} conectado. Os dados chegam em alguns minutos.`); }
          catch (x) { toast(msg(x)); }
          connectionsReal(el);
        },
        onError: e => { err.textContent = e?.message || "A conexão não foi concluída."; } });
      w.init();
    } catch (x) { err.textContent = msg(x); }
  }
  el.querySelector("#add").onclick = () => openWidget();
  el.querySelectorAll("[data-reconnect]").forEach(b => b.onclick = () => openWidget(b.dataset.reconnect));
  el.querySelectorAll("[data-sync]").forEach(b => b.onclick = async () => {
    b.disabled = true; b.textContent = "Atualizando…";
    try { const r = await api.post(`/v1/openfinance/items/${b.dataset.sync}/sync`); toast(r.synced ? `${r.institution} atualizado.` : `${r.institution}: ${r.label}.`); connectionsReal(el); }
    catch (x) { toast(msg(x)); b.disabled = false; b.textContent = "Atualizar agora"; }
  });
  el.querySelectorAll("[data-del]").forEach(b => b.onclick = async () => {
    if (b.dataset.armed !== "1") { b.dataset.armed = "1"; b.textContent = "Confirmar: apagar dados desta conexão"; return; }
    b.disabled = true;
    try { await api.del(`/v1/openfinance/items/${b.dataset.del}`); toast("Instituição desconectada e dados removidos."); connectionsReal(el); }
    catch (x) { toast(msg(x)); b.disabled = false; }
  });
}
