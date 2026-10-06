/* Motor de imposto de renda variável sobre as negociações reais do cliente (roda no navegador e na API).
 * Porta em JS do services/tax_engine/engine.py, com as mesmas regras versionadas (BR-IRPF 2026.1):
 *   • operações comuns (ações, ETFs de ações, BDRs): 15%; ações com vendas ≤ R$ 20 mil no mês são isentas;
 *   • day trade: 20%, IRRF de 1% sobre o ganho; FII: 20%, sem isenção;
 *   • prejuízos compensados só dentro da mesma modalidade (comum, day trade, FII);
 *   • IRRF de 0,005% sobre vendas comuns/FII; DARF 6015 vence no último dia útil do mês seguinte;
 *     abaixo de R$ 10 o imposto acumula para o mês seguinte.
 * Funções puras: nada de rede, nada de DOM. Todo valor é ESTIMATIVA. */

import { ruleAt, RULE_VERSIONS } from "./tax_rules.js";
export const ENGINE_VERSION = "tax-engine-js@1.1.0";
/* parâmetros vêm do registro de regras versionadas (tax_rules.js) — o motor não guarda alíquota ou limite próprios */
function buildRules(pick) {
  const c = pick("BR-IRPF-RV-COMUM"), d = pick("BR-IRPF-RV-DAYTRADE"), f = pick("BR-IRPF-FII");
  if (!c || !d || !f) return null;
  const meta = r => ({ version: r.version, title: r.title, sources: r.sources.map(s => s.id), effective_from: r.validity.start });
  return {
    "BR-IRPF-RV-COMUM": { ...meta(c), aliquota: +c.parameters.aliquota, limite_isencao: +c.parameters.limite_isencao_vendas_mes, irrf_venda: +c.parameters.irrf_aliquota_sobre_venda,
      darf_codigo: c.parameters.darf_codigo, darf_minimo: +c.parameters.darf_valor_minimo },
    "BR-IRPF-RV-DAYTRADE": { ...meta(d), aliquota: +d.parameters.aliquota, irrf_ganho: +d.parameters.irrf_aliquota_sobre_ganho },
    "BR-IRPF-FII": { ...meta(f), aliquota: +f.parameters.aliquota, irrf_venda: +f.parameters.irrf_aliquota_sobre_venda },
  };
}
const latest = code => RULE_VERSIONS.filter(r => r.code === code && r.status === "validated").sort((a, b) => b.validity.start.localeCompare(a.validity.start))[0];
export const RULES = buildRules(latest);
export const rulesForYear = year => buildRules(code => ruleAt(code, `${year}-12-31`));
const r2 = v => (Math.round((+v || 0) * 100 + Number.EPSILON) / 100).toFixed(2);
/* formatação pt-BR com 2 casas sem Intl (toLocaleString é caro e o motor roda no limite de CPU do Worker) */
const brn = v => {
  const n = +v, a = Math.abs(n), str = String(a);
  if (!Number.isFinite(n) || /e/i.test(str) || a >= 1e13) return n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const [ip, fp = ""] = str.split("."), f = (fp + "000").slice(0, 3);
  const cents = +ip * 100 + +f.slice(0, 2) + (f[2] >= "5" ? 1 : 0);          // arredondamento "half-expand" sobre a representação decimal, como o Intl
  const i = String(Math.floor(cents / 100)), d = String(cents % 100).padStart(2, "0");
  return (n < 0 || Object.is(n, -0) ? "-" : "") + i.replace(/\B(?=(\d{3})+(?!\d))/g, ".") + "," + d;
};
const cmp = (a, b) => a < b ? -1 : a > b ? 1 : 0;   // ordem de código (datas ISO e chaves ASCII), sem colação ICU

/* ------------------------------------------------------------------ classe do ativo */
const ETF_ACOES = new Set(["BOVA11", "BOVV11", "BOVB11", "BOVX11", "XBOV11", "BRAX11", "IVVB11", "SPXI11", "SPXB11", "SMAL11", "SMAC11", "DIVO11", "ECOO11",
  "FIND11", "GOVE11", "MATB11", "PIBB11", "XINA11", "NASD11", "GOLD11", "ACWI11", "EURP11", "BBSD11", "HASH11", "QBTC11", "ETHE11", "BITH11", "NFTS11",
  "WRLD11", "QETH11", "DEFI11", "META11", "TECK11", "ESGB11", "USAL11", "SHOT11", "BITI11", "CRPT11", "AGRI11", "UTEC11", "NDIV11", "TRIG11", "SMAB11"]);
