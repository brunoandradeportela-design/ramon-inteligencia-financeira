"""Tax Engine — cálculo determinístico, versionado e auditável.

Fluxo (Plano técnico §9):
DATA -> VALIDATION -> TAX EVENT -> RULE SELECTION -> DETERMINISTIC CALCULATION
-> CROSS VALIDATION -> RESULT + CONFIDENCE -> AUDIT SNAPSHOT -> (IA explica)

Regras de ouro:
* Mesmo snapshot + mesma versão de regra => mesmo resultado (hash reproduzível).
* Regra com status != validated nunca entra em cálculo (RulePending).
* A IA não altera regra nem cálculo — apenas lê `TaxResult`.
* Todo valor é ESTIMATIVA; valor efetivamente pago vem de DARF informado.
"""
from __future__ import annotations

import json
from collections import defaultdict
from dataclasses import asdict, dataclass, field
from datetime import date
from decimal import Decimal
from pathlib import Path
from typing import Iterable

from services.common.core import D, DomainError, canonical_json, last_business_day, money, month_key, next_month, sha256
from services.common.models import Trade

RULES_DIR = Path(__file__).parent / "rules"
ZERO = Decimal("0")


class RulePending(DomainError):
    def __init__(self, code: str):
        super().__init__(409, "Regra tributária pendente", f"A regra {code} não está validada e não pode ser usada em cálculo.",
                         "https://ramon.dev/problems/rule-pending", {"rule": code})


@dataclass(frozen=True)
class Rule:
    code: str
    version: str
    title: str
    status: str
    validity: dict
    parameters: dict
    sources: list
    formula: str
    exceptions: list
    tests: list

    def p(self, key: str) -> Decimal:
        return D(self.parameters[key])

    def ref(self) -> dict:
        return {"code": self.code, "version": self.version, "title": self.title,
                "sources": [s["id"] for s in self.sources]}


class RuleRegistry:
    def __init__(self, path: Path | None = None) -> None:
        self.catalog: dict = {}
        self.rules: dict[str, Rule] = {}
        files = [path] if path else sorted(RULES_DIR.glob("*.json"))
        for f in files:
            data = json.loads(Path(f).read_text(encoding="utf-8"))
            self.catalog = {k: v for k, v in data.items() if k != "rules"}
            for r in data["rules"]:
                rule = Rule(code=r["code"], version=r["version"], title=r["title"], status=r["status"],
                            validity=r["validity"], parameters=r["parameters"], sources=r["sources"],
                            formula=r["formula"], exceptions=r["exceptions"], tests=r["tests"])
                self.rules[rule.code] = rule

    def get(self, code: str, on: date) -> Rule:
        rule = self.rules.get(code)
        if rule is None:
            raise DomainError(404, "Regra inexistente", code)
        if rule.status != "validated":
            raise RulePending(code)
        start = date.fromisoformat(rule.validity["start"])
        end = date.fromisoformat(rule.validity["end"]) if rule.validity.get("end") else None
        if on < start or (end and on > end):
            raise DomainError(422, "Regra fora de vigência", f"{code} não vigente em {on.isoformat()}")
        return rule

    def listing(self) -> list[dict]:
        return [{**asdict(r), "usable_in_calculation": r.status == "validated"} for r in self.rules.values()]


# --------------------------------------------------------------------------- resultados
@dataclass
class TaxEvent:
    id: str
    date: str
    ticker: str
    asset_class: str
    modality: str             # comum | daytrade | fii
    kind: str                 # venda | daytrade | dado_incompleto
    sale_value: str
    cost_basis: str
    result: str
    rule: dict
    confidence: float
    status: str               # calculado | isento | pendente_dado
    notes: list = field(default_factory=list)
    source: str = ""


@dataclass
class MonthResult:
    month: str
    sales_acoes: str
    exempt: bool
    result_comum: str
    result_acoes: str
    result_daytrade: str
    result_fii: str
    exempt_gain: str
    base_comum: str
    base_daytrade: str
    base_fii: str
    tax_comum: str
    tax_daytrade: str
    tax_fii: str
    irrf: str
    tax_due_gross: str
    carry_in: str              # imposto < R$10 trazido do mês anterior
    tax_due: str
    darf: dict | None
    loss_carry: dict
    confidence: float
    rules: list


