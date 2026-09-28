"""CRM — acompanhamento comercial de todos os clientes: cadastro → ativação → pagamento → retenção.

Princípio de minimização (LGPD): o CRM mostra dados cadastrais, comerciais e sinais de uso
(contagens), nunca o patrimônio, transações ou impostos do cliente.
Pagamentos chegam do gateway Asaas (webhook + sincronização, ver services/billing/gateway.py) e
também podem ser registrados manualmente (Pix direto, dinheiro, transferência).
"""
from __future__ import annotations

import csv
import io
from collections import Counter
from datetime import date, datetime, timedelta
from decimal import Decimal

from services.billing.plans import PLANS, TICKET_TARGET
from services.common.core import D, ValidationFailed, money, new_id, utcnow
from services.common.store import Store
from services.identity.service import User, format_phone

STAGES = [
    ("novo_cadastro", "Novo cadastro"),
    ("ativado", "Ativado"),
    ("aguardando_pagamento", "Aguardando pagamento"),
    ("pagante", "Pagante"),
    ("inadimplente", "Inadimplente"),
    ("cancelado", "Cancelado"),
]
STAGE_KEYS = [k for k, _ in STAGES]
PAYMENT_METHODS = {"pix", "cartao", "boleto", "transferencia", "a_definir"}
PAYMENT_STATUS = {"pago", "pendente", "atrasado", "estornado"}
NOTE_KINDS = {"nota", "ligacao", "whatsapp", "email", "reuniao"}
GRACE_DAYS = 3          # tolerância após o vencimento de uma renovação
FIRST_PAYMENT_GRACE = 7  # prazo para o primeiro pagamento após o cadastro


def _d(s: str | None) -> date | None:
    if not s:
        return None
    return datetime.fromisoformat(s).date() if "T" in s else date.fromisoformat(s)


def _add_month(d: date) -> date:
    y, m = (d.year + 1, 1) if d.month == 12 else (d.year, d.month + 1)
    day = min(d.day, 28)
    return date(y, m, day)