const ETF_RENDA_FIXA = new Set(["IMAB11", "B5P211", "FIXA11", "IRFM11", "IB5M11", "B5MB11", "IMBB11", "LFTS11", "LFTB11", "NTNS11", "IDKA11", "DEBB11", "IMAX11"]);
const UNITS = new Set(["TAEE11", "SANB11", "KLBN11", "ALUP11", "BPAC11", "ENGI11", "SAPR11", "IGTI11", "BRBI11", "RNEW11", "PPLA11", "AZEV11", "CPLE11",
  "TIET11", "SULA11", "BIDI11", "ITSA11", "CEEB11", "ENMT11", "GPAR11", "MILS11", "STBP11"]);

export function assetClassOf(ticker, known = {}) {
  const t = String(ticker || "").toUpperCase().replace(/F$/, "");
  if (known[t] && ["acao", "fii", "etf", "bdr"].includes(known[t])) return { cls: known[t], inferred: false };
  if (ETF_RENDA_FIXA.has(t)) return { cls: "etf_rf", inferred: false };
  if (ETF_ACOES.has(t)) return { cls: "etf", inferred: false };
  if (UNITS.has(t)) return { cls: "acao", inferred: false };
  if (/^[A-Z]{4}(3[2-5]|39)$/.test(t)) return { cls: "bdr", inferred: false };
  if (/^[A-Z]{4}[3-8]$/.test(t)) return { cls: "acao", inferred: false };
  if (/^[A-Z]{4}1[12]$/.test(t)) return { cls: "fii", inferred: true };
  return { cls: "outro", inferred: true };
}

/* ------------------------------------------------------------------ calendário */
function easter(y) {
  const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  return new Date(Date.UTC(y, Math.floor((h + l - 7 * m + 114) / 31) - 1, ((h + l - 7 * m + 114) % 31) + 1));
}
function holidays(y) {
  const iso = d => d.toISOString().slice(0, 10), e = easter(y), shift = n => iso(new Date(+e + n * 864e5));
  return new Set([`${y}-01-01`, `${y}-04-21`, `${y}-05-01`, `${y}-09-07`, `${y}-10-12`, `${y}-11-02`, `${y}-11-15`, `${y}-11-20`, `${y}-12-25`,
    shift(-48), shift(-47), shift(-2), shift(60)]);   // carnaval (seg/ter), sexta-feira santa, Corpus Christi
}
export function darfDueDate(month) {
  const [y, m] = month.split("-").map(Number);
  const ny = m === 12 ? y + 1 : y, nm = m === 12 ? 1 : m + 1;
  const hol = holidays(ny);
  const d = new Date(Date.UTC(ny, nm, 0));
  while ([0, 6].includes(d.getUTCDay()) || hol.has(d.toISOString().slice(0, 10))) d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

/* ------------------------------------------------------------------ hash reprodutível (FNV-1a 64 bits, sem dependências) */
function fnv(s) {
  let h1 = 0x811c9dc5, h2 = 0x01000193 ^ 0x9e3779b9;
  for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); h1 = Math.imul(h1 ^ c, 16777619) >>> 0; h2 = Math.imul(h2 ^ c, 2246822519) >>> 0; }
  return h1.toString(16).padStart(8, "0") + h2.toString(16).padStart(8, "0");
}
/* mesmo que fnv(s.split("").reverse().join("")), sem alocar o texto invertido */
function fnvRev(s) {
  let h1 = 0x811c9dc5, h2 = 0x01000193 ^ 0x9e3779b9;
  for (let i = s.length - 1; i >= 0; i--) { const c = s.charCodeAt(i); h1 = Math.imul(h1 ^ c, 16777619) >>> 0; h2 = Math.imul(h2 ^ c, 2246822519) >>> 0; }
  return h1.toString(16).padStart(8, "0") + h2.toString(16).padStart(8, "0");
}

