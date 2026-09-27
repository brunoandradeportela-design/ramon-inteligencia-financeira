"""Primitivas compartilhadas: dinheiro (Decimal), ids, datas, erros Problem Details."""
from __future__ import annotations

import calendar
import hashlib
import json
import secrets
import uuid
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta, timezone
from decimal import ROUND_HALF_UP, Decimal
from typing import Any

CENT = Decimal("0.01")


def D(value: Any) -> Decimal:
    """Converte para Decimal sem passar por float (evita erro de representação)."""
    if isinstance(value, Decimal):
        return value
    if isinstance(value, float):
        return Decimal(repr(value))
    return Decimal(str(value))


def money(value: Any) -> Decimal:
    return D(value).quantize(CENT, rounding=ROUND_HALF_UP)


def brl(value: Any) -> str:
    """Formata em reais: R$ 1.248.320,00"""
    v = money(value)
    sign = "-" if v < 0 else ""
    inteiro, dec = f"{abs(v):.2f}".split(".")
    grupos = []
    while inteiro:
        grupos.insert(0, inteiro[-3:])
        inteiro = inteiro[:-3]
    return f"{sign}R$ {'.'.join(grupos)},{dec}"


def pct(value: Any, casas: int = 1) -> str:
    q = Decimal(1).scaleb(-casas)
    v = (D(value) * 100).quantize(q, rounding=ROUND_HALF_UP)
    return f"{v}".replace(".", ",") + "%"


def new_id(prefix: str) -> str:
    return f"{prefix}_{uuid.uuid4().hex[:20]}"


def new_token() -> str:
    return secrets.token_urlsafe(32)


def sha256(data: bytes | str) -> str:
    if isinstance(data, str):
        data = data.encode()
    return hashlib.sha256(data).hexdigest()


def canonical_json(obj: Any) -> str:
    return json.dumps(obj, sort_keys=True, ensure_ascii=False, default=_json_default, separators=(",", ":"))


def _json_default(o: Any):
    if isinstance(o, Decimal):
        return str(o)
    if isinstance(o, (date, datetime)):
        return o.isoformat()
    if hasattr(o, "__dict__"):
        return o.__dict__
    raise TypeError(type(o))


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def month_key(d: date) -> str:
    return f"{d.year:04d}-{d.month:02d}"


def last_business_day(year: int, month: int) -> date:
    """Último dia útil (seg-sex) do mês. Feriados não são considerados — ver DECISÃO PENDENTE D-07."""
    d = date(year, month, calendar.monthrange(year, month)[1])
    while d.weekday() >= 5:
        d -= timedelta(days=1)
    return d


def next_month(year: int, month: int) -> tuple[int, int]:
    return (year + 1, 1) if month == 12 else (year, month + 1)


@dataclass
class DomainError(Exception):
    """Erro de domínio convertido em RFC 9457 Problem Details pela API."""

    status: int
    title: str
    detail: str = ""
    type: str = "about:blank"
    extra: dict = field(default_factory=dict)

    def __str__(self) -> str:  # pragma: no cover
        return f"{self.status} {self.title}: {self.detail}"


class NotFound(DomainError):
    def __init__(self, what: str):
        super().__init__(404, "Recurso não encontrado", what, "https://ramon.dev/problems/not-found")


class Forbidden(DomainError):
    def __init__(self, detail: str = "Acesso negado"):
        super().__init__(403, "Acesso negado", detail, "https://ramon.dev/problems/forbidden")


class Unauthorized(DomainError):
    def __init__(self, detail: str = "Autenticação necessária"):
        super().__init__(401, "Não autenticado", detail, "https://ramon.dev/problems/unauthorized")


class ValidationFailed(DomainError):
    def __init__(self, detail: str, errors: list | None = None):
        super().__init__(422, "Dados inválidos", detail, "https://ramon.dev/problems/validation", {"errors": errors or []})


class EntitlementRequired(DomainError):
    def __init__(self, feature: str, plan: str):
        super().__init__(402, "Recurso do plano superior", f"'{feature}' requer o plano {plan}.",
                         "https://ramon.dev/problems/entitlement", {"feature": feature, "required_plan": plan})
