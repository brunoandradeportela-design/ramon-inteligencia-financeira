"""API v1 — Ramon Inteligência Financeira (FastAPI, modular monolith).

Execução:  uvicorn apps.api.main:app --reload
Contrato:  GET /openapi.json  (exportado em packages/contracts/openapi.json)
"""
from __future__ import annotations

import base64
import logging
import os
import threading
import time
import uuid
from dataclasses import asdict
from datetime import date as Date
from decimal import Decimal

from fastapi import Depends, FastAPI, Header, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from apps.api.container import Container, reference_date
from database.seeds.demo import seed
from services.identity.owner import complete_setup, ensure_owner
from services.billing import plans
from services.common.core import DomainError, Forbidden, NotFound, ValidationFailed
from services.identity.service import User

log = logging.getLogger("ramon.api")
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")

app = FastAPI(title="Ramon Inteligência Financeira — API", version="1.0.0",
              description="Consolidar, analisar, simular, alertar e explicar. A IA interpreta; os motores calculam.")
app.add_middleware(CORSMiddleware, allow_origins=os.environ.get("RAMON_CORS", "*").split(","), allow_methods=["*"],
                   allow_headers=["*"], expose_headers=["X-Correlation-ID"])

C = Container()
if os.environ.get("RAMON_SEED_DEMO", "1") == "1":
    seed(C)
OWNER = ensure_owner(C.identity)


def _asaas_background_sync() -> None:
    """Sincronização periódica com o Asaas (rede de segurança caso algum webhook se perca)."""
    minutes = max(5, int(os.environ.get("RAMON_ASAAS_SYNC_MINUTES", "15")))
    while True:
        try:
            r = C.billing.sync()
            log.info("asaas sync ok: %s cobranças (%s vinculadas)", r["fetched"], r["matched"])
        except Exception as e:  # noqa: BLE001 — nunca derruba a API
            log.warning("asaas sync falhou: %s", getattr(e, "detail", type(e).__name__))
        time.sleep(minutes * 60)


if C.billing.enabled and os.environ.get("RAMON_ASAAS_SYNC", "1") == "1":
    threading.Thread(target=_asaas_background_sync, name="asaas-sync", daemon=True).start()
IDEMPOTENCY: dict[tuple[str, str], dict] = {}


# ------------------------------------------------------------------ middleware / erros
@app.middleware("http")
async def correlation(request: Request, call_next):
    cid = request.headers.get("X-Correlation-ID") or uuid.uuid4().hex
    request.state.cid = cid
    t0 = time.perf_counter()
    resp = await call_next(request)
    resp.headers["X-Correlation-ID"] = cid
    resp.headers["X-Content-Type-Options"] = "nosniff"
    resp.headers["Cache-Control"] = "no-store"
    log.info("cid=%s %s %s -> %s %.1fms", cid, request.method, request.url.path, resp.status_code, (time.perf_counter() - t0) * 1000)
    return resp


@app.exception_handler(DomainError)
async def domain_error(request: Request, exc: DomainError):
    body = {"type": exc.type, "title": exc.title, "status": exc.status, "detail": exc.detail,
            "instance": request.url.path, "correlation_id": getattr(request.state, "cid", "-"), **exc.extra}
    return JSONResponse(body, status_code=exc.status, media_type="application/problem+json")


def cid(request: Request) -> str:
    return request.state.cid


def current_user(authorization: str | None = Header(default=None)) -> User:
    token = authorization.split(" ", 1)[1] if authorization and authorization.lower().startswith("bearer ") else None
    return C.identity.authenticate(token)


def entitled(feature: str):
    def dep(user: User = Depends(current_user)) -> User:
        plans.require(user.plan, feature)
        return user
    return dep


def idempotent(request: Request, key: str | None, user: User, compute):
    if not key:
        return compute()
    k = (user.id, key)
    if k in IDEMPOTENCY:
        return IDEMPOTENCY[k]
    res = compute()
    IDEMPOTENCY[k] = res
    return res


# ------------------------------------------------------------------ schemas
class RegisterIn(BaseModel):
    name: str = Field(description="Nome completo (obrigatório)")
    email: str = Field(description="E-mail (obrigatório)")
    profession: str = Field(description="Profissão (obrigatório)")
    phone: str = Field(description="Telefone com DDD (obrigatório)")
    password: str
    accept_terms: bool
    plan: str = "free"
    origin: str = "site"


class LoginIn(BaseModel):
    email: str
    password: str