/* ------------------------------------------------------------------ cálculo
 * trades: [{ id?, date, ticker, side:"C"|"V", quantity, price, value?, fees?, market?, daytrade?, asset_class?, source? }]
 * opts:   { year, refDate, knownClasses: {TICKER: classe}, priorLosses: {comum, daytrade, fii}, paidDarfs: {"AAAA-MM": valor} } */
export function computeTax(trades, opts = {}) {
  const refDate = opts.refDate || new Date().toISOString().slice(0, 10);
  const year = +(opts.year || refDate.slice(0, 4));
  const prior = opts.priorLosses || {};
  const loss = { comum: +prior.comum || 0, daytrade: +prior.daytrade || 0, fii: +prior.fii || 0 };
  const known = opts.knownClasses || {};
  let R = rulesForYear(year), ruleNote = null;
  if (!R) { R = RULES; ruleNote = `Não há versão de regra validada com vigência em ${year}; usados os parâmetros da versão ${RULES["BR-IRPF-RV-COMUM"].version} como referência.`; }
  const ref = code => ({ code, version: R[code].version, title: R[code].title, sources: R[code].sources });
  const C = R["BR-IRPF-RV-COMUM"], DT = R["BR-IRPF-RV-DAYTRADE"], F = R["BR-IRPF-FII"];

  const skipped = { fora_escopo: 0, futuro: 0 };
  const rows = [];
  for (const t of trades || []) {
    const market = String(t.market || "").toLowerCase();
    if (/opc|termo|futur|exerc/.test(market)) { skipped.fora_escopo++; continue; }
    if (!t.date || t.date > refDate) { skipped.futuro++; continue; }
    const ticker = String(t.ticker || "").toUpperCase().replace(/F$/, "");
    const { cls, inferred } = assetClassOf(ticker, t.asset_class ? { [ticker]: t.asset_class } : known);
    if (!["acao", "etf", "bdr", "fii"].includes(cls)) { skipped.fora_escopo++; continue; }
    const q = +t.quantity, gross = +t.value || q * +t.price;
    if (!(q > 0) || !(gross > 0)) continue;
    rows.push({ ...t, ticker, cls, inferred, q, gross, fees: +t.fees || 0 });
  }
  rows.sort((a, b) => cmp(a.date, b.date) || (a.side === b.side ? 0 : a.side === "C" ? -1 : 1));

  // agrupa por dia+ativo: compra e venda no mesmo dia formam day trade (a quantidade casada); o excedente é operação comum
  const days = new Map();
  rows.forEach(r => { const k = r.date + "|" + r.ticker; if (!days.has(k)) days.set(k, []); days.get(k).push(r); });

  const pos = {};                 // preço médio: { qty, cost, cls }
  const events = [];
  const per = {};
  const M = mk => per[mk] || (per[mk] = { sales_acoes: 0, acoes: 0, etf: 0, daytrade: 0, fii: 0, irrf_venda: 0, irrf_dt: 0, conf: 1 });
  const issues = new Set();

  for (const [, g] of [...days.entries()].sort((a, b) => cmp(a[0], b[0]))) {
    const { date, ticker, cls, inferred } = g[0];
    const mk = date.slice(0, 7), inYear = +date.slice(0, 4) === year;
    const buys = g.filter(r => r.side === "C"), sells = g.filter(r => r.side === "V");
    const qb = buys.reduce((s, r) => s + r.q, 0), qs = sells.reduce((s, r) => s + r.q, 0);
    const buyCost = buys.reduce((s, r) => s + r.gross + r.fees, 0), sellNet = sells.reduce((s, r) => s + r.gross - r.fees, 0);
    const sellGross = sells.reduce((s, r) => s + r.gross, 0);
    const forcedDT = g.some(r => r.daytrade === true);
    const dq = (qb && qs) ? Math.min(qb, qs) : 0;
    const p = pos[ticker] || (pos[ticker] = { qty: 0, cost: 0, cls });
    p.cls = cls;
    const src = g[0].source || "importação";

    if (dq > 0) {
      const dtCost = buyCost * dq / qb, dtSale = sellNet * dq / qs, result = dtSale - dtCost;
      if (inYear) {
        const m = M(mk); m.daytrade += result;
        if (result > 0) m.irrf_dt += result * DT.irrf_ganho;
        events.push({ id: `dt_${date}_${ticker}`, date, ticker, asset_class: cls, modality: "daytrade", kind: "daytrade",
          sale_value: r2(sellGross * dq / qs), cost_basis: r2(dtCost), result: r2(result), rule: ref("BR-IRPF-RV-DAYTRADE"), confidence: forcedDT ? 1 : 0.9,
          status: "calculado", source: src,
          notes: [`Compra e venda de ${dq} no mesmo dia${forcedDT ? " (marcado na nota)" : " — identificado pelas datas"}.`, ...(qb !== qs ? [`Excedente de ${Math.abs(qb - qs)} tratado como operação comum.`] : [])] });
      }
    }
    // excedente de compras entra no preço médio
    if (qb > dq) { p.qty += qb - dq; p.cost += buyCost * (qb - dq) / qb; }
    // excedente de vendas é operação comum (swing) contra o preço médio
    const sq = qs - dq;
    if (sq > 0) {
      const sale = sellNet * sq / qs, saleGross = sellGross * sq / qs;
      const modality = cls === "fii" ? "fii" : "comum";
      const code = modality === "fii" ? "BR-IRPF-FII" : "BR-IRPF-RV-COMUM";
      if (!inYear) {                        // ano anterior: só atualiza a posição
        const avg = p.qty ? p.cost / p.qty : 0, out = Math.min(sq, p.qty);
        p.qty -= out; p.cost -= avg * out; if (p.qty <= 1e-9) { p.qty = 0; p.cost = 0; }
        continue;
      }
      const m = M(mk);
      m.irrf_venda += saleGross * (modality === "fii" ? F.irrf_venda : C.irrf_venda);
      if (cls === "acao") m.sales_acoes += saleGross;
      if (p.qty + 1e-9 < sq) {
        m.conf = Math.min(m.conf, 0.55);
        issues.add("sem_custo");
        events.push({ id: `sw_${date}_${ticker}`, date, ticker, asset_class: cls, modality, kind: "dado_incompleto", sale_value: r2(saleGross),
          cost_basis: "?", result: "?", rule: ref(code), confidence: 0.3, status: "pendente_dado", source: src,
          notes: [`Venda de ${sq} sem compras suficientes registradas (posição conhecida: ${+p.qty.toFixed(6)}).`,
                  "Importe as negociações desde a primeira compra deste ativo (B3 › Extratos › Negociação, período desde 2019) ou a nota de corretagem."] });
        p.qty = 0; p.cost = 0;
        continue;
      }
      const avg = p.cost / p.qty, cost = avg * sq, result = sale - cost;
      p.qty -= sq; p.cost -= cost; if (p.qty <= 1e-9) { p.qty = 0; p.cost = 0; }
      m[modality === "fii" ? "fii" : cls === "acao" ? "acoes" : "etf"] += result;
      if (inferred) { m.conf = Math.min(m.conf, 0.8); issues.add("classe"); }
      events.push({ id: `sw_${date}_${ticker}`, date, ticker, asset_class: cls, modality, kind: "venda", sale_value: r2(saleGross),
        cost_basis: r2(cost), result: r2(result), rule: ref(code), confidence: inferred ? 0.8 : 1, status: "calculado", source: src,
        notes: [`Preço médio R$ ${brn(avg)} × ${sq}${g.some(r => r.fees) ? " · custos da nota descontados da venda" : ""}`,
                ...(inferred ? [`Classe ${cls === "fii" ? "FII" : cls} inferida pelo código — confira.`] : [])] });
    }
  }

  // ---------------------------------------------------------------- apuração mensal
  const months = [];
  let carrySmall = 0, irrfCredit = 0, totalDue = 0, totalIrrf = 0, totalExempt = 0;
  const paid = opts.paidDarfs || {};
  const apply = (result, bucket) => {
    if (result <= 0) { loss[bucket] += -result; return 0; }
    const used = Math.min(loss[bucket], result); loss[bucket] -= used; return result - used;
  };
  for (const mk of Object.keys(per).sort()) {
    const m = per[mk];
    const exempt = m.sales_acoes <= C.limite_isencao;
    let exemptGain = 0, acoesTaxable = m.acoes;
    if (exempt && m.acoes > 0) { exemptGain = m.acoes; acoesTaxable = 0; }
    const resComum = acoesTaxable + m.etf;
    const bC = apply(resComum, "comum"), bD = apply(m.daytrade, "daytrade"), bF = apply(m.fii, "fii");
    const tC = bC * C.aliquota, tD = bD * DT.aliquota, tF = bF * F.aliquota, gross = tC + tD + tF;
    const irrf = m.irrf_venda + m.irrf_dt, avail = irrf + irrfCredit, usedIrrf = Math.min(avail, gross);
    irrfCredit = avail - usedIrrf;
    const due = gross - usedIrrf + carrySmall;
    let darf = null, carryIn;
    if (due >= C.darf_minimo) {
      const venc = darfDueDate(mk), pv = paid[mk];
      darf = { codigo: C.darf_codigo, competencia: mk, valor: r2(due), vencimento: venc,
        status: pv != null ? "pago" : venc < refDate ? "vencido" : "aberto",
        dias_para_vencimento: Math.round((Date.parse(venc) - Date.parse(refDate)) / 864e5),
        valor_pago: pv != null ? r2(pv) : null, tipo_valor: pv != null ? "efetivamente_pago" : "estimativa" };
      carryIn = carrySmall; carrySmall = 0; totalDue += due;
    } else { carryIn = carrySmall; carrySmall = due; }
    totalIrrf += irrf; totalExempt += exemptGain;
    months.push({ month: mk, sales_acoes: r2(m.sales_acoes), exempt, result_comum: r2(resComum), result_acoes: r2(m.acoes),
      result_daytrade: r2(m.daytrade), result_fii: r2(m.fii), exempt_gain: r2(exemptGain), base_comum: r2(bC), base_daytrade: r2(bD), base_fii: r2(bF),
      tax_comum: r2(tC), tax_daytrade: r2(tD), tax_fii: r2(tF), irrf: r2(irrf), tax_due_gross: r2(gross), carry_in: r2(carryIn),
      tax_due: darf ? r2(due) : "0.00", darf, loss_carry: { comum: r2(loss.comum), daytrade: r2(loss.daytrade), fii: r2(loss.fii) },
      confidence: m.conf, rules: [ref("BR-IRPF-RV-COMUM"), ref("BR-IRPF-RV-DAYTRADE"), ref("BR-IRPF-FII")] });
    if (exempt && m.acoes > 0) events.filter(e => e.date.startsWith(mk) && e.asset_class === "acao" && e.kind === "venda").forEach(e => {
      e.status = "isento"; e.notes.push(`Vendas de ações no mês: R$ ${brn(m.sales_acoes)} ≤ limite de R$ 20.000,00.`);
    });
  }

  const positions = Object.fromEntries(Object.entries(pos).filter(([, v]) => v.qty > 1e-9).map(([k, v]) =>
    [k, { quantidade: String(+v.qty.toFixed(6)), custo_total: r2(v.cost), preco_medio: r2(v.cost / v.qty), classe: v.cls }]));
  const confidence = Math.round(Math.min(ruleNote ? 0.5 : 1, ...months.map(x => x.confidence)) * 100) / 100;
  /* qualidade do cálculo (v5.0 §7.5): o que reduz a confiança e o que fazer para elevar — não é garantia jurídica */
  const sells = events.filter(e => e.kind !== "daytrade").length;
  const quality = { score: rows.length ? confidence : 0, factors: [
    { factor: "Custo de aquisição", ok: !issues.has("sem_custo"), detail: issues.has("sem_custo") ? `${events.filter(e => e.status === "pendente_dado").length} de ${sells} venda(s) sem compras registradas.` : "Todas as vendas têm custo pelas negociações importadas.",
      improve: issues.has("sem_custo") ? "Importe o relatório de Negociação da B3 desde a primeira compra." : null },
    { factor: "Classe dos ativos", ok: !issues.has("classe"), detail: issues.has("classe") ? "Algumas classes foram inferidas pelo código." : "Classes confirmadas pela posição ou por lista conhecida.",
      improve: issues.has("classe") ? "Importe a posição da B3 para confirmar ações, FIIs e ETFs." : null },
    { factor: "Versão da regra", ok: !ruleNote, detail: ruleNote || `Regras com vigência no ano (${Object.values(R).map(r => r.version).join(", ")}).`, improve: ruleNote ? "Aguardar a versão validada da regra para o ano." : null },
    { factor: "Escopo", ok: !skipped.fora_escopo, detail: skipped.fora_escopo ? `${skipped.fora_escopo} operação(ões) fora do escopo do motor.` : "Todas as operações estão no escopo do motor.",
      improve: skipped.fora_escopo ? "Opções, termo, futuros e ETFs de renda fixa exigem apuração com seu contador." : null },
  ], note: "Qualidade e completude dos dados e do processamento; não representa garantia jurídica ou fiscal." };
  const limitations = [
    "Estimativa: não substitui a apuração oficial nem a revisão de um contador.",
    "Não cobre opções, termo, futuros, aluguel de ações, ETFs de renda fixa, proventos e eventos corporativos (desdobramentos, grupamentos, bonificações, subscrições).",
    "Operações de anos anteriores entram apenas para formar o preço médio.",
  ];
  if (issues.has("sem_custo")) limitations.unshift("Há vendas sem o histórico de compras: o resultado desses meses fica incompleto até você importar as negociações anteriores.");
  if (issues.has("classe")) limitations.push("Alguns ativos tiveram a classe (ação, FII, ETF) inferida pelo código; importe a posição da B3 para confirmar.");
  if (skipped.fora_escopo) limitations.push(`${skipped.fora_escopo} operação(ões) fora do escopo foram ignoradas (derivativos, renda fixa ou ativos não reconhecidos).`);
  if (ruleNote) limitations.unshift(ruleNote);
  const snapshot = JSON.stringify({ engine: ENGINE_VERSION, year, refDate, prior, paid, rules: Object.fromEntries(Object.entries(R).map(([k, v]) => [k, v.version])),
    trades: rows.map(r => [r.date, r.ticker, r.cls, r.side, r.q, r2(r.gross), r2(r.fees), !!r.daytrade]) });
  return {
    has_data: rows.length > 0, year, reference_date: refDate, months, events: events.sort((a, b) => b.date.localeCompare(a.date)),
    total_tax_due: r2(totalDue), total_irrf: r2(totalIrrf), total_exempt_gain: r2(totalExempt),
    losses_available: { comum: r2(loss.comum), daytrade: r2(loss.daytrade), fii: r2(loss.fii) },
    positions_cost: positions, confidence: rows.length ? confidence : 0,
    premises: [
      "Calculado sobre as negociações que você importou (B3 ou notas de corretagem).",
      "Custo de aquisição pelo preço médio ponderado; custos da nota somados à compra e descontados da venda.",
      "Day trade: compra e venda do mesmo ativo no mesmo dia (quantidade casada); o excedente é operação comum. O limite de R$ 20 mil considera as vendas comuns de ações.",
      "Vencimento do DARF 6015: último dia útil do mês seguinte, considerando feriados nacionais.",
      `Prejuízos de anos anteriores informados: ${Object.entries(prior).filter(([, v]) => +v > 0).map(([k, v]) => `${k} R$ ${brn(v)}`).join(", ") || "nenhum"}.`,
    ],
    limitations, rule_versions: Object.fromEntries(Object.entries(R).map(([k, v]) => [k, v.version])), engine_version: ENGINE_VERSION, quality,
    snapshot_hash: fnv(snapshot) + fnvRev(snapshot), kind: "estimativa",
  };
}

/* resumo para o painel inicial */
export function taxDashboard(t) {
  return { year: t.year, estimated: t.total_tax_due, irrf: t.total_irrf, exempt: t.total_exempt_gain,
    monthly: t.months.map(m => ({ month: m.month, value: m.tax_due })), confidence: t.confidence, kind: "estimativa",
    scope: t.has_data ? "renda variável (bolsa) · suas negociações" : "aguardando negociações para apurar",
    next_darf: t.months.map(m => m.darf).filter(d => d && d.status !== "pago").sort((a, b) => a.vencimento.localeCompare(b.vencimento))[0] || null };
}
