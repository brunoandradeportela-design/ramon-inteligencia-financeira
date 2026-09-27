"""Data Hub — ingestão (manual, arquivo, conector) -> Raw Vault -> validação -> normalização -> reconciliação.

SOURCE -> RAW -> VALIDATED -> NORMALIZED -> RECONCILED (Plano técnico §7).
O payload original é imutável e fica separado do modelo canônico.
"""
from __future__ import annotations

from datetime import date
from decimal import Decimal

from connectors.base import RawPayload
from connectors.file_import import csv_parser
from services.common.core import D, ValidationFailed, new_id, sha256, utcnow
from services.common.models import Account, Holding, Lineage, Quote, Trade, Transaction
from services.common.store import Store
from services.financial_engine.engine import categorize
from services.reconciliation.normalize import (Reconciler, canonical_institution, canonical_ticker, infer_asset_class,
                                               quality_score, trade_fingerprint, tx_fingerprint)

PARSER_VERSION = "1.2.0"


class DataHub:
    def __init__(self, store: Store) -> None:
        self.store = store
        self.reconciler = Reconciler()

    # ---------------------------------------------------------------- raw vault
    def _raw(self, owner_id: str, source: str, kind: str, body, checksum: str | None = None) -> tuple[str, bool]:
        checksum = checksum or sha256(str(body))
        existing = self.store.get("raw_index", owner_id, checksum)
        if existing:
            return existing, True          # idempotência: mesmo conteúdo já ingerido
        rid = new_id("raw")
        self.store.put("raw_payloads", owner_id, rid, {"id": rid, "source": source, "kind": kind, "checksum": checksum,
                                                        "received_at": utcnow().isoformat(), "body": body,
                                                        "parser_version": PARSER_VERSION})
        self.store.put("raw_index", owner_id, checksum, rid)
        return rid, False

    def _lineage(self, source: str, institution: str, raw_id: str | None, competence: date | None, quality: float = 1.0) -> Lineage:
        now = utcnow().isoformat()
        return Lineage(source=source, institution=institution, raw_id=raw_id, ingested_at=now,
                       competence=competence.isoformat() if competence else "", verified_at=now,
                       parser_version=PARSER_VERSION, quality=quality)

    # ---------------------------------------------------------------- operações de bolsa
    def add_trades(self, owner_id: str, rows: list[dict], *, source: str, raw_id: str | None) -> dict:
        existing = {t.fingerprint for t in self.store.list("trades", owner_id)}
        incoming = []
        for r in rows:
            ticker = canonical_ticker(r["ticker"])
            cls = r.get("asset_class") or infer_asset_class(ticker)
            broker = canonical_institution(r.get("broker") or "Não informada")
            q = quality_score({**r, "broker": None if broker == "Não informada" else broker},
                              ["date", "ticker", "side", "quantity", "price", "broker"])
            t = Trade(id=new_id("trd"), owner_id=owner_id, date=r["date"], ticker=ticker, asset_class=cls,
                      side=r["side"], quantity=D(r["quantity"]), price=D(r["price"]), fees=D(r.get("fees", 0)),
                      daytrade=bool(r.get("daytrade")), broker=broker,
                      fingerprint=trade_fingerprint(owner_id, r["date"], ticker, r["side"], r["quantity"], r["price"], broker),
                      lineage=self._lineage(source, broker, raw_id, r["date"], q))
            incoming.append(t)
        accepted, dups = self.reconciler.dedupe(existing, incoming)
        for t in accepted:
            self.store.put("trades", owner_id, t.id, t)
        return {"accepted": len(accepted), "duplicates": len(dups)}

    def add_transactions(self, owner_id: str, rows: list[dict], *, source: str, raw_id: str | None,
                         institution: str = "Manual") -> dict:
        existing = {t.fingerprint for t in self.store.list("transactions", owner_id)}
        incoming = []
        for r in rows:
            acc = self.ensure_account(owner_id, r.get("account") or "Conta principal", institution)
            amount = D(r["amount"])
            t = Transaction(id=new_id("txn"), owner_id=owner_id, account_id=acc.id, date=r["date"],
                            description=r["description"].strip(), amount=amount,
                            category=r.get("category") or categorize(r["description"], amount),
                            fingerprint=tx_fingerprint(owner_id, acc.id, r["date"], r["description"], amount),
                            lineage=self._lineage(source, institution, raw_id, r["date"]))
            incoming.append(t)
        accepted, dups = self.reconciler.dedupe(existing, incoming)
        for t in accepted:
            self.store.put("transactions", owner_id, t.id, t)
        return {"accepted": len(accepted), "duplicates": len(dups)}

    def ensure_account(self, owner_id: str, name: str, institution: str, kind: str = "corrente",
                       balance: Decimal | None = None, source: str = "manual") -> Account:
        inst = canonical_institution(institution)
        for a in self.store.list("accounts", owner_id):
            if a.name == name and a.institution == inst:
                if balance is not None:
                    a.balance = balance
                return a
        a = Account(id=new_id("acc"), owner_id=owner_id, institution=inst, kind=kind, name=name,
                    balance=balance or Decimal("0"), lineage=self._lineage(source, inst, None, None))
        self.store.put("accounts", owner_id, a.id, a)
        return a

    def upsert_holding(self, owner_id: str, *, asset_id: str, name: str, asset_class: str, custodian: str,
                       value, invested, as_of: date, liquidity_days: int, source: str, raw_id: str | None = None,
                       extra: dict | None = None) -> Holding:
        cust = canonical_institution(custodian)
        for h in self.store.list("holdings", owner_id):
            if h.asset_id == asset_id and h.custodian == cust:
                h.value, h.invested, h.as_of = D(value), D(invested), as_of
                h.lineage = self._lineage(source, cust, raw_id, as_of)
                return h
        h = Holding(id=new_id("hld"), owner_id=owner_id, asset_id=asset_id, name=name, asset_class=asset_class,
                    custodian=cust, value=D(value), invested=D(invested), as_of=as_of, liquidity_days=liquidity_days,
                    lineage=self._lineage(source, cust, raw_id, as_of), extra=extra or {})
        self.store.put("holdings", owner_id, h.id, h)
        return h

    def set_quote(self, ticker: str, price, as_of: date, source: str) -> None:
        self.store.gput("quotes", canonical_ticker(ticker), Quote(canonical_ticker(ticker), D(price), as_of, source))

    # ---------------------------------------------------------------- entradas
    def import_csv(self, owner_id: str, filename: str, content: bytes) -> dict:
        text = content.decode("utf-8", "ignore")
        rid, dup = self._raw(owner_id, f"file:{filename}", "csv", text, sha256(content))
        if dup:
            return {"raw_id": rid, "idempotent_replay": True, "accepted": 0, "duplicates": 0, "errors": []}
        rows = csv_parser.sniff_rows(text)
        if not rows:
            raise ValidationFailed("Arquivo sem linhas de dados.")
        kind = csv_parser.detect_kind(rows)
        if kind == "trades":
            parsed, errors = csv_parser.parse_trades(rows)
            res = self.add_trades(owner_id, parsed, source=f"file:{filename}", raw_id=rid)
        else:
            parsed, errors = csv_parser.parse_transactions(rows)
            res = self.add_transactions(owner_id, parsed, source=f"file:{filename}", raw_id=rid, institution="Arquivo importado")
        return {"raw_id": rid, "kind": kind, "idempotent_replay": False, **res, "errors": errors}

    def ingest_connector(self, owner_id: str, connection, payloads: list[RawPayload]) -> dict:
        stats = {"accounts": 0, "transactions": 0, "holdings": 0, "duplicates": 0, "replayed": 0}
        today = date.today()
        for p in payloads:
            rid, dup = self._raw(owner_id, p.source, p.kind, p.body, p.checksum)
            if dup:
                stats["replayed"] += 1
                continue
            if p.kind == "accounts":
                for a in p.body:
                    self.ensure_account(owner_id, a["name"], connection.institution, balance=D(a["availableAmount"]), source=p.source)
                    stats["accounts"] += 1
            elif p.kind == "transactions":
                rows = [{"date": date.fromisoformat(t["bookingDate"]), "description": t["transactionName"],
                         "amount": D(t["amount"]), "account": next((a["name"] for a in []), None) or f"Conta {connection.institution}"}
                        for t in p.body]
                accs = self.store.list("accounts", owner_id, lambda a: a.institution == canonical_institution(connection.institution))
                for r in rows:
                    r["account"] = accs[0].name if accs else r["account"]
                res = self.add_transactions(owner_id, rows, source=p.source, raw_id=rid, institution=connection.institution)
                stats["transactions"] += res["accepted"]
                stats["duplicates"] += res["duplicates"]
            elif p.kind == "investments":
                for inv in p.body:
                    cls = {"BANK_FIXED_INCOMES": "renda_fixa", "CREDIT_FIXED_INCOMES": "renda_fixa", "TREASURE_TITLES": "tesouro",
                           "FUNDS": "fundo", "PENSION": "previdencia", "VARIABLE_INCOMES": "acao"}.get(inv["type"], "outro")
                    self.upsert_holding(owner_id, asset_id=inv["investmentId"], name=inv["productName"], asset_class=cls,
                                        custodian=connection.institution, value=inv["grossAmount"], invested=inv["investedAmount"],
                                        as_of=today, liquidity_days=int(inv.get("liquidityDays", 1)), source=p.source, raw_id=rid)
                    stats["holdings"] += 1
        return stats
