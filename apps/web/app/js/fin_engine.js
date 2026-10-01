/* Motor de dados financeiros reais (roda no navegador e na API Cloudflare).
 * Recebe os registros normalizados que o cliente importou (extratos, B3, Tesouro, notas de corretagem)
 * e devolve os mesmos formatos que as telas já usam — finanças, patrimônio e painel inicial.
 * Funções puras: nada de rede, nada de DOM. */

const r2 = v => (Math.round((+v || 0) * 100) / 100).toFixed(2);
const norm = s => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
const month = d => String(d || "").slice(0, 7);
function addMonths(ym, n) { const [y, m] = ym.split("-").map(Number); const d = new Date(Date.UTC(y, m - 1 + n, 1)); return d.toISOString().slice(0, 7); }

/* ------------------------------------------------------------------ categorias */
const RULES = [
  ["Investimentos", /aplica|resgate|\bcdb\b|\blci\b|\blca\b|tesouro|corretora|invest|poupanca|previd|pgbl|vgbl|\bfii\b|b3 |btg pactual|xp inv|rico inv|clear corr|nuinvest|avenue/],
  ["Fatura do cartão", /pagamento de fatura|pagto fatura|pag fatura|fatura cart|pagamento cartao|pgto cartao/],
  ["Salário e renda", /salario|pro.?labore|folha|remuneracao|honorario|prolabore|vencimento|proventos|rendimento|dividend|juros s\/ capital|jcp/],
  ["Impostos", /\bdarf\b|\bdas\b|\bdae\b|iptu|ipva|imposto|receita federal|\bgps\b|inss|\birpf\b/],
  ["Moradia", /aluguel|condominio|imobiliaria|financiamento hab|prestacao casa/],
  ["Contas da casa", /energia|eletric|\bcpfl\b|\bcemig\b|enel|energisa|agua|saneamento|caerd|sabesp|\bgas\b|internet|vivo|claro|\btim\b|\boi\b|telefon/],
  ["Alimentação", /supermerc|mercado|atacad|assai|carrefour|pao de acucar|hortifruti|acougue|padaria/],
  ["Restaurantes", /restaurante|ifood|delivery|lanchonete|pizzaria|burger|mcdonald|bar |cafe|cafeteria|rappi/],
  ["Transporte", /posto|combust|gasolina|uber|99app|99 taxi|estaciona|pedagio|sem parar|onibus|metro|shell|ipiranga|petrobras br/],
  ["Saúde", /farmacia|drogaria|drogasil|raia|pacheco|hospital|clinica|laborat|medic|odonto|dentista|unimed|hapvida|amil|bradesco saude|psicolog/],
  ["Educação", /escola|faculdade|universidade|curso|colegio|mensalidade escolar|udemy|alura|livraria/],
  ["Assinaturas", /netflix|spotify|amazon prime|prime video|disney|hbo|max\.com|youtube|apple\.com|icloud|google one|globoplay|deezer|microsoft/],
  ["Viagens", /hotel|pousada|airbnb|booking|latam|gol linhas|azul linhas|passagem|decolar|123milhas/],
  ["Compras", /magazine|magalu|americanas|mercado livre|mercadolivre|shopee|amazon|shein|aliexpress|loja|renner|riachuelo|c&a/],
  ["Lazer", /cinema|ingresso|show|teatro|parque|academia|smart fit|bluefit/],
  ["Transferências", /\bpix\b|\bted\b|\bdoc\b|transf/],
  ["Tarifas bancárias", /tarifa|anuidade|iof|juros|encargo|mora/],
];
export function categorize(description, amount) {
  const d = norm(description);
  for (const [cat, re] of RULES) if (re.test(d)) {
    if (cat === "Salário e renda" && +amount < 0) continue;
    return cat;
  }
  return +amount > 0 ? "Outras entradas" : "Outros gastos";
}
/* movimentos que não são receita/despesa de consumo: aplicações, resgates e pagamento de fatura */
const NEUTRAL = new Set(["Investimentos", "Fatura do cartão"]);

