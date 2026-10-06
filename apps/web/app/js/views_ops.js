/* Operações (administrador): SLOs, latência por rota, erros, saúde dos jobs e eventos de domínio (Engenharia v6.0 §25–26). */
import { api, ApiError } from "./api.js";
import { dtm, esc, num, pct } from "./ui.js";

const msg = e => e instanceof ApiError ? (e.problem.detail || e.problem.title) : String(e.message || e);
const EV = { "auth.login_falhou": "Login com falha", "tax.calculo": "Cálculos tributários (média = qualidade)", "trader.backtest": "Backtests (média = pregões)", "mail.enviados": "Rodadas com e-mail enviado (média = e-mails)",
  "mail.falhas": "Rodadas com falha de e-mail", "job.falha.mercado": "Falhas na coleta de mercado", "job.falha.email": "Falhas no job de e-mail" };
const evLabel = k => EV[k] || (k.startsWith("ai.bloqueio.") ? `Copilot: bloqueio por ${k.slice(12)}` : k.startsWith("ai.pergunta.") ? `Copilot: perguntas "${k.slice(12)}" (média = ms)` : k);
const badge = ok => ok == null ? `<span class="muted">—</span>` : ok ? `<span class="pos">✓ dentro</span>` : `<span class="neg">✗ fora</span>`;

export async function ops(el, r) {
  const hours = +(r.params.get("h") || 24);
  let d; try { d = await api.get(`/v1/admin/ops?hours=${hours}`); } catch (e) { el.innerHTML = `<div class="card" role="alert">${esc(msg(e))}</div>`; return; }
  el.innerHTML = `
    <div class="row wrap" style="gap:8px;margin-bottom:12px">${[1, 24, 168].map(h => `<a class="btn btn--sm ${h === hours ? "btn--primary" : "btn--ghost"}" href="#/operacoes?h=${h}">${h === 168 ? "7 dias" : h + " h"}</a>`).join("")}<span class="small muted" style="align-self:center">atualizado ${dtm(d.generated_at)}</span></div>
    <div class="grid g-4">
      <div class="card"><h3>Requisições</h3><div class="kpi">${num(d.requests)}</div><p class="small muted">últimas ${d.window_hours} h</p></div>
      <div class="card"><h3>Disponibilidade</h3><div class="kpi">${d.availability == null ? "—" : pct(d.availability, 2)}</div><p class="small">meta ${pct(d.slo.availability_target, 1)} · ${badge(d.slo.availability_ok)}</p></div>
      <div class="card"><h3>Latência p95</h3><div class="kpi">${d.p95_ms == null ? "—" : "≤ " + d.p95_ms + " ms"}</div><p class="small">meta ${d.slo.p95_target_ms} ms · ${badge(d.slo.p95_ok)}</p></div>
      <div class="card"><h3>Falhas de login</h3><div class="kpi">${num(d.security.login_failures)}</div><p class="small muted">${num(d.business.users)} conta(s) · ${num(d.business.documents)} documento(s)</p></div>
    </div>
    <section class="card section"><h3>Saúde dos jobs e integrações</h3><ul class="stack small" style="margin-top:10px">${d.health.map(h => `<li class="row wrap" style="gap:8px;justify-content:space-between"><span><b>${esc(h.label)}</b> · ${esc(h.detail || "")}</span><span>${h.last ? `${dtm(h.last)} (${h.age_h} h) · ` : ""}${badge(h.ok)}</span></li>`).join("")}</ul></section>
    <section class="card section"><h3>Rotas da API <span class="right small muted">${d.api.length}</span></h3>
      ${d.api.length ? `<div class="table-wrap"><table class="table" style="margin-top:10px"><thead><tr><th>Rota</th><th class="num">Req.</th><th class="num">4xx</th><th class="num">5xx</th><th class="num">Média</th><th class="num">p50</th><th class="num">p95</th><th class="num">Máx.</th></tr></thead><tbody>
      ${d.api.slice(0, 60).map(a => `<tr><td><code>${esc(a.route)}</code></td><td class="num">${num(a.requests)}</td><td class="num">${a.errors_4xx || ""}</td><td class="num ${a.errors_5xx ? "neg" : ""}">${a.errors_5xx || ""}</td><td class="num">${a.avg_ms} ms</td><td class="num">${a.p50_ms ?? "—"}</td><td class="num ${a.p95_ms > 500 ? "neg" : ""}">${a.p95_ms ?? "—"}</td><td class="num">${a.max_ms} ms</td></tr>`).join("")}</tbody></table></div>`
      : `<p class="small muted" style="margin-top:8px">Sem tráfego registrado na janela.</p>`}</section>
    <section class="card section"><h3>Eventos de domínio</h3>${d.events.length ? `<ul class="stack small" style="margin-top:10px">${d.events.sort((a, b) => b.count - a.count).map(e => `<li class="row" style="justify-content:space-between"><span>${esc(evLabel(e.key))}</span><span>${num(e.count)}${e.avg_value ? ` · média ${String(e.avg_value).replace(".", ",")}` : ""}</span></li>`).join("")}</ul>` : `<p class="small muted" style="margin-top:8px">Nenhum evento na janela.</p>`}
      <p class="note">${esc(d.note)} Sem dados pessoais: só rotas normalizadas, status e tempos.</p></section>`;
}
