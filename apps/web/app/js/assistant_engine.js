/* Assistente sobre os dados reais do cliente (roda na API). Determinístico: classifica a intenção,
 * consulta o motor certo (finanças, patrimônio, imposto, radar, simulação) e escreve a resposta
 * só com números calculados — cada número vem com a evidência e a fonte. Não recomenda compra ou venda. */
import { simulateSale } from "./sim_engine.js";
import { tradeAnalytics } from "./trader_engine.js";
import { eventsView } from "./event_engine.js";
import { retrieve, citation, KB_VERSION, ruleText } from "./knowledge.js";
import { RECEITAS_DARF, DARE_UF, acrescimos, diaUtil, proximoDiaUtil, SICALC_URL, VALOR_MINIMO_DARF } from "./guia_engine.js";

export const PATTERNS = {"injection": ["ignore (as |todas as |suas )?(instru|regras)", "ignore (all|previous|the above)", "system prompt", "prompt do sistema", "modo desenvolvedor", "developer mode", "jailbreak", "aja como (um )?consultor", "finja (que|ser)", "sem (as )?restri", "desative (o|os) (guardrail|filtro)", "revele (suas|as) instru"], "credential": ["\\bsenha\\b.*\\b(banco|conta|corretora)", "\\btoken\\b.*\\b(banco|seguranca)", "\\bminha senha\\b"], "advice": ["\\b(devo|deveria|vale a pena|compensa) (comprar|vender|investir|aplicar|resgatar|sair|entrar)", "\\b(qual|quais|que) (acao|acoes|ativo|ativos|fundo|fundos|fii|fiis|etf|cripto|investimento)s? (devo|deveria|comprar|vender|recomenda|indica|e melhor|sao melhores)", "\\b(recomend|indic|sugir|sugest)\\w* .*(acao|acoes|ativo|fundo|fii|carteira|investimento|compra|venda)", "\\bmonte (uma|minha) carteira", "\\bcarteira recomendada", "\\bonde (devo )?investir", "\\b(compro|vendo) (agora|hoje|ou)", "\\bmelhor (acao|investimento|fundo|ativo)", "\\bpreco[- ]alvo", "\\bvai (subir|cair|valorizar)", "\\bhora (certa|de) (comprar|vender)"], "intents": {"tributaria": ["impost", "\\bir\\b", "irpf", "darf", "tribut", "isen", "prejuiz", "aliquota", "day ?trade", "ganho de capital", "imposto de renda", "receita federal", "pgbl", "vgbl", "dedu"], "simulacao": ["simul", "cenario", "e se ", "what if", "comparar cenario", "compare"], "alertas": ["alerta", "atencao", "pendenc", "radar", "o que (merece|preciso)", "prioridade"], "patrimonio": ["patrimon", "carteira", "aloca", "posic", "concentra", "liquidez", "quanto (eu )?tenho", "onde esta", "investimento"], "financeira": ["gasto", "despes", "receita", "fluxo", "categoria", "orcamento", "saldo", "conta", "cartao", "recorren", "mudou", "economi"], "documento": ["document", "informe", "nota de corretagem", "comprovante", "upload", "arquivo"], "trader": ["\\btrade", "trader", "operac", "taxa de acerto", "win rate", "payoff", "drawdown", "backtest", "estrategia", "resultado das (minhas )?operac"], "eventos": ["evento", "divulga", "fato relevante", "comunicado", "noticia", "agenda", "prazo", "vencimento", "aconteceu", "daily", "resumo do dia"]}};
const DISCLAIMER = "Informação educativa calculada sobre os seus dados; não é recomendação de investimento nem substitui seu contador.";
const norm = s => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
const brl = v => "R$ " + (+v || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const pct = (v, d = 1) => ((+v || 0) * 100).toFixed(d).replace(".", ",") + "%";
const dbr = iso => String(iso || "").slice(0, 10).split("-").reverse().join("/");
const mesBr = mk => { const [y, m] = String(mk).split("-"); return ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"][+m - 1] + "/" + y; };
const ev = (label, value, display, source) => ({ label, value: String(value), display, source });

const CONCEPT = /^(o que (e|sao|significa)|oque|como (funciona|e calculad|o aurion|voces|calcula)|qual (e |eh )?a regra|quais (sao )?as regras|explique|explica|me explica|por que o aurion|o aurion (faz|executa|recomenda|guarda|le)|existe (isencao|limite)|tem (isencao|limite)|qual a aliquota|quais as aliquotas|onde (esta|fica) a fonte)/;
const GUIA = /(codigo|cod\.?) (do |da |de )?(darf|dare|receita)|\b(gerar|emitir|imprimir|tirar|fazer) (o |a |um |uma |meu |minha )?(darf|dare|guia)|\bdare\b|darf (atrasad|em atraso|vencid|em aberto)|pag\w* (o |um )?darf|(multa|juros)\b.*\bdarf|darf\b.*(multa|juros)|guia de (pagamento|recolhimento)/;
/* palavras → código de receita do DARF (tabela do guia_engine) */
const CODIGO_POR_TEMA = [[/carne[- ]?leao|aluguel recebido|exterior/, "0190"], [/moeda estrangeira|dolar/, "8523"], [/ganho de capital|venda de (imovel|carro|bem)|gcap/, "4600"],
  [/quota|declaracao|ajuste anual|restituic/, "0211"], [/csll/, "2372"], [/lucro presumido|irpj/, "2089"], [/\bpis\b/, "8109"], [/cofins/, "2172"], [/assalariad|salario|folha/, "0561"],
  [/csrf|retencao (de )?(pis|cofins|csll)/, "5952"], [/aluguel|royalt/, "3208"], [/servico/, "1708"], [/bolsa|acoes|acao|renda variavel|day ?trade|fii|swing/, "6015"]];
const VENC_TXT = { ultimo_util_mes_seguinte: "último dia útil do mês seguinte ao período", dia_20_mes_seguinte_antecipa: "dia 20 do mês seguinte (antecipa se não for dia útil)",
  dia_25_mes_seguinte_antecipa: "dia 25 do mês seguinte (antecipa se não for dia útil)", informado: "prazo da declaração do ano (quota única ou 1ª quota)" };
const LEI_9430 = "https://www.planalto.gov.br/ccivil_03/leis/l9430.htm";
export function classify(q) {
  const t = norm(q), any = list => list.some(p => new RegExp(p).test(t));
  if (any(PATTERNS.injection)) return "bloqueado";
  if (any(PATTERNS.credential)) return "credencial";
  if (any(PATTERNS.advice)) return "investimento_individual";
  if (/dividend|\bjcp\b|juros sobre capital|provento|rendimentos? (de|do|dos) fii/.test(t) && !CONCEPT.test(t)) return "proventos";
  if (GUIA.test(t)) return "guia";
  if (CONCEPT.test(t)) return "conhecimento";
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
  const { fin, port, tax, alerts = [], name = "", trades = [], positions = [], taxOpts = {}, refDate, documents = [], checklist = null, holdings = [], watchlists = [], incomes = [] } = ctx;
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

  if (intent === "guia") {
    const t = norm(question);
    out.actions = [{ label: "Abrir guias DARF/DARE", route: "/tributacao?tab=guias" }];
    out.knowledge = { kb_version: KB_VERSION, citations: [{ document: "Lei 9.430/1996, arts. 61 (multa e juros de mora) e 68 (valor mínimo do DARF)", source_id: "lei-9430-1996", version: "consolidada", effective_at: null, collection: "fontes_publicas", links: [LEI_9430] },
      { document: "Sicalc — Receita Federal", source_id: "sicalc", version: "web", effective_at: null, collection: "fontes_publicas", links: [SICALC_URL] }] };
    // DARE estadual
    if (/\bdare\b|ipva|itcd|itcmd|icms|estadual|sefaz|sefin/.test(t)) {
      const ro = DARE_UF.RO, hit = ro.receitas.filter(r => (/ipva/.test(t) && /IPVA/.test(r.descricao)) || (/itcd|itcmd|heranca|doacao/.test(t) && /ITCD/.test(r.descricao)) || (/icms/.test(t) && /ICMS/.test(r.descricao)));
      out.evidence = (hit.length ? hit : ro.receitas.slice(0, 4)).map(r => ev(`DARE RO ${r.codigo}`, r.codigo, r.descricao, ro.fonte));
      out.knowledge.citations = [{ document: ro.fonte, source_id: "sefin-ro-dare", version: "tabela de códigos", effective_at: null, collection: "fontes_publicas", links: [ro.portal] }];
      out.suggestions = ["Como pagar DARF atrasado?", "Qual o código do DARF do carnê-leão?"];
      return say(`O DARE é a guia dos tributos estaduais (IPVA, ITCD, ICMS e taxas). Em Tributação → Guias, escolha "DARE · estadual": o AURION confere o CPF ou CNPJ, a inscrição estadual quando o tributo exige e o código de receita${hit.length ? ` — em Rondônia, ${hit.map(r => `${r.codigo} (${r.descricao})`).join(", ")}` : " (a tabela de Rondônia já está cadastrada; nos outros estados você informa o código)"}. O código de barras é gerado pela Secretaria de Fazenda do estado, no portal dela; multa e juros estaduais também são calculados lá.`);
    }
    const parts = [];
    // código por assunto
    const tema = CODIGO_POR_TEMA.find(([re]) => re.test(t));
    if (tema && /codigo|qual|que darf|cod\b/.test(t)) {
      const r = RECEITAS_DARF.find(x => x.codigo === tema[1]);
      out.evidence.push(ev(`Código ${r.codigo}`, r.codigo, `${r.descricao} · vencimento: ${VENC_TXT[r.venc]}`, "Tabela de receitas do AURION (guias@1.0.0)"));
      parts.push(`O código é ${r.codigo} — ${r.descricao}. Vence no ${VENC_TXT[r.venc]}${r.quem === "PF" ? " e é pago com o CPF" : r.quem === "PJ" ? " e é pago com o CNPJ" : ""}.${r.nota ? " " + r.nota : ""}`);
    }
    // DARFs em aberto do próprio cliente, com multa e juros para pagamento hoje
    const open = tax?.has_data ? tax.months.map(m => m.darf).filter(d => d && d.status !== "pago") : [];
    if (open.length) {
      tool("tax"); tool("guias");
      const pag = proximoDiaUtil(refDate), selic = (ctx.selic || []).filter(x => String(x.date).slice(0, 7) < refDate.slice(0, 7));
      for (const d of open) {
        const a = acrescimos({ principal: +d.valor, vencimento: d.vencimento, pagamento: pag, selic });
        out.evidence.push(ev(`DARF 6015 ${mesBr(d.competencia)}`, a.total, a.atraso_dias ? `${brl(d.valor)} + multa ${brl(a.multa)} + juros ${brl(a.juros)} = ${brl(a.total)} pagando em ${dbr(pag)}` : `${brl(d.valor)} · vence ${dbr(d.vencimento)}`, "Tax Engine + motor de guias"));
        parts.push(a.atraso_dias
          ? `O DARF 6015 de ${mesBr(d.competencia)} venceu em ${dbr(d.vencimento)}: pagando em ${dbr(pag)}, são ${brl(d.valor)} de principal, ${brl(a.multa)} de multa (${String(a.multa_pct).replace(".", ",")}%) e ${brl(a.juros)} de juros (${String(a.juros_pct).replace(".", ",")}%), total ${brl(a.total)}.${a.selic_faltando.length ? " A Selic de algum mês ainda não foi publicada; confira no Sicalc." : ""}`
          : `O DARF 6015 de ${mesBr(d.competencia)} é de ${brl(d.valor)} e vence em ${dbr(d.vencimento)}.`);
      }
      out.actions = open.map(d => ({ label: `Gerar DARF de ${mesBr(d.competencia)}`, route: `/tributacao?tab=guias&competencia=${d.competencia}` }));
      out.confidence = tax.confidence;
    } else if (!parts.length && tax?.has_data) parts.push("Você não tem DARF de renda variável em aberto.");
    parts.push(`Para gerar a guia: Tributação → Guias. O AURION confere o código, o CPF ou CNPJ e o vencimento, e calcula multa de 0,33% ao dia (até 20%) e juros pela Selic mais 1% no mês do pagamento. Abaixo de R$ ${VALOR_MINIMO_DARF},00 não se emite DARF: o valor soma ao período seguinte. A guia sai pronta para "DARF sem código de barras" no internet banking; com código de barras, gere no Sicalc com os mesmos dados.`);
    out.suggestions = ["Qual o código do DARF do carnê-leão?", "Como emitir DARE de IPVA?", "Quanto vou pagar de imposto?"];
    return say(parts.join(" "));
  }

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

  if (noData && intent !== "documento" && intent !== "conhecimento" && intent !== "guia") {
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

  if (intent === "proventos") {
    tool("incomes");
    const y = +String(refDate || new Date().toISOString()).slice(0, 4), ys = [y, y - 1];
    out.suggestions = ["Quanto vou pagar de imposto?", "Como funciona a isenção de 20 mil?", "Quais eventos vêm por aí?"];
    if (!incomes.length) return say("Ainda não há proventos importados. Envie a planilha de Movimentação da Área do Investidor da B3 em Importar dados: dividendos, juros sobre capital próprio e rendimentos de FII entram automaticamente.");
    const lab = { dividendo: "dividendos", jcp: "JCP (líquido)", rendimento: "rendimentos de FII" };
    const parts = ys.map(yy => { const l = incomes.filter(i => String(i.date).startsWith(String(yy))); if (!l.length) return null;
      const by = k => l.filter(i => i.kind === k).reduce((s2, i) => s2 + +i.value, 0);
      return `${yy}: ${["dividendo", "jcp", "rendimento"].filter(k => by(k) > 0).map(k => `${lab[k]} ${brl(by(k))}`).join(", ")}`; }).filter(Boolean);
    out.evidence = incomes.slice().sort((a, b) => b.date.localeCompare(a.date)).slice(0, 6).map(i => ev(`${lab[i.kind]} ${i.ticker}`, i.value, `${brl(i.value)} em ${dbr(i.date)}`, "Movimentação B3"));
    return say(`Proventos creditados — ${parts.join(" · ") || "nada nos últimos dois anos"}. Valores líquidos como aparecem na B3; para a declaração, use o relatório em Tributação e confira com o informe de rendimentos.`);
  }

  if (intent === "conhecimento" || intent === "geral") {
    const hits = retrieve(question);
    if (hits.length) {
      tool("knowledge_base");
      const h = hits[0];
      out.knowledge = { kb_version: KB_VERSION, citations: hits.map(citation) };
      out.evidence = hits.map(x => ev(x.title, x.meta.version, `${x.collection === "regras" ? "regra" : x.collection === "produto" ? "AURION" : "fonte oficial"} · versão ${x.meta.version}`, x.meta.source_id));
      out.suggestions = ["Quanto vou pagar de imposto?", "Simular venda de 100 PETR4", "Quais alertas existem?"];
      out.confidence = h.collection === "regras" ? 0.9 : 0.8;
      const src = h.collection === "regras" ? ` Fonte: regra ${h.meta.source_id} versão ${h.meta.version}, vigente desde ${dbr(h.meta.effective_at)}${h.meta.sources.length ? ` (${h.meta.sources.map(x => x.title).join("; ")})` : ""}.`
        : h.collection === "fontes_publicas" ? ` Fonte oficial: ${h.title}${h.meta.sources[0]?.url ? ` — ${h.meta.sources[0].url}` : ""}. O conteúdo é da fonte; o AURION não o altera.` : ` Fonte: documentação do AURION (${KB_VERSION}).`;
      return say(`${h.collection === "regras" ? ruleText(h.meta.source_id, h.meta.version) : h.text}${src}`);
    }
    if (intent === "conhecimento") { out.suggestions = ["Como o AURION calcula o imposto?", "Qual a regra de day trade?", "O que o AURION não faz?"]; return say("Não encontrei esse assunto nas regras versionadas nem na documentação do AURION. Prefiro não responder sem fonte; tente reformular ou pergunte sobre seus números."); }
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

