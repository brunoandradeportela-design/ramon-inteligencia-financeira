"""Divulgações públicas das companhias abertas (CVM — Portal de Dados Abertos, conjunto IPE).

Fonte pública e rastreável: cada item guarda o protocolo de entrega e o link do documento original na CVM.
Tickers vêm do FCA (valores mobiliários negociados). Saída: apps/web/app/data/public/disclosures.json.
Executado pelo GitHub Actions (ADR-0012); o Worker não faz esse processamento pesado.
Uso: python fetch_disclosures.py [--days 60] [--fixture-dir DIR]  (fixture para testes offline)
"""
import argparse, csv, datetime as dt, io, json, os, sys, urllib.request, zipfile

BASE = "https://dados.cvm.gov.br/dados/CIA_ABERTA/DOC"
OUT = os.path.join(os.path.dirname(__file__), "..", "..", "apps", "web", "app", "data", "public", "disclosures.json")
SOURCE = "CVM — Portal de Dados Abertos (IPE)"
CATS = [("fato relevante", "fato_relevante"), ("comunicado ao mercado", "comunicado"), ("aviso aos acionistas", "aviso_acionistas"),
        ("assembleia", "assembleia"), ("dados econ", "resultado"), ("itr", "resultado"), ("dfp", "resultado")]
LABEL = {"fato_relevante": "Fato relevante", "comunicado": "Comunicado ao mercado", "aviso_acionistas": "Aviso aos acionistas",
         "assembleia": "Assembleia", "resultado": "Resultado/informação financeira", "outro": "Outro"}


def fetch_zip(url, fixture_dir=None):
    name = url.rsplit("/", 1)[-1]
    if fixture_dir:
        p = os.path.join(fixture_dir, name)
        return zipfile.ZipFile(p) if os.path.exists(p) else None
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "AURION-public-data/1.0 (+github actions)"})
        with urllib.request.urlopen(req, timeout=120) as r:
            return zipfile.ZipFile(io.BytesIO(r.read()))
    except Exception as e:  # ano ainda não publicado, indisponibilidade etc.
        print(f"aviso: {url}: {e}", file=sys.stderr)
        return None


def read_csv(zf, endswith):
    for n in zf.namelist():
        if n.lower().endswith(endswith):
            raw = zf.read(n)
            for enc in ("utf-8-sig", "latin-1"):
                try:
                    txt = raw.decode(enc); break
                except UnicodeDecodeError:
                    continue
            return list(csv.DictReader(io.StringIO(txt), delimiter=";"))
    return []


def norm_cnpj(s):
    return "".join(ch for ch in (s or "") if ch.isdigit())


def category(row):
    t = " ".join([row.get("Categoria", ""), row.get("Tipo", ""), row.get("Especie", "")]).lower()
    for k, v in CATS:
        if k in t:
            return v
    return "outro"


def tickers_by_cnpj(years, fixture_dir):
    out = {}
    for y in years:
        zf = fetch_zip(f"{BASE}/FCA/DADOS/fca_cia_aberta_{y}.zip", fixture_dir)
        if not zf:
            continue
        for r in read_csv(zf, f"valor_mobiliario_{y}.csv"):
            code = (r.get("Codigo_Negociacao") or "").strip().upper()
            if code and code.isalnum() and 5 <= len(code) <= 7:
                out.setdefault(norm_cnpj(r.get("CNPJ_Companhia")), set()).add(code)
        if out:
            break
    return {k: sorted(v) for k, v in out.items()}


def build(days=60, fixture_dir=None, today=None):
    today = today or dt.date.today()
    since = today - dt.timedelta(days=days)
    years = sorted({today.year, since.year}, reverse=True)
    tick = tickers_by_cnpj(years, fixture_dir)
    items, seen = [], set()
    for y in years:
        zf = fetch_zip(f"{BASE}/IPE/DADOS/ipe_cia_aberta_{y}.zip", fixture_dir)
        if not zf:
            continue
        for r in read_csv(zf, f"ipe_cia_aberta_{y}.csv"):
            entrega = (r.get("Data_Entrega") or "")[:10]
            if not entrega or entrega < since.isoformat():
                continue
            cnpj = norm_cnpj(r.get("CNPJ_Companhia"))
            tks = tick.get(cnpj, [])
            if not tks:  # só companhias com ativos negociados (escopo do AURION)
                continue
            proto = (r.get("Protocolo_Entrega") or "").strip()
            key = (proto, r.get("Versao"))
            if key in seen:
                continue
            seen.add(key)
            cat = category(r)
            items.append({
                "id": f"ipe_{proto}_{r.get('Versao') or '1'}", "date": (r.get("Data_Referencia") or entrega)[:10], "published_at": entrega,
                "company": (r.get("Nome_Companhia") or "").strip(), "cnpj": cnpj, "tickers": tks,
                "category": cat, "category_label": LABEL[cat] if cat != "outro" else (r.get("Categoria") or "Outro").strip(),
                "subject": " · ".join(x for x in [(r.get("Tipo") or "").strip(), (r.get("Assunto") or "").strip()] if x)[:280],
                "protocol": proto, "version": r.get("Versao"), "url": (r.get("Link_Download") or "").strip() or None, "source": SOURCE,
            })
    items.sort(key=lambda x: (x["published_at"], x["protocol"]), reverse=True)
    return {"generated_at": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"), "source": SOURCE,
            "source_url": "https://dados.cvm.gov.br/dataset/cia_aberta-doc-ipe", "window_days": days,
            "companies_with_tickers": len(tick), "items": items[:4000]}


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--days", type=int, default=60)
    ap.add_argument("--fixture-dir")
    ap.add_argument("--out", default=OUT)
    a = ap.parse_args()
    data = build(a.days, a.fixture_dir)
    if not data["items"] and not a.fixture_dir and os.path.exists(a.out):
        print("nenhum item novo coletado; mantendo o arquivo anterior", file=sys.stderr); sys.exit(0)
    os.makedirs(os.path.dirname(a.out), exist_ok=True)
    with open(a.out, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, separators=(",", ":"))
    print(f"{len(data['items'])} divulgações · {data['companies_with_tickers']} companhias com ticker")
