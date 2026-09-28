/* Telas do MVP (Dossiê §9 e §47; Plano técnico §12). Toda saída tributária é rotulada como estimativa. */
import { api, DEMO, ApiError } from "./api.js";
import { onLogin, themeSwitch, theme } from "./app.js";
import { validateSignup, maskPhone, STAGES } from "./crm_rules.js";
import { areaChart, barChart, brl, confidence, donut, dt, dtm, empty, esc, hbars, icon, mes, num, PALETTE, pct, sevLabel, toast } from "./ui.js";

const trust = txt => `<p class="trust-line">${icon("info")}<span>${txt}</span></p>`;
const badge = (s, label) => `<span class="badge b-${esc(s)}">${esc(label || s.replace("_", " "))}</span>`;
const go = h => { location.hash = h; };
const problemMsg = e => e instanceof ApiError ? (e.problem.detail || e.problem.title) + (e.problem.errors?.length ? " — " + e.problem.errors.map(x => x.msg).join("; ") : "") : String(e.message || e);

/* ================================================================ AUTH */
function authLayout(inner) {
  return `<div class="auth">
    <div class="auth__art" aria-hidden="true"><div><p class="eyebrow" style="color:#c6d3e0">Seu dinheiro gera dados.</p>
      <h2>Nossa inteligência mostra o que eles significam.</h2><p>Consolide, analise, simule e antecipe cenários financeiros e tributários.</p></div></div>
    <div class="auth__form">${inner}</div></div>`;
}

export async function login(root, r) {
  root.innerHTML = authLayout(`
    <a href="../index.html" class="muted small">← Voltar ao site</a>
    <h1>Entrar</h1>
    ${DEMO ? trust("Modo demonstração: a conta de cliente <b>demo@ramon.app</b> já vem preenchida. O dono da plataforma entra com o próprio e-mail.") : ""}
    <form id="f" class="stack" novalidate>
      <div class="field"><label for="email">E-mail</label><input class="input" id="email" type="email" autocomplete="username" required value="${DEMO ? "demo@ramon.app" : ""}"></div>
      <div class="field"><label for="pw">Senha</label><input class="input" id="pw" type="password" autocomplete="current-password" required value="${DEMO ? "demo2026ramon" : ""}"></div>
      <p class="err" id="err" role="alert"></p>
      <button class="btn btn--primary" style="width:100%;height:44px">Entrar</button>
    </form>
    <p class="small muted">Ainda não tem conta? <a href="#/cadastro">Começar agora</a></p>
    ${trust("Nunca pedimos senha de banco. Conexões com instituições acontecem pelo Open Finance, com autenticação feita na própria instituição.")}
    <div>${themeSwitch()}</div>`);
  root.querySelector("#f").addEventListener("submit", async e => {
    e.preventDefault();
    const btn = e.target.querySelector("button"); btn.disabled = true;
    try {
      const res = await api.post("/v1/auth/login", { email: root.querySelector("#email").value, password: root.querySelector("#pw").value });
      onLogin(res.token, res.user);
      go("#/" + (res.user.roles?.includes("admin") ? "crm" : (r.params.get("next") || "dashboard")));
    } catch (err) { root.querySelector("#err").textContent = problemMsg(err); btn.disabled = false; }
  });
}

export async function register(root, r) {
  const plan = r.params.get("plano") || "free";
  const state = { step: 1, data: { plan: DEMO ? "pro" : plan, objetivos: [], perfil: {} } };
  const draw = () => {
    const s = state.step;
    root.innerHTML = authLayout(`
      <a href="../index.html" class="muted small">← Voltar ao site</a>
      <div class="steps" aria-label="Etapa ${s} de 3">${[1, 2, 3].map(i => `<i class="${i <= s ? "on" : ""}"></i>`).join("")}</div>
      <h1>${["Crie sua conta", "Seus objetivos", "Seu perfil"][s - 1]}</h1>
      <form id="f" class="stack" novalidate>${[step1, step2, step3][s - 1]()}
        <p class="err" id="err" role="alert"></p>
        <div class="row between">${s > 1 ? `<button type="button" class="btn btn--ghost" id="back">Voltar</button>` : "<span></span>"}
          <button class="btn btn--primary">${s < 3 ? "Continuar" : "Gerar meu primeiro diagnóstico"}</button></div>
      </form>
      <p class="small muted">Já tem conta? <a href="#/entrar">Entrar</a> · Plano escolhido: <b>${esc(plan.toUpperCase())}</b>${DEMO ? " (demo usa Pro)" : ""}</p>`);
    root.querySelector("#back")?.addEventListener("click", () => { state.step--; draw(); });
    root.querySelector("#phone")?.addEventListener("input", e => { e.target.value = maskPhone(e.target.value); });
    root.querySelector("#f").addEventListener("submit", submit);
  };
  const d = state.data;
  const step1 = () => `
    <p class="small muted">Todos os campos são obrigatórios.</p>
    <div class="field"><label for="name">Nome completo *</label><input class="input" id="name" autocomplete="name" required value="${esc(d.name || "")}" placeholder="Nome e sobrenome"></div>
    <div class="field"><label for="email">E-mail *</label><input class="input" id="email" type="email" autocomplete="email" required value="${esc(d.email || "")}"></div>
    <div class="form-grid">
      <div class="field"><label for="profession">Profissão *</label><input class="input" id="profession" list="profs" required maxlength="80" value="${esc(d.profession || "")}" placeholder="Ex.: Médico, Advogada">
        <datalist id="profs">${["Médico(a)", "Dentista", "Advogado(a)", "Engenheiro(a)", "Empresário(a)", "Arquiteto(a)", "Contador(a)", "Servidor(a) público(a)", "Psicólogo(a)", "Fisioterapeuta", "Produtor(a) rural", "Analista de sistemas"].map(p => `<option value="${p}">`).join("")}</datalist></div>
      <div class="field"><label for="phone">Telefone (WhatsApp) *</label><input class="input" id="phone" type="tel" autocomplete="tel-national" inputmode="numeric" required value="${esc(d.phone || "")}" placeholder="(69) 99999-9999"></div>
    </div>
    <div class="field"><label for="pw">Senha *</label><input class="input" id="pw" type="password" autocomplete="new-password" minlength="10" required>
      <span class="small muted">10+ caracteres, com letras e números.</span></div>
    <label class="check"><input type="checkbox" id="terms" ${d.accept_terms ? "checked" : ""}> Li e aceito os Termos de Uso e a Política de Privacidade (LGPD). Meus dados de contato serão usados para atendimento e acompanhamento da assinatura.</label>`;
  const step2 = () => `<p class="muted small">Selecione o que é mais importante para você.</p><div class="opt-grid">
    ${["Organizar finanças", "Acompanhar investimentos", "Entender impostos", "Planejar patrimônio"].map(o =>
      `<label class="opt"><input type="checkbox" name="obj" value="${o}" ${d.objetivos.includes(o) ? "checked" : ""}> ${o}</label>`).join("")}</div>`;
  const sel = (id, label, opts) => `<div class="field"><label for="${id}">${label}</label><select class="input" id="${id}">${opts.map(o => `<option ${d.perfil[id] === o ? "selected" : ""}>${o}</option>`).join("")}</select></div>`;
  const step3 = () => `<div class="form-grid">
    ${sel("renda", "Faixa de renda mensal", ["Até R$ 10 mil", "R$ 10–30 mil", "R$ 30–60 mil", "Acima de R$ 60 mil"])}
    ${sel("patrimonio", "Faixa de patrimônio", ["Até R$ 100 mil", "R$ 100 mil–500 mil", "R$ 500 mil–2 mi", "Acima de R$ 2 mi"])}
    ${sel("rv", "Opera renda variável?", ["Sim", "Não"])}${sel("prev", "Tem previdência (PGBL/VGBL)?", ["Sim", "Não"])}
    ${sel("ir", "Declara IR?", ["Sim, completa", "Sim, simplificada", "Não"])}${sel("contador", "Tem contador?", ["Sim", "Não"])}</div>
    ${trust("Esses dados só personalizam o diagnóstico. Você pode corrigi-los ou excluí-los a qualquer momento.")}`;
  async function submit(e) {
    e.preventDefault();
    const err = root.querySelector("#err"); err.textContent = "";
    if (state.step === 1) {
      Object.assign(d, { name: root.querySelector("#name").value.trim(), email: root.querySelector("#email").value.trim(),
        profession: root.querySelector("#profession").value.trim(), phone: root.querySelector("#phone").value,
        password: root.querySelector("#pw").value, accept_terms: root.querySelector("#terms").checked });
      const errs = validateSignup(d);
      root.querySelectorAll(".input").forEach(i => i.removeAttribute("aria-invalid"));
      errs.forEach(x => root.querySelector("#" + ({ password: "pw", accept_terms: "terms" }[x.field] || x.field))?.setAttribute("aria-invalid", "true"));
      if (errs.length) return err.textContent = errs.map(x => x.msg).join(" · ");
      state.step = 2; return draw();
    }
    if (state.step === 2) { d.objetivos = [...root.querySelectorAll("[name=obj]:checked")].map(i => i.value); state.step = 3; return draw(); }
    ["renda", "patrimonio", "rv", "prev", "ir", "contador"].forEach(k => d.perfil[k] = root.querySelector("#" + k).value);
    const btn = e.target.querySelector(".btn--primary"); btn.disabled = true; btn.textContent = "Criando conta…";
    try {
      const res = await api.post("/v1/auth/register", { name: d.name, email: d.email, profession: d.profession, phone: d.phone,
        password: d.password, accept_terms: d.accept_terms, plan: d.plan, origin: "site" });
      onLogin(res.token, res.user);
      toast("Conta criada. Este é o seu primeiro diagnóstico.");
      go("#/dashboard?primeiro=1");
    } catch (x) { state.step = 1; draw(); root.querySelector("#err").textContent = problemMsg(x); }
  }
  draw();
}

