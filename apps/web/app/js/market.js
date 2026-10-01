/* Cotações e índices de mercado (M3). Funções puras: montam URLs, leem as respostas e aplicam
 * as cotações à carteira. A rede fica com a API (cron diário no Cloudflare).
 * Fontes gratuitas: Banco Central (SGS) para CDI, Selic e IPCA; Yahoo Finance (ou brapi.dev, se houver token)
 * para o fechamento de ações, FIIs, ETFs e BDRs negociados na B3. */
import { assetClassOf } from "./tax_engine.js";

export const RV = new Set(["acao", "fii", "etf", "bdr"]);
export const isB3Ticker = t => /^[A-Z]{4}\d{1,2}$/.test(String(t || ""));
const r2 = v => (Math.round((+v || 0) * 100) / 100).toFixed(2);
const brDate = iso => iso.split("-").reverse().join("/");
const isoFromBr = s => { const m = String(s || "").match(/^(\d{2})\/(\d{2})\/(\d{4})$/); return m ? `${m[3]}-${m[2]}-${m[1]}` : null; };
const isoFromUnix = s => new Date((+s - 3 * 3600) * 1000).toISOString().slice(0, 10);   // horário de Brasília

/* ------------------------------------------------------------------ Banco Central — SGS */
export const SGS = { cdi: 12, cdi_aa: 4389, selic_meta: 432, ipca: 433 };
export function sgsUrl(code, from, to) {
  return `https://api.bcb.gov.br/dados/serie/bcdata.sgs.${code}/dados?formato=json&dataInicial=${brDate(from)}&dataFinal=${brDate(to)}`;
}
export function parseSgs(json) {
  if (!Array.isArray(json)) throw new Error("Resposta inesperada do Banco Central");
  return json.map(r => ({ date: isoFromBr(r.data), value: +String(r.valor).replace(",", ".") })).filter(r => r.date && isFinite(r.value));
}
const compound = rows => rows.reduce((acc, r) => acc * (1 + r.value / 100), 1) - 1;

/* séries: { cdi: [{date,value% a.d.}], cdi_aa: [...], selic_meta: [...], ipca: [{date, value% a.m.}] } */
export function indicesSnapshot(series, refDate) {
  const last = a => (a && a.length ? a[a.length - 1] : null);
  const cdi = series.cdi || [], ipca = series.ipca || [];
  const lastCdi = last(cdi), lastIpca = last(ipca);
  const back12 = d => { const x = new Date(d + "T12:00:00Z"); x.setUTCFullYear(x.getUTCFullYear() - 1); return x.toISOString().slice(0, 10); };
  const cdi12 = lastCdi ? cdi.filter(r => r.date > back12(lastCdi.date)) : [];
  const cdiYtd = lastCdi ? cdi.filter(r => r.date.slice(0, 4) === lastCdi.date.slice(0, 4)) : [];
  const ipca12 = ipca.slice(-12), ipcaYtd = lastIpca ? ipca.filter(r => r.date.slice(0, 4) === lastIpca.date.slice(0, 4)) : [];
  return {
    reference_date: refDate,
    selic_meta: last(series.selic_meta) ? { value: last(series.selic_meta).value / 100, date: last(series.selic_meta).date } : null,
    cdi_aa: last(series.cdi_aa) ? { value: last(series.cdi_aa).value / 100, date: last(series.cdi_aa).date } : null,
    cdi_12m: cdi12.length > 200 ? { value: compound(cdi12), from: cdi12[0].date, to: lastCdi.date } : null,
    cdi_ytd: cdiYtd.length ? { value: compound(cdiYtd), from: cdiYtd[0].date, to: lastCdi.date } : null,
    ipca_month: lastIpca ? { value: lastIpca.value / 100, month: lastIpca.date.slice(0, 7) } : null,
    ipca_12m: ipca12.length === 12 ? { value: compound(ipca12), from: ipca12[0].date.slice(0, 7), to: lastIpca.date.slice(0, 7) } : null,
    ipca_ytd: ipcaYtd.length ? { value: compound(ipcaYtd), to: lastIpca.date.slice(0, 7) } : null,
    source: "Banco Central do Brasil — SGS (séries 12, 4389, 432 e 433)",
  };
}

