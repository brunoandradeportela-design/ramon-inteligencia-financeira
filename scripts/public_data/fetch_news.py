"""Notícias públicas (RSS de fontes oficiais/públicas) para o AURION.

Guarda só título, link, fonte, data e etiquetas — o texto fica no site de origem (direitos autorais).
A personalização por exposição é feita no app, sem enviar a carteira a terceiros.
Notícia licenciada (agência paga) entra por adaptador desligado — ADR-0013.
Uso: python fetch_news.py [--fixture-dir DIR]
"""
import argparse
import datetime as dt
import email.utils
import hashlib
import json
import os
import re
import sys
import urllib.request
import xml.etree.ElementTree as ET

OUT = os.path.join(os.path.dirname(__file__), "..", "..", "apps", "web", "app", "data", "public", "news.json")
FEEDS = [
    ("agencia_brasil", "Agência Brasil — Economia", "https://agenciabrasil.ebc.com.br/rss/economia/feed.xml"),
    ("bcb", "Banco Central do Brasil — Notas", "https://www.bcb.gov.br/api/feed/sitebcb/sitefeeds/notas"),
    ("cvm", "CVM — Notícias", "https://www.gov.br/cvm/pt-br/assuntos/noticias/RSS"),
    ("receita", "Receita Federal — Notícias", "https://www.gov.br/receitafederal/pt-br/assuntos/noticias/RSS"),
]
TAGS = {
    "juros": r"\bselic\b|\bcopom\b|taxa de juros|\bjuros\b", "inflacao": r"infla[çc][ãa]o|\bipca\b|\bigp-?m\b",
    "imposto": r"imposto|\birpf\b|\bir\b|tribut|receita federal|declara[çc][ãa]o|\bdarf\b|\bcome-cotas\b",
    "bolsa": r"\bb3\b|bolsa|a[çc][õo]es|ibovespa|\bcvm\b|companhia aberta|fato relevante",
    "fii": r"fundos? imobili[áa]rios?|\bfii", "renda_fixa": r"tesouro direto|renda fixa|\bcdb\b|\blci\b|\blca\b|deb[êe]ntures?",
    "cambio": r"c[âa]mbio|d[óo]lar", "previdencia": r"previd[êe]ncia|\bpgbl\b|\bvgbl\b", "cripto": r"cripto|bitcoin",
}
TICKER = re.compile(r"\b([A-Z]{4}(?:3|4|5|6|11))\b")


def get(url, fixture_dir, key):
    if fixture_dir:
        p = os.path.join(fixture_dir, key + ".xml")
        return open(p, "rb").read() if os.path.exists(p) else None
    req = urllib.request.Request(url, headers={"User-Agent": "AURION-public-data/1.0 (+github actions)"})
    with urllib.request.urlopen(req, timeout=60) as r:
        return r.read()


def when(s):
    s = (s or "").strip()
    if not s:
        return None
    try:
        return email.utils.parsedate_to_datetime(s).astimezone(dt.timezone.utc).isoformat(timespec="seconds")
    except Exception:
        pass
    try:
        return dt.datetime.fromisoformat(s.replace("Z", "+00:00")).astimezone(dt.timezone.utc).isoformat(timespec="seconds")
    except Exception:
        return None


def parse(raw):
    root = ET.fromstring(raw)
    out = []
    strip = lambda t: t.split("}", 1)[-1]
    for el in root.iter():
        if strip(el.tag) not in ("item", "entry"):
            continue
        f = {}
        for c in el:
            n = strip(c.tag)
            if n == "link" and c.get("href"):
                f.setdefault("link", c.get("href"))
            elif c.text:
                f.setdefault(n, c.text.strip())
        out.append({"title": f.get("title"), "url": f.get("link") or f.get("guid"),
                    "published_at": when(f.get("pubDate") or f.get("published") or f.get("updated") or f.get("date"))})
    return [x for x in out if x["title"] and x["url"]]


def build(fixture_dir=None, days=21):
    since = (dt.datetime.now(dt.timezone.utc) - dt.timedelta(days=days)).isoformat()
    items, sources = [], []
    for key, name, url in FEEDS:
        try:
            raw = get(url, fixture_dir, key)
            got = parse(raw) if raw else []
            sources.append({"id": key, "name": name, "url": url, "status": "ok" if got else "vazio", "items": len(got)})
        except Exception as e:
            print(f"aviso: {name}: {e}", file=sys.stderr)
            sources.append({"id": key, "name": name, "url": url, "status": "indisponivel", "items": 0})
            got = []
        for g in got:
            if g["published_at"] and g["published_at"] < since:
                continue
            title = re.sub(r"\s+", " ", g["title"])[:220]
            low = title.lower()
            items.append({"id": "nw_" + hashlib.sha1(g["url"].encode()).hexdigest()[:16], "title": title, "url": g["url"], "source": name, "source_id": key,
                          "published_at": g["published_at"], "tags": [t for t, rx in TAGS.items() if re.search(rx, low)],
                          "tickers": sorted(set(TICKER.findall(g["title"])))})
    uniq = {i["id"]: i for i in items}
    items = sorted(uniq.values(), key=lambda x: x["published_at"] or "", reverse=True)[:400]
    return {"generated_at": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"), "sources": sources, "items": items,
            "note": "Somente título e link; o conteúdo pertence à fonte. Não é recomendação de investimento."}


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--fixture-dir")
    ap.add_argument("--out", default=OUT)
    a = ap.parse_args()
    data = build(a.fixture_dir)
    if not data["items"] and not a.fixture_dir and os.path.exists(a.out):
        print("nenhuma notícia coletada; mantendo o arquivo anterior", file=sys.stderr)
        sys.exit(0)
    os.makedirs(os.path.dirname(a.out), exist_ok=True)
    with open(a.out, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, separators=(",", ":"))
    print(f"{len(data['items'])} notícias de {sum(1 for s in data['sources'] if s['status'] == 'ok')} fontes")
