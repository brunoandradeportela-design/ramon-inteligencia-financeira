/* Relatório de apoio à declaração (IRPF) — renda variável: resultado mês a mês, ganhos isentos, prejuízos a compensar
 * e bens e direitos pelo custo de aquisição em 31/12 do ano anterior e do ano-calendário.
 * Tudo vem do Tax Engine (mesma versão de regras); é material de conferência para o contribuinte e o contador. */
import { computeTax, ENGINE_VERSION } from "./tax_engine.js";

export const IRPF_REPORT_VERSION = "irpf-report@1.0.0";
const r2 = v => (Math.round((+v || 0) * 100) / 100).toFixed(2);
/* grupo/código de Bens e Direitos só onde o enquadramento é inequívoco; demais classes: conferir no P&R do exercício */
const BEM = { acao: { grupo: "03", codigo: "01", label: "Participações societárias — ações" }, fii: { grupo: "07", codigo: "03", label: "Fundos — fundos de investimento imobiliário (FII)" } };
const MESES = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];

export function irpfReport({ trades = [], year, refDate, knownClasses = {}, priorLosses = {}, paidDarfs = {} }) {
  const end = `${year}-12-31`, ref = refDate && refDate < end ? refDate : end, partial = ref < end;
  const opts = { knownClasses, priorLosses, paidDarfs };
  const tax = computeTax(trades.filter(t => t.date <= ref), { ...opts, year, refDate: ref });
  const prev = computeTax(trades.filter(t => t.date <= `${year - 1}-12-31`), { ...opts, year: year - 1, refDate: `${year - 1}-12-31` });
  const custodianOf = tk => [...trades].filter(t => String(t.ticker).toUpperCase() === tk && t.custodian).sort((a, b) => b.date.localeCompare(a.date))[0]?.custodian || null;
  const tickers = [...new Set([...Object.keys(prev.positions_cost || {}), ...Object.keys(tax.positions_cost || {})])].sort();
  const bens = tickers.map(tk => {
    const a = prev.positions_cost?.[tk], b = tax.positions_cost?.[tk], cls = (b || a).classe, code = BEM[cls] || null, cust = custodianOf(tk);
    const q = +(b?.quantidade || 0), unit = cls === "fii" ? "cotas" : "ações";
    return { ticker: tk, classe: cls, grupo: code?.grupo || null, codigo: code?.codigo || null, enquadramento: code?.label || "Confira grupo e código no Perguntas e Respostas do exercício",
      quantidade_anterior: a?.quantidade || "0", situacao_anterior: r2(a?.custo_total || 0), quantidade: b?.quantidade || "0", situacao_atual: r2(b?.custo_total || 0),
      discriminacao: q > 0 ? `${q} ${unit} de ${tk}${cust ? `, custodiadas em ${cust}` : ""}, adquiridas ao custo médio de R$ ${String(b.preco_medio).replace(".", ",")}. Valor pelo custo de aquisição.` : `Posição em ${tk} encerrada no ano.` };
  });
  const byMonth = Object.fromEntries((tax.months || []).map(m => [m.month, m]));
  const mensal = MESES.map((nome, i) => {
    const mk = `${year}-${String(i + 1).padStart(2, "0")}`, m = byMonth[mk];
    return { mes: nome, competencia: mk, vendas_acoes: m?.sales_acoes || "0.00", resultado_comum: m?.result_comum || "0.00", resultado_daytrade: m?.result_daytrade || "0.00", resultado_fii: m?.result_fii || "0.00",
      ganho_isento: m?.exempt_gain || "0.00", imposto_devido: m?.tax_due_gross || "0.00", irrf: m?.irrf || "0.00", imposto_a_pagar: m?.tax_due || "0.00",
      darf_pago: paidDarfs[mk] != null ? r2(paidDarfs[mk]) : null, darf_status: m?.darf?.status || null };
  });
  const sum = k => r2(mensal.reduce((s, x) => s + +x[k], 0));
  return {
    version: IRPF_REPORT_VERSION, engine_version: ENGINE_VERSION, rule_versions: tax.rule_versions, year, reference_date: ref, partial,
    renda_variavel: { mensal, totais: { resultado_comum: sum("resultado_comum"), resultado_daytrade: sum("resultado_daytrade"), resultado_fii: sum("resultado_fii"), imposto_devido: sum("imposto_devido"), irrf: sum("irrf"), imposto_a_pagar: sum("imposto_a_pagar") },
      prejuizo_a_compensar_final: tax.losses_available },
    rendimentos_isentos: { ganhos_acoes_ate_20_mil: tax.total_exempt_gain, descricao: "Ganhos líquidos em operações no mercado à vista de ações em meses com vendas de até R$ 20 mil" },
    bens_e_direitos: bens,
    totais_bens: { situacao_anterior: r2(bens.reduce((s, b) => s + +b.situacao_anterior, 0)), situacao_atual: r2(bens.reduce((s, b) => s + +b.situacao_atual, 0)) },
    premissas: [
      "Bens e direitos pelo custo de aquisição (preço médio com custos da nota), não pelo valor de mercado.",
      "Valores da apuração mensal vêm do Tax Engine com as versões de regra indicadas; conferir com as notas de corretagem.",
      "Grupo e código de bens só foram preenchidos para ações (03/01) e FII (07/03); ETF e BDR: conferir no Perguntas e Respostas do exercício.",
      "Rendimentos de FII (proventos), juros sobre capital próprio e dividendos não entram neste relatório.",
      ...(partial ? [`Ano em andamento: posição e resultados até ${ref.split("-").reverse().join("/")}.`] : []),
    ],
    limitations: tax.limitations, confidence: tax.confidence, quality: tax.quality,
    disclaimer: "Material de apoio para conferência da declaração. Não substitui o programa da Receita Federal nem a revisão do seu contador.",
  };
}