/* ------------------------------------------------------------------ cotações */
export const yahooUrl = t => `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(t)}.SA?range=5d&interval=1d`;
export const brapiUrl = (tickers, token) => `https://brapi.dev/api/quote/${tickers.map(encodeURIComponent).join(",")}?token=${encodeURIComponent(token)}`;

export function parseYahooChart(json, ticker) {
  const r = json?.chart?.result?.[0];
  if (!r) throw new Error(json?.chart?.error?.description || `Sem cotação para ${ticker}`);
  const meta = r.meta || {}, ts = r.timestamp || [], closes = r.indicators?.quote?.[0]?.close || [];
  const pts = ts.map((t, i) => ({ date: isoFromUnix(t), close: closes[i] })).filter(p => p.close != null && isFinite(p.close));
  const lastPt = pts.at(-1);
  const close = meta.regularMarketPrice ?? lastPt?.close;
  if (!(close > 0)) throw new Error(`Sem cotação para ${ticker}`);
  const date = meta.regularMarketTime ? isoFromUnix(meta.regularMarketTime) : lastPt?.date;
  const prev = pts.filter(p => p.date < date).at(-1)?.close ?? meta.chartPreviousClose ?? null;
  return { ticker, close: +(+close).toFixed(4), prev_close: prev == null ? null : +(+prev).toFixed(4), date, currency: meta.currency || "BRL", source: "Yahoo Finance" };
}
export function parseBrapi(json) {
  return (json?.results || []).filter(r => r && r.regularMarketPrice > 0).map(r => ({
    ticker: String(r.symbol).toUpperCase(), close: +r.regularMarketPrice, prev_close: r.regularMarketPreviousClose ?? null,
    date: r.regularMarketTime ? String(r.regularMarketTime).slice(0, 10) : null, currency: r.currency || "BRL", source: "brapi.dev" }));
}

/* ------------------------------------------------------------------ carteira com cotação
 * Atualiza o valor das posições de bolsa pela última cotação (se for mais nova que a posição importada)
 * e cria posições a partir das negociações quando o cliente não importou a posição da B3. */
export function applyQuotes(holdings, quotes, positionsFromTrades = {}) {
  const Q = quotes || {};
  const out = (holdings || []).map(h => {
    const tk = String(h.ticker || "").toUpperCase(), q = Q[tk];
    if (!q || !RV.has(h.asset_class) || !(+h.quantity > 0)) return h;
    if (h.as_of && q.date && q.date < h.as_of) return h;
    return { ...h, value: +(+h.quantity * q.close).toFixed(2), price: q.close, as_of: q.date, source: `cotação ${q.source}`,
             day_change: q.prev_close ? q.close / q.prev_close - 1 : null };
  });
  const have = new Set(out.map(h => String(h.ticker || "").toUpperCase()).filter(Boolean));
  for (const [tk, p] of Object.entries(positionsFromTrades)) {
    if (have.has(tk) || !(+p.quantidade > 0)) continue;
    const q = Q[tk];
    const cls = p.classe || assetClassOf(tk).cls;
    out.push({ id: "pos_" + tk, name: tk, ticker: tk, asset_class: RV.has(cls) ? cls : "outro", custodian: "Negociações importadas",
      quantity: +p.quantidade, invested: +p.custo_total, value: q ? +(+p.quantidade * q.close).toFixed(2) : +p.custo_total,
      price: q?.close ?? null, as_of: q?.date ?? null, source: q ? `negociações + cotação ${q.source}` : "negociações (sem cotação: valor ao custo)",
      day_change: q?.prev_close ? q.close / q.prev_close - 1 : null });
  }
  return out;
}

/* tickers de bolsa que valem cotação: das posições e das negociações */
export function tickersFrom(items) {
  return [...new Set((items || []).map(i => String(i.ticker || "").toUpperCase().replace(/F$/, "")).filter(isB3Ticker))].sort();
}
export { r2 as money2 };
