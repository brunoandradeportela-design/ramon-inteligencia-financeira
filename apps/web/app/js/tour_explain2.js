/* Frases do tour para Visão Geral, Patrimônio, Finanças, Radar e Simulador.
 * Funções PURAS: leem os mesmos objetos que desenharam a tela (/v1/dashboard, /v1/portfolio/consolidated,
 * /v1/finance/summary, /v1/alerts, /v1/simulations) e reproduzem em palavras as fórmulas de fin_engine.js e
 * alert_engine.js. Não recalculam nada além de somas e divisões já feitas pelo motor. */
import { brl, mesBR, dataBR, SELO_DEMO } from "./tour_explain.js";

const n = v => +v || 0;
const out = (o, s) => (o?.demo ? SELO_DEMO : "") + s;
export const pct = (v, d = 1) => (v == null || !isFinite(v) ? "—" : (Math.round(v * 100 * 10 ** d) / 10 ** d).toLocaleString("pt-BR", { maximumFractionDigits: d }) + "%");
const lista = arr => arr.length <= 1 ? arr.join("") : arr.slice(0, -1).join(", ") + " e " + arr.at(-1);
const plural = (q, s, p) => `${q} ${q === 1 ? s : p}`;
const meses1 = v => (Math.round(n(v) * 10) / 10).toLocaleString("pt-BR", { maximumFractionDigits: 1 });

/* ================================================================ VISÃO GERAL */
export function patrimonioTotal(d, o = {}) {
  const nw = d?.net_worth || {}, s = nw.series || [], cash = n(d?.liquidity?.cash), inv = n(nw.total) - cash;
  const base = `${brl(nw.total)} = ${brl(inv)} em investimentos + ${brl(cash)} de saldo em conta.`;
  if (s.length < 2) return out(o, `${base} A evolução aparece quando houver mais de um mês de extratos.`);
  return out(o, `${base} O gráfico vai de ${brl(s[0].value)} em ${mesBR(s[0].month)} a ${brl(s.at(-1).value)} em ${mesBR(s.at(-1).month)}: variação de ${pct(nw.variation_pct)} no período. A curva é ${nw.series_kind || "estimada"}: parte do valor de hoje e desconta, mês a mês, o que entrou menos o que saiu.`);
}
export function impostosAno(d, o = {}) {
  const t = d?.tax || {}, ms = (t.monthly || []).filter(m => n(m.value) > 0);
  if (!n(t.estimated) && !ms.length) return out(o, `Nenhum imposto estimado em ${t.year || "este ano"} (${t.scope || "sem negociações"}). O valor aparece quando houver vendas na bolsa com lucro tributável.`);
  return out(o, `${brl(t.estimated)} é o imposto da bolsa estimado no ano, somando as guias DARF mensais.${ms.length ? ` As barras mostram o imposto apurado em cada mês: ${lista(ms.map(m => `${mesBR(m.month)} ${brl(m.value)}`))}.` : ""} Lucro isento no ano: ${brl(t.exempt)}. Confiança do cálculo: ${pct(t.confidence, 0)}. A conta mês a mês, com IRRF e mínimo de R$ 10 por guia, está na página Tributação.`);
}
export function alertasPainel(d, o = {}) {
  const a = d?.alerts || {};
  return out(o, a.open ? `${plural(n(a.open), "ponto de atenção aberto", "pontos de atenção abertos")}${n(a.critical) ? `, ${n(a.critical)} prioritário(s) (gravidade crítica ou alta)` : ""}. O número sai do Radar: alertas gerados pelas regras sobre os seus dados que você ainda não resolveu.` : "Nenhum ponto de atenção aberto agora. O Radar volta a avisar quando as regras encontrarem algo nos seus dados.");
}
export function alocacao(d, o = {}) {
  const al = d?.allocation || [], tot = al.reduce((s, a) => s + n(a.value), 0);
  if (!al.length) return out(o, "Sem posições nem saldo para distribuir ainda.");
  return out(o, `Cada fatia é o valor da classe dividido pelo total de ${brl(tot)}: ${lista(al.slice(0, 5).map(a => `${a.group} ${brl(a.value)} (${pct(a.weight, 0)})`))}${al.length > 5 ? " e outras" : ""}. O saldo em conta entra como uma classe própria.`);
}
export function liquidez(d, o = {}) {
  const l = d?.liquidity || {};
  if (!n(l.avg_monthly_expense)) return out(o, `${brl(l.cash)} em conta. A cobertura em meses aparece quando houver despesas importadas.`);
  return out(o, `${brl(l.cash)} em conta ÷ despesa média mensal de ${brl(l.avg_monthly_expense)} = cerca de ${meses1(l.months_covered)} mês(es) de cobertura. A referência comum para reserva de emergência é de 3 a 6 meses.`);
}
export function mudancas(changes, o = {}) {
  const c = changes || [];
  if (!c.length) return out(o, "Nenhuma categoria mudou o bastante: só aparece variação de pelo menos 30% e R$ 100 em relação à média dos meses anteriores.");
  return out(o, `Comparação do último mês com a média dos meses anteriores, por categoria: ${lista(c.slice(0, 4).map(x => `${x.category} ${brl(x.last)} contra ${brl(x.baseline)} (${x.delta_pct > 0 ? "+" : ""}${pct(x.delta_pct, 0)})`))}. Só entram mudanças de pelo menos 30% e R$ 100.`);
}
export function proximasAcoes(d, o = {}) {
  const a = d?.next_actions || [];
  return out(o, a.length ? `${plural(a.length, "ação sugerida", "ações sugeridas")} a partir dos seus dados: ${lista(a.slice(0, 4).map(x => x.title))}. Cada uma leva à tela onde se resolve.` : "Nenhuma ação pendente para os dados enviados.");
}