class ConsentIn(BaseModel):
    institution_id: str
    scope: list[str]


class ConfirmIn(BaseModel):
    consent_id: str


class SaleOp(BaseModel):
    ticker: str
    quantity: Decimal
    price: Decimal | None = None
    date: Date | None = None
    fees: Decimal = Decimal("0")


class Scenario(BaseModel):
    name: str | None = None
    operations: list[SaleOp] = Field(default_factory=list)


class SimulationIn(BaseModel):
    kind: str = Field(pattern="^(venda_ativos|pgbl)$")
    scenarios: list[Scenario] = Field(default_factory=list)
    taxable_income: Decimal | None = None
    current_contributions: Decimal = Decimal("0")
    extra_contribution: Decimal = Decimal("0")
    marginal_rate: Decimal = Decimal("0.275")
    full_model: bool = True
    contributes_social_security: bool = True


class AssistantIn(BaseModel):
    question: str = Field(min_length=2, max_length=800)
    thread_id: str | None = None


class ThemeIn(BaseModel):
    theme: str = Field(pattern="^(light|dark|system)$")


class AlertStatusIn(BaseModel):
    status: str


class DocumentIn(BaseModel):
    filename: str
    mime: str = ""
    content_base64: str


class TaxPrefsIn(BaseModel):
    prior_losses: dict[str, Decimal] = Field(default_factory=dict)
    paid_darfs: dict[str, Decimal] = Field(default_factory=dict)


class CrmUpdateIn(BaseModel):
    stage: str | None = None
    clear_override: bool = False
    tags: list[str] | None = None
    next_action: str | None = None
    next_action_date: str | None = None
    plan: str | None = None


class CrmNoteIn(BaseModel):
    text: str = Field(min_length=1, max_length=2000)
    kind: str = "nota"


class CrmPaymentIn(BaseModel):
    amount: Decimal
    method: str = "pix"
    status: str = "pago"
    date: Date
    period: str
    reference: str = ""


class TradeIn(BaseModel):
    date: Date
    ticker: str
    side: str = Field(pattern="^(C|V)$")
    quantity: Decimal = Field(gt=0)
    price: Decimal = Field(gt=0)
    fees: Decimal = Decimal("0")
    daytrade: bool = False
    broker: str = "Não informada"


# ------------------------------------------------------------------ rotas
@app.get("/health")
def health():
    return {"status": "ok", "reference_date": reference_date().isoformat(), "open_finance": C.of_adapter.health_check(),
            "rules_catalog": C.rules.catalog.get("catalog_version")}


@app.post("/v1/auth/register", status_code=201)
def register(body: RegisterIn, request: Request):
    u = C.identity.register(email=body.email, name=body.name, password=body.password, accept_terms=body.accept_terms,
                            phone=body.phone, profession=body.profession, plan=body.plan, origin=body.origin)
    C.crm.subscription(u)
    C.audit.record(owner_id=u.id, actor=u.id, resource="user", action="cadastro",
                   after={"email": u.email, "plan": u.plan, "profession": u.profession}, correlation_id=cid(request))
    token, _ = C.identity.login(email=body.email, password=body.password)
    return {"token": token, "user": u.public()}


@app.post("/v1/auth/login")
def login(body: LoginIn, request: Request, user_agent: str | None = Header(default=None)):
    token, u = C.identity.login(email=body.email, password=body.password, device=user_agent or "")
    C.audit.record(owner_id=u.id, actor=u.id, resource="session", action="login", correlation_id=cid(request))
    return {"token": token, "user": u.public()}


@app.post("/v1/auth/logout", status_code=204)
def logout(authorization: str = Header()):
    C.identity.logout(authorization.split(" ", 1)[1])


@app.get("/v1/me")
def me(user: User = Depends(current_user)):
    return user.public() | {"entitlements": sorted(plans.PLANS[user.plan]["features"])}


@app.get("/v1/plans")
def list_plans():
    return {"items": plans.catalog()}


@app.get("/v1/dashboard")
def dashboard(user: User = Depends(entitled("dashboard"))):
    return C.dashboard(user)


@app.get("/v1/finance/summary")
def finance(months: int = Query(6, ge=1, le=24), user: User = Depends(entitled("financas"))):
    return C.finance_summary(user, months)


