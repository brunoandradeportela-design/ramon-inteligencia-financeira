/* Importar dados — o cliente envia extratos, relatórios da B3 e notas de corretagem.
 * O arquivo é lido aqui no navegador; só os registros normalizados vão para a API. */
import { registerTour } from "./tour.js";
import { stepsImportar, TOUR_PAGINAS2_VERSAO } from "./tour_paginas2.js";
import { api, HAS_API, ApiError } from "./api.js";
import { parseOFX, parseCSV, parseB3Workbook, parseNotaCorretagem, detectKind, summarize } from "./importers.js";
import { brl, dt, esc, icon, toast, empty } from "./ui.js";

const XLSX_URL = "https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js";
const PDFJS_URL = "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.min.mjs";
const PDFJS_WORKER = "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.worker.min.mjs";

function loadScript(src) {
  return new Promise((ok, fail) => { if (window.XLSX) return ok(); const s = document.createElement("script"); s.src = src; s.onload = ok; s.onerror = () => fail(new Error("Não foi possível carregar o leitor de planilhas.")); document.head.appendChild(s); });
}
async function readXlsx(file) {
  await loadScript(XLSX_URL);
  const wb = window.XLSX.read(await file.arrayBuffer(), { type: "array" });
  return Object.fromEntries(wb.SheetNames.map(n => [n, window.XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, raw: false, defval: "" })]));
}
async function readPdfText(file) {
  const pdfjs = await import(PDFJS_URL);
  pdfjs.GlobalWorkerOptions.workerSrc = PDFJS_WORKER;
  const doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  let out = "";
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i), tc = await page.getTextContent();
    // reconstrói linhas pela posição vertical dos trechos
    const lines = {};
    tc.items.forEach(it => { const y = Math.round(it.transform[5]); (lines[y] = lines[y] || []).push(it); });
    out += Object.keys(lines).sort((a, b) => b - a).map(y => lines[y].sort((a, b) => a.transform[4] - b.transform[4]).map(i => i.str).join(" ")).join("\n") + "\n";
  }
  return out;
}

export async function parseFile(file, opts = {}) {
  const kind = detectKind(file.name);
  if (!kind) throw new Error("Formato não suportado. Envie OFX, CSV, XLSX (B3) ou PDF (nota de corretagem).");
  if (file.size > 15 * 1024 * 1024) throw new Error("Arquivo acima de 15 MB.");
  if (kind === "ofx") return parseOFX(await file.text());
  if (kind === "csv") {
    const buf = await file.arrayBuffer();
    let text = new TextDecoder("utf-8").decode(buf);
    if (text.includes("�")) text = new TextDecoder("windows-1252").decode(buf);     // bancos que exportam em ANSI
    return parseCSV(text, { filename: file.name, accountType: opts.accountType || "auto" });
  }
  if (kind === "xlsx") return parseB3Workbook(await readXlsx(file));
  return parseNotaCorretagem(await readPdfText(file));
}

const LABEL = { ofx: "Extrato OFX", csv: "Extrato CSV", b3_posicao: "B3 · Posição", b3_negociacao: "B3 · Negociações", b3_movimentacao: "B3 · Movimentação", nota_corretagem: "Nota de corretagem", b3: "B3" };

