"""Coletor da Selic mensal (SGS 4390) usada nos juros de mora do DARF — offline, sobre fixture."""
import importlib.util
import json
import os

ROOT = os.path.join(os.path.dirname(__file__), "..", "..", "scripts", "public_data")


def load():
    spec = importlib.util.spec_from_file_location("fetch_selic", os.path.join(ROOT, "fetch_selic.py"))
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


def test_selic_ordena_e_arredonda(tmp_path):
    fx = tmp_path / "fx.json"
    fx.write_text(json.dumps([{"data": "01/08/2026", "valor": "1,1734"}, {"data": "01/07/2026", "valor": "1.28"}]), encoding="utf-8")
    data = load().build(str(fx))
    assert data["items"] == [{"date": "2026-07-01", "value": 1.28}, {"date": "2026-08-01", "value": 1.17}]
    assert "4390" in data["serie"]