@app.get("/v1/finance/transactions")
def transactions(limit: int = Query(50, le=500), offset: int = 0, category: str | None = None,
                 user: User = Depends(entitled("financas"))):
    items = sorted(C.store.list("transactions", user.id, lambda t: category is None or t.category == category),
                   key=lambda t: t.date, reverse=True)
    page = items[offset: offset + limit]
    return {"total": len(items), "limit": limit, "offset": offset,
            "items": [{"id": t.id, "date": t.date.isoformat(), "description": t.description, "amount": str(t.amount),
                       "category": t.category, "source": t.lineage.source, "reconciliation": t.lineage.reconciliation} for t in page]}


@app.get("/v1/portfolio/consolidated")
def portfolio(user: User = Depends(entitled("patrimonio"))):
    return C.portfolio(user)


@app.post("/v1/portfolio/trades", status_code=201)
def add_trade(body: TradeIn, request: Request, user: User = Depends(entitled("patrimonio")),
              idempotency_key: str | None = Header(default=None)):
    def run():
        r = C.hub.add_trades(user.id, [body.model_dump()], source="manual", raw_id=None)
        C.audit.record(owner_id=user.id, actor=user.id, resource="trade", action="criado", after=body.model_dump(mode="json"),
                       correlation_id=cid(request))
        return r
    return idempotent(request, idempotency_key, user, run)


@app.get("/v1/tax/summary")
def tax_summary(year: int | None = None, user: User = Depends(entitled("inteligencia_tributaria"))):
    r = C.tax_result(user, year)
    d = asdict(r)
    d.pop("events")
    return d


@app.get("/v1/tax/events")
def tax_events(year: int | None = None, user: User = Depends(entitled("inteligencia_tributaria"))):
    r = C.tax_result(user, year)
    return {"items": [asdict(e) for e in r.events], "snapshot_hash": r.snapshot_hash}


@app.get("/v1/tax/rules")
def tax_rules():
    return {"catalog": C.rules.catalog, "items": C.rules.listing()}


@app.put("/v1/tax/preferences")
def tax_prefs(body: TaxPrefsIn, request: Request, user: User = Depends(entitled("inteligencia_tributaria"))):
    before = C.store.get("tax_prefs", user.id, "prefs")
    prefs = {"prior_losses": {k: str(v) for k, v in body.prior_losses.items() if k in ("comum", "daytrade", "fii")},
             "paid_darfs": {k: str(v) for k, v in body.paid_darfs.items()}}
    C.store.put("tax_prefs", user.id, "prefs", prefs)
    C.audit.record(owner_id=user.id, actor=user.id, resource="tax_prefs", action="atualizado", before=before, after=prefs,
                   correlation_id=cid(request))
    return prefs


@app.post("/v1/simulations", status_code=201)
def simulate(body: SimulationIn, request: Request, user: User = Depends(entitled("simulacao")),
             idempotency_key: str | None = Header(default=None)):
    def run():
        ref = reference_date()
        if body.kind == "pgbl":
            if body.taxable_income is None:
                raise ValidationFailed("Informe taxable_income para simular PGBL.")
            res = C.simulation.pgbl(taxable_income=body.taxable_income, current_contributions=body.current_contributions,
                                    extra_contribution=body.extra_contribution, marginal_rate=body.marginal_rate,
                                    full_model=body.full_model, contributes_social_security=body.contributes_social_security,
                                    reference=ref)
        else:
            prefs = C.store.get("tax_prefs", user.id, "prefs") or {}
            res = C.simulation.sale_scenarios(owner_id=user.id, trades=C.store.list("trades", user.id), quotes=C._quotes(),
                                              year=ref.year, reference=ref, prior_losses=prefs.get("prior_losses"),
                                              scenarios=[s.model_dump(mode="json") for s in body.scenarios])
        res["inputs"] = body.model_dump(mode="json")
        C.store.put("simulations", user.id, res["id"], res)
        C.audit.record(owner_id=user.id, actor=user.id, resource=f"simulation:{res['id']}", action="calculado",
                       after={"kind": res["kind"], "hash": res["reproducibility_hash"]}, correlation_id=cid(request))
        return res
    return idempotent(request, idempotency_key, user, run)


@app.get("/v1/simulations")
def list_sims(user: User = Depends(entitled("simulacao"))):
    return {"items": sorted(C.store.list("simulations", user.id), key=lambda s: s["created_at"], reverse=True)}


@app.get("/v1/alerts")
def alerts(user: User = Depends(current_user)):
    items = C.alerts(user)
    return {"items": items, "limited": not plans.has(user.plan, "radar")}


