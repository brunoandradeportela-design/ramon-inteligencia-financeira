"""Portfolio / Wealth Engine — posições, composição, concentração, liquidez e evolução.

Descritivo e analítico. NÃO emite recomendação de compra/venda (Dossiê §6, RN-04).
"""
from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass
from decimal import Decimal

from services.common.core import D, money
from services.common.models import ASSET_CLASSES, Holding, Quote, Trade

ZERO = Decimal("0")
ALLOCATION_ORDER = ["Renda Fixa", "Renda Variável", "Fundos", "Previdência", "Outros"]


@dataclass
class Position:
    asset_id: str
    name: str
    asset_class: str
    group: str
    custodian: str
    quantity: str
    value: str
    invested: str
    result: str
    weight: float
    liquidity_days: int
    price_source: str
    as_of: str


class PortfolioEngine:
    def consolidate(self, *, trades: list[Trade], holdings: list[Holding], quotes: dict[str, Quote],
                    cash: Decimal = ZERO) -> dict:
        positions: list[Position] = []
        # posições de bolsa a partir das operações
        book: dict[str, dict] = defaultdict(lambda: {"qty": ZERO, "cost": ZERO, "cls": "", "broker": "", "last": ZERO, "last_date": None})
        for t in sorted(trades, key=lambda t: (t.date, 0 if t.side == "C" else 1)):
            b = book[t.ticker]
            b["cls"], b["broker"] = t.asset_class, t.broker
            b["last"], b["last_date"] = t.price, t.date
            if t.side == "C":
                b["qty"] += t.quantity
                b["cost"] += t.gross + t.fees
            else:
                avg = b["cost"] / b["qty"] if b["qty"] else ZERO
                b["qty"] -= t.quantity
                b["cost"] -= avg * t.quantity
                if b["qty"] <= 0:
                    b["qty"], b["cost"] = ZERO, ZERO
        for ticker, b in book.items():
            if b["qty"] <= 0:
                continue
            q = quotes.get(ticker)
            price = q.price if q else b["last"]
            value = b["qty"] * price
            positions.append(Position(asset_id=ticker, name=ticker, asset_class=b["cls"], group=ASSET_CLASSES[b["cls"]],
                                      custodian=b["broker"], quantity=str(b["qty"]), value=str(money(value)),
                                      invested=str(money(b["cost"])), result=str(money(value - b["cost"])), weight=0.0,
                                      liquidity_days=2, price_source=q.source if q else "último preço de operação",
                                      as_of=(q.as_of if q else b["last_date"]).isoformat()))
        for h in holdings:
            positions.append(Position(asset_id=h.asset_id, name=h.name, asset_class=h.asset_class,
                                      group=ASSET_CLASSES.get(h.asset_class, "Outros"), custodian=h.custodian, quantity="1",
                                      value=str(money(h.value)), invested=str(money(h.invested)),
                                      result=str(money(h.value - h.invested)), weight=0.0, liquidity_days=h.liquidity_days,
                                      price_source=h.lineage.source, as_of=h.as_of.isoformat()))
        if cash:
            positions.append(Position(asset_id="CAIXA", name="Saldo em conta", asset_class="caixa", group="Outros",
                                      custodian="Contas correntes", quantity="1", value=str(money(cash)), invested=str(money(cash)),
                                      result="0.00", weight=0.0, liquidity_days=0, price_source="contas", as_of=""))
        total = sum((D(p.value) for p in positions), ZERO)
        for p in positions:
            p.weight = float(D(p.value) / total) if total else 0.0
        positions.sort(key=lambda p: D(p.value), reverse=True)

        alloc = defaultdict(lambda: ZERO)
        for p in positions:
            alloc[p.group] += D(p.value)
        allocation = [{"group": g, "value": str(money(alloc[g])), "weight": float(alloc[g] / total) if total else 0.0}
                      for g in ALLOCATION_ORDER if alloc[g] > 0]
        hhi = sum(p.weight ** 2 for p in positions)
        liquid = sum((D(p.value) for p in positions if p.liquidity_days <= 2), ZERO)
        by_custodian = defaultdict(lambda: ZERO)
        for p in positions:
            by_custodian[p.custodian] += D(p.value)
        invested = sum((D(p.invested) for p in positions), ZERO)
        return {
            "total": str(money(total)),
            "invested": str(money(invested)),
            "result": str(money(total - invested)),
            "result_pct": float((total - invested) / invested) if invested else 0.0,
            "positions": [p.__dict__ for p in positions],
            "allocation": allocation,
            "concentration": {
                "hhi": round(hhi, 4),
                "largest_position": positions[0].name if positions else None,
                "largest_weight": round(positions[0].weight, 4) if positions else 0.0,
                "reading": "descritiva — indica o quanto o patrimônio depende de poucos ativos; não é recomendação",
            },
            "liquidity": {"d2_or_less": str(money(liquid)), "share": float(liquid / total) if total else 0.0},
            "by_custodian": [{"custodian": k, "value": str(money(v))} for k, v in sorted(by_custodian.items(), key=lambda kv: -kv[1])],
        }