/* ================================================================ DASHBOARD */
export async function dashboard(el, r) {
  const d = await api.get("/v1/dashboard");
  const tax = d.tax, nw = d.net_worth;
  const up = nw.variation_pct >= 0;
  el.innerHTML = `
    <div class="row between wrap" style="margin-bottom:18px">
      <div class="hello"><h2>Olá, ${esc(d.greeting)}!</h2><p>Aqui está um resumo da sua vida financeira.</p></div>
      <span class="chip">Referência: ${dt(d.reference_date)}</span></div>
    ${r.params.get("primeiro") ? `<div class="card" style="margin-bottom:16px;border-color:var(--brand-2)"><h3>${icon("ai")} Seu primeiro diagnóstico</h3>
      <p class="small muted" style="margin-top:6px">Conecte instituições em <a href="#/conexoes">Conexões</a> ou envie notas de corretagem e extratos em <a href="#/documentos">Documentos</a> para que os motores consolidem seus dados.</p></div>` : ""}
    <div class="grid g-dash">
      <section class="card" aria-labelledby="k1"><h3 id="k1">Patrimônio total</h3>
        <div class="kpi">${brl(nw.total)}</div>
        <span class="delta ${up ? "delta--up" : "delta--down"}">${up ? "▲" : "▼"} ${pct(Math.abs(nw.variation_pct))}</span>
        ${areaChart(nw.series.map(s => +s.value), { label: "Evolução patrimonial estimada nos últimos meses" })}
        <p class="note">Evolução ${esc(nw.series_kind)}.</p></section>
      <section class="card" aria-labelledby="k2"><h3 id="k2">Impostos estimados (ano) <span class="right small muted">${esc(tax.scope)}</span></h3>
        <div class="kpi">${brl(tax.estimated)}</div>
        <span class="delta delta--neutral">Isento no ano: ${brl(tax.exempt)}</span>
        ${barChart(tax.monthly.map(m => ({ label: mes(m.month).split("/")[0], value: m.value })), { h: 90, label: "Imposto estimado por mês" })}
        <div class="row between" style="margin-top:8px"><span class="note" style="margin:0">Estimativa · não é valor pago</span>${confidence(tax.confidence)}</div></section>
      <section class="card" aria-labelledby="k3"><h3 id="k3">Alertas</h3>
        <div class="kpi ${d.alerts.open ? "kpi--neg" : ""}" style="font-size:30px">${d.alerts.open}</div>
        <p class="muted small">pontos de atenção${d.alerts.critical ? ` · <b style="color:var(--neg)">${d.alerts.critical} prioritário(s)</b>` : ""}</p>
        <a class="btn btn--ghost btn--sm" style="margin-top:14px" href="#/alertas">Ver radar ›</a></section>
    </div>
    <div class="grid g-dash2 section">
      <section class="card" aria-labelledby="k4"><h3 id="k4">Minha alocação</h3>
        <div class="row wrap" style="gap:24px;margin-top:14px">${donut(d.allocation, { label: "Composição do patrimônio por classe" })}
          <ul class="legend" style="flex:1;min-width:180px">${d.allocation.map((a, i) => `<li><i style="background:${PALETTE[i]}"></i><span>${esc(a.group)}</span><b>${pct(a.weight, 0)}</b></li>`).join("")}</ul></div></section>
      <section class="card" aria-labelledby="k5"><h3 id="k5">Próximas ações</h3>
        ${d.next_actions.length ? `<ul class="actions" style="margin-top:6px">${d.next_actions.map(a => `<li><span class="sev-ico sev-${a.severity}" aria-hidden="true">!</span>
          <div><b>${esc(a.title)}</b><span>${esc(a.detail)}</span></div>${a.action ? `<a class="btn btn--ghost btn--sm" href="#${a.action.route}">${esc(a.action.label)}</a>` : ""}</li>`).join("")}</ul>` : empty("Nenhuma ação pendente.")}</section>
    </div>
    <div class="grid g-3 section">
      <section class="card"><h3>O que mudou</h3>${d.changes.length ? `<ul class="stack" style="margin-top:12px">${d.changes.map(c =>
        `<li class="small"><b>${esc(c.category)}</b>: ${brl(c.last)} no último mês vs ${brl(c.baseline)} de referência <span class="${c.delta_pct > 0 ? "neg" : "pos"}">(${c.delta_pct > 0 ? "+" : ""}${pct(c.delta_pct, 0)})</span></li>`).join("")}</ul>` : `<p class="muted small" style="margin-top:10px">Sem mudanças relevantes no período.</p>`}</section>
      <section class="card"><h3>Liquidez</h3><div class="kpi">${brl(d.liquidity.cash)}</div>
        <p class="small muted">em conta · cobre ~${(d.liquidity.months_covered || 0).toFixed(1).replace(".", ",")} mês(es) da despesa média de ${brl(d.liquidity.avg_monthly_expense)}</p></section>
      <section class="card"><h3>Como calculamos</h3><p class="small muted" style="margin-top:8px">Os números vêm de motores determinísticos com regras versionadas. A IA apenas explica. Cada estimativa mostra premissas, fonte e confiança.</p>
        <a class="small" href="#/tributacao?tab=regras">Ver regras e fontes ›</a></section>
    </div>`;
}

