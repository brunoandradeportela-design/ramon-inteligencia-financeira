"""Audit — registro append-only com encadeamento de hash (adulteração detectável)."""
from __future__ import annotations

from dataclasses import asdict, dataclass
from typing import Any

from services.common.core import canonical_json, new_id, sha256, utcnow
from services.common.store import Store

SENSITIVE_KEYS = {"password", "senha", "token", "access_token", "refresh_token", "secret", "cpf", "authorization"}


def redact(obj: Any) -> Any:
    """Remove segredos/PII desnecessária antes de registrar (plano técnico §14)."""
    if isinstance(obj, dict):
        return {k: ("***" if k.lower() in SENSITIVE_KEYS else redact(v)) for k, v in obj.items()}
    if isinstance(obj, list):
        return [redact(v) for v in obj]
    return obj


@dataclass(frozen=True)
class AuditEntry:
    id: str
    seq: int
    at: str
    actor: str
    owner_id: str
    resource: str
    action: str
    before: Any
    after: Any
    origin: str
    reason: str
    correlation_id: str
    prev_hash: str
    hash: str


class AuditLog:
    COLLECTION = "audit"

    def __init__(self, store: Store) -> None:
        self.store = store

    def record(self, *, owner_id: str, actor: str, resource: str, action: str, before: Any = None,
               after: Any = None, origin: str = "api", reason: str = "", correlation_id: str = "-") -> AuditEntry:
        entries = self.list(owner_id)
        prev = entries[-1].hash if entries else "0" * 64
        seq = len(entries) + 1
        body = {
            "seq": seq, "at": utcnow().isoformat(), "actor": actor, "owner_id": owner_id,
            "resource": resource, "action": action, "before": redact(before), "after": redact(after),
            "origin": origin, "reason": reason, "correlation_id": correlation_id, "prev_hash": prev,
        }
        h = sha256(canonical_json(body))
        entry = AuditEntry(id=new_id("aud"), hash=h, **body)
        self.store.put(self.COLLECTION, owner_id, f"{seq:010d}", entry)
        return entry

    def list(self, owner_id: str) -> list[AuditEntry]:
        return sorted(self.store.list(self.COLLECTION, owner_id), key=lambda e: e.seq)

    def verify_chain(self, owner_id: str) -> bool:
        prev = "0" * 64
        for e in self.list(owner_id):
            body = {k: v for k, v in asdict(e).items() if k not in ("id", "hash")}
            if e.prev_hash != prev or sha256(canonical_json(body)) != e.hash:
                return False
            prev = e.hash
        return True
