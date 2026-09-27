from decimal import Decimal

from connectors.file_import.csv_parser import parse_decimal, parse_trades, sniff_rows
from services.audit.log import AuditLog
from services.common.core import brl
from services.common.store import Store
from services.document_engine.engine import validate_upload
from services.ingestion.hub import DataHub
from services.reconciliation.normalize import canonical_institution, canonical_ticker, infer_asset_class

import pytest
from services.common.core import ValidationFailed


def test_normalizacao():
    assert canonical_ticker(" petr4f ") == "PETR4"
    assert canonical_institution("XP investimentos") == "XP Investimentos"
    assert infer_asset_class("HGLG11") == "fii" and infer_asset_class("BOVA11") == "etf" and infer_asset_class("TAEE11") == "acao"
    assert infer_asset_class("AAPL34") == "bdr"


def test_decimal_brasileiro():
    assert parse_decimal("1.234,56") == Decimal("1234.56")
    assert parse_decimal("R$ 10,5") == Decimal("10.5")
    assert brl("1248320") == "R$ 1.248.320,00"
    assert brl("-12.5") == "-R$ 12,50"


def test_import_csv_idempotente_e_deduplica():
    hub = DataHub(Store())
    csv = "data;ticker;tipo;quantidade;preco;custos;daytrade;corretora\n10/01/2026;PETR4;C;100;30,50;1,20;;XP\n10/01/2026;PETR4F;C;100;30,50;1,20;;xp investimentos\n"
    r1 = hub.import_csv("u", "nota.csv", csv.encode())
    assert r1["accepted"] == 1 and r1["duplicates"] == 1      # PETR4F = PETR4 e XP = XP Investimentos
    r2 = hub.import_csv("u", "nota.csv", csv.encode())
    assert r2["idempotent_replay"] is True and r2["accepted"] == 0
    t = hub.store.list("trades", "u")[0]
    assert t.lineage.source == "file:nota.csv" and t.lineage.raw_id and t.lineage.reconciliation == "reconciled"


def test_csv_linha_invalida_reportada():
    rows = sniff_rows("data,ticker,tipo,quantidade,preco\n2026-01-10,PETR4,X,1,1\n2026-01-10,PETR4,C,1,1\n")
    ok, errors = parse_trades(rows)
    assert len(ok) == 1 and errors[0]["line"] == 2


def test_isolamento_por_titular():
    s = Store()
    s.put("trades", "a", "1", "dado-a")
    assert s.list("trades", "b") == [] and s.get("trades", "b", "1") is None
    with pytest.raises(ValueError):
        s.put("trades", "", "x", 1)


def test_auditoria_encadeada_detecta_adulteracao():
    s = Store()
    log = AuditLog(s)
    log.record(owner_id="u", actor="u", resource="x", action="a", after={"password": "segredo", "v": 1})
    log.record(owner_id="u", actor="u", resource="x", action="b")
    assert log.verify_chain("u")
    assert log.list("u")[0].after["password"] == "***"
    e = log.list("u")[0]
    object.__setattr__(e, "action", "adulterado")
    assert not log.verify_chain("u")


@pytest.mark.parametrize("name,mime,content", [
    ("virus.exe", "application/octet-stream", b"MZ..."),
    ("falso.pdf", "application/pdf", b"not a pdf"),
    ("ativo.pdf", "application/pdf", b"%PDF-1.7 /JavaScript (app.alert(1))"),
    ("../../etc/passwd.csv", "text/csv", b"\x00\x01"),
    ("vazio.csv", "text/csv", b""),
])
def test_upload_malicioso_rejeitado(name, mime, content):
    with pytest.raises(ValidationFailed):
        validate_upload(name, mime, content)


def test_upload_valido():
    name, mime = validate_upload("Informe rendimentos.pdf", "application/pdf", b"%PDF-1.7 ok")
    assert name == "Informe rendimentos.pdf" and mime == "application/pdf"
