/* Assistente sobre os dados reais do cliente (roda na API). Determinístico: classifica a intenção,
 * consulta o motor certo (finanças, patrimônio, imposto, radar, simulação) e escreve a resposta
 * só com números calculados — cada número vem com a evidência e a fonte. Não recomenda compra ou venda. */
import { simulateSale } from "./sim_engine.js";
import { tradeAnalytics } from "./trader_engine.js";
import { eventsView } from "./event_engine.js";

export const PATTERNS = {"injection": ["ignore (as |todas as |suas )?(instru|regras)", "ignore (all|previous|the above)", "system prompt", "prompt do sistema", "modo desenvolvedor", "developer mode", "jailbreak", "aja como (um )?consultor", "finja (que|ser)", "sem (as )?restri", "desative (o|os) (guardrail|filtro)", "revele (suas|as) instru"], "credential": ["\\bsenha\\b.*\\b(banco|conta|corretora)", "\\btoken\\b.*\\b(banco|seguranca)", "\\bminha senha\\b"], "advice": ["\\b(devo|deveria|vale a pena|compensa) (comprar|vender|investir|aplicar|resgatar|sair|entrar)", "\\b(qual|quais|que) (acao|acoes|ativo|ativos|fundo|fundos|fii|fiis|etf|cripto|investimento)s? (devo|deveria|comprar|vender|recomenda|indica|e melhor|sao melhores)", "\\b(recomend|indic|sugir|sugest)\\w* .*(acao|acoes|ativo|fundo|fii|carteira|investimento|compra|venda)", "\\bmonte (uma|minha) carteira", "\\bcarteira recomendada", "\\bonde (devo )?investir", "\\b(compro|vendo) (agora|hoje|ou)", "\\bmelhor (acao|investimento|fundo|ativo)", "\\bpreco[- ]alvo", "\\bvai (subir|cair|valorizar)", "\\bhora (certa|de) (comprar|vender)"], "intents": {"tributaria": ["impost", "\\bir\\b", "irpf", "darf", "tribut", "isen", "prejuiz", "aliquota", "day ?trade", "ganho de capital", "imposto de renda", "receita federal", "pgbl", "vgbl", "dedu"], "simulacao": ["simul", "cenario", "e se ", "what if", "comparar cenario", "compare"], "alertas": ["alerta", "atencao", "pendenc", "radar", "o que (merece|preciso)", "prioridade"], "patrimonio": ["patrimon", "carteira", "aloca", "posic", "concentra", "liquidez", "quanto (eu )?tenho", "onde esta", "investimento"], "financeira": ["gasto", "despes", "receita", "fluxo", "categoria", "orcamento", "saldo", "conta", "cartao", "recorren", "mudou", "economi"], "documento": ["document", "informe", "nota de corretagem", "comprovante", "upload", "arquivo"], "trader": ["\\btrade", "trader", "operac", "taxa de acerto", "win rate", "payoff", "drawdown", "backtest", "estrategia", "resultado das (minhas )?operac"], "eventos": ["evento", "divulga", "fato relevante", "comunicado", "noticia", "agenda", "prazo", "vencimento", "aconteceu", "daily", "resumo do dia"]}};
const DISCLAIMER = "Informação educativa calculada sobre os seus dados; não é recomendação de investimento nem substitui seu contador.";
const norm = s => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
const brl = v => "R$ " + (+v || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const pct = (v, d = 1) => ((+v || 0) * 100).toFixed(d).replace(".", ",") + "%";
const dbr = iso => String(iso || "").slice(0, 10).split("-").reverse().join("/");
const mesBr = mk => { const [y, m] = String(mk).split("-"); return ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"][+m - 1] + "/" + y; };
const ev = (label, value, display, source) => ({ label, value: String(value), display, source });

export function classify(q) {
  const t = norm(q), any = list => list.some(p => new RegExp(p).test(t));
  if (any(PATTERNS.injection)) return "bloqueado";
  if (any(PATTERNS.credential)) return "credencial";
  if (any(PATTERNS.advice)) return "investimento_individual";
  if (/document|comprovante|recibo|informe de rend/.test(t)) return "documento";
  if (/vend\w*\s+(de\s+)?\d/.test(t) && /[a-z]{4}\d{1,2}/.test(t)) return "simulacao";
  let best = "geral", score = 0;
  for (const k of ["simulacao", "tributaria", "alertas", "patrimonio", "financeira", "documento", "trader", "eventos"]) {
    const n = PATTERNS.intents[k].filter(p => new RegExp(p).test(t)).length;
    if (n > score) { best = k; score = n; }
  }
  return best;
}

/* "vender 300 PETR4 a 35,50 em 20/10" */
export function parseSaleQuestion(q, refDate) {
  const t = String(q || "");
  const m = t.match(/vend\w*\s+(?:de\s+)?(\d[\d.]*)\s*(?:a[cç](?:[oõ]es|ao)|cotas|unidades)?\s*(?:d[aeo]s?\s+)?([A-Za-z]{4}\d{1,2})/i);
  if (!m) return null;
  const rest = t.slice(m.index + m[0].length);
  const price = (rest.match(/(?:\ba|\bpor|\bpre[cç]o(?: de)?)\s+R?\$?\s*(\d+(?:[.,]\d{1,2})?)(?!\/)/i) || [])[1];
  const dm = rest.match(/(\d{2})\/(\d{2})(?:\/(\d{4}))?/);
  const date = dm ? `${dm[3] || refDate.slice(0, 4)}-${dm[2]}-${dm[1]}` : refDate;
  return { ticker: m[2].toUpperCase(), quantity: +m[1].replace(/\./g, ""), price: price ? +price.replace(",", ".") : undefined, date };
}

export function answer(question, ctx) {
  const { fin, port, tax, alerts = [], name = "", trades = [], positions = [], taxOpts = {}, refDate, documents = [], checklist = null, holdings = [], watchlists = [] } = ctx;
  const intent = classify(question);
  const out = { intent, guardrail: null, evidence: [], tool_calls: [], suggestions: [], confidence: 1, consistency_ok: true };
  const tool = (t, ms = 0) => out.tool_calls.push({ tool: t, status: "ok", latency_ms: ms });
  const noData = !(fin?.has_data || port?.has_data || tax?.has_data);
  const say = s => { out.answer = s; return out; };

  if (intent === "bloqueado") { out.guardrail = "injecao"; out.suggestions = ["Quanto eu tenho de patrimônio?", "Quais alertas existem?"];
    return say("Não posso alterar minhas regras de funcionamento. Posso explicar seus números de patrimônio, finanças, impostos e alertas."); }
  if (intent === "credencial") { out.guardrail = "credencial"; out.suggestions = ["Como conectar meu banco?"];
    return say("Nunca informe senhas ou tokens de banco aqui. A conexão com instituições acontece pelo Open Finance, com autenticação feita no ambiente da própria instituição. Veja em Conexões."); }
  if (intent === "investimento_individual") { out.guardrail = "recomendacao"; out.suggestions = ["Simular venda de 100 PETR4", "Como está minha concentração?", "Quanto imposto pago se vender?"];
    return say("Não faço recomendação de compra ou venda de ativos (é atividade regulada pela CVM). Posso mostrar as consequências de um cenário: escreva, por exemplo, \"simular venda de 100 PETR4\" e eu calculo o imposto e a liquidez."); }

  if (intent === "simulacao") {
    tool("simulation");
    const op = parseSaleQuestion(question, refDate);
    if (!op) { out.suggestions = positions.filter(p => p.ticker).slice(0, 3).map(p => `Simular venda de ${Math.max(1, Math.floor(+p.quantity / 2))} ${p.ticker}`);
      return say("Diga o ativo e a quantidade, por exemplo: \"simular venda de 100 PETR4\" (opcional: \"a 35,50\" e a data). Também dá para usar a tela Simulador."); }
    try {
      const r = simulateSale({ trades, positions, ops: [op], opts: { ...taxOpts, refDate } });
      const alt = r.results[1], m = alt.months[0];
      out.evidence = [ev("Imposto do ano hoje", r.results[0].tax_year, brl(r.results[0].tax_year), "Tax Engine"), ev("Imposto do ano com a venda", alt.tax_year, brl(alt.tax_year), "Tax Engine"),
        ev("Diferença", alt.tax_difference_vs_base, brl(alt.tax_difference_vs_base), "Simulation Engine"), ev("Liquidez gerada", alt.liquidity_generated, brl(alt.liquidity_generated), "Simulation Engine")];
      out.confidence = alt.confidence; out.suggestions = ["Quais DARFs estão em aberto?", "Quanto eu tenho de patrimônio?"];
      return say(`${alt.name}: gera ${brl(alt.liquidity_generated)} e ${+alt.tax_difference_vs_base > 0 ? `aumenta o imposto do ano em ${brl(alt.tax_difference_vs_base)}` : "não aumenta o imposto do ano"}${m ? ` (em ${mesBr(m.month)}: vendas de ações ${brl(m.sales_acoes)}, ${m.exempt ? "dentro" : "acima"} do limite de isenção${m.darf ? `; DARF de ${brl(m.darf.valor)} até ${dbr(m.darf.vencimento)}` : ""})` : ""}. Líquido após o imposto adicional: ${brl(alt.net_liquidity_after_tax)}.${alt.confidence < 1 ? ` Confiança ${pct(alt.confidence, 0)}: há compras sem histórico.` : ""}`);
    } catch (e) { return say(e.message || "Não consegui simular esse cenário."); }
  }

  if (noData && intent !== "documento") {
    out.suggestions = ["Como importar meus dados?"];
    return say(`${name ? name.split(" ")[0] + ", ainda" : "Ainda"} não há dados seus para eu analisar. Envie seus extratos (OFX/CSV) e os relatórios da B3 em Importar dados, ou conecte seu banco em Conexões — aí eu respondo com os seus números.`);
  }

  if (intent === "tributaria") {
    tool("tax");
    if (!tax.has_data) { out.suggestions = ["Quanto eu tenho de patrimônio?"]; return say("Ainda não há negociações importadas para apurar o imposto de renda variável. Envie o relatório de Negociação da B3 (desde a primeira compra) em Importar dados."); }
    const open = tax.months.map(m => m.darf).filter(d => d && d.status !== "pago");
    const cur = tax.months.find(m => m.month === refDate.slice(0, 7));
    const losses = Object.entries(tax.losses_available).filter(([, v]) => +v > 0);
    out.evidence = [ev("Imposto estimado no ano", tax.total_tax_due, brl(tax.total_tax_due), "Tax Engine"), ev("Ganhos isentos no ano", tax.total_exempt_gain, brl(tax.total_exempt_gain), "Tax Engine"),
      ev("IRRF no ano", tax.total_irrf, brl(tax.total_irrf), "Tax Engine"), ...open.map(d => ev(`DARF ${d.competencia}`, d.valor, `${brl(d.valor)} · ${d.status} · vence ${dbr(d.vencimento)}`, "Tax Engine")),
      ev("Confiança", tax.confidence, pct(tax.confidence, 0), "Tax Engine")];
    out.confidence = tax.confidence; out.suggestions = ["Quais alertas existem?", "Simular venda de ações", "Quanto vendi de ações este mês?"];
    const parts = [`Em ${tax.year}, o imposto estimado sobre renda variável soma ${brl(tax.total_tax_due)}, com ${brl(tax.total_exempt_gain)} de ganhos isentos e ${brl(tax.total_irrf)} de IRRF já retido.`];
    if (open.length) parts.push(`DARF${open.length > 1 ? "s" : ""} não pago${open.length > 1 ? "s" : ""}: ${open.map(d => `${mesBr(d.competencia)} ${brl(d.valor)} (${d.status === "vencido" ? "vencido em" : "vence"} ${dbr(d.vencimento)})`).join("; ")}.`);
    else parts.push("Nenhum DARF em aberto.");
    if (cur) parts.push(`Neste mês você vendeu ${brl(cur.sales_acoes)} em ações (${+cur.sales_acoes <= 20000 ? `restam ${brl(20000 - cur.sales_acoes)} até o limite de isenção` : "acima do limite de R$ 20.000,00"}).`);
    if (losses.length) parts.push(`Prejuízo a compensar: ${losses.map(([k, v]) => `${({ comum: "operações comuns", daytrade: "day trade", fii: "FII" })[k]} ${brl(v)}`).join(", ")}.`);
    if (tax.confidence < 1) parts.push(`Confiança ${pct(tax.confidence, 0)}: há vendas sem o histórico de compras.`);
    return say(parts.join(" "));
  }

  if (intent === "financeira") {
    tool("finance");
    if (!fin.has_data) { out.suggestions = ["Quanto eu tenho de patrimônio?"]; return say("Ainda não há extratos importados. Envie o extrato da conta ou do cartão (OFX ou CSV) em Importar dados."); }
    const top = fin.by_category.slice(0, 3);
    out.evidence = [ev("Receitas (6 meses)", fin.totals.income, brl(fin.totals.income), "Financial Engine"), ev("Despesas (6 meses)", fin.totals.expense, brl(fin.totals.expense), "Financial Engine"),
      ev("Taxa de poupança", fin.totals.savings_rate, pct(fin.totals.savings_rate), "Financial Engine"), ...top.map(c => ev(c.category, c.value, `${brl(c.value)} (${pct(c.share, 0)})`, "Financial Engine"))];
    out.suggestions = ["Quais assinaturas eu pago?", "Quais alertas existem?", "Quanto eu tenho de patrimônio?"];
    const t = norm(question);
    if (/assinatur|recorren/.test(t)) {
      const rec = fin.recurring || [];
      return say(rec.length ? `Encontrei ${rec.length} gasto(s) recorrente(s): ${rec.slice(0, 6).map(r => `${r.description} ${brl(r.monthly)}/mês`).join("; ")}. Total ≈ ${brl(rec.reduce((s, r) => s + +r.monthly, 0))} por mês.` : "Não encontrei gastos que se repetem em 3 meses ou mais com valor parecido.");
    }
    const ch = (fin.changes || []).slice(0, 3);
    return say(`De ${mesBr(fin.period.from)} a ${mesBr(fin.period.to)}: entradas de ${brl(fin.totals.income)} e saídas de ${brl(fin.totals.expense)} (taxa de poupança de ${pct(fin.totals.savings_rate)}). Maiores gastos: ${top.map(c => `${c.category} ${brl(c.value)}`).join(", ") || "—"}.${ch.length ? ` Mudanças no último mês: ${ch.map(c => `${c.category} ${c.delta_pct > 0 ? "+" : ""}${pct(c.delta_pct, 0)}`).join(", ")}.` : ""} O saldo em conta cobre cerca de ${(fin.liquidity.months_covered || 0).toFixed(1).replace(".", ",")} mês(es) de despesas.`);
  }

  if (intent === "patrimonio") {
    tool("portfolio");
    const cash = +fin.liquidity.cash || 0, total = (+port.total || 0) + cash;
    out.evidence = [ev("Investimentos", port.total, brl(port.total), "Portfolio Engine"), ev("Saldo em conta", cash, brl(cash), "Financial Engine"),
      ...port.allocation.slice(0, 4).map(a => ev(a.group, a.value, `${brl(a.value)} (${pct(a.weight, 0)})`, "Portfolio Engine"))];
    out.suggestions = ["Como está minha concentração?", "Por que meu imposto aumentou?", "Quais alertas existem?"];
    const mk = port.market;
    return say(`Seu patrimônio somado é ${brl(total)}: ${brl(port.total)} investidos e ${brl(cash)} em conta.${port.allocation.length ? ` Composição: ${port.allocation.map(a => `${a.group} ${pct(a.weight, 0)}`).join(", ")}.` : ""}${port.has_data ? ` Maior posição: ${port.concentration.largest_position} (${pct(port.concentration.largest_weight, 0)}). ${port.concentration.reading}.` : ""}${+port.invested > 0 ? ` Resultado sobre o custo conhecido: ${brl(port.result)} (${pct(port.result_pct)}).` : ""}${mk?.cdi_12m ? ` Referência: CDI de ${pct(mk.cdi_12m.value)} em 12 meses.` : ""}`);
  }

  if (intent === "alertas") {
    tool("alerts");
    const open = alerts.filter(a => a.status !== "resolvido");
    out.evidence = open.slice(0, 5).map(a => ev(a.title, a.severity, a.severity, "Alert Engine"));
    out.suggestions = ["Por que meu imposto aumentou?", "O que mudou nos meus gastos?"];
    return say(open.length ? `Há ${open.length} ponto(s) de atenção. Os principais: ${open.slice(0, 3).map(a => `${a.title} — ${a.detail}`).join(" | ")}` : "Nenhum alerta em aberto no momento.");
  }

  if (intent === "documento") {
    tool("documents");
    out.suggestions = ["Por que meu imposto aumentou?", "Quanto eu tenho de patrimônio?"];
    if (checklist && checklist.items.length) {
      const pend = checklist.items.filter(i => !i.done);
      out.evidence = checklist.items.map(i => ev(i.title, i.done ? "pronto" : "pendente", i.done ? "pronto" : "pendente", "Documentos"));
      return say(`Para a declaração de ${checklist.delivery_year} (ano-calendário ${checklist.year}) você tem ${checklist.done} de ${checklist.total} itens prontos.${pend.length ? ` Faltam: ${pend.slice(0, 6).map(i => i.title).join("; ")}.` : " Está tudo guardado."} Você guarda os arquivos na tela Documentos.`);
    }
    return say(documents.length ? `Você tem ${documents.length} documento(s) guardado(s): ${documents.slice(0, 5).map(d => d.title).join(", ")}. Notas de corretagem e extratos devem ser enviados em Importar dados para entrarem nos cálculos.`
      : "Nenhum documento guardado ainda. Em Documentos você guarda informes de rendimentos, notas de corretagem, recibos e comprovantes; extratos e relatórios da B3 vão em Importar dados para entrarem nos cálculos.");
  }

  if (intent === "trader") {
    tool("trade_analytics");
    const a = tradeAnalytics(trades, { tax });
    out.suggestions = ["Quanto imposto pago se vender?", "Quais eventos vêm por aí?", "Quais alertas existem?"];
    if (!a.totals.trades) return say(a.open.length ? `Você tem ${a.open.length} posição(ões) aberta(s) registrada(s) e nenhuma operação encerrada ainda. Em Trader Intelligence você acompanha resultado, custos e impacto tributário.` : "Ainda não há operações registradas. Importe notas de corretagem ou registre operações em Trader Intelligence.");
    out.evidence = [ev("Operações encerradas", a.totals.trades, String(a.totals.trades), "Trader Engine"), ev("Resultado líquido", a.totals.net_pnl, brl(a.totals.net_pnl), "Trader Engine"),
      ev("Custos", a.totals.costs, brl(a.totals.costs), "Trader Engine"), ev("Imposto estimado das operações", a.totals.tax_estimate, brl(a.totals.tax_estimate), "Trader Engine (estimativa)"),
      ev("Drawdown máximo", a.max_drawdown, brl(a.max_drawdown), "Trader Engine")];
    return say(`Nas ${a.totals.trades} operações encerradas: resultado bruto ${brl(a.totals.gross_pnl)}, custos ${brl(a.totals.costs)}, líquido ${brl(a.totals.net_pnl)}. Taxa de acerto ${Math.round(a.win_rate * 100)}%${a.payoff ? `, payoff ${a.payoff.toFixed(2).replace(".", ",")}` : ""}, drawdown máximo ${brl(a.max_drawdown)}. Impacto tributário estimado ${brl(a.totals.tax_estimate)} — o valor definitivo é o da Tributação. Isto descreve o passado; não é recomendação.`);
  }

  if (intent === "eventos") {
    tool("events");
    const e = eventsView({ tax, holdings, trades, watchlists, refDate });
    out.evidence = e.items.slice(0, 6).map(i => ev(i.title, i.date, i.date.split("-").reverse().join("/"), i.source));
    out.suggestions = ["Quanto imposto pago se vender?", "Quais alertas existem?", "Como está minha concentração?"];
    const tail = e.exposure.length ? ` Divulgações públicas (CVM) e notícias dos seus ${e.exposure.length} ativo(s) ficam em Trader Intelligence → Divulgações e em Notícias, com link para a fonte original.` : "";
    return say(e.items.length ? `Próximos eventos seus: ${e.items.slice(0, 4).map(i => `${i.date.split("-").reverse().join("/")} — ${i.title}`).join("; ")}.${tail}` : `Nenhum prazo pessoal (DARF ou vencimento de título) nos próximos dias.${tail}`);
  }

  // visão geral
  tool("finance"); tool("portfolio"); tool("tax"); tool("alerts");
  const cash = +fin.liquidity.cash || 0;
  out.evidence = [ev("Patrimônio", (+port.total || 0) + cash, brl((+port.total || 0) + cash), "Portfolio Engine"), ev("Imposto estimado no ano", tax.total_tax_due, brl(tax.total_tax_due), "Tax Engine"),
    ev("Alertas em aberto", alerts.filter(a => a.status !== "resolvido").length, String(alerts.filter(a => a.status !== "resolvido").length), "Alert Engine")];
  out.suggestions = ["Quanto eu tenho de patrimônio?", "Por que meu imposto aumentou?", "O que mudou nos meus gastos?", "Quais alertas existem?"];
  return say(`Resumo: patrimônio de ${brl((+port.total || 0) + cash)}, imposto estimado de ${brl(tax.total_tax_due)} em ${tax.year} e ${alerts.filter(a => a.status !== "resolvido").length} alerta(s) em aberto. Pergunte sobre impostos, gastos, patrimônio, alertas ou simule uma venda.`);
}
export { DISCLAIMER };
