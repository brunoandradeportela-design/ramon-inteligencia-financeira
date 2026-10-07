/* Leitores de arquivos financeiros do cliente — rodam no navegador (o arquivo bruto não sai do computador;
 * só os registros já normalizados vão para a API). Funções puras, testadas em node.
 *   OFX (extrato de conta e de cartão, versões 1.x SGML e 2.x XML)
 *   CSV de bancos (Nubank, Inter, Itaú, BB, C6, genérico) — detecção automática das colunas
 *   B3 · Área do Investidor: Posição, Negociação e Movimentação (planilhas .xlsx)
 *   Nota de corretagem padrão SINACOR (texto extraído do PDF) — beta */

export const norm = s => String(s ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim();

/* ------------------------------------------------------------------ números e datas brasileiros */
export function parseNumber(v) {
  if (typeof v === "number") return isFinite(v) ? v : null;
  let s = String(v ?? "").trim();
  if (!s || s === "-") return null;
  const neg = /^\(.*\)$/.test(s) || /^-|-$/.test(s.replace(/\s/g, "")) || /\d\s*D$/.test(s);
  s = s.replace(/[R$\s()]|[a-zA-Z]/g, "").replace(/^-|-$/g, "");
  if (!s) return null;
  if (s.includes(",") && s.includes(".")) s = s.lastIndexOf(",") > s.lastIndexOf(".") ? s.replace(/\./g, "").replace(",", ".") : s.replace(/,/g, "");
  else if (s.includes(",")) s = s.replace(/\./g, "").replace(",", ".");
  else if ((s.match(/\./g) || []).length > 1 || /^\d{1,3}\.\d{3}$/.test(s)) s = s.replace(/\./g, "");   // 3.050 = três mil e cinquenta
  const n = parseFloat(s);
  return isFinite(n) ? (neg ? -n : n) : null;
}
export function parseDate(v) {
  if (v instanceof Date && !isNaN(v)) return v.toISOString().slice(0, 10);
  if (typeof v === "number" && v > 20000 && v < 80000) {                       // data serial do Excel
    return new Date(Date.UTC(1899, 11, 30) + v * 864e5).toISOString().slice(0, 10);
  }
  const s = String(v ?? "").trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})/);
  if (m) { const y = m[3].length === 2 ? "20" + m[3] : m[3]; return `${y}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`; }
  m = s.match(/^(\d{4})(\d{2})(\d{2})/);                                         // OFX: 20260915120000[-3:BRT]
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  return null;
}
const round2 = v => Math.round(v * 100) / 100;

/* ------------------------------------------------------------------ OFX */
export function parseOFX(text) {
  const t = String(text || "");
  const tag = (block, name) => { const m = block.match(new RegExp(`<${name}>\\s*([^<\\r\\n]*)`, "i")); return m ? m[1].trim() : ""; };
  const blocks = (src, name) => { const out = []; const re = new RegExp(`<${name}>([\\s\\S]*?)(?:</${name}>|(?=<${name}>)|$)`, "gi"); let m; while ((m = re.exec(src))) out.push(m[1]); return out; };
  const org = tag(t, "ORG") || tag(t, "FID") || "";
  const accounts = [], transactions = [];
  const statements = [...blocks(t, "STMTRS").map(b => ["conta", b]), ...blocks(t, "CCSTMTRS").map(b => ["cartao", b])];
  if (!statements.length && /<STMTTRN>/i.test(t)) statements.push(["conta", t]);
  for (const [type, st] of statements) {
    const bank = tag(st, "BANKID"), acct = tag(st, "ACCTID") || "principal";
    const institution = org || (bank ? `Banco ${bank}` : "Banco");
    const accountId = `${norm(institution)}:${acct}`;
    const ledger = blocks(st, "LEDGERBAL")[0] || "";
    accounts.push({ external_id: accountId, name: `${type === "cartao" ? "Cartão" : "Conta"} ${acct.slice(-6)}`, institution, type,
      balance: type === "cartao" ? 0 : parseNumber(tag(ledger, "BALAMT")) ?? 0, balance_date: parseDate(tag(ledger, "DTASOF")) });
    for (const tr of blocks(st, "STMTTRN")) {
      const date = parseDate(tag(tr, "DTPOSTED")), amount = parseNumber(tag(tr, "TRNAMT"));
      const description = (tag(tr, "MEMO") || tag(tr, "NAME") || tag(tr, "TRNTYPE")).replace(/\s+/g, " ").trim();
      if (!date || amount === null) continue;
      transactions.push({ date, description, amount: round2(amount), fitid: tag(tr, "FITID"), account_id: accountId });
    }
  }
  return { kind: "ofx", source: `ofx:${norm(org || "banco")}`, accounts, transactions };
}