/* ================================================================ PATRIMÔNIO */
export async function portfolio(el) {
  const p = await api.get("/v1/portfolio/consolidated");
  el.innerHTML = `
    <div class="grid g-4">
      <div class="card"><h3>Patrimônio consolidado</h3><div class="kpi">${brl(p.total)}</div></div>
      <div class="card"><h3>Valor aplicado</h3><div class="kpi">${brl(p.invested)}</div></div>
      <div class="card"><h3>Resultado</h3><div class="kpi ${+p.result < 0 ? "neg" : "pos"}">${brl(p.result)}</div><span class="delta ${p.result_pct >= 0 ? "delta--up" : "delta--down"}">${pct(p.result_pct)}</span></div>
      <div class="card"><h3>Liquidez em até D+2</h3><div class="kpi">${pct(p.liquidity.share, 0)}</div><p class="small muted">${brl(p.liquidity.d2_or_less)}</p></div>
    </div>
    <div class="grid g-dash2 section">
      <section class="card"><h3>Composição</h3><div class="row wrap" style="gap:24px;margin-top:14px">${donut(p.allocation, { size: 170, label: "Composição por classe" })}
        <ul class="legend" style="flex:1;min-width:200px">${p.allocation.map((a, i) => `<li><i style="background:${PALETTE[i]}"></i><span>${esc(a.group)} · ${brl(a.value)}</span><b>${pct(a.weight)}</b></li>`).join("")}</ul></div></section>
      <section class="card"><h3>Concentração e custódia</h3>
        <p class="small" style="margin-top:10px">Maior posição: <b>${esc(p.concentration.largest_position)}</b> (${pct(p.concentration.largest_weight)}) · índice HHI ${String(p.concentration.hhi).replace(".", ",")}</p>
        <p class="note">${esc(p.concentration.reading)}.</p>
        ${hbars(p.by_custodian.map(c => ({ label: c.custodian, value: c.value })))}</section>
    </div>
    <section class="card section"><h3>Posições <span class="right small muted">${p.positions.length} ativos</span></h3>
      <div class="table-wrap"><table class="table" style="margin-top:10px"><caption class="sr-only">Posições consolidadas</caption>
      <thead><tr><th>Ativo</th><th>Classe</th><th>Custódia</th><th class="num">Qtd.</th><th class="num">Aplicado</th><th class="num">Valor</th><th class="num">Resultado</th><th class="num">Peso</th><th>Origem</th></tr></thead>
      <tbody>${p.positions.map(x => `<tr><td><b>${esc(x.name)}</b></td><td>${esc(x.group)}</td><td>${esc(x.custodian)}</td><td class="num">${x.quantity === "1" ? "—" : num(x.quantity)}</td>
        <td class="num">${brl(x.invested)}</td><td class="num">${brl(x.value)}</td><td class="num ${+x.result < 0 ? "neg" : "pos"}">${brl(x.result)}</td><td class="num">${pct(x.weight)}</td>
        <td class="small muted">${esc(x.price_source)}${x.as_of ? " · " + dt(x.as_of) : ""}</td></tr>`).join("")}</tbody></table></div>
      ${trust("Informação descritiva. A plataforma não recomenda compra ou venda de ativos (fora do escopo do MVP e sujeita à regulação da CVM).")}</section>`;
}

/* ================================================================ FINANÇAS */
export async function finance(el) {
  const [f, tx] = await Promise.all([api.get("/v1/finance/summary"), api.get("/v1/finance/transactions?limit=60")]);
  el.innerHTML = `
    <div class="grid g-4">
      <div class="card"><h3>Entradas (${mes(f.period.from)}–${mes(f.period.to)})</h3><div class="kpi pos">${brl(f.totals.income)}</div></div>
      <div class="card"><h3>Saídas</h3><div class="kpi">${brl(f.totals.expense)}</div></div>
      <div class="card"><h3>Saldo do período</h3><div class="kpi">${brl(f.totals.net)}</div><span class="delta delta--neutral">Taxa de poupança ${pct(f.totals.savings_rate, 0)}</span></div>
      <div class="card"><h3>Saldo em contas</h3><div class="kpi">${brl(f.liquidity.cash)}</div><p class="small muted">${f.accounts.length} contas</p></div>
    </div>
    <div class="grid g-2 section">
      <section class="card"><h3>Fluxo mensal</h3>
        <div role="img" aria-label="Entradas e saídas por mês" style="display:flex;gap:10px;align-items:flex-end;height:150px;margin-top:14px">
        ${(() => { const mx = Math.max(...f.series.flatMap(s => [+s.income, +s.expense]), 1); return f.series.map(s => `<div style="flex:1;display:flex;flex-direction:column;align-items:center;gap:5px" title="${mes(s.month)}: +${brl(s.income)} / -${brl(s.expense)}">
          <div style="display:flex;gap:3px;align-items:flex-end;height:120px"><i style="width:10px;height:${+s.income / mx * 120}px;background:var(--c3);border-radius:3px"></i><i style="width:10px;height:${+s.expense / mx * 120}px;background:var(--c1);border-radius:3px"></i></div>
          <span class="small muted">${mes(s.month).split("/")[0]}</span></div>`).join(""); })()}</div>
        <p class="small muted" style="margin-top:8px"><span style="color:var(--c3)">■</span> Entradas <span style="color:var(--c1);margin-left:10px">■</span> Saídas · aplicações e faturas de cartão não entram como despesa</p></section>
      <section class="card"><h3>Despesas por categoria</h3>${hbars(f.by_category.slice(0, 7).map(c => ({ label: `${c.category} · ${pct(c.share, 0)}`, value: c.value })))}</section>
    </div>
    <div class="grid g-2 section">
      <section class="card"><h3>Recorrências detectadas</h3><ul class="stack small" style="margin-top:12px">${f.recurring.map(x => `<li class="row between"><span>${esc(x.description)} <span class="muted">· ${esc(x.category)}</span></span><b>${brl(x.monthly)}/mês</b></li>`).join("") || "<li class='muted'>Nenhuma.</li>"}</ul></section>
      <section class="card"><h3>Mudanças relevantes</h3>${f.changes.length ? `<ul class="stack small" style="margin-top:12px">${f.changes.map(c => `<li><b>${esc(c.category)}</b>: ${brl(c.last)} no último mês, contra ${brl(c.baseline)} de referência (${c.delta_pct > 0 ? "+" : ""}${pct(c.delta_pct, 0)}).</li>`).join("")}</ul>` : "<p class='small muted'>Sem mudanças relevantes.</p>"}
        <p class="note">${esc(f.reading)}.</p></section>
    </div>
    <section class="card section"><h3>Transações <span class="right small muted">${tx.total} no total</span></h3>
      <div class="table-wrap"><table class="table" style="margin-top:10px"><thead><tr><th>Data</th><th>Descrição</th><th>Categoria</th><th class="num">Valor</th><th>Origem</th></tr></thead>
      <tbody>${tx.items.map(t => `<tr><td>${dt(t.date)}</td><td>${esc(t.description)}</td><td>${esc(t.category)}</td><td class="num ${+t.amount < 0 ? "" : "pos"}">${brl(t.amount)}</td><td class="small muted">${esc(t.source)}</td></tr>`).join("")}</tbody></table></div></section>`;
}

