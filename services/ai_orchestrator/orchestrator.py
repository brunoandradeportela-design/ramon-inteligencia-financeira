"""AI Orchestrator — a IA interpreta; os motores calculam (Dossiê §17, Plano técnico §11).

USER QUERY -> Intent Classifier -> Authorization -> Tool Router -> Structured Evidence
-> Response Composer -> Consistency Check -> Auditable Answer

* Nenhum número material é produzido pelo compositor: todos vêm das tools (engines).
* Pedidos de recomendação individualizada de compra/venda acionam o guardrail (CVM Res. 19).
* Tentativas de prompt injection são bloqueadas e registradas.
* O provedor de LLM é plugável (DECISÃO PENDENTE D-05). Sem chave configurada, o compositor
  determinístico por templates responde — e mesmo com LLM, a checagem de consistência
  descarta qualquer resposta com número que não esteja nas evidências.
"""
from __future__ import annotations

import os
import re
import time
import unicodedata
from dataclasses import dataclass
from typing import Callable

from services.common.core import D, brl, new_id, pct, utcnow


def _norm(s: str) -> str:
    return "".join(c for c in unicodedata.normalize("NFD", s.lower()) if unicodedata.category(c) != "Mn")


INJECTION_PATTERNS = [
    r"ignore (as |todas as |suas )?(instru|regras)", r"ignore (all|previous|the above)", r"system prompt",
    r"prompt do sistema", r"modo desenvolvedor", r"developer mode", r"jailbreak", r"aja como (um )?consultor",
    r"finja (que|ser)", r"sem (as )?restri", r"desative (o|os) (guardrail|filtro)", r"revele (suas|as) instru",
]
ADVICE_PATTERNS = [
    r"\b(devo|deveria|vale a pena|compensa) (comprar|vender|investir|aplicar|resgatar|sair|entrar)",
    r"\b(qual|quais|que) (acao|acoes|ativo|ativos|fundo|fundos|fii|fiis|etf|cripto|investimento)s? (devo|deveria|comprar|vender|recomenda|indica|e melhor|sao melhores)",
    r"\b(recomend|indic|sugir|sugest)\w* .*(acao|acoes|ativo|fundo|fii|carteira|investimento|compra|venda)",
    r"\bmonte (uma|minha) carteira", r"\bcarteira recomendada", r"\bonde (devo )?investir",
    r"\b(compro|vendo) (agora|hoje|ou)", r"\bmelhor (acao|investimento|fundo|ativo)", r"\bpreco[- ]alvo",
    r"\bvai (subir|cair|valorizar)", r"\bhora (certa|de) (comprar|vender)",
]
CREDENTIAL_PATTERNS = [r"\bsenha\b.*\b(banco|conta|corretora)", r"\btoken\b.*\b(banco|seguranca)", r"\bminha senha\b"]

INTENTS = {
    "tributaria": [r"impost", r"\bir\b", r"irpf", r"darf", r"tribut", r"isen", r"prejuiz", r"aliquota", r"day ?trade",
                   r"ganho de capital", r"imposto de renda", r"receita federal", r"pgbl", r"vgbl", r"dedu"],
    "simulacao": [r"simul", r"cenario", r"e se ", r"what if", r"comparar cenario", r"compare"],
    "alertas": [r"alerta", r"atencao", r"pendenc", r"radar", r"o que (merece|preciso)", r"prioridade"],
    "patrimonio": [r"patrimon", r"carteira", r"aloca", r"posic", r"concentra", r"liquidez", r"quanto (eu )?tenho",
                   r"onde esta", r"investimento"],
    "financeira": [r"gasto", r"despes", r"receita", r"fluxo", r"categoria", r"orcamento", r"saldo", r"conta",
                   r"cartao", r"recorren", r"mudou", r"economi"],
    "documento": [r"document", r"informe", r"nota de corretagem", r"comprovante", r"upload", r"arquivo"],
}


@dataclass
class Classification:
    intent: str
    confidence: float
    matched: list
    guardrail: str | None = None


