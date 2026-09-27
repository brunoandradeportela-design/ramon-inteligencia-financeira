"""Simulation Engine — cenário base vs alternativas, reprodutível e versionado.

O sistema apresenta consequências; quem decide é o titular/profissional (Dossiê §9.9).
"""
from __future__ import annotations

from datetime import date
from decimal import Decimal

from services.common.core import D, ValidationFailed, canonical_json, money, month_key, new_id, sha256, utcnow
from services.common.models import Lineage, Trade
from services.tax_engine.engine import TaxEngine

ZERO = Decimal("0")


class SimulationEngine:
    def __init__(self, tax: TaxEngine) -> None:
        self.tax = tax

    # ------------------------------------------------------------------ venda de ativos
    def sale_scenarios(self, *, owner_id: str, trades: list[Trade], quotes: dict, year: int, reference: date,
                       scenarios: list[dict], prior_losses: dict | None = None) -> dict:
        if not scenarios or len(scenarios) > 3:
            raise ValidationFailed("Informe de 1 a 3 cenários alternativos.")
        base = self.tax.compute(trades, year=year, reference_date=reference, prior_losses=prior_losses)
        # posições disponíveis
        results = [{"name": "Cenário atual", "key": "base", **self._summ(base, [])}]
        for i, sc in enumerate(scenarios):
            ops = []
            for op in sc.get("operations", []):
                ticker = op["ticker"].upper()
                if ticker not in base.positions_cost:
                    raise ValidationFailed(f"Não há posição registrada em {ticker} para simular a venda.")
                avail = D(base.positions_cost[ticker]["quantidade"])
                qty = D(op["quantity"])
                if qty <= 0 or qty > avail:
                    raise ValidationFailed(f"Quantidade de {ticker} deve estar entre 1 e {avail}.")
                price = D(op.get("price") or (quotes[ticker].price if ticker in quotes else 0))
                if price <= 0:
                    raise ValidationFailed(f"Informe o preço de {ticker}.")
                d = date.fromisoformat(op.get("date") or reference.isoformat())
                if d.year != year:
                    raise ValidationFailed("A simulação considera operações dentro do ano-calendário de análise.")
                ops.append(Trade(id=new_id("sim"), owner_id=owner_id, date=d, ticker=ticker,
                                 asset_class=base.positions_cost[ticker]["classe"], side="V", quantity=qty, price=price,
                                 fees=D(op.get("fees", "0")), daytrade=False, broker="simulação", fingerprint="",
                                 lineage=Lineage(source="simulação", institution="-")))
            horizon = max([reference] + [o.date for o in ops])
            alt = self.tax.compute(trades + ops, year=year, reference_date=horizon, prior_losses=prior_losses)
            results.append({"name": sc.get("name") or f"Cenário {chr(66 + i)}", "key": f"alt{i + 1}", **self._summ(alt, ops, base)})
        return results_payload(kind="venda_ativos", results=results, base=base)

    def _summ(self, r, ops, base=None) -> dict:
        months = {m.month: m for m in r.months}
        touched = sorted({month_key(o.date) for o in ops}) if ops else []
        detail = []
        for mk in touched:
            m = months.get(mk)
            if m:
                detail.append({"month": mk, "sales_acoes": m.sales_acoes, "exempt": m.exempt, "tax_due": m.tax_due,
                               "tax_due_gross": m.tax_due_gross, "irrf": m.irrf, "exempt_gain": m.exempt_gain,
                               "darf": m.darf})
        gross = sum((o.gross - o.fees for o in ops), ZERO)
        tax_year = D(r.total_tax_due)
        out = {"tax_year": str(money(tax_year)), "exempt_gain_year": r.total_exempt_gain,
               "losses_available": r.losses_available, "liquidity_generated": str(money(gross)),
               "months": detail, "confidence": r.confidence, "snapshot_hash": r.snapshot_hash}
        if base is not None:
            diff = tax_year - D(base.total_tax_due)
            out["tax_difference_vs_base"] = str(money(diff))
            out["net_liquidity_after_tax"] = str(money(gross - diff))
        return out

    # ------------------------------------------------------------------ PGBL
    def pgbl(self, *, taxable_income: Decimal, current_contributions: Decimal, extra_contribution: Decimal,
             marginal_rate: Decimal, full_model: bool, contributes_social_security: bool, reference: date) -> dict:
        rule = self.tax.registry.get("BR-IRPF-PGBL-DEDUCAO", reference)
        if taxable_income <= 0:
            raise ValidationFailed("Informe os rendimentos tributáveis anuais.")
        if not (ZERO <= marginal_rate <= Decimal("0.275")):
            raise ValidationFailed("Alíquota marginal deve estar entre 0% e 27,5%.")
        limit = taxable_income * rule.p("limite_percentual")
        eligible = full_model and contributes_social_security
        used_now = min(current_contributions, limit) if eligible else ZERO
        used_after = min(current_contributions + extra_contribution, limit) if eligible else ZERO
        extra_deductible = used_after - used_now
        effect = extra_deductible * marginal_rate

        def sc(name, contrib, deductible, eff):
            return {"name": name, "contributions": str(money(contrib)), "deductible": str(money(deductible)),
                    "tax_effect_estimate": str(money(eff)), "liquidity_committed": str(money(contrib))}

        results = [sc("Cenário atual", current_contributions, used_now, ZERO),
                   sc("Cenário com aporte adicional", current_contributions + extra_contribution, used_after, effect)]
        notes = []
        if not full_model:
            notes.append("No modelo simplificado a contribuição ao PGBL não é dedutível.")
        if not contributes_social_security:
            notes.append("A dedução exige contribuição ao regime geral ou próprio de previdência.")
        if current_contributions + extra_contribution > limit:
            notes.append(f"Contribuições acima de 12% ({money(limit)}) não geram dedução adicional.")
        payload = {
            "kind": "pgbl", "limit_12pct": str(money(limit)), "remaining_room": str(money(max(ZERO, limit - current_contributions))) if eligible else "0.00",
            "results": results, "difference": str(money(effect)),
            "premises": [f"Alíquota marginal informada pelo titular: {marginal_rate * 100:.1f}%".replace(".", ","),
                         "Efeito é diferimento: o valor deduzido será tributado no resgate/benefício conforme regime escolhido.",
                         "Tabela progressiva anual não é recalculada (regra BR-IRPF-TABELA-ANUAL pendente)."] + notes,
            "rule": rule.ref(), "confidence": 0.8 if eligible else 0.5,
        }
        return finalize(payload)


def results_payload(*, kind: str, results: list, base) -> dict:
    return finalize({
        "kind": kind, "results": results,
        "premises": base.premises + ["Preços das vendas simuladas informados pelo titular ou última cotação disponível.",
                                     "Custos de corretagem simulados = 0 quando não informados."],
        "limitations": base.limitations, "rule_versions": base.rule_versions,
    })


def finalize(payload: dict) -> dict:
    payload["id"] = new_id("sim")
    payload["created_at"] = utcnow().isoformat()
    payload["kind_label"] = "estimativa"
    payload["disclaimer"] = ("Simulação informativa. Mostra consequências estimadas de cenários; não é recomendação de "
                             "investimento nem substitui a análise de um contador.")
    payload["reproducibility_hash"] = sha256(canonical_json({k: v for k, v in payload.items() if k not in ("id", "created_at")}))
    return payload
