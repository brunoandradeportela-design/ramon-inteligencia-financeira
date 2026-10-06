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
export function start(port) {
  return new Promise(res => { const s = http.createServer((q, r) => { const m = q.url.match(/chart\/([A-Z0-9]+)\.SA/);
    r.writeHead(m ? 200 : 404, { "Content-Type": "application/json" }); r.end(JSON.stringify(m ? series(m[1]) : { chart: { result: null, error: { description: "No data found" } } })); }).listen(port, () => res(s)); });
}
