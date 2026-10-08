// Simulador do endpoint de histórico (formato v8/chart) com série determinística por ativo.
import http from "node:http";
export function series(ticker, n = 500) {
  let seed = [...ticker].reduce((s, c) => s + c.charCodeAt(0), 0), px = 20 + (seed % 30);
  const t0 = Date.UTC(2024, 9, 1, 13), ts = [], o = [], h = [], l = [], c = [], v = [];
  for (let i = 0, d = 0; i < n; d++) {
    const date = new Date(t0 + d * 864e5); if ([0, 6].includes(date.getUTCDay())) continue;
    seed = (seed * 1103515245 + 12345) % 2147483648;
    const r = ((seed / 2147483648) - 0.48) * 0.04 + Math.sin(i / 25) * 0.006;
    const open = px, close = +(px * (1 + r)).toFixed(2);
    ts.push(Math.floor(date / 1000)); o.push(open); c.push(close); h.push(+Math.max(open, close, close * 1.01).toFixed(2)); l.push(+Math.min(open, close, close * 0.99).toFixed(2)); v.push(1e6 + (seed % 5e5));
    px = close; i++;
  }
  return { chart: { result: [{ meta: { currency: "BRL", regularMarketPrice: c.at(-1), regularMarketTime: ts.at(-1) }, timestamp: ts, indicators: { quote: [{ open: o, high: h, low: l, close: c, volume: v }] } }], error: null } };
}
/* cotações públicas (login/cadastro 4.0): índices, ações, câmbio, com período de negociação.
   ^DJI simula bolsa fechada; EURBRL=X simula provedor indisponível (HTTP 500). */
export function quote(sym, range = "1d") {
  let seed = [...sym].reduce((s, c) => s + c.charCodeAt(0), 0);
  const base = sym === "^BVSP" ? 130000 : sym === "^GSPC" ? 6500 : sym === "^IXIC" ? 21000 : sym === "^DJI" ? 46000 : sym === "BRL=X" ? 5.4 : sym === "EURBRL=X" ? 6.3 : 20 + (seed % 40);
  const n = { "1d": 78, "5d": 65, "1mo": 22, "1y": 52, "5y": 60 }[range] || 78, stepSec = { "1d": 300, "5d": 1800, "1mo": 86400, "1y": 604800, "5y": 2592000 }[range] || 300;
  const now = Math.floor(Date.now() / 1000), t0 = now - n * stepSec, ts = [], o = [], h = [], l = [], c = [];
  let px = base;
  for (let i = 0; i < n; i++) { seed = (seed * 1103515245 + 12345) % 2147483648; const r = ((seed / 2147483648) - 0.49) * 0.004; const op = px; px = +(px * (1 + r)).toFixed(4);
    ts.push(t0 + i * stepSec); o.push(op); c.push(px); h.push(+(Math.max(op, px) * 1.001).toFixed(4)); l.push(+(Math.min(op, px) * 0.999).toFixed(4)); }
  const closed = sym === "^DJI";
  const period = closed ? { start: now - 86400, end: now - 60000 } : { start: now - 3600, end: now + 3600 };
  return { chart: { result: [{ meta: { currency: sym.endsWith(".SA") || sym === "^BVSP" || sym.includes("BRL") ? "BRL" : "USD", regularMarketPrice: c.at(-1), previousClose: +(base * 0.995).toFixed(4),
    chartPreviousClose: +(base * 0.995).toFixed(4), regularMarketTime: ts.at(-1), currentTradingPeriod: { regular: period } }, timestamp: ts, indicators: { quote: [{ open: o, high: h, low: l, close: c }] } }], error: null } };
}
export function start(port) {
  return new Promise(res => { const s = http.createServer((q, r) => {
    const u = new URL(q.url, "http://x"), m = u.pathname.match(/chart\/([^/]+)$/), sym = m ? decodeURIComponent(m[1]) : null, range = u.searchParams.get("range") || "1d";
    if (sym === "EURBRL=X") { r.writeHead(500, { "Content-Type": "application/json" }); return r.end("{}"); }
    const legacy = sym && /\.SA$/.test(sym) && range === "2y";
    const body = !sym ? { chart: { result: null, error: { description: "No data found" } } } : legacy ? series(sym.replace(/\.SA$/, "")) : quote(sym, range);
    r.writeHead(sym ? 200 : 404, { "Content-Type": "application/json" }); r.end(JSON.stringify(body)); }).listen(port, () => res(s)); });
}