/* ------------------------------------------------------------------ finanças */
export function financeSummary(txs, accounts = [], refDate = new Date().toISOString().slice(0, 10)) {
  const items = (txs || []).filter(t => t && t.date).map(t => ({ ...t, amount: +t.amount, category: t.category || categorize(t.description, t.amount) }));
  const lastMonth = items.length ? items.map(t => month(t.date)).sort().at(-1) : month(refDate);
  const months = Array.from({ length: 6 }, (_, i) => addMonths(lastMonth, i - 5));
  const series = months.map(m => {
    const mt = items.filter(t => month(t.date) === m && !NEUTRAL.has(t.category));
    const inc = mt.filter(t => t.amount > 0).reduce((s, t) => s + t.amount, 0);
    const exp = -mt.filter(t => t.amount < 0).reduce((s, t) => s + t.amount, 0);
    return { month: m, income: r2(inc), expense: r2(exp), net: r2(inc - exp) };
  });
  const inPeriod = items.filter(t => month(t.date) >= months[0] && month(t.date) <= months[5]);
  const income = series.reduce((s, x) => s + +x.income, 0), expense = series.reduce((s, x) => s + +x.expense, 0);
  const cat = {};
  inPeriod.filter(t => t.amount < 0 && !NEUTRAL.has(t.category)).forEach(t => { cat[t.category] = (cat[t.category] || 0) - t.amount; });
  const by_category = Object.entries(cat).sort((a, b) => b[1] - a[1]).map(([category, v]) => ({ category, value: r2(v), share: expense ? v / expense : 0 }));

  // recorrências: mesma descrição em 3+ meses distintos com valor parecido
  const groups = {};
  inPeriod.filter(t => t.amount < 0 && !NEUTRAL.has(t.category)).forEach(t => {
    const key = norm(t.description).replace(/\d+/g, "").replace(/\s+/g, " ").trim().slice(0, 40);
    (groups[key] = groups[key] || []).push(t);
  });
  const recurring = Object.values(groups).filter(g => new Set(g.map(t => month(t.date))).size >= 3).map(g => {
    const vals = g.map(t => -t.amount), avg = vals.reduce((a, b) => a + b, 0) / vals.length;
    return { description: g[0].description, category: g[0].category, monthly: r2(avg), dispersion: Math.max(...vals) / Math.max(Math.min(...vals), 0.01) };
  }).filter(x => x.dispersion < 1.6).sort((a, b) => b.monthly - a.monthly).slice(0, 8).map(({ dispersion, ...x }) => x);

  // mudanças: último mês vs média dos anteriores, por categoria
  const changes = [];
  const prevMonths = months.slice(0, 5).filter(m => series.find(s => s.month === m && (+s.expense > 0 || +s.income > 0)));
  if (prevMonths.length >= 2) {
    for (const c of Object.keys(cat)) {
      const v = m => -inPeriod.filter(t => t.category === c && month(t.date) === m && t.amount < 0).reduce((s, t) => s + t.amount, 0);
      const last = v(months[5]), base = prevMonths.reduce((s, m) => s + v(m), 0) / prevMonths.length;
      if (base > 50 && Math.abs(last - base) / base >= 0.3 && Math.abs(last - base) >= 100)
        changes.push({ category: c, last: r2(last), baseline: r2(base), delta_pct: (last - base) / base });
    }
    changes.sort((a, b) => Math.abs(b.delta_pct) - Math.abs(a.delta_pct)).splice(5);
  }
  const accs = (accounts || []).filter(a => a.type !== "cartao");
  const cash = accs.reduce((s, a) => s + (+a.balance || 0), 0);
  const avgExp = expense / Math.max(series.filter(s => +s.expense > 0).length, 1);
  return {
    has_data: items.length > 0, period: { from: months[0], to: months[5] },
    totals: { income: r2(income), expense: r2(expense), net: r2(income - expense), savings_rate: income ? (income - expense) / income : 0 },
    series, by_category, recurring, changes,
    liquidity: { cash: r2(cash), avg_monthly_expense: r2(avgExp), months_covered: avgExp ? cash / avgExp : 0 },
    accounts: (accounts || []).map(a => ({ id: a.id, name: a.name, institution: a.institution, type: a.type, balance: r2(a.balance), balance_date: a.balance_date })),
    reading: items.length
      ? `Calculado a partir de ${items.length} transações importadas por você. Aplicações, resgates e pagamento de fatura não entram como receita ou despesa`
      : "Nenhum extrato importado ainda",
  };
}
export function transactionsList(txs, limit = 60) {
  const items = (txs || []).map(t => ({ id: t.id, date: t.date, description: t.description, amount: r2(t.amount),
    category: t.category || categorize(t.description, t.amount), source: t.source })).sort((a, b) => b.date.localeCompare(a.date));
  return { total: items.length, limit, offset: 0, items: items.slice(0, limit) };
}

