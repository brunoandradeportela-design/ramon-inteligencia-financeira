/* Onda 2 no app: correção auditável de categoria com rastreabilidade, Minha Alocação e Data Hub (consentimentos, cobertura, qualidade). */
import { api, ApiError, HAS_API } from "./api.js";
import { brl, donut, dt, dtm, empty, esc, hbars, mes, PALETTE, pct, toast } from "./ui.js";

const msg = e => e instanceof ApiError ? (e.problem.detail || e.problem.title) : String(e.message || e);
const STATE = { matched: ["pago", "fecha"], partial: ["aberto", "parcial"], conflict: ["vencido", "conflito"], unresolved: ["classificado", "sem par"] };
const CONN = { HEALTHY: "saudável", SYNCING: "sincronizando", DEGRADED: "desatualizada", ERROR: "erro", AUTH_PENDING: "aguardando autorização", CONSENTED: "consentida", EXPIRED: "expirada", REVOKED: "revogada", DISCOVERED: "descoberta" };

export function wireTxEdits(el, reload) {
  el.querySelectorAll("[data-cat]").forEach(s => s.onchange = async () => {
    const id = s.dataset.cat, prev = [...s.options].find(o => o.defaultSelected)?.value;
    const row = el.querySelector(`[data-linrow="${id}"]`); row.hidden = false;
    row.firstElementChild.innerHTML = `<form class="row wrap" style="gap:8px" data-why="${esc(id)}"><span class="small">Mudar de <b>${esc(prev)}</b> para <b>${esc(s.value)}</b>. Motivo (opcional):</span>
      <input class="input" name="r" maxlength="200" style="max-width:280px;padding:4px 8px" placeholder="ex.: compra de mercado pelo app"><button class="btn btn--primary btn--sm">Salvar</button><button type="button" class="btn btn--ghost btn--sm" data-x>Cancelar</button></form>`;
    const f = row.querySelector("form");
    f.querySelector("[data-x]").onclick = () => { s.value = prev; row.hidden = true; };
    f.onsubmit = async e => { e.preventDefault();
      try { await api.patch(`/v1/finance/transactions/${id}`, { category: s.value, reason: f.r.value }); toast("Categoria corrigida. O lançamento original foi preservado."); reload(); }
      catch (x) { toast(msg(x)); } };
  });
  el.querySelectorAll("[data-lin]").forEach(a => a.onclick = async e => {
    e.preventDefault();
    const id = a.dataset.lin, row = el.querySelector(`[data-linrow="${id}"]`);
    if (!row.hidden) { row.hidden = true; return; }
    try {
      const l = await api.get(`/v1/finance/transactions/${id}/lineage`);
      const o = l.origin;
      row.firstElementChild.innerHTML = `<div class="small stack" style="padding:6px 0"><b style="display:block">Rastreabilidade</b>
        <div>Origem: ${esc(o.type)}${o.filename ? ` · arquivo <b>${esc(o.filename)}</b>` : ""}${o.institution ? ` · ${esc(o.institution)}` : ""} · recebido em ${dtm(o.created_at || o.collected_at)}${o.checksum ? ` · checksum <code>${esc(String(o.checksum).slice(0, 12))}</code>` : ""}${o.payload_version ? ` · ${esc(o.payload_version)}` : ""}</div>
        <div>Transformação: leitor ${esc(l.transformation.parser)} · ${esc(l.transformation.categorization)}</div>
        <div>Registro original: ${dt(l.original.date)} · ${esc(l.original.description)} · ${brl(l.original.amount)} · categoria ${esc(l.original.category)}</div>
        ${l.corrections.length ? `<div>Correções: ${l.corrections.map(c => `${dtm(c.at)} ${esc(c.from)} → <b>${esc(c.to)}</b>${c.reason ? ` (“${esc(c.reason)}”)` : ""}`).join("; ")}</div>` : "<div>Sem correções.</div>"}</div>`;
      row.hidden = false;
    } catch (x) { toast(msg(x)); }
  });
}

