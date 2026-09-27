"""Adaptador Open Finance / Open Investment — modo SANDBOX.

Produção depende de parceiro/estrutura regulatória e homologação (DECISÃO PENDENTE D-01).
Este adaptador reproduz o fluxo de consentimento com redirecionamento e devolve payloads
fictícios (claramente marcados) para testes de ponta a ponta. Nenhuma credencial bancária
é solicitada ou armazenada: a autenticação ocorre na instituição transmissora.
"""
from __future__ import annotations

import json
from pathlib import Path

from connectors.base import ConnectorAdapter, ConnectorError, RawPayload
from services.common.core import sha256

FIXTURES = Path(__file__).parent / "fixtures"

# Matriz de cobertura versionada (Dossiê §50). Status técnico refere-se ao SANDBOX.
COVERAGE_MATRIX = {
    "version": "2026.09.1",
    "reference": "Diretório público Open Finance Brasil (consultado; atualização indicada 21/02/2026)",
    "institutions": [
        {"id": "nubank", "name": "Nubank", "type": "banco", "participant": True, "accounts": True, "investments": True,
         "classes": ["renda_fixa", "fundo"], "last_test": "2026-09-27", "status": "sandbox", "priority": "P0"},
        {"id": "itau", "name": "Itaú Unibanco", "type": "banco", "participant": True, "accounts": True, "investments": True,
         "classes": ["renda_fixa", "fundo", "previdencia"], "last_test": "2026-09-27", "status": "sandbox", "priority": "P0"},
        {"id": "xp", "name": "XP Investimentos", "type": "corretora", "participant": True, "accounts": True, "investments": True,
         "classes": ["acao", "etf", "fii", "renda_fixa", "tesouro", "fundo"], "last_test": "2026-09-27", "status": "sandbox", "priority": "P0"},
        {"id": "btg", "name": "BTG Pactual", "type": "banco/corretora", "participant": True, "accounts": True, "investments": True,
         "classes": ["acao", "etf", "renda_fixa", "fundo"], "last_test": None, "status": "nao_testado", "priority": "P1"},
        {"id": "bb", "name": "Banco do Brasil", "type": "banco", "participant": True, "accounts": True, "investments": True,
         "classes": ["renda_fixa", "fundo", "previdencia"], "last_test": None, "status": "nao_testado", "priority": "P1"},
    ],
}
SCOPES = {
    "accounts": "Contas e saldos",
    "transactions": "Transações",
    "credit_cards": "Cartões de crédito",
    "investments": "Investimentos (Open Investment)",
}


class OpenFinanceSandboxAdapter(ConnectorAdapter):
    name = "open_finance"
    mode = "sandbox"

    def connect(self, *, owner_id: str, institution: str, scopes: list[str], consent_id: str) -> dict:
        inst = next((i for i in COVERAGE_MATRIX["institutions"] if i["id"] == institution), None)
        if not inst:
            raise ConnectorError("INSTITUTION_UNAVAILABLE", "Instituição não suportada")
        bad = [s for s in scopes if s not in SCOPES]
        if bad:
            raise ConnectorError("SCOPE_NOT_GRANTED", f"Escopos inválidos: {bad}")
        # Em produção: URL de autorização da instituição transmissora (FAPI/OAuth2 + PAR).
        return {"redirect_url": f"#/conexoes/retorno?consent={consent_id}&institution={institution}&sandbox=1",
                "mode": self.mode}

    def refresh(self, *, connection: dict) -> list[RawPayload]:
        if connection["status"] == "revogado":
            raise ConnectorError("CONSENT_REVOKED", "Consentimento revogado")
        f = FIXTURES / f"{connection['institution_id']}.json"
        if not f.exists():
            return []
        data = json.loads(f.read_text(encoding="utf-8"))
        out = []
        for kind, body in data.items():
            if kind in connection["scope"] or (kind == "positions" and "investments" in connection["scope"]):
                out.append(RawPayload(source=f"open_finance:{connection['institution_id']}", institution=connection["institution"],
                                      kind=kind, body=body, checksum=sha256(json.dumps(body, sort_keys=True))))
        return out

    def revoke(self, *, connection: dict) -> None:
        return None

    def health_check(self) -> dict:
        return {"adapter": self.name, "mode": self.mode, "status": "ok",
                "production_ready": False, "pending_decision": "D-01 provedor/estrutura regulatória"}
