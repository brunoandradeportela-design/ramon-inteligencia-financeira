"""Consent & Permission Engine — consentimento como entidade de primeira classe (RN-08, RN-09).

Status da conexão: pendente | ativo | expirando | revogado | erro.
"""
from __future__ import annotations

from dataclasses import asdict, dataclass, field
from datetime import datetime, timedelta

from services.common.core import DomainError, NotFound, ValidationFailed, new_id, utcnow
from services.common.store import Store

PURPOSES = {"consolidacao": "Consolidar contas e investimentos para diagnóstico financeiro e tributário"}
EXPIRING_WINDOW = timedelta(days=15)


@dataclass
class Consent:
    id: str
    owner_id: str
    institution_id: str
    institution: str
    scope: list
    purpose: str
    status: str
    created_at: str
    expires_at: str
    confirmed_at: str | None = None
    revoked_at: str | None = None
    events: list = field(default_factory=list)


@dataclass
class Connection:
    id: str
    owner_id: str
    institution_id: str
    institution: str
    institution_type: str
    consent_id: str
    scope: list
    status: str
    mode: str
    last_sync_at: str | None = None
    next_refresh_at: str | None = None
    error_code: str | None = None
    data_quality_score: float | None = None
    created_at: str = ""
    updated_at: str = ""
    sync_runs: list = field(default_factory=list)


class ConsentService:
    def __init__(self, store: Store) -> None:
        self.store = store

    def create(self, *, owner_id: str, institution: dict, scope: list[str], months: int = 12) -> Consent:
        if not scope:
            raise ValidationFailed("Selecione ao menos um tipo de dado para compartilhar.")
        if not 1 <= months <= 12:
            raise ValidationFailed("Prazo do consentimento deve ser de 1 a 12 meses.")
        now = utcnow()
        c = Consent(id=new_id("cns"), owner_id=owner_id, institution_id=institution["id"], institution=institution["name"],
                    scope=sorted(set(scope)), purpose=PURPOSES["consolidacao"], status="pendente",
                    created_at=now.isoformat(), expires_at=(now + timedelta(days=30 * months)).isoformat(),
                    events=[{"at": now.isoformat(), "event": "solicitado"}])
        self.store.put("consents", owner_id, c.id, c)
        return c

    def confirm(self, owner_id: str, consent_id: str) -> Consent:
        c = self.get(owner_id, consent_id)
        if c.status != "pendente":
            raise DomainError(409, "Consentimento em estado inválido", f"Status atual: {c.status}")
        c.status, c.confirmed_at = "ativo", utcnow().isoformat()
        c.events.append({"at": c.confirmed_at, "event": "autorizado_na_instituicao"})
        return c

    def revoke(self, owner_id: str, consent_id: str) -> Consent:
        c = self.get(owner_id, consent_id)
        if c.status == "revogado":
            return c
        c.status, c.revoked_at = "revogado", utcnow().isoformat()
        c.events.append({"at": c.revoked_at, "event": "revogado_pelo_titular"})
        return c

    def get(self, owner_id: str, consent_id: str) -> Consent:
        c = self.store.get("consents", owner_id, consent_id)
        if not c:
            raise NotFound("Consentimento")
        return c

    def list(self, owner_id: str) -> list[dict]:
        return [asdict(c) for c in sorted(self.store.list("consents", owner_id), key=lambda c: c.created_at, reverse=True)]


def connection_status(conn: Connection, consent: Consent, now: datetime | None = None) -> str:
    now = now or utcnow()
    if consent.status == "revogado":
        return "revogado"
    if consent.status == "pendente":
        return "pendente"
    exp = datetime.fromisoformat(consent.expires_at)
    if exp < now:
        return "revogado"
    if conn.error_code:
        return "erro"
    if exp - now <= EXPIRING_WINDOW:
        return "expirando"
    return "ativo"
