/* Pagamentos — visão geral de TODAS as cobranças (Asaas + registros manuais), área do dono/administrador. */
import { api, DEMO } from "./api.js";
import { brl, dt, dtm, empty, esc, icon, toast } from "./ui.js";
import { PAY_METHOD, PAY_STATUS } from "./crm_rules.js";

const ST_LABEL = Object.fromEntries(PAY_STATUS);
const stBadge = s => `<span class="badge b-${s === "pago" ? "pago" : s === "pendente" ? "pendente" : "erro"}">${esc(ST_LABEL[s] || s)}</span>`;
const problemMsg = e => e?.problem ? (e.problem.detail || e.problem.title) : String(e?.message || e);

export async function payments(el) {
  const today = new Date().toISOString().slice(0, 10);
  const f = { q: "", status: "", method: "", origin: "", date_from: "", date_to: "" };
  el.innerHTML = `
    <section class="card" id="gw"><div class="skeleton" style="height:70px"></div></section>
    <div class="grid crm-kpis section" id="kp"></div>
    <section class="card section">
      <form id="pf" class="row wrap" style="gap:10px" role="search">
        <label class="sr-only" for="pq">Buscar</label><input class="input" id="pq" style="flex:1;min-width:200px" placeholder="Buscar por cliente, e-mail ou id da cobrança">
        <label class="sr-only" for="ps">Status</label><select class="input" id="ps" style="width:auto"><option value="">Todos os status</option>${PAY_STATUS.map(([k, l]) => `<option value="${k}">${l}</option>`).join("")}</select>
        <label class="sr-only" for="pm">Forma</label><select class="input" id="pm" style="width:auto"><option value="">Todas as formas</option>${Object.entries(PAY_METHOD).map(([k, l]) => `<option value="${k}">${l}</option>`).join("")}</select>
        <label class="sr-only" for="po">Origem</label><select class="input" id="po" style="width:auto"><option value="">Todas as origens</option><option value="asaas">Asaas</option><option value="manual">Manual</option><option value="sem_vinculo">Sem vínculo com cliente</option></select>
        <label class="small muted" for="pd1">De</label><input class="input" id="pd1" type="date" style="width:auto">
        <label class="small muted" for="pd2">Até</label><input class="input" id="pd2" type="date" style="width:auto">
        <button class="btn btn--ghost" type="button" id="pcsv">${icon("doc")} Exportar CSV</button>
      </form>
      <div id="plist" style="margin-top:12px"></div>
    </section>
    <p class="note">Fonte: cobranças do Asaas (recebidas pelo webhook em tempo real e conferidas por sincronização automática) e pagamentos registrados manualmente no CRM. “Sem vínculo” = cobrança feita no Asaas para alguém que não tem conta na plataforma — nada fica de fora. Valor líquido = após a taxa do Asaas.</p>`;

  async function loadGateway(live = false) {
    const box = el.querySelector("#gw");
    let g;
    try { g = await api.get("/v1/admin/payments/gateway" + (live ? "?live=true" : "")); } catch (e) { box.innerHTML = `<p class="err">${esc(problemMsg(e))}</p>`; return; }
    const conn = g.demo ? '<span class="badge b-pendente">Demonstração</span>'
      : !g.configured ? '<span class="badge b-erro">Não configurado</span>'
      : g.connection === "ok" ? '<span class="badge b-pago">Conectado</span>'
      : g.connection === "erro" ? '<span class="badge b-erro">Falha na conexão</span>' : '<span class="badge b-classificado">Configurado</span>';
    box.innerHTML = `<div class="row between wrap" style="gap:12px"><div><p class="eyebrow">Gateway de pagamento</p>
        <h3 style="font-size:18px;color:var(--ink);margin-top:4px">Asaas ${conn} ${g.env ? `<span class="small muted">· ${g.env === "production" ? "produção" : "sandbox"}</span>` : ""}</h3>
        <p class="small muted">${g.demo ? "Modo demonstração: com a API hospedada e a chave do Asaas configurada no servidor, aqui aparecem as cobranças reais."
          : !g.configured ? "Defina RAMON_ASAAS_API_KEY no servidor para ativar cobranças online."
          : `Chave ${esc(g.key_fingerprint)} · webhook ${g.webhook_token_configured ? "protegido por token" : "<b>sem token configurado</b>"}${g.account_name ? ` · conta ${esc(g.account_name)}` : ""}`}</p>
        ${g.connection_error ? `<p class="err">${esc(g.connection_error)}</p>` : ""}</div>
      <div class="row wrap" style="gap:14px;align-items:center">
        ${g.balance !== undefined ? `<div><span class="small muted">Saldo no Asaas</span><div class="kpi">${brl(g.balance)}</div></div>` : ""}
        <div class="small"><div>Último webhook: <b>${g.last_webhook_at ? dtm(g.last_webhook_at) : "—"}</b> (${g.webhooks || 0})</div>
          <div>Última sincronização: <b>${g.last_sync_at ? dtm(g.last_sync_at) : "—"}</b>${g.last_sync?.ok ? ` · ${g.last_sync.fetched} cobranças` : ""}</div></div>
        <button class="btn btn--ghost btn--sm" id="gtest" ${!g.configured ? "disabled" : ""}>Testar conexão</button>
        <button class="btn btn--primary btn--sm" id="gsync" ${!g.configured ? "disabled" : ""}>Sincronizar agora</button></div></div>`;
    box.querySelector("#gtest").onclick = () => loadGateway(true);
    box.querySelector("#gsync").onclick = async e => {
      e.target.disabled = true;
      try { const r = await api.post("/v1/admin/payments/sync", {}); toast(`${r.fetched} cobranças conferidas · ${r.matched} vinculadas · ${r.unmatched} sem vínculo`); await load(); await loadGateway(); }
      catch (x) { toast(problemMsg(x)); e.target.disabled = false; }
    };
  }

  let last;
  async function load() {
    const qs = new URLSearchParams(Object.entries(f).filter(([, v]) => v)).toString();
    const res = last = await api.get("/v1/admin/payments" + (qs ? "?" + qs : ""));
    const t = res.totals;
    el.querySelector("#kp").innerHTML = [
      kpi("Recebido", brl(t.recebido), `${t.count.pago} cobrança(s) · líquido ${brl(t.recebido_liquido)}`, "pos"),
      kpi("A receber", brl(t.pendente), `${t.count.pendente} pendente(s)`),
      kpi("Em atraso", brl(t.atrasado), `${t.count.atrasado} vencida(s)`, t.count.atrasado ? "neg" : ""),
      kpi("Estornado", brl(t.estornado), `${t.count.estornado} estorno(s)`),
      kpi("Cobranças", res.total, `${t.sem_vinculo} sem vínculo com cliente`),
    ].join("");
    const box = el.querySelector("#plist");
    box.innerHTML = res.items.length ? `<div class="table-wrap"><table class="table crm-table"><caption class="sr-only">Pagamentos</caption>
      <thead><tr><th>Data</th><th>Cliente</th><th>Descrição</th><th>Forma</th><th>Status</th><th class="num">Valor</th><th class="num">Líquido</th><th>Origem</th><th>Fatura</th></tr></thead>
      <tbody>${res.items.map(r => `<tr><td class="small">${r.paid_date ? `<b>${dt(r.paid_date.slice(0, 10))}</b><div class="muted">pago</div>` : `${dt(r.due_date)}<div class="muted">vencimento</div>`}</td>
        <td>${r.user_id ? `<a href="#/crm?cliente=${esc(r.user_id)}"><b>${esc(r.customer_name)}</b></a>` : `<b>${esc(r.customer_name || "—")}</b> <span class="badge b-pendente">sem vínculo</span>`}<div class="small muted">${esc(r.customer_email || "")}</div></td>
        <td class="small">${esc(r.description || "")}<div class="muted">${esc(r.id)}</div></td><td class="small">${esc(PAY_METHOD[r.method] || r.method)}</td>
        <td>${stBadge(r.status)}${r.status_gateway ? `<div class="small muted">${esc(r.status_gateway)}</div>` : ""}</td>
        <td class="num">${brl(r.value)}</td><td class="num">${brl(r.net_value)}</td><td class="small">${r.origin === "asaas" ? "Asaas" : "Manual"}</td>
        <td>${r.invoice_url ? `<a class="btn btn--ghost btn--sm" href="${esc(r.invoice_url)}" target="_blank" rel="noopener">Abrir</a>` : "—"}</td></tr>`).join("")}</tbody></table></div>`
      : empty("Nenhum pagamento com esses filtros.");
  }

  let tm;
  el.querySelector("#pf").onsubmit = e => e.preventDefault();
  el.querySelector("#pq").oninput = e => { clearTimeout(tm); tm = setTimeout(() => { f.q = e.target.value; load(); }, 250); };
  [["#ps", "status"], ["#pm", "method"], ["#po", "origin"], ["#pd1", "date_from"], ["#pd2", "date_to"]].forEach(([s, k]) => el.querySelector(s).onchange = e => { f[k] = e.target.value; load(); });
  el.querySelector("#pcsv").onclick = () => {
    const rows = [["id", "cliente", "email", "valor", "valor_liquido", "forma", "status", "status_asaas", "vencimento", "pagamento", "origem", "descricao", "fatura"],
      ...last.items.map(r => [r.id, r.customer_name || "", r.customer_email || "", r.value.replace(".", ","), r.net_value.replace(".", ","), PAY_METHOD[r.method] || r.method,
        ST_LABEL[r.status] || r.status, r.status_gateway || "", r.due_date || "", (r.paid_date || "").slice(0, 10), r.origin, r.description || "", r.invoice_url || ""])];
    const csv = "﻿" + rows.map(x => x.map(v => `"${String(v ?? "").replace(/"/g, '""')}"`).join(";")).join("\n");
    const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(new Blob([csv], { type: "text/csv" })), download: `pagamentos-${today}.csv` });
    a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    toast(`${last.items.length} pagamentos exportados.`);
  };
  await Promise.all([loadGateway(!DEMO), load()]);
}

function kpi(label, value, sub, cls = "") {
  return `<div class="card"><h3>${esc(label)}</h3><div class="kpi ${cls}">${value}</div><p class="small muted">${esc(sub)}</p></div>`;
}