def classify(text: str) -> Classification:
    t = _norm(text)
    for p in INJECTION_PATTERNS:
        if re.search(p, t):
            return Classification("bloqueado", 1.0, [p], "prompt_injection")
    for p in CREDENTIAL_PATTERNS:
        if re.search(p, t):
            return Classification("bloqueado", 1.0, [p], "credencial")
    for p in ADVICE_PATTERNS:
        if re.search(p, t):
            return Classification("investimento_individual", 0.95, [p], "recomendacao_individual")
    scores = {}
    for intent, pats in INTENTS.items():
        hits = [p for p in pats if re.search(p, t)]
        if hits:
            scores[intent] = hits
    if not scores:
        return Classification("geral", 0.3, [])
    # prioridade em empate: simulação > tributária > alertas > patrimônio > financeira > documento
    order = ["simulacao", "tributaria", "alertas", "patrimonio", "financeira", "documento"]
    best = max(scores, key=lambda k: (len(scores[k]), -order.index(k)))
    return Classification(best, min(0.5 + 0.15 * len(scores[best]), 0.95), scores[best])


# ------------------------------------------------------------------------------ LLM plugável
class TemplateProvider:
    name = "template-deterministico"

    def rephrase(self, draft: str, evidence: list[dict]) -> str:
        return draft


class AnthropicProvider:
    """Reescreve o rascunho em linguagem natural SEM adicionar números. Ativo só com ANTHROPIC_API_KEY."""
    name = "anthropic"

    def __init__(self, model: str | None = None) -> None:
        self.key = os.environ["ANTHROPIC_API_KEY"]
        self.model = model or os.environ.get("RAMON_LLM_MODEL", "claude-sonnet-5")

    def rephrase(self, draft: str, evidence: list[dict]) -> str:
        import httpx
        system = ("Você reescreve respostas de uma plataforma de inteligência financeira e tributária. "
                  "Regras: não adicione, remova ou altere nenhum número; não recomende compra ou venda de ativos; "
                  "mantenha tom claro, em português do Brasil, no máximo 120 palavras.")
        r = httpx.post("https://api.anthropic.com/v1/messages", timeout=12,
                       headers={"x-api-key": self.key, "anthropic-version": "2023-06-01"},
                       json={"model": self.model, "max_tokens": 400, "system": system,
                             "messages": [{"role": "user", "content": f"Rascunho:\n{draft}"}]})
        r.raise_for_status()
        return "".join(b.get("text", "") for b in r.json().get("content", []))


def default_provider():
    if os.environ.get("ANTHROPIC_API_KEY") and os.environ.get("RAMON_LLM_ENABLED") == "1":
        return AnthropicProvider()
    return TemplateProvider()


NUM_RE = re.compile(r"R\$\s?-?[\d.]+,\d{2}|-?\d+(?:,\d+)?%")


def consistency_check(answer: str, evidence: list[dict]) -> tuple[bool, list[str]]:
    allowed = set()
    for e in evidence:
        for v in (e.get("display"), e.get("value"), e.get("label")):
            if isinstance(v, str):
                allowed.update(NUM_RE.findall(v))
    found = NUM_RE.findall(answer)
    missing = [n for n in found if n not in allowed]
    return (not missing, missing)


# ------------------------------------------------------------------------------ orquestração
@dataclass
class Answer:
    id: str
    thread_id: str
    question: str
    intent: str
    guardrail: str | None
    answer: str
    evidence: list
    tool_calls: list
    suggestions: list
    confidence: float
    provider: str
    consistency_ok: bool
    latency_ms: int
    correlation_id: str
    created_at: str
    disclaimer: str = ("Resposta informativa baseada nos resultados dos motores da plataforma. "
                       "Não é recomendação de investimento nem substitui um contador.")


GUARDRAIL_TEXT = {
    "recomendacao_individual": (
        "Não posso indicar compra ou venda de ativos específicos — isso seria uma recomendação individualizada, "
        "atividade reservada a consultores autorizados pela CVM. Posso, porém, mostrar dados objetivos: a sua "
        "composição e concentração atuais, o efeito tributário estimado de um cenário no simulador e as regras que se aplicam."),
    "prompt_injection": (
        "Não consigo alterar minhas regras de funcionamento. Posso ajudar com perguntas sobre seus dados financeiros, "
        "patrimônio, impostos estimados, alertas e simulações."),
    "credencial": (
        "Nunca informe senhas ou tokens de banco aqui. A conexão com instituições acontece pelo Open Finance, "
        "com autenticação feita diretamente no ambiente da instituição. Veja em Conexões."),
}


