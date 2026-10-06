/* Simulador de cenários sobre os dados reais (roda no navegador e na API).
 * Venda de ativos: recalcula a apuração do ano com as vendas hipotéticas e compara com o cenário atual.
 * PGBL: dedução de até 12% dos rendimentos tributáveis (modelo completo + contribuição à previdência oficial).
 * Mostra consequências estimadas; não recomenda comprar ou vender. */
import { computeTax, ENGINE_VERSION } from "./tax_engine.js";

const r2 = v => (Math.round((+v || 0) * 100) / 100).toFixed(2);
const DISCLAIMER = "Simulação informativa. Mostra consequências estimadas de cenários; não é recomendação de investimento nem substitui a análise de um contador.";

/* trades: negociações reais · positions: posições da carteira (ticker, quantity, invested, price)
 * ops: [{ ticker, quantity, date, price? }] · opts: { refDate, knownClasses, priorLosses, paidDarfs } */
export function simulateSale({ trades = [], positions = [], ops = [], opts = {} }) {
  if (!ops.length) throw Object.assign(new Error("Informe ao menos uma venda."), { status: 422 });
  const refDate = opts.refDate || new Date().toISOString().slice(0, 10);
  const year = +ops[0].date.slice(0, 4);
  const base = [...trades];
  const notes = [];
  // posição da B3 sem histórico de compras: usa o valor aplicado (se houver) como custo de abertura
  const tradedQty = {};
  [...trades].sort((a, b) => a.date.localeCompare(b.date)).forEach(t => {
    const k = String(t.ticker).toUpperCase(); tradedQty[k] = (tradedQty[k] || 0) + (t.side === "C" ? +t.quantity : -t.quantity);
  });
  const extra = [];
  for (const op of ops) {
    const tk = String(op.ticker).toUpperCase();
    const pos = positions.find(p => String(p.ticker || "").toUpperCase() === tk);
    const q = +op.quantity;
    if (!(q > 0)) throw Object.assign(new Error("Quantidade deve ser positiva."), { status: 422 });
    if (!/^\d{4}-\d{2}-\d{2}$/.test(op.date || "") || op.date < refDate) throw Object.assign(new Error("A data da venda simulada deve ser hoje ou futura."), { status: 422 });
    const price = +op.price || +pos?.price || (pos && +pos.quantity ? +pos.value / +pos.quantity : 0);
    if (!(price > 0)) throw Object.assign(new Error(`Sem preço para ${tk}: informe o preço da venda.`), { status: 422 });
    const known = Math.max(0, tradedQty[tk] || 0), held = +pos?.quantity || 0;
    if (held > known + 1e-9 && pos?.invested != null && +pos.invested > 0) {
      const openQ = held - known, openCost = +pos.invested * openQ / held;
      extra.push({ date: `${year - 1}-01-02`, ticker: tk, side: "C", quantity: openQ, price: openCost / openQ, value: openCost, fees: 0, source: "custo informado na posição" });
      notes.push(`${tk}: ${openQ} unidade(s) sem negociação importada usam o valor aplicado da posição como custo.`);
      tradedQty[tk] = held;
    }
    if (q > (tradedQty[tk] || 0) + 1e-9) notes.push(`${tk}: a venda (${q}) é maior que a posição conhecida (${+(tradedQty[tk] || 0).toFixed(6)}); o excedente fica sem custo.`);
    extra.push({ date: op.date, ticker: tk, side: "V", quantity: q, price, value: q * price, fees: +op.fees || 0, source: "simulação" });
  }
  const o = { ...opts, year, refDate: ops.map(x => x.date).sort().at(-1) > refDate ? ops.map(x => x.date).sort().at(-1) : refDate };
  const withOpen = [...base, ...extra.filter(t => t.side === "C")];
  const tBase = computeTax(withOpen, o), tAlt = computeTax([...withOpen, ...extra.filter(t => t.side === "V")], o);
  const changed = tAlt.months.filter(m => { const b = tBase.months.find(x => x.month === m.month); return !b || b.tax_due_gross !== m.tax_due_gross || b.sales_acoes !== m.sales_acoes || b.result_comum !== m.result_comum; });
  const liquidity = extra.filter(t => t.side === "V").reduce((s, t) => s + t.value - t.fees, 0);
  const diff = +tAlt.total_tax_due - +tBase.total_tax_due;
  const pick = (t, name, key) => ({ name, key, tax_year: t.total_tax_due, exempt_gain_year: t.total_exempt_gain, losses_available: t.losses_available,
    liquidity_generated: "0.00", months: [], confidence: t.confidence, snapshot_hash: t.snapshot_hash });
  const label = ops.map(x => `${x.quantity} ${String(x.ticker).toUpperCase()}`).join(" + ") + ` em ${ops[0].date.split("-").reverse().slice(0, 2).join("/")}`;
  const alt = { ...pick(tAlt, `Vender ${label}`, "alt1"), liquidity_generated: r2(liquidity),
    months: changed.map(m => ({ month: m.month, sales_acoes: m.sales_acoes, exempt: m.exempt, tax_due: m.tax_due, tax_due_gross: m.tax_due_gross, irrf: m.irrf, exempt_gain: m.exempt_gain, darf: m.darf })),
    tax_difference_vs_base: r2(diff), net_liquidity_after_tax: r2(liquidity - Math.max(diff, 0)) };
  return {
    kind: "venda_ativos", results: [pick(tBase, "Cenário atual", "base"), alt],
    premises: [...tAlt.premises, "Preço da venda simulada: informado por você ou última cotação disponível.", "Custos de corretagem simulados = 0 quando não informados.", ...notes],
    limitations: tAlt.limitations, rule_versions: tAlt.rule_versions, reproducibility_hash: tAlt.snapshot_hash, disclaimer: DISCLAIMER,
  };
}