/* ------------------------------------------------------------------ CSV */
export function splitCSV(text) {
  const src = String(text || "").replace(/^﻿/, "");
  const firstLines = src.split(/\r?\n/).slice(0, 5).join("\n");
  const delim = [";", ",", "\t"].map(d => [d, (firstLines.match(new RegExp(d === "\t" ? "\t" : `\\${d}`, "g")) || []).length]).sort((a, b) => b[1] - a[1])[0][0];
  const rows = []; let row = [], cell = "", q = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (q) { if (c === '"' && src[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') q = false; else cell += c; }
    else if (c === '"') q = true;
    else if (c === delim) { row.push(cell); cell = ""; }
    else if (c === "\n" || c === "\r") { if (c === "\r" && src[i + 1] === "\n") i++; row.push(cell); rows.push(row); row = []; cell = ""; }
    else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.filter(r => r.some(x => String(x).trim()));
}
const findCol = (headers, pats, not = null) => headers.findIndex(h => pats.some(p => p.test(h)) && !(not && not.test(h)));

export function parseCSV(text, { filename = "", accountType = "auto", institution = "" } = {}) {
  const rows = splitCSV(text);
  // a linha de cabeçalho é a primeira que tem uma coluna de data e outra de valor
  let hi = rows.findIndex(r => { const h = r.map(norm); return h.some(x => /^data|^date|dt\.? ?lanc/.test(x)) && h.some(x => /valor|amount|quantia|credito|debito|entrada|saida/.test(x)); });
  if (hi < 0) throw new Error("Não encontramos as colunas de data e valor neste CSV.");
  const H = rows[hi].map(norm);
  const cDate = findCol(H, [/^data/, /^date/, /lancamento/]);
  const cDesc = findCol(H, [/descri/, /histor/, /^title$/, /estabelecimento/, /memo/, /lancamento/, /detalhe/], /^data/);
  const cAmount = findCol(H, [/^valor/, /^amount$/, /quantia/], /saldo/);
  const cCred = findCol(H, [/credito/, /entrada/]), cDeb = findCol(H, [/debito/, /saida/]);
  const cId = findCol(H, [/identificador/, /^id$/, /documento/]);
  // cartão Nubank (date,title,amount): compras vêm positivas
  const nubankCard = H.includes("title") && H.includes("amount") && !H.some(h => /identificador/.test(h));
  const isCard = accountType === "cartao" || (accountType === "auto" && (nubankCard || /fatura|cartao|card/.test(norm(filename))));
  const inst = institution || (/nubank|nu_/.test(norm(filename)) || nubankCard ? "Nubank" : /inter/.test(norm(filename)) ? "Inter" : "Banco");
  const accountId = `${norm(inst)}:${isCard ? "cartao" : "conta"}`;
  const transactions = [];
  for (const r of rows.slice(hi + 1)) {
    const date = parseDate(r[cDate]);
    if (!date) continue;
    let amount = cAmount >= 0 ? parseNumber(r[cAmount]) : null;
    if (amount === null && (cCred >= 0 || cDeb >= 0)) amount = (parseNumber(r[cCred]) || 0) - Math.abs(parseNumber(r[cDeb]) || 0);
    if (amount === null || amount === 0) continue;
    if (isCard && nubankCard) amount = -amount;                                   // compra = saída
    const description = String(r[cDesc] ?? "").replace(/\s+/g, " ").trim() || "Lançamento";
    if (/^saldo/i.test(norm(description))) continue;
    transactions.push({ date, description, amount: round2(amount), fitid: cId >= 0 ? String(r[cId] || "") : "", account_id: accountId });
  }
  if (!transactions.length) throw new Error("Nenhum lançamento válido encontrado no CSV.");
  return { kind: "csv", source: `csv:${norm(inst)}`, accounts: [{ external_id: accountId, name: isCard ? "Cartão" : "Conta", institution: inst, type: isCard ? "cartao" : "conta", balance: 0 }], transactions };
}

/* ------------------------------------------------------------------ B3 · Área do Investidor (.xlsx) */
const SHEET_CLASS = [[/acao|acoes/, "acao"], [/bdr/, "bdr"], [/etf/, "etf"], [/fundo|fii/, "fii"], [/tesouro/, "tesouro"], [/renda fixa|cdb|lci|lca|debenture/, "renda_fixa"], [/previd/, "previdencia"]];
function headerIndex(rows, mustHave) {
  return rows.findIndex(r => { const h = r.map(norm); return mustHave.every(re => h.some(x => re.test(x))); });
}
export function parseB3Workbook(sheets) {
  // sheets: { "Nome da aba": [[célula, ...], ...] }
  const holdings = [], trades = [], incomes = [];
  let kind = null;
  for (const [name, rows] of Object.entries(sheets || {})) {
    const sn = norm(name);
    // ---- negociação
    let hi = headerIndex(rows, [/data do negocio/, /tipo de movimentacao/, /codigo de negociacao/]);
    if (hi >= 0) {
      kind = kind || "b3_negociacao";
      const H = rows[hi].map(norm), c = re => H.findIndex(x => re.test(x));
      const iD = c(/data do negocio/), iT = c(/tipo de movimentacao/), iC = c(/codigo de negociacao/), iQ = c(/^quantidade/), iP = c(/^preco/), iV = c(/^valor/), iI = c(/instituicao/), iM = c(/mercado/);
      for (const r of rows.slice(hi + 1)) {
        const date = parseDate(r[iD]), side = /compra/.test(norm(r[iT])) ? "C" : /venda/.test(norm(r[iT])) ? "V" : null;
        const q = parseNumber(r[iQ]);
        if (!date || !side || !q) continue;
        trades.push({ date, side, ticker: String(r[iC]).trim().toUpperCase().replace(/F$/, ""), quantity: q, price: parseNumber(r[iP]) ?? 0,
          value: parseNumber(r[iV]) ?? 0, custodian: String(r[iI] ?? "").trim(), market: String(r[iM] ?? "").trim() });
      }
      continue;
    }
    // ---- movimentação (liquidações viram negociações)
    hi = headerIndex(rows, [/entrada\/saida|entrada ?\/ ?saida/, /movimentacao/, /produto/]);
    if (hi >= 0) {
      kind = kind || "b3_movimentacao";
      const H = rows[hi].map(norm), c = re => H.findIndex(x => re.test(x));
      const iES = c(/entrada/), iD = c(/^data/), iMv = c(/^movimentacao/), iPr = c(/^produto/), iI = c(/instituicao/), iQ = c(/^quantidade/), iP = c(/preco/), iV = c(/valor/);
      for (const r of rows.slice(hi + 1)) {
        const mv = norm(r[iMv]);
        // proventos creditados: dividendo, juros sobre capital próprio e rendimento (FII); valor líquido creditado
        const inc = /^dividendo/.test(mv) ? "dividendo" : /juros sobre capital/.test(mv) ? "jcp" : /^rendimento/.test(mv) ? "rendimento" : null;
        if (inc && /credito|entrada/.test(norm(r[iES]))) {
          const date = parseDate(r[iD]), v = parseNumber(r[iV]);
          if (date && v > 0) incomes.push({ date, ticker: String(r[iPr]).split(" - ")[0].trim().toUpperCase().replace(/F$/, ""), kind: inc, value: round2(v),
            quantity: parseNumber(r[iQ]), custodian: String(r[iI] ?? "").trim(), payer: String(r[iPr] ?? "").split(" - ").slice(1).join(" - ").trim().slice(0, 80) });
          continue;
        }
        if (!/transferencia - liquidacao|^compra$|^venda$/.test(mv)) continue;
        const date = parseDate(r[iD]), q = parseNumber(r[iQ]);
        if (!date || !q) continue;
        const side = /credito|entrada/.test(norm(r[iES])) ? "C" : "V";
        trades.push({ date, side, ticker: String(r[iPr]).split(" - ")[0].trim().toUpperCase().replace(/F$/, ""), quantity: q,
          price: parseNumber(r[iP]) ?? 0, value: parseNumber(r[iV]) ?? 0, custodian: String(r[iI] ?? "").trim(), market: "movimentação B3" });
      }
      continue;
    }
    // ---- posição
    hi = headerIndex(rows, [/^produto/, /^quantidade/, /valor atualizado|valor liquido|valor bruto/]);
    if (hi < 0) continue;
    kind = kind || "b3_posicao";
    const assetClass = (SHEET_CLASS.find(([re]) => re.test(sn)) || [0, "outro"])[1];
    const H = rows[hi].map(norm), c = re => H.findIndex(x => re.test(x));
    const iPr = c(/^produto/), iI = c(/^instituicao/), iCod = c(/codigo de negociacao|^codigo$/), iQ = c(/^quantidade$/), iPx = c(/preco de fechamento|preco atualizado/),
      iV = [c(/valor atualizado mtm/), c(/^valor atualizado$/), c(/valor atualizado/), c(/valor liquido/), c(/valor bruto/)].find(i => i >= 0),
      iApl = c(/valor aplicado/), iVenc = c(/vencimento/), iIdx = c(/indexador/), iEm = c(/emissor/);
    for (const r of rows.slice(hi + 1)) {
      const product = String(r[iPr] ?? "").trim(), value = parseNumber(r[iV]);
      if (!product || /^total/i.test(product) || !value || value <= 0) continue;
      const code = iCod >= 0 ? String(r[iCod] ?? "").trim().toUpperCase() : "";
      const ticker = /^[A-Z]{4}\d{1,2}$/.test(code) ? code : (product.match(/^([A-Z]{4}\d{1,2})\b/) || [])[1] || "";
      holdings.push({ name: ["tesouro", "renda_fixa"].includes(assetClass) ? product + (iEm >= 0 && r[iEm] ? ` · ${r[iEm]}` : "") : (ticker || product.split(" - ")[0]),
        ticker, asset_class: assetClass, custodian: String(r[iI] ?? "").trim(), quantity: parseNumber(r[iQ]) ?? 1, value: round2(value),
        invested: iApl >= 0 ? parseNumber(r[iApl]) : null, price: iPx >= 0 ? parseNumber(r[iPx]) : null,
        maturity: iVenc >= 0 ? parseDate(r[iVenc]) : null, indexer: iIdx >= 0 ? String(r[iIdx] ?? "").trim() : "" });
    }
  }
  if (!holdings.length && !trades.length && !incomes.length) throw new Error("Planilha não reconhecida. Use os relatórios de Posição, Negociação ou Movimentação da Área do Investidor da B3.");
  return { kind: kind || "b3", source: "b3", holdings, trades, incomes, replace_holdings: holdings.length > 0 };
}

/* ------------------------------------------------------------------ Nota de corretagem SINACOR (texto do PDF) — beta */
export function parseNotaCorretagem(text, { custodian = "" } = {}) {
  const t = String(text || "").replace(/ /g, " ");
  const dm = t.match(/data preg[aã]o[^\d]{0,40}(\d{2}\/\d{2}\/\d{4})/i) || t.match(/(\d{2}\/\d{2}\/\d{4})/);
  const date = dm ? parseDate(dm[1]) : null;
  if (!date) throw new Error("Data do pregão não encontrada na nota.");
  const broker = custodian || (t.match(/(XP INVESTIMENTOS|CLEAR CORRETORA|RICO INVESTIMENTOS|BTG PACTUAL|NU INVEST|INTER DTVM|MODAL|GENIAL|ITAU CORRETORA|BB BANCO DE INVESTIMENTO|TORO)/i) || [])[1] || "Corretora";
  const trades = [];
  const re = /(?:\d-)?BOVESPA\s+([CV])\s+(VISTA|FRACIONARIO|OPCAO DE COMPRA|OPCAO DE VENDA|EXERC OPC \w+|TERMO)\s+(.+?)\s+(?:([#@D])\s+)?(\d{1,3}(?:\.\d{3})*|\d+)\s+(\d{1,3}(?:\.\d{3})*,\d{2,8})\s+(\d{1,3}(?:\.\d{3})*,\d{2})\s+([DC])/gi;
  let m;
  while ((m = re.exec(t))) {
    const spec = m[3].replace(/\s+/g, " ").trim();
    const code = (spec.match(/\b([A-Z]{4}\d{1,2})F?\b/) || [])[1] || spec;
    trades.push({ date, side: m[1].toUpperCase(), ticker: code.toUpperCase(), quantity: parseNumber(m[5]), price: parseNumber(m[6]), value: parseNumber(m[7]),
      custodian: broker, market: m[2].toLowerCase(), ...(m[4] === "D" ? { daytrade: true } : {}) });
  }
  if (!trades.length) throw new Error("Nenhuma operação encontrada. A leitura de notas funciona com o padrão SINACOR (a maioria das corretoras).");
  const costs = t.match(/total custos\s*\/\s*despesas\s+([\d.]+,\d{2})/i);
  if (costs) { const tot = parseNumber(costs[1]), sum = trades.reduce((s, x) => s + x.value, 0); trades.forEach(x => { x.fees = round2(tot * x.value / sum); }); }
  return { kind: "nota_corretagem", source: `nota:${norm(broker)}`, trades };
}

/* ------------------------------------------------------------------ detecção por extensão */
export function detectKind(filename) {
  const f = norm(filename);
  if (/\.ofx$|\.qfx$/.test(f)) return "ofx";
  if (/\.csv$|\.txt$/.test(f)) return "csv";
  if (/\.xlsx$|\.xls$/.test(f)) return "xlsx";
  if (/\.pdf$/.test(f)) return "pdf";
  return null;
}
export function summarize(parsed) {
  return { transactions: parsed.transactions?.length || 0, accounts: parsed.accounts?.length || 0,
           holdings: parsed.holdings?.length || 0, trades: parsed.trades?.length || 0, incomes: parsed.incomes?.length || 0 };
}
