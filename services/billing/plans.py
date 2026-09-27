"""Billing — planos e entitlements (Free / Pro / Premium). Preços são hipóteses (Dossiê §4.1)."""
from __future__ import annotations

from services.common.core import EntitlementRequired

PLANS = {
    "free": {"name": "Free", "price_month": "0.00", "features": {
        "dashboard", "patrimonio", "financas", "orcamento", "alertas_limitados", "documentos", "conexoes"}},
    "pro": {"name": "Pro", "price_month": "24.90", "features": {
        "dashboard", "patrimonio", "financas", "orcamento", "documentos", "conexoes",
        "inteligencia_financeira", "inteligencia_tributaria", "simulacao", "radar", "assistente_ia"}},
    "premium": {"name": "Premium", "price_month": "59.90", "features": {
        "dashboard", "patrimonio", "financas", "orcamento", "documentos", "conexoes",
        "inteligencia_financeira", "inteligencia_tributaria", "simulacao", "radar", "assistente_ia",
        "cenarios_avancados", "inteligencia_patrimonial", "automacao", "suporte_prioritario"}},
}
ORDER = ["free", "pro", "premium"]
FREE_ALERT_LIMIT = 3


def has(plan: str, feature: str) -> bool:
    return feature in PLANS.get(plan, PLANS["free"])["features"]


def require(plan: str, feature: str) -> None:
    if not has(plan, feature):
        needed = next(p for p in ORDER if feature in PLANS[p]["features"])
        raise EntitlementRequired(feature, PLANS[needed]["name"])


def catalog() -> list[dict]:
    return [{"code": k, "name": v["name"], "price_month": v["price_month"], "features": sorted(v["features"]),
             "pricing_status": "hipotese_em_teste"} for k, v in PLANS.items()]
