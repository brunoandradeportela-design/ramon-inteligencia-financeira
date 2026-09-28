"""Cobrança recorrente via Asaas + conciliação com o CRM.

Fluxos:
1. checkout  — cliente escolhe o plano e informa CPF/CNPJ (exigido pelo Asaas) → cria/recupera o cliente
   no Asaas, cria a assinatura mensal (billingType UNDEFINED: Pix, boleto ou cartão à escolha do cliente)
   e devolve o link da fatura (invoiceUrl).
2. webhook   — o Asaas avisa cada evento de cobrança (criada, confirmada, recebida, vencida, estornada,
   removida…). Idempotente pelo id do evento; autenticado pelo header `asaas-access-token`.
3. sync      — puxa TODAS as cobranças da conta Asaas (paginado) e concilia com os clientes do CRM.
   Cobranças de clientes que não existem na plataforma aparecem como "sem vínculo" — nada fica de fora.

O CPF/CNPJ vai direto ao Asaas; aqui só fica a versão mascarada (minimização LGPD).
"""
from __future__ import annotations

import hmac
import re
import threading
from datetime import date
from decimal import Decimal

from services.billing.asaas import METHOD_MAP, STATUS_MAP, AsaasClient, AsaasConfig
from services.billing.plans import PLANS
from services.common.core import D, DomainError, ValidationFailed, money, utcnow
from services.common.store import Store
from services.crm.service import CRMService
from services.identity.owner import cpf_is_valid
from services.identity.service import User

EVENT_KEEP = 20000


def cnpj_is_valid(v: str) -> bool:
    d = re.sub(r"\D", "", v or "")
    if len(d) != 14 or len(set(d)) == 1:
        return False
    nums = [int(x) for x in d]
    for n, w in ((12, [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]), (13, [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2])):
        r = sum(a * b for a, b in zip(nums[:n], w)) % 11
        if (0 if r < 2 else 11 - r) != nums[n]:
            return False
    return True


def doc_masked(v: str) -> str:
    d = re.sub(r"\D", "", v)
    return f"***.{d[3:6]}.{d[6:9]}-**" if len(d) == 11 else f"**.{d[2:5]}.{d[5:8]}/****-**"


def _plan_for_value(value: str) -> str:
    v = D(value)
    paid = [p for p in PLANS if p != "free"]
    exact = [p for p in paid if D(PLANS[p]["price_month"]) == v]
    if exact:
        return exact[0]
    below = [p for p in paid if D(PLANS[p]["price_month"]) <= v]
    return max(below, key=lambda p: D(PLANS[p]["price_month"])) if below else "pro"


