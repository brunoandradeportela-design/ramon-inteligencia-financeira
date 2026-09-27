"""Normalização e reconciliação — identidade canônica, deduplicação e score de qualidade (Dossiê §48)."""
from __future__ import annotations

import re
import unicodedata

from services.common.core import sha256

INSTITUTION_ALIASES = {
    "xp": "XP Investimentos", "xp investimentos": "XP Investimentos", "xpi": "XP Investimentos",
    "btg": "BTG Pactual", "btg pactual": "BTG Pactual",
    "itau": "Itaú Unibanco", "itau unibanco": "Itaú Unibanco", "itaú": "Itaú Unibanco",
    "nubank": "Nubank", "nu pagamentos": "Nubank", "nu": "Nubank",
    "bb": "Banco do Brasil", "banco do brasil": "Banco do Brasil",
    "inter": "Banco Inter", "banco inter": "Banco Inter",
    "rico": "Rico", "clear": "Clear", "tesouro direto": "Tesouro Direto",
}
TICKER_RE = re.compile(r"^([A-Z]{4})(\d{1,2})F?$")


def strip_accents(s: str) -> str:
    return "".join(c for c in unicodedata.normalize("NFD", s) if unicodedata.category(c) != "Mn")


def canonical_institution(name: str) -> str:
    key = strip_accents(name).strip().lower()
    return INSTITUTION_ALIASES.get(key, name.strip())


def canonical_ticker(raw: str) -> str:
    """PETR4F (fracionário) -> PETR4; remove espaços e sufixos de mercado."""
    t = raw.strip().upper().replace(" ", "")
    m = TICKER_RE.match(t)
    return f"{m.group(1)}{m.group(2)}" if m else t


def infer_asset_class(ticker: str) -> str:
    t = canonical_ticker(ticker)
    m = TICKER_RE.match(t)
    if not m:
        return "outro"
    n = int(m.group(2))
    if n == 11:
        # 11 pode ser FII, ETF ou unit — heurística marcada com qualidade menor
        return "fii" if t.endswith("11") and t[:4] in KNOWN_FII else ("etf" if t[:4] in KNOWN_ETF else "acao")
    if n in (32, 33, 34, 35):
        return "bdr"
    return "acao"


KNOWN_FII = {"HGLG", "KNRI", "MXRF", "XPML", "VISC", "BTLG", "HGRU", "KNCR", "XPLG", "RBRF"}
KNOWN_ETF = {"BOVA", "IVVB", "SMAL", "HASH", "BOVV", "DIVO", "NASD", "XFIX"}


def trade_fingerprint(owner_id: str, d, ticker, side, qty, price, broker) -> str:
    return sha256(f"{owner_id}|{d}|{canonical_ticker(ticker)}|{side}|{qty}|{price}|{canonical_institution(broker)}")


def tx_fingerprint(owner_id: str, account_id: str, d, desc: str, amount) -> str:
    norm = re.sub(r"\s+", " ", strip_accents(desc).lower()).strip()
    return sha256(f"{owner_id}|{account_id}|{d}|{norm}|{amount}")


def quality_score(record: dict, required: list[str]) -> float:
    present = sum(1 for f in required if record.get(f) not in (None, "", "?"))
    return round(present / len(required), 2) if required else 1.0


class Reconciler:
    """Marca duplicidades entre fontes (mesmo fingerprint) e divergências de posição."""

    def dedupe(self, existing: set[str], incoming: list, key=lambda r: r.fingerprint):
        accepted, duplicates = [], []
        seen = set(existing)
        for r in incoming:
            fp = key(r)
            if fp in seen:
                duplicates.append(r)
                r.lineage.reconciliation = "duplicate"
            else:
                seen.add(fp)
                r.lineage.reconciliation = "reconciled"
                accepted.append(r)
        return accepted, duplicates

    def position_divergence(self, computed_qty: dict, reported_qty: dict, tolerance=0) -> list[dict]:
        out = []
        for ticker in sorted(set(computed_qty) | set(reported_qty)):
            a, b = computed_qty.get(ticker, 0), reported_qty.get(ticker, 0)
            if abs(a - b) > tolerance:
                out.append({"ticker": ticker, "computed": str(a), "reported": str(b), "status": "divergent"})
        return out
