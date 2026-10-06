/* Divulgações públicas e Event Intelligence.
 * Fonte: dados abertos da CVM (IPE — fatos relevantes, comunicados, avisos), coletados por automação pública e
 * gravados em data/public/disclosures.json com link para o documento original. Nada aqui é recomendação. */
import { api } from "./api.js";
import { dt, empty, esc } from "./ui.js";
import { mergeDisclosures } from "./event_engine.js";

const CAT = { fato_relevante: "Fato relevante", comunicado: "Comunicado ao mercado", aviso_acionistas: "Aviso aos acionistas", assembleia: "Assembleia", resultado: "Resultado/ITR/DFP", outro: "Outro" };

export async function loadDisclosures() {
  const r = await fetch(new URL("../data/public/disclosures.json", import.meta.url), { cache: "no-cache" }).catch(() => null);
  if (!r || !r.ok) return { generated_at: null, source: null, items: [] };
  return r.json();
}

export async function disclosuresView(el) {
  const [d, ev] = await Promise.all([loadDisclosures(), api.get("/v1/events").catch(() => ({ exposure: [] }))]);
  const mine = new Set((ev.exposure || []).map(x => x.toUpperCase()));
  let only = mine.size > 0;
  const draw = () => {
    const q = (el.querySelector("#dq")?.value || "").trim().toUpperCase(), cat = el.querySelector("#dc")?.value || "";
    const list = d.items.filter(i => (!only || (i.tickers || []).some(t => mine.has(t))) && (!cat || i.category === cat)
      && (!q || (i.tickers || []).some(t => t.includes(q)) || String(i.company).toUpperCase().includes(q) || String(i.subject || "").toUpperCase().includes(q))).slice(0, 150);
    el.querySelector("#dl").innerHTML = list.length ? `<ul class="stack">${list.map(i => `<li class="card" style="padding:12px">
        <div class="row wrap" style="gap:8px;justify-content:space-between"><b>${esc(i.company)}</b><span class="small muted">${dt(i.date)}${i.published_at ? " · publicado " + dt(i.published_at) : ""}</span></div>
        <div class="small" style="margin-top:4px"><span class="pill">${esc(CAT[i.category] || i.category_label || "Outro")}</span> ${(i.tickers || []).map(t => `<code>${esc(t)}</code>`).join(" ")}${(i.tickers || []).some(t => mine.has(t)) ? ' <span class="pill">na sua carteira/watchlist</span>' : ""}</div>
        ${i.subject ? `<p class="small" style="margin-top:6px">${esc(i.subject)}</p>` : ""}
        <p class="small muted" style="margin-top:6px">Fonte: ${esc(i.source)} · protocolo ${esc(i.protocol || "—")} ${i.url ? `· <a href="${esc(i.url)}" target="_blank" rel="noopener">documento original</a>` : ""}</p></li>`).join("")}</ul>`
      : empty(only ? "Nenhuma divulgação recente para os ativos que você tem ou acompanha." : "Nenhuma divulgação encontrada com esses filtros.");
  };
  el.innerHTML = `<section class="card">
      <h3>Divulgações públicas das companhias</h3>
      <p class="small muted" style="margin-top:6px">Documentos públicos enviados à CVM (fatos relevantes, comunicados, avisos aos acionistas). ${d.generated_at ? `Atualizado em ${dt(d.generated_at)} · ${d.items.length} documentos.` : "A coleta automática ainda não gerou dados."}</p>
      <div class="row wrap" style="gap:8px;margin-top:12px">
        <input id="dq" class="input" placeholder="Ticker, empresa ou assunto" aria-label="Buscar divulgações" style="max-width:260px">
        <select id="dc" class="input" aria-label="Categoria" style="max-width:220px"><option value="">Todas as categorias</option>${Object.entries(CAT).map(([k, v]) => `<option value="${k}">${v}</option>`).join("")}</select>
        <label class="small row" style="gap:6px"><input type="checkbox" id="do" ${only ? "checked" : ""}> Só os meus ativos</label>
      </div>
      <div id="dl" class="section"></div>
      <p class="note">Fonte pública e rastreável: ${esc(d.source || "CVM — Portal de Dados Abertos (IPE)")}. O AURION organiza e liga ao documento original; não interpreta como sinal de compra ou venda. Divulgação pública não é indício nem prova de informação privilegiada: o AURION só usa informação já tornada pública pela companhia.</p></section>`;
  el.querySelector("#dq").oninput = draw; el.querySelector("#dc").onchange = draw;
  el.querySelector("#do").onchange = e => { only = e.target.checked; draw(); };
  draw();
}

const KIND = { darf: "DARF", vencimento: "Vencimento", divulgacao: "Divulgação", declaracao: "Declaração", alerta: "Alerta" };
export async function eventsView(el) {
  const [ev, d] = await Promise.all([api.get("/v1/events"), loadDisclosures()]);
  const items = mergeDisclosures(ev.items || [], d.items, ev.exposure || []);
  el.innerHTML = `<section class="card">
      <h3>Eventos que afetam você</h3>
      <p class="small muted" style="margin-top:6px">Prazos tributários, vencimentos dos seus títulos e divulgações públicas dos ativos que você tem ou acompanha, em ordem de data.</p>
      ${items.length ? `<ul class="stack section">${items.map(i => `<li class="row wrap" style="gap:10px;align-items:flex-start;border-bottom:1px solid var(--line);padding-bottom:8px">
          <span class="pill" style="min-width:96px;text-align:center">${dt(i.date)}</span>
          <div style="flex:1;min-width:200px"><b>${esc(i.title)}</b> <span class="small muted">· ${esc(KIND[i.kind] || i.kind)}${i.impact ? " · " + esc(i.impact) : ""}</span>
            ${i.detail ? `<div class="small">${esc(i.detail)}</div>` : ""}
            <div class="small muted">Fonte: ${esc(i.source)}${i.url ? ` · <a href="${esc(i.url)}" target="_blank" rel="noopener">abrir</a>` : ""}${i.link ? ` · <a href="${esc(i.link)}">ver no AURION</a>` : ""}</div></div></li>`).join("")}</ul>`
      : empty("Nenhum evento nos próximos dias. Importe sua carteira e notas para ver prazos e divulgações.")}
      <p class="note">${esc(ev.disclaimer || "Informativo. Não é recomendação de investimento.")}</p></section>`;
}

