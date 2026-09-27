"""Contrato único para provedores de dados (Plano técnico §8).

Regras: nunca solicitar/armazenar senha bancária ou token de segurança da instituição;
payload bruto separado do modelo canônico; erros mapeados para códigos estáveis.
"""
from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass


class ConnectorError(Exception):
    def __init__(self, code: str, message: str, retryable: bool = False):
        super().__init__(message)
        self.code, self.retryable = code, retryable


ERROR_CODES = {
    "CONSENT_REVOKED": "Consentimento revogado pelo titular",
    "CONSENT_EXPIRED": "Consentimento expirado",
    "INSTITUTION_UNAVAILABLE": "Instituição indisponível (tentar novamente)",
    "RATE_LIMITED": "Limite de requisições atingido",
    "SCOPE_NOT_GRANTED": "Escopo não autorizado",
    "PROVIDER_NOT_CONFIGURED": "Provedor de Open Finance ainda não contratado/homologado",
}


@dataclass
class RawPayload:
    source: str
    institution: str
    kind: str
    body: dict | list | str
    checksum: str


class ConnectorAdapter(ABC):
    name: str = "base"
    mode: str = "sandbox"           # sandbox | homologacao | producao

    @abstractmethod
    def connect(self, *, owner_id: str, institution: str, scopes: list[str], consent_id: str) -> dict: ...

    @abstractmethod
    def refresh(self, *, connection: dict) -> list[RawPayload]: ...

    @abstractmethod
    def revoke(self, *, connection: dict) -> None: ...

    @abstractmethod
    def health_check(self) -> dict: ...

    def get_accounts(self, connection: dict) -> list[RawPayload]:
        return [p for p in self.refresh(connection=connection) if p.kind == "accounts"]

    def get_transactions(self, connection: dict) -> list[RawPayload]:
        return [p for p in self.refresh(connection=connection) if p.kind == "transactions"]

    def get_credit_cards(self, connection: dict) -> list[RawPayload]:
        return [p for p in self.refresh(connection=connection) if p.kind == "credit_cards"]

    def get_investments(self, connection: dict) -> list[RawPayload]:
        return [p for p in self.refresh(connection=connection) if p.kind == "investments"]

    def get_positions(self, connection: dict) -> list[RawPayload]:
        return [p for p in self.refresh(connection=connection) if p.kind == "positions"]

    def get_events(self, connection: dict) -> list[RawPayload]:
        return [p for p in self.refresh(connection=connection) if p.kind == "events"]

    @staticmethod
    def map_errors(exc: Exception) -> ConnectorError:
        if isinstance(exc, ConnectorError):
            return exc
        return ConnectorError("INSTITUTION_UNAVAILABLE", str(exc), retryable=True)
