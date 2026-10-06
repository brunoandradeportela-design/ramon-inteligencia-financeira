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
