/* Frases do tour das abas do Trader Intelligence. Funções PURAS sobre as respostas da API de cada aba,
 * repetindo em palavras as fórmulas de trader_engine.js (indicadores, desempenho, risco e imposto por operação). */
import { brl, dataBR } from "./tour_explain.js";

const n = v => +v || 0;
const pct = (v, d = 0) => (v == null || !isFinite(v) ? "—" : (Math.round(v * 100 * 10 ** d) / 10 ** d).toLocaleString("pt-BR", { maximumFractionDigits: d }) + "%");
const dec = (v, d = 2) => v == null || !isFinite(v) ? "—" : (+v).toLocaleString("pt-BR", { minimumFractionDigits: d, maximumFractionDigits: d });
const plural = (q, s, p) => `${q} ${q === 1 ? s : p}`;
const lista = arr => arr.length <= 1 ? arr.join("") : arr.slice(0, -1).join(", ") + " e " + arr.at(-1);

/* ------------------------------------------------------------------ mercado */
export function mercadoIndicadores(m) {
  const s = m?.snapshot;
  if (!s) return "Cotação indisponível para este ativo agora.";
  const tend = s.sma20 && s.sma50 ? (s.sma20 > s.sma50 ? "a média de 20 está acima da de 50 (preço recente mais alto que o de prazo maior)" : "a média de 20 está abaixo da de 50 (preço recente mais baixo que o de prazo maior)") : "";
  const ifr = s.rsi14 == null ? "" : ` IFR(14) = ${dec(s.rsi14, 0)}: compara altas e quedas dos últimos 14 pregões, de 0 a 100; acima de 70 costuma ser lido como esticado para cima e abaixo de 30, para baixo.`;
  return `${m.ticker} fechou a ${brl(s.last)} em ${dataBR(s.date)}${s.change == null ? "" : `, ${s.change >= 0 ? "+" : ""}${pct(s.change, 2)} sobre o pregão anterior`}. Média móvel de 20 = média dos últimos 20 fechamentos (${brl(s.sma20)})${s.sma50 ? `; de 50 = ${brl(s.sma50)}` : ""}${tend ? `; ${tend}` : ""}.${ifr} Volatilidade anual ${s.volatility_annual == null ? "—" : pct(s.volatility_annual)}: desvio dos retornos diários de até 252 pregões, anualizado. Faixa de 52 semanas: ${brl(s.low_52w)} a ${brl(s.high_52w)}.`;
}
export function mercadoFonte(m) {
  if (!m) return "Sem dados carregados.";
  return `${plural((m.candles || []).length, "pregão diário", "pregões diários")} de ${m.provider || "provedor de mercado"}, coletados em ${dataBR(m.fetched_at)}${m.stale ? "; o dado pode estar desatualizado" : ""}. São dados de fechamento, não tempo real.`;
}

/* ------------------------------------------------------------------ listas, operações, estratégias */
export function watchlists(w) {
  const it = w?.items || [], tickers = it.reduce((s, l) => s + (l.tickers || l.quotes || []).length, 0);
  return it.length ? `${plural(it.length, "lista", "listas")} com ${plural(tickers, "ativo", "ativos")} no total. Cada linha mostra o último fechamento e a variação do dia.` : "Nenhuma lista criada ainda.";
}
export function operacoes(d) {
  const it = d?.t?.items || [], ativas = it.filter(x => !x.superseded_by && x.status !== "voided"), orig = {};
  ativas.forEach(x => { orig[x.origin] = (orig[x.origin] || 0) + 1; });
  return `${plural(n(d?.t?.total ?? it.length), "registro", "registros")}, ${ativas.length} em vigor${Object.keys(orig).length ? ` (origem: ${lista(Object.entries(orig).map(([k, v]) => `${k} ${v}`))})` : ""}. Correções e anulações ficam no histórico, esmaecidas, e não entram nos cálculos.`;
}
export function estrategias(d) {
  const it = d?.s?.items || [], comModelo = it.filter(x => x.template).length;
  return it.length ? `${plural(it.length, "estratégia", "estratégias")}, ${comModelo} ligada(s) a um modelo testável no Backtest.` : "Nenhuma estratégia registrada.";
}
export function backtests(d) {
  const it = d?.bt?.items || [];
  if (!it.length) return "Nenhum backtest rodado ainda. O resultado aparece abaixo do formulário depois de rodar.";
  const u = it[0];
  return `${plural(it.length, "execução", "execuções")} guardadas. A mais recente: ${u.ticker} com ${u.strategy?.name}, retorno de ${pct(u.result?.total_return, 1)} no período. “Reproduzir” roda de novo com os mesmos dados e parâmetros e confirma se o resultado é igual.`;
}

