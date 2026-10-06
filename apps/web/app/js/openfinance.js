/* Open Finance via agregador (Pluggy) — M5. Funções puras que convertem as respostas do agregador
 * nos mesmos registros normalizados da importação de arquivos (contas, lançamentos, posições).
 * Assim os painéis, o imposto, o radar e o simulador funcionam igual para dados importados ou conectados. */

import { CONNECTION_STATE } from "./data_quality.js";
export const PLUGGY_WIDGET = "https://cdn.pluggy.ai/pluggy-connect/v2.8.2/pluggy-connect.js";
const r2 = v => Math.round((+v || 0) * 100) / 100;
const day = v => (v ? String(v).slice(0, 10) : null);

/* status do item no agregador → linguagem do cliente */
export const ITEM_STATUS = {
  UPDATED: ["ativo", "Sincronizado"], UPDATING: ["sincronizando", "Sincronizando…"], LOGIN_ERROR: ["erro", "Senha ou acesso recusado pela instituição"],
  OUTDATED: ["desatualizado", "Desatualizado: reconecte"], WAITING_USER_INPUT: ["acao", "A instituição pediu uma confirmação"], CREATED: ["sincronizando", "Conectando…"],
};
export function itemView(it) {
  const [state, label] = ITEM_STATUS[it?.status] || ["desconhecido", it?.status || "—"];
  return { id: it.id, institution: it.connector?.name || "Instituição", logo: it.connector?.imageUrl || null, state, label, connection_state: CONNECTION_STATE[it?.status] || "DISCOVERED",
           status: it.status, last_updated_at: it.lastUpdatedAt || it.updatedAt || null, error: it.error?.message || null };
}

export function mapAccount(a, institution) {
  const card = a.type === "CREDIT" || a.subtype === "CREDIT_CARD";
  return { external_id: a.id, name: a.marketingName || a.name || (card ? "Cartão" : "Conta"), institution, type: card ? "cartao" : "conta",
           balance: card ? -Math.abs(+a.balance || 0) : r2(a.balance), balance_date: day(a.updatedAt) || new Date().toISOString().slice(0, 10) };
}

/* sinal pelo tipo do lançamento: DEBIT sai, CREDIT entra (vale para conta e cartão) */
export function mapTransaction(t, account) {
  const card = account?.type === "CREDIT";
  const raw = +t.amount || 0;
  const amt = t.type === "DEBIT" ? -Math.abs(raw) : t.type === "CREDIT" ? Math.abs(raw) : card ? -raw : raw;
  return { date: day(t.date), description: (t.description || t.descriptionRaw || "Lançamento").trim(), amount: r2(amt),
           account_id: account?.id || t.accountId || "", fitid: t.id, category: null };
}

const CLASS = { STOCK: "acao", REAL_ESTATE_FUND: "fii", ETF: "etf", BDR: "bdr", TREASURY: "tesouro", CDB: "renda_fixa", LCI: "renda_fixa", LCA: "renda_fixa",
  LC: "renda_fixa", CRI: "renda_fixa", CRA: "renda_fixa", DEBENTURES: "renda_fixa", INVESTMENT_FUND: "fundo", MULTIMARKET_FUND: "fundo", FIXED_INCOME_FUND: "fundo",
  STOCK_FUND: "fundo", EXCHANGE_FUND: "fundo", PENSION: "previdencia", PGBL: "previdencia", VGBL: "previdencia", COE: "outro", CRYPTO: "cripto" };
const TYPE = { EQUITY: "acao", ETF: "etf", FIXED_INCOME: "renda_fixa", MUTUAL_FUND: "fundo", SECURITY: "previdencia", COE: "outro" };

export function mapInvestment(i, institution) {
  const ticker = /^[A-Z]{4}\d{1,2}$/.test(String(i.code || "").toUpperCase()) ? String(i.code).toUpperCase() : "";
  let cls = CLASS[i.subtype] || TYPE[i.type] || "outro";
  if (cls === "acao" && /11$/.test(ticker) && i.subtype !== "STOCK") cls = "fii";
  const value = +i.balance || +i.amount || (+i.quantity * +i.value) || 0;
  return { name: ["tesouro", "renda_fixa", "fundo", "previdencia"].includes(cls) ? (i.name || i.code || "Investimento") + (i.issuer ? ` · ${i.issuer}` : "") : (ticker || i.name || "Investimento"),
           ticker, asset_class: cls, custodian: institution, quantity: +i.quantity || 1, value: r2(value),
           invested: i.amountOriginal != null ? r2(i.amountOriginal) : null, price: i.value != null ? +i.value : null,
           as_of: day(i.date) || new Date().toISOString().slice(0, 10), maturity: day(i.dueDate), indexer: i.rateType || "" };
}

/* resposta completa de um item → registros prontos para gravar */
export function normalizeItem({ item, accounts = [], transactions = {}, investments = [] }) {
  const inst = item.connector?.name || "Instituição";
  return {
    accounts: accounts.map(a => mapAccount(a, inst)),
    transactions: accounts.flatMap(a => (transactions[a.id] || []).map(t => mapTransaction(t, a))).filter(t => t.date && t.amount),
    holdings: investments.filter(i => (i.status || "ACTIVE") === "ACTIVE").map(i => mapInvestment(i, inst)).filter(h => h.value > 0),
  };
}
