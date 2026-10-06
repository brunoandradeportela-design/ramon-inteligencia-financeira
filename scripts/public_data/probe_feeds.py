"""Sonda de feeds RSS: imprime no log do GitHub Actions (anotações ::notice) quantos itens e a data mais recente de cada URL.
Uso: python probe_feeds.py URL [URL...]"""
import os
import sys
import urllib.request

sys.path.insert(0, os.path.dirname(__file__))
from fetch_news import parse  # noqa: E402

for url in sys.argv[1:]:
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "AURION-public-data/1.0 (+github actions)"})
        with urllib.request.urlopen(req, timeout=40) as r:
            raw, ctype, status = r.read(), r.headers.get("Content-Type", ""), r.status
        try:
            items = parse(raw)
            dates = sorted(i["published_at"] for i in items if i["published_at"])
            print(f"::notice title=feed ok::{url} | HTTP {status} | {ctype[:30]} | itens={len(items)} | mais recente={dates[-1] if dates else None} | primeiro={items[0]['title'][:60] if items else ''}")
        except Exception as e:
            print(f"::notice title=feed nao-xml::{url} | HTTP {status} | {ctype[:30]} | {str(e)[:80]} | inicio={raw[:80]!r}")
    except Exception as e:
        print(f"::notice title=feed erro::{url} | {str(e)[:150]}")
