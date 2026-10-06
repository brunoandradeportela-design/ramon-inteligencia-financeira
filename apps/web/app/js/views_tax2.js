/* Tributação (dados reais): qualidade do cálculo, reprodutibilidade e Excel auditável de 8 abas.
 * O Excel é montado aqui a partir do resultado do Tax Engine (API). Nada é recalculado no navegador;
 * as fórmulas da aba Cálculos só permitem ao auditor conferir base × alíquota contra o valor do motor. */
import { api, ApiError } from "./api.js";
import { dtm, esc, toast } from "./ui.js";

const msg = e => e instanceof ApiError ? (e.problem.detail || e.problem.title) : String(e.message || e);
const XLSX_URL = "https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js";
function loadXlsx() {
  return new Promise((ok, ko) => { if (window.XLSX) return ok(window.XLSX); const s = document.createElement("script"); s.src = XLSX_URL;
    s.onload = () => ok(window.XLSX); s.onerror = () => ko(new Error("Não foi possível carregar o gerador de planilhas.")); document.head.appendChild(s); });
}

export function buildAuditWorkbook(XLSX, a) {
  const wb = XLSX.utils.book_new();
  const add = (name, rows, widths) => { const ws = XLSX.utils.aoa_to_sheet(rows); if (widths) ws["!cols"] = widths.map(w => ({ wch: w })); XLSX.utils.book_append_sheet(wb, ws, name); return ws; };
  add("Resumo", [["AURION — apuração de renda variável (estimativa)"], [], ...a.resumo], [36, 60]);
  add("Entradas", [a.entradas_header, ...a.entradas], [12, 10, 8, 12, 12, 14, 10, 10, 24]);
  add("Premissas", [["Tipo", "Texto"], ...a.premissas], [26, 120]);
  add("Regras", [a.regras_header, ...a.regras], [24, 9, 40, 12, 12, 50, 60, 60, 20]);
  // Cálculos: parâmetros no topo e fórmulas de conferência ao lado do valor do motor
  const top = [["Alíquota comum", a.aliquotas.comum], ["Alíquota day trade", a.aliquotas.daytrade], ["Alíquota FII", a.aliquotas.fii], []];
  const head = [...a.calculos_header, "IR comum = base × alíquota", "IR day trade = base × alíquota", "IR FII = base × alíquota", "IR bruto (fórmula)", "Confere com o motor?"];
  const ws = add("Cálculos", [...top, head, ...a.calculos], [9, 14, 10, 14, 12, 14, 16, 14, 14, 12, 12, 10, 12, 14, 18, 18, 16, 16, 16]);
  a.calculos.forEach((_, i) => {
    const r = 6 + i;                              // linha 5 = cabeçalho
    ws[`O${r}`] = { t: "n", f: `ROUND(G${r}*$B$1,2)` }; ws[`P${r}`] = { t: "n", f: `ROUND(I${r}*$B$2,2)` }; ws[`Q${r}`] = { t: "n", f: `ROUND(K${r}*$B$3,2)` };
    ws[`R${r}`] = { t: "n", f: `O${r}+P${r}+Q${r}` }; ws[`S${r}`] = { t: "s", f: `IF(ABS(R${r}-N${r})<0.02,"ok","revisar")` };
  });
  const last = 5 + a.calculos.length;
  ws["!ref"] = `A1:S${Math.max(last, 5)}`;
  add("Resultado", [a.resultado_header, ...a.resultado, [], ["Eventos tributários"], a.eventos_header, ...a.eventos], [9, 14, 8, 12, 12, 14, 12, 26, 60]);
  add("Fontes", [["ID", "Título", "URL", "Regra"], ...a.fontes], [12, 70, 80, 24]);
  add("Auditoria", [["Campo", "Valor"], ...a.auditoria], [30, 110]);
  return wb;
}

