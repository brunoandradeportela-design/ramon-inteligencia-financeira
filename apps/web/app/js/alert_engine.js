/* Radar de alertas sobre os dados reais do cliente (roda no navegador e na API).
 * Entra: finanças, carteira e apuração já calculadas. Sai: alertas priorizados por
 * impacto × urgência × relevância × confiança, com evidências, regra e ação sugerida.
 * Informativo: a plataforma mostra consequências, não recomenda compra ou venda de ativos. */

const r2 = v => (Math.round((+v || 0) * 100) / 100).toFixed(2);
const brn = v => (+v).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const mesBr = mk => { const [y, m] = mk.split("-"); return `${m}/${y}`; };
function hid(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619) >>> 0; return h.toString(16).padStart(8, "0"); }

function make(code, key, o) {
  const impact = o.impact ?? 0.5, urgency = o.urgency ?? 0.5, relevance = o.relevance ?? 1, confidence = o.confidence ?? 1;
  return { id: "alr_" + hid(code + "|" + key), code, title: o.title, detail: o.detail, category: o.category, impact, urgency, relevance, confidence,
    priority: Math.round(impact * urgency * relevance * confidence * 1000) / 10, severity: o.severity, status: "novo",
    evidence: o.evidence || [], rule: o.rule || null, action: o.action || null, due_date: o.due_date || null };
}