/* ================================================================ TRIBUTAÇÃO */
export async function tax(el, r) {
  let tab = r.params.get("tab") || "resumo";
  let t, ev, rules;
  try { [t, ev, rules] = await Promise.all([api.get("/v1/tax/summary"), api.get("/v1/tax/events"), api.get("/v1/tax/rules")]); }
  catch (e) { if (e.status === 402) { el.innerHTML = upsell("Inteligência tributária", e); return; } throw e; }
  const losses = Object.entries(t.losses_available).filter(([, v]) => +v > 0);
  const draw = () => {
    el.innerHTML = `
      <div class="grid g-4">
        <div class="card"><h3>Imposto estimado ${t.year}</h3><div class="kpi">${brl(t.total_tax_due)}</div><p class="note">renda variável · estimativa</p></div>
        <div class="card"><h3>IRRF (dedo-duro)</h3><div class="kpi">${brl(t.total_irrf)}</div><p class="note">compensado na apuração</p></div>
        <div class="card"><h3>Ganhos isentos</h3><div class="kpi pos">${brl(t.total_exempt_gain)}</div><p class="note">vendas de ações ≤ R$ 20 mil/mês</p></div>
        <div class="card"><h3>Qualidade do cálculo</h3><div style="margin-top:14px">${confidence(t.confidence)}</div>
          <p class="note">${losses.length ? "Prejuízos: " + losses.map(([k, v]) => `${k} ${brl(v)}`).join(", ") : "Sem prejuízos a compensar"}</p></div>
      </div>
      <div class="tabs section" role="tablist">${[["resumo", "Apuração mensal"], ["eventos", "Eventos tributários"], ["regras", "Regras e fontes"]].map(([k, l]) =>
        `<button role="tab" aria-selected="${tab === k}" data-tab="${k}">${l}</button>`).join("")}</div>
      <div id="tabc">${tab === "resumo" ? months() : tab === "eventos" ? events() : rulesView()}</div>
      <div class="grid g-2 section">
        <section class="card"><h3>Premissas</h3><ul class="stack small" style="margin-top:10px">${t.premises.map(p => `<li>• ${esc(p)}</li>`).join("")}</ul></section>
        <section class="card"><h3>Limitações</h3><ul class="stack small" style="margin-top:10px">${t.limitations.map(p => `<li>• ${esc(p)}</li>`).join("")}</ul>
          <p class="note">Snapshot ${esc(t.snapshot_hash.slice(0, 16))}… · mesmo snapshot + mesma versão de regra = mesmo resultado.</p></section>
      </div>`;
    el.querySelectorAll("[data-tab]").forEach(b => b.onclick = () => { tab = b.dataset.tab; draw(); });
  };
  const months = () => `<section class="card"><div class="table-wrap"><table class="table"><caption class="sr-only">Apuração mensal de renda variável</caption>
    <thead><tr><th>Mês</th><th class="num">Vendas de ações</th><th>Isenção</th><th class="num">Resultado comum</th><th class="num">Day trade</th><th class="num">FII</th><th class="num">IR bruto</th><th class="num">IRRF</th><th>DARF 6015</th></tr></thead>
    <tbody>${t.months.map(m => `<tr><td><b>${mes(m.month)}</b></td><td class="num">${brl(m.sales_acoes)}</td><td>${m.exempt ? badge("isento", "até 20 mil") : badge("aberto", "tributável")}</td>
      <td class="num">${brl(m.result_comum)}${+m.exempt_gain ? `<div class="small pos">+${brl(m.exempt_gain)} isento</div>` : ""}</td><td class="num">${brl(m.result_daytrade)}</td><td class="num">${brl(m.result_fii)}</td>
      <td class="num">${brl(m.tax_due_gross)}</td><td class="num">${brl(m.irrf)}</td>
      <td>${m.darf ? `${badge(m.darf.status)} <b>${brl(m.darf.valor)}</b><div class="small muted">vence ${dt(m.darf.vencimento)}${m.darf.valor_pago ? " · pago " + brl(m.darf.valor_pago) : ""}</div>` : `<span class="small muted">${+m.tax_due_gross > 0 ? "acumula (< R$ 10)" : "—"}</span>`}</td></tr>`).join("")}</tbody></table></div></section>`;
  const events = () => ev.items.length ? `<div class="stack">${ev.items.map(e => `<article class="alert ${e.status === "pendente_dado" ? "s-alto" : e.status === "isento" ? "s-oportunidade" : "s-informativo"}">
      <h4>${esc(e.ticker)} · ${e.kind === "daytrade" ? "Day trade" : "Venda"} em ${dt(e.date)} ${badge(e.status)}</h4>
      <p>Valor de venda ${brl(e.sale_value)} · custo ${e.cost_basis === "?" ? "<b>não informado</b>" : brl(e.cost_basis)} · resultado <b class="${+e.result < 0 ? "neg" : ""}">${e.result === "?" ? "—" : brl(e.result)}</b></p>
      <div class="meta"><span>Regra ${esc(e.rule.code)} v${esc(e.rule.version)}</span><span>Fontes: ${esc(e.rule.sources.join(", "))}</span><span>Origem: ${esc(e.source)}</span>${confidence(e.confidence)}</div>
      ${e.notes.length ? `<div class="explain">${e.notes.map(esc).join("<br>")}</div>` : ""}</article>`).join("")}</div>` : empty("Nenhum evento tributário no ano.");
  const rulesView = () => `<div class="stack">${rules.items.map(x => `<article class="card">
      <h3>${esc(x.title)} <span class="right">${badge(x.status === "validated" ? "validado" : "pendente", x.status === "validated" ? "validada" : "pendente")}</span></h3>
      <p class="small muted" style="margin-top:6px">${esc(x.code)} · versão ${esc(x.version)} · vigência desde ${dt(x.validity.start)}${x.validity.end ? " até " + dt(x.validity.end) : ""}${x.usable_in_calculation ? "" : " · <b>não usada em cálculo</b>"}</p>
      <p class="small" style="margin-top:8px"><b>Fórmula:</b> ${esc(x.formula)}</p>
      ${x.exceptions.length ? `<p class="small" style="margin-top:6px"><b>Exceções:</b> ${x.exceptions.map(esc).join(" ")}</p>` : ""}
      ${x.sources.length ? `<p class="small" style="margin-top:6px"><b>Fontes:</b> ${x.sources.map(s => `<a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.id)} — ${esc(s.title)}</a>`).join("; ")}</p>` : ""}
    </article>`).join("")}<p class="note">${esc(rules.catalog.note)}</p></div>`;
  draw();
}

function upsell(what, e) {
  return `<div class="card" style="max-width:560px"><h3>${icon("plan")} ${esc(what)} faz parte do plano ${esc(e.problem?.required_plan || "Pro")}</h3>
    <p class="small muted" style="margin-top:8px">${esc(e.problem?.detail || "")}</p><a class="btn btn--primary" style="margin-top:14px" href="#/planos">Conhecer os planos</a></div>`;
}