/* ------------------------------------------------------------------ desempenho */
export function performance(a) {
  if (!a?.has_data) return "Sem operações fechadas ainda.";
  const t = a.totals;
  return `Bruto ${brl(t.gross_pnl)} − custos ${brl(t.costs)} = líquido ${brl(t.net_pnl)}; após o imposto estimado de ${brl(t.tax_estimate)} sobram ${brl(t.after_tax)}. ${a.payoff == null ? `Payoff: sem perdas para comparar (ganho médio ${brl(a.avg_win)}).` : `Payoff ${dec(a.payoff)} = ganho médio ${brl(a.avg_win)} ÷ perda média ${brl(a.avg_loss)}.`} Expectativa = líquido ÷ número de operações = ${brl(a.expectancy)} por operação. Maior sequência: ${a.streaks?.max_wins} ganhos e ${a.streaks?.max_losses} perdas.`;
}
export function performanceTabelas(a) {
  const top = [...(a?.by_asset || [])].sort((x, y) => n(y.net_pnl) - n(x.net_pnl))[0];
  return top ? `O mesmo resultado agrupado por ativo, estratégia, dia da semana e tipo ou horário. Melhor ativo: ${top.key}, com ${brl(top.net_pnl)} em ${plural(top.trades, "operação", "operações")}.` : "Agrupamentos por ativo, estratégia, dia da semana e tipo.";
}
export function impostos(t) {
  const per = t?.per_trade || [], com = per.filter(x => n(x.tax_estimate) > 0).length, isentas = per.filter(x => n(x.tax_rate) === 0 && n(x.net_pnl) > 0).length;
  const prej = Object.values(t?.losses_available || {}).reduce((s, v) => s + n(v), 0);
  return `Imposto do ano pela apuração mensal: ${brl(t?.total_tax_due)}. Prejuízos a compensar: ${brl(prej)}. Por operação, o imposto estimado é o líquido × alíquota (15% comum, 20% day trade e FII; 0% em ações vendidas em mês isento): ${plural(com, "operação gerou", "operações geraram")} imposto e ${plural(isentas, "teve lucro isento", "tiveram lucro isento")}. A soma por operação pode diferir da apuração mensal, que compensa prejuízos e o IRRF.`;
}
export function risco(k) {
  if (!k) return "Sem dados de risco.";
  const top = (k.exposure || [])[0];
  return `Exposição em bolsa ${brl(k.exposure_total)}; maior posição ${k.concentration?.largest || "—"} com ${pct(k.concentration?.largest_weight)}, HHI ${String(k.concentration?.hhi ?? "—").replace(".", ",")}. VaR 95% de 1 dia = valor × volatilidade anual ÷ √252 × 1,645, por ativo${top?.var95_1d != null ? ` (ex.: ${top.ticker}: ${brl(top.value)} → ${brl(top.var95_1d)})` : ""}; somando todos, sem descontar diversificação: ${brl(k.portfolio_var95_1d_sum)}. Significa que, em 95% dos dias, a perda esperada não passaria desse valor.`;
}
export function riscoHistorico(k) {
  return `Pior dia ${k?.worst_day ? `${brl(k.worst_day.pnl)} em ${dataBR(k.worst_day.date)}` : "—"}; pior semana ${k?.worst_week ? brl(k.worst_week.pnl) : "—"}. ${plural(n(k?.operations), "operação", "operações")}, tamanho médio ${brl(k?.avg_position_size)} e perda média ${brl(k?.risk_per_operation)}.`;
}

/* ------------------------------------------------------------------ journal, paper, radar */
export function journal(d) {
  const it = d?.j?.items || [], tags = {};
  it.forEach(x => (x.tags || []).forEach(t => { tags[t] = (tags[t] || 0) + 1; }));
  const top = Object.entries(tags).sort((a, b) => b[1] - a[1]).slice(0, 3);
  return it.length ? `${plural(it.length, "registro", "registros")} no journal${top.length ? `; tags mais usadas: ${lista(top.map(([k, v]) => `${k} (${v})`))}` : ""}.` : "Nenhum registro ainda.";
}
export function paper(p) {
  const a = p?.analytics || {};
  return `${plural((p?.items || []).length, "registro simulado", "registros simulados")}, ${plural(n(a.totals?.trades), "operação fechada", "operações fechadas")}: resultado simulado ${brl(a.totals?.net_pnl)} e acerto ${pct(a.win_rate)}. Nada disso envolve dinheiro nem entra nos impostos.`;
}
export function radarTrader(r) {
  const it = r?.items || [], sev = {};
  it.forEach(i => { sev[i.severity] = (sev[i.severity] || 0) + 1; });
  return it.length ? `${plural(it.length, "ponto de atenção", "pontos de atenção")} nas suas operações: ${lista(Object.entries(sev).map(([k, v]) => `${v} ${k === "atencao" ? "atenção" : k === "critico" ? "crítico" : k}`))}. Mais importante agora: ${it[0].title}.` : "Nenhum ponto de atenção nas suas operações agora.";
}