/* ================================================================ PATRIMÔNIO */
export function consolidado(p, o = {}) {
  const pos = p?.positions || [];
  return out(o, pos.length ? `${brl(p.total)} é a soma do valor de ${plural(pos.length, "posição", "posições")} importadas, cada uma pela última cotação ou valor informado pela instituição. Saldo em conta corrente fica de fora (está em Finanças).` : "Nenhuma posição importada ainda.");
}
export function aplicado(p, o = {}) {
  const cov = p?.result_coverage, semCusto = (p?.positions || []).filter(x => x.invested == null).length;
  const cobertura = cov != null && cov < 0.999 ? ` O custo é conhecido para ${pct(cov, 0)} do valor da carteira; o restante ainda não tem compras registradas.` : !semCusto ? " Todas as posições têm custo conhecido." : "";
  return out(o, `${brl(p?.invested)} é quanto custaram as posições com custo conhecido (preço médio das compras importadas ou valor aplicado informado pelo banco).${cobertura}`);
}
export function resultado(p, o = {}) {
  return out(o, `${brl(p?.result)} = valor atual das posições com custo conhecido − ${brl(p?.invested)} aplicados, ou ${pct(p?.result_pct)} sobre o custo. É resultado acumulado desde as compras, ainda não realizado, e não inclui imposto.`);
}
export function liquidezD2(p, o = {}) {
  return out(o, `${brl(p?.liquidity?.d2_or_less)} de ${brl(p?.total)} (${pct(p?.liquidity?.share, 0)}) podem virar dinheiro em até 2 dias úteis após o pedido de resgate ou venda, pelo prazo típico de cada classe de ativo.`);
}
export function concentracao(p, o = {}) {
  const c = p?.concentration || {};
  if (!(p?.positions || []).length) return out(o, "Sem posições para medir concentração.");
  return out(o, `Maior posição: ${c.largest_position} com ${pct(c.largest_weight)} da carteira. O índice HHI (soma dos pesos ao quadrado) é ${String(c.hhi).replace(".", ",")}: acima de 0,25 indica carteira concentrada, entre 0,15 e 0,25 concentração moderada, abaixo disso diversificada. Leitura: ${c.reading}.`);
}
export function composicaoPatrimonio(p, o = {}) {
  const al = p?.allocation || [];
  return out(o, al.length ? `Peso de cada classe = valor da classe ÷ ${brl(p.total)}: ${lista(al.map(a => `${a.group} ${pct(a.weight)}`))}.` : "Sem posições importadas.");
}
export function posicoes(p, o = {}) {
  const pos = p?.positions || [], semCusto = pos.filter(x => x.invested == null);
  return out(o, pos.length ? `${plural(pos.length, "ativo", "ativos")}, do maior para o menor peso. ${semCusto.length ? `${plural(semCusto.length, "posição está", "posições estão")} sem custo de compra (${lista(semCusto.slice(0, 4).map(x => x.name))}), por isso ${semCusto.length === 1 ? "aparece" : "aparecem"} com “—” em Aplicado e Resultado.` : "Todas com custo conhecido."}` : "Nenhuma posição.");
}

