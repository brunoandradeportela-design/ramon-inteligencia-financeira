/* Minha Alocação (v5.0 §6.5): composição por classe e instituição, vencimentos, evolução, rentabilidade com
 * metodologia explícita e separação entre crescimento por aportes e por performance. Informativo — não é enquadramento nem recomendação. */

const r2 = v => (Math.round((+v || 0) * 100) / 100).toFixed(2);
const day = d => String(d || "").slice(0, 10);

export function allocationView({ port, snapshots = [], txs = [], market = null, refDate = new Date().toISOString().slice(0, 10) }) {
  const pos = port.positions || [];
  const total = +port.total || 0;
  const byInst = {};
  pos.forEach(p => { const k = p.custodian || "—"; (byInst[k] = byInst[k] || { institution: k, value: 0, classes: {} }); byInst[k].value += +p.value; byInst[k].classes[p.group] = (byInst[k].classes[p.group] || 0) + +p.value; });
  const by_institution = Object.values(byInst).sort((a, b) => b.value - a.value).map(i => ({ institution: i.institution, value: r2(i.value), weight: total ? i.value / total : 0,
    classes: Object.entries(i.classes).map(([g, v]) => ({ group: g, value: r2(v) })) }));
  const maturities = pos.filter(p => p.maturity).sort((a, b) => a.maturity.localeCompare(b.maturity)).map(p => ({ name: p.name, custodian: p.custodian, maturity: p.maturity, value: p.value, indexer: p.indexer,
    days: Math.round((Date.parse(p.maturity) - Date.parse(refDate)) / 864e5) }));
  const buckets = [["até 1 ano", 365], ["1 a 3 anos", 1095], ["3 a 5 anos", 1825], ["acima de 5 anos", Infinity]];
  const maturity_ladder = buckets.map(([label, lim], i) => ({ label, value: r2(maturities.filter(m => m.days >= 0 && m.days <= lim && (i === 0 || m.days > buckets[i - 1][1])).reduce((s, m) => s + +m.value, 0)) }));

  // evolução e separação aportes × performance entre o primeiro e o último retrato
  const snaps = [...snapshots].sort((a, b) => a.date.localeCompare(b.date));
  const evolution = snaps.map(s => ({ date: s.date, value: s.total }));
  let flows = null;
  if (snaps.length >= 2) {
    const a = snaps[0], b = snaps.at(-1);
    const inv = txs.filter(t => t.category === "Investimentos" && day(t.date) > a.date && day(t.date) <= b.date);
    const aportes = -inv.filter(t => +t.amount < 0).reduce((s, t) => s + +t.amount, 0), resgates = inv.filter(t => +t.amount > 0).reduce((s, t) => s + +t.amount, 0);
    const change = +b.total - +a.total, net = aportes - resgates;
    flows = { from: a.date, to: b.date, start_value: r2(a.total), end_value: r2(b.total), change: r2(change), contributions: r2(aportes), withdrawals: r2(resgates),
      net_contributions: r2(net), performance: r2(change - net), performance_pct: +a.total ? (change - net) / (+a.total + Math.max(net, 0) / 2) : 0,
      method: "Performance = variação do patrimônio investido − aportes líquidos (aplicações − resgates identificados nos extratos). Aproximação de Dietz simples: aportes contam pela metade do período." };
  }
  return {
    has_data: pos.length > 0, reference_date: refDate, total: r2(total),
    by_class: port.allocation, by_institution, maturities, maturity_ladder, evolution, flows,
    performance: { invested: port.invested, result: port.result, result_pct: port.result_pct, coverage: port.result_coverage,
      method: "Resultado sobre o custo conhecido (preço médio das negociações ou valor aplicado informado pela instituição). Ativos sem custo conhecido ficam fora do cálculo." },
    benchmark: market ? { cdi_12m: market.cdi_12m || null, ipca_12m: market.ipca_12m || null, selic_meta: market.selic_meta || null,
      note: "Referência para comparação: CDI e IPCA acumulados em 12 meses (Banco Central). Compare períodos iguais; o resultado da carteira é acumulado desde as compras." } : null,
    positions: pos,
    disclaimer: "Informação descritiva da sua carteira. Não é recomendação de compra, venda ou rebalanceamento.",
  };
}