@app.patch("/v1/alerts/{alert_id}")
def alert_status(alert_id: str, body: AlertStatusIn, request: Request, user: User = Depends(current_user)):
    return C.set_alert_status(user, alert_id, body.status, cid(request))


@app.get("/v1/documents")
def documents(user: User = Depends(entitled("documentos"))):
    return {"items": C.documents(user)}


@app.post("/v1/documents", status_code=201)
def upload(body: DocumentIn, request: Request, user: User = Depends(entitled("documentos"))):
    try:
        content = base64.b64decode(body.content_base64, validate=True)
    except Exception:
        raise ValidationFailed("content_base64 inválido")
    doc = C.documents_engine.receive(user.id, body.filename, body.mime, content)
    if doc.mime == "text/csv":
        res = C.hub.import_csv(user.id, doc.filename, content)
        doc.extraction = res
        doc.status = "utilizado" if res.get("accepted") else ("validado" if not res.get("errors") else "extraido")
    C.store.put("documents", user.id, doc.id, doc)
    C.audit.record(owner_id=user.id, actor=user.id, resource=f"document:{doc.id}", action="upload",
                   after={"filename": doc.filename, "kind": doc.kind, "checksum": doc.checksum}, correlation_id=cid(request))
    return doc.public()


@app.get("/v1/institutions")
def institutions():
    return C.institutions()


@app.get("/v1/connections")
def connections(user: User = Depends(entitled("conexoes"))):
    return {"items": C.connections(user), "adapter": C.of_adapter.health_check()}


@app.post("/v1/connections/consents", status_code=201)
def create_consent(body: ConsentIn, request: Request, user: User = Depends(entitled("conexoes"))):
    return C.start_connection(user, body.institution_id, body.scope, cid(request))


@app.post("/v1/connections/consents/confirm")
def confirm_consent(body: ConfirmIn, request: Request, user: User = Depends(entitled("conexoes"))):
    return C.confirm_connection(user, body.consent_id, cid(request))


@app.post("/v1/connections/{conn_id}/refresh")
def refresh(conn_id: str, request: Request, user: User = Depends(entitled("conexoes"))):
    return C.refresh_connection(user, conn_id, cid(request))


@app.post("/v1/connections/{conn_id}/revoke")
def revoke(conn_id: str, request: Request, user: User = Depends(entitled("conexoes"))):
    return C.revoke_connection(user, conn_id, cid(request))


@app.get("/v1/consents")
def consents(user: User = Depends(current_user)):
    return {"items": C.consent.list(user.id)}


@app.post("/v1/assistant/query")
def assistant(body: AssistantIn, request: Request, user: User = Depends(entitled("assistente_ia"))):
    return C.assistant(user, body.question, body.thread_id, cid(request))


@app.get("/v1/theme-preference")
def get_theme(user: User = Depends(current_user)):
    return {"theme": user.theme}


@app.put("/v1/theme-preference")
def put_theme(body: ThemeIn, user: User = Depends(current_user)):
    user.theme = body.theme     # RN-12: tema não altera dados, cálculos ou resultados
    return {"theme": user.theme}


@app.get("/v1/audit")
def audit(user: User = Depends(current_user)):
    return {"chain_valid": C.audit.verify_chain(user.id), "items": [asdict(e) for e in C.audit.list(user.id)][-200:]}


@app.get("/v1/privacy/export")
def export_data(request: Request, user: User = Depends(current_user)):
    """Portabilidade (LGPD art. 18, V)."""
    C.audit.record(owner_id=user.id, actor=user.id, resource="privacy", action="exportacao", correlation_id=cid(request))
    return {"user": user.public(), "portfolio": C.portfolio(user), "finance": C.finance_summary(user, 12),
            "consents": C.consent.list(user.id), "documents": C.documents(user)}


@app.delete("/v1/privacy/account", status_code=202)
def delete_account(request: Request, user: User = Depends(current_user)):
    """Eliminação (LGPD art. 18, VI). Trilhas de auditoria são retidas conforme obrigação legal (a validar juridicamente)."""
    C.audit.record(owner_id=user.id, actor=user.id, resource="privacy", action="eliminacao_solicitada", correlation_id=cid(request))
    C.store.purge_owner(user.id)
    C.store.gdelete("users_by_email", user.email)
    C.store.gdelete("users", user.id)
    return {"status": "eliminado", "retained": ["audit"]}