@dataclass
class TaxResult:
    year: int
    reference_date: str
    months: list[MonthResult]
    events: list[TaxEvent]
    total_tax_due: str
    total_irrf: str
    total_exempt_gain: str
    losses_available: dict
    positions_cost: dict
    confidence: float
    premises: list
    limitations: list
    rule_versions: dict
    snapshot_hash: str
    kind: str = "estimativa"


def _darf_due(month: str) -> date:
    y, m = map(int, month.split("-"))
    ny, nm = next_month(y, m)
    return last_business_day(ny, nm)


class TaxEngine:
    def __init__(self, registry: RuleRegistry | None = None) -> None:
        self.registry = registry or RuleRegistry()

    # ------------------------------------------------------------------ validação
    @staticmethod
    def validate(trades: Iterable[Trade]) -> list[dict]:
        issues = []
        for t in trades:
            if t.side not in ("C", "V"):
                issues.append({"trade": t.id, "issue": "lado inválido"})
            if t.quantity <= 0 or t.price <= 0:
                issues.append({"trade": t.id, "issue": "quantidade/preço não positivos"})
            if t.fees < 0:
                issues.append({"trade": t.id, "issue": "custos negativos"})
            if t.asset_class not in ("acao", "etf", "bdr", "fii"):
                issues.append({"trade": t.id, "issue": f"classe {t.asset_class} fora do escopo"})
        return issues

    # ------------------------------------------------------------------ cálculo
    def compute(self, trades: list[Trade], *, year: int, reference_date: date,
                prior_losses: dict | None = None, paid_darfs: dict | None = None) -> TaxResult:
        issues = self.validate(trades)
        if issues:
            raise DomainError(422, "Operações inválidas", "Corrija as operações antes do cálculo.", extra={"issues": issues})

        trades = sorted(trades, key=lambda t: (t.date, 0 if t.side == "C" else 1, t.id))
        loss = {"comum": D((prior_losses or {}).get("comum", 0)), "daytrade": D((prior_losses or {}).get("daytrade", 0)),
                "fii": D((prior_losses or {}).get("fii", 0))}

        # --- preço médio (swing) e eventos -------------------------------------
        pos: dict[str, dict] = defaultdict(lambda: {"qty": ZERO, "cost": ZERO, "class": ""})
        events: list[TaxEvent] = []
        per_month = defaultdict(lambda: {"sales_acoes": ZERO, "acoes": ZERO, "etf": ZERO, "daytrade": ZERO, "fii": ZERO,
                                         "irrf_venda": ZERO, "irrf_dt": ZERO, "conf": 1.0, "fii_sales": ZERO})
        dt_groups: dict[tuple, list[Trade]] = defaultdict(list)

        for t in trades:
            if t.date.year > year or t.date > reference_date:
                continue
            if t.daytrade:
                dt_groups[(t.date, t.ticker)].append(t)
                continue
            p = pos[t.ticker]
            p["class"] = t.asset_class
            if t.side == "C":
                p["qty"] += t.quantity
                p["cost"] += t.gross + t.fees
                continue
            # venda
            mk = month_key(t.date)
            net_sale = t.gross - t.fees
            if t.date.year != year:
                # venda de ano anterior: apenas atualiza posição
                avg = p["cost"] / p["qty"] if p["qty"] else ZERO
                p["qty"] -= t.quantity
                p["cost"] -= avg * t.quantity
                continue
            modality = "fii" if t.asset_class == "fii" else "comum"
            rule = self.registry.get("BR-IRPF-FII" if modality == "fii" else "BR-IRPF-RV-COMUM", t.date)
            m = per_month[mk]
            m["irrf_venda"] += t.gross * rule.p("irrf_aliquota_sobre_venda")
            if t.asset_class == "acao":
                m["sales_acoes"] += t.gross
            if p["qty"] < t.quantity:
                m["conf"] = min(m["conf"], 0.55)
                events.append(TaxEvent(id=t.id, date=t.date.isoformat(), ticker=t.ticker, asset_class=t.asset_class,
                                       modality=modality, kind="dado_incompleto", sale_value=str(money(t.gross)),
                                       cost_basis="?", result="?", rule=rule.ref(), confidence=0.3, status="pendente_dado",
                                       notes=["Venda sem posição de compra registrada: informe o custo de aquisição (nota de corretagem)."],
                                       source=t.lineage.source))
                p["qty"] = ZERO
                p["cost"] = ZERO
                continue
            avg = p["cost"] / p["qty"]
            cost = avg * t.quantity
            result = net_sale - cost
            p["qty"] -= t.quantity
            p["cost"] -= cost
            key = "fii" if modality == "fii" else ("acoes" if t.asset_class == "acao" else "etf")
            m[key] += result
            events.append(TaxEvent(id=t.id, date=t.date.isoformat(), ticker=t.ticker, asset_class=t.asset_class,
                                   modality=modality, kind="venda", sale_value=str(money(t.gross)), cost_basis=str(money(cost)),
                                   result=str(money(result)), rule=rule.ref(), confidence=1.0, status="calculado",
                                   notes=[f"Preço médio {money(avg)} × {t.quantity} + custos {money(t.fees)}"], source=t.lineage.source))

        # --- day trade --------------------------------------------------------
        for (d, ticker), group in sorted(dt_groups.items()):
            if d.year != year:
                continue
            rule = self.registry.get("BR-IRPF-RV-DAYTRADE", d)
            buys = [g for g in group if g.side == "C"]
            sells = [g for g in group if g.side == "V"]
            qb, qs = sum((g.quantity for g in buys), ZERO), sum((g.quantity for g in sells), ZERO)
            mk = month_key(d)
            m = per_month[mk]
            sale = sum((g.gross - g.fees for g in sells), ZERO)
            cost = sum((g.gross + g.fees for g in buys), ZERO)
            notes, conf = [], 1.0
            if qb != qs:
                conf = 0.6
                m["conf"] = min(m["conf"], 0.6)
                notes.append(f"Quantidades compradas ({qb}) e vendidas ({qs}) divergem no dia — revisar nota.")
            result = sale - cost
            m["daytrade"] += result
            if result > 0:
                m["irrf_dt"] += result * rule.p("irrf_aliquota_sobre_ganho")
            events.append(TaxEvent(id=f"dt_{d.isoformat()}_{ticker}", date=d.isoformat(), ticker=ticker,
                                   asset_class=group[0].asset_class, modality="daytrade", kind="daytrade",
                                   sale_value=str(money(sale)), cost_basis=str(money(cost)), result=str(money(result)),
                                   rule=rule.ref(), confidence=conf, status="calculado", notes=notes,
                                   source=group[0].lineage.source))

        # --- apuração mensal --------------------------------------------------
        months: list[MonthResult] = []
        carry_small = ZERO          # imposto < mínimo acumulado
        irrf_credit = ZERO          # IRRF excedente compensável nos meses seguintes do ano
        total_due = total_irrf = total_exempt = ZERO
        for mk in sorted(per_month):
            m = per_month[mk]
            d = date.fromisoformat(mk + "-01")
            r_comum = self.registry.get("BR-IRPF-RV-COMUM", d)
            r_dt = self.registry.get("BR-IRPF-RV-DAYTRADE", d)
            r_fii = self.registry.get("BR-IRPF-FII", d)
            exempt = m["sales_acoes"] <= r_comum.p("limite_isencao_vendas_mes")
            acoes = m["acoes"]
            exempt_gain = ZERO
            if exempt and acoes > 0:
                exempt_gain = acoes
                acoes_taxable = ZERO
            elif exempt and acoes < 0 and not r_comum.parameters.get("compensar_prejuizo_mes_isento", True):
                acoes_taxable = ZERO
            else:
                acoes_taxable = acoes
            res_comum = acoes_taxable + m["etf"]

            def apply(result: Decimal, bucket: str) -> Decimal:
                if result <= 0:
                    loss[bucket] += -result
                    return ZERO
                used = min(loss[bucket], result)
                loss[bucket] -= used
                return result - used

            b_comum = apply(res_comum, "comum")
            b_dt = apply(m["daytrade"], "daytrade")
            b_fii = apply(m["fii"], "fii")
            t_comum = b_comum * r_comum.p("aliquota")
            t_dt = b_dt * r_dt.p("aliquota")
            t_fii = b_fii * r_fii.p("aliquota")
            gross = t_comum + t_dt + t_fii
            irrf = m["irrf_venda"] + m["irrf_dt"]
            available_irrf = irrf + irrf_credit
            used_irrf = min(available_irrf, gross)
            irrf_credit = available_irrf - used_irrf
            due = gross - used_irrf + carry_small
            darf = None
            minimum = r_comum.p("darf_valor_minimo")
            if due >= minimum:
                due_date = _darf_due(mk)
                status = "vencido" if due_date < reference_date else "aberto"
                paid = (paid_darfs or {}).get(mk)
                if paid is not None:
                    status = "pago"
                darf = {"codigo": r_comum.parameters["darf_codigo"], "competencia": mk, "valor": str(money(due)),
                        "vencimento": due_date.isoformat(), "status": status,
                        "dias_para_vencimento": (due_date - reference_date).days,
                        "valor_pago": str(money(D(paid))) if paid is not None else None,
                        "tipo_valor": "efetivamente_pago" if paid is not None else "estimativa"}
                carry_in, carry_small = carry_small, ZERO
                total_due += due
            else:
                carry_in = carry_small
                carry_small = due
            total_irrf += irrf
            total_exempt += exempt_gain
            months.append(MonthResult(
                month=mk, sales_acoes=str(money(m["sales_acoes"])), exempt=bool(exempt),
                result_comum=str(money(res_comum)), result_acoes=str(money(acoes)),
                result_daytrade=str(money(m["daytrade"])), result_fii=str(money(m["fii"])),
                exempt_gain=str(money(exempt_gain)), base_comum=str(money(b_comum)), base_daytrade=str(money(b_dt)),
                base_fii=str(money(b_fii)), tax_comum=str(money(t_comum)), tax_daytrade=str(money(t_dt)),
                tax_fii=str(money(t_fii)), irrf=str(money(irrf)), tax_due_gross=str(money(gross)),
                carry_in=str(money(carry_in)), tax_due=str(money(due)) if darf else "0.00", darf=darf,
                loss_carry={k: str(money(v)) for k, v in loss.items()}, confidence=m["conf"],
                rules=[r_comum.ref(), r_dt.ref(), r_fii.ref()]))
            # eventos isentos marcados para explicabilidade
            if exempt and acoes > 0:
                for e in events:
                    if e.date.startswith(mk) and e.asset_class == "acao" and e.kind == "venda":
                        e.status = "isento"
                        e.notes.append(f"Vendas de ações no mês: {money(m['sales_acoes'])} ≤ limite {money(r_comum.p('limite_isencao_vendas_mes'))}.")

        positions = {k: {"quantidade": str(v["qty"]), "custo_total": str(money(v["cost"])),
                         "preco_medio": str(money(v["cost"] / v["qty"])) if v["qty"] else "0.00", "classe": v["class"]}
                     for k, v in pos.items() if v["qty"] > 0}
        active = [mr for mr in months]
        confidence = round(min([mr.confidence for mr in active] + [1.0]), 2)
        rule_versions = {c: r.version for c, r in self.registry.rules.items() if r.status == "validated"}
        snapshot = {"year": year, "ref": reference_date.isoformat(), "prior": {k: str(v) for k, v in (prior_losses or {}).items()}, "paid": paid_darfs or {},
                    "trades": [(t.id, t.date.isoformat(), t.ticker, t.asset_class, t.side, str(t.quantity), str(t.price),
                                str(t.fees), t.daytrade) for t in trades],
                    "rules": rule_versions}
        return TaxResult(
            year=year, reference_date=reference_date.isoformat(), months=months,
            events=sorted(events, key=lambda e: e.date, reverse=True),
            total_tax_due=str(money(total_due)), total_irrf=str(money(total_irrf)),
            total_exempt_gain=str(money(total_exempt)), losses_available={k: str(money(v)) for k, v in loss.items()},
            positions_cost=positions, confidence=confidence,
            premises=[
                "Custo de aquisição pelo preço médio ponderado, com corretagem/emolumentos somados ao custo.",
                "Vendas classificadas como day trade conforme marcação da nota de corretagem.",
                "Vencimento do DARF: último dia útil do mês seguinte (feriados não considerados).",
                "Prejuízos de anos anteriores informados pelo titular: " + (", ".join(f"{k}={v}" for k, v in (prior_losses or {}).items()) or "nenhum"),
            ],
            limitations=[
                "Estimativa: não substitui a apuração oficial nem a revisão de um contador.",
                "Não cobre opções, termo, futuros, aluguel de ações, proventos e eventos corporativos (desdobramentos, bonificações).",
                "Operações de anos anteriores entram apenas para formar o preço médio.",
            ],
            rule_versions=rule_versions,
            snapshot_hash=sha256(canonical_json(snapshot)),
        )