/* ================================================================ SIMULADOR */
export async function simulator(el) {
  let pf, sims;
  try { [pf, sims] = await Promise.all([api.get("/v1/portfolio/consolidated"), api.get("/v1/simulations")]); }
  catch (e) { if (e.status === 402) { el.innerHTML = upsell("Simulação de cenários", e); return; } throw e; }
  const rv = pf.positions.filter(p => ["acao", "etf", "fii", "bdr"].includes(p.asset_class));
  let tab = "venda";
  const draw = () => {
    el.innerHTML = `
      <div class="tabs" role="tablist">${[["venda", "Venda de ativos"], ["pgbl", "Aporte em PGBL"]].map(([k, l]) => `<button role="tab" aria-selected="${tab === k}" data-tab="${k}">${l}</button>`).join("")}</div>
      <div class="grid g-dash2"><section class="card">${tab === "venda" ? saleForm() : pgblForm()}<p class="err" id="err" role="alert"></p></section>
        <section class="card"><h3>Como funciona</h3><p class="small muted" style="margin-top:8px">O simulador compara o <b>cenário atual</b> com uma alternativa e mostra imposto estimado, liquidez gerada, diferença e premissas.
          O resultado é reprodutível (hash de versão) e usa as mesmas regras da Central Tributária. <b>O sistema mostra consequências; quem decide é você ou seu contador.</b></p>
          ${trust("Não é recomendação de investimento. Perguntas do tipo “devo vender?” não são respondidas pela plataforma.")}</section></div>
      <div id="out" class="section"></div>
      ${sims.items.length ? `<section class="card section"><h3>Simulações salvas</h3><ul class="stack small" style="margin-top:10px">${sims.items.slice(0, 6).map(s =>
        `<li class="row between"><span>${esc(s.kind === "pgbl" ? "Aporte PGBL" : s.results?.[1]?.name || "Venda")} · ${dtm(s.created_at)}</span><code class="muted">${esc((s.reproducibility_hash || "").slice(0, 10))}</code></li>`).join("")}</ul></section>` : ""}`;
    el.querySelectorAll("[data-tab]").forEach(b => b.onclick = () => { tab = b.dataset.tab; draw(); });
    el.querySelector("#sf")?.addEventListener("submit", runSale);
    el.querySelector("#pf")?.addEventListener("submit", runPgbl);
    el.querySelector("#tk")?.addEventListener("change", hint); hint();
  };
  const saleForm = () => `<h3>Cenário alternativo: vender parte de uma posição</h3>
    <form id="sf" class="stack" style="margin-top:12px"><div class="form-grid">
      <div class="field"><label for="tk">Ativo</label><select class="input" id="tk">${rv.map(p => `<option value="${esc(p.asset_id)}" data-q="${p.quantity}">${esc(p.name)} · ${num(p.quantity)} un.</option>`).join("")}</select></div>
      <div class="field"><label for="fr">Quantidade</label><select class="input" id="fr">${[25, 50, 75, 100].map(f => `<option value="${f}">${f}% da posição</option>`).join("")}</select><span class="small muted" id="qh"></span></div>
      <div class="field"><label for="dd">Data da venda</label><select class="input" id="dd"><option value="2026-09-29">29/09/2026 (mês atual)</option><option value="2026-10-15">15/10/2026 (próximo mês)</option></select></div>
      ${DEMO ? "" : `<div class="field"><label for="pr">Preço (opcional)</label><input class="input" id="pr" inputmode="decimal" placeholder="última cotação"></div>`}
    </div><button class="btn btn--primary">Simular impacto</button></form>`;
  const pgblForm = () => `<h3>Cenário: aporte adicional em PGBL</h3>
    <form id="pf" class="stack" style="margin-top:12px"><div class="form-grid">
      <div class="field"><label for="inc">Rendimentos tributáveis no ano (R$)</label><input class="input" id="inc" inputmode="decimal" value="420000"></div>
      <div class="field"><label for="cur">Contribuições PGBL já feitas (R$)</label><input class="input" id="cur" inputmode="decimal" value="18000"></div>
      <div class="field"><label for="ext">Aporte adicional (R$)</label><input class="input" id="ext" inputmode="decimal" value="30000"></div>
      <div class="field"><label for="rate">Alíquota marginal (premissa)</label><select class="input" id="rate"><option value="0.275">27,5%</option><option value="0.225">22,5%</option><option value="0.15">15%</option><option value="0.075">7,5%</option></select></div>
    </div><label class="check"><input type="checkbox" id="full" checked> Declaração no modelo completo</label>
    <label class="check"><input type="checkbox" id="inss" checked> Contribuo para o INSS ou regime próprio</label>
    <button class="btn btn--primary">Simular dedução</button></form>`;
  function hint() {
    const s = el.querySelector("#tk"); if (!s) return;
    const q = +s.selectedOptions[0]?.dataset.q || 0, f = +el.querySelector("#fr").value;
    el.querySelector("#qh").textContent = `≈ ${num(Math.floor(q * f / 100))} unidades`;
    el.querySelector("#fr").onchange = hint;
  }
  async function runSale(e) {
    e.preventDefault();
    const tk = el.querySelector("#tk").value, fr = +el.querySelector("#fr").value, date = el.querySelector("#dd").value;
    const q = Math.floor(+el.querySelector("#tk").selectedOptions[0].dataset.q * fr / 100);
    const price = el.querySelector("#pr")?.value.replace(".", "").replace(",", ".");
    await run({ kind: "venda_ativos", scenarios: [{ name: `Vender ${q} ${tk} em ${dt(date)}`, operations: [{ ticker: tk, quantity: q, fraction: fr, date, ...(price ? { price } : {}) }] }] });
  }
  async function runPgbl(e) {
    e.preventDefault();
    const v = id => el.querySelector("#" + id).value.replace(/\./g, "").replace(",", ".");
    await run({ kind: "pgbl", taxable_income: v("inc"), current_contributions: v("cur"), extra_contribution: v("ext"), marginal_rate: v("rate"),
                full_model: el.querySelector("#full").checked, contributes_social_security: el.querySelector("#inss").checked });
  }
  async function run(body) {
    const out = el.querySelector("#out"), err = el.querySelector("#err"); err.textContent = ""; out.innerHTML = `<div class="skeleton" style="height:120px"></div>`;
    try {
      const res = await api.post("/v1/simulations", body, { "Idempotency-Key": crypto.randomUUID?.() || String(Date.now()) });
      out.innerHTML = res.kind === "pgbl" ? pgblOut(res) : saleOut(res);
      out.scrollIntoView({ behavior: "smooth", block: "start" });
    } catch (x) { out.innerHTML = ""; err.textContent = problemMsg(x); }
  }
  const saleOut = res => `<div class="grid g-2">${res.results.map(s => `<section class="card" ${s.key !== "base" ? 'style="border-color:var(--brand-2)"' : ""}>
      <h3>${esc(s.name)}</h3><div class="kpi">${brl(s.tax_year)}</div><p class="small muted">imposto estimado no ano (renda variável)</p>
      ${s.tax_difference_vs_base !== undefined ? `<p style="margin-top:10px">Diferença vs. atual: <b class="${+s.tax_difference_vs_base > 0 ? "neg" : "pos"}">${+s.tax_difference_vs_base > 0 ? "+" : ""}${brl(s.tax_difference_vs_base)}</b></p>
        <p class="small">Liquidez gerada ${brl(s.liquidity_generated)} · líquida após imposto adicional ${brl(s.net_liquidity_after_tax)}</p>
        ${s.months.map(m => `<p class="small muted" style="margin-top:6px">${mes(m.month)}: vendas de ações ${brl(m.sales_acoes)} (${m.exempt ? "dentro" : "acima"} do limite de isenção) · IR do mês ${brl(m.tax_due_gross)}</p>`).join("")}` : `<p class="small muted" style="margin-top:10px">Ganhos isentos no ano ${brl(s.exempt_gain_year)}</p>`}
      <div style="margin-top:10px">${confidence(s.confidence)}</div></section>`).join("")}</div>
    <section class="card section"><details><summary>Premissas, limitações e versões das regras</summary><ul class="stack small" style="margin-top:10px">${[...res.premises, ...res.limitations].map(p => `<li>• ${esc(p)}</li>`).join("")}
      <li>• Regras: ${Object.entries(res.rule_versions).map(([k, v]) => `${esc(k)} v${esc(v)}`).join(", ")}</li><li>• Hash de reprodutibilidade: <code>${esc(res.reproducibility_hash)}</code></li></ul></details>
      <p class="note">${esc(res.disclaimer)}</p></section>`;
  const pgblOut = res => `<div class="grid g-2">${res.results.map((s, i) => `<section class="card" ${i ? 'style="border-color:var(--brand-2)"' : ""}><h3>${esc(s.name)}</h3>
      <div class="kpi">${brl(s.deductible)}</div><p class="small muted">dedutível (limite 12%: ${brl(res.limit_12pct)})</p>
      <p class="small" style="margin-top:8px">Contribuições ${brl(s.contributions)} · efeito estimado no IR ${brl(s.tax_effect_estimate)}</p></section>`).join("")}</div>
    <section class="card section"><h3>Diferença estimada: ${brl(res.difference)}</h3><ul class="stack small" style="margin-top:10px">${res.premises.map(p => `<li>• ${esc(p)}</li>`).join("")}</ul>
      <p class="small muted" style="margin-top:8px">Regra ${esc(res.rule.code)} v${esc(res.rule.version)} · fontes ${esc(res.rule.sources.join(", "))} · ${confidence(res.confidence)}</p><p class="note">${esc(res.disclaimer)}</p></section>`;
  draw();
}