class BillingService:
    def __init__(self, store: Store, crm: CRMService, identity, config: AsaasConfig | None = None, transport=None) -> None:
        self.store, self.crm, self.identity = store, crm, identity
        self.config = config
        self.client = AsaasClient(config, transport=transport) if config else None
        self._lock = threading.RLock()

    # ------------------------------------------------------------------ estado
    @property
    def enabled(self) -> bool:
        return self.client is not None

    def _require(self) -> AsaasClient:
        if not self.client:
            raise DomainError(503, "Gateway não configurado",
                              "Pagamentos online indisponíveis: defina RAMON_ASAAS_API_KEY no servidor.", extra={"code": "gateway_off"})
        return self.client

    def _state(self) -> dict:
        return self.store.gget("gateway_state", "asaas") or {"last_sync_at": None, "last_sync": None, "last_webhook_at": None,
                                                              "webhooks": 0, "last_error": None}

    def _save_state(self, **kw) -> None:
        self.store.gput("gateway_state", "asaas", {**self._state(), **kw})

    def status(self, live: bool = False) -> dict:
        st = self._state()
        out = {"provider": "Asaas", "configured": self.enabled, "env": self.config.env if self.config else None,
               "key_fingerprint": self.config.fingerprint if self.config else None,
               "webhook_token_configured": bool(self.config and self.config.webhook_token), **st}
        if live and self.enabled:
            try:
                out["balance"] = str(money(self.client.balance().get("balance", 0)))
                out["connection"] = "ok"
                try:
                    info = self.client.commercial_info()
                    out["account_name"] = info.get("companyName") or info.get("name")
                except DomainError:
                    out["account_name"] = None
            except DomainError as e:
                out["connection"] = "erro"
                out["connection_error"] = e.detail
                self._save_state(last_error=e.detail)
        return out

    # ------------------------------------------------------------------ vínculos
    def link(self, u: User) -> dict:
        return self.store.get("billing", u.id, "asaas") or {}

    def _user_for(self, payment: dict) -> User | None:
        ref = payment.get("externalReference") or ""
        if ref.startswith("usr_"):
            u = self.identity.get(ref)
            if u:
                return u
        cust = payment.get("customer")
        uid = self.store.gget("asaas_customers", cust) if cust else None
        if uid:
            return self.identity.get(uid)
        if cust and self.client:
            info = self._customer_info(cust)
            ref = info.get("externalReference") or ""
            u = self.identity.get(ref) if ref.startswith("usr_") else None
            if not u and info.get("email"):
                uid = self.store.gget("users_by_email", info["email"].strip().lower())
                u = self.identity.get(uid) if uid else None
            if u and "admin" not in u.roles:
                self.store.gput("asaas_customers", cust, u.id)
                return u
        return None

    def _customer_info(self, cust: str) -> dict:
        cached = self.store.gget("asaas_customer_cache", cust)
        if cached is None and self.client:
            try:
                c = self.client.get_customer(cust)
                cached = {"name": c.get("name"), "email": c.get("email"), "externalReference": c.get("externalReference")}
            except DomainError:
                cached = {}
            self.store.gput("asaas_customer_cache", cust, cached)
        return cached or {}

    # ------------------------------------------------------------------ checkout
    def checkout(self, u: User, plan: str, cpf_cnpj: str, today: date) -> dict:
        client = self._require()
        if plan not in PLANS or plan == "free":
            raise ValidationFailed("Escolha um plano pago (Pro ou Premium).")
        doc = re.sub(r"\D", "", cpf_cnpj or "")
        if not (cpf_is_valid(doc) or cnpj_is_valid(doc)):
            raise ValidationFailed("CPF ou CNPJ inválido.", [{"field": "cpf_cnpj", "msg": "Informe um CPF ou CNPJ válido"}])
        with self._lock:
            link = self.link(u)
            if link.get("subscription_id") and link.get("plan") == plan and link.get("status") == "ativa":
                pending = [p for p in client.subscription_payments(link["subscription_id"]) if p.get("status") in ("PENDING", "OVERDUE")]
                if pending:
                    self._ingest(pending[0])
                    return {"invoice_url": pending[0].get("invoiceUrl"), "subscription_id": link["subscription_id"], "reused": True}
            cust_id = link.get("customer_id")
            if not cust_id:
                found = client.find_customer(external_reference=u.id) or client.find_customer(cpf_cnpj=doc)
                cust_id = found["id"] if found else client.create_customer(
                    name=u.name, cpf_cnpj=doc, email=u.email, mobile_phone=u.phone.removeprefix("+55"), external_reference=u.id)["id"]
            if link.get("subscription_id") and link.get("status") == "ativa":
                try:
                    client.cancel_subscription(link["subscription_id"])
                except DomainError:
                    pass
            sub = client.create_subscription(customer=cust_id, value=PLANS[plan]["price_month"], next_due_date=today.isoformat(),
                                             description=f"Fintechs · Plano {PLANS[plan]['name']} (mensal)", external_reference=u.id)
            link = {"customer_id": cust_id, "subscription_id": sub["id"], "plan": plan, "status": "ativa",
                    "doc_masked": doc_masked(doc), "created_at": utcnow().isoformat()}
            self.store.put("billing", u.id, "asaas", link)
            self.store.gput("asaas_customers", cust_id, u.id)
            self.crm.set_plan(u, plan, status="aguardando_pagamento")
            s = self.crm.subscription(u)
            s["next_due"], s["gateway"] = today.isoformat(), "asaas"
            pays = client.subscription_payments(sub["id"])
            for p in pays:
                self._ingest(p)
            first = next((p for p in pays if p.get("invoiceUrl")), None)
            return {"invoice_url": first.get("invoiceUrl") if first else None, "subscription_id": sub["id"], "reused": False}

    # ------------------------------------------------------------------ conciliação
    def _ingest(self, p: dict, deleted: bool = False) -> dict:
        """Grava a cobrança no registro geral e, se houver cliente vinculado, no CRM. Idempotente por id."""
        gid = p["id"]
        u = self._user_for(p)
        status_gw = "DELETED" if deleted or p.get("deleted") else p.get("status", "PENDING")
        status = "cancelado" if status_gw == "DELETED" else STATUS_MAP.get(status_gw, "pendente")
        method = METHOD_MAP.get(p.get("billingType", "UNDEFINED"), "a_definir")
        due = p.get("dueDate") or (p.get("dateCreated") or "")[:10]
        paid_on = p.get("clientPaymentDate") or p.get("paymentDate") or p.get("confirmedDate")
        rec = {"id": gid, "user_id": u.id if u else None, "customer_id": p.get("customer"),
               "customer_name": u.name if u else self._customer_info(p.get("customer", "")).get("name") if p.get("customer") else None,
               "customer_email": u.email if u else self._customer_info(p.get("customer", "")).get("email") if p.get("customer") else None,
               "value": str(money(p.get("value", 0))), "net_value": str(money(p.get("netValue") or p.get("value", 0))),
               "method": method, "status": status, "status_gateway": status_gw, "due_date": due, "paid_date": paid_on,
               "invoice_url": p.get("invoiceUrl"), "description": p.get("description") or "", "subscription_id": p.get("subscription"),
               "created_at": p.get("dateCreated"), "updated_at": utcnow().isoformat(), "origin": "asaas"}
        self.store.gput("gateway_payments", gid, rec)
        if u:
            if u.plan == "free" and status in ("pago", "pendente", "atrasado"):
                # cobrança feita direto no Asaas para um cliente ainda no Free: plano deduzido pelo valor
                self.crm.set_plan(u, _plan_for_value(rec["value"]), status="aguardando_pagamento")
            if status == "cancelado":
                self.store.delete("payments", u.id, gid)
            else:
                self.crm.upsert_gateway_payment(u, gid, amount=rec["value"], method=method, status=status,
                                                date_=paid_on or due, due_date=due, period=due[:7], reference=gid,
                                                invoice_url=rec["invoice_url"])
        return rec

    def handle_webhook(self, token: str | None, body: dict) -> dict:
        if not self.config or not self.config.webhook_token:
            raise DomainError(503, "Webhook não configurado", "Defina RAMON_ASAAS_WEBHOOK_TOKEN no servidor.")
        if not token or not hmac.compare_digest(token, self.config.webhook_token):
            raise DomainError(401, "Não autorizado", "Token do webhook inválido.")
        evt_id, event = body.get("id") or "", body.get("event") or ""
        with self._lock:
            if evt_id and self.store.gget("asaas_events", evt_id):
                return {"received": True, "duplicate": True}
            result: dict = {"received": True, "event": event}
            if body.get("payment"):
                rec = self._ingest(body["payment"], deleted=event == "PAYMENT_DELETED")
                result.update(payment_id=rec["id"], status=rec["status"], matched=bool(rec["user_id"]))
            elif body.get("subscription") and event in ("SUBSCRIPTION_DELETED", "SUBSCRIPTION_INACTIVATED"):
                sub = body["subscription"]
                u = self._user_for({"externalReference": sub.get("externalReference"), "customer": sub.get("customer")})
                if u and self.link(u).get("subscription_id") == sub.get("id"):
                    link = {**self.link(u), "status": "cancelada"}
                    self.store.put("billing", u.id, "asaas", link)
                    self.crm.subscription(u)["status"] = "cancelada"
                    result["cancelled_user"] = u.id
            if evt_id:
                self.store.gput("asaas_events", evt_id, utcnow().isoformat())
            st = self._state()
            self._save_state(last_webhook_at=utcnow().isoformat(), webhooks=st.get("webhooks", 0) + 1)
            return result

    def sync(self, since: date | None = None) -> dict:
        client = self._require()
        started = utcnow().isoformat()
        try:
            filters = {"dateCreated[ge]": since.isoformat()} if since else {}
            items = client.list_payments(**filters)
            with self._lock:
                recs = [self._ingest(p) for p in items]
        except DomainError as e:
            self._save_state(last_error=e.detail, last_sync_at=started, last_sync={"ok": False, "error": e.detail})
            raise
        summary = {"ok": True, "fetched": len(recs), "matched": sum(1 for r in recs if r["user_id"]),
                   "unmatched": sum(1 for r in recs if not r["user_id"]), "started_at": started}
        self._save_state(last_sync_at=started, last_sync=summary, last_error=None)
        return summary

    # ------------------------------------------------------------------ visão geral para o dono (CRM)
    def all_payments(self, users: list[User], *, status: str = "", method: str = "", origin: str = "", q: str = "",
                     date_from: str = "", date_to: str = "") -> dict:
        items: dict[str, dict] = {}
        for rec in self.store.glist("gateway_payments"):
            if rec["status"] != "cancelado":
                items[rec["id"]] = dict(rec)
        for u in users:
            for p in self.crm.payments(u):
                if p["id"] in items:
                    continue
                items[p["id"]] = {"id": p["id"], "user_id": u.id, "customer_id": None, "customer_name": u.name,
                                  "customer_email": u.email, "value": p["amount"], "net_value": p["amount"], "method": p["method"],
                                  "status": p["status"], "status_gateway": None, "due_date": p.get("due_date") or p["date"],
                                  "paid_date": p["date"] if p["status"] == "pago" else None, "invoice_url": p.get("invoice_url"),
                                  "description": f"Período {p['period']}", "subscription_id": None, "created_at": p.get("recorded_at"),
                                  "origin": p.get("origin", "manual"), "recorded_by": p.get("recorded_by")}
        rows = list(items.values())
        if status:
            rows = [r for r in rows if r["status"] == status]
        if method:
            rows = [r for r in rows if r["method"] == method]
        if origin:
            rows = [r for r in rows if (r["origin"] == origin) or (origin == "sem_vinculo" and not r["user_id"])]
        if q:
            ql = q.lower().strip()
            rows = [r for r in rows if ql in (r["customer_name"] or "").lower() or ql in (r["customer_email"] or "").lower()
                    or ql in r["id"].lower() or ql in (r["description"] or "").lower()]

        def ref_date(r):
            return (r["paid_date"] or r["due_date"] or "")[:10]
        if date_from:
            rows = [r for r in rows if ref_date(r) >= date_from]
        if date_to:
            rows = [r for r in rows if ref_date(r) <= date_to]
        rows.sort(key=lambda r: (ref_date(r), r["created_at"] or ""), reverse=True)

        def tot(st, field="value"):
            return str(money(sum((D(r[field]) for r in rows if r["status"] == st), Decimal(0))))
        totals = {"recebido": tot("pago"), "recebido_liquido": tot("pago", "net_value"), "pendente": tot("pendente"),
                  "atrasado": tot("atrasado"), "estornado": tot("estornado"),
                  "count": {s: sum(1 for r in rows if r["status"] == s) for s in ("pago", "pendente", "atrasado", "estornado")},
                  "sem_vinculo": sum(1 for r in rows if not r["user_id"])}
        return {"total": len(rows), "totals": totals, "items": rows}

    def export_csv(self, rows: list[dict]) -> str:
        import csv
        import io
        buf = io.StringIO()
        w = csv.writer(buf, delimiter=";")
        w.writerow(["id", "cliente", "email", "valor", "valor_liquido", "forma", "status", "status_asaas", "vencimento",
                    "pagamento", "origem", "descricao", "fatura"])
        for r in rows:
            w.writerow([r["id"], r["customer_name"] or "", r["customer_email"] or "", r["value"].replace(".", ","),
                        r["net_value"].replace(".", ","), r["method"], r["status"], r["status_gateway"] or "", r["due_date"] or "",
                        (r["paid_date"] or "")[:10], r["origin"], r["description"], r["invoice_url"] or ""])
        return buf.getvalue()

