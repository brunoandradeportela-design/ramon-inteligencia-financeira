/* Tours das abas do Trader e das páginas do administrador (CRM, Pagamentos, Operações). */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as W from "../../apps/web/app/js/tour_explain4.js";
import * as A from "../../apps/web/app/js/tour_admin.js";
import { stepsTraderAba, ABAS_COM_TOUR } from "../../apps/web/app/js/tour_trader.js";

test("mercado: médias, IFR e volatilidade com os valores do snapshot", () => {
  const m = { ticker: "PETR4", provider: "Yahoo", fetched_at: "2026-10-14T20:00:00Z", candles: [{}, {}],
    snapshot: { last: 38.12, date: "2026-10-14", change: 0.0123, sma20: 37.5, sma50: 36.9, rsi14: 71.4, volatility_annual: 0.28, high_52w: 42, low_52w: 30 } };
  const s = W.mercadoIndicadores(m);
  for (const x of ["R$ 38,12", "14/10/2026", "+1,23%", "R$ 37,50", "R$ 36,90", "acima da de 50", "IFR(14) = 71", "acima de 70", "28%", "R$ 30,00 a R$ 42,00"]) assert.ok(s.includes(x), x);
  assert.match(W.mercadoFonte(m), /2 pregões diários de Yahoo.*não tempo real/);
  assert.match(W.mercadoIndicadores({}), /indisponível/);
});
test("desempenho: payoff = ganho médio ÷ perda média; expectativa por operação", () => {
  const a = { has_data: true, totals: { gross_pnl: "1000", costs: "50", net_pnl: "950", tax_estimate: "142.5", after_tax: "807.5" }, payoff: 1.8, avg_win: "300", avg_loss: "166.67", expectancy: "118.75", streaks: { max_wins: 3, max_losses: 2 } };
  const s = W.performance(a);
  for (const x of ["R$ 1.000,00", "R$ 50,00", "R$ 950,00", "R$ 807,50", "1,80", "R$ 300,00", "R$ 166,67", "R$ 118,75", "3 ganhos e 2 perdas"]) assert.ok(s.includes(x), x);
  assert.match(W.performance({ has_data: false }), /Sem operações/);
});
test("risco: VaR 95% de 1 dia = valor × vol ÷ √252 × 1,645", () => {
  const value = 10000, vol = 0.3, v = Math.round(value * vol / Math.sqrt(252) * 1.645 * 100) / 100;
  const s = W.risco({ exposure_total: "10000", concentration: { largest: "VALE3", largest_weight: 1, hhi: 1 }, portfolio_var95_1d_sum: v, exposure: [{ ticker: "VALE3", value, var95_1d: v }] });
  assert.match(s, /√252 × 1,645/); assert.ok(s.includes(v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })));
  assert.match(s, /95% dos dias/);
});
test("imposto por operação, journal, paper e radar", () => {
  const t = { total_tax_due: "300", losses_available: { comum: "100", daytrade: "0" }, per_trade: [{ tax_estimate: "30", tax_rate: 0.15, net_pnl: "200" }, { tax_estimate: "0", tax_rate: 0, net_pnl: "500" }] };
  const s = W.impostos(t); assert.match(s, /R\$ 300,00/); assert.match(s, /R\$ 100,00/); assert.match(s, /1 operação gerou imposto e 1 teve lucro isento/);
  assert.match(W.journal({ j: { items: [{ tags: ["plano"] }, { tags: ["plano", "ansiedade"] }] } }), /2 registros.*plano \(2\)/);
  assert.match(W.paper({ items: [{}], analytics: { totals: { trades: 1, net_pnl: "50" }, win_rate: 1 } }), /1 registro simulado, 1 operação fechada.*R\$ 50,00.*100%/);
  assert.match(W.radarTrader({ items: [{ severity: "alto", title: "Perto do limite de isenção" }] }), /1 ponto de atenção.*1 alto.*Perto do limite/);
});
test("CRM, pagamentos e operações: fórmulas do motor", () => {
  const m = { total: 10, paying: 4, conversion: 0.4, activation: 0.7, mrr: "359.60", arr: "4315.20", ticket_medio: "89.90", ticket_target: "80.00", ticket_ok: true, overdue: 1, overdue_value: "89.90", stages: [{ label: "Pagante", count: 4 }] };
  const s = A.crmKpis(m);
  for (const x of ["10 clientes", "40%", "70%", "R$ 359,60", "R$ 4.315,20", "R$ 89,90", "acima da meta de R$ 80,00"]) assert.ok(s.includes(x), x);
  assert.ok(Math.abs(+m.mrr * 12 - +m.arr) < 0.01 && Math.abs(+m.mrr / m.paying - +m.ticket_medio) < 0.01, "ARR = MRR×12 e ticket = MRR÷pagantes");
  assert.match(A.pagamentosKpis({ totals: { recebido: "179.80", recebido_liquido: "170.00", pendente: "89.90", atrasado: "0", estornado: "0", sem_vinculo: 1, count: { pago: 2, atrasado: 0 } } }), /R\$ 179,80 em 2 cobranças.*1 cobrança está sem vínculo/);
  const o = A.opsKpis({ requests: 2000, window_hours: 24, availability: 0.999, p95_ms: 180, slo: { availability_target: 0.995, p95_target_ms: 500, availability_ok: true }, security: { login_failures: 3 } });
  assert.match(o, /99,9%.*meta 99,5%: cumprida/); assert.match(o, /≤ 180 ms/); assert.match(o, /meta 500 ms/);
});
test("catálogos: todas as abas do Trader e as 3 páginas do administrador", () => {
  assert.equal(ABAS_COM_TOUR.length, 13);
  for (const fn of [...ABAS_COM_TOUR.map(t => () => stepsTraderAba(t)), A.stepsCrm, A.stepsPagamentos, A.stepsOperacoes]) {
    const st = fn(); assert.ok(st.length >= 2); assert.equal(new Set(st.map(s => s.id)).size, st.length);
    for (const s of st) assert.ok(s.titulo && s.porque && s.faz && s.representa, s.id);
  }
});