/* ================================================================ ALERTAS */
export async function alerts(el, r, ctx) {
  const res = await api.get("/v1/alerts");
  let filter = "abertos";
  const draw = () => {
    const items = res.items.filter(a => filter === "todos" || (filter === "abertos" ? a.status !== "resolvido" : a.status === "resolvido"));
    el.innerHTML = `
      <div class="row between wrap" style="margin-bottom:14px"><p class="muted small">Priorização: impacto × urgência × relevância × confiança. Cor sempre acompanhada de rótulo e ícone.</p>
        <div class="theme-switch" role="group" aria-label="Filtro">${[["abertos", "Em aberto"], ["resolvidos", "Resolvidos"], ["todos", "Todos"]].map(([k, l]) => `<button type="button" aria-pressed="${filter === k}" data-f="${k}">${l}</button>`).join("")}</div></div>
      ${res.limited ? `<div class="trust-line" style="margin-bottom:12px">${icon("info")}<span>Plano Free mostra até 3 alertas. <a href="#/planos">Radar completo no Pro</a>.</span></div>` : ""}
      <div class="stack">${items.length ? items.map(a => `<article class="alert s-${a.severity} ${a.status === "resolvido" ? "is-resolved" : ""}" aria-label="${esc(sevLabel[a.severity])}: ${esc(a.title)}">
        <h4><span class="sev-ico sev-${a.severity}" style="width:22px;height:22px;font-size:11px" aria-hidden="true">!</span>${esc(a.title)} ${badge(a.severity, sevLabel[a.severity])} ${a.status !== "novo" ? badge(a.status === "resolvido" ? "pago" : "classificado", a.status) : ""}</h4>
        <p>${esc(a.detail)}</p>
        ${a.evidence?.length ? `<div class="evidence">${a.evidence.map(e => `<span>${esc(e.label)}: <b>${/^-?\d+\.\d{2}$/.test(e.value) ? brl(e.value) : esc(e.value)}</b></span>`).join("")}</div>` : ""}
        <div class="meta"><span>Prioridade ${String(a.priority).replace(".", ",")}</span><span>Impacto ${pct(a.impact, 0)} · Urgência ${pct(a.urgency, 0)} · Relevância ${pct(a.relevance, 0)}</span>${confidence(a.confidence)}${a.rule ? `<span>Regra ${esc(a.rule.code)} v${esc(a.rule.version)}</span>` : ""}${a.due_date ? `<span>Prazo ${dt(a.due_date)}</span>` : ""}</div>
        <div class="row wrap" style="margin-top:12px;gap:8px">${a.action ? `<a class="btn btn--primary btn--sm" href="#${a.action.route}">${esc(a.action.label)}</a>` : ""}
          ${a.status === "novo" ? `<button class="btn btn--ghost btn--sm" data-st="visto" data-id="${a.id}">Marcar como visto</button>` : ""}
          ${a.status !== "resolvido" ? `<button class="btn btn--ghost btn--sm" data-st="resolvido" data-id="${a.id}">Resolver</button>` : `<button class="btn btn--ghost btn--sm" data-st="novo" data-id="${a.id}">Reabrir</button>`}
          <a class="btn btn--ghost btn--sm" href="#/assistente?q=${encodeURIComponent("Explique: " + a.title)}">Explicar com IA</a></div></article>`).join("") : empty("Nada por aqui.")}</div>`;
    el.querySelectorAll("[data-f]").forEach(b => b.onclick = () => { filter = b.dataset.f; draw(); });
    el.querySelectorAll("[data-st]").forEach(b => b.onclick = async () => {
      await api.patch(`/v1/alerts/${b.dataset.id}`, { status: b.dataset.st });
      res.items.find(a => a.id === b.dataset.id).status = b.dataset.st; draw();
      const n = res.items.filter(a => a.status === "novo").length, c = document.querySelector("[data-alert-count]");
      if (c) { c.textContent = n; c.hidden = !n; } const d = document.querySelector("[data-dot]"); if (d) d.hidden = !n;
    });
  };
  draw();
}

/* ================================================================ DOCUMENTOS */
export async function documents(el) {
  const res = await api.get("/v1/documents");
  el.innerHTML = `
    <section class="card"><h3>${icon("upload")} Enviar documento</h3>
      <p class="small muted" style="margin-top:6px">PDF, PNG, JPG ou CSV até 10 MB. CSV de notas de corretagem ou extratos é importado automaticamente (colunas em docs/connectors/modelos-csv.md). Arquivos passam por validação de extensão, tipo e conteúdo.</p>
      <form id="uf" class="row wrap" style="margin-top:12px;gap:10px"><label class="sr-only" for="file">Arquivo</label><input class="input" style="max-width:420px;padding-top:7px" type="file" id="file" accept=".pdf,.png,.jpg,.jpeg,.csv" required>
        <button class="btn btn--primary">Enviar</button></form><p class="err" id="err" role="alert"></p></section>
    <section class="card section"><h3>Meus documentos</h3>
      <p class="small muted" style="margin-top:4px">Fluxo: recebido → classificado → extraído → validado → utilizado.</p>
      <div class="table-wrap"><table class="table" style="margin-top:10px"><thead><tr><th>Documento</th><th>Tipo</th><th>Status</th><th>Detalhe</th><th>Recebido</th></tr></thead>
      <tbody>${res.items.map(d => `<tr><td><b>${esc(d.title)}</b><div class="small muted">${esc(d.filename)}</div></td><td>${esc(d.kind.replace("_", " "))}</td><td>${badge(d.status)}</td>
        <td class="small">${esc(d.detail || (d.extraction?.accepted !== undefined ? `${d.extraction.accepted} registros importados, ${d.extraction.duplicates} duplicados` : ""))}</td><td class="small muted">${d.size ? dtm(d.uploaded_at) : "aguardando envio"}</td></tr>`).join("")}</tbody></table></div></section>`;
  el.querySelector("#uf").addEventListener("submit", async e => {
    e.preventDefault();
    const f = el.querySelector("#file").files[0], err = el.querySelector("#err"); err.textContent = "";
    if (!f) return;
    if (f.size > 10 * 1024 * 1024) return err.textContent = "Arquivo acima de 10 MB.";
    const b64 = await new Promise((ok, ko) => { const r = new FileReader(); r.onload = () => ok(String(r.result).split(",")[1]); r.onerror = ko; r.readAsDataURL(f); });
    try { const d = await api.post("/v1/documents", { filename: f.name, mime: f.type, content_base64: b64, size: f.size }); toast(`${d.title} recebido (${d.status}).`); documents(el); }
    catch (x) { err.textContent = problemMsg(x); }
  });
}

