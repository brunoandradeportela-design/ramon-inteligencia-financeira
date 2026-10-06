/* AURION Daily: resumo diário determinístico (sem LLM) a partir dos dados do cliente e de fontes públicas.
 * Mesmas entradas → mesmo texto. O roteiro de voz é o mesmo texto em frases curtas, sem siglas soletradas.
 * Informativo; não recomenda comprar, vender nem manter ativos. */
export const DAILY_VERSION = "aurion-daily@1.0.0";
const DISCLAIMER = "Resumo informativo gerado a partir dos seus dados e de fontes públicas. Não é recomendação de investimento.";
const brl = v => "R$ " + (+v || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const pct = (v, d = 1) => ((+v || 0) * 100).toLocaleString("pt-BR", { minimumFractionDigits: d, maximumFractionDigits: d }) + "%";
const dBR = s => s ? s.slice(0, 10).split("-").reverse().join("/") : "";
const CLASS_TAGS = { acao: ["bolsa"], etf: ["bolsa"], bdr: ["bolsa", "cambio"], fii: ["fii", "bolsa"], renda_fixa: ["renda_fixa", "juros"], tesouro: ["renda_fixa", "juros", "inflacao"],
  fundo: ["juros"], previdencia: ["previdencia"], cripto: ["cripto"] };

/* relevância de notícia: ticker que você tem/acompanha > tema da sua carteira > imposto (sempre relevante) */
export function personalizeNews(news = [], { exposure = [], classes = [] } = {}) {
  const ex = new Set(exposure), tags = new Set(classes.flatMap(c => CLASS_TAGS[c] || []));
  tags.add("imposto");
  return news.map(n => {
    const hitT = (n.tickers || []).filter(t => ex.has(t)), hitG = (n.tags || []).filter(t => tags.has(t));
    const score = hitT.length * 3 + hitG.length;
    return { ...n, relevance: score, why: hitT.length ? `menciona ${hitT.join(", ")}` : hitG.length ? `tema da sua carteira: ${hitG.join(", ").replace(/_/g, " ")}` : null };
  }).sort((a, b) => b.relevance - a.relevance || String(b.published_at).localeCompare(String(a.published_at)));
}

export function dailyBriefing({ date, dashboard = null, events = { items: [], exposure: [] }, indices = null, news = [], disclosures = [], classes = [] }) {
  const S = [];
  const first = dashboard?.greeting && dashboard.greeting !== "Olá" ? dashboard.greeting : null;
  const opening = `${first ? "Bom dia, " + first : "Bom dia"}. Este é o seu AURION Daily de ${dBR(date)}.`;
  // 1. patrimônio
  if (dashboard?.has_data) {
    const nw = dashboard.net_worth;
    S.push({ id: "patrimonio", title: "Seu patrimônio", text: `Patrimônio consolidado de ${brl(nw.total)}${nw.series?.length > 1 ? `, variação de ${pct(nw.variation_pct)} no período importado` : ""}. Saldo em conta cobre cerca de ${(+dashboard.liquidity.months_covered || 0).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} mês(es) de despesas.` });
  } else S.push({ id: "patrimonio", title: "Seu patrimônio", text: "Ainda não há dados seus importados. Importe extratos e a posição da B3 para receber um resumo personalizado." });
  // 2. tributação
  const nd = dashboard?.tax?.next_darf;
  if (nd) S.push({ id: "tributos", title: "Tributação", text: nd.status === "vencido" ? `Há DARF estimado de ${brl(nd.valor)} da competência ${nd.competencia.split("-").reverse().join("/")} vencido em ${dBR(nd.vencimento)}. Confira na Tributação.` : `Próximo DARF estimado: ${brl(nd.valor)}, vence em ${dBR(nd.vencimento)}.` });
  else if (dashboard?.tax) S.push({ id: "tributos", title: "Tributação", text: `Imposto estimado no ano: ${brl(dashboard.tax.estimated)}. Nenhum DARF em aberto.` });
  // 3. agenda (próximos 15 dias e pendências)
  const ref = Date.parse(date), soon = (events.items || []).filter(e => e.kind !== "divulgacao" && (Date.parse(e.date) - ref) / 864e5 <= 15 && ((Date.parse(e.date) >= ref) || e.impact === "atenção"));
  if (soon.length) S.push({ id: "agenda", title: "Agenda", text: soon.slice(0, 4).map(e => `${dBR(e.date)}: ${e.title}`).join(". ") + "." });
  // 4. alertas
  if (dashboard?.alerts?.open) S.push({ id: "alertas", title: "Radar", text: `${dashboard.alerts.open} alerta(s) aberto(s)${dashboard.alerts.critical ? `, ${dashboard.alerts.critical} crítico(s)` : ""}.` });
  // 5. mercado
  if (indices) {
    const parts = [];
    if (indices.selic_meta) parts.push(`Selic meta em ${pct(indices.selic_meta.value, 2)}`);
    if (indices.cdi_12m) parts.push(`CDI de 12 meses em ${pct(indices.cdi_12m.value, 2)}`);
    if (indices.ipca_12m) parts.push(`IPCA de 12 meses em ${pct(indices.ipca_12m.value, 2)}`);
    if (parts.length) S.push({ id: "mercado", title: "Indicadores", text: parts.join("; ") + `. Fonte: ${indices.source || "Banco Central"}.` });
  }
  // 6. divulgações dos seus ativos (últimos 3 dias)
  const ex = new Set(events.exposure || []);
  const disc = disclosures.filter(d => (d.tickers || []).some(t => ex.has(t)) && (ref - Date.parse(d.published_at || d.date)) / 864e5 <= 3);
  if (disc.length) S.push({ id: "divulgacoes", title: "Divulgações dos seus ativos", text: disc.slice(0, 4).map(d => `${d.company} publicou ${String(d.category_label || "documento").toLowerCase()}${d.subject ? ": " + d.subject : ""}`).join(". ") + ". Fonte: CVM." });
  // 7. notícias relevantes
  const rel = personalizeNews(news, { exposure: [...ex], classes }).filter(n => n.relevance > 0).slice(0, 3);
  if (rel.length) S.push({ id: "noticias", title: "Notícias para você", text: rel.map(n => `${n.title} (${n.source})`).join(". ") + "." });
  const script = [opening, ...S.map(s => `${s.title}. ${s.text}`), "Este resumo é informativo e não é recomendação de investimento."].join(" ")
    .replace(/R\$ ?(-?[\d.]+,\d{2})/g, "$1 reais").replace(/(\d{2})\/(\d{2})\/(\d{4})/g, "$1 do $2 de $3");
  return { version: DAILY_VERSION, date, opening, sections: S, voice_script: script, sources: [...new Set(rel.map(n => n.source).concat(disc.length ? ["CVM"] : [], indices ? [indices.source || "Banco Central"] : []))], disclaimer: DISCLAIMER };
}
