/* AURION Connect — Data Hub: deduplicação entre fontes, reconciliação e indicadores de qualidade.
 * Funções puras (API e testes). Nunca apagam o dado original: só marcam duplicidade, estado de reconciliação e qualidade. */

const norm = s => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
const day = d => String(d || "").slice(0, 10);
const srcRank = s => /^open_finance/.test(s || "") ? 0 : /^ofx|^csv|^arquivo/.test(s || "") ? 1 : 2;   // Open Finance é a fonte preferida

/* mesma transação vinda de fontes diferentes (ex.: OFX importado e Open Finance) → mantém uma, marca as outras */
export function dedupeTransactions(txs) {
  const groups = new Map();
  for (const t of txs || []) {
    const k = [day(t.date), (+t.amount).toFixed(2), norm(t.description).slice(0, 24)].join("|");
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(t);
  }
  const kept = [], duplicates = [];
  for (const g of groups.values()) {
    const bySource = new Map();
    for (const t of g) { const s = t.import_id || t.source || "?"; if (!bySource.has(s)) bySource.set(s, []); bySource.get(s).push(t); }
    if (bySource.size <= 1) { kept.push(...g); continue; }       // repetição dentro da mesma fonte é legítima (dois cafés iguais no mesmo dia)
    const sources = [...bySource.entries()].sort((a, b) => srcRank(a[1][0].source) - srcRank(b[1][0].source));
    const main = sources[0][1], n = Math.max(...sources.map(([, l]) => l.length));
    kept.push(...main);
    for (const [, l] of sources.slice(1)) for (const t of l.slice(0, main.length)) duplicates.push({ ...t, duplicate_of: main[0].id });
    if (n > main.length) for (const [, l] of sources.slice(1)) kept.push(...l.slice(main.length));
  }
  return { kept, duplicates };
}

/* posições da B3 × quantidade formada pelas negociações */
export function reconcilePositions(holdings, positionsFromTrades) {
  const out = [];
  const rv = (holdings || []).filter(h => ["acao", "fii", "etf", "bdr"].includes(h.asset_class) && h.ticker);
  const seen = new Set();
  for (const h of rv) {
    const tk = h.ticker.toUpperCase(); seen.add(tk);
    const t = positionsFromTrades[tk], hq = +h.quantity, tq = t ? +t.quantidade : 0;
    const state = !t ? "unresolved" : Math.abs(hq - tq) < 1e-6 ? "matched" : tq > 0 && tq < hq ? "partial" : "conflict";
    out.push({ key: tk, kind: "posicao", state, position_qty: hq, trades_qty: tq, source: h.source || "posição",
      detail: state === "matched" ? "Quantidade da posição bate com as negociações." : state === "partial" ? `Faltam negociações de ${+(hq - tq).toFixed(6)} unidade(s) (compras anteriores ao período importado).`
        : state === "conflict" ? `Negociações somam ${tq} e a posição mostra ${hq}. Pode haver desdobramento, bonificação, aluguel ou nota faltando.` : "Sem negociações importadas deste ativo." });
  }
  for (const [tk, t] of Object.entries(positionsFromTrades || {})) if (!seen.has(tk) && +t.quantidade > 0 && rv.length)
    out.push({ key: tk, kind: "posicao", state: "conflict", position_qty: 0, trades_qty: +t.quantidade, source: "negociações", detail: "As negociações indicam posição, mas a posição da B3 não mostra este ativo (vendido sem registro, transferido ou evento corporativo)." });
  return out;
}

/* saldo informado pela instituição × soma dos lançamentos desde a data do saldo anterior (quando houver dois saldos) */
export function reconcileAccounts(accounts, txs) {
  return (accounts || []).filter(a => a.type !== "cartao").map(a => {
    const own = (txs || []).filter(t => t.account_id && (t.account_id === a.external_id || t.account_id === a.id));
    if (!own.length) return { key: a.name, kind: "conta", state: "unresolved", detail: "Saldo sem lançamentos vinculados para conferir." };
    const prev = a.previous_balance;
    if (prev == null) return { key: a.name, kind: "conta", state: "partial", detail: `${own.length} lançamento(s); falta um saldo anterior para fechar a conta.` };
    const sum = own.filter(t => day(t.date) > day(prev.date) && day(t.date) <= day(a.balance_date)).reduce((s, t) => s + +t.amount, 0);
    const diff = +a.balance - (+prev.value + sum);
    return { key: a.name, kind: "conta", state: Math.abs(diff) < 0.01 ? "matched" : "conflict", diff: +diff.toFixed(2),
      detail: Math.abs(diff) < 0.01 ? "Saldo fecha com os lançamentos." : `Diferença de R$ ${diff.toFixed(2).replace(".", ",")} entre saldo e lançamentos.` };
  });
}