class CRMService:
    def __init__(self, store: Store) -> None:
        self.store = store

    # ------------------------------------------------------------------ assinatura
    def subscription(self, u: User) -> dict:
        sub = self.store.get("subscriptions", u.id, "current")
        if not sub:
            price = PLANS.get(u.plan, PLANS["free"])["price_month"]
            sub = {"plan": u.plan, "price_month": price, "started_at": u.created_at[:10],
                   "status": "gratuita" if u.plan == "free" else "aguardando_pagamento",
                   "next_due": None if u.plan == "free" else u.created_at[:10]}
            self.store.put("subscriptions", u.id, "current", sub)
        return sub

    def payments(self, u: User) -> list[dict]:
        return sorted(self.store.list("payments", u.id), key=lambda p: p["date"], reverse=True)

    def _activity(self, u: User) -> dict:
        return {"connections": len(self.store.list("connections", u.id)),
                "documents": len(self.store.list("documents", u.id)),
                "trades": len(self.store.list("trades", u.id)),
                "transactions": len(self.store.list("transactions", u.id)),
                "simulations": len(self.store.list("simulations", u.id)),
                "ai_questions": len(self.store.list("ai_messages", u.id))}

    def auto_stage(self, u: User, today: date) -> str:
        sub = self.subscription(u)
        if sub["status"] == "cancelada":
            return "cancelado"
        if u.plan != "free":
            paid = [p for p in self.payments(u) if p["status"] == "pago"]
            due = _d(sub.get("next_due"))
            if sub["status"] == "inadimplente" or (paid and due and due + timedelta(days=GRACE_DAYS) < today):
                return "inadimplente"
            if paid:
                return "pagante"
            if due and due + timedelta(days=FIRST_PAYMENT_GRACE) < today and sub["status"] != "trial":
                return "inadimplente"
            return "aguardando_pagamento"
        act = self._activity(u)
        return "ativado" if (act["connections"] or act["documents"] or act["trades"] or act["transactions"]) else "novo_cadastro"

    def meta(self, u: User) -> dict:
        return self.store.get("crm", u.id, "meta") or {"stage_override": None, "tags": [], "next_action": "", "next_action_date": None}

    # ------------------------------------------------------------------ visões
    def summary(self, u: User, today: date) -> dict:
        sub, meta, pays = self.subscription(u), self.meta(u), self.payments(u)
        auto = self.auto_stage(u, today)
        paid = [p for p in pays if p["status"] == "pago"]
        digits = u.phone.removeprefix("+")
        return {
            "id": u.id, "name": u.name, "email": u.email, "phone": u.phone, "phone_display": format_phone(u.phone),
            "whatsapp_url": f"https://wa.me/{digits}" if digits else None, "profession": u.profession,
            "plan": u.plan, "plan_name": PLANS.get(u.plan, PLANS["free"])["name"], "origin": u.origin,
            "stage": meta.get("stage_override") or auto, "stage_auto": auto, "stage_overridden": bool(meta.get("stage_override")),
            "subscription": sub, "created_at": u.created_at, "last_login_at": u.last_login_at or None,
            "activity": self._activity(u), "total_paid": str(money(sum((D(p["amount"]) for p in paid), Decimal(0)))),
            "last_payment": pays[0] if pays else None, "tags": meta.get("tags", []), "next_action": meta.get("next_action", ""),
            "next_action_date": meta.get("next_action_date"),
        }

    def list(self, users: list[User], today: date, *, q: str = "", stage: str = "", plan: str = "") -> list[dict]:
        items = [self.summary(u, today) for u in users]
        if q:
            ql = q.lower().strip()
            digits = "".join(c for c in ql if c.isdigit()) if "@" not in ql else ""
            digits = digits if len(digits) >= 4 else ""
            items = [i for i in items if ql in i["name"].lower() or ql in i["email"] or ql in i["profession"].lower()
                     or (digits and digits in i["phone"])]
        if stage:
            items = [i for i in items if i["stage"] == stage]
        if plan:
            items = [i for i in items if i["plan"] == plan]
        return sorted(items, key=lambda i: i["created_at"], reverse=True)

    def detail(self, u: User, today: date, audit_entries: list) -> dict:
        s = self.summary(u, today)
        notes = sorted(self.store.list("crm_notes", u.id), key=lambda n: n["at"], reverse=True)
        timeline = [{"at": u.created_at, "kind": "cadastro", "text": f"Cadastro no plano {s['plan_name']} (origem: {u.origin})"}]
        if u.last_login_at:
            timeline.append({"at": u.last_login_at, "kind": "acesso", "text": "Último acesso à plataforma"})
        for e in audit_entries:
            if e.action in ("autorizado", "revogado", "upload", "calculado", "consulta"):
                timeline.append({"at": e.at, "kind": "uso", "text": {"autorizado": "Conectou uma instituição (Open Finance)",
                                 "revogado": "Revogou um consentimento", "upload": "Enviou um documento",
                                 "calculado": "Fez uma simulação", "consulta": "Usou o assistente IA"}[e.action]})
        for p in self.payments(u):
            timeline.append({"at": p["date"], "kind": "pagamento", "text": f"Pagamento {p['status']}: R$ {p['amount']} via {p['method']} ({p['period']})"})
        for n in notes:
            timeline.append({"at": n["at"], "kind": n["kind"], "text": n["text"], "author": n["author"]})
        timeline.sort(key=lambda t: t["at"], reverse=True)
        return {**s, "payments": self.payments(u), "notes": notes, "timeline": timeline[:80]}

    def metrics(self, users: list[User], today: date) -> dict:
        items = [self.summary(u, today) for u in users]
        by_stage = Counter(i["stage"] for i in items)
        created = [_d(i["created_at"]) for i in items]
        paying = [i for i in items if i["stage"] == "pagante"]
        mrr = sum((D(i["subscription"]["price_month"]) for i in paying), Decimal(0))
        month_start = today.replace(day=1)
        revenue_month = Decimal(0)
        overdue_value = Decimal(0)
        for u in users:
            for p in self.payments(u):
                if p["status"] == "pago" and _d(p["date"]) >= month_start:
                    revenue_month += D(p["amount"])
        for i in items:
            if i["stage"] == "inadimplente":
                overdue_value += D(i["subscription"]["price_month"])
        weeks = []
        for w in range(7, -1, -1):
            start = today - timedelta(days=today.weekday()) - timedelta(weeks=w)
            end = start + timedelta(days=7)
            weeks.append({"week_start": start.isoformat(), "signups": sum(1 for c in created if c and start <= c < end)})
        total = len(items)
        return {
            "total": total,
            "new_7d": sum(1 for c in created if c and c > today - timedelta(days=7)),
            "new_30d": sum(1 for c in created if c and c > today - timedelta(days=30)),
            "paying": len(paying), "mrr": str(money(mrr)), "arr": str(money(mrr * 12)),
            "ticket_medio": str(money(mrr / len(paying))) if paying else "0.00", "ticket_target": TICKET_TARGET,
            "ticket_ok": bool(paying) and mrr / len(paying) > D(TICKET_TARGET),
            "revenue_month": str(money(revenue_month)), "overdue": by_stage.get("inadimplente", 0), "overdue_value": str(money(overdue_value)),
            "conversion": (len(paying) / total) if total else 0.0,
            "activation": (sum(1 for i in items if i["stage"] != "novo_cadastro") / total) if total else 0.0,
            "stages": [{"key": k, "label": lab, "count": by_stage.get(k, 0)} for k, lab in STAGES],
            "signups_by_week": weeks,
            "by_profession": [{"profession": p, "count": c} for p, c in Counter(i["profession"] for i in items).most_common(8)],
            "by_plan": [{"plan": PLANS[p]["name"], "count": sum(1 for i in items if i["plan"] == p)} for p in PLANS],
            "pricing_note": "Preços: Pro R$ 89,90 e Premium R$ 149,90 (ticket médio acima de R$ 80). Pagamentos via Asaas (webhook + sincronização) e registros manuais.",
        }

    # ------------------------------------------------------------------ escrita
    def update(self, u: User, *, stage: str | None = None, tags: list[str] | None = None, next_action: str | None = None,
               next_action_date: str | None = None, clear_override: bool = False) -> dict:
        m = self.meta(u)
        if stage is not None:
            if stage not in STAGE_KEYS:
                raise ValidationFailed(f"Etapa inválida. Use: {', '.join(STAGE_KEYS)}")
            m["stage_override"] = stage
        if clear_override:
            m["stage_override"] = None
        if tags is not None:
            m["tags"] = sorted({t.strip()[:30] for t in tags if t.strip()})[:12]
        if next_action is not None:
            m["next_action"] = next_action.strip()[:200]
        if next_action_date is not None:
            m["next_action_date"] = next_action_date or None
        self.store.put("crm", u.id, "meta", m)
        return m

    def add_note(self, u: User, *, text: str, kind: str, author: str) -> dict:
        if kind not in NOTE_KINDS:
            raise ValidationFailed(f"Tipo inválido. Use: {', '.join(sorted(NOTE_KINDS))}")
        if not text.strip():
            raise ValidationFailed("Escreva a anotação.")
        n = {"id": new_id("nte"), "at": utcnow().isoformat(), "kind": kind, "text": text.strip()[:2000], "author": author}
        self.store.put("crm_notes", u.id, n["id"], n)
        return n

    def record_payment(self, u: User, *, amount, method: str, status: str, date_: str, period: str,
                       reference: str = "", recorded_by: str, origin: str = "manual") -> dict:
        if method not in PAYMENT_METHODS:
            raise ValidationFailed(f"Forma de pagamento inválida. Use: {', '.join(sorted(PAYMENT_METHODS))}")
        if status not in PAYMENT_STATUS:
            raise ValidationFailed(f"Status inválido. Use: {', '.join(sorted(PAYMENT_STATUS))}")
        amt = money(amount)
        if amt <= 0:
            raise ValidationFailed("Valor deve ser positivo.")
        try:
            pay_date = date.fromisoformat(date_)
        except ValueError:
            raise ValidationFailed("Data inválida (use AAAA-MM-DD).")
        p = {"id": new_id("pay"), "date": pay_date.isoformat(), "amount": str(amt), "method": method, "status": status,
             "period": period[:20], "reference": reference[:80], "recorded_by": recorded_by, "origin": origin,
             "recorded_at": utcnow().isoformat()}
        self.store.put("payments", u.id, p["id"], p)
        sub = self.subscription(u)
        if status == "pago":
            sub["status"] = "ativa"
            base = _d(sub.get("next_due")) or pay_date
            if base < pay_date - timedelta(days=31):
                base = pay_date
            sub["next_due"] = _add_month(base).isoformat()
        elif status == "atrasado":
            sub["status"] = "inadimplente"
        return p

    def upsert_gateway_payment(self, u: User, gid: str, *, amount, method: str, status: str, date_: str, due_date: str,
                               period: str, reference: str, invoice_url: str | None) -> dict:
        """Cobrança vinda do gateway: cria ou atualiza pelo id do Asaas (idempotente)."""
        prev = self.store.get("payments", u.id, gid)
        p = {"id": gid, "date": (date_ or due_date)[:10], "due_date": due_date[:10], "amount": str(money(amount)),
             "method": method if method in PAYMENT_METHODS else "a_definir", "status": status if status in PAYMENT_STATUS else "pendente",
             "period": period[:20], "reference": reference[:80], "recorded_by": "Asaas", "origin": "asaas",
             "invoice_url": invoice_url, "recorded_at": (prev or {}).get("recorded_at") or utcnow().isoformat(),
             "updated_at": utcnow().isoformat()}
        self.store.put("payments", u.id, gid, p)
        sub = self.subscription(u)
        if p["status"] == "pago":
            sub["status"] = "ativa"
            nxt = _add_month(date.fromisoformat(p["due_date"])).isoformat()
            if not sub.get("next_due") or nxt > sub["next_due"] or sub["next_due"] <= p["due_date"]:
                sub["next_due"] = nxt
        elif p["status"] == "atrasado":
            sub["status"] = "inadimplente"
        return p

    def set_plan(self, u: User, plan: str, status: str | None = None) -> dict:
        if plan not in PLANS:
            raise ValidationFailed("Plano inválido.")
        u.plan = plan
        sub = self.subscription(u)
        sub["plan"], sub["price_month"] = plan, PLANS[plan]["price_month"]
        if status:
            sub["status"] = status
        elif plan == "free":
            sub["status"], sub["next_due"] = "gratuita", None
        return sub

    def export_csv(self, items: list[dict]) -> str:
        buf = io.StringIO()
        w = csv.writer(buf, delimiter=";")
        w.writerow(["nome", "email", "telefone", "profissao", "plano", "etapa", "cadastro", "ultimo_acesso",
                    "total_pago", "proximo_vencimento", "proxima_acao"])
        for i in items:
            w.writerow([i["name"], i["email"], i["phone_display"], i["profession"], i["plan_name"], i["stage"],
                        i["created_at"][:10], (i["last_login_at"] or "")[:10], i["total_paid"].replace(".", ","),
                        i["subscription"].get("next_due") or "", i["next_action"]])
        return buf.getvalue()
