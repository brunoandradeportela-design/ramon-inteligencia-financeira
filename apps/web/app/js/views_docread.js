/* Leitura de documentos (RF-018): o pdf.js lê o texto do PDF no navegador; a API extrai, valida e só importa
 * depois da confirmação do cliente. PDFs escaneados (imagem) ainda não são lidos. */
import { api, ApiError } from "./api.js";
import { brl, dt, esc, toast } from "./ui.js";

const msg = e => e instanceof ApiError ? (e.problem.detail || e.problem.title) : String(e.message || e);
const PDFJS = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js", WORKER = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
const TYPE = { nota_corretagem: "Nota de corretagem", darf: "Comprovante de DARF", informe_rendimentos: "Informe de rendimentos", recibo: "Recibo" };
const ORIGEM = { codigo_na_nota: "código na nota", mapa_do_cliente: "informado por você", mapa_interno: "nome de pregão (confira)", nao_identificado: "informe o código" };

function loadPdfJs() {
  return new Promise((ok, ko) => { if (window.pdfjsLib) return ok(window.pdfjsLib); const s = document.createElement("script"); s.src = PDFJS;
    s.onload = () => { window.pdfjsLib.GlobalWorkerOptions.workerSrc = WORKER; ok(window.pdfjsLib); }; s.onerror = () => ko(new Error("Não foi possível carregar o leitor de PDF.")); document.head.appendChild(s); });
}
/* agrupa os pedaços de texto de cada página em linhas (mesma altura), da esquerda para a direita */
export async function pdfLines(blob) {
  const lib = await loadPdfJs(), pdf = await lib.getDocument({ data: new Uint8Array(await blob.arrayBuffer()) }).promise, out = [];
  for (let n = 1; n <= Math.min(pdf.numPages, 20); n++) {
    const items = (await (await pdf.getPage(n)).getTextContent()).items.filter(i => i.str && i.str.trim());
    const rows = [];
    for (const it of items) { const y = it.transform[5], x = it.transform[4]; let r = rows.find(r => Math.abs(r.y - y) <= 2.5); if (!r) rows.push(r = { y, parts: [] }); r.parts.push({ x, s: it.str }); }
    rows.sort((a, b) => b.y - a.y).forEach(r => out.push(r.parts.sort((a, b) => a.x - b.x).map(p => p.s.trim()).join(" ")));
  }
  return out;
}

export async function readDocument(box, d, onDone) {
  box.innerHTML = `<section class="card section" aria-live="polite"><h3>Lendo ${esc(d.filename)}…</h3><div class="skeleton" style="height:80px;margin-top:10px"></div></section>`;
  box.scrollIntoView({ behavior: "smooth", block: "start" });
  try {
    const blob = await api.download(`/v1/documents/${d.id}/download`);
    const lines = d.mime === "application/pdf" ? await pdfLines(blob) : (await blob.text()).split(/\r?\n/);
    const r = await api.put(`/v1/documents/${d.id}/extraction`, { lines });
    review(box, d, r.extraction, onDone);
  } catch (x) { box.innerHTML = `<section class="card section" role="alert"><h3>Não foi possível ler</h3><p class="small muted" style="margin-top:6px">${esc(msg(x))}</p></section>`; }
}