/* ================================================================ CONEXÕES */
export async function connections(el, r) {
  if (r.sub === "retorno") return connectReturn(el, r);
  const [res, inst] = await Promise.all([api.get("/v1/connections"), api.get("/v1/institutions")]);
  const labels = { accounts: "Contas e saldos", transactions: "Transações", credit_cards: "Cartões de crédito", investments: "Investimentos (Open Investment)" };
  el.innerHTML = `
    <div class="row between wrap" style="margin-bottom:14px"><p class="muted small" style="max-width:720px">Instituições conectadas via Open Finance / Open Investment. Você escolhe o escopo, vê a finalidade e o prazo, e pode revogar a qualquer momento.
      Adaptador em modo <b>${esc(res.adapter.mode)}</b>${res.adapter.production_ready ? "" : " — produção depende do provedor/estrutura regulatória (decisão pendente D-01)"}.</p>
      <button class="btn btn--primary" id="add">+ Conectar instituição</button></div>
    <div id="wizard"></div>
    <div class="grid g-3">${res.items.map(c => `<article class="card">
      <h3>${esc(c.institution)} <span class="right">${badge(c.status)}</span></h3>
      <p class="small muted" style="margin-top:4px">${esc(c.institution_type)} · modo ${esc(c.mode)}</p>
      <ul class="stack small" style="margin-top:12px">
        <li><b>Escopo:</b> ${c.scope.map(s => esc(labels[s] || s)).join(", ")}</li>
        <li><b>Finalidade:</b> ${esc(c.consent.purpose)}</li>
        <li><b>Consentimento válido até:</b> ${dt(c.consent.expires_at)}</li>
        <li><b>Última atualização:</b> ${dtm(c.last_sync_at)}</li>
        <li><b>Qualidade dos dados:</b> ${c.data_quality_score != null ? pct(c.data_quality_score, 0) : "—"}${c.error_code ? ` · erro ${esc(c.error_code)}` : ""}</li></ul>
      <div class="row wrap" style="gap:8px;margin-top:14px">
        <button class="btn btn--ghost btn--sm" data-refresh="${c.id}" ${c.status === "revogado" ? "disabled" : ""}>Atualizar</button>
        <details><summary class="btn btn--ghost btn--sm" style="list-style:none">Gerenciar acesso</summary><div class="small muted" style="margin-top:8px">Histórico: ${(c.sync_runs || []).map(s => `${dtm(s.started_at)} (${esc(s.result)})`).join("; ") || "—"}<br>Para alterar o escopo, revogue e conecte novamente.</div></details>
        ${c.status !== "revogado" ? `<button class="btn btn--danger btn--sm" data-revoke="${c.id}">Revogar</button>` : ""}</div></article>`).join("") || empty("Nenhuma instituição conectada.", "link")}</div>
    <section class="card section"><h3>Matriz de cobertura <span class="right small muted">v${esc(inst.version)}</span></h3><p class="note">${esc(inst.reference)}</p>
      <div class="table-wrap"><table class="table" style="margin-top:8px"><thead><tr><th>Instituição</th><th>Tipo</th><th>Contas</th><th>Investimentos</th><th>Classes</th><th>Último teste</th><th>Status</th><th>Prioridade</th></tr></thead>
      <tbody>${inst.institutions.map(i => `<tr><td>${esc(i.name)}</td><td>${esc(i.type)}</td><td>${i.accounts ? "Sim" : "Não"}</td><td>${i.investments ? "Sim" : "Não"}</td><td class="small">${esc(i.classes.join(", "))}</td><td>${i.last_test ? dt(i.last_test) : "—"}</td><td>${esc(i.status)}</td><td>${esc(i.priority)}</td></tr>`).join("")}</tbody></table></div></section>
    ${trust("Nunca solicitamos senha, token ou credencial bancária. A autenticação acontece no ambiente da instituição transmissora e o compartilhamento é feito diretamente entre as instituições.")}`;
  el.querySelectorAll("[data-refresh]").forEach(b => b.onclick = async () => { b.disabled = true; try { const x = await api.post(`/v1/connections/${b.dataset.refresh}/refresh`); toast(`Sincronizado: ${x.connection.institution}`); connections(el, r); } catch (e) { toast(problemMsg(e)); b.disabled = false; } });
  el.querySelectorAll("[data-revoke]").forEach(b => b.onclick = async () => {
    if (!confirm("Revogar o consentimento? A instituição deixará de compartilhar dados e a conexão ficará inativa.")) return;
    await api.post(`/v1/connections/${b.dataset.revoke}/revoke`); toast("Consentimento revogado."); connections(el, r);
  });
  el.querySelector("#add").onclick = () => {
    const w = el.querySelector("#wizard");
    w.innerHTML = `<section class="card" style="margin-bottom:16px;border-color:var(--brand-2)"><h3>Conectar instituição · etapa 1 de 3</h3>
      <form id="cf" class="stack" style="margin-top:12px"><div class="field"><label for="ins">Instituição</label><select class="input" id="ins" style="max-width:360px">${inst.institutions.map(i => `<option value="${i.id}">${esc(i.name)} (${esc(i.type)})</option>`).join("")}</select></div>
      <fieldset class="stack"><legend class="small" style="font-weight:600">Dados que você autoriza compartilhar</legend>${Object.entries(labels).map(([k, l]) => `<label class="check"><input type="checkbox" name="sc" value="${k}" ${k !== "credit_cards" ? "checked" : ""}> ${l}</label>`).join("")}</fieldset>
      <div class="trust-line">${icon("shield")}<span><b>Finalidade:</b> consolidar contas e investimentos para diagnóstico financeiro e tributário. <b>Prazo:</b> 12 meses, renovável. Você pode revogar quando quiser.</span></div>
      <p class="err" id="cerr"></p><div class="row" style="gap:8px"><button class="btn btn--primary">Continuar para a instituição</button><button type="button" class="btn btn--ghost" id="cx">Cancelar</button></div></form></section>`;
    w.querySelector("#cx").onclick = () => w.innerHTML = "";
    w.querySelector("#cf").onsubmit = async e => {
      e.preventDefault();
      try { const x = await api.post("/v1/connections/consents", { institution_id: w.querySelector("#ins").value, scope: [...w.querySelectorAll("[name=sc]:checked")].map(i => i.value) }); location.hash = x.redirect_url; }
      catch (x) { w.querySelector("#cerr").textContent = problemMsg(x); }
    };
  };
}

async function connectReturn(el, r) {
  const inst = (await api.get("/v1/institutions")).institutions.find(i => i.id === r.params.get("institution"));
  el.innerHTML = `<section class="card" style="max-width:620px;margin:0 auto">
    <p class="eyebrow">Ambiente da instituição · sandbox</p><h3 style="font-size:18px;margin-top:6px">${esc(inst?.name || "Instituição")}</h3>
    <p class="small muted" style="margin-top:8px">Em produção, esta etapa acontece no aplicativo ou site da instituição (etapa 2 de 3): você se autentica lá e confirma o compartilhamento. A plataforma nunca vê sua senha.</p>
    ${trust("Simulação de sandbox: nenhum dado real é acessado.")}
    <div class="row" style="gap:8px;margin-top:16px"><button class="btn btn--primary" id="ok">Autorizar compartilhamento</button><a class="btn btn--ghost" href="#/conexoes">Cancelar</a></div><p class="err" id="e"></p></section>`;
  el.querySelector("#ok").onclick = async () => {
    el.querySelector("#ok").disabled = true;
    try { const x = await api.post("/v1/connections/consents/confirm", { consent_id: r.params.get("consent") });
      toast(`Etapa 3 de 3: ${x.connection.institution} conectada e sincronizada.`); location.hash = "#/conexoes"; }
    catch (x) { el.querySelector("#e").textContent = problemMsg(x); }
  };
}

/* ================================================================ ASSISTENTE */
export async function assistant(el, r) {
  const hist = [];
  el.innerHTML = `<div class="grid g-dash2" style="align-items:start">
    <section class="card"><div class="chat" id="chat"><div class="msg msg--ai">Olá! Eu explico o que os motores da plataforma calcularam — patrimônio, finanças, impostos estimados, alertas e simulações. Todo número vem de um motor, com evidência.</div></div>
      <form id="qf" class="row" style="gap:8px;margin-top:16px"><label class="sr-only" for="q">Pergunta</label><input class="input" id="q" maxlength="800" placeholder="Pergunte, por exemplo: Por que meu imposto aumentou?" autocomplete="off"><button class="btn btn--primary">Enviar</button></form>
      <div class="suggest" style="margin-top:12px">${["Por que meu imposto aumentou?", "O que mudou nos meus gastos?", "Quais alertas existem?", "Quanto eu tenho de patrimônio?", "Compare cenários de venda"].map(s => `<button type="button" data-s="${esc(s)}">${esc(s)}</button>`).join("")}</div></section>
    <section class="card"><h3>Como a IA funciona aqui</h3><ul class="stack small" style="margin-top:10px">
      <li>• Classifica a intenção e consulta o motor certo (Financeiro, Patrimônio, Tributário, Simulação, Documentos).</li>
      <li>• Checagem de consistência: nenhum número sem evidência é exibido.</li>
      <li>• Pedidos de recomendação de compra/venda são bloqueados (regulação CVM).</li>
      <li>• Cada resposta é auditada com correlation_id e ferramentas usadas.</li></ul>
      ${DEMO ? trust("Modo demonstração: respostas geradas pelo orquestrador real sobre o snapshot demo.") : ""}</section></div>`;
  const chat = el.querySelector("#chat");
  const ask = async q => {
    if (!q.trim()) return;
    chat.insertAdjacentHTML("beforeend", `<div class="msg msg--user">${esc(q)}</div><div class="msg msg--ai" id="pending"><div class="skeleton" style="width:220px"></div></div>`);
    try {
      const a = await api.post("/v1/assistant/query", { question: q, thread_id: hist.at(-1)?.thread_id });
      hist.push(a);
      chat.querySelector("#pending").outerHTML = `<div class="msg msg--ai ${a.guardrail ? "msg--guard" : ""}">${esc(a.answer)}
        ${a.evidence?.length ? `<details style="margin-top:8px"><summary>Evidências (${a.evidence.length})</summary><ul class="small" style="margin-top:6px">${a.evidence.map(e => `<li>• ${esc(e.label)}: <b>${esc(e.display || e.value)}</b> <span class="muted">— ${esc(e.source)}</span></li>`).join("")}</ul></details>` : ""}
        <div class="meta">Intenção: ${esc(a.intent)}${a.guardrail ? ` · guardrail: ${esc(a.guardrail)}` : ""} · ferramentas: ${esc(a.tool_calls.map(t => t.tool).join(", ") || "nenhuma")} · consistência ${a.consistency_ok ? "ok" : "falhou"} · ${esc(a.provider)} · ${esc(a.disclaimer)}</div>
        ${a.suggestions?.length ? `<div class="suggest" style="margin-top:8px">${a.suggestions.map(s => `<button type="button" data-s="${esc(s)}">${esc(s)}</button>`).join("")}</div>` : ""}</div>`;
    } catch (x) { chat.querySelector("#pending").outerHTML = `<div class="msg msg--ai msg--guard">${esc(x.status === 402 ? "O assistente faz parte do plano Pro." : problemMsg(x))}</div>`; }
    chat.lastElementChild.scrollIntoView({ behavior: "smooth", block: "nearest" });
  };
  el.querySelector("#qf").onsubmit = e => { e.preventDefault(); const i = el.querySelector("#q"); ask(i.value); i.value = ""; };
  el.firstElementChild.addEventListener("click", e => { const b = e.target.closest("[data-s]"); if (b) ask(b.dataset.s); });
  if (r.params.get("q")) ask(r.params.get("q"));
}

