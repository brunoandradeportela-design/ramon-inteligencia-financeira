"""Financial Engine — receitas, despesas, fluxo, categorias, recorrências e liquidez (descritivo)."""
from __future__ import annotations

import re
from collections import defaultdict
from datetime import date
from decimal import Decimal
from statistics import median

from services.common.core import D, money, month_key
from services.common.models import Account, Transaction

ZERO = Decimal("0")

CATEGORY_RULES = [
    (r"sal[aá]rio|pro[- ]?labore|honor[aá]rio|folha", "Renda"),
    (r"dividend|provento|jcp|rendimento", "Rendimentos"),
    (r"aluguel|condom[ií]nio|iptu", "Moradia"),
    (r"mercado|supermerc|padaria|hortifruti", "Alimentação"),
    (r"restaurante|ifood|delivery|lanchonete", "Restaurantes"),
    (r"uber|99 ?taxi|combust|posto|estacionamento|ped[aá]gio", "Transporte"),
    (r"farm[aá]cia|drogaria|plano de sa[uú]de|hospital|cl[ií]nica|unimed", "Saúde"),
    (r"escola|faculdade|curso|mensalidade", "Educação"),
    (r"netflix|spotify|streaming|assinatura|prime", "Assinaturas"),
    (r"energia|luz|[aá]gua|internet|telefone|celular|g[aá]s", "Contas da casa"),
    (r"darf|imposto|ipva|irpf", "Impostos"),
    (r"aplica[cç][aã]o|aporte|investimento|tesouro|cdb", "Investimentos"),
    (r"viagem|hotel|passagem|a[eé]reo", "Viagens"),
    (r"cart[aã]o|fatura", "Cartão de crédito"),
]


def categorize(description: str, amount: Decimal) -> str:
    text = description.lower()
    for pattern, cat in CATEGORY_RULES:
        if re.search(pattern, text):
            return cat
    return "Outras receitas" if amount > 0 else "Outras despesas"


class FinancialEngine:
    def summary(self, *, transactions: list[Transaction], accounts: list[Account], period_months: int = 6,
                reference: date) -> dict:
        months = []
        y, m = reference.year, reference.month
        for _ in range(period_months):
            months.insert(0, f"{y:04d}-{m:02d}")
            y, m = (y - 1, 12) if m == 1 else (y, m - 1)
        window = [t for t in transactions if month_key(t.date) in months and t.category not in ("Investimentos", "Cartão de crédito")]
        flow = {mk: {"month": mk, "income": ZERO, "expense": ZERO} for mk in months}
        by_cat = defaultdict(lambda: ZERO)
        for t in window:
            f = flow[month_key(t.date)]
            if t.amount >= 0:
                f["income"] += t.amount
            else:
                f["expense"] += -t.amount
                by_cat[t.category] += -t.amount
        series = [{"month": f["month"], "income": str(money(f["income"])), "expense": str(money(f["expense"])),
                   "net": str(money(f["income"] - f["expense"]))} for f in flow.values()]
        total_in = sum((f["income"] for f in flow.values()), ZERO)
        total_out = sum((f["expense"] for f in flow.values()), ZERO)
        full_months = [f for f in flow.values() if f["expense"] > 0]
        avg_exp = (sum((f["expense"] for f in full_months), ZERO) / len(full_months)) if full_months else ZERO
        cash = sum((a.balance for a in accounts if a.kind in ("corrente", "poupanca")), ZERO)
        cats = sorted(by_cat.items(), key=lambda kv: -kv[1])

        # recorrências: mesma descrição normalizada em >= 3 meses distintos, valor estável (±15%)
        groups = defaultdict(list)
        for t in transactions:
            if t.amount < 0:
                groups[re.sub(r"\d+", "", t.description.lower()).strip()].append(t)
        recurring = []
        for key, ts in groups.items():
            ms = {month_key(t.date) for t in ts}
            if len(ms) >= 3:
                vals = [abs(t.amount) for t in ts]
                med = D(median(vals))
                if med and all(abs(v - med) / med <= Decimal("0.15") for v in vals):
                    recurring.append({"description": ts[-1].description, "category": ts[-1].category,
                                      "monthly": str(money(med)), "months": len(ms)})
        recurring.sort(key=lambda r: -D(r["monthly"]))

        # mudanças mês a mês por categoria (último mês vs mediana dos anteriores)
        changes = []
        last = months[-1]
        prev = months[:-1]
        cat_month = defaultdict(lambda: defaultdict(lambda: ZERO))
        for t in window:
            if t.amount < 0:
                cat_month[t.category][month_key(t.date)] += -t.amount
        for cat, per in cat_month.items():
            base_vals = [per[mm] for mm in prev if per[mm] > 0]
            if len(base_vals) >= 2 and per[last] > 0:
                base = D(median(base_vals))
                delta = (per[last] - base) / base
                if abs(delta) >= Decimal("0.25") and abs(per[last] - base) >= 200:
                    changes.append({"category": cat, "last": str(money(per[last])), "baseline": str(money(base)),
                                    "delta_pct": float(delta)})
        changes.sort(key=lambda c: -abs(c["delta_pct"]))

        return {
            "period": {"from": months[0], "to": months[-1]},
            "totals": {"income": str(money(total_in)), "expense": str(money(total_out)), "net": str(money(total_in - total_out)),
                       "savings_rate": float((total_in - total_out) / total_in) if total_in else 0.0},
            "series": series,
            "by_category": [{"category": c, "value": str(money(v)), "share": float(v / total_out) if total_out else 0.0} for c, v in cats],
            "recurring": recurring[:12],
            "changes": changes[:6],
            "liquidity": {"cash": str(money(cash)), "avg_monthly_expense": str(money(avg_exp)),
                          "months_covered": float(cash / avg_exp) if avg_exp else None},
            "accounts": [{"id": a.id, "institution": a.institution, "kind": a.kind, "name": a.name,
                          "balance": str(money(a.balance)), "source": a.lineage.source} for a in accounts],
            "reading": "análise descritiva do fluxo; não há juízo sobre hábitos sem contexto (Dossiê §9.4)",
        }
