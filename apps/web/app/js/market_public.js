/* Painel público de mercado (login/cadastro 4.0): instrumentos, leitura das respostas do provedor e situação do pregão.
 * Funções puras — usadas pela API (serviço centralizado com cache) e pelos testes.
 * Provedor atual: Yahoo Finance (endpoint público de gráficos). Dados ATRASADOS e de uso informativo:
 * nunca são rotulados como tempo real. Para tempo real é preciso contratar um provedor licenciado (B3/vendors). */

export const INSTRUMENTS = [
  { id: "IBOV", y: "^BVSP", nome: "Ibovespa", tipo: "indice", bolsa: "B3", unidade: "pts", tz: "America/Sao_Paulo" },
  { id: "PETR4", y: "PETR4.SA", nome: "Petrobras PN", tipo: "acao", bolsa: "B3", unidade: "BRL", tz: "America/Sao_Paulo" },
  { id: "VALE3", y: "VALE3.SA", nome: "Vale ON", tipo: "acao", bolsa: "B3", unidade: "BRL", tz: "America/Sao_Paulo" },
  { id: "ITUB4", y: "ITUB4.SA", nome: "Itaú Unibanco PN", tipo: "acao", bolsa: "B3", unidade: "BRL", tz: "America/Sao_Paulo" },
  { id: "BBDC4", y: "BBDC4.SA", nome: "Bradesco PN", tipo: "acao", bolsa: "B3", unidade: "BRL", tz: "America/Sao_Paulo" },
  { id: "B3SA3", y: "B3SA3.SA", nome: "B3 ON", tipo: "acao", bolsa: "B3", unidade: "BRL", tz: "America/Sao_Paulo" },
  { id: "SPX", y: "^GSPC", nome: "S&P 500", tipo: "indice", bolsa: "NYSE", unidade: "pts", tz: "America/New_York" },
  { id: "NASDAQ", y: "^IXIC", nome: "Nasdaq Composite", tipo: "indice", bolsa: "Nasdaq", unidade: "pts", tz: "America/New_York" },
  { id: "DJI", y: "^DJI", nome: "Dow Jones Industrial Average", tipo: "indice", bolsa: "NYSE", unidade: "pts", tz: "America/New_York" },
  { id: "USDBRL", y: "BRL=X", nome: "Dólar comercial / Real", tipo: "cambio", bolsa: "Câmbio", unidade: "BRL", tz: "UTC" },
  { id: "EURBRL", y: "EURBRL=X", nome: "Euro / Real", tipo: "cambio", bolsa: "Câmbio", unidade: "BRL", tz: "UTC" },
];
export const TIPO_LABEL = { indice: "Índice", acao: "Ação", cambio: "Par cambial" };
export const instrument = id => INSTRUMENTS.find(i => i.id === String(id || "").toUpperCase()) || null;
export const PERIODS = { "1D": { range: "1d", interval: "5m", ttl: 5 }, "1S": { range: "5d", interval: "30m", ttl: 30 }, "1M": { range: "1mo", interval: "1d", ttl: 360 },
  "1A": { range: "1y", interval: "1wk", ttl: 1440 }, "5A": { range: "5y", interval: "1mo", ttl: 1440 } };
export const SOURCE = "Yahoo Finance — dados atrasados (B3 com atraso de pelo menos 15 min), uso informativo";
export const SNAPSHOT_TTL_MIN = 5;
export const chartUrl = (base, inst, range = "1d", interval = "5m") =>
  `${String(base || "https://query1.finance.yahoo.com").replace(/\/$/, "")}/v8/finance/chart/${encodeURIComponent(inst.y)}?range=${range}&interval=${interval}`;

const r4 = v => Math.round(v * 1e4) / 1e4;

