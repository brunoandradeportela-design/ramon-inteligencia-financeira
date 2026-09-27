"""Camada de aplicação: compõe os serviços do modular monolith e expõe casos de uso por titular."""
from __future__ import annotations

import os
from dataclasses import asdict
from datetime import date
from decimal import Decimal

from connectors.base import ConnectorError
from connectors.open_finance.adapter import COVERAGE_MATRIX, SCOPES, OpenFinanceSandboxAdapter
from services.ai_orchestrator.orchestrator import AIOrchestrator
from services.alert_engine.engine import AlertEngine
from services.audit.log import AuditLog
from services.billing import plans
from services.common.core import D, DomainError, NotFound, money, new_id, utcnow
from services.common.store import Store
from services.consent.service import Connection, ConsentService, connection_status
from services.crm.service import CRMService
from services.document_engine.engine import DocumentEngine
from services.financial_engine.engine import FinancialEngine
from services.identity.service import IdentityService, User
from services.ingestion.hub import DataHub
from services.notification_engine.service import NotificationService
from services.portfolio_engine.engine import PortfolioEngine
from services.simulation_engine.engine import SimulationEngine
from services.tax_engine.engine import RuleRegistry, TaxEngine


def reference_date() -> date:
    """Data de referência dos cálculos. RAMON_REFERENCE_DATE fixa a data (demo/testes reprodutíveis)."""
    env = os.environ.get("RAMON_REFERENCE_DATE")
    return date.fromisoformat(env) if env else date.today()