/* ================================================================ FINANÇAS */
export function entradas(f, o = {}) {
  return out(o, `${brl(f?.totals?.income)} recebidos de ${mesBR(f?.period?.from)} a ${mesBR(f?.period?.to)}. Aplicações, resgates e pagamento de fatura de cartão não contam como receita, para não inflar o número.`);
}
export function saidas(f, o = {}) {
  const top = (f?.by_category || [])[0];
  return out(o, `${brl(f?.totals?.expense)} gastos no período${top ? `; a maior categoria é ${top.category} com ${brl(top.value)} (${pct(top.share, 0)})` : ""}. Transferências para investimentos e pagamento de fatura não entram como despesa.`);
}
export function saldoPeriodo(f, o = {}) {
  const t = f?.totals || {};
  return out(o, `${brl(t.income)} de entradas − ${brl(t.expense)} de saídas = ${brl(t.net)}. Taxa de poupança: ${brl(t.net)} ÷ ${brl(t.income)} = ${pct(t.savings_rate, 0)}${n(t.savings_rate) < 0 ? " (negativa: você gastou mais do que recebeu)" : ""}.`);
}
export function saldoContas(f, o = {}) {
  const acc = (f?.accounts || []).filter(a => a.type !== "cartao");
  return out(o, `${brl(f?.liquidity?.cash)} somando o saldo de ${plural(acc.length, "conta", "contas")}${acc.length ? `: ${lista(acc.slice(0, 4).map(a => `${a.name} ${brl(a.balance)}`))}` : ""}. Cartões de crédito não entram neste total.`);
}
export function fluxoMensal(f, o = {}) {
  const s = f?.series || [];
  if (!s.length) return out(o, "Sem meses importados.");
  const melhor = [...s].sort((a, b) => n(b.net) - n(a.net))[0], pior = [...s].sort((a, b) => n(a.net) - n(b.net))[0];
  return out(o, `${plural(s.length, "mês", "meses")} lado a lado. Melhor saldo: ${mesBR(melhor.month)} (${brl(melhor.net)}); pior: ${mesBR(pior.month)} (${brl(pior.net)}).`);
}
export function categorias(f, o = {}) {
  const c = (f?.by_category || []).slice(0, 4);
  return out(o, c.length ? `Participação = gasto da categoria ÷ ${brl(f.totals.expense)} de saídas: ${lista(c.map(x => `${x.category} ${brl(x.value)} (${pct(x.share, 0)})`))}.` : "Sem despesas categorizadas.");
}
export function recorrencias(f, o = {}) {
  const r = f?.recurring || [];
  return out(o, r.length ? `${plural(r.length, "gasto recorrente", "gastos recorrentes")}: mesma descrição em 3 ou mais meses com valor parecido (variação menor que 60%). Somam ${brl(r.reduce((s, x) => s + n(x.monthly), 0))} por mês.` : "Nenhum gasto se repetiu em 3 meses ou mais com valor parecido.");
}

/* ================================================================ RADAR */
export function radarResumo(res, o = {}) {
  const it = res?.items || [], ab = it.filter(a => a.status !== "resolvido"), sev = {};
  ab.forEach(a => { sev[a.severity] = (sev[a.severity] || 0) + 1; });
  const L = { critico: "crítico", alto: "alto", atencao: "atenção", informativo: "informativo", oportunidade: "oportunidade" };
  return out(o, ab.length ? `${plural(ab.length, "alerta em aberto", "alertas em aberto")}: ${lista(Object.entries(sev).map(([k, v]) => `${v} ${L[k] || k}`))}. ${it.length - ab.length} já resolvido(s).${res?.limited ? " O plano Free mostra até 3." : ""}` : "Nenhum alerta em aberto.");
}
export function alertaPrioridade(a, o = {}) {
  if (!a) return out(o, "Nenhum alerta para explicar.");
  return out(o, `Prioridade ${String(a.priority).replace(".", ",")} = impacto ${pct(a.impact, 0)} × urgência ${pct(a.urgency, 0)} × relevância ${pct(a.relevance, 0)} × confiança ${pct(a.confidence, 0)}, em escala de 0 a 100. A lista ordena primeiro pela gravidade e depois por esse número.${a.due_date ? ` Prazo: ${dataBR(a.due_date)}.` : ""}`);
}

/* ================================================================ SIMULADOR */
export function simuladorBase(pf, sims, real, o = {}) {
  const rv = (pf?.positions || []).filter(p => ["acao", "etf", "fii", "bdr"].includes(p.asset_class));
  return out(o, `${plural(rv.length, "posição em bolsa disponível", "posições em bolsa disponíveis")} para simular${real ? " (sua carteira importada)" : " (carteira de exemplo)"}. ${plural((sims?.items || []).length, "simulação salva", "simulações salvas")}.`);
}
