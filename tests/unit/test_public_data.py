"""Coletores de dados públicos (CVM IPE + FCA, RSS) rodando offline sobre fixtures geradas no teste."""
import datetime as dt
import importlib.util
import io
import os
import zipfile

ROOT = os.path.join(os.path.dirname(__file__), "..", "..", "scripts", "public_data")


def load(name):
    spec = importlib.util.spec_from_file_location(name, os.path.join(ROOT, name + ".py"))
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


def zcsv(path, inner, header, rows, enc="latin-1"):
    buf = io.StringIO()
    buf.write(";".join(header) + "\n")
    for r in rows:
        buf.write(";".join(r) + "\n")
    with zipfile.ZipFile(path, "w") as z:
        z.writestr(inner, buf.getvalue().encode(enc))


def test_disclosures_filtra_por_ticker_janela_e_categoria(tmp_path):
    m = load("fetch_disclosures")
    y = dt.date.today().year
    d = dt.date.today().isoformat()
    old = (dt.date.today() - dt.timedelta(days=200)).isoformat()
    zcsv(tmp_path / f"fca_cia_aberta_{y}.zip", f"fca_cia_aberta_valor_mobiliario_{y}.csv", ["CNPJ_Companhia", "Codigo_Negociacao"],
         [["33.000.167/0001-01", "PETR4"], ["33.000.167/0001-01", "PETR3"], ["11.111.111/0001-11", ""]])
    H = ["CNPJ_Companhia", "Nome_Companhia", "Codigo_CVM", "Data_Referencia", "Categoria", "Tipo", "Especie", "Assunto", "Data_Entrega", "Tipo_Apresentacao", "Protocolo_Entrega", "Versao", "Link_Download"]
    zcsv(tmp_path / f"ipe_cia_aberta_{y}.zip", f"ipe_cia_aberta_{y}.csv", H, [
        ["33.000.167/0001-01", "PETRÓLEO BRASILEIRO S.A.", "9512", d, "Fato Relevante", "", "", "Aprovação de dividendos", d, "AP", "001", "1", "https://www.rad.cvm.gov.br/x?p=1"],
        ["33.000.167/0001-01", "PETRÓLEO BRASILEIRO S.A.", "9512", d, "Fato Relevante", "", "", "Aprovação de dividendos", d, "AP", "001", "1", "https://www.rad.cvm.gov.br/x?p=1"],
        ["33.000.167/0001-01", "PETRÓLEO BRASILEIRO S.A.", "9512", old, "Comunicado ao Mercado", "", "", "Antigo", old, "AP", "002", "1", ""],
        ["11.111.111/0001-11", "SEM TICKER S.A.", "1", d, "Fato Relevante", "", "", "x", d, "AP", "003", "1", ""],
    ])
    out = m.build(60, str(tmp_path))
    assert len(out["items"]) == 1
    it = out["items"][0]
    assert it["tickers"] == ["PETR3", "PETR4"] and it["category"] == "fato_relevante" and it["company"].startswith("PETRÓLEO")
    assert it["protocol"] == "001" and it["url"].startswith("https://") and "CVM" in it["source"]


def test_news_rss_e_atom_somente_titulo_link_e_etiquetas(tmp_path):
    m = load("fetch_news")
    now = dt.datetime.now(dt.timezone.utc)
    rss = f"""<?xml version="1.0"?><rss><channel><item><title>Copom mantém a Selic; PETR4 sobe</title><link>https://ex.gov.br/a</link>
      <description>Texto longo que não deve ser copiado</description><pubDate>{now.strftime('%a, %d %b %Y %H:%M:%S +0000')}</pubDate></item>
      <item><title>Antiga</title><link>https://ex.gov.br/b</link><pubDate>Mon, 01 Jan 2001 10:00:00 +0000</pubDate></item></channel></rss>"""
    atom = f"""<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom"><entry><title>Receita abre consulta ao lote de restituição do IRPF</title>
      <link href="https://ex.gov.br/c"/><updated>{now.isoformat()}</updated></entry></feed>"""
    (tmp_path / "agencia_brasil.xml").write_text(rss)
    (tmp_path / "receita.xml").write_text(atom)
    out = m.build(str(tmp_path))
    assert {i["url"] for i in out["items"]} == {"https://ex.gov.br/a", "https://ex.gov.br/c"}
    a = next(i for i in out["items"] if i["url"].endswith("/a"))
    assert "juros" in a["tags"] and a["tickers"] == ["PETR4"] and "description" not in a and "summary" not in a
    assert "imposto" in next(i for i in out["items"] if i["url"].endswith("/c"))["tags"]
    st = {s["id"]: s["status"] for s in out["sources"]}
    assert st["agencia_brasil"] == "ok" and st["cvm"] == "vazio"