# ------------------------------------------------------------------ CRM (somente administradores)
def admin_user(user: User = Depends(current_user)) -> User:
    if "admin" not in user.roles:
        raise Forbidden("Área restrita ao administrador da plataforma.")
    return user


def _customer(cid_: str) -> User:
    u = C.identity.get(cid_)
    if not u or "admin" in u.roles:
        raise NotFound("Cliente")
    return u


@app.get("/v1/admin/crm/metrics")
def crm_metrics(admin: User = Depends(admin_user)):
    return C.crm.metrics(C.identity.all_customers(), reference_date())


@app.get("/v1/admin/crm/customers")
def crm_customers(q: str = "", stage: str = "", plan: str = "", admin: User = Depends(admin_user)):
    items = C.crm.list(C.identity.all_customers(), reference_date(), q=q, stage=stage, plan=plan)
    return {"total": len(items), "items": items}


@app.get("/v1/admin/crm/customers/{customer_id}")
def crm_customer(customer_id: str, request: Request, admin: User = Depends(admin_user)):
    u = _customer(customer_id)
    C.audit.record(owner_id=u.id, actor=admin.id, resource="crm", action="acesso_administrador",
                   reason="acompanhamento comercial", correlation_id=cid(request))
    return C.crm.detail(u, reference_date(), C.audit.list(u.id))


@app.patch("/v1/admin/crm/customers/{customer_id}")
def crm_update(customer_id: str, body: CrmUpdateIn, request: Request, admin: User = Depends(admin_user)):
    u = _customer(customer_id)
    before = {**C.crm.meta(u), "plan": u.plan}
    if body.plan:
        C.crm.set_plan(u, body.plan)
    m = C.crm.update(u, stage=body.stage, tags=body.tags, next_action=body.next_action,
                     next_action_date=body.next_action_date, clear_override=body.clear_override)
    C.audit.record(owner_id=u.id, actor=admin.id, resource="crm", action="atualizado", before=before,
                   after={**m, "plan": u.plan}, correlation_id=cid(request))
    return C.crm.summary(u, reference_date())


@app.post("/v1/admin/crm/customers/{customer_id}/notes", status_code=201)
def crm_note(customer_id: str, body: CrmNoteIn, request: Request, admin: User = Depends(admin_user)):
    u = _customer(customer_id)
    n = C.crm.add_note(u, text=body.text, kind=body.kind, author=admin.name)
    C.audit.record(owner_id=u.id, actor=admin.id, resource="crm", action="anotacao", after={"kind": n["kind"]}, correlation_id=cid(request))
    return n


@app.post("/v1/admin/crm/customers/{customer_id}/payments", status_code=201)
def crm_payment(customer_id: str, body: CrmPaymentIn, request: Request, admin: User = Depends(admin_user),
                idempotency_key: str | None = Header(default=None)):
    u = _customer(customer_id)

    def run():
        p = C.crm.record_payment(u, amount=body.amount, method=body.method, status=body.status, date_=body.date.isoformat(),
                                 period=body.period, reference=body.reference, recorded_by=admin.name)
        C.audit.record(owner_id=u.id, actor=admin.id, resource=f"payment:{p['id']}", action="pagamento_registrado",
                       after=p, correlation_id=cid(request))
        return p
    return idempotent(request, idempotency_key, admin, run)


@app.get("/v1/admin/crm/export.csv")
def crm_export(q: str = "", stage: str = "", plan: str = "", request: Request = None, admin: User = Depends(admin_user)):
    from fastapi.responses import Response
    items = C.crm.list(C.identity.all_customers(), reference_date(), q=q, stage=stage, plan=plan)
    C.audit.record(owner_id=admin.id, actor=admin.id, resource="crm", action="exportacao", after={"linhas": len(items)},
                   correlation_id=cid(request))
    return Response("\ufeff" + C.crm.export_csv(items), media_type="text/csv; charset=utf-8",
                    headers={"Content-Disposition": "attachment; filename=clientes.csv"})


# ------------------------------------------------------------------ Pagamentos (Asaas)
class CheckoutIn(BaseModel):
    plan: str = Field(description="pro | premium")
    cpf_cnpj: str = Field(description="CPF ou CNPJ do pagador (exigido pelo Asaas; enviado ao gateway e guardado só mascarado)")