export async function taxExtras(el, t) {
  if (!t.calculation_id) { el.innerHTML = ""; return; }
  const hist = await api.get("/v1/tax/calculations").catch(() => ({ items: [] }));
  const q = t.quality;
  el.innerHTML = `
    <div class="grid g-2 section">
      <section class="card"><h3>Qualidade do cálculo <span class="right small muted">${Math.round((q?.score || 0) * 100)}%</span></h3>
        <ul class="stack small" style="margin-top:10px">${(q?.factors || []).map(f => `<li><b>${f.ok ? "✓" : "!"} ${esc(f.factor)}</b> — ${esc(f.detail)}${f.improve ? `<div class="muted">Para elevar: ${esc(f.improve)}</div>` : ""}</li>`).join("")}</ul>
        <p class="note">${esc(q?.note || "")}</p></section>
      <section class="card"><h3>Auditoria do cálculo</h3>
        <ul class="stack small" style="margin-top:10px"><li>Cálculo <code>${esc(t.calculation_id)}</code></li><li>Motor ${esc(t.engine_version)} · regras ${esc(Object.entries(t.rule_versions).map(([k, v]) => `${k}@${v}`).join(", "))}</li>
          <li>Entradas (hash) <code>${esc(t.snapshot_hash.slice(0, 24))}…</code></li></ul>
        <div class="row wrap" style="gap:8px;margin-top:12px"><button class="btn btn--primary btn--sm" id="xls">Baixar Excel de auditoria</button><button class="btn btn--ghost btn--sm" id="ver">Reprocessar e conferir</button></div>
        <p class="small" id="vres" role="status" style="margin-top:8px"></p>
        ${hist.items.length > 1 ? `<details style="margin-top:8px"><summary class="small">Cálculos anteriores (${hist.items.length})</summary><ul class="stack small" style="margin-top:6px">${hist.items.slice(0, 10).map(c => `<li>${dtm(c.created_at)} · ${c.tax_year} · R$ ${esc(c.result.total_tax_due)} · <code>${esc(c.calculation_id.slice(5, 15))}</code></li>`).join("")}</ul></details>` : ""}
        <p class="note">Mesmas entradas + mesma versão das regras + mesma versão do motor = mesmo resultado. O Excel é artefato de auditoria; a fonte de verdade é o Tax Engine.</p></section>
    </div>`;
  el.querySelector("#xls").onclick = async e => {
    const b = e.target; b.disabled = true; b.textContent = "Gerando…";
    try { const [XLSX, a] = await Promise.all([loadXlsx(), api.get(`/v1/tax/calculations/${t.calculation_id}/artifact`)]); XLSX.writeFile(buildAuditWorkbook(XLSX, a), a.file_name); toast("Excel de auditoria gerado."); }
    catch (x) { toast(msg(x)); }
    b.disabled = false; b.textContent = "Baixar Excel de auditoria";
  };
  el.querySelector("#ver").onclick = async () => {
    try { const v = await api.get(`/v1/tax/calculations/${t.calculation_id}/verify`);
      el.querySelector("#vres").innerHTML = v.reproducible ? `<span class="pos">✓ Reprocessado: mesmo resultado (R$ ${esc(v.recomputed.total_tax_due)}) e mesmo hash de entrada.</span>` : `<span class="neg">! O reprocessamento divergiu. Revise antes de usar.</span>`; }
    catch (x) { toast(msg(x)); }
  };
}

