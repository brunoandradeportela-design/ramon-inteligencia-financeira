/* Extração e validação de documentos (RF-018): nota de corretagem (padrão SINACOR), comprovante de DARF,
 * informe de rendimentos e recibo. Roda no navegador (sobre o texto que o pdf.js lê do PDF) e na API, que
 * revalida tudo antes de gravar — o servidor nunca confia no que veio pronto do navegador.
 * Nada é importado sem a confirmação do cliente; cada campo traz a regra de validação que passou ou falhou. */
export const EXTRACTOR_VERSION = "doc-extract@1.0.0";

/* ------------------------------------------------------------------ utilidades */
const deaccent = s => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "");
const U = s => deaccent(s).toUpperCase();
export const brNum = s => { if (s == null) return null; const t = String(s).trim().replace(/\s/g, ""); if (!/^-?[\d.]*\d(,\d+)?$/.test(t)) return null; return +t.replace(/\./g, "").replace(",", "."); };
const r2 = v => Math.round((+v || 0) * 100) / 100;
const isoFromBr = s => { const m = String(s || "").match(/(\d{2})\/(\d{2})\/(\d{4})/); return m ? `${m[3]}-${m[2]}-${m[1]}` : null; };
const digits = s => String(s || "").replace(/\D/g, "");
export function cnpjValid(c) {
  const d = digits(c); if (d.length !== 14 || /^(\d)\1+$/.test(d)) return false;
  const calc = n => { let s = 0, w = n - 7; for (let i = 0; i < n; i++) { s += +d[i] * w--; if (w < 2) w = 9; } const r = s % 11; return r < 2 ? 0 : 11 - r; };
  return calc(12) === +d[12] && calc(13) === +d[13];
}
export function cpfValid(c) {
  const d = digits(c); if (d.length !== 11 || /^(\d)\1+$/.test(d)) return false;
  const calc = n => { let s = 0; for (let i = 0; i < n; i++) s += +d[i] * (n + 1 - i); const r = (s * 10) % 11; return r === 10 ? 0 : r; };
  return calc(9) === +d[9] && calc(10) === +d[10];
}
const MONEY = /(-?\d{1,3}(?:\.\d{3})*,\d{2})/;
/* valor monetário logo depois do rótulo (o primeiro, porque o pdf.js junta as duas colunas do resumo na mesma linha);
 * { last: true } pega o último — ex.: "I.R.R.F. s/ operações, base R$ 300,00   0,01" */
const moneyAfter = (lines, rx, { last = false } = {}) => {
  for (const l of lines) {
    const u = U(l), m0 = u.match(rx); if (!m0) continue;
    const rest = u.slice(m0.index + m0[0].length), all = [...rest.matchAll(new RegExp(MONEY.source + "(?:\\s*([DC])\\b)?", "g"))];
    if (!all.length) continue;
    const m = last ? all[all.length - 1] : all[0];
    return { value: brNum(m[1]), dc: m[2] || null, line: l.trim() };
  }
  return null;
};

/* ------------------------------------------------------------------ tipo do documento */
export function detectDocType(text) {
  const t = U(text);
  if (/NOTA DE CORRETAGEM|NEGOCIOS REALIZADOS/.test(t)) return "nota_corretagem";
  if (/DOCUMENTO DE ARRECADACAO DE RECEITAS FEDERAIS|COMPROVANTE DE (PAGAMENTO|ARRECADACAO)/.test(t) && /DARF|RECEITAS FEDERAIS|CODIGO DA RECEITA|6015/.test(t)) return "darf";
  if (/INFORME DE RENDIMENTOS|COMPROVANTE DE RENDIMENTOS PAGOS|INFORME DE RENDIMENTOS FINANCEIROS/.test(t)) return "informe_rendimentos";
  if (/RECIBO/.test(t) && /(CPF|CNPJ)/.test(t)) return "recibo";
  return null;
}