@app.post("/v1/billing/checkout")
def billing_checkout(body: CheckoutIn, request: Request, user: User = Depends(current_user),
                     idempotency_key: str | None = Header(default=None)):
    def run():
        r = C.billing.checkout(user, body.plan, body.cpf_cnpj, reference_date())
        C.audit.record(owner_id=user.id, actor=user.id, resource="billing", action="checkout",
                       after={"plan": body.plan, "subscription_id": r["subscription_id"]}, correlation_id=cid(request))
        return r
    return idempotent(request, idempotency_key, user, run)


@app.get("/v1/billing/subscription")
def billing_subscription(user: User = Depends(current_user)):
    link = C.billing.link(user)
    return {"gateway": "asaas" if C.billing.enabled else None, "plan": user.plan, "subscription": C.crm.subscription(user),
            "payer_doc": link.get("doc_masked"), "payments": C.crm.payments(user)}


@app.post("/v1/webhooks/asaas")
def asaas_webhook(body: dict, asaas_access_token: str | None = Header(default=None)):
    """Endpoint configurado no painel do Asaas (Integrações → Webhooks). Sempre responde 200 a eventos válidos."""
    return C.billing.handle_webhook(asaas_access_token, body)


@app.get("/v1/admin/payments")
def admin_payments(status: str = "", method: str = "", origin: str = "", q: str = "", date_from: str = "", date_to: str = "",
                   admin: User = Depends(admin_user)):
    return C.billing.all_payments(C.identity.all_customers(), status=status, method=method, origin=origin, q=q,
                                  date_from=date_from, date_to=date_to)


@app.get("/v1/admin/payments/export.csv")
def admin_payments_export(status: str = "", method: str = "", origin: str = "", q: str = "", date_from: str = "", date_to: str = "",
                          request: Request = None, admin: User = Depends(admin_user)):
    from fastapi.responses import Response
    data = C.billing.all_payments(C.identity.all_customers(), status=status, method=method, origin=origin, q=q,
                                  date_from=date_from, date_to=date_to)
    C.audit.record(owner_id=admin.id, actor=admin.id, resource="payments", action="exportacao",
                   after={"linhas": data["total"]}, correlation_id=cid(request))
    return Response("\ufeff" + C.billing.export_csv(data["items"]), media_type="text/csv; charset=utf-8",
                    headers={"Content-Disposition": "attachment; filename=pagamentos.csv"})


@app.get("/v1/admin/payments/gateway")
def admin_gateway(live: bool = False, admin: User = Depends(admin_user)):
    return C.billing.status(live=live)


@app.post("/v1/admin/payments/sync")
def admin_sync(request: Request, admin: User = Depends(admin_user)):
    r = C.billing.sync()
    C.audit.record(owner_id=admin.id, actor=admin.id, resource="payments", action="sincronizacao_asaas", after=r,
                   correlation_id=cid(request))
    return r


class OwnerSetupIn(BaseModel):
    token: str
    password: str


@app.post("/v1/auth/owner/setup")
def owner_setup(body: OwnerSetupIn, request: Request):
    """Define a senha do dono na primeira inicialização (token exibido no log do servidor)."""
    u = complete_setup(C.identity, body.token, body.password)
    C.audit.record(owner_id=u.id, actor=u.id, resource="owner", action="senha_definida", correlation_id=cid(request))
    return {"status": "ok"}


# ------------------------------------------------------------------ equipe (somente o dono)
def owner_user(user: User = Depends(current_user)) -> User:
    if "owner" not in user.roles:
        raise Forbidden("Somente o dono da plataforma gerencia administradores.")
    return user


class TeamIn(BaseModel):
    admin: bool


@app.get("/v1/admin/team")
def team(owner: User = Depends(owner_user)):
    admins = [u for u in C.store.glist("users") if "admin" in u.roles]
    return {"items": [{"id": u.id, "name": u.name, "email": u.email, "roles": u.roles} for u in admins]}


@app.patch("/v1/admin/team/{user_id}")
def team_update(user_id: str, body: TeamIn, request: Request, owner: User = Depends(owner_user)):
    u = C.identity.get(user_id)
    if not u:
        raise NotFound("Usuário")
    if "owner" in u.roles:
        raise DomainError(409, "Operação inválida", "O dono não pode perder o acesso de administrador.")
    before = list(u.roles)
    u.roles = sorted(set(u.roles) | {"admin"}) if body.admin else [r for r in u.roles if r != "admin"] or ["titular"]
    C.audit.record(owner_id=u.id, actor=owner.id, resource="roles", action="alterado", before=before, after=u.roles,
                   correlation_id=cid(request))
    return {"id": u.id, "roles": u.roles}
