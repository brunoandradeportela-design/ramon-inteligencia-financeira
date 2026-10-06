/* Event Intelligence: junta eventos pessoais (DARF, vencimentos de títulos) com divulgações públicas
 * dos ativos a que o cliente está exposto. Puro: roda na API e no navegador. Não interpreta eventos como sinal. */
const DISCLAIMER = "Informativo. Eventos organizados a partir dos seus dados e de fontes públicas; não é recomendação de investimento.";
const up = s => String(s || "").trim().toUpperCase();

/* exposição = posições + negociações + watchlists (tickers de bolsa) */
export function exposureOf({ holdings = [], trades = [], watchlists = [] }) {
  const s = new Set();
  holdings.forEach(h => h.ticker && s.add(up(h.ticker)));
  trades.forEach(t => t.ticker && s.add(up(t.ticker)));
  watchlists.forEach(w => (w.tickers || []).forEach(t => s.add(up(t))));
  return [...s].filter(t => /^[A-Z]{4}\d{1,2}[A-Z]?$/.test(t)).sort();
}

export function personalEvents({ tax = null, holdings = [], refDate, horizonDays = 120, pastDays = 30 }) {
  const ref = Date.parse(refDate), inWin = d => { const x = Date.parse(d); return x >= ref - pastDays * 864e5 && x <= ref + horizonDays * 864e5; };
  const out = [];
  for (const m of tax?.months || []) {
    const d = m.darf; if (!d || d.status === "pago" || (d.status !== "vencido" && !inWin(d.vencimento))) continue;   // DARF vencido e não pago aparece sempre
    out.push({ date: d.vencimento, kind: "darf", title: `DARF ${d.codigo} — competência ${d.competencia.split("-").reverse().join("/")}`,
      detail: `Valor estimado R$ ${String(d.valor).replace(".", ",")}${d.status === "vencido" ? " · vencido" : ""}`, impact: d.status === "vencido" ? "atenção" : "prazo",
      source: "Tax Engine AURION (estimativa)", link: "#/tributacao" });
  }
  for (const h of holdings) {
    if (!h.maturity || !inWin(h.maturity)) continue;
    out.push({ date: h.maturity, kind: "vencimento", title: `Vencimento: ${h.name || h.ticker || "título"}`,
      detail: [h.custodian, h.indexer, h.value != null ? `posição R$ ${String(h.value).replace(".", ",")}` : null].filter(Boolean).join(" · "), impact: "liquidez",
      source: h.source || "posição importada", link: "#/alocacao" });
  }
  return out;
}

export function mergeDisclosures(events, disclosures = [], exposure = [], { limit = 60 } = {}) {
  const ex = new Set(exposure.map(up));
  const pub = disclosures.filter(d => (d.tickers || []).some(t => ex.has(up(t)))).slice(0, limit).map(d => ({
    date: d.date, kind: "divulgacao", title: `${d.company}: ${d.category_label || "divulgação"}`, detail: d.subject || "", impact: (d.tickers || []).filter(t => ex.has(up(t))).join(", "),
    source: d.source || "CVM", url: d.url || null }));
  return [...events, ...pub].sort((a, b) => a.date.localeCompare(b.date));
}

export function eventsView({ tax, holdings, trades, watchlists, refDate }) {
  const exposure = exposureOf({ holdings, trades, watchlists });
  return { ref_date: refDate, exposure, items: personalEvents({ tax, holdings, refDate }).sort((a, b) => a.date.localeCompare(b.date)), disclaimer: DISCLAIMER };
}