/* indicadores: freshness, completeness, validity, consistency, duplicates, reconciliation */
export function qualityIndicators({ imports = [], connections = [], txs = [], duplicates = [], reconciliation = [], holdings = [], trades = [], refDate = new Date().toISOString().slice(0, 10) }) {
  const ages = [...imports.map(i => i.created_at), ...connections.map(c => c.last_sync_at).filter(Boolean)].map(d => (Date.parse(refDate) - Date.parse(day(d))) / 864e5);
  const freshest = ages.length ? Math.min(...ages) : null;
  const months = [...new Set(txs.map(t => String(t.date).slice(0, 7)))].sort();
  let gaps = 0;
  for (let i = 1; i < months.length; i++) { const [y1, m1] = months[i - 1].split("-").map(Number), [y2, m2] = months[i].split("-").map(Number); gaps += Math.max(0, (y2 - y1) * 12 + m2 - m1 - 1); }
  const rejected = imports.reduce((s, i) => s + (+i.rejected || 0), 0), accepted = imports.reduce((s, i) => s + Object.values(i.counts || {}).reduce((a, b) => a + b, 0), 0);
  const rec = { matched: 0, partial: 0, conflict: 0, unresolved: 0 }; reconciliation.forEach(r => rec[r.state]++);
  const score = (v, w) => ({ value: v, weight: w });
  const parts = {
    freshness: score(freshest == null ? 0 : freshest <= 7 ? 1 : freshest <= 31 ? 0.6 : 0.3, 0.2),
    completeness: score(!txs.length && !holdings.length ? 0 : months.length ? Math.max(0, 1 - gaps / Math.max(months.length, 1)) * (holdings.length || trades.length ? 1 : 0.7) : 0.5, 0.25),
    validity: score(accepted + rejected ? accepted / (accepted + rejected) : 1, 0.15),
    consistency: score(rec.matched + rec.partial + rec.conflict ? (rec.matched + rec.partial * 0.5) / (rec.matched + rec.partial + rec.conflict) : 1, 0.25),   // "sem par" não pune: falta dado para comparar
    duplicates: score(txs.length ? 1 - Math.min(1, duplicates.length / txs.length) : 1, 0.15),
  };
  const overall = Object.values(parts).reduce((s, p) => s + p.value * p.weight, 0);
  const tips = [];
  if (freshest == null) tips.push("Importe extratos e relatórios da B3 ou conecte seu banco.");
  else if (freshest > 31) tips.push("Os dados mais recentes têm mais de 30 dias: importe ou sincronize de novo.");
  if (gaps) tips.push(`Há ${gaps} mês(es) sem lançamentos no meio do período importado.`);
  if (rec.partial || rec.conflict) tips.push(`${rec.partial + rec.conflict} posição(ões)/conta(s) não fecham com as negociações ou lançamentos.`);
  if (duplicates.length) tips.push(`${duplicates.length} lançamento(s) repetido(s) entre fontes foram desconsiderados nos totais (o original fica guardado).`);
  if (rejected) tips.push(`${rejected} registro(s) recusado(s) na validação das importações.`);
  return { overall: Math.round(overall * 100) / 100, indicators: Object.fromEntries(Object.entries(parts).map(([k, p]) => [k, Math.round(p.value * 100) / 100])),
    freshness_days: freshest == null ? null : Math.round(freshest), months_covered: months.length, month_gaps: gaps, duplicates: duplicates.length, rejected,
    reconciliation: rec, tips, note: "Qualidade/completude dos dados, não garantia jurídica ou fiscal." };
}

/* estado da conexão (v5.0 §4.4) a partir do status do agregador */
export const CONNECTION_STATE = { CREATED: "CONSENTED", UPDATING: "SYNCING", UPDATED: "HEALTHY", OUTDATED: "DEGRADED", LOGIN_ERROR: "ERROR", WAITING_USER_INPUT: "AUTH_PENDING" };