/* ------------------------------------------------------------------ carteira */
export const CLASS_GROUP = { acao: "Renda Variável", fii: "Renda Variável", etf: "Renda Variável", bdr: "Renda Variável",
  tesouro: "Renda Fixa", renda_fixa: "Renda Fixa", fundo: "Fundos", previdencia: "Previdência", cripto: "Outros", outro: "Outros" };
const LIQ = { acao: 2, fii: 2, etf: 2, bdr: 2, tesouro: 1, renda_fixa: 1, fundo: 30, previdencia: 30, outro: 30, cripto: 1 };

/* custo médio por ativo a partir das negociações (compras somam, vendas baixam proporcionalmente) */
export function averageCost(trades) {
  const pos = {};
  [...(trades || [])].sort((a, b) => a.date.localeCompare(b.date)).forEach(t => {
    const k = String(t.ticker || "").toUpperCase().replace(/F$/, "");
    const p = pos[k] || (pos[k] = { qty: 0, cost: 0 });
    const q = +t.quantity, v = +t.value || q * +t.price;
    if (t.side === "C") { p.qty += q; p.cost += v + (+t.fees || 0); }
    else if (t.side === "V" && p.qty > 0) { const f = Math.min(q, p.qty) / p.qty; p.cost -= p.cost * f; p.qty -= Math.min(q, p.qty); }
  });
  return pos;
}

export function portfolioSummary(holdings, trades = []) {
  const avg = averageCost(trades);
  const pos = (holdings || []).map(h => {
    let invested = h.invested == null || h.invested === "" ? null : +h.invested;
    const tk = String(h.ticker || "").toUpperCase();
    if (invested == null && tk && avg[tk] && avg[tk].qty > 0) invested = avg[tk].cost / avg[tk].qty * +h.quantity;
    const value = +h.value || 0;
    return { asset_id: h.id, name: h.name || tk, ticker: tk || null, asset_class: h.asset_class || "outro", group: CLASS_GROUP[h.asset_class] || "Outros",
      custodian: h.custodian || "—", quantity: String(h.quantity ?? "1"), value: r2(value), invested: invested == null ? null : r2(invested),
      result: invested == null ? null : r2(value - invested), liquidity_days: h.liquidity_days ?? LIQ[h.asset_class] ?? 30,
      price_source: h.source || "importação", as_of: h.as_of || null, maturity: h.maturity || null, indexer: h.indexer || null };
  }).filter(p => +p.value > 0);
  const total = pos.reduce((s, p) => s + +p.value, 0);
  pos.forEach(p => { p.weight = total ? +p.value / total : 0; });
  pos.sort((a, b) => b.weight - a.weight);
  const known = pos.filter(p => p.invested != null);
  const invested = known.reduce((s, p) => s + +p.invested, 0), knownValue = known.reduce((s, p) => s + +p.value, 0);
  const groups = {};
  pos.forEach(p => { groups[p.group] = (groups[p.group] || 0) + +p.value; });
  const allocation = Object.entries(groups).sort((a, b) => b[1] - a[1]).map(([group, v]) => ({ group, value: r2(v), weight: total ? v / total : 0 }));
  const cust = {};
  pos.forEach(p => { cust[p.custodian] = (cust[p.custodian] || 0) + +p.value; });
  const hhi = pos.reduce((s, p) => s + p.weight ** 2, 0);
  const d2 = pos.filter(p => p.liquidity_days <= 2).reduce((s, p) => s + +p.value, 0);
  return {
    has_data: pos.length > 0, total: r2(total), invested: r2(invested), result: r2(knownValue - invested),
    result_pct: invested ? (knownValue - invested) / invested : 0,
    result_coverage: total ? knownValue / total : 0,
    positions: pos, allocation,
    by_custodian: Object.entries(cust).sort((a, b) => b[1] - a[1]).map(([custodian, value]) => ({ custodian, value: r2(value) })),
    concentration: { largest_position: pos[0]?.name || "—", largest_weight: pos[0]?.weight || 0, hhi: Math.round(hhi * 1000) / 1000,
      reading: !pos.length ? "Sem posições importadas" : hhi > 0.25 ? "Carteira concentrada: poucos ativos respondem pela maior parte do patrimônio"
        : hhi > 0.15 ? "Concentração moderada" : "Carteira diversificada entre os ativos importados" },
    liquidity: { d2_or_less: r2(d2), share: total ? d2 / total : 0 },
  };
}