class Container:
    def __init__(self, store: Store | None = None) -> None:
        self.store = store or Store()
        self.audit = AuditLog(self.store)
        self.identity = IdentityService(self.store)
        self.consent = ConsentService(self.store)
        self.hub = DataHub(self.store)
        self.rules = RuleRegistry()
        self.tax = TaxEngine(self.rules)
        self.finance = FinancialEngine()
        self.portfolio_engine = PortfolioEngine()
        self.simulation = SimulationEngine(self.tax)
        self.alerts_engine = AlertEngine()
        self.documents_engine = DocumentEngine()
        self.notifications = NotificationService(self.store)
        self.of_adapter = OpenFinanceSandboxAdapter()
        self.crm = CRMService(self.store)

    # ------------------------------------------------------------------ leituras de domínio
    def _trades(self, uid):
        return self.store.list("trades", uid)

    def _quotes(self):
        return {q.ticker: q for q in self.store.glist("quotes")}

    def tax_result(self, user: User, year: int | None = None):
        ref = reference_date()
        prefs = self.store.get("tax_prefs", user.id, "prefs") or {}
        return self.tax.compute(self._trades(user.id), year=year or ref.year, reference_date=ref,
                                prior_losses=prefs.get("prior_losses"), paid_darfs=prefs.get("paid_darfs"))

    def portfolio(self, user: User) -> dict:
        accounts = self.store.list("accounts", user.id)
        cash = sum((a.balance for a in accounts if a.kind in ("corrente", "poupanca")), Decimal("0"))
        return self.portfolio_engine.consolidate(trades=self._trades(user.id), holdings=self.store.list("holdings", user.id),
                                                 quotes=self._quotes(), cash=cash)

    def finance_summary(self, user: User, months: int = 6) -> dict:
        return self.finance.summary(transactions=self.store.list("transactions", user.id),
                                    accounts=self.store.list("accounts", user.id), period_months=months,
                                    reference=reference_date())

    def documents(self, user: User) -> list[dict]:
        docs = [d.public() for d in self.store.list("documents", user.id)]
        return sorted(docs, key=lambda d: d["uploaded_at"], reverse=True)

    def connections(self, user: User) -> list[dict]:
        out = []
        for c in self.store.list("connections", user.id):
            consent = self.consent.get(user.id, c.consent_id)
            c.status = connection_status(c, consent)
            d = asdict(c)
            d["consent"] = {"id": consent.id, "status": consent.status, "expires_at": consent.expires_at,
                            "purpose": consent.purpose, "scope_labels": [SCOPES[s] for s in consent.scope]}
            out.append(d)
        return sorted(out, key=lambda c: c["institution"])

    def alerts(self, user: User, tax=None, portfolio=None) -> list[dict]:
        tax = tax or self.tax_result(user)
        portfolio = portfolio or self.portfolio(user)
        statuses = self.store.get("alert_status", user.id, "map") or {}
        items = self.alerts_engine.generate(tax=tax, portfolio=portfolio, documents=self.documents(user),
                                            connections=self.connections(user), reference=reference_date(), statuses=statuses)
        if not plans.has(user.plan, "radar"):
            items = items[: plans.FREE_ALERT_LIMIT]
        return items

    def set_alert_status(self, user: User, alert_id: str, status: str, cid: str) -> dict:
        if status not in ("novo", "visto", "resolvido"):
            raise DomainError(422, "Status inválido", status)
        m = self.store.get("alert_status", user.id, "map") or {}
        before = m.get(alert_id, "novo")
        m[alert_id] = status
        self.store.put("alert_status", user.id, "map", m)
        self.audit.record(owner_id=user.id, actor=user.id, resource=f"alert:{alert_id}", action="status",
                          before=before, after=status, correlation_id=cid)
        return {"id": alert_id, "status": status}

    def dashboard(self, user: User) -> dict:
        tax = self.tax_result(user)
        pf = self.portfolio(user)
        fin = self.finance_summary(user)
        al = self.alerts(user, tax, pf)
        open_alerts = [a for a in al if a["status"] != "resolvido"]
        # evolução patrimonial estimada (fluxo líquido acumulado para trás) — rotulada como estimativa
        total = D(pf["total"])
        series, running = [], total
        for m in reversed(fin["series"]):
            series.insert(0, {"month": m["month"], "value": str(money(running))})
            running -= D(m["net"])
        first = D(series[0]["value"]) if series else total
        monthly_tax = [{"month": m.month, "value": str(money(D(m.tax_due_gross)))} for m in tax.months]
        ref = reference_date()
        next_actions = []
        for a in open_alerts[:3]:
            next_actions.append({"title": a["title"], "detail": a["detail"], "severity": a["severity"], "action": a.get("action")})
        return {
            "greeting": user.name.split(" ")[0],
            "reference_date": ref.isoformat(),
            "net_worth": {"total": pf["total"], "variation_pct": float((total - first) / first) if first else 0.0,
                          "series": series, "series_kind": "estimativa a partir do fluxo líquido"},
            "tax": {"year": tax.year, "estimated": tax.total_tax_due, "irrf": tax.total_irrf,
                    "exempt": tax.total_exempt_gain, "monthly": monthly_tax, "confidence": tax.confidence,
                    "kind": "estimativa", "scope": "renda variável (bolsa)"},
            "alerts": {"open": len(open_alerts), "critical": sum(1 for a in open_alerts if a["severity"] in ("critico", "alto"))},
            "allocation": pf["allocation"],
            "next_actions": next_actions,
            "changes": fin["changes"][:3],
            "liquidity": fin["liquidity"],
            "plan": user.plan,
        }

    # ------------------------------------------------------------------ conexões
    def institutions(self) -> dict:
        return COVERAGE_MATRIX

    def start_connection(self, user: User, institution_id: str, scope: list[str], cid: str) -> dict:
        inst = next((i for i in COVERAGE_MATRIX["institutions"] if i["id"] == institution_id), None)
        if not inst:
            raise NotFound("Instituição")
        consent = self.consent.create(owner_id=user.id, institution=inst, scope=scope)
        try:
            redirect = self.of_adapter.connect(owner_id=user.id, institution=institution_id, scopes=scope, consent_id=consent.id)
        except ConnectorError as e:
            raise DomainError(422, "Conexão não iniciada", str(e), extra={"code": e.code})
        now = utcnow().isoformat()
        conn = Connection(id=new_id("con"), owner_id=user.id, institution_id=inst["id"], institution=inst["name"],
                          institution_type=inst["type"], consent_id=consent.id, scope=consent.scope, status="pendente",
                          mode=self.of_adapter.mode, created_at=now, updated_at=now)
        self.store.put("connections", user.id, conn.id, conn)
        self.audit.record(owner_id=user.id, actor=user.id, resource=f"consent:{consent.id}", action="solicitado",
                          after={"institution": inst["name"], "scope": consent.scope}, correlation_id=cid)
        return {"connection_id": conn.id, "consent_id": consent.id, **redirect}

    def confirm_connection(self, user: User, consent_id: str, cid: str) -> dict:
        self.consent.confirm(user.id, consent_id)
        conn = next(c for c in self.store.list("connections", user.id) if c.consent_id == consent_id)
        self.audit.record(owner_id=user.id, actor=user.id, resource=f"consent:{consent_id}", action="autorizado", correlation_id=cid)
        return self.refresh_connection(user, conn.id, cid)

    def refresh_connection(self, user: User, conn_id: str, cid: str) -> dict:
        conn = self.store.get("connections", user.id, conn_id)
        if not conn:
            raise NotFound("Conexão")
        consent = self.consent.get(user.id, conn.consent_id)
        conn.status = connection_status(conn, consent)
        if conn.status in ("revogado", "pendente"):
            raise DomainError(409, "Conexão inativa", f"Status: {conn.status}")
        started = utcnow()
        try:
            payloads = self.of_adapter.refresh(connection={**asdict(conn), "status": conn.status})
            stats = self.hub.ingest_connector(user.id, conn, payloads)
            conn.error_code = None
            conn.data_quality_score = 1.0 if payloads else 0.5
            result = "ok"
        except ConnectorError as e:
            stats, conn.error_code, result = {}, e.code, "erro"
        conn.last_sync_at = utcnow().isoformat()
        conn.updated_at = conn.last_sync_at
        conn.sync_runs.insert(0, {"id": new_id("sync"), "started_at": started.isoformat(), "result": result, "stats": stats})
        conn.sync_runs = conn.sync_runs[:10]
        self.audit.record(owner_id=user.id, actor=user.id, resource=f"connection:{conn_id}", action="sincronizado",
                          after={"result": result, "stats": stats}, correlation_id=cid)
        return {"connection": next(c for c in self.connections(user) if c["id"] == conn_id), "stats": stats}

    def revoke_connection(self, user: User, conn_id: str, cid: str) -> dict:
        conn = self.store.get("connections", user.id, conn_id)
        if not conn:
            raise NotFound("Conexão")
        self.consent.revoke(user.id, conn.consent_id)
        self.of_adapter.revoke(connection=asdict(conn))
        conn.status = "revogado"
        conn.updated_at = utcnow().isoformat()
        self.audit.record(owner_id=user.id, actor=user.id, resource=f"consent:{conn.consent_id}", action="revogado",
                          reason="solicitação do titular", correlation_id=cid)
        return next(c for c in self.connections(user) if c["id"] == conn_id)

    # ------------------------------------------------------------------ IA
    def assistant(self, user: User, question: str, thread_id: str | None, cid: str) -> dict:
        tools = {
            "tax": lambda: _tax_dict(self.tax_result(user)),
            "portfolio": lambda: self.portfolio(user),
            "finance": lambda: self.finance_summary(user),
            "alerts": lambda: {"items": self.alerts(user)},
            "documents": lambda: {"items": self.documents(user)},
            "simulations": lambda: {"items": sorted(self.store.list("simulations", user.id), key=lambda s: s["created_at"], reverse=True)},
        }
        allowed = {"portfolio", "finance", "documents", "alerts"}
        if plans.has(user.plan, "inteligencia_tributaria"):
            allowed |= {"tax", "simulations"}
        ans = AIOrchestrator(tools).ask(question, thread_id=thread_id, correlation_id=cid, allowed_tools=allowed)
        rec = asdict(ans)
        self.store.put("ai_messages", user.id, ans.id, rec)
        self.audit.record(owner_id=user.id, actor=user.id, resource=f"ai:{ans.thread_id}", action="consulta",
                          after={"intent": ans.intent, "guardrail": ans.guardrail, "tools": [c["tool"] for c in ans.tool_calls],
                                 "consistency_ok": ans.consistency_ok}, correlation_id=cid)
        return rec


def _tax_dict(r) -> dict:
    d = asdict(r)
    return d
