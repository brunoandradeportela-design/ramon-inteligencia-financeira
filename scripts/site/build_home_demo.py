"""Gera apps/web/assets/data/home-demo.json: recorte pequeno do snapshot de demonstração (dados fictícios)
para o notebook e os hologramas da página inicial. Nada de dados reais de clientes.

Uso: python scripts/site/build_home_demo.py  (rodar sempre que app/data/demo.json mudar)
"""
import json
import os

ROOT = os.path.join(os.path.dirname(__file__), "..", "..", "apps", "web")
SRC = os.path.join(ROOT, "app", "data", "demo.json")
OUT = os.path.join(ROOT, "assets", "data", "home-demo.json")


def build(d):
    db, port = d["dashboard"], d["portfolio"]
    feats = {p["code"]: p["features"] for p in d["plans"]["items"]}
    return {
        "aviso": "DEMONSTRAÇÃO — dados fictícios calculados pelos motores da AURION. Nenhum dado real de cliente.",
        "nome": d["me"]["name"].split()[0],
        "referencia": db["reference_date"],
        "patrimonio": db["net_worth"],
        "impostos": {k: db["tax"][k] for k in ("year", "estimated", "exempt", "monthly", "confidence", "scope")},
        "alertas": {**db["alerts"], "itens": [{"titulo": a["title"], "detalhe": a["detail"], "severidade": a["severity"], "rota": a.get("action", {}).get("route"),
                                             "prazo": a.get("due_date")} for a in d["alerts"]["items"][:6]]},
        "alocacao": db["allocation"],
        "custodia": port["by_custodian"],
        "posicoes": [{"nome": p["name"], "classe": p["group"], "valor": p["value"], "mercado": "Brasil"} for p in port["positions"]],
        "proximas_acoes": db["next_actions"],
        "financas": {"periodo": d["finance"]["period"], "totais": d["finance"]["totals"]},
        "liquidez": db["liquidity"],
        "documentos": [{"titulo": x["title"], "status": x["status"]} for x in d["documents"]["items"][:6]],
        "planos": [{"codigo": p["code"], "nome": p["name"], "preco": p["price_month"], "recursos": feats[p["code"]]} for p in d["plans"]["items"]],
    }


if __name__ == "__main__":
    with open(SRC, encoding="utf-8") as f:
        data = build(json.load(f))
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, separators=(",", ":"))
    print(OUT, os.path.getsize(OUT), "bytes")
