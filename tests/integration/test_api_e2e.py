"""E2E da API: cadastro -> diagnóstico -> simulação -> alerta -> conexão -> revogação -> LGPD."""
import base64
import os

os.environ.setdefault("RAMON_REFERENCE_DATE", "2026-09-27")

from fastapi.testclient import TestClient  # noqa: E402

from apps.api.main import app  # noqa: E402

client = TestClient(app)


def login_demo():
    r = client.post("/v1/auth/login", json={"email": "demo@ramon.app", "password": "demo2026ramon"})
    assert r.status_code == 200
    return {"Authorization": f"Bearer {r.json()['token']}"}


def test_health_e_correlation_id():
    r = client.get("/health", headers={"X-Correlation-ID": "abc123"})
    assert r.status_code == 200 and r.headers["X-Correlation-ID"] == "abc123"


def test_sem_token_retorna_problem_details():
    r = client.get("/v1/dashboard")
    assert r.status_code == 401
    assert r.headers["content-type"].startswith("application/problem+json")
    assert r.json()["correlation_id"]


def test_jornada_demo_completa():
    h = login_demo()
    d = client.get("/v1/dashboard", headers=h).json()
    assert d["greeting"] == "Bruno" and d["alerts"]["open"] >= 3
    assert d["tax"]["kind"] == "estimativa"
    alerts = client.get("/v1/alerts", headers=h).json()["items"]
    darf = next(a for a in alerts if a["code"] == "DARF_VENCIMENTO")
    assert darf["severity"] == "critico" and darf["rule"]["code"] == "BR-IRPF-RV-COMUM"
    assert client.patch(f"/v1/alerts/{darf['id']}", headers=h, json={"status": "visto"}).json()["status"] == "visto"

    sim = client.post("/v1/simulations", headers={**h, "Idempotency-Key": "k1"}, json={
        "kind": "venda_ativos", "scenarios": [{"name": "Vender 100 VALE3", "operations": [{"ticker": "VALE3", "quantity": 100}]}]})
    assert sim.status_code == 201, sim.text
    again = client.post("/v1/simulations", headers={**h, "Idempotency-Key": "k1"}, json={"kind": "venda_ativos", "scenarios": []})
    assert again.json()["id"] == sim.json()["id"]          # idempotência

    ans = client.post("/v1/assistant/query", headers=h, json={"question": "Por que meu imposto aumentou?"}).json()
    assert ans["intent"] == "tributaria" and ans["consistency_ok"] and ans["evidence"]
    blocked = client.post("/v1/assistant/query", headers=h, json={"question": "Devo vender PETR4?"}).json()
    assert blocked["guardrail"] == "recomendacao_individual"

    audit = client.get("/v1/audit", headers=h).json()
    assert audit["chain_valid"] is True


def test_cadastro_free_e_entitlements():
    r = client.post("/v1/auth/register", json={"name": "Ana", "email": "ana@exemplo.com", "password": "senhaForte123",
                                               "accept_terms": True, "plan": "free"})
    assert r.status_code == 201
    h = {"Authorization": f"Bearer {r.json()['token']}"}
    assert client.get("/v1/dashboard", headers=h).status_code == 200
    r = client.post("/v1/simulations", headers=h, json={"kind": "pgbl", "taxable_income": 100000})
    assert r.status_code == 402 and r.json()["required_plan"] == "Pro"
    assert client.post("/v1/assistant/query", headers=h, json={"question": "oi"}).status_code == 402


def test_isolamento_entre_titulares():
    r = client.post("/v1/auth/register", json={"name": "Caio", "email": "caio@exemplo.com", "password": "senhaForte123",
                                               "accept_terms": True, "plan": "pro"})
    h = {"Authorization": f"Bearer {r.json()['token']}"}
    assert client.get("/v1/portfolio/consolidated", headers=h).json()["total"] == "0.00"
    demo_conns = client.get("/v1/connections", headers=login_demo()).json()["items"]
    r = client.post(f"/v1/connections/{demo_conns[0]['id']}/revoke", headers=h)
    assert r.status_code == 404


def test_fluxo_conexao_open_finance_sandbox_e_revogacao():
    r = client.post("/v1/auth/register", json={"name": "Duda", "email": "duda@exemplo.com", "password": "senhaForte123",
                                               "accept_terms": True, "plan": "pro"})
    h = {"Authorization": f"Bearer {r.json()['token']}"}
    start = client.post("/v1/connections/consents", headers=h, json={"institution_id": "nubank", "scope": ["accounts", "transactions", "investments"]}).json()
    assert "sandbox" in start["redirect_url"] and "senha" not in start["redirect_url"]
    conf = client.post("/v1/connections/consents/confirm", headers=h, json={"consent_id": start["consent_id"]}).json()
    assert conf["connection"]["status"] == "ativo" and conf["stats"]["transactions"] == 3
    again = client.post(f"/v1/connections/{start['connection_id']}/refresh", headers=h).json()
    assert again["stats"]["replayed"] >= 1 and again["stats"]["transactions"] == 0      # idempotente
    pf = client.get("/v1/portfolio/consolidated", headers=h).json()
    assert pf["total"] != "0.00"
    rv = client.post(f"/v1/connections/{start['connection_id']}/revoke", headers=h).json()
    assert rv["status"] == "revogado"
    assert client.post(f"/v1/connections/{start['connection_id']}/refresh", headers=h).status_code == 409


def test_upload_csv_importa_operacoes():
    r = client.post("/v1/auth/register", json={"name": "Eva", "email": "eva@exemplo.com", "password": "senhaForte123",
                                               "accept_terms": True, "plan": "pro"})
    h = {"Authorization": f"Bearer {r.json()['token']}"}
    csv = "data;ticker;tipo;quantidade;preco;custos\n05/01/2026;VALE3;C;1000;10,00;0\n05/03/2026;VALE3;V;1000;25,00;0\n"
    doc = client.post("/v1/documents", headers=h, json={"filename": "nota_corretagem.csv", "mime": "text/csv",
                                                          "content_base64": base64.b64encode(csv.encode()).decode()}).json()
    assert doc["kind"] == "nota_corretagem" and doc["extraction"]["accepted"] == 2
    tax = client.get("/v1/tax/summary?year=2026", headers=h).json()
    assert tax["total_tax_due"] == "2248.75"


def test_brute_force_bloqueia():
    for _ in range(5):
        client.post("/v1/auth/login", json={"email": "ninguem@exemplo.com", "password": "x"})
    assert client.post("/v1/auth/login", json={"email": "ninguem@exemplo.com", "password": "x"}).status_code == 429


def test_tema_nao_altera_calculo():
    h = login_demo()
    before = client.get("/v1/tax/summary", headers=h).json()["snapshot_hash"]
    client.put("/v1/theme-preference", headers=h, json={"theme": "light"})
    assert client.get("/v1/theme-preference", headers=h).json()["theme"] == "light"
    assert client.get("/v1/tax/summary", headers=h).json()["snapshot_hash"] == before


def test_lgpd_exportacao_e_eliminacao():
    r = client.post("/v1/auth/register", json={"name": "Fê", "email": "fe@exemplo.com", "password": "senhaForte123",
                                               "accept_terms": True})
    h = {"Authorization": f"Bearer {r.json()['token']}"}
    assert "user" in client.get("/v1/privacy/export", headers=h).json()
    assert client.delete("/v1/privacy/account", headers=h).status_code == 202
    assert client.get("/v1/me", headers=h).status_code == 401
