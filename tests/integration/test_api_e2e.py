"""E2E da API: cadastro -> diagnóstico -> simulação -> alerta -> conexão -> revogação -> LGPD."""
import base64
import os

os.environ.setdefault("RAMON_REFERENCE_DATE", "2026-09-27")

from fastapi.testclient import TestClient  # noqa: E402

from apps.api.main import app  # noqa: E402
from services.identity.owner import OWNER_EMAIL, OWNER_NAME  # noqa: E402

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
    r = client.post("/v1/auth/register", json={"name": "Ana Paula Souza", "email": "ana@exemplo.com", "password": "senhaForte123",
                                               "accept_terms": True, "phone": "(69) 99300-1234", "profession": "Médica", "plan": "free"})
    assert r.status_code == 201
    h = {"Authorization": f"Bearer {r.json()['token']}"}
    assert client.get("/v1/dashboard", headers=h).status_code == 200
    r = client.post("/v1/simulations", headers=h, json={"kind": "pgbl", "taxable_income": 100000})
    assert r.status_code == 402 and r.json()["required_plan"] == "Pro"
    assert client.post("/v1/assistant/query", headers=h, json={"question": "oi"}).status_code == 402


def test_isolamento_entre_titulares():
    r = client.post("/v1/auth/register", json={"name": "Caio Mendes Rocha", "email": "caio@exemplo.com", "password": "senhaForte123",
                                               "accept_terms": True, "phone": "(69) 99300-1234", "profession": "Médica", "plan": "pro"})
    h = {"Authorization": f"Bearer {r.json()['token']}"}
    assert client.get("/v1/portfolio/consolidated", headers=h).json()["total"] == "0.00"
    demo_conns = client.get("/v1/connections", headers=login_demo()).json()["items"]
    r = client.post(f"/v1/connections/{demo_conns[0]['id']}/revoke", headers=h)
    assert r.status_code == 404


def test_fluxo_conexao_open_finance_sandbox_e_revogacao():
    r = client.post("/v1/auth/register", json={"name": "Eduarda Lima Castro", "email": "duda@exemplo.com", "password": "senhaForte123",
                                               "accept_terms": True, "phone": "(69) 99300-1234", "profession": "Médica", "plan": "pro"})
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
    r = client.post("/v1/auth/register", json={"name": "Eva Martins Nunes", "email": "eva@exemplo.com", "password": "senhaForte123",
                                               "accept_terms": True, "phone": "(69) 99300-1234", "profession": "Médica", "plan": "pro"})
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
    r = client.post("/v1/auth/register", json={"name": "Fernanda Alves Pinto", "email": "fe@exemplo.com", "password": "senhaForte123",
                                               "accept_terms": True, "phone": "(69) 99300-1234", "profession": "Médica"})
    h = {"Authorization": f"Bearer {r.json()['token']}"}
    assert "user" in client.get("/v1/privacy/export", headers=h).json()
    assert client.delete("/v1/privacy/account", headers=h).status_code == 202
    assert client.get("/v1/me", headers=h).status_code == 401


# ---------------------------------------------------------------- cadastro obrigatório + CRM
BASE = {"name": "Gabriel Souza Lima", "email": "gabriel@exemplo.com", "password": "senhaForte123", "accept_terms": True,
        "phone": "(69) 99300-5555", "profession": "Engenheiro"}


def test_cadastro_exige_campos_obrigatorios():
    for field, value in (("name", "Gabriel"), ("phone", "99999"), ("phone", "(00) 99999-9999"), ("profession", ""), ("email", "x@")):
        r = client.post("/v1/auth/register", json={**BASE, field: value})
        assert r.status_code == 422, (field, value)
        assert any(e["field"] == field for e in r.json()["errors"])
    for field in ("phone", "profession"):
        body = {k: v for k, v in BASE.items() if k != field}
        assert client.post("/v1/auth/register", json=body).status_code == 422


def login_admin():
    r = client.post("/v1/auth/login", json={"email": OWNER_EMAIL, "password": os.environ["RAMON_OWNER_PASSWORD"]})
    return {"Authorization": f"Bearer {r.json()['token']}"}


