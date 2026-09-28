// Simulador mínimo da API v3 do Asaas para o teste ponta a ponta local.
import http from "node:http";
export const KEY = "$aact_hmlg_TESTE_LOCAL_FICTICIA";
const st = { customers: {}, subs: {}, pays: {}, n: 0 };
const id = p => `${p}_${String(++st.n).padStart(6, "0")}`;
export function addPayment({ customer, value, status = "PENDING", billing = "UNDEFINED", due = new Date().toISOString().slice(0, 10), sub = null, ext = null }) {
  const pid = id("pay");
  st.pays[pid] = { object: "payment", id: pid, dateCreated: due, customer, subscription: sub, value, netValue: +(value * 0.97).toFixed(2), billingType: billing,
                   status, dueDate: due, paymentDate: null, clientPaymentDate: null, invoiceUrl: `https://www.asaas.com/i/${pid}`, externalReference: ext, description: "cobrança", deleted: false };
  return st.pays[pid];
}
export const state = st;
const page = (items, u) => { const off = +(u.searchParams.get("offset") || 0), lim = +(u.searchParams.get("limit") || 10);
  return { object: "list", hasMore: off + lim < items.length, totalCount: items.length, data: items.slice(off, off + lim) }; };
export function start(port) {
  return new Promise(res => {
    const srv = http.createServer((req, rs) => {
      let raw = ""; req.on("data", c => raw += c); req.on("end", () => {
        const send = (code, obj) => { rs.writeHead(code, { "Content-Type": "application/json" }); rs.end(JSON.stringify(obj)); };
        if (req.headers["access_token"] !== KEY) return send(401, { errors: [{ code: "invalid_access_token", description: "Chave inválida" }] });
        const u = new URL(req.url, "http://x"), p = u.pathname.replace(/^\/v3/, ""), b = raw ? JSON.parse(raw) : {};
        if (p === "/finance/balance") return send(200, { balance: 1234.56 });
        if (p === "/myAccount/commercialInfo/") return send(200, { name: "Ramon Junio Araujo Pereira" });
        if (p === "/customers" && req.method === "GET") {
          let it = Object.values(st.customers);
          for (const k of ["externalReference", "cpfCnpj", "email"]) if (u.searchParams.get(k)) it = it.filter(c => c[k] === u.searchParams.get(k));
          return send(200, page(it, u));
        }
        if (p === "/customers" && req.method === "POST") { const c = { object: "customer", id: id("cus"), ...b }; st.customers[c.id] = c; return send(200, c); }
        if (p.startsWith("/customers/")) { const c = st.customers[p.split("/")[2]]; return c ? send(200, c) : send(404, { errors: [{ code: "nf", description: "x" }] }); }
        if (p === "/subscriptions" && req.method === "POST") {
          const s = { object: "subscription", id: id("sub"), status: "ACTIVE", ...b }; st.subs[s.id] = s;
          addPayment({ customer: b.customer, value: b.value, due: b.nextDueDate, sub: s.id, ext: b.externalReference }); return send(200, s);
        }
        if (/^\/subscriptions\/[^/]+\/payments$/.test(p)) { const sid = p.split("/")[2]; return send(200, page(Object.values(st.pays).filter(x => x.subscription === sid), u)); }
        if (p.startsWith("/subscriptions/") && req.method === "DELETE") return send(200, { deleted: true });
        if (p === "/payments") return send(200, page(Object.values(st.pays), u));
        send(404, { errors: [{ code: "nf", description: p }] });
      });
    });
    srv.listen(port, () => res(srv));
  });
}