class AIOrchestrator:
    def __init__(self, tools: dict[str, Callable[[], dict]], provider=None, timeout_s: float = 8.0) -> None:
        self.tools = tools
        self.provider = provider or default_provider()
        self.timeout_s = timeout_s

    def ask(self, question: str, *, thread_id: str | None = None, correlation_id: str = "-",
            allowed_tools: set[str] | None = None) -> Answer:
        t0 = time.perf_counter()
        question = question.strip()[:800]
        cls = classify(question)
        calls, evidence, suggestions = [], [], []
        allowed_tools = allowed_tools if allowed_tools is not None else set(self.tools)

        def call(name: str) -> dict:
            if name not in allowed_tools:
                calls.append({"tool": name, "status": "nao_autorizado_no_plano"})
                return {}
            s = time.perf_counter()
            out = self.tools[name]()
            calls.append({"tool": name, "status": "ok", "latency_ms": round((time.perf_counter() - s) * 1000, 1)})
            return out

        conf = cls.confidence
        if cls.guardrail:
            draft = GUARDRAIL_TEXT[cls.guardrail]
            if cls.guardrail == "recomendacao_individual" and "portfolio" in allowed_tools:
                p = call("portfolio")
                if p:
                    top = [a for a in p["allocation"]][:3]
                    ev_line = "; ".join(f"{a['group']} {pct(a['weight'])}" for a in top)
                    draft += f"\n\nComposição atual (dado descritivo): {ev_line}."
                    evidence += [{"label": a["group"], "value": str(a["weight"]), "display": pct(a["weight"]), "source": "Portfolio Engine"} for a in top]
            suggestions = ["Ver composição do patrimônio", "Simular impacto tributário de uma venda", "Quais alertas existem?"]
        elif cls.intent == "tributaria":
            tx = call("tax")
            if not tx:
                draft = "A inteligência tributária está disponível a partir do plano Pro."
            else:
                draft, evidence = self._tax_answer(tx, question)
                conf = min(conf, tx.get("confidence", 1.0))
            suggestions = ["Por que meu imposto aumentou?", "Quais DARFs estão em aberto?", "Simular uma venda"]
        elif cls.intent == "simulacao":
            sims = call("simulations")
            draft = ("Você pode comparar o cenário atual com até três alternativas no Simulador: venda de ativos "
                     "(efeito no IR do mês e no ano) ou aporte em PGBL (efeito na dedução). ")
            if sims and sims.get("items"):
                last = sims["items"][0]
                diff = last.get("difference") or next((r.get("tax_difference_vs_base") for r in last.get("results", []) if r.get("tax_difference_vs_base")), None)
                if diff is not None:
                    draft += f"Sua última simulação ({last['kind']}) indicou diferença estimada de {brl(diff)} em relação ao cenário base."
                    evidence.append({"label": "Última simulação", "value": diff, "display": brl(diff), "source": "Simulation Engine"})
            suggestions = ["Abrir simulador", "Quanto tenho de prejuízo a compensar?"]
        elif cls.intent == "alertas":
            al = call("alerts")
            items = (al or {}).get("items", [])
            open_items = [a for a in items if a["status"] != "resolvido"]
            if not open_items:
                draft = "Não há alertas em aberto no momento."
            else:
                lines = [f"• {a['title']} — {a['detail']}" for a in open_items[:4]]
                draft = f"Há {len(open_items)} ponto(s) de atenção. Os mais prioritários:\n" + "\n".join(lines)
                for a in open_items[:4]:
                    for ev in a.get("evidence", []):
                        v = ev["value"]
                        disp = brl(v) if re.fullmatch(r"-?\d+\.\d{2}", str(v)) else str(v)
                        evidence.append({"label": f"{a['title']} · {ev['label']}", "value": str(v), "display": disp, "source": "Alert Engine"})
                    evidence.append({"label": a["title"], "value": a["detail"], "display": a["detail"], "source": "Alert Engine"})
            suggestions = ["Explique o primeiro alerta", "Quais DARFs estão em aberto?"]
        elif cls.intent == "patrimonio":
            p = call("portfolio")
            draft = (f"Seu patrimônio consolidado é de {brl(p['total'])}, com resultado de {brl(p['result'])} "
                     f"({pct(p['result_pct'])}) sobre o valor aplicado. Composição: " +
                     ", ".join(f"{a['group']} {pct(a['weight'])}" for a in p["allocation"]) + ". " +
                     f"A maior posição é {p['concentration']['largest_position']} "
                     f"({pct(p['concentration']['largest_weight'])}).")
            evidence = [{"label": "Patrimônio total", "value": p["total"], "display": brl(p["total"]), "source": "Portfolio Engine"},
                        {"label": "Resultado", "value": p["result"], "display": f"{brl(p['result'])} {pct(p['result_pct'])}", "source": "Portfolio Engine"},
                        {"label": f"Maior posição: {p['concentration']['largest_position']}", "value": str(p["concentration"]["largest_weight"]),
                         "display": pct(p["concentration"]["largest_weight"]), "source": "Portfolio Engine"}] + \
                       [{"label": a["group"], "value": a["value"], "display": pct(a["weight"]), "source": "Portfolio Engine"} for a in p["allocation"]]
            suggestions = ["Onde está meu dinheiro?", "Qual minha liquidez?"]
        elif cls.intent == "financeira":
            f = call("finance")
            tot = f["totals"]
            draft = (f"No período {f['period']['from']} a {f['period']['to']}, entradas somaram {brl(tot['income'])} e saídas "
                     f"{brl(tot['expense'])} (saldo {brl(tot['net'])}). Principais categorias de despesa: " +
                     ", ".join(f"{c['category']} {pct(c['share'])}" for c in f["by_category"][:3]) + ".")
            evidence = [{"label": "Entradas", "value": tot["income"], "display": brl(tot["income"]), "source": "Financial Engine"},
                        {"label": "Saídas", "value": tot["expense"], "display": brl(tot["expense"]), "source": "Financial Engine"},
                        {"label": "Saldo", "value": tot["net"], "display": brl(tot["net"]), "source": "Financial Engine"}] + \
                       [{"label": c["category"], "value": c["value"], "display": pct(c["share"]), "source": "Financial Engine"} for c in f["by_category"][:3]]
            if f.get("changes"):
                c = f["changes"][0]
                draft += (f" Mudança relevante: {c['category']} ficou em {brl(c['last'])} no último mês, contra "
                          f"{brl(c['baseline'])} de referência ({pct(c['delta_pct'])}).")
                evidence += [{"label": f"{c['category']} (último mês)", "value": c["last"], "display": brl(c["last"]), "source": "Financial Engine"},
                             {"label": f"{c['category']} (referência)", "value": c["baseline"], "display": brl(c["baseline"]), "source": "Financial Engine"},
                             {"label": "Variação", "value": str(c["delta_pct"]), "display": pct(c["delta_pct"]), "source": "Financial Engine"}]
            suggestions = ["O que mudou nos meus gastos?", "Quais despesas são recorrentes?"]
        elif cls.intent == "documento":
            d = call("documents")
            items = d.get("items", [])
            pend = [x for x in items if x.get("status") == "pendente"]
            draft = f"Você tem {len(items)} documento(s) registrados" + (f", {len(pend)} pendente(s): " + ", ".join(x["title"] for x in pend) if pend else ".")
            suggestions = ["Abrir documentos"]
        else:
            draft = ("Posso explicar seu patrimônio, finanças, impostos estimados, alertas e simulações. "
                     "Experimente: “Por que meu imposto aumentou?”, “O que mudou?” ou “Quais alertas existem?”.")
            suggestions = ["O que mudou?", "Quais alertas existem?", "Por que meu imposto aumentou?"]

        provider_name = self.provider.name
        text = draft
        if not cls.guardrail and not isinstance(self.provider, TemplateProvider):
            try:
                candidate = self.provider.rephrase(draft, evidence)
                ok, _ = consistency_check(candidate, evidence)
                text = candidate if ok and candidate.strip() else draft
                if text is draft:
                    provider_name += "→fallback-template"
            except Exception:
                provider_name += "→fallback-template"
        ok, missing = consistency_check(text, evidence)
        if not ok:   # defesa em profundidade: nunca emitir número sem evidência
            for n in missing:
                text = text.replace(n, "[valor sem evidência]")
        return Answer(id=new_id("ans"), thread_id=thread_id or new_id("thr"), question=question, intent=cls.intent,
                      guardrail=cls.guardrail, answer=text, evidence=evidence, tool_calls=calls, suggestions=suggestions,
                      confidence=round(conf, 2), provider=provider_name, consistency_ok=ok,
                      latency_ms=int((time.perf_counter() - t0) * 1000), correlation_id=correlation_id,
                      created_at=utcnow().isoformat())

    @staticmethod
    def _tax_answer(tx: dict, question: str) -> tuple[str, list]:
        months = [m for m in tx["months"] if D(m["tax_due_gross"]) > 0 or D(m["exempt_gain"]) > 0 or m.get("darf")]
        ev = [{"label": "Imposto estimado no ano (renda variável)", "value": tx["total_tax_due"], "display": brl(tx["total_tax_due"]), "source": "Tax Engine"},
              {"label": "Ganho isento no ano", "value": tx["total_exempt_gain"], "display": brl(tx["total_exempt_gain"]), "source": "Tax Engine"}]
        parts = [f"O imposto estimado sobre renda variável em {tx['year']} soma {brl(tx['total_tax_due'])}, com "
                 f"{brl(tx['total_exempt_gain'])} de ganhos isentos (vendas de ações até R$ 20.000,00 no mês)."]
        ev.append({"label": "Limite de isenção", "value": "20000.00", "display": "R$ 20.000,00", "source": "Regra BR-IRPF-RV-COMUM"})
        q = _norm(question)
        if months:
            last = months[-1]
            if "aument" in q or "por que" in q or "porque" in q:
                reasons = []
                if not last["exempt"] and D(last["result_acoes"]) > 0:
                    reasons.append(f"as vendas de ações em {last['month']} somaram {brl(last['sales_acoes'])}, acima do limite de isenção, então o ganho de ações entrou na base de 15%")
                    ev.append({"label": f"Vendas de ações {last['month']}", "value": last["sales_acoes"], "display": brl(last["sales_acoes"]), "source": "Tax Engine"})
                if D(last["result_daytrade"]) > 0:
                    reasons.append(f"houve resultado de day trade de {brl(last['result_daytrade'])}, tributado a 20%")
                    ev.append({"label": "Resultado day trade", "value": last["result_daytrade"], "display": brl(last["result_daytrade"]), "source": "Tax Engine"})
                if D(last["result_fii"]) > 0:
                    reasons.append(f"ganho com FII de {brl(last['result_fii'])}, tributado a 20%")
                    ev.append({"label": "Resultado FII", "value": last["result_fii"], "display": brl(last["result_fii"]), "source": "Tax Engine"})
                if reasons:
                    parts.append(f"No mês {last['month']}, " + "; ".join(reasons) + ".")
            darfs = [m["darf"] for m in tx["months"] if m.get("darf") and m["darf"]["status"] in ("aberto", "vencido")]
            if darfs:
                d0 = darfs[-1]
                parts.append(f"DARF em aberto: competência {d0['competencia']}, {brl(d0['valor'])}, vencimento {d0['vencimento']}.")
                ev.append({"label": f"DARF {d0['competencia']}", "value": d0["valor"], "display": brl(d0["valor"]), "source": "Tax Engine"})
        losses = {k: v for k, v in tx["losses_available"].items() if D(v) > 0}
        if losses:
            parts.append("Prejuízos a compensar: " + ", ".join(f"{k} {brl(v)}" for k, v in losses.items()) + ".")
            ev += [{"label": f"Prejuízo {k}", "value": v, "display": brl(v), "source": "Tax Engine"} for k, v in losses.items()]
        parts.append(f"Confiança do cálculo: {pct(tx['confidence'], 0)}.")
        ev.append({"label": "Confiança", "value": str(tx["confidence"]), "display": pct(tx["confidence"], 0), "source": "Tax Engine"})
        return " ".join(parts), ev