/* ------------------------------------------------------------------ ativo pelo nome de pregão (nota não traz o código) */
const SEG = new Set(["N1", "N2", "NM", "MA", "MB", "ED", "EJ", "EDJ", "ER", "EX", "ATZ", "EDB", "#", "@", "ES", "EB"]);
export const normTitle = s => U(s).replace(/[#@*]/g, " ").split(/\s+/).filter(w => w && !SEG.has(w)).join(" ");
/* mapa interno curto (nomes de pregão mais negociados); sempre marcado para conferência */
const NAME_MAP = {
  "PETROBRAS PN": "PETR4", "PETROBRAS ON": "PETR3", "VALE ON": "VALE3", "ITAUUNIBANCO PN": "ITUB4", "ITAUUNIBANCO ON": "ITUB3", "BRADESCO PN": "BBDC4", "BRADESCO ON": "BBDC3",
  "BRASIL ON": "BBAS3", "B3 ON": "B3SA3", "AMBEV S/A ON": "ABEV3", "WEG ON": "WEGE3", "MAGAZ LUIZA ON": "MGLU3", "ITAUSA PN": "ITSA4", "ITAUSA ON": "ITSA3", "PRIO ON": "PRIO3",
  "PETRORIO ON": "PRIO3", "SUZANO S.A. ON": "SUZB3", "SUZANO SA ON": "SUZB3", "GERDAU PN": "GGBR4", "LOCALIZA ON": "RENT3", "BBSEGURIDADE ON": "BBSE3", "ELETROBRAS ON": "ELET3",
  "ELETROBRAS PNB": "ELET6", "SANTANDER BR UNT": "SANB11", "BTGP BANCO UNT": "BPAC11", "TAESA UNT": "TAEE11", "KLABIN S/A UNT": "KLBN11", "RAIADROGASIL ON": "RADL3",
  "JBS ON": "JBSS3", "EMBRAER ON": "EMBR3", "CEMIG PN": "CMIG4", "SABESP ON": "SBSP3", "VIBRA ON": "VBBR3", "RUMO S.A. ON": "RAIL3", "HAPVIDA ON": "HAPV3", "SID NACIONAL ON": "CSNA3",
  "USIMINAS PNA": "USIM5", "MRV ON": "MRVE3", "CYRELA REALT ON": "CYRE3", "TIM ON": "TIMS3", "TELEF BRASIL ON": "VIVT3", "EQUATORIAL ON": "EQTL3", "ENGIE BRASIL ON": "EGIE3",
  "CPFL ENERGIA ON": "CPFE3", "ULTRAPAR ON": "UGPA3", "COSAN ON": "CSAN3", "BRADESPAR PN": "BRAP4", "ISHARE BOVA CI": "BOVA11", "ISHARE SMAL CI": "SMAL11", "IT NOW IVVB CI": "IVVB11",
  "ISHARE IVVB CI": "IVVB11",
};
export function resolveTicker(title, userMap = {}) {
  const raw = U(title), code = raw.match(/\b([A-Z]{4}\d{1,2})F?\b/);
  if (code) return { ticker: code[1], how: "codigo_na_nota", confidence: 1 };
  const k = normTitle(title);
  if (userMap[k]) return { ticker: userMap[k], how: "mapa_do_cliente", confidence: 1 };
  if (NAME_MAP[k]) return { ticker: NAME_MAP[k], how: "mapa_interno", confidence: 0.85 };
  return { ticker: null, how: "nao_identificado", confidence: 0 };
}
const classOf = (title, ticker) => /\bFII\b|\bCI\b/.test(U(title)) && !/^(BOVA|SMAL|IVVB|HASH|DIVO)/.test(ticker || "") ? "fii" : /\bCI\b/.test(U(title)) ? "etf" : /\bDR[1-3]\b|\bBDR\b/.test(U(title)) ? "bdr" : "acao";

/* ------------------------------------------------------------------ nota de corretagem (SINACOR) */
const NEG = /^\s*(?:\d-BOVESPA|B3 RV LISTADO|BOVESPA)\s+([CV])\s+(VISTA|FRACIONARIO|OPCAO DE COMPRA|OPCAO DE VENDA|EXERC OPC COMPRA|EXERC OPC VENDA|TERMO|LEILAO)\s+(.+?)\s+(\d[\d.]*)\s+(\d[\d.]*,\d{2,8})\s+(\d[\d.]*,\d{2})\s+([DC])\s*$/;
export function parseNota(lines, { userMap = {} } = {}) {
  const L = lines.map(l => String(l).replace(/\s+/g, " ").trim()).filter(Boolean), T = U(L.join("\n"));
  const header = { numero: null, data_pregao: null, corretora: null, cnpj: null };
  for (let i = 0; i < L.length; i++) {
    const u = U(L[i]);
    if (!header.numero && /NR\.? ?NOTA/.test(u)) { const nxt = (L[i + 1] || "") + " " + L[i]; const m = nxt.match(/\b(\d{3,12})\s+\d{1,3}\s+(\d{2}\/\d{2}\/\d{4})/); if (m) { header.numero = m[1]; header.data_pregao = isoFromBr(m[2]); } }
    if (!header.data_pregao && /DATA PREGAO/.test(u)) { const m = (L[i] + " " + (L[i + 1] || "")).match(/(\d{2}\/\d{2}\/\d{4})/); if (m) header.data_pregao = isoFromBr(m[1]); }
    if (!header.corretora && /(CCTVM|CTVM|DTVM|CORRETORA)/.test(u) && !/CLIENTE/.test(u)) header.corretora = L[i].replace(/\s+CNPJ.*$/i, "").slice(0, 80);
    if (!header.cnpj) { const m = L[i].match(/\b(\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2})\b/); if (m && /CNPJ/.test(u) && !/CLIENTE/.test(u)) header.cnpj = m[1]; }
  }
  const negocios = [];
  for (const l of L) {
    const m = U(l).match(NEG); if (!m) continue;
    let title = m[3].trim(); const flags = [];
    title = title.replace(/\s+([#DTI@]{1,2})$/, (_, f) => { flags.push(f); return ""; });
    const qty = brNum(m[4]), price = brNum(m[5]), value = brNum(m[6]);
    const res = resolveTicker(title, userMap);
    negocios.push({ side: m[1], mercado: m[2], titulo: title, quantidade: qty, preco: price, valor: value, dc: m[7], daytrade: flags.some(f => f.includes("D")),
      ticker: res.ticker, ticker_origem: res.how, ticker_confianca: res.confidence, classe: classOf(title, res.ticker) });
  }
  const pick = rx => moneyAfter(L, rx);
  const resumo = {
    vendas_a_vista: pick(/VENDAS A VISTA/)?.value ?? null, compras_a_vista: pick(/COMPRAS A VISTA/)?.value ?? null, valor_operacoes: pick(/VALOR DAS OPERACOES/)?.value ?? null,
    valor_liquido_operacoes: pick(/VALOR LIQUIDO DAS OPERACOES/) || null, taxa_liquidacao: pick(/TAXA DE LIQUIDACAO/)?.value ?? 0, taxa_registro: pick(/TAXA DE REGISTRO/)?.value ?? 0,
    taxa_termo_opcoes: pick(/TAXA DE TERMO/)?.value ?? 0, taxa_ana: pick(/TAXA A\.?N\.?A/)?.value ?? 0, emolumentos: pick(/EMOLUMENTOS/)?.value ?? 0,
    taxa_operacional: pick(/TAXA OPERACIONAL|CORRETAGEM/)?.value ?? 0, execucao: pick(/^EXECUCAO|\bEXECUCAO\b/)?.value ?? 0, custodia: pick(/TAXA DE CUSTODIA/)?.value ?? 0,
    impostos: pick(/IMPOSTOS|\bISS\b/)?.value ?? 0, irrf: moneyAfter(L, /I\.?R\.?R\.?F\.? S\/ OPERACOES|IRRF S\/ OPERACOES/, { last: true })?.value ?? 0, outros: pick(/^OUTROS\b/)?.value ?? 0,
    liquido: pick(/LIQUIDO PARA/) || null, irrf_day_trade: pick(/IRRF DAY ?TRADE|I\.R\.R\.F\. DAY TRADE/)?.value ?? 0,
  };
  return { type: "nota_corretagem", header, negocios, resumo, extractor: EXTRACTOR_VERSION, has_text: T.length > 0 };
}
export const notaCosts = r => r2([r.taxa_liquidacao, r.taxa_registro, r.taxa_termo_opcoes, r.taxa_ana, r.emolumentos, r.taxa_operacional, r.execucao, r.custodia, r.impostos, r.outros].reduce((s, v) => s + (+v || 0), 0));

/* ------------------------------------------------------------------ DARF, informe, recibo */
export function parseDarf(lines) {
  const L = lines.map(l => String(l).replace(/\s+/g, " ").trim()).filter(Boolean), T = U(L.join("\n"));
  const codigo = (T.match(/CODIGO D[AE] RECEITA\D{0,20}(\d{4})/) || T.match(/\b(6015|0190|4600)\b/) || [])[1] || null;
  const pa = (T.match(/PERIODO DE APURACAO\D{0,20}(\d{2}\/\d{2}\/\d{4})/) || [])[1] || null;
  const venc = (T.match(/(?:DATA DE )?VENCIMENTO\D{0,20}(\d{2}\/\d{2}\/\d{4})/) || [])[1] || null;
  const pago = (T.match(/(?:DATA DE )?(?:ARRECADACAO|PAGAMENTO)\D{0,20}(\d{2}\/\d{2}\/\d{4})/) || [])[1] || null;
  const total = moneyAfter(L, /VALOR TOTAL|TOTAL A RECOLHER|VALOR PAGO/)?.value ?? null;
  const principal = moneyAfter(L, /VALOR DO PRINCIPAL|PRINCIPAL/)?.value ?? null;
  const cpf = (L.join(" ").match(/\b(\d{3}\.\d{3}\.\d{3}-\d{2})\b/) || [])[1] || null;
  const paIso = isoFromBr(pa);
  return { type: "darf", codigo, periodo_apuracao: paIso, competencia: paIso ? paIso.slice(0, 7) : null, vencimento: isoFromBr(venc), data_pagamento: isoFromBr(pago),
    valor_principal: principal, valor_total: total, contribuinte_cpf_final: cpf ? cpf.slice(-6) : null, extractor: EXTRACTOR_VERSION };
}
const INF = [["rendimentos_tributaveis", /TOTAL DOS RENDIMENTOS|RENDIMENTOS TRIBUTAVEIS/], ["previdencia_oficial", /CONTRIBUICAO PREVIDENCIARIA OFICIAL/], ["irrf", /IMPOSTO (SOBRE A RENDA )?RETIDO|IRRF/],
  ["decimo_terceiro", /13.? ?SALARIO|DECIMO TERCEIRO/], ["rendimentos_isentos", /RENDIMENTOS ISENTOS/], ["tributacao_exclusiva", /TRIBUTACAO EXCLUSIVA|RENDIMENTOS SUJEITOS A TRIBUTACAO EXCLUSIVA/],
  ["saldo_final", /SALDO EM 31\/12\/\d{4}|POSICAO EM 31\/12\/\d{4}/]];
export function parseInforme(lines) {
  const L = lines.map(l => String(l).replace(/\s+/g, " ").trim()).filter(Boolean), J = L.join("\n");
  const cnpjs = [...J.matchAll(/\b(\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2})\b/g)].map(m => m[1]);
  const ano = (U(J).match(/ANO[- ]CALENDARIO\D{0,10}(\d{4})/) || [])[1] || null;
  const fonteIdx = L.findIndex(l => /FONTE PAGADORA|INSTITUICAO|EMPRESA/.test(U(l)));
  const valores = Object.fromEntries(INF.map(([k, rx]) => [k, moneyAfter(L, rx)?.value ?? null]));
  return { type: "informe_rendimentos", ano_calendario: ano ? +ano : null, fonte_cnpj: cnpjs[0] || null, fonte_nome: fonteIdx >= 0 ? (L[fonteIdx + 1] || "").slice(0, 100) : null, valores, extractor: EXTRACTOR_VERSION };
}
export function parseRecibo(lines) {
  const L = lines.map(l => String(l).replace(/\s+/g, " ").trim()).filter(Boolean), J = L.join(" ");
  const cnpj = (J.match(/\b(\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2})\b/) || [])[1] || null, cpf = (J.match(/\b(\d{3}\.\d{3}\.\d{3}-\d{2})\b/) || [])[1] || null;
  const valor = moneyAfter(L, /VALOR|TOTAL|IMPORTANCIA|QUANTIA/)?.value ?? null, data = isoFromBr((J.match(/(\d{2}\/\d{2}\/\d{4})/) || [])[1]);
  return { type: "recibo", prestador_documento: cnpj || cpf, prestador_tipo: cnpj ? "cnpj" : cpf ? "cpf" : null, valor, data, extractor: EXTRACTOR_VERSION };
}
export function extract(lines, opts = {}) {
  const type = opts.type || detectDocType(lines.join("\n"));
  const data = type === "nota_corretagem" ? parseNota(lines, opts) : type === "darf" ? parseDarf(lines) : type === "informe_rendimentos" ? parseInforme(lines) : type === "recibo" ? parseRecibo(lines) : null;
  return data ? { ...data, validation: validateExtraction(data, opts) } : { type: null, validation: { ok: false, checks: [{ id: "tipo", ok: false, detail: "Não reconhecemos o tipo do documento. Hoje lemos notas de corretagem, DARF, informes de rendimentos e recibos." }], confidence: 0, blocking: true } };
}

/* ------------------------------------------------------------------ validação (roda de novo no servidor) */
const fm = v => v == null ? "—" : (+v).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const near = (a, b, tol = 0.02) => a != null && b != null && Math.abs(a - b) <= tol;
export function validateExtraction(d, { refDate = new Date().toISOString().slice(0, 10) } = {}) {
  const checks = [], add = (id, ok, detail, blocking = false) => checks.push({ id, ok: !!ok, detail, blocking: !ok && blocking });
  if (d.type === "nota_corretagem") {
    const n = d.negocios || [], r = d.resumo || {};
    add("negocios", n.length > 0, n.length ? `${n.length} negócio(s) lido(s).` : "Nenhum negócio encontrado na nota.", true);
    add("data_pregao", d.header?.data_pregao && d.header.data_pregao <= refDate, d.header?.data_pregao ? `Pregão de ${d.header.data_pregao.split("-").reverse().join("/")}.` : "Data do pregão não encontrada.", true);
    n.forEach((x, i) => add(`linha_${i + 1}`, near(r2(x.quantidade * x.preco), x.valor, Math.max(0.05, x.valor * 0.0005)), `${x.titulo}: ${x.quantidade} × ${fm(x.preco)} = ${fm(x.valor)}`, true));
    const compras = r2(n.filter(x => x.side === "C").reduce((s, x) => s + x.valor, 0)), vendas = r2(n.filter(x => x.side === "V").reduce((s, x) => s + x.valor, 0));
    if (r.compras_a_vista != null) add("compras", near(compras, r.compras_a_vista) || n.some(x => x.mercado !== "VISTA" && x.mercado !== "FRACIONARIO"), `Soma das compras ${fm(compras)} confere com o resumo (${fm(r.compras_a_vista)}).`, true);
    if (r.vendas_a_vista != null) add("vendas", near(vendas, r.vendas_a_vista) || n.some(x => x.mercado !== "VISTA" && x.mercado !== "FRACIONARIO"), `Soma das vendas ${fm(vendas)} confere com o resumo (${fm(r.vendas_a_vista)}).`, true);
    if (r.valor_operacoes != null) add("valor_operacoes", near(r2(compras + vendas), r.valor_operacoes), `Compras + vendas = ${fm(compras + vendas)}; valor das operações na nota: ${fm(r.valor_operacoes)}.`);
    if (r.valor_liquido_operacoes) { const exp = r2(vendas - compras); const got = r.valor_liquido_operacoes.dc === "D" ? -r.valor_liquido_operacoes.value : r.valor_liquido_operacoes.value;
      add("liquido_operacoes", near(exp, got), `Vendas − compras = ${fm(exp)}; valor líquido na nota: ${fm(got)}.`); }
    if (r.liquido) { const exp = r2(vendas - compras - notaCosts(r) - (+r.irrf || 0)); const got = r.liquido.dc === "D" ? -r.liquido.value : r.liquido.value;
      add("liquido_final", near(exp, got, 0.05), `Líquido calculado ${fm(exp)}; líquido da nota: ${fm(got)} (custos ${fm(notaCosts(r))}, IRRF ${fm(r.irrf || 0)}).`); }
    const unresolved = n.filter(x => !x.ticker);
    add("ativos", unresolved.length === 0, unresolved.length ? `Informe o código de negociação de: ${unresolved.map(x => x.titulo).join(", ")}.` : "Todos os ativos identificados.", true);
    if (n.some(x => x.ticker_origem === "mapa_interno")) add("ativos_inferidos", true, "Alguns códigos vieram do mapa interno de nomes de pregão: confira antes de importar.");
    if (n.some(x => !["VISTA", "FRACIONARIO"].includes(x.mercado))) add("mercado", false, "Opções, termo e exercício ainda não entram na apuração; esses negócios serão ignorados na importação.");
  }
  if (d.type === "darf") {
    add("codigo", !!d.codigo, d.codigo ? `Código da receita ${d.codigo}.` : "Código da receita não encontrado.", true);
    add("competencia", !!d.competencia, d.competencia ? `Período de apuração ${d.periodo_apuracao}.` : "Período de apuração não encontrado.", true);
    add("valor", d.valor_total > 0, d.valor_total > 0 ? `Valor total ${fm(d.valor_total)}.` : "Valor total não encontrado.", true);
    add("pagamento", !!d.data_pagamento, d.data_pagamento ? `Pago em ${d.data_pagamento}.` : "Sem data de pagamento: parece guia, não comprovante. Só marcamos como pago com comprovante.", true);
    if (d.codigo && d.codigo !== "6015") add("codigo_rv", false, `Código ${d.codigo}: não é o DARF de renda variável (6015); o documento fica guardado sem baixar apuração.`);
  }
  if (d.type === "informe_rendimentos") {
    add("cnpj", d.fonte_cnpj && cnpjValid(d.fonte_cnpj), d.fonte_cnpj ? `CNPJ da fonte ${d.fonte_cnpj}${cnpjValid(d.fonte_cnpj) ? "" : " com dígito verificador inválido"}.` : "CNPJ da fonte pagadora não encontrado.", true);
    add("ano", d.ano_calendario >= 2000 && d.ano_calendario <= +refDate.slice(0, 4), d.ano_calendario ? `Ano-calendário ${d.ano_calendario}.` : "Ano-calendário não encontrado.", true);
    const found = Object.entries(d.valores || {}).filter(([, v]) => v != null);
    add("valores", found.length > 0, found.length ? `${found.length} valor(es) lido(s).` : "Nenhum valor reconhecido; confira o documento.", true);
  }
  if (d.type === "recibo") {
    const okDoc = d.prestador_tipo === "cnpj" ? cnpjValid(d.prestador_documento) : d.prestador_tipo === "cpf" ? cpfValid(d.prestador_documento) : false;
    add("prestador", okDoc, d.prestador_documento ? `${d.prestador_tipo.toUpperCase()} do prestador ${okDoc ? "válido" : "com dígito verificador inválido"}.` : "CPF/CNPJ do prestador não encontrado (a Receita exige para dedução).", true);
    add("valor", d.valor > 0, d.valor > 0 ? `Valor ${fm(d.valor)}.` : "Valor não encontrado.", true);
  }
  const passed = checks.filter(c => c.ok).length;
  return { ok: checks.every(c => !c.blocking), blocking: checks.some(c => c.blocking), checks, confidence: checks.length ? r2(passed / checks.length) : 0 };
}

/* nota confirmada → negociações para o Tax Engine (custos rateados pelo valor de cada negócio) */
export function notaToTrades(d, { tickerOverrides = {} } = {}) {
  const n = (d.negocios || []).filter(x => ["VISTA", "FRACIONARIO"].includes(x.mercado));
  const total = n.reduce((s, x) => s + x.valor, 0), costs = notaCosts(d.resumo || {});
  let alloc = 0;
  return n.map((x, i) => {
    const fee = i === n.length - 1 ? r2(costs - alloc) : r2(total ? costs * x.valor / total : 0); alloc = r2(alloc + fee);
    const ticker = (tickerOverrides[i] || x.ticker || "").toUpperCase();
    return { date: d.header.data_pregao, ticker, side: x.side, quantity: x.quantidade, price: x.preco, value: x.valor, fees: fee, market: x.mercado === "FRACIONARIO" ? "fracionario" : "vista",
      custodian: d.header.corretora || "", ...(x.daytrade ? { daytrade: true } : {}), asset_class: x.classe, nota: d.header.numero };
  });
}