/* ------------------------------------------------------------------ relatório de apoio à declaração (IRPF) */
const b2 = v => v == null ? "—" : (+v).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export function buildIrpfWorkbook(XLSX, r) {
  const wb = XLSX.utils.book_new(), add = (n, rows, w) => { const ws = XLSX.utils.aoa_to_sheet(rows); ws["!cols"] = w.map(x => ({ wch: x })); XLSX.utils.book_append_sheet(wb, ws, n); };
  add("Renda variável", [["Mês", "Vendas de ações", "Resultado comum", "Resultado day trade", "Resultado FII", "Ganho isento", "Imposto devido", "IRRF", "Imposto a pagar", "DARF pago"],
    ...r.renda_variavel.mensal.map(m => [m.mes, +m.vendas_acoes, +m.resultado_comum, +m.resultado_daytrade, +m.resultado_fii, +m.ganho_isento, +m.imposto_devido, +m.irrf, +m.imposto_a_pagar, m.darf_pago == null ? "" : +m.darf_pago]),
    [], ["Prejuízo a compensar ao fim do ano", "comum", +r.renda_variavel.prejuizo_a_compensar_final.comum, "day trade", +r.renda_variavel.prejuizo_a_compensar_final.daytrade, "FII", +r.renda_variavel.prejuizo_a_compensar_final.fii]], [12, 16, 16, 18, 14, 14, 14, 10, 14, 12]);
  add("Bens e direitos", [["Grupo", "Código", "Ativo", "Discriminação", `Situação em 31/12/${r.year - 1}`, `Situação em 31/12/${r.year}`],
    ...r.bens_e_direitos.map(b => [b.grupo || "conferir", b.codigo || "conferir", b.ticker, b.discriminacao, +b.situacao_anterior, +b.situacao_atual])], [8, 8, 10, 90, 18, 18]);
  add("Isentos", [["Descrição", "Valor"], [r.rendimentos_isentos.descricao, +r.rendimentos_isentos.ganhos_acoes_ate_20_mil]], [90, 16]);
  add("Premissas", [["Premissas e versões"], ...r.premissas.map(p => [p]), [], ["Motor", r.engine_version], ["Regras", Object.entries(r.rule_versions).map(([k, v]) => `${k}@${v}`).join(", ")], ["Relatório", r.version], [r.disclaimer]], [120, 60]);
  return wb;
}
export async function irpfSection(el) {
  const thisYear = +new Date(Date.now() - 3 * 3600e3).toISOString().slice(0, 4);
  const draw = async year => {
    el.innerHTML = `<section class="card section"><h3>Relatório para a declaração</h3><div class="skeleton" style="height:60px;margin-top:10px"></div></section>`;
    let r; try { r = await api.get(`/v1/tax/irpf-report?year=${year}`); } catch (x) { el.innerHTML = `<section class="card section" role="alert">${esc(msg(x))}</section>`; return; }
    const t = r.renda_variavel.totais, pj = r.renda_variavel.prejuizo_a_compensar_final;
    el.innerHTML = `<section class="card section"><div class="row wrap" style="justify-content:space-between;gap:8px"><h3>Relatório para a declaração — ano-calendário ${r.year}${r.partial ? " (parcial)" : ""}</h3>
        <div class="row" style="gap:8px"><select class="input" id="iy" style="max-width:110px;padding:4px 8px" aria-label="Ano-calendário">${[thisYear, thisYear - 1, thisYear - 2, thisYear - 3].map(y => `<option ${y === r.year ? "selected" : ""}>${y}</option>`).join("")}</select>
        <button class="btn btn--primary btn--sm" id="ix">Baixar Excel</button></div></div>
      <div class="grid g-4" style="margin-top:10px">
        <div><div class="small muted">Resultado comum</div><b>R$ ${b2(t.resultado_comum)}</b></div><div><div class="small muted">Resultado day trade</div><b>R$ ${b2(t.resultado_daytrade)}</b></div>
        <div><div class="small muted">Resultado FII</div><b>R$ ${b2(t.resultado_fii)}</b></div><div><div class="small muted">Ganhos isentos (ações até R$ 20 mil)</div><b>R$ ${b2(r.rendimentos_isentos.ganhos_acoes_ate_20_mil)}</b></div></div>
      <p class="small" style="margin-top:8px">Imposto devido no ano R$ ${b2(t.imposto_devido)} · IRRF R$ ${b2(t.irrf)} · prejuízo a compensar no fim do ano: comum R$ ${b2(pj.comum)}, day trade R$ ${b2(pj.daytrade)}, FII R$ ${b2(pj.fii)}</p>
      <h3 style="margin-top:14px;font-size:14px">Bens e direitos (custo de aquisição)</h3>
      ${r.bens_e_direitos.length ? `<div class="table-wrap"><table class="table" style="margin-top:8px"><thead><tr><th>Grupo/código</th><th>Discriminação</th><th class="num">31/12/${r.year - 1}</th><th class="num">31/12/${r.year}</th></tr></thead><tbody>
        ${r.bens_e_direitos.map(b => `<tr><td>${b.grupo ? `${b.grupo} / ${b.codigo}` : `<span class="muted">conferir</span>`}</td><td class="small">${esc(b.discriminacao)}</td><td class="num">${b2(b.situacao_anterior)}</td><td class="num">${b2(b.situacao_atual)}</td></tr>`).join("")}
        </tbody></table></div>` : `<p class="small muted" style="margin-top:6px">Sem posições de bolsa pelas negociações importadas.</p>`}
      <ul class="small muted stack" style="margin-top:10px">${r.premissas.map(p => `<li>${esc(p)}</li>`).join("")}</ul>
      <p class="note">${esc(r.disclaimer)}</p></section>`;
    el.querySelector("#iy").onchange = e => draw(+e.target.value);
    el.querySelector("#ix").onclick = async e => { e.target.disabled = true; try { const XLSX = await loadXlsx(); XLSX.writeFile(buildIrpfWorkbook(XLSX, r), `AURION_IRPF_${r.year}_renda_variavel.xlsx`); toast("Excel gerado."); } catch (x) { toast(msg(x)); } e.target.disabled = false; };
  };
  draw(thisYear - 1);
}