export async function allocation(el) {
  if (!HAS_API) { el.innerHTML = `<section class="card">${empty("Minha Alocação funciona com a sua conta no site oficial.")}</section>`; return; }
  const a = await api.get("/v1/allocation");
  if (!a.has_data) { el.innerHTML = `<section class="card">${empty("Importe a posição da B3, as negociações ou conecte sua corretora para ver sua alocação.")}<p style="margin-top:10px"><a class="btn btn--primary btn--sm" href="#/importar">Importar dados</a></p></section>`; return; }
  const bm = a.benchmark, f = a.flows;
  el.innerHTML = `
    <div class="grid g-4">
      <div class="card"><h3>Investido hoje</h3><div class="kpi">${brl(a.total)}</div><p class="small muted">${a.positions.length} ativos · ${a.by_institution.length} instituição(ões)</p></div>
      <div class="card"><h3>Resultado sobre o custo</h3><div class="kpi ${+a.performance.result < 0 ? "neg" : "pos"}">${brl(a.performance.result)}</div><span class="delta ${a.performance.result_pct >= 0 ? "delta--up" : "delta--down"}">${pct(a.performance.result_pct)}</span>
        <p class="small muted">custo conhecido de ${pct(a.performance.coverage || 0, 0)} da carteira</p></div>
      <div class="card"><h3>CDI em 12 meses</h3><div class="kpi">${bm?.cdi_12m ? pct(bm.cdi_12m.value) : "—"}</div><p class="small muted">referência (Banco Central)</p></div>
      <div class="card"><h3>IPCA em 12 meses</h3><div class="kpi">${bm?.ipca_12m ? pct(bm.ipca_12m.value) : "—"}</div><p class="small muted">referência (Banco Central)</p></div>
    </div>
    <div class="grid g-2 section">
      <section class="card"><h3>Composição por classe</h3><div class="row wrap" style="gap:24px;margin-top:14px">${donut(a.by_class, { size: 160, label: "Composição por classe" })}
        <ul class="legend" style="flex:1;min-width:200px">${a.by_class.map((x, i) => `<li><i style="background:${PALETTE[i]}"></i><span>${esc(x.group)} · ${brl(x.value)}</span><b>${pct(x.weight)}</b></li>`).join("")}</ul></div></section>
      <section class="card"><h3>Por instituição</h3>${hbars(a.by_institution.map(i => ({ label: `${i.institution} · ${pct(i.weight, 0)}`, value: i.value })))}
        <div class="sr-only"><p>Valores por instituição:</p><ul>${a.by_institution.map(i => `<li>${esc(i.institution)}: ${brl(i.value)}</li>`).join("")}</ul></div></section>
    </div>
    <div class="grid g-2 section">
      <section class="card"><h3>Vencimentos</h3>${a.maturities.length ? `${hbars(a.maturity_ladder.filter(l => +l.value > 0).map(l => ({ label: l.label, value: l.value })))}
        <div class="table-wrap"><table class="table" style="margin-top:10px"><thead><tr><th>Ativo</th><th>Vencimento</th><th class="num">Valor</th></tr></thead><tbody>${a.maturities.slice(0, 10).map(m => `<tr><td>${esc(m.name)}<div class="small muted">${esc(m.custodian || "")}${m.indexer ? " · " + esc(m.indexer) : ""}</div></td><td>${dt(m.maturity)}${m.days < 0 ? ` <span class="small neg">vencido</span>` : ""}</td><td class="num">${brl(m.value)}</td></tr>`).join("")}</tbody></table></div>` : `<p class="small muted" style="margin-top:10px">Nenhum ativo com vencimento informado.</p>`}</section>
      <section class="card"><h3>Evolução, aportes e performance</h3>
        ${a.evolution.length >= 2 ? `<p class="small" style="margin-top:8px">${a.evolution.map(e => `${dt(e.date)}: <b>${brl(e.value)}</b>`).slice(-6).join(" · ")}</p>` : `<p class="small muted" style="margin-top:8px">A evolução aparece a partir do segundo dia com dados: guardamos um retrato diário da carteira.</p>`}
        ${f ? `<ul class="stack small" style="margin-top:10px"><li>Variação de ${dt(f.from)} a ${dt(f.to)}: <b>${brl(f.change)}</b></li><li>Aportes ${brl(f.contributions)} · resgates ${brl(f.withdrawals)} · aportes líquidos <b>${brl(f.net_contributions)}</b></li>
          <li>Performance estimada: <b class="${+f.performance < 0 ? "neg" : "pos"}">${brl(f.performance)}</b> (${pct(f.performance_pct)})</li></ul><p class="note">${esc(f.method)}</p>` : ""}
        <p class="note">${esc(a.performance.method)}</p>${bm ? `<p class="note">${esc(bm.note)}</p>` : ""}</section>
    </div>
    <section class="card section"><h3>Detalhamento por ativo</h3><div class="table-wrap"><table class="table" style="margin-top:10px"><thead><tr><th>Ativo</th><th>Classe</th><th>Instituição</th><th class="num">Aplicado</th><th class="num">Valor</th><th class="num">Resultado</th><th class="num">Peso</th></tr></thead>
      <tbody>${a.positions.map(p => `<tr><td><b>${esc(p.name)}</b></td><td>${esc(p.group)}</td><td>${esc(p.custodian)}</td><td class="num">${p.invested == null ? "—" : brl(p.invested)}</td><td class="num">${brl(p.value)}</td>
        <td class="num ${+p.result < 0 ? "neg" : "pos"}">${p.result == null ? "—" : brl(p.result)}</td><td class="num">${pct(p.weight)}</td></tr>`).join("")}</tbody></table></div>
      <p class="trust-line" style="margin-top:12px"><span>${esc(a.disclaimer)}</span></p></section><div id="pbibox"></div>`;
  import("./views_hub.js").then(m => m.analyticsEmbed(el.querySelector("#pbibox"))).catch(() => {});
}

