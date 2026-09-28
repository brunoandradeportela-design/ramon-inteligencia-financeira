"""Simulador da API v3 do Asaas para testes (httpx.MockTransport). Reproduz formatos documentados."""
from __future__ import annotations

import json
from datetime import date

import httpx

TEST_KEY = "$aact_hmlg_000TESTE_FICTICIA_NAO_E_CHAVE_REAL"


class FakeAsaas:
    def __init__(self, key: str = TEST_KEY) -> None:
        self.key = key
        self.customers: dict[str, dict] = {}
        self.subscriptions: dict[str, dict] = {}
        self.payments: dict[str, dict] = {}
        self.requests: list[httpx.Request] = []
        self._n = 0
        self.down = False

    def _id(self, p: str) -> str:
        self._n += 1
        return f"{p}_{self._n:06d}"

    def add_payment(self, *, customer: str, value: float, status: str = "PENDING", billing: str = "UNDEFINED",
                    due: str = "2026-09-27", subscription: str | None = None, ext: str | None = None, paid: str | None = None) -> dict:
        pid = self._id("pay")
        p = {"object": "payment", "id": pid, "dateCreated": due, "customer": customer, "subscription": subscription,
             "value": value, "netValue": round(value * 0.97, 2), "billingType": billing, "status": status, "dueDate": due,
             "paymentDate": paid, "clientPaymentDate": paid, "invoiceUrl": f"https://www.asaas.com/i/{pid}",
             "externalReference": ext, "description": "cobrança", "deleted": False}
        self.payments[pid] = p
        return p

    def _page(self, items: list[dict], req: httpx.Request) -> dict:
        off, lim = int(req.url.params.get("offset", 0)), int(req.url.params.get("limit", 10))
        return {"object": "list", "hasMore": off + lim < len(items), "totalCount": len(items), "limit": lim, "offset": off,
                "data": items[off:off + lim]}

    def handler(self, req: httpx.Request) -> httpx.Response:
        self.requests.append(req)
        if self.down:
            raise httpx.ConnectError("down", request=req)
        if req.headers.get("access_token") != self.key:
            return httpx.Response(401, json={"errors": [{"code": "invalid_access_token", "description": "Chave inválida"}]})
        if not req.headers.get("user-agent"):
            return httpx.Response(400, json={"errors": [{"code": "user_agent", "description": "User-Agent obrigatório"}]})
        path, m = req.url.path.removeprefix("/v3").removeprefix("/api/v3"), req.method
        body = json.loads(req.content) if req.content else {}
        if path == "/finance/balance":
            return httpx.Response(200, json={"balance": 1234.56})
        if path == "/myAccount/commercialInfo/":
            return httpx.Response(200, json={"name": "Ramon Junio Araujo Pereira", "companyName": None})
        if path == "/customers" and m == "GET":
            items = list(self.customers.values())
            for k in ("externalReference", "cpfCnpj", "email"):
                if req.url.params.get(k):
                    items = [c for c in items if c.get(k) == req.url.params[k]]
            return httpx.Response(200, json=self._page(items, req))
        if path == "/customers" and m == "POST":
            if not body.get("cpfCnpj"):
                return httpx.Response(400, json={"errors": [{"code": "invalid_cpfCnpj", "description": "CPF/CNPJ obrigatório"}]})
            c = {"object": "customer", "id": self._id("cus"), **body}
            self.customers[c["id"]] = c
            return httpx.Response(200, json=c)
        if path.startswith("/customers/"):
            c = self.customers.get(path.split("/")[2])
            return httpx.Response(200, json=c) if c else httpx.Response(404, json={"errors": [{"code": "not_found", "description": "x"}]})
        if path == "/subscriptions" and m == "POST":
            s = {"object": "subscription", "id": self._id("sub"), "status": "ACTIVE", **body}
            self.subscriptions[s["id"]] = s
            self.add_payment(customer=body["customer"], value=body["value"], due=body["nextDueDate"], subscription=s["id"],
                             ext=body.get("externalReference"))
            return httpx.Response(200, json=s)
        if path.startswith("/subscriptions/") and path.endswith("/payments"):
            sid = path.split("/")[2]
            return httpx.Response(200, json=self._page([p for p in self.payments.values() if p["subscription"] == sid], req))
        if path.startswith("/subscriptions/") and m == "DELETE":
            sid = path.split("/")[2]
            self.subscriptions[sid]["status"] = "INACTIVE"
            return httpx.Response(200, json={"deleted": True, "id": sid})
        if path == "/payments" and m == "GET":
            items = sorted(self.payments.values(), key=lambda p: p["id"])
            ge = req.url.params.get("dateCreated[ge]")
            if ge:
                items = [p for p in items if p["dateCreated"] >= ge]
            return httpx.Response(200, json=self._page(items, req))
        return httpx.Response(404, json={"errors": [{"code": "not_found", "description": path}]})

    def transport(self) -> httpx.MockTransport:
        return httpx.MockTransport(self.handler)

    def confirm(self, pid: str, when: str | None = None, billing: str = "PIX") -> dict:
        p = self.payments[pid]
        p.update(status="RECEIVED", billingType=billing, paymentDate=when or date(2026, 9, 27).isoformat(),
                 clientPaymentDate=when or "2026-09-27")
        return p
