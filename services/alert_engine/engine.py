"""Alert Engine — detecta, classifica e prioriza alertas com evidência.

prioridade = impacto × urgência × relevância × confiança (0..1 cada → 0..100).
Fórmula configurável (WEIGHTS) e a ser calibrada com dados reais (Dossiê §16).
"""
from __future__ import annotations

from dataclasses import asdict, dataclass, field
from datetime import date
from decimal import Decimal

from services.common.core import D, brl, money, sha256

SEVERITY = [(60, "critico"), (35, "alto"), (18, "atencao"), (0, "informativo")]


@dataclass
class Alert:
    id: str
    code: str
    title: str
    detail: str
    category: str               # tributario | dados | documentos | patrimonio | conexoes
    impact: float
    urgency: float
    relevance: float
    confidence: float
    priority: float
    severity: str
    status: str = "novo"        # novo | visto | resolvido
    evidence: list = field(default_factory=list)
    rule: dict | None = None
    action: dict | None = None
    due_date: str | None = None


def _impact(amount: Decimal) -> float:
    a = float(abs(amount))
    return 0.2 if a < 100 else 0.45 if a < 1000 else 0.7 if a < 10000 else 1.0


def _urgency(days: int | None) -> float:
    if days is None:
        return 0.35
    if days < 0:
        return 1.0
    return 1.0 if days <= 5 else 0.8 if days <= 15 else 0.5 if days <= 45 else 0.25


def make(code, title, detail, category, impact, urgency, relevance, confidence, **kw) -> Alert:
    prio = round(impact * urgency * relevance * confidence * 100, 1)
    sev = next(s for limit, s in SEVERITY if prio >= limit)
    if kw.pop("opportunity", False):
        sev = "oportunidade"
    aid = "alr_" + sha256(code + "|" + kw.get("key", title))[:16]
    kw.pop("key", None)
    return Alert(id=aid, code=code, title=title, detail=detail, category=category, impact=impact, urgency=urgency,
                 relevance=relevance, confidence=confidence, priority=prio, severity=sev, **kw)