export async function importData(el) {
  if (!HAS_API) {
    el.innerHTML = `<section class="card">${empty("A importação de dados funciona no site oficial, com a sua conta. Este endereço é apenas demonstração.")}</section>`;
    return;
  }
  let pending = null, lastList = null;
  const draw = async () => {
    let list = { items: [] };
    try { list = await api.get("/v1/imports"); } catch (e) { /* lista vazia */ }
    lastList = list;
    el.innerHTML = `
      <section class="card" data-tour="imp-intro">
        <h3>Traga seus dados reais</h3>
        <p class="small muted" style="margin-top:6px">Envie os arquivos que você já baixa do banco e da B3. A leitura acontece no seu navegador e só os lançamentos e posições vão para a sua conta, protegidos. Você pode apagar qualquer importação quando quiser.</p>
        <div class="grid g-4" style="margin-top:14px" data-tour="imp-tipos">
          ${[["Extrato da conta ou do cartão", "OFX ou CSV — no app ou internet banking: Extrato › Exportar."],
             ["Posição na B3", "investidor.b3.com.br › Extratos › Posição › baixar em Excel."],
             ["Negociações na B3", "investidor.b3.com.br › Extratos › Negociação › baixar em Excel, desde a primeira compra (custo médio e imposto mensal)."],
             ["Nota de corretagem", "PDF da corretora no padrão SINACOR (beta)."]].map(([t, d]) => `<div class="card" style="box-shadow:none"><b class="small">${t}</b><p class="small muted" style="margin-top:4px">${d}</p></div>`).join("")}
        </div>
        <form id="imp" data-tour="imp-form" class="row wrap" style="gap:10px;margin-top:16px;align-items:flex-end">
          <div class="field" style="min-width:260px;flex:1"><label for="file">Arquivo</label><input class="input" type="file" id="file" accept=".ofx,.qfx,.csv,.txt,.xlsx,.xls,.pdf" required></div>
          <div class="field"><label for="acct">Se for CSV, é de</label><select class="input" id="acct"><option value="auto">Detectar</option><option value="conta">Conta corrente</option><option value="cartao">Cartão de crédito</option></select></div>
          <button class="btn btn--primary" id="read">Ler arquivo</button>
        </form>
        <p class="err" id="err" role="alert"></p>
        <div id="preview"></div>
      </section>
      <section class="card section" data-tour="imp-lista"><h3>Importações <span class="right small muted">${list.items.length}</span></h3>
        ${list.items.length ? `<div class="table-wrap"><table class="table" style="margin-top:10px"><thead><tr><th>Data</th><th>Arquivo</th><th>Tipo</th><th class="num">Lançamentos</th><th class="num">Posições</th><th class="num">Negociações</th><th></th></tr></thead>
          <tbody>${list.items.map(i => `<tr><td>${dt(i.created_at)}</td><td>${esc(i.filename)}</td><td>${esc(LABEL[i.kind] || i.kind || "—")}</td>
            <td class="num">${i.counts?.transactions || 0}</td><td class="num">${i.counts?.holdings || 0}</td><td class="num">${i.counts?.trades || 0}</td>
            <td><button class="btn btn--ghost btn--sm" data-del="${esc(i.id)}">Apagar</button></td></tr>`).join("")}</tbody></table></div>
          <p class="note">Ao importar uma nova posição da B3, a anterior é substituída. Lançamentos repetidos são reconhecidos e não se duplicam.</p>`
          : `<p class="small muted" style="margin-top:8px">Nenhuma importação ainda. Enquanto isso, Início, Patrimônio, Finanças e Tributação mostram dados de exemplo.</p>`}
      </section>`;
    el.querySelector("#imp").onsubmit = read;
    el.querySelectorAll("[data-del]").forEach(b => b.onclick = async () => {
      b.disabled = true;
      try { await api.del(`/v1/imports/${b.dataset.del}`); toast("Importação apagada."); draw(); } catch (e) { toast(e.message); b.disabled = false; }
    });
  };
  async function read(e) {
    e.preventDefault();
    const err = el.querySelector("#err"), box = el.querySelector("#preview"), btn = el.querySelector("#read");
    const file = el.querySelector("#file").files[0];
    err.textContent = ""; box.innerHTML = "";
    if (!file) return;
    btn.disabled = true; btn.textContent = "Lendo…";
    try {
      const parsed = await parseFile(file, { accountType: el.querySelector("#acct").value });
      pending = { file, parsed };
      const c = summarize(parsed);
      const sample = parsed.transactions?.slice(0, 5).map(t => `<tr><td>${dt(t.date)}</td><td>${esc(t.description)}</td><td class="num ${t.amount < 0 ? "" : "pos"}">${brl(t.amount)}</td></tr>`).join("")
        || parsed.holdings?.slice(0, 6).map(h => `<tr><td>${esc(h.name)}</td><td>${esc(h.custodian)}</td><td class="num">${brl(h.value)}</td></tr>`).join("")
        || parsed.trades?.slice(0, 6).map(t => `<tr><td>${dt(t.date)}</td><td>${t.side === "C" ? "Compra" : "Venda"} ${esc(t.ticker)} · ${t.quantity}</td><td class="num">${brl(t.value)}</td></tr>`).join("");
      box.innerHTML = `<div class="card" style="margin-top:14px;border-color:var(--brand-2)">
        <h3>Prévia · ${esc(LABEL[parsed.kind] || parsed.kind)}</h3>
        <p class="small" style="margin-top:6px">${[c.transactions && `${c.transactions} lançamentos`, c.accounts && `${c.accounts} conta(s)`, c.holdings && `${c.holdings} posições`, c.trades && `${c.trades} negociações`].filter(Boolean).join(" · ")}</p>
        <div class="table-wrap"><table class="table" style="margin-top:8px"><tbody>${sample}</tbody></table></div>
        <div class="row" style="gap:10px;margin-top:12px"><button class="btn btn--primary" id="ok">Confirmar importação</button><button class="btn btn--ghost" id="cancel">Cancelar</button></div></div>`;
      box.querySelector("#cancel").onclick = () => { box.innerHTML = ""; pending = null; };
      box.querySelector("#ok").onclick = confirm;
    } catch (x) { err.textContent = x.message || String(x); }
    btn.disabled = false; btn.textContent = "Ler arquivo";
  }
  async function confirm(ev) {
    const b = ev.target; b.disabled = true; b.textContent = "Importando…";
    const { file, parsed } = pending;
    try {
      const r = await api.post("/v1/imports", { filename: file.name, kind: parsed.kind, source: parsed.source, replace_holdings: !!parsed.replace_holdings,
        transactions: parsed.transactions || [], accounts: parsed.accounts || [], holdings: parsed.holdings || [], trades: parsed.trades || [], incomes: parsed.incomes || [] });
      toast(`Importado: ${Object.entries(r.counts).filter(([, v]) => v).map(([k, v]) => `${v} ${({ transactions: "lançamentos", accounts: "contas", holdings: "posições", trades: "negociações", incomes: "proventos" })[k]}`).join(", ")}.`);
      pending = null; draw();
    } catch (x) { el.querySelector("#err").textContent = x instanceof ApiError ? (x.problem.detail || x.problem.title) : x.message; b.disabled = false; b.textContent = "Confirmar importação"; }
  }
  await draw();
  registerTour("importar", TOUR_PAGINAS2_VERSAO, stepsImportar(), { list: lastList }, { autostart: /[?&]tour=1/.test(location.hash) });
}
