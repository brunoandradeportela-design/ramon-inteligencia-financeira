"""Selic acumulada no mês (Banco Central, SGS 4390) para os juros de mora de tributos federais.

Grava apps/web/app/data/public/selic.json com {date: AAAA-MM-01, value: % a.m.} desde 2015.
É a mesma taxa mensal que a Receita usa nos acréscimos legais do DARF (Sicalc). Sem segredos.
"""
import argparse
import datetime as dt
import json
import os
import sys
import urllib.request

OUT = os.path.join(os.path.dirname(__file__), "..", "..", "apps", "web", "app", "data", "public", "selic.json")
URL = "https://api.bcb.gov.br/dados/serie/bcdata.sgs.4390/dados?formato=json&dataInicial=01/01/2015&dataFinal={fim}"


def parse(rows):
    out = []
    for r in rows:
        d, m, y = r["data"].split("/")
        out.append({"date": f"{y}-{m}-01", "value": round(float(str(r["valor"]).replace(",", ".")), 2)})
    return sorted(out, key=lambda x: x["date"])


def build(fixture=None):
    if fixture:
        with open(fixture, encoding="utf-8") as f:
            rows = json.load(f)
    else:
        fim = dt.date.today().strftime("%d/%m/%Y")
        req = urllib.request.Request(URL.format(fim=fim), headers={"User-Agent": "AurionBot/1.0 (+https://aurionfinance.com.br)", "Accept": "application/json"})
        with urllib.request.urlopen(req, timeout=60) as r:
            rows = json.load(r)
    mes_atual = dt.date.today().strftime("%Y-%m")
    series = [x for x in parse(rows) if fixture or x["date"][:7] < mes_atual]  # mês corrente é parcial
    return {"generated_at": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"), "serie": "SGS 4390 — Selic acumulada no mês (% a.m.)",
            "fonte": "Banco Central do Brasil", "items": series}


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--fixture")
    ap.add_argument("--out", default=OUT)
    a = ap.parse_args()
    try:
        data = build(a.fixture)
    except Exception as e:  # noqa: BLE001 — mantém o arquivo anterior se o Banco Central falhar
        print(f"falha ao buscar a Selic: {e}; mantendo o arquivo anterior", file=sys.stderr)
        sys.exit(0)
    if not data["items"]:
        print("série vazia; mantendo o arquivo anterior", file=sys.stderr)
        sys.exit(0)
    os.makedirs(os.path.dirname(a.out), exist_ok=True)
    with open(a.out, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, separators=(",", ":"))
    print(f"{len(data['items'])} meses de Selic (último {data['items'][-1]['date'][:7]})")