/* ------------------------------------------------------------------ painel inicial */
export function dashboardSummary({ name, fin, port, refDate = new Date().toISOString().slice(0, 10) }) {
  const cash = +fin.liquidity.cash || 0, total = (+port.total || 0) + cash;
  // evolução estimada: patrimônio atual menos o fluxo líquido acumulado dos meses seguintes
  let acc = total; const series = [];
  for (let i = fin.series.length - 1; i >= 0; i--) { series.unshift({ month: fin.series[i].month, value: r2(acc) }); acc -= +fin.series[i].net; }
  const first = +series[0]?.value || 0;
  const actions = [];
  if (!port.has_data) actions.push({ title: "Importe sua posição da B3", detail: "Baixe o relatório de posição na Área do Investidor da B3 e envie em Importar dados.", severity: "medio", action: { route: "/importar", label: "Importar" } });
  if (!fin.has_data) actions.push({ title: "Importe seus extratos", detail: "Envie o extrato da conta em OFX ou CSV para ver entradas, saídas e recorrências.", severity: "medio", action: { route: "/importar", label: "Importar" } });
  if (fin.has_data && fin.liquidity.months_covered < 3 && +fin.liquidity.avg_monthly_expense > 0)
    actions.push({ title: "Reserva de emergência curta", detail: `O saldo em conta cobre ~${fin.liquidity.months_covered.toFixed(1).replace(".", ",")} mês(es) de despesas.`, severity: "alto", action: { route: "/financas", label: "Ver finanças" } });
  if (port.has_data && port.concentration.largest_weight > 0.3)
    actions.push({ title: "Concentração elevada", detail: `${port.concentration.largest_position} representa ${(port.concentration.largest_weight * 100).toFixed(0)}% do patrimônio investido.`, severity: "medio", action: { route: "/patrimonio", label: "Ver patrimônio" } });
  const alloc = [...port.allocation];
  if (cash > 0) alloc.push({ group: "Saldo em conta", value: r2(cash), weight: 0 });
  alloc.forEach(a => { a.weight = total ? +a.value / total : 0; });
  return {
    has_data: fin.has_data || port.has_data, greeting: String(name || "").split(" ")[0] || "Olá", reference_date: refDate,
    net_worth: { total: r2(total), variation_pct: first ? (total - first) / first : 0, series, series_kind: "estimada a partir do saldo atual e do fluxo líquido importado" },
    tax: { year: +refDate.slice(0, 4), estimated: "0.00", irrf: "0.00", exempt: "0.00", monthly: [], confidence: 0, kind: "estimativa", scope: "aguardando negociações para apurar" },
    alerts: { open: actions.filter(a => a.severity === "alto").length, critical: actions.filter(a => a.severity === "alto").length },
    allocation: alloc.sort((a, b) => b.weight - a.weight), next_actions: actions.slice(0, 4), changes: fin.changes || [],
    liquidity: { cash: r2(cash), months_covered: fin.liquidity.months_covered, avg_monthly_expense: fin.liquidity.avg_monthly_expense },
  };
}