/* ================================================================ PLANOS / CONFIG / PRIVACIDADE */
export async function plans(el, r, { me }) {
  const res = await api.get("/v1/plans");
  const nice = { dashboard: "Dashboard", patrimonio: "Patrimônio", financas: "Finanças", orcamento: "Orçamento", alertas_limitados: "Alertas limitados", documentos: "Documentos",
    conexoes: "Conexões Open Finance", inteligencia_financeira: "Inteligência financeira", inteligencia_tributaria: "Inteligência tributária", simulacao: "Simulação de cenários",
    radar: "Radar de alertas", assistente_ia: "IA explicativa", cenarios_avancados: "Cenários avançados", inteligencia_patrimonial: "Inteligência patrimonial", automacao: "Maior automação", suporte_prioritario: "Suporte prioritário" };
  el.innerHTML = `<div class="grid g-3">${res.items.map(p => `<article class="plan ${p.code === "pro" ? "is-pro" : ""}"><h3>${esc(p.name)} ${me.plan === p.code ? badge("ativo", "seu plano") : ""}</h3>
    <p class="price">${+p.price_month ? brl(p.price_month) + " <small>/mês</small>" : "R$ 0"}</p><ul>${p.features.map(f => `<li>${esc(nice[f] || f)}</li>`).join("")}</ul>
    <button class="btn ${p.code === "pro" ? "btn--primary" : "btn--ghost"}" style="margin-top:14px;width:100%" ${me.plan === p.code ? "disabled" : ""} data-plan="${p.code}">${me.plan === p.code ? "Plano atual" : "Assinar"}</button></article>`).join("")}</div>
    ${trust("Preços em teste comercial (hipóteses do Dossiê §4.1). A cobrança depende do gateway ainda não definido (decisão pendente D-06).")}`;
  el.querySelectorAll("[data-plan]").forEach(b => b.onclick = () => toast("Checkout indisponível nesta versão: gateway de cobrança pendente de definição."));
}

export async function settings(el, r, { me }) {
  el.innerHTML = `<div class="grid g-2">
    <section class="card"><h3>Aparência</h3><p class="small muted" style="margin-top:6px">Claro, Escuro ou seguir o sistema operacional. A preferência fica salva neste dispositivo e no seu perfil. Trocar o tema nunca altera dados ou cálculos.</p>
      <div style="margin-top:14px">${themeSwitch()}</div></section>
    <section class="card"><h3>Perfil</h3><ul class="stack small" style="margin-top:10px"><li><b>Nome:</b> ${esc(me.name)}</li><li><b>E-mail:</b> ${esc(me.email)}</li><li><b>Profissão:</b> ${esc(me.profession || "—")}</li>${me.roles?.includes("owner") ? `<li><b>Papel:</b> dono e administrador</li><li><b>CPF:</b> ${me.profile?.cpf_configured ? esc(me.profile.cpf_masked) + " (configurado no servidor)" : "configurado apenas no servidor (variável RAMON_OWNER_CPF)"}</li>` : ""}<li><b>Telefone:</b> ${esc(me.phone || "—")}</li><li><b>Plano:</b> ${esc(me.plan)}</li>
      <li><b>Objetivos:</b> ${esc((me.profile?.objetivos || []).join(", ") || "—")}</li></ul></section>
    <section class="card"><h3>Notificações</h3><label class="check" style="margin-top:10px"><input type="checkbox" checked> Alertas no aplicativo</label>
      <label class="check" style="margin-top:8px"><input type="checkbox"> Resumo semanal por e-mail</label><p class="note">Apenas alertas de severidade “atenção” ou maior; alertas repetidos não são reenviados.</p></section>
    <section class="card"><h3>Sobre</h3><p class="small muted" style="margin-top:8px">Fintechs · Ramon Inteligência Financeira — MVP v1.0. Consolida, analisa, simula, alerta e explica. Não é corretora nem consultoria de investimentos.</p></section></div>`;
  theme.apply();
}

export async function privacy(el) {
  const [c, a] = await Promise.all([api.get("/v1/consents"), api.get("/v1/audit")]);
  el.innerHTML = `<div class="grid g-2">
    <section class="card"><h3>Seus direitos (LGPD)</h3><ul class="stack small" style="margin-top:10px"><li>• Confirmação e acesso aos dados</li><li>• Correção</li><li>• Portabilidade (exportação)</li><li>• Eliminação, quando aplicável</li><li>• Informação sobre compartilhamento e revogação do consentimento</li></ul>
      <div class="row wrap" style="gap:8px;margin-top:14px"><button class="btn btn--ghost btn--sm" id="exp" ${DEMO ? "disabled title='Disponível com a API conectada'" : ""}>Exportar meus dados</button>
      <button class="btn btn--danger btn--sm" id="del" ${DEMO ? "disabled title='Disponível com a API conectada'" : ""}>Excluir minha conta</button></div>
      <p class="note">Base legal, retenção e prazos finais dependem de revisão jurídica (decisão pendente D-03).</p></section>
    <section class="card"><h3>Consentimentos</h3><ul class="stack small" style="margin-top:10px">${c.items.map(x => `<li class="row between"><span>${esc(x.institution)} · ${esc(x.scope.join(", "))}</span>${badge(x.status)}</li>`).join("")}</ul></section></div>
    <section class="card section"><h3>Trilha de auditoria <span class="right">${a.chain_valid ? badge("ativo", "cadeia íntegra") : badge("erro", "cadeia inválida")}</span></h3>
      <div class="table-wrap"><table class="table" style="margin-top:10px"><thead><tr><th>#</th><th>Quando</th><th>Recurso</th><th>Ação</th><th>correlation_id</th><th>hash</th></tr></thead>
      <tbody>${a.items.slice(-40).reverse().map(e => `<tr><td>${e.seq}</td><td class="small">${dtm(e.at)}</td><td class="small">${esc(e.resource)}</td><td>${esc(e.action)}</td><td class="small muted">${esc(String(e.correlation_id).slice(0, 12))}</td><td class="small muted"><code>${esc(e.hash.slice(0, 12))}</code></td></tr>`).join("")}</tbody></table></div></section>`;
  el.querySelector("#exp").onclick = async () => { const d = await api.get("/v1/privacy/export"); const b = new Blob([JSON.stringify(d, null, 2)], { type: "application/json" }); const u = URL.createObjectURL(b); Object.assign(document.createElement("a"), { href: u, download: "meus-dados.json" }).click(); URL.revokeObjectURL(u); };
  el.querySelector("#del").onclick = async () => { if (confirm("Excluir definitivamente sua conta e dados? Trilhas de auditoria são retidas conforme obrigação legal.")) { await api.del("/v1/privacy/account"); localStorage.removeItem("ramon.token"); location.hash = "#/entrar"; } };
}
