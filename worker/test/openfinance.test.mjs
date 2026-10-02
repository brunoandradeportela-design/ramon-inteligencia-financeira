import test from "node:test";
import assert from "node:assert/strict";
import { normalizeItem, mapInvestment, itemView } from "../../apps/web/app/js/openfinance.js";
import { addItem, state } from "./fake_pluggy.mjs";

test("Pluggy → registros normalizados (contas, lançamentos com sinal certo, investimentos ativos)", () => {
  const it = state.items[addItem("usr_x")];
  const n = normalizeItem({ item: it, accounts: it.accounts, transactions: it.tx, investments: it.inv });
  assert.equal(n.accounts.length, 2); assert.equal(n.accounts[1].type, "cartao"); assert.equal(n.accounts[1].balance, -2380.9);
  assert.equal(n.transactions.length, 8);
  assert.equal(n.transactions.find(t => t.fitid === "c1").amount, -89.9); assert.equal(n.transactions.find(t => t.fitid === "c2").amount, 50);
  assert.equal(n.transactions.find(t => t.fitid === "2026-07-alu").amount, -3200); assert.equal(n.transactions[0].date, "2026-07-05");
  assert.equal(n.holdings.length, 2); assert.equal(n.holdings[0].asset_class, "acao"); assert.equal(n.holdings[1].asset_class, "renda_fixa");
  assert.match(n.holdings[1].name, /CDB Banco Teste · Banco Teste/);
});
test("classes de investimento e status do item", () => {
  assert.equal(mapInvestment({ code: "HGLG11", type: "EQUITY", subtype: "REAL_ESTATE_FUND", balance: 1000 }, "XP").asset_class, "fii");
  assert.equal(mapInvestment({ name: "Tesouro IPCA+ 2035", type: "FIXED_INCOME", subtype: "TREASURY", balance: 5000 }, "XP").asset_class, "tesouro");
  assert.equal(mapInvestment({ name: "PGBL", type: "SECURITY", subtype: "PGBL", balance: 5000 }, "XP").asset_class, "previdencia");
  assert.deepEqual([itemView({ id: "i", status: "LOGIN_ERROR", connector: { name: "Itaú" } }).state, itemView({ id: "i", status: "UPDATED" }).label], ["erro", "Sincronizado"]);
});