/** situação do mercado a partir do período de negociação informado pelo provedor */
export function marketStatus(meta, nowSec = Date.now() / 1000, tipo = "acao") {
  const reg = meta?.currentTradingPeriod?.regular;
  if (tipo === "cambio") return { estado: "continuo", dado: "atrasado", rotulo: "Mercado de câmbio contínuo · cotação atrasada" };
  if (reg && reg.start && reg.end && nowSec >= reg.start && nowSec <= reg.end) return { estado: "aberto", dado: "atrasado", rotulo: "Pregão aberto · cotação atrasada" };
  return { estado: "fechado", dado: "fechamento", rotulo: "Mercado fechado · último fechamento" };
}

/** lê a resposta v8/chart: última cotação, fechamento anterior, variação, horário e minigráfico */
export function parseQuote(json, inst, nowSec = Date.now() / 1000) {
  const r = json?.chart?.result?.[0];
  if (!r) throw new Error(json?.chart?.error?.description || "sem dados");
  const meta = r.meta || {}, closes = (r.indicators?.quote?.[0]?.close || []).map(Number);
  const pts = (r.timestamp || []).map((t, i) => [t, closes[i]]).filter(p => isFinite(p[1]) && p[1] > 0);
  const last = +(meta.regularMarketPrice ?? pts.at(-1)?.[1]);
  if (!(last > 0)) throw new Error("sem cotação");
  const prev = +(meta.previousClose ?? meta.chartPreviousClose ?? NaN);
  const time = meta.regularMarketTime || pts.at(-1)?.[0] || null;
  const step = Math.max(1, Math.ceil(pts.length / 48));
  const spark = pts.filter((_, i) => i % step === 0 || i === pts.length - 1).map(p => r4(p[1]));
  const st = marketStatus(meta, nowSec, inst.tipo);
  return { id: inst.id, simbolo: inst.id, nome: inst.nome, tipo: inst.tipo, tipo_label: TIPO_LABEL[inst.tipo], bolsa: inst.bolsa, unidade: inst.unidade,
    ultimo: r4(last), anterior: isFinite(prev) && prev > 0 ? r4(prev) : null,
    variacao: isFinite(prev) && prev > 0 ? r4(last - prev) : null, variacao_pct: isFinite(prev) && prev > 0 ? Math.round((last / prev - 1) * 1e6) / 1e6 : null,
    horario: time ? new Date(time * 1000).toISOString() : null, mercado: st.estado, dado: st.dado, situacao: st.rotulo, spark, moeda: meta.currency || null };
}

/** OHLC para gráficos de período */
export function parseHistory(json) {
  const r = json?.chart?.result?.[0];
  if (!r) throw new Error(json?.chart?.error?.description || "sem dados");
  const q = r.indicators?.quote?.[0] || {}, out = [];
  (r.timestamp || []).forEach((t, i) => { const c = +q.close?.[i]; if (isFinite(c) && c > 0) out.push({ t: new Date(t * 1000).toISOString(), o: r4(+q.open?.[i] || c), h: r4(+q.high?.[i] || c), l: r4(+q.low?.[i] || c), c: r4(c) }); });
  return out;
}

/** junta o resultado novo com o anterior: falha mantém o último valor válido marcado como desatualizado, ou "indisponível" */
export function mergeSnapshot(prev, results, nowIso) {
  const old = Object.fromEntries((prev?.items || []).map(i => [i.id, i]));
  const items = INSTRUMENTS.map(inst => {
    const r = results[inst.id];
    if (r && r.ok) return { ...r.item, atualizado_em: nowIso, desatualizado: false };
    if (old[inst.id] && old[inst.id].ultimo != null) return { ...old[inst.id], desatualizado: true, erro: r?.error || "falha na atualização" };
    return { id: inst.id, simbolo: inst.id, nome: inst.nome, tipo: inst.tipo, tipo_label: TIPO_LABEL[inst.tipo], bolsa: inst.bolsa, unidade: inst.unidade, ultimo: null, indisponivel: true, erro: r?.error || "sem dados" };
  });
  const ok = items.filter(i => !i.indisponivel && !i.desatualizado).length;
  return { at: nowIso, fonte: SOURCE, tempo_real: false, items, ok, falhas: INSTRUMENTS.length - ok };
}
