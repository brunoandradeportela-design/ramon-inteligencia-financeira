/* Painel público de mercado: leitura do provedor, situação do pregão, rótulos atrasado/fechamento e falhas. */
import test from "node:test";
import assert from "node:assert/strict";
import { INSTRUMENTS, instrument, parseQuote, parseHistory, marketStatus, mergeSnapshot, chartUrl, PERIODS } from "../../apps/web/app/js/market_public.js";
import { quote } from "./fake_market.mjs";

const now = Date.now() / 1000;
test("instrumentos identificados por tipo (índice, ação, câmbio)", () => {
  assert.equal(INSTRUMENTS.length, 11);
  assert.equal(instrument("ibov").tipo, "indice"); assert.equal(instrument("PETR4").tipo, "acao"); assert.equal(instrument("USDBRL").tipo, "cambio");
  assert.equal(instrument("XPTO"), null);
  assert.match(chartUrl(null, instrument("IBOV"), "1d", "5m"), /chart\/%5EBVSP\?range=1d&interval=5m$/);
  assert.deepEqual(Object.keys(PERIODS), ["1D", "1S", "1M", "1A", "5A"]);
});
test("cotação: último, anterior, variação, horário, minigráfico e situação", () => {
  const raw = quote("PETR4.SA"), q = parseQuote(raw, instrument("PETR4"), now), meta = raw.chart.result[0].meta;
  assert.equal(q.ultimo, meta.regularMarketPrice); assert.equal(q.anterior, meta.previousClose);
  assert.equal(q.variacao, Math.round((meta.regularMarketPrice - meta.previousClose) * 1e4) / 1e4);
  assert.ok(Math.abs(q.variacao_pct - (meta.regularMarketPrice / meta.previousClose - 1)) < 1e-6);
  assert.equal(q.mercado, "aberto"); assert.equal(q.dado, "atrasado"); assert.ok(q.spark.length <= 49 && q.spark.length > 10);
  assert.equal(q.horario, new Date(meta.regularMarketTime * 1000).toISOString());
  const dji = parseQuote(quote("^DJI"), instrument("DJI"), now);
  assert.equal(dji.mercado, "fechado"); assert.equal(dji.dado, "fechamento"); assert.match(dji.situacao, /último fechamento/);
  const fx = parseQuote(quote("BRL=X"), instrument("USDBRL"), now);
  assert.equal(fx.mercado, "continuo"); assert.equal(fx.dado, "atrasado"); assert.notEqual(fx.dado, "tempo_real");
  assert.throws(() => parseQuote({ chart: { result: null, error: { description: "No data found" } } }, instrument("IBOV")), /No data/);
});
test("situação do pregão pelo período informado", () => {
  const meta = { currentTradingPeriod: { regular: { start: 1000, end: 2000 } } };
  assert.equal(marketStatus(meta, 1500).estado, "aberto"); assert.equal(marketStatus(meta, 2500).estado, "fechado"); assert.equal(marketStatus({}, 1500).estado, "fechado");
});
test("histórico OHLC", () => {
  const h = parseHistory(quote("VALE3.SA", "1mo"));
  assert.equal(h.length, 22); assert.ok(h.every(p => p.h >= p.c && p.l <= p.c));
});
test("falha do provedor: mantém o último válido como desatualizado, ou indisponível; nunca inventa", () => {
  const ok = { ok: true, item: parseQuote(quote("PETR4.SA"), instrument("PETR4"), now) };
  const s1 = mergeSnapshot(null, { PETR4: ok }, "2026-10-08T15:00:00Z");
  assert.equal(s1.items.find(i => i.id === "PETR4").ultimo, ok.item.ultimo);
  assert.equal(s1.items.find(i => i.id === "IBOV").indisponivel, true); assert.equal(s1.items.find(i => i.id === "IBOV").ultimo, null);
  const s2 = mergeSnapshot(s1, { PETR4: { ok: false, error: "HTTP 500" } }, "2026-10-08T15:05:00Z");
  const p = s2.items.find(i => i.id === "PETR4");
  assert.equal(p.desatualizado, true); assert.equal(p.ultimo, ok.item.ultimo); assert.equal(p.atualizado_em, "2026-10-08T15:00:00Z");
  assert.equal(s2.tempo_real, false); assert.equal(s2.ok, 0);
});
