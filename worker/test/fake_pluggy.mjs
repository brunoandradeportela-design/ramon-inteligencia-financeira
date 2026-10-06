// Simulador mínimo da API da Pluggy para testes locais (auth, connect_token, items, accounts, transactions, investments).
import http from "node:http";
export const CLIENT = { id: "cli-teste-local", secret: "segredo-teste-local" };
const st = { items: {}, keys: new Set(), n: 0, calls: [] };
export const state = st;
export function addItem(clientUserId, { status = "UPDATED", name = "Banco Teste" } = {}) {
  const id = `item-${String(++st.n).padStart(4, "0")}-aaaa-bbbb`;
  st.items[id] = { id, status, clientUserId, connector: { name, imageUrl: "https://cdn.pluggy.ai/assets/connector-icons/201.svg" }, lastUpdatedAt: new Date().toISOString(),
    accounts: [
      { id: id + "-acc1", type: "BANK", subtype: "CHECKING_ACCOUNT", name: "Conta Corrente", balance: 15234.5, updatedAt: "2026-09-30T10:00:00Z" },
      { id: id + "-card", type: "CREDIT", subtype: "CREDIT_CARD", name: "Cartão Black", balance: 2380.9, updatedAt: "2026-09-30T10:00:00Z" }],
    tx: {
      [id + "-acc1"]: [
        ...["2026-07", "2026-08", "2026-09"].flatMap(m => [
          { id: `${m}-sal`, date: `${m}-05T12:00:00.000Z`, description: "SALARIO EMPRESA X", amount: 12000, type: "CREDIT" },
          { id: `${m}-alu`, date: `${m}-10T12:00:00.000Z`, description: "ALUGUEL APTO", amount: -3200, type: "DEBIT" }])],
      [id + "-card"]: [{ id: "c1", date: "2026-09-12T12:00:00.000Z", description: "IFOOD *RESTAURANTE", amount: 89.9, type: "DEBIT" },
                       { id: "c2", date: "2026-09-14T12:00:00.000Z", description: "ESTORNO LOJA", amount: 50, type: "CREDIT" }] },
    inv: [{ id: "inv1", name: "PETROBRAS PN", code: "PETR4", type: "EQUITY", subtype: "STOCK", quantity: 200, value: 36.5, balance: 7300, amountOriginal: 6000, date: "2026-09-30", status: "ACTIVE" },
          { id: "inv2", name: "CDB Banco Teste", code: null, type: "FIXED_INCOME", subtype: "CDB", balance: 25000, amountOriginal: 22000, dueDate: "2028-01-10", issuer: "Banco Teste", rateType: "CDI", status: "ACTIVE" },
          { id: "inv3", name: "Fundo resgatado", type: "MUTUAL_FUND", balance: 0, status: "TOTAL_WITHDRAWAL" }] };
  return id;
}
export function start(port) {
  return new Promise(res => {
    const srv = http.createServer((req, rs) => {
      let raw = ""; req.on("data", c => raw += c); req.on("end", () => {
        const send = (code, obj) => { rs.writeHead(code, { "Content-Type": "application/json" }); rs.end(obj === null ? "" : JSON.stringify(obj)); };
        const u = new URL(req.url, "http://x"), p = u.pathname, b = raw ? JSON.parse(raw) : {};
        st.calls.push(`${req.method} ${p}`);
        if (p === "/__test/items" && req.method === "POST") return send(200, { id: addItem(b.clientUserId, b) });
        if (p === "/auth" && req.method === "POST") {
          if (b.clientId !== CLIENT.id || b.clientSecret !== CLIENT.secret) return send(401, { message: "invalid credentials" });
          const k = "key-" + (++st.n); st.keys.add(k); return send(200, { apiKey: k });
        }
        if (!st.keys.has(req.headers["x-api-key"])) return send(401, { message: "unauthorized" });
        if (p === "/connectors") return send(200, { results: [
          { id: 201, name: "Banco Teste", type: "PERSONAL_BANK", isOpenFinance: true, products: ["ACCOUNTS", "TRANSACTIONS", "CREDIT_CARDS", "INVESTMENTS"], health: { status: "ONLINE" } },
          { id: 301, name: "Corretora Teste", type: "INVESTMENT", isOpenFinance: true, products: ["INVESTMENTS"], health: { status: "UNSTABLE" } },
          { id: 0, name: "Pluggy Bank", type: "PERSONAL_BANK", isSandbox: true, products: ["ACCOUNTS"] }] });
        if (p === "/connect_token") return send(200, { accessToken: "ct-" + (b.options?.clientUserId || "x") });
        let m;
        if ((m = p.match(/^\/items\/(.+)$/))) {
          const it = st.items[m[1]];
          if (!it) return send(404, { message: "Item not found" });
          if (req.method === "DELETE") { delete st.items[m[1]]; return send(200, { deleted: true }); }
          const { accounts, tx, inv, ...pub } = it; return send(200, pub);
        }
        if (p === "/accounts") { const it = st.items[u.searchParams.get("itemId")]; return it ? send(200, { results: it.accounts }) : send(404, { message: "nf" }); }
        if (p === "/transactions") {
          const acc = u.searchParams.get("accountId"), it = Object.values(st.items).find(i => i.tx[acc]);
          const all = it ? it.tx[acc] : [], size = +u.searchParams.get("pageSize") || 20, page = +u.searchParams.get("page") || 1;
          return send(200, { total: all.length, totalPages: Math.max(1, Math.ceil(all.length / size)), page, results: all.slice((page - 1) * size, page * size) });
        }
        if (p === "/investments") { const it = st.items[u.searchParams.get("itemId")]; return it ? send(200, { results: it.inv }) : send(404, { message: "nf" }); }
        send(404, { message: "rota desconhecida " + p });
      });
    });
    srv.listen(port, () => res(srv));
  });
}