class AlertEngine:
    def generate(self, *, tax, portfolio: dict, documents: list, connections: list, reference: date,
                 statuses: dict[str, str] | None = None) -> list[dict]:
        alerts: list[Alert] = []
        statuses = statuses or {}
        # 1. DARFs
        for m in tax.months:
            if m.darf and m.darf["status"] in ("aberto", "vencido"):
                days = m.darf["dias_para_vencimento"]
                mes = date.fromisoformat(m.month + "-01").strftime("%m/%Y")
                vencido = days < 0
                alerts.append(make(
                    "DARF_VENCIMENTO", f"Revisar DARF de {mes}",
                    (f"DARF vencido há {-days} dias" if vencido else f"Vencimento em {days} dias") +
                    f" — valor estimado {brl(m.darf['valor'])} (código {m.darf['codigo']}).",
                    "tributario", max(_impact(D(m.darf["valor"])), 0.6), _urgency(days), 1.0, m.confidence,
                    key=m.month, due_date=m.darf["vencimento"], rule=m.rules[0],
                    evidence=[{"label": "Competência", "value": m.month}, {"label": "Imposto estimado", "value": m.darf["valor"]},
                              {"label": "IRRF compensado", "value": m.irrf}],
                    action={"label": "Gerar DARF", "route": f"/tributacao?tab=guias&competencia={m.month}"}))
        # 2. Proximidade do limite de isenção no mês corrente (informativo, sem recomendar operação)
        cur = f"{reference.year:04d}-{reference.month:02d}"
        for m in tax.months:
            if m.month == cur:
                sales = D(m.sales_acoes)
                if Decimal("0.75") * 20000 <= sales <= 20000:
                    alerts.append(make("ISENCAO_LIMITE", "Vendas de ações perto do limite de isenção",
                                       f"Vendas de ações no mês somam {brl(sales)} ({sales / 200:.0f}% de R$ 20.000,00). "
                                       "Use o simulador para ver o efeito tributário de novos cenários.",
                                       "tributario", 0.6, 0.7, 0.9, m.confidence, key=cur,
                                       evidence=[{"label": "Vendas no mês", "value": str(money(sales))}],
                                       action={"label": "Simular impacto no IR", "route": "/simulador"}))
                elif sales > 20000 and D(m.result_acoes) > 0:
                    alerts.append(make("ISENCAO_EXCEDIDA", "Vendas de ações acima de R$ 20 mil no mês",
                                       "O ganho com ações deste mês entra na base tributável (regra BR-IRPF-RV-COMUM).",
                                       "tributario", _impact(D(m.tax_comum)), 0.6, 0.9, m.confidence, key=cur,
                                       evidence=[{"label": "Vendas no mês", "value": m.sales_acoes}]))
        # 3. Prejuízos acumulados disponíveis
        for bucket, v in tax.losses_available.items():
            if D(v) >= 500:
                nome = {"comum": "operações comuns", "daytrade": "day trade", "fii": "FII"}[bucket]
                alerts.append(make("PREJUIZO_DISPONIVEL", f"Prejuízo a compensar em {nome}",
                                   f"Há {brl(v)} de prejuízo acumulado em {nome}, compensável com ganhos da mesma modalidade.",
                                   "tributario", _impact(D(v) * Decimal("0.15")), 0.3, 0.8, tax.confidence, key=bucket,
                                   opportunity=True, evidence=[{"label": "Prejuízo acumulado", "value": v}],
                                   action={"label": "Ver detalhes", "route": "/tributacao"}))
        # 4. Dados incompletos
        pend = [e for e in tax.events if e.status == "pendente_dado"]
        if pend:
            alerts.append(make("DADO_INCOMPLETO", "Venda sem custo de aquisição",
                               f"{len(pend)} venda(s) sem compra registrada ({', '.join(sorted({e.ticker for e in pend}))}). "
                               "A estimativa fica com confiança reduzida até o custo ser informado.",
                               "dados", 0.7, 0.6, 1.0, 1.0, key="custo",
                               evidence=[{"label": e.ticker, "value": e.sale_value} for e in pend[:5]],
                               action={"label": "Enviar nota de corretagem", "route": "/documentos"}))
        # 5. Documentos pendentes
        for d in documents:
            if d.get("status") == "pendente":
                alerts.append(make("DOCUMENTO_PENDENTE", f"Conferir {d['title'].lower()}",
                                   d.get("detail", "Documento esperado ainda não enviado."), "documentos",
                                   0.45, 0.5, 0.8, 1.0, key=d["id"], action={"label": "Abrir documentos", "route": "/documentos"}))
        # 6. Concentração (descritivo)
        conc = portfolio.get("concentration", {})
        if conc.get("largest_weight", 0) >= 0.30:
            alerts.append(make("CONCENTRACAO", "Concentração relevante em um único ativo",
                               f"{conc['largest_position']} representa {conc['largest_weight'] * 100:.0f}% do patrimônio consolidado. "
                               "Informação descritiva, não é recomendação.",
                               "patrimonio", 0.5, 0.2, 0.7, 1.0, key="conc",
                               evidence=[{"label": "Peso", "value": f"{conc['largest_weight']:.4f}"}]))
        # 7. Conexões
        for c in connections:
            if c["status"] in ("expirando", "erro"):
                alerts.append(make("CONEXAO", f"Conexão {c['institution']}: {c['status']}",
                                   "Renove o consentimento para manter os dados atualizados." if c["status"] == "expirando"
                                   else f"Falha na sincronização ({c.get('error_code') or 'erro'}).",
                                   "conexoes", 0.4, 0.6, 0.8, 1.0, key=c["id"], action={"label": "Minhas conexões", "route": "/conexoes"}))
        out = []
        for a in sorted(alerts, key=lambda a: -a.priority):
            a.status = statuses.get(a.id, "novo")
            out.append(asdict(a))
        return out