export function buildAlerts({ fin, port, tax, refDate = new Date().toISOString().slice(0, 10), statuses = {} }) {
  const out = [];
  const curMonth = refDate.slice(0, 7);

  if (tax && tax.has_data) {
    // DARFs vencidos ou a vencer
    for (const m of tax.months) {
      const d = m.darf;
      if (!d || d.status === "pago") continue;
      const days = d.dias_para_vencimento;
      if (d.status === "vencido") out.push(make("DARF_VENCIDO", d.competencia, {
        title: `DARF de ${mesBr(d.competencia)} vencido`, category: "tributario", severity: "critico", impact: 0.9, urgency: 1,
        detail: `Venceu em ${d.vencimento.split("-").reverse().join("/")} — estimativa de R$ ${brn(d.valor)} (código 6015). Pagamento em atraso tem multa de 0,33% ao dia (até 20%) e juros pela Selic. Se já pagou, marque como pago na Tributação.`,
        evidence: [{ label: "Competência", value: d.competencia }, { label: "Imposto estimado", value: d.valor }], rule: m.rules?.[0] || null,
        action: { label: "Ver apuração", route: "/tributacao" }, due_date: d.vencimento }));
      else if (days <= 15) out.push(make("DARF_VENCIMENTO", d.competencia, {
        title: `DARF de ${mesBr(d.competencia)} vence ${days <= 0 ? "hoje" : `em ${days} dia(s)`}`, category: "tributario",
        severity: days <= 5 ? "critico" : "alto", impact: 0.8, urgency: days <= 5 ? 1 : 0.7,
        detail: `Valor estimado R$ ${brn(d.valor)} (código 6015), vencimento ${d.vencimento.split("-").reverse().join("/")}. Gere o DARF no Sicalc da Receita ou peça ao seu contador.`,
        evidence: [{ label: "Competência", value: d.competencia }, { label: "Imposto estimado", value: d.valor }, { label: "IRRF compensado", value: m.irrf }],
        rule: m.rules?.[0] || null, action: { label: "Ver apuração", route: "/tributacao" }, due_date: d.vencimento }));
    }
    // vendas sem custo
    const pend = tax.events.filter(e => e.status === "pendente_dado");
    if (pend.length) out.push(make("DADO_INCOMPLETO", pend.map(e => e.ticker).sort().join(","), {
      title: "Venda sem custo de aquisição", category: "dados", severity: "alto", impact: 0.7, urgency: 0.6,
      detail: `${pend.length} venda(s) sem compra registrada (${[...new Set(pend.map(e => e.ticker))].join(", ")}). O imposto desses meses fica incompleto até você importar as negociações desde a primeira compra.`,
      evidence: pend.slice(0, 4).map(e => ({ label: `${e.ticker} em ${e.date.split("-").reverse().join("/")}`, value: e.sale_value })),
      action: { label: "Importar negociações", route: "/importar" } }));
    // limite de isenção no mês corrente
    const cur = tax.months.find(m => m.month === curMonth);
    if (cur && +cur.sales_acoes >= 15000 && +cur.sales_acoes <= 20000) out.push(make("ISENCAO_LIMITE", curMonth, {
      title: "Vendas de ações perto do limite de isenção", category: "tributario", severity: "atencao", impact: 0.6, urgency: 0.8,
      detail: `Você vendeu R$ ${brn(cur.sales_acoes)} em ações neste mês. Acima de R$ 20.000,00 todo o ganho do mês com ações passa a ser tributado a 15% — restam R$ ${brn(20000 - cur.sales_acoes)}.`,
      evidence: [{ label: "Vendas no mês", value: cur.sales_acoes }, { label: "Limite", value: "20000.00" }], rule: cur.rules?.[0] || null,
      action: { label: "Simular venda", route: "/simulador" } }));
    if (cur && +cur.sales_acoes > 20000 && +cur.result_acoes > 0) out.push(make("ISENCAO_ULTRAPASSADA", curMonth, {
      title: "Limite de isenção ultrapassado neste mês", category: "tributario", severity: "informativo", impact: 0.5, urgency: 0.5,
      detail: `Vendas de ações de R$ ${brn(cur.sales_acoes)} no mês: o ganho de R$ ${brn(cur.result_acoes)} com ações entra na base de 15%.`,
      evidence: [{ label: "Vendas no mês", value: cur.sales_acoes }, { label: "Ganho com ações", value: cur.result_acoes }], action: { label: "Ver apuração", route: "/tributacao" } }));
    // prejuízo a compensar
    const losses = Object.entries(tax.losses_available).filter(([, v]) => +v >= 100);
    if (losses.length) out.push(make("PREJUIZO_DISPONIVEL", losses.map(([k, v]) => k + v).join("|"), {
      title: "Prejuízo acumulado para compensar", category: "tributario", severity: "oportunidade", impact: 0.5, urgency: 0.3,
      detail: `Há prejuízo que abate ganhos futuros da mesma modalidade: ${losses.map(([k, v]) => `${({ comum: "operações comuns", daytrade: "day trade", fii: "FII" })[k]} R$ ${brn(v)}`).join("; ")}. Ele não prescreve e deve ser informado na declaração anual.`,
      evidence: losses.map(([k, v]) => ({ label: k, value: v })), action: { label: "Ver apuração", route: "/tributacao" } }));
    const inferred = tax.limitations.some(l => /inferida pelo código/.test(l));
    if (inferred) out.push(make("CLASSE_INFERIDA", "1", {
      title: "Confirme a classe de alguns ativos", category: "dados", severity: "informativo", impact: 0.4, urgency: 0.3, confidence: 0.8,
      detail: "Alguns códigos terminados em 11 foram tratados como FII (20%, sem isenção). Se forem units ou ETFs, o imposto muda. Importe a posição da B3 para confirmar.",
      action: { label: "Importar posição", route: "/importar" } }));
  }

  if (fin && fin.has_data) {
    const mc = fin.liquidity.months_covered;
    if (+fin.liquidity.avg_monthly_expense > 0 && mc < 3) out.push(make("RESERVA_CURTA", String(Math.floor(mc)), {
      title: "Reserva de emergência curta", category: "financeiro", severity: mc < 1 ? "alto" : "atencao", impact: 0.7, urgency: 0.5,
      detail: `O saldo em conta (R$ ${brn(fin.liquidity.cash)}) cobre cerca de ${mc.toFixed(1).replace(".", ",")} mês(es) da despesa média de R$ ${brn(fin.liquidity.avg_monthly_expense)}. Referência comum: de 3 a 6 meses.`,
      evidence: [{ label: "Saldo em conta", value: r2(fin.liquidity.cash) }, { label: "Despesa média", value: r2(fin.liquidity.avg_monthly_expense) }],
      action: { label: "Ver finanças", route: "/financas" } }));
    for (const c of (fin.changes || []).filter(c => c.delta_pct > 0.3).slice(0, 3)) out.push(make("GASTO_SUBIU", c.category + fin.period.to, {
      title: `${c.category}: gasto acima do normal`, category: "financeiro", severity: "atencao", impact: 0.4, urgency: 0.5,
      detail: `R$ ${brn(c.last)} no último mês contra R$ ${brn(c.baseline)} de média nos anteriores (+${Math.round(c.delta_pct * 100)}%).`,
      evidence: [{ label: "Último mês", value: c.last }, { label: "Média anterior", value: c.baseline }], action: { label: "Ver finanças", route: "/financas" } }));
    const subs = (fin.recurring || []).filter(r => r.category === "Assinaturas");
    if (subs.length >= 3) out.push(make("ASSINATURAS", subs.length + "", {
      title: `${subs.length} assinaturas recorrentes`, category: "financeiro", severity: "oportunidade", impact: 0.3, urgency: 0.2,
      detail: `Somam R$ ${brn(subs.reduce((s, x) => s + +x.monthly, 0))} por mês (R$ ${brn(subs.reduce((s, x) => s + +x.monthly, 0) * 12)} por ano). Vale revisar as que você não usa.`,
      evidence: subs.slice(0, 5).map(s => ({ label: s.description.slice(0, 30), value: s.monthly })), action: { label: "Ver finanças", route: "/financas" } }));
    if (fin.totals.savings_rate < 0) out.push(make("GASTA_MAIS", fin.period.to, {
      title: "Saídas maiores que as entradas no período", category: "financeiro", severity: "alto", impact: 0.7, urgency: 0.6,
      detail: `Nos últimos 6 meses as despesas (R$ ${brn(fin.totals.expense)}) superaram as receitas (R$ ${brn(fin.totals.income)}).`,
      evidence: [{ label: "Receitas", value: fin.totals.income }, { label: "Despesas", value: fin.totals.expense }], action: { label: "Ver finanças", route: "/financas" } }));
  }

  if (port && port.has_data) {
    if (port.concentration.largest_weight > 0.3) out.push(make("CONCENTRACAO", port.concentration.largest_position, {
      title: "Patrimônio concentrado em um ativo", category: "patrimonio", severity: "atencao", impact: 0.5, urgency: 0.3,
      detail: `${port.concentration.largest_position} representa ${Math.round(port.concentration.largest_weight * 100)}% da carteira importada. Informação descritiva — não é recomendação de venda.`,
      evidence: [{ label: "Peso", value: `${Math.round(port.concentration.largest_weight * 100)}%` }, { label: "HHI", value: String(port.concentration.hhi).replace(".", ",") }],
      action: { label: "Ver patrimônio", route: "/patrimonio" } }));
    const noCost = port.positions.filter(p => p.invested == null && ["acao", "fii", "etf", "bdr"].includes(p.asset_class));
    if (noCost.length) out.push(make("SEM_CUSTO_MEDIO", noCost.map(p => p.ticker || p.name).join(","), {
      title: "Posições sem preço médio", category: "dados", severity: "informativo", impact: 0.4, urgency: 0.3,
      detail: `${noCost.length} posição(ões) sem custo conhecido (${noCost.slice(0, 5).map(p => p.name).join(", ")}). Importe as negociações da B3 para calcular resultado e imposto.`,
      action: { label: "Importar negociações", route: "/importar" } }));
  }

  if (!(fin && fin.has_data)) out.push(make("IMPORTAR_EXTRATO", "1", { title: "Importe seus extratos", category: "dados", severity: "informativo", impact: 0.4, urgency: 0.3,
    detail: "Envie o extrato da conta ou do cartão (OFX ou CSV) para ver entradas, saídas, recorrências e reserva de emergência.", action: { label: "Importar", route: "/importar" } }));
  if (!(port && port.has_data) && !(tax && tax.has_data)) out.push(make("IMPORTAR_B3", "1", { title: "Importe seus dados da B3", category: "dados", severity: "informativo", impact: 0.4, urgency: 0.3,
    detail: "Posição e negociações da Área do Investidor da B3 liberam patrimônio, preço médio e imposto mensal.", action: { label: "Importar", route: "/importar" } }));

  out.forEach(a => { if (statuses[a.id]) a.status = statuses[a.id]; });
  const rank = { critico: 0, alto: 1, atencao: 2, oportunidade: 3, informativo: 4 };
  out.sort((a, b) => (a.status === "resolvido") - (b.status === "resolvido") || rank[a.severity] - rank[b.severity] || b.priority - a.priority);
  return out;
}