function review(box, d, x, onDone) {
  const v = x.validation || { checks: [] }, isNota = x.type === "nota_corretagem";
  const checks = `<ul class="stack small" style="margin-top:10px">${v.checks.map(c => `<li><b class="${c.ok ? "pos" : c.blocking ? "neg" : ""}">${c.ok ? "✓" : c.blocking ? "✗" : "!"}</b> ${esc(c.detail)}</li>`).join("")}</ul>`;
  let body = "";
  if (isNota) body = `<p class="small" style="margin-top:6px">Nota ${esc(x.header.numero || "—")} · pregão ${dt(x.header.data_pregao)} · ${esc(x.header.corretora || "corretora não identificada")}</p>
    <div class="table-wrap"><table class="table" style="margin-top:10px"><thead><tr><th>C/V</th><th>Título na nota</th><th>Código</th><th class="num">Qtd.</th><th class="num">Preço</th><th class="num">Valor</th></tr></thead><tbody>
    ${x.negocios.map((n, i) => `<tr><td>${n.side === "C" ? "Compra" : "Venda"}${n.daytrade ? " · DT" : ""}</td><td>${esc(n.titulo)}<div class="small muted">${esc(n.mercado.toLowerCase())}</div></td>
      <td>${n.ticker_origem === "codigo_na_nota" || n.ticker_origem === "mapa_do_cliente" ? `<b>${esc(n.ticker)}</b><div class="small muted">${ORIGEM[n.ticker_origem]}</div>`
        : `<input class="input" data-tk="${esc(n.titulo)}" value="${esc(n.ticker || "")}" placeholder="ex.: XPLG11" aria-label="Código de ${esc(n.titulo)}" style="max-width:110px;padding:4px 8px;text-transform:uppercase"><div class="small muted">${ORIGEM[n.ticker_origem]}</div>`}</td>
      <td class="num">${n.quantidade}</td><td class="num">${brl(n.preco)}</td><td class="num">${brl(n.valor)}</td></tr>`).join("")}</tbody></table></div>`;
  if (x.type === "darf") body = `<ul class="stack small" style="margin-top:10px"><li>Código ${esc(x.codigo || "—")} · competência ${esc(x.competencia || "—")}</li><li>Valor total ${x.valor_total != null ? brl(x.valor_total) : "—"} · pago em ${dt(x.data_pagamento)}</li></ul>`;
  if (x.type === "informe_rendimentos") body = `<p class="small" style="margin-top:6px">${esc(x.fonte_nome || "")} ${esc(x.fonte_cnpj || "")} · ano-calendário ${esc(x.ano_calendario || "—")}</p>
    <ul class="stack small" style="margin-top:8px">${Object.entries(x.valores || {}).filter(([, val]) => val != null).map(([k, val]) => `<li>${esc(k.replace(/_/g, " "))}: <b>${brl(val)}</b></li>`).join("")}</ul>`;
  if (x.type === "recibo") body = `<ul class="stack small" style="margin-top:10px"><li>Prestador: ${esc((x.prestador_tipo || "").toUpperCase())} ${esc(x.prestador_documento || "—")}</li><li>Valor ${x.valor != null ? brl(x.valor) : "—"} · ${dt(x.data)}</li></ul>`;
  const done = x.status === "confirmado";
  box.innerHTML = `<section class="card section"><h3>${esc(TYPE[x.type] || "Documento")} · conferência <span class="right small muted">confiança ${Math.round((v.confidence || 0) * 100)}%</span></h3>
    ${body}<h3 style="margin-top:14px;font-size:14px">Validações</h3>${checks}
    <div class="row wrap" style="gap:8px;margin-top:12px">${isNota && !done ? `<button class="btn btn--ghost btn--sm" id="xs">Salvar códigos e conferir</button>` : ""}
      ${done ? `<span class="pos small">✓ Confirmado</span>` : `<button class="btn btn--primary btn--sm" id="xc" ${v.ok ? "" : "disabled"}>${isNota ? "Confirmar e importar negócios" : x.type === "darf" ? "Confirmar e marcar DARF como pago" : "Confirmar dados"}</button>`}
      <button class="btn btn--ghost btn--sm" id="xx">Fechar</button></div>
    <p class="note">Leitura automática (${esc(x.extractor || "")}). Nada entra nos cálculos sem a sua confirmação; os códigos que você informar ficam lembrados para as próximas notas.</p></section>`;
  const q = s => box.querySelector(s);
  q("#xx").onclick = () => { box.innerHTML = ""; };
  if (q("#xs")) q("#xs").onclick = async () => {
    const ov = {}; box.querySelectorAll("[data-tk]").forEach(i => { if (i.value.trim()) ov[i.dataset.tk] = i.value.trim().toUpperCase(); });
    try { const r = await api.patch(`/v1/documents/${d.id}/extraction`, { ticker_overrides: ov }); review(box, d, r.extraction, onDone); } catch (e) { toast(msg(e)); }
  };
  if (q("#xc")) q("#xc").onclick = async e => {
    e.target.disabled = true;
    try { const r = await api.post(`/v1/documents/${d.id}/extraction/confirm`, {});
      const s = r.result;
      toast(r.type === "nota_corretagem" ? `${s.imported} negócio(s) importado(s)${s.skipped_duplicates ? `, ${s.skipped_duplicates} já existiam` : ""}.` : r.type === "darf" ? (s.darf_marcado_pago ? `DARF ${s.darf_marcado_pago} marcado como pago.` : s.nota) : "Dados confirmados.");
      onDone && onDone(); }
    catch (x2) { toast(msg(x2)); e.target.disabled = false; }
  };
}

export const showReview = (box, d, x) => { review(box, d, x, null); box.scrollIntoView({ behavior: "smooth", block: "start" }); };
