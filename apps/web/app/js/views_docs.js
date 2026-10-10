/* Documentos (dados reais): cofre de arquivos do cliente + checklist da declaração do IRPF montado com os dados dele. */
import { registerTour } from "./tour.js";
import { stepsDocumentos, TOUR_PAGINAS2_VERSAO } from "./tour_paginas2.js";
import { api, ApiError } from "./api.js";
import { dt, esc, icon, toast, empty } from "./ui.js";
import { readDocument } from "./views_docread.js";

const msg = e => e instanceof ApiError ? (e.problem.detail || e.problem.title) : String(e.message || e);
const size = b => b > 1048576 ? (b / 1048576).toFixed(1).replace(".", ",") + " MB" : Math.max(1, Math.round(b / 1024)) + " KB";

export async function documentsReal(el, year) {
  const thisYear = +new Date(Date.now() - 3 * 3600e3).toISOString().slice(0, 4);
  year = year || thisYear;
  const res = await api.get(`/v1/documents?year=${year}`);
  const ck = res.checklist, kinds = res.kinds;
  const kindOpts = sel => Object.entries(kinds).map(([k, l]) => `<option value="${k}" ${k === sel ? "selected" : ""}>${esc(l)}</option>`).join("");
  el.innerHTML = `
    <div class="grid g-dash2" style="align-items:start">
      <section class="card" data-tour="doc-guardar"><h3>Guardar documento</h3>
        <p class="small muted" style="margin-top:6px">PDF, imagem, planilha ou texto até 8 MB. Informes de rendimentos, notas de corretagem, comprovantes de DARF, recibos de saúde e educação. Para entrar nos cálculos, extratos e relatórios da B3 vão em <a href="#/importar">Importar dados</a>.</p>
        <form id="uf" class="stack" style="margin-top:12px">
          <div class="field"><label for="file">Arquivo</label><input class="input" style="padding-top:7px" type="file" id="file" accept=".pdf,.png,.jpg,.jpeg,.csv,.ofx,.txt,.xlsx,.docx" required></div>
          <div class="form-grid"><div class="field"><label for="kind">Tipo</label><select class="input" id="kind"><option value="">Detectar pelo nome</option>${kindOpts("")}</select></div>
            <div class="field"><label for="yr">Ano-calendário</label><select class="input" id="yr">${[thisYear, thisYear - 1, thisYear - 2, thisYear - 3].map(y => `<option ${y === year ? "selected" : ""}>${y}</option>`).join("")}</select></div></div>
          <button class="btn btn--primary">Guardar</button></form><p class="err" id="err" role="alert"></p>
        <p class="note">${size(res.used_bytes)} usados de ${size(res.quota_bytes)}. Os arquivos ficam na sua conta e só você acessa.</p></section>
      <section class="card" data-tour="doc-checklist"><h3>Declaração do IR ${ck.delivery_year} <span class="right small muted">ano-calendário ${ck.year}</span></h3>
        <div class="row between" style="margin-top:8px"><span class="small"><b>${ck.done}</b> de ${ck.total} itens prontos</span>
          <select class="input" id="cky" style="max-width:120px;padding:4px 8px">${[thisYear, thisYear - 1, thisYear - 2].map(y => `<option ${y === year ? "selected" : ""}>${y}</option>`).join("")}</select></div>
        <div style="height:6px;border-radius:9px;background:var(--line);margin-top:8px"><div style="height:6px;border-radius:9px;background:var(--pos);width:${ck.total ? Math.round(ck.done / ck.total * 100) : 0}%"></div></div>
        <ul class="stack" style="margin-top:14px">${ck.items.map(i => `<li class="row" style="gap:10px;align-items:flex-start">
          <span aria-hidden="true" style="flex:none;width:20px;height:20px;border-radius:50%;display:grid;place-items:center;font-size:12px;font-weight:700;${i.done ? "background:var(--pos);color:#fff" : "border:2px solid var(--line)"}">${i.done ? "✓" : ""}</span>
          <div><b class="small">${esc(i.title)}</b><div class="small muted">${esc(i.detail)}</div></div><span class="sr-only">${i.done ? "pronto" : "pendente"}</span></li>`).join("")}</ul>
        <p class="note">Checklist montado com seus dados importados ou conectados. Confira com seu contador.</p></section>
    </div>
    <section class="card section" data-tour="doc-lista"><h3>Meus documentos <span class="right small muted">${res.items.length}</span></h3>
      ${res.items.length ? `<div class="table-wrap"><table class="table" style="margin-top:10px"><thead><tr><th>Documento</th><th>Tipo</th><th>Ano</th><th class="num">Tamanho</th><th>Guardado em</th><th></th></tr></thead>
      <tbody>${res.items.map(d => `<tr><td><b>${esc(d.title)}</b><div class="small muted">${esc(d.filename)}${d.status === "conferido" ? ' · <span class="pos">conferido</span>' : ""}</div></td>
        <td><select class="input" data-kind="${esc(d.id)}" style="padding:4px 8px;min-width:170px">${kindOpts(d.kind)}</select></td>
        <td><select class="input" data-year="${esc(d.id)}" style="padding:4px 8px">${[thisYear, thisYear - 1, thisYear - 2, thisYear - 3, thisYear - 4].map(y => `<option ${y === d.year ? "selected" : ""}>${y}</option>`).join("")}</select></td>
        <td class="num">${size(d.size)}</td><td class="small muted">${dt(d.uploaded_at)}</td>
        <td class="row" style="gap:6px">${["application/pdf", "text/plain"].includes(d.mime) ? `<button class="btn btn--${d.status === "conferido" ? "ghost" : "primary"} btn--sm" data-read="${esc(d.id)}">${d.status === "conferido" ? "Ver leitura" : "Ler dados"}</button>` : ""}<button class="btn btn--ghost btn--sm" data-dl="${esc(d.id)}" data-name="${esc(d.filename)}">Baixar</button><button class="btn btn--ghost btn--sm" data-del="${esc(d.id)}">Apagar</button></td></tr>`).join("")}</tbody></table></div>`
      : empty("Nenhum documento guardado ainda.", "doc")}
      <p class="note">“Ler dados” lê notas de corretagem, comprovantes de DARF, informes de rendimentos e recibos em PDF com texto. Você confere antes de qualquer valor entrar nos cálculos.</p></section>
    <div id="readbox"></div>`;
  const err = el.querySelector("#err");
  el.querySelector("#cky").onchange = e => documentsReal(el, +e.target.value);
  el.querySelector("#uf").onsubmit = async e => {
    e.preventDefault(); err.textContent = "";
    const f = el.querySelector("#file").files[0]; if (!f) return;
    if (f.size > 8 * 1024 * 1024) { err.textContent = "Arquivo acima de 8 MB."; return; }
    const b = e.target.querySelector("button"); b.disabled = true; b.textContent = "Enviando…";
    try { const d = await api.upload("/v1/documents", f, { kind: el.querySelector("#kind").value, year: el.querySelector("#yr").value }); toast(`${d.title} guardado.`); documentsReal(el, year); }
    catch (x) { err.textContent = msg(x); b.disabled = false; b.textContent = "Guardar"; }
  };
  const patch = async (id, body) => { try { await api.patch(`/v1/documents/${id}`, body); toast("Documento atualizado."); documentsReal(el, year); } catch (x) { toast(msg(x)); } };
  el.querySelectorAll("[data-kind]").forEach(s => s.onchange = () => patch(s.dataset.kind, { kind: s.value }));
  el.querySelectorAll("[data-year]").forEach(s => s.onchange = () => patch(s.dataset.year, { year: +s.value }));
  el.querySelectorAll("[data-dl]").forEach(b => b.onclick = async () => {
    try { const blob = await api.download(`/v1/documents/${b.dataset.dl}/download`); const u = URL.createObjectURL(blob);
      Object.assign(document.createElement("a"), { href: u, download: b.dataset.name }).click(); setTimeout(() => URL.revokeObjectURL(u), 2000); }
    catch (x) { toast(msg(x)); }
  });
  el.querySelectorAll("[data-read]").forEach(b => b.onclick = async () => {
    const d = res.items.find(x => x.id === b.dataset.read), box = el.querySelector("#readbox");
    if (d.status === "conferido") { try { const r = await api.get(`/v1/documents/${d.id}/extraction`); if (r.extraction) { const m = await import("./views_docread.js"); return m.showReview(box, d, r.extraction); } } catch {} }
    readDocument(box, d, () => documentsReal(el, year));
  });
  el.querySelectorAll("[data-del]").forEach(b => b.onclick = async () => {
    if (b.dataset.armed !== "1") { b.dataset.armed = "1"; b.textContent = "Confirmar"; return; }
    try { await api.del(`/v1/documents/${b.dataset.del}`); toast("Documento apagado."); documentsReal(el, year); } catch (x) { toast(msg(x)); }
  });
  registerTour("documentos", TOUR_PAGINAS2_VERSAO, stepsDocumentos(), { res }, { autostart: /[?&]tour=1/.test(location.hash) });
}
