/* Frases do tour para Notícias, Trader Intelligence, Inteligência, Documentos, Importar e Conexões.
 * Funções PURAS sobre os objetos da tela. Reproduzem em palavras as regras de daily_engine.js (relevância),
 * trader_engine.js (resultado, acerto, profit factor, drawdown, imposto por operação) e data_quality.js (notas). */
import { brl, mesBR, dataBR } from "./tour_explain.js";

const n = v => +v || 0;
const pct = (v, d = 0) => (v == null || !isFinite(v) ? "—" : (Math.round(v * 100 * 10 ** d) / 10 ** d).toLocaleString("pt-BR", { maximumFractionDigits: d }) + "%");
const lista = arr => arr.length <= 1 ? arr.join("") : arr.slice(0, -1).join(", ") + " e " + arr.at(-1);
const plural = (q, s, p) => `${q} ${q === 1 ? s : p}`;
const num2 = v => (Math.round(n(v) * 100) / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/* ================================================================ NOTÍCIAS */
export function noticias(ranked, sources) {
  const all = ranked || [], rel = all.filter(x => n(x.relevance) > 0);
  const motivo = rel[0]?.why ? ` A mais relevante agora ${rel[0].why}.` : "";
  const fontes = Object.entries((sources || []).reduce((g, s) => { g[s.name] = g[s.name] === "ok" || s.status === "ok" ? "ok" : (g[s.name] || s.status); return g; }, {}));
  const fora = fontes.filter(([, st]) => st !== "ok").map(([nome]) => nome);
  return `${plural(all.length, "notícia coletada", "notícias coletadas")} de ${plural(fontes.length, "fonte oficial", "fontes oficiais")}; ${plural(rel.length, "está ligada", "estão ligadas")} à sua carteira. Cada notícia ganha 3 pontos por ativo seu citado no título ou resumo e 1 ponto por tema da sua carteira; “Para você” mostra só as que pontuam, da maior para a menor.${motivo}${fora.length ? ` Sem publicação recente ou indisponível: ${lista(fora)}.` : ""}`;
}
export function daily(d) {
  return `Resumo de ${dataBR(d?.date)} com ${plural((d?.sections || []).length, "bloco", "blocos")}: ${lista((d?.sections || []).map(s => s.title))}. É montado por regras (${d?.version || "versão do motor"}), sem IA generativa: os mesmos dados produzem o mesmo texto.`;
}

/* ================================================================ TRADER */
export function traderResultado(o) {
  const t = o?.totals || {};
  if (!n(t.trades)) return "Nenhuma operação fechada ainda. O resultado aparece quando uma compra e uma venda do mesmo ativo se completam.";
  return `${brl(t.gross_pnl)} de resultado bruto − ${brl(t.costs)} de custos (corretagem, emolumentos e taxas) = ${brl(t.net_pnl)} líquidos, em ${plural(n(t.trades), "operação fechada", "operações fechadas")}. Posições ainda abertas não entram.`;
}
export function traderImposto(o) {
  const t = o?.totals || {};
  return `${brl(t.tax_estimate)} somando o imposto estimado de cada operação com lucro: 15% em operações comuns, 20% em day trade e em FII; ações vendidas em mês isento ficam com 0%. É uma estimativa por operação. O valor oficial do ano vem da apuração mensal da Tributação: ${brl(o?.tax?.total_tax_due)}.`;
}
export function traderAcerto(o) {
  const t = o?.totals || {}, pf = o?.profit_factor;
  if (!n(t.trades)) return "Sem operações fechadas para medir.";
  const ganhos = Math.round(n(o.win_rate) * n(t.trades));
  return `Taxa de acerto: ${ganhos} de ${plural(n(t.trades), "operação", "operações")} com lucro = ${pct(o.win_rate)}. Profit factor = soma dos ganhos ÷ soma das perdas${pf == null ? ": sem perdas até agora, então não há divisão possível" : ` = ${num2(pf)}`}; acima de 1 significa que os ganhos superaram as perdas.`;
}
export function traderDrawdown(o) {
  return `${brl(Math.abs(n(o?.max_drawdown)))} foi a maior queda acumulada do resultado, medida do ponto mais alto até o ponto mais baixo seguinte da curva de operações fechadas. Mostra quanto você precisou aguentar de perda antes de recuperar.`;
}

/* ================================================================ DOCUMENTOS */
export function checklistIR(ck) {
  if (!ck) return "Checklist indisponível.";
  const pend = (ck.items || []).filter(i => !i.done).map(i => i.title);
  return `${ck.done} de ${ck.total} itens prontos para a declaração de ${ck.delivery_year} (ano-calendário ${ck.year})${ck.total ? `, ${pct(ck.done / ck.total)}` : ""}. Um item fica pronto quando o documento correspondente foi guardado ou os dados foram importados.${pend.length ? ` Faltam: ${lista(pend.slice(0, 4))}${pend.length > 4 ? " e outros" : ""}.` : ""}`;
}
const size = b => n(b) >= 1048576 ? (n(b) / 1048576).toLocaleString("pt-BR", { maximumFractionDigits: 1 }) + " MB" : Math.round(n(b) / 1024) + " KB";
export function documentosLista(res) {
  const it = res?.items || [], conf = it.filter(d => d.status === "conferido").length;
  return `${plural(it.length, "documento guardado", "documentos guardados")}${it.length ? `, ${conf} com leitura conferida` : ""}. Espaço usado: ${size(res?.used_bytes)} de ${size(res?.quota_bytes)}.`;
}

/* ================================================================ IMPORTAR */
export function importacoes(list) {
  const it = list?.items || [];
  if (!it.length) return "Nenhuma importação ainda. Comece pelo extrato da conta e pelo relatório de negociações da B3.";
  const tot = it.reduce((s, x) => { for (const [k, v] of Object.entries(x.counts || {})) s[k] = (s[k] || 0) + n(v); return s; }, {});
  const L = { transactions: ["lançamento", "lançamentos"], accounts: ["conta", "contas"], holdings: ["posição", "posições"], trades: ["negociação", "negociações"] };
  const ult = [...it].sort((a, b) => String(b.created_at || b.at || "").localeCompare(String(a.created_at || a.at || "")))[0];
  return `${plural(it.length, "importação", "importações")} somando ${lista(Object.entries(tot).filter(([, v]) => v).map(([k, v]) => L[k] ? plural(v, L[k][0], L[k][1]) : `${v} ${k}`)) || "nenhum registro"}. Repetir o mesmo arquivo não duplica lançamentos.${ult?.filename ? ` Mais recente: ${ult.filename}.` : ""}`;
}

/* ================================================================ CONEXÕES */
export function openFinance(st) {
  if (!st?.configured) return "A conexão automática ainda não está ativa: depende do contrato com o agregador de Open Finance. Enquanto isso, os mesmos painéis funcionam com os arquivos que você importa.";
  const it = st.items || [];
  return it.length ? `${plural(it.length, "instituição conectada", "instituições conectadas")}: ${lista(it.map(c => `${c.institution} (${c.label || c.state})`))}.` : "Nenhuma instituição conectada ainda.";
}
const IND = { freshness: ["Atualização", 20, "1 se o dado mais recente tem até 7 dias, 0,6 até 31 dias, 0,3 acima"], completeness: ["Completude", 25, "meses sem lançamentos no meio do período reduzem a nota"],
  validity: ["Validade", 15, "registros aceitos ÷ registros lidos"], consistency: ["Consistência", 25, "posições e contas que fecham com negociações e lançamentos"], duplicates: ["Sem duplicidade", 15, "1 − repetidos ÷ total"] };
export function qualidadeDados(dq) {
  if (!dq) return "Indicadores indisponíveis.";
  const parts = Object.entries(dq.indicators || {}).map(([k, v]) => `${IND[k]?.[0] || k} ${pct(v)} (peso ${IND[k]?.[1] ?? "—"}%)`);
  return `Nota geral ${pct(dq.overall)} = média ponderada de ${lista(parts)}.${dq.freshness_days != null ? ` Dado mais recente: há ${dq.freshness_days} dia(s).` : ""}${(dq.tips || []).length ? ` Para melhorar: ${dq.tips[0]}` : ""}`;
}
export const COMO_INDICADORES = Object.values(IND).map(([l, p, c]) => `${l} (${p}%): ${c}`).join("; ");
export { mesBR };
