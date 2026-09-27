"""Importação de arquivos CSV (notas/extratos exportados). Tolerante a formatos BR (1.234,56 e dd/mm/aaaa)."""
from __future__ import annotations

import csv
import io
from datetime import date, datetime
from decimal import Decimal, InvalidOperation

from services.common.core import ValidationFailed

TRADE_HEADERS = {"data", "ticker", "tipo", "quantidade", "preco"}
TX_HEADERS = {"data", "descricao", "valor"}


def parse_decimal(v: str) -> Decimal:
    s = (v or "").strip().replace("R$", "").replace(" ", "")
    if "," in s and "." in s:
        s = s.replace(".", "").replace(",", ".")
    elif "," in s:
        s = s.replace(",", ".")
    try:
        return Decimal(s or "0")
    except InvalidOperation:
        raise ValueError(f"número inválido: {v!r}")


def parse_date(v: str) -> date:
    v = v.strip()
    for fmt in ("%Y-%m-%d", "%d/%m/%Y", "%d/%m/%y"):
        try:
            return datetime.strptime(v, fmt).date()
        except ValueError:
            pass
    raise ValueError(f"data inválida: {v!r}")


def sniff_rows(text: str) -> list[dict]:
    text = text.lstrip("﻿")
    first = text.splitlines()[0] if text.strip() else ""
    delim = ";" if first.count(";") >= first.count(",") else ","
    reader = csv.DictReader(io.StringIO(text), delimiter=delim)
    rows = []
    for r in reader:
        rows.append({(k or "").strip().lower().replace("ç", "c").replace("é", "e"): (v or "").strip() for k, v in r.items()})
    return rows


def detect_kind(rows: list[dict]) -> str:
    keys = set(rows[0].keys()) if rows else set()
    if TRADE_HEADERS <= keys:
        return "trades"
    if TX_HEADERS <= keys:
        return "transactions"
    raise ValidationFailed("Formato de CSV não reconhecido. Use os modelos em docs/connectors/modelos-csv.md.")


def parse_trades(rows: list[dict]) -> tuple[list[dict], list[dict]]:
    ok, errors = [], []
    for i, r in enumerate(rows, start=2):
        try:
            side = r["tipo"].upper()[:1]
            if side not in ("C", "V"):
                raise ValueError("tipo deve ser C ou V")
            ok.append({"date": parse_date(r["data"]), "ticker": r["ticker"], "side": side,
                       "quantity": parse_decimal(r["quantidade"]), "price": parse_decimal(r["preco"]),
                       "fees": parse_decimal(r.get("custos", "0") or "0"),
                       "daytrade": (r.get("daytrade", "") or "").lower() in ("1", "s", "sim", "true", "x"),
                       "broker": r.get("corretora", "") or "Não informada",
                       "asset_class": (r.get("classe") or "").lower() or None})
        except (ValueError, KeyError) as e:
            errors.append({"line": i, "error": str(e)})
    return ok, errors


def parse_transactions(rows: list[dict]) -> tuple[list[dict], list[dict]]:
    ok, errors = [], []
    for i, r in enumerate(rows, start=2):
        try:
            ok.append({"date": parse_date(r["data"]), "description": r["descricao"], "amount": parse_decimal(r["valor"]),
                       "account": r.get("conta", "") or "Conta principal", "category": r.get("categoria") or None})
        except (ValueError, KeyError) as e:
            errors.append({"line": i, "error": str(e)})
    return ok, errors
