"""Modelo canônico do Data Hub (após normalização/reconciliação)."""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date
from decimal import Decimal

ASSET_CLASSES = {
    "acao": "Renda Variável",
    "etf": "Renda Variável",
    "bdr": "Renda Variável",
    "fii": "Renda Variável",
    "renda_fixa": "Renda Fixa",
    "tesouro": "Renda Fixa",
    "fundo": "Fundos",
    "previdencia": "Previdência",
    "caixa": "Outros",
    "outro": "Outros",
}


@dataclass
class Lineage:
    """Linhagem obrigatória: SOURCE -> RAW -> ... (Plano técnico §7)."""
    source: str                 # manual | file:<nome> | open_finance:<instituicao>
    institution: str
    raw_id: str | None = None
    ingested_at: str = ""
    competence: str = ""        # data de competência
    verified_at: str = ""       # última verificação
    parser_version: str = "1.0"
    reconciliation: str = "pending"   # pending | reconciled | duplicate | divergent
    quality: float = 1.0


@dataclass
class Account:
    id: str
    owner_id: str
    institution: str
    kind: str                   # corrente | poupanca | investimento | cartao
    name: str
    balance: Decimal
    lineage: Lineage


@dataclass
class Transaction:
    id: str
    owner_id: str
    account_id: str
    date: date
    description: str
    amount: Decimal             # positivo = entrada, negativo = saída
    category: str
    fingerprint: str
    lineage: Lineage


@dataclass
class Trade:
    """Operação em bolsa (nota de corretagem)."""
    id: str
    owner_id: str
    date: date
    ticker: str
    asset_class: str            # acao | etf | fii | bdr
    side: str                   # C | V
    quantity: Decimal
    price: Decimal
    fees: Decimal
    daytrade: bool
    broker: str
    fingerprint: str
    lineage: Lineage

    @property
    def gross(self) -> Decimal:
        return self.quantity * self.price


@dataclass
class Holding:
    """Posição não-bolsa (renda fixa, fundos, previdência) informada por custodiante."""
    id: str
    owner_id: str
    asset_id: str
    name: str
    asset_class: str
    custodian: str
    value: Decimal
    invested: Decimal
    as_of: date
    liquidity_days: int
    lineage: Lineage
    extra: dict = field(default_factory=dict)


@dataclass
class Quote:
    ticker: str
    price: Decimal
    as_of: date
    source: str