def test_crm_acompanha_novo_cadastro_e_pagamento():
    r = client.post("/v1/auth/register", json={**BASE, "email": "novo.cliente@exemplo.com", "plan": "pro"})
    assert r.status_code == 201
    uid = r.json()["user"]["id"]
    h = login_admin()
    lst = client.get("/v1/admin/crm/customers?q=novo.cliente", headers=h).json()["items"]
    assert len(lst) == 1 and lst[0]["phone"] == "+5569993005555" and lst[0]["phone_display"] == "(69) 99300-5555"
    assert lst[0]["profession"] == "Engenheiro" and lst[0]["stage"] == "aguardando_pagamento"
    assert lst[0]["whatsapp_url"] == "https://wa.me/5569993005555"
    p = client.post(f"/v1/admin/crm/customers/{uid}/payments", headers=h,
                    json={"amount": "24.90", "method": "pix", "status": "pago", "date": "2026-09-27", "period": "2026-09"})
    assert p.status_code == 201
    d = client.get(f"/v1/admin/crm/customers/{uid}", headers=h).json()
    assert d["stage"] == "pagante" and d["total_paid"] == "24.90" and d["subscription"]["next_due"].startswith("2026-10")
    n = client.post(f"/v1/admin/crm/customers/{uid}/notes", headers=h, json={"text": "Boas-vindas enviadas", "kind": "whatsapp"})
    assert n.status_code == 201
    assert client.patch(f"/v1/admin/crm/customers/{uid}", headers=h, json={"stage": "cancelado"}).json()["stage"] == "cancelado"
    m = client.get("/v1/admin/crm/metrics", headers=h).json()
    assert m["total"] >= 25 and sum(s["count"] for s in m["stages"]) == m["total"]
    csv = client.get("/v1/admin/crm/export.csv", headers=h)
    assert csv.status_code == 200 and "novo.cliente@exemplo.com" in csv.text
    # acesso do administrador fica na trilha do titular (LGPD)
    tok = client.post("/v1/auth/login", json={"email": "novo.cliente@exemplo.com", "password": "senhaForte123"}).json()["token"]
    aud = client.get("/v1/audit", headers={"Authorization": f"Bearer {tok}"}).json()
    assert any(e["action"] == "acesso_administrador" for e in aud["items"]) and aud["chain_valid"]


def test_crm_restrito_ao_administrador():
    assert client.get("/v1/admin/crm/customers", headers=login_demo()).status_code == 403
    assert client.get("/v1/admin/crm/metrics").status_code == 401


def test_crm_nao_expoe_dados_financeiros_do_cliente():
    h = login_admin()
    demo = client.get("/v1/admin/crm/customers?q=demo@ramon.app", headers=h).json()["items"][0]
    d = client.get(f"/v1/admin/crm/customers/{demo['id']}", headers=h).json()
    txt = str(d)
    assert "positions" not in txt and "PETR4" not in txt and "tax_due" not in txt


# ---------------------------------------------------------------- dono da plataforma e preços
def test_dono_e_administrador():
    h = login_admin()
    me = client.get("/v1/me", headers=h).json()
    assert me["email"] == "ramonjunio07@gmail.com" and me["name"] == OWNER_NAME == "Ramon Junio Araujo Pereira"
    assert "owner" in me["roles"] and "admin" in me["roles"]
    assert me["profile"]["cpf_configured"] is True and me["profile"]["cpf_masked"] == "***.982.247-**"
    assert "52998224725" not in str(me) and "529.982.247-25" not in str(me)
    assert client.get("/v1/admin/crm/metrics", headers=h).status_code == 200
    assert client.get("/v1/dashboard", headers=h).status_code == 200      # também acessa a plataforma
    team = client.get("/v1/admin/team", headers=h).json()["items"]
    assert any(t["email"] == OWNER_EMAIL for t in team)
    # dono não aparece como cliente no CRM
    assert not client.get(f"/v1/admin/crm/customers?q={OWNER_EMAIL}", headers=h).json()["items"]


def test_somente_dono_gerencia_equipe_e_nao_se_remove():
    h = login_admin()
    me = client.get("/v1/me", headers=h).json()
    assert client.patch(f"/v1/admin/team/{me['id']}", headers=h, json={"admin": False}).status_code == 409
    cli = client.get("/v1/admin/crm/customers?q=demo@ramon.app", headers=h).json()["items"][0]
    assert client.patch(f"/v1/admin/team/{cli['id']}", headers=login_demo(), json={"admin": True}).status_code == 403


def test_ticket_medio_acima_de_80():
    planos = {p["code"]: float(p["price_month"]) for p in client.get("/v1/plans").json()["items"]}
    pagos = [v for k, v in planos.items() if k != "free"]
    assert min(pagos) > 80                   # qualquer mix de pagantes mantém o ticket médio > R$ 80
    m = client.get("/v1/admin/crm/metrics", headers=login_admin()).json()
    assert float(m["ticket_medio"]) > 80 and m["ticket_ok"] is True


def test_cpf_do_dono_nao_esta_no_repositorio():
    import pathlib
    root = pathlib.Path(__file__).resolve().parents[2]
    alvo = "012" + "511" + "452"             # montado em partes para não aparecer literal neste arquivo
    for f in root.rglob("*"):
        if f.is_file() and f.suffix in {".py", ".js", ".html", ".json", ".md", ".css", ".yml", ".sql", ".txt"} and ".git" not in f.parts:
            txt = f.read_text(encoding="utf-8", errors="ignore")
            assert alvo not in txt.replace(".", "").replace("-", ""), f