export async function dataHubSection(el) {
  let dq, inst, cons;
  try { [dq, inst, cons] = await Promise.all([api.get("/v1/data-quality"), api.get("/v1/institutions"), api.get("/v1/consents")]); }
  catch (x) { el.innerHTML = ""; return null; }
  const bar = v => `<div style="height:6px;border-radius:9px;background:var(--line);margin-top:4px"><div style="height:6px;border-radius:9px;background:var(--pos);width:${Math.round(v * 100)}%"></div></div>`;
  const ind = { freshness: "Atualização", completeness: "Completude", validity: "Validade", consistency: "Consistência", duplicates: "Sem duplicidade" };
  el.innerHTML = `
    <section class="card section" data-tour="con-qualidade"><h3>Qualidade dos dados <span class="right small muted">nota geral ${pct(dq.overall, 0)}</span></h3>
      <div class="grid g-4" style="margin-top:10px">${Object.entries(dq.indicators).map(([k, v]) => `<div><span class="small">${ind[k]}</span> <b class="small">${pct(v, 0)}</b>${bar(v)}</div>`).join("")}</div>
      ${dq.tips.length ? `<ul class="stack small" style="margin-top:12px">${dq.tips.map(t => `<li>• ${esc(t)}</li>`).join("")}</ul>` : ""}
      <p class="note">${esc(dq.note)} ${dq.freshness_days != null ? `Dado mais recente: há ${dq.freshness_days} dia(s).` : ""}</p>
      ${dq.reconciliation_items.length ? `<div class="table-wrap"><table class="table" style="margin-top:10px"><caption class="small" style="text-align:left">Reconciliação</caption><thead><tr><th>Item</th><th>Estado</th><th>Detalhe</th></tr></thead>
        <tbody>${dq.reconciliation_items.map(r => `<tr><td><b>${esc(r.key)}</b> <span class="small muted">${esc(r.kind)}</span></td><td><span class="badge b-${STATE[r.state][0]}">${STATE[r.state][1]}</span></td><td class="small">${esc(r.detail)}</td></tr>`).join("")}</tbody></table></div>` : ""}
      ${dq.sources.length ? `<div class="table-wrap"><table class="table" style="margin-top:10px"><caption class="small" style="text-align:left">Origens dos dados</caption><thead><tr><th>Origem</th><th>Quando</th><th>Registros</th><th>Rastreio</th></tr></thead>
        <tbody>${dq.sources.map(s => `<tr><td>${s.kind === "open_finance" ? "Open Finance · " : "Arquivo · "}${esc(s.name)}${s.state ? ` <span class="small muted">(${esc(CONN[s.state] || s.state)})</span>` : ""}</td><td class="small">${s.at ? dtm(s.at) : "—"}</td>
          <td class="small">${s.records ? Object.entries(s.records).filter(([, v]) => v).map(([k, v]) => `${v} ${({ transactions: "lanç.", accounts: "contas", holdings: "posições", trades: "negoc." })[k] || k}`).join(", ") : "—"}${s.rejected ? ` · <span class="neg">${s.rejected} recusado(s)</span>` : ""}</td>
          <td class="small muted">${s.checksum ? `<code>${esc(s.checksum.slice(0, 10))}</code> · ${esc(s.parser)}` : ""}</td></tr>`).join("")}</tbody></table></div>` : ""}</section>
    <section class="card section" data-tour="con-consentimentos"><h3>Consentimentos</h3>${cons.items.length ? `<div class="table-wrap"><table class="table" style="margin-top:10px"><thead><tr><th>Instituição</th><th>Escopo</th><th>Finalidade</th><th>Validade</th><th>Situação</th></tr></thead>
      <tbody>${cons.items.map(c => `<tr><td><b>${esc(c.institution)}</b><div class="small muted">${esc(c.provider)}</div></td><td class="small">${esc(c.scope.join(", "))}</td><td class="small">${esc(c.purpose)}</td><td class="small">${dt(c.created_at)} a ${dt(c.expires_at)}</td>
        <td><span class="badge b-${c.status === "ativo" ? "ativo" : "classificado"}">${esc(c.status)}</span>${c.revoked_at ? `<div class="small muted">revogado em ${dt(c.revoked_at)}</div>` : ""}</td></tr>`).join("")}</tbody></table></div>`
      : `<p class="small muted" style="margin-top:8px">Nenhum consentimento de Open Finance ainda. Cada conexão registra escopo, finalidade, validade (12 meses) e revogação.</p>`}</section>
    <section class="card section"><h3>Matriz de cobertura <span class="right small muted">${esc(inst.provider)}</span></h3>${inst.configured ? `<div class="table-wrap"><table class="table" style="margin-top:10px"><thead><tr><th>Instituição</th><th>Tipo</th><th>Conta</th><th>Cartão</th><th>Investimentos</th><th>Situação</th></tr></thead>
      <tbody>${inst.items.slice(0, 60).map(i => `<tr><td>${esc(i.name)}</td><td>${esc(i.type)}</td><td>${i.accounts ? "Sim" : "—"}</td><td>${i.credit_cards ? "Sim" : "—"}</td><td>${i.investments ? "Sim" : "—"}</td><td class="small">${esc(i.status)}</td></tr>`).join("")}</tbody></table></div><p class="note">Lista obtida do provedor em ${dtm(inst.fetched_at)}.</p>`
      : `<p class="small muted" style="margin-top:8px">${esc(inst.note)}</p>`}</section>`;
  return dq;
}
