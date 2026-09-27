"""Golden cases do Tax Engine — cada caso tem entrada fixa e resultado esperado calculado à mão."""
from datetime import date
from decimal import Decimal

import pytest

from services.common.models import Lineage, Trade
from services.tax_engine.engine import RuleRegistry, RulePending, TaxEngine

ENGINE = TaxEngine()
REF = date(2026, 12, 31)


def T(d, ticker, side, qty, price, fees="0", cls="acao", dt=False, tid=None):
    return Trade(id=tid or f"{d}{ticker}{side}{qty}", owner_id="u", date=date.fromisoformat(d), ticker=ticker, asset_class=cls,
                 side=side, quantity=Decimal(qty), price=Decimal(price), fees=Decimal(fees), daytrade=dt, broker="XP",
                 fingerprint="", lineage=Lineage(source="test", institution="XP"))


def month(res, mk):
    return next(m for m in res.months if m.month == mk)


def test_isencao_20k():
    r = ENGINE.compute([T("2026-01-10", "PETR4", "C", 1000, "10"), T("2026-02-10", "PETR4", "V", 1000, "19.99")], year=2026, reference_date=REF)
    m = month(r, "2026-02")
    assert m.exempt is True
    assert m.exempt_gain == "9990.00"
    assert m.tax_due == "0.00" and m.darf is None
    assert r.events[0].status == "isento"


def test_ganho_tributavel_acima_20k():
    r = ENGINE.compute([T("2026-01-10", "VALE3", "C", 1000, "10"), T("2026-03-10", "VALE3", "V", 1000, "25", fees="10")], year=2026, reference_date=REF)
    m = month(r, "2026-03")
    # ganho = 25000 - 10 - 10000 = 14990 ; IR 15% = 2248.50 ; IRRF 0,005% de 25000 = 1.25
    assert m.exempt is False
    assert m.base_comum == "14990.00"
    assert m.tax_comum == "2248.50"
    assert m.irrf == "1.25"
    assert m.tax_due == "2247.25"
    assert m.darf["vencimento"] == "2026-04-30" and m.darf["codigo"] == "6015"


def test_etf_nao_tem_isencao():
    r = ENGINE.compute([T("2026-01-10", "BOVA11", "C", 100, "100", cls="etf"), T("2026-02-10", "BOVA11", "V", 100, "120", cls="etf")], year=2026, reference_date=REF)
    m = month(r, "2026-02")
    assert m.sales_acoes == "0.00" and m.exempt is True   # limite só olha ações
    assert m.base_comum == "2000.00" and m.tax_comum == "300.00"


def test_compensacao_prejuizo():
    trades = [T("2026-01-05", "ITUB4", "C", 2000, "30"), T("2026-02-05", "ITUB4", "V", 1000, "25"),   # prejuízo 5000 (vendas 25k)
              T("2026-03-05", "ITUB4", "V", 1000, "38")]                                              # ganho 8000 (vendas 38k)
    r = ENGINE.compute(trades, year=2026, reference_date=REF)
    assert month(r, "2026-02").loss_carry["comum"] == "5000.00"
    m = month(r, "2026-03")
    assert m.base_comum == "3000.00" and m.tax_comum == "450.00"
    assert r.losses_available["comum"] == "0.00"


def test_prejuizo_anterior_informado():
    trades = [T("2026-01-05", "WEGE3", "C", 1000, "40"), T("2026-02-05", "WEGE3", "V", 1000, "50")]
    r = ENGINE.compute(trades, year=2026, reference_date=REF, prior_losses={"comum": "4000"})
    assert month(r, "2026-02").base_comum == "6000.00"


def test_daytrade():
    trades = [T("2026-05-06", "PETR4", "C", 1000, "30", fees="5", dt=True), T("2026-05-06", "PETR4", "V", 1000, "31", fees="5", dt=True)]
    r = ENGINE.compute(trades, year=2026, reference_date=REF)
    m = month(r, "2026-05")
    # resultado = 31000-5 - (30000+5) = 990 ; IR 20% = 198 ; IRRF 1% = 9.90
    assert m.result_daytrade == "990.00" and m.tax_daytrade == "198.00" and m.irrf == "9.90"
    assert m.tax_due == "188.10"


def test_daytrade_prejuizo_nao_compensa_comum():
    trades = [T("2026-05-06", "PETR4", "C", 1000, "31", dt=True), T("2026-05-06", "PETR4", "V", 1000, "30", dt=True),
              T("2026-05-01", "VALE3", "C", 1000, "10"), T("2026-06-10", "VALE3", "V", 1000, "30")]
    r = ENGINE.compute(trades, year=2026, reference_date=REF)
    assert r.losses_available["daytrade"] == "1000.00"
    assert month(r, "2026-06").base_comum == "20000.00"


def test_fii():
    r = ENGINE.compute([T("2026-01-10", "HGLG11", "C", 100, "150", cls="fii"), T("2026-02-10", "HGLG11", "V", 100, "160", cls="fii")], year=2026, reference_date=REF)
    m = month(r, "2026-02")
    assert m.base_fii == "1000.00" and m.tax_fii == "200.00"


def test_darf_minimo_acumula():
    trades = [T("2026-01-10", "BOVA11", "C", 10, "100", cls="etf"), T("2026-02-10", "BOVA11", "V", 5, "110", cls="etf"),   # ganho 50 -> IR 7.50
              T("2026-03-10", "BOVA11", "V", 5, "110", cls="etf")]                                                          # +7.50
    r = ENGINE.compute(trades, year=2026, reference_date=REF)
    assert month(r, "2026-02").darf is None
    m = month(r, "2026-03")
    assert m.darf is not None and m.carry_in != "0.00"


def test_venda_sem_custo_reduz_confianca():
    r = ENGINE.compute([T("2026-03-10", "TAEE11", "V", 100, "35")], year=2026, reference_date=REF)
    assert r.confidence < 0.6
    assert r.events[0].status == "pendente_dado"


def test_reprodutibilidade():
    trades = [T("2026-01-10", "VALE3", "C", 1000, "10"), T("2026-03-10", "VALE3", "V", 1000, "25")]
    a = ENGINE.compute(trades, year=2026, reference_date=REF)
    b = ENGINE.compute(list(reversed(trades)), year=2026, reference_date=REF)
    assert a.snapshot_hash == b.snapshot_hash and a.total_tax_due == b.total_tax_due


def test_regra_pendente_nao_calcula():
    with pytest.raises(RulePending):
        RuleRegistry().get("BR-IRPF-TABELA-ANUAL", date(2026, 6, 1))


def test_todas_regras_validadas_tem_fonte_e_teste():
    for r in RuleRegistry().rules.values():
        if r.status == "validated":
            assert r.sources and r.tests and r.validity["start"] and r.formula


def test_darf_pago_marcado_como_efetivo():
    trades = [T("2026-01-10", "VALE3", "C", 1000, "10"), T("2026-03-10", "VALE3", "V", 1000, "25")]
    r = ENGINE.compute(trades, year=2026, reference_date=REF, paid_darfs={"2026-03": "2248.75"})
    d = month(r, "2026-03").darf
    assert d["status"] == "pago" and d["tipo_valor"] == "efetivamente_pago"
