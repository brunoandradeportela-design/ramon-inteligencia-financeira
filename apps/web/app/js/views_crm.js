/* CRM — acompanhamento de todos os clientes (área do administrador). */
import { api, DEMO } from "./api.js";
import { barChart, brl, dt, dtm, empty, esc, icon, pct, toast } from "./ui.js";
import { STAGES, PRICE } from "./crm_rules.js";

const STAGE_LABEL = Object.fromEntries(STAGES);
const stageBadge = s => `<span class="badge st-${esc(s)}">${esc(STAGE_LABEL[s] || s)}</span>`;
const KIND = { cadastro: "Cadastro", acesso: "Acesso", uso: "Uso da plataforma", pagamento: "Pagamento", nota: "Anotação", ligacao: "Ligação", whatsapp: "WhatsApp", email: "E-mail", reuniao: "Reunião" };
const problemMsg = e => e?.problem ? (e.problem.detail || e.problem.title) + (e.problem.errors?.length ? " — " + e.problem.errors.map(x => x.msg).join("; ") : "") : String(e?.message || e);

export async function crm(el, r) {
  const f = { q: r.params.get("q") || "", stage: r.params.get("etapa") || "", plan: "" };
  let selected = r.params.get("cliente") || null;
  const [m] = await Promise.all([api.get("/v1/admin/crm/metrics")]);
  el.innerHTML = `
    <div class="grid crm-kpis">
      ${kpi("Clientes cadastrados", m.total, `+${m.new_7d} nos últimos 7 dias`)}
      ${kpi("Novos em 30 dias", m.new_30d, `ativação ${pct(m.activation, 0)}`)}
      ${kpi("Pagantes", m.paying, `conversão ${pct(m.conversion, 0)}`)}
      ${kpi("Receita recorrente (MRR)", brl(m.mrr), `ARR ${brl(m.arr)}`)}
      ${kpi("Recebido no mês", brl(m.revenue_month), "pagamentos registrados")}
      ${kpi("Inadimplentes", m.overdue, `${brl(m.overdue_value)}/mês em aberto`, m.overdue ? "neg" : "")}
    </div>
    <div class="grid g-dash2 section">
      <section class="card"><h3>Funil de clientes <span class="right small muted">clique para filtrar</span></h3>
        <ul class="funnel" style="margin-top:12px">${m.stages.map(s => `<li><button type="button" data-stage="${s.key}" aria-pressed="${f.stage === s.key}">
          <span>${esc(s.label)}</span><span class="funnel__bar"><i class="st-bg-${s.key}" style="width:${m.total ? Math.max(3, s.count / m.total * 100) : 0}%"></i></span><b>${s.count}</b></button></li>`).join("")}</ul></section>
      <section class="card"><h3>Cadastros por semana</h3>
        ${barChart(m.signups_by_week.map(w => ({ label: dt(w.week_start).slice(0, 5), value: w.signups })), { h: 110, label: "Cadastros por semana" }).replace(/R\$\s?[\d.,]+/g, "")}
        <p class="small muted" style="margin-top:10px">Profissões: ${m.by_profession.map(p => `${esc(p.profession)} (${p.count})`).join(" · ")}</p>
        <p class="small muted">Planos: ${m.by_plan.map(p => `${esc(p.plan)} ${p.count}`).join(" · ")}</p></section>
    </div>
    <section class="card section">
      <form id="ff" class="row wrap" style="gap:10px" role="search">
        <label class="sr-only" for="fq">Buscar</label><input class="input" id="fq" style="flex:1;min-width:220px" placeholder="Buscar por nome, e-mail, telefone ou profissão" value="${esc(f.q)}">
        <label class="sr-only" for="fs">Etapa</label><select class="input" id="fs" style="width:auto"><option value="">Todas as etapas</option>${STAGES.map(([k, l]) => `<option value="${k}" ${f.stage === k ? "selected" : ""}>${l}</option>`).join("")}</select>
        <label class="sr-only" for="fp">Plano</label><select class="input" id="fp" style="width:auto"><option value="">Todos os planos</option><option value="free">Free</option><option value="pro">Pro</option><option value="premium">Premium</option></select>
        <button class="btn btn--ghost" type="button" id="csv">${icon("doc")} Exportar CSV</button>
      </form>
      <div id="list" style="margin-top:12px"></div>
    </section>
    <div id="detail"></div>
    <p class="note">${esc(m.pricing_note)} O CRM mostra dados de cadastro, assinatura e sinais de uso — nunca patrimônio, transações ou impostos do cliente (minimização LGPD). Todo acesso a um cliente fica registrado na trilha de auditoria dele.</p>`;

  async function loadList() {
    const qs = new URLSearchParams(Object.entries(f).filter(([, v]) => v)).toString();
    const res = await api.get("/v1/admin/crm/customers" + (qs ? "?" + qs : ""));
    const box = el.querySelector("#list");
    box.innerHTML = res.items.length ? `<p class="small muted" style="margin-bottom:6px">${res.total} cliente(s)</p><div class="table-wrap"><table class="table crm-table"><caption class="sr-only">Clientes</caption>
      <thead><tr><th>Cliente</th><th>Contato</th><th>Plano</th><th>Etapa</th><th>Cadastro</th><th>Último acesso</th><th class="num">Total pago</th><th>Próxima ação</th></tr></thead>
      <tbody>${res.items.map(c => `<tr data-id="${c.id}" tabindex="0" class="${selected === c.id ? "is-sel" : ""}"><td><b>${esc(c.name)}</b><div class="small muted">${esc(c.profession)}</div></td>
        <td class="small">${esc(c.email)}<div>${esc(c.phone_display)}</div></td><td>${esc(c.plan_name)}</td><td>${stageBadge(c.stage)}${c.stage_overridden ? ' <span class="small muted" title="Etapa definida manualmente">✎</span>' : ""}</td>
        <td class="small">${dt(c.created_at)}</td><td class="small">${c.last_login_at ? dt(c.last_login_at) : "—"}</td><td class="num">${brl(c.total_paid)}</td>
        <td class="small">${esc(c.next_action || "—")}${c.next_action_date ? `<div class="muted">${dt(c.next_action_date)}</div>` : ""}</td></tr>`).join("")}</tbody></table></div>` : empty("Nenhum cliente encontrado com esses filtros.");
    box.querySelectorAll("tr[data-id]").forEach(tr => {
      const open = () => { selected = tr.dataset.id; box.querySelectorAll("tr").forEach(x => x.classList.toggle("is-sel", x === tr)); loadDetail(); };
      tr.onclick = open; tr.onkeydown = e => { if (e.key === "Enter") open(); };
    });
    return res;
  }

  async function loadDetail() {
    const box = el.querySelector("#detail");
    if (!selected) { box.innerHTML = ""; return; }
    box.innerHTML = `<div class="card section"><div class="skeleton" style="height:120px"></div></div>`;
    const c = await api.get(`/v1/admin/crm/customers/${selected}`);
    const today = new Date().toISOString().slice(0, 10);
    box.innerHTML = `<section class="card section crm-detail" aria-label="Ficha do cliente">
      <div class="row between wrap"><div><p class="eyebrow">Ficha do cliente</p><h3 style="font-size:19px;color:var(--ink);margin-top:4px">${esc(c.name)}</h3>
        <p class="small muted">${esc(c.profession)} · cadastro em ${dtm(c.created_at)} · origem ${esc(c.origin)}</p></div>
        <div class="row" style="gap:8px">${stageBadge(c.stage)}<button class="btn btn--ghost btn--sm" id="close">Fechar</button></div></div>
      <div class="grid g-3" style="margin-top:14px">
        <div class="crm-box"><h4>Contato</h4>
          <p class="sel">${esc(c.email)}</p><p class="sel">${esc(c.phone_display)}</p>
          <div class="row wrap" style="gap:6px;margin-top:8px">${c.whatsapp_url ? `<a class="btn btn--primary btn--sm" href="${esc(c.whatsapp_url)}" target="_blank" rel="noopener">WhatsApp</a>` : ""}
            <button class="btn btn--ghost btn--sm" data-copy="${esc(c.email)}">Copiar e-mail</button><button class="btn btn--ghost btn--sm" data-copy="${esc(c.phone_display)}">Copiar telefone</button></div></div>
        <div class="crm-box"><h4>Assinatura</h4>
          <p>Plano <b>${esc(c.plan_name)}</b> · ${brl(c.subscription.price_month)}/mês</p>
          <p class="small">Status: <b>${esc(c.subscription.status.replace("_", " "))}</b></p>
          <p class="small">Próximo vencimento: <b>${c.subscription.next_due ? dt(c.subscription.next_due) : "—"}</b></p>
          <p class="small">Total pago: <b>${brl(c.total_paid)}</b></p></div>
        <div class="crm-box"><h4>Uso da plataforma</h4>
          <p class="small">Último acesso: <b>${c.last_login_at ? dtm(c.last_login_at) : "nunca"}</b></p>
          <p class="small">Conexões ${c.activity.connections} · documentos ${c.activity.documents} · simulações ${c.activity.simulations} · perguntas à IA ${c.activity.ai_questions}</p></div>
      </div>
      <form id="upd" class="form-grid" style="margin-top:14px">
        <div class="field"><label for="u-stage">Etapa ${c.stage_overridden ? "(manual)" : "(automática)"}</label><select class="input" id="u-stage">${STAGES.map(([k, l]) => `<option value="${k}" ${c.stage === k ? "selected" : ""}>${l}</option>`).join("")}</select></div>
        <div class="field"><label for="u-plan">Plano</label><select class="input" id="u-plan">${["free", "pro", "premium"].map(p => `<option value="${p}" ${c.plan === p ? "selected" : ""}>${{ free: "Free", pro: "Pro", premium: "Premium" }[p]}</option>`).join("")}</select></div>
        <div class="field"><label for="u-next">Próxima ação</label><input class="input" id="u-next" maxlength="200" value="${esc(c.next_action || "")}" placeholder="Ex.: ligar para apresentar o Pro"></div>
        <div class="field"><label for="u-date">Data da ação</label><input class="input" id="u-date" type="date" value="${esc(c.next_action_date || "")}"></div>
        <div class="field"><label for="u-tags">Etiquetas (vírgula)</label><input class="input" id="u-tags" value="${esc(c.tags.join(", "))}"></div>
        <div class="field" style="justify-content:flex-end"><div class="row" style="gap:8px"><button class="btn btn--primary">Salvar</button>${c.stage_overridden ? '<button type="button" class="btn btn--ghost" id="auto">Etapa automática</button>' : ""}</div></div>
      </form>
      <div class="grid g-2" style="margin-top:16px">
        <div class="crm-box"><h4>Registrar pagamento</h4>
          <form id="pay" class="form-grid" style="margin-top:8px">
            <div class="field"><label for="p-amount">Valor (R$)</label><input class="input" id="p-amount" inputmode="decimal" value="${(PRICE[c.plan] || c.subscription.price_month).replace(".", ",")}"></div>
            <div class="field"><label for="p-method">Forma</label><select class="input" id="p-method"><option value="pix">Pix</option><option value="cartao">Cartão</option><option value="boleto">Boleto</option><option value="transferencia">Transferência</option></select></div>
            <div class="field"><label for="p-status">Status</label><select class="input" id="p-status"><option value="pago">Pago</option><option value="pendente">Pendente</option><option value="atrasado">Atrasado</option><option value="estornado">Estornado</option></select></div>
            <div class="field"><label for="p-date">Data</label><input class="input" id="p-date" type="date" value="${today}"></div>
            <div class="field"><label for="p-period">Competência</label><input class="input" id="p-period" type="month" value="${today.slice(0, 7)}"></div>
            <div class="field" style="justify-content:flex-end"><button class="btn btn--primary">Registrar</button></div>
          </form>
          <p class="note">Registro manual até o gateway de cobrança ser definido (D-06); depois, os pagamentos entram automaticamente.</p>
          ${c.payments.length ? `<div class="table-wrap"><table class="table" style="margin-top:8px"><thead><tr><th>Data</th><th>Competência</th><th>Forma</th><th>Status</th><th class="num">Valor</th></tr></thead><tbody>
            ${c.payments.map(p => `<tr><td>${dt(p.date)}</td><td>${esc(p.period)}</td><td>${esc(p.method)}</td><td><span class="badge b-${p.status === "pago" ? "pago" : p.status === "pendente" ? "pendente" : "erro"}">${esc(p.status)}</span></td><td class="num">${brl(p.amount)}</td></tr>`).join("")}</tbody></table></div>` : '<p class="small muted" style="margin-top:8px">Nenhum pagamento registrado.</p>'}</div>
        <div class="crm-box"><h4>Anotações e histórico</h4>
          <form id="note" class="row wrap" style="gap:8px;margin-top:8px"><label class="sr-only" for="n-kind">Tipo</label><select class="input" id="n-kind" style="width:auto"><option value="nota">Nota</option><option value="whatsapp">WhatsApp</option><option value="ligacao">Ligação</option><option value="email">E-mail</option><option value="reuniao">Reunião</option></select>
            <label class="sr-only" for="n-text">Anotação</label><input class="input" id="n-text" style="flex:1;min-width:180px" maxlength="2000" placeholder="O que foi conversado?"><button class="btn btn--primary">Anotar</button></form>
          <ol class="timeline">${c.timeline.map(t => `<li class="tl-${esc(t.kind)}"><span class="small muted">${dtm(t.at)} · ${esc(KIND[t.kind] || t.kind)}${t.author ? " · " + esc(t.author) : ""}</span><p>${esc(t.text)}</p></li>`).join("")}</ol></div>
      </div>
      <p class="err" id="derr" role="alert"></p></section>`;
    const err = box.querySelector("#derr");
    box.querySelector("#close").onclick = () => { selected = null; loadDetail(); el.querySelectorAll("tr.is-sel").forEach(x => x.classList.remove("is-sel")); };
    box.querySelectorAll("[data-copy]").forEach(b => b.onclick = () => navigator.clipboard.writeText(b.dataset.copy).then(() => toast("Copiado."), () => toast(b.dataset.copy)));
    const refresh = async msg => { toast(msg); const k = el.querySelector("#list"); await loadList(); await loadDetail(); refreshKpis(); };
    box.querySelector("#upd").onsubmit = async e => {
      e.preventDefault(); err.textContent = "";
      const stage = box.querySelector("#u-stage").value;
      try {
        await api.patch(`/v1/admin/crm/customers/${c.id}`, { ...(stage !== c.stage ? { stage } : {}), plan: box.querySelector("#u-plan").value,
          next_action: box.querySelector("#u-next").value, next_action_date: box.querySelector("#u-date").value,
          tags: box.querySelector("#u-tags").value.split(",").map(t => t.trim()).filter(Boolean) });
        refresh("Cliente atualizado.");
      } catch (x) { err.textContent = problemMsg(x); }
    };
    box.querySelector("#auto")?.addEventListener("click", async () => { await api.patch(`/v1/admin/crm/customers/${c.id}`, { clear_override: true }); refresh("Etapa volta a ser calculada automaticamente."); });
    box.querySelector("#pay").onsubmit = async e => {
      e.preventDefault(); err.textContent = "";
      try {
        await api.post(`/v1/admin/crm/customers/${c.id}/payments`, { amount: box.querySelector("#p-amount").value.replace(/\./g, "").replace(",", "."),
          method: box.querySelector("#p-method").value, status: box.querySelector("#p-status").value, date: box.querySelector("#p-date").value,
          period: box.querySelector("#p-period").value }, { "Idempotency-Key": crypto.randomUUID?.() || String(Date.now()) });
        refresh("Pagamento registrado.");
      } catch (x) { err.textContent = problemMsg(x); }
    };
    box.querySelector("#note").onsubmit = async e => {
      e.preventDefault(); err.textContent = "";
      try { await api.post(`/v1/admin/crm/customers/${c.id}/notes`, { kind: box.querySelector("#n-kind").value, text: box.querySelector("#n-text").value }); refresh("Anotação salva."); }
      catch (x) { err.textContent = problemMsg(x); }
    };
    box.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  async function refreshKpis() {
    const m2 = await api.get("/v1/admin/crm/metrics");
    const vals = [m2.total, m2.new_30d, m2.paying, brl(m2.mrr), brl(m2.revenue_month), m2.overdue];
    el.querySelectorAll(".crm-kpis .kpi").forEach((k, i) => k.textContent = vals[i]);
    m2.stages.forEach(s => { const b = el.querySelector(`[data-stage="${s.key}"] b`); if (b) b.textContent = s.count; });
  }

  let t;
  el.querySelector("#fq").oninput = e => { clearTimeout(t); t = setTimeout(() => { f.q = e.target.value; loadList(); }, 250); };
  el.querySelector("#ff").onsubmit = e => e.preventDefault();
  el.querySelector("#fs").onchange = e => { f.stage = e.target.value; syncFunnel(); loadList(); };
  el.querySelector("#fp").onchange = e => { f.plan = e.target.value; loadList(); };
  el.querySelectorAll("[data-stage]").forEach(b => b.onclick = () => { f.stage = f.stage === b.dataset.stage ? "" : b.dataset.stage; el.querySelector("#fs").value = f.stage; syncFunnel(); loadList(); });
  const syncFunnel = () => el.querySelectorAll("[data-stage]").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.stage === f.stage)));
  el.querySelector("#csv").onclick = async () => {
    const res = await api.get("/v1/admin/crm/customers?" + new URLSearchParams(Object.entries(f).filter(([, v]) => v)));
    const rows = [["nome", "email", "telefone", "profissao", "plano", "etapa", "cadastro", "ultimo_acesso", "total_pago", "proximo_vencimento", "proxima_acao"],
      ...res.items.map(c => [c.name, c.email, c.phone_display, c.profession, c.plan_name, STAGE_LABEL[c.stage], c.created_at.slice(0, 10), (c.last_login_at || "").slice(0, 10), c.total_paid.replace(".", ","), c.subscription.next_due || "", c.next_action])];
    const csv = "﻿" + rows.map(r => r.map(v => `"${String(v ?? "").replace(/"/g, '""')}"`).join(";")).join("\n");
    const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(new Blob([csv], { type: "text/csv" })), download: "clientes.csv" });
    a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    toast(`${res.items.length} clientes exportados.`);
  };
  await loadList();
  if (selected) loadDetail();
}

function kpi(label, value, sub, cls = "") {
  return `<div class="card"><h3>${esc(label)}</h3><div class="kpi ${cls}">${value}</div><p class="small muted">${esc(sub)}</p></div>`;
}