export const PGBL_RULE = { code: "BR-IRPF-PGBL-DEDUCAO", version: "2026.1", title: "Dedução de contribuições a PGBL", sources: ["R5"], limite: 0.12 };
export function simulatePgbl(b) {
  const num = v => +String(v ?? "").replace(",", ".") || 0;
  const inc = num(b.taxable_income), cur = num(b.current_contributions), ext = num(b.extra_contribution), rate = num(b.marginal_rate);
  if (!(inc > 0)) throw Object.assign(new Error("Informe os rendimentos tributáveis do ano."), { status: 422 });
  if (![0, 0.075, 0.15, 0.225, 0.275].includes(rate)) throw Object.assign(new Error("Alíquota marginal inválida."), { status: 422 });
  const lim = inc * PGBL_RULE.limite, eligible = !!b.full_model && !!b.contributes_social_security;
  const now = eligible ? Math.min(cur, lim) : 0, after = eligible ? Math.min(cur + ext, lim) : 0, eff = (after - now) * rate;
  const notes = [];
  if (!b.full_model) notes.push("No modelo simplificado a contribuição ao PGBL não é dedutível.");
  if (!b.contributes_social_security) notes.push("A dedução exige contribuição ao regime geral ou próprio de previdência.");
  if (cur + ext > lim) notes.push(`Contribuições acima de 12% (R$ ${r2(lim).replace(".", ",")}) não geram dedução adicional.`);
  return { kind: "pgbl", kind_label: "estimativa", limit_12pct: r2(lim), remaining_room: eligible ? r2(Math.max(0, lim - cur)) : "0.00", difference: r2(eff),
    results: [{ name: "Cenário atual", contributions: r2(cur), deductible: r2(now), tax_effect_estimate: "0.00", liquidity_committed: r2(cur) },
              { name: "Cenário com aporte adicional", contributions: r2(cur + ext), deductible: r2(after), tax_effect_estimate: r2(eff), liquidity_committed: r2(cur + ext) }],
    premises: [`Alíquota marginal informada: ${(rate * 100).toFixed(1).replace(".", ",")}%`,
               "Efeito é diferimento: o valor deduzido será tributado no resgate ou benefício conforme o regime escolhido.",
               "Tabela progressiva anual não é recalculada.", "VGBL não é dedutível: o IR incide só sobre os rendimentos no resgate.", ...notes],
    rule: { code: PGBL_RULE.code, version: PGBL_RULE.version, title: PGBL_RULE.title, sources: PGBL_RULE.sources },
    confidence: eligible ? 0.8 : 0.5, disclaimer: DISCLAIMER };
}

/* vários cenários (B, C…) contra o mesmo cenário atual — estrutura de cenário da v5.0 §9.2 */
export function simulateScenarios({ trades = [], positions = [], scenarios = [], opts = {} }) {
  const list = scenarios.filter(sc => sc && (sc.operations || []).length).slice(0, 3);
  if (!list.length) throw Object.assign(new Error("Informe ao menos uma venda."), { status: 422 });
  const runs = list.map((sc, i) => ({ sc, i, r: simulateSale({ trades, positions, ops: sc.operations, opts }) }));
  const base = runs[0].r.results[0];
  const results = [base, ...runs.map(({ sc, i, r }) => ({ ...r.results[1], key: "alt" + (i + 1), name: sc.name || r.results[1].name,
    scenario: { name: sc.name || r.results[1].name, inputs: sc.operations, assumptions: r.premises.slice(-3), rule_versions: r.rule_versions, calculation_version: ENGINE_VERSION,
      result: { tax_year: r.results[1].tax_year, liquidity_generated: r.results[1].liquidity_generated }, delta_vs_baseline: r.results[1].tax_difference_vs_base,
      confidence: r.results[1].confidence, limitations: r.limitations, audit_artifact: r.reproducibility_hash } }))];
  const first = runs[0].r;
  return { ...first, results, scenarios_count: list.length, calculation_version: ENGINE_VERSION,
    reproducibility_hash: runs.map(x => x.r.reproducibility_hash).join(":") };
}
