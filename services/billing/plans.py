"""Billing — planos e entitlements (Free / Pro / Premium).

Política de preço (decisão do dono, 27/09/2026): ticket médio mensal dos pagantes acima de R$ 80.
O menor plano pago custa R$ 89,90, então o ticket médio fica acima de R$ 80 em qualquer mix de planos.
Esses valores ficam acima das faixas de teste do Dossiê §4.1 (Pro R$ 24,90–39,90; Premium R$ 59,90–89,90)
e devem ser validados com teste de conversão.
"""
from __future__ import annotations

from services.common.core import EntitlementRequired

PLANS = {
    "free": {"name": "Free", "price_month": "0.00", "features": {
        "dashboard", "patrimonio", "financas", "orcamento", "alertas_limitados", "documentos", "conexoes"}},
    "pro": {"name": "Pro", "price_month": "89.90", "features": {
        "dashboard", "patrimonio", "financas", "orcamento", "documentos", "conexoes",
        "inteligencia_financeira", "inteligencia_tributaria", "simulacao", "radar", "assistente_ia"}},
    "premium": {"name": "Premium", "price_month": "149.90", "features": {
        "dashboard", "patrimonio", "financas", "orcamento", "documentos", "conexoes",
        "inteligencia_financeira", "inteligencia_tributaria", "simulacao", "radar", "assistente_ia",
        "cenarios_avancados", "inteligencia_patrimonial", "automacao", "suporte_prioritario"}},
}
ORDER = ["free", "pro", "premium"]
FREE_ALERT_LIMIT = 3
TICKET_TARGET = "80.00"   # meta de ticket médio mensal (pagantes)


def has(plan: str, feature: str) -> bool:
    return feature in PLANS.get(plan, PLANS["free"])["features"]


def require(plan: str, feature: str) -> None:
    if not has(plan, feature):
        needed = next(p for p in ORDER if feature in PLANS[p]["features"])
        raise EntitlementRequired(feature, PLANS[needed]["name"])


def catalog() -> list[dict]:
    return [{"code": k, "name": v["name"], "price_month": v["price_month"], "features": sorted(v["features"]),
             "pricing_status": "definido_pelo_dono_em_teste", "ticket_target": TICKET_TARGET} for k, v in PLANS.items()]
