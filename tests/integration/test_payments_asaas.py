"""Conector Asaas: checkout, webhook, sincronização, visão geral de pagamentos no CRM e segurança da chave."""
import os
import pathlib
import re
from datetime import date

import pytest
from fastapi.testclient import TestClient

from apps.api import main
from services.billing.asaas import AsaasClient, AsaasConfig
from services.billing.gateway import BillingService, cnpj_is_valid
from tests.fake_asaas import TEST_KEY, FakeAsaas

WEBHOOK_TOKEN = "whk_teste_ficticio_123456"
client = TestClient(main.app)
ROOT = pathlib.Path(__file__).resolve().parents[2]


@pytest.fixture()
def fake():
    fa = FakeAsaas()
    cfg = AsaasConfig(api_key=TEST_KEY, env="sandbox", webhook_token=WEBHOOK_TOKEN)
    old = main.C.billing
    main.C.billing = BillingService(main.C.store, main.C.crm, main.C.identity, cfg, transport=fa.transport())
    yield fa
    main.C.billing = old


def owner_h():
    from services.identity.owner import OWNER_EMAIL
    r = client.post("/v1/auth/login", json={"email": OWNER_EMAIL, "password": os.environ["RAMON_OWNER_PASSWORD"]})
    return {"Authorization": f"Bearer {r.json()['token']}"}


def new_customer(email):
    r = client.post("/v1/auth/register", json={"name": "Marina Costa Lima", "email": email, "profession": "Engenheira",
                                                "phone": "(69) 99876-5432", "password": "senhaSegura123", "accept_terms": True})
    assert r.status_code == 201, r.text
    return {"Authorization": f"Bearer {r.json()['token']}"}, r.json()["user"]["id"]


# ------------------------------------------------------------------ cliente HTTP
def test_config_infere_ambiente_pela_chave(monkeypatch):
    monkeypatch.setenv("RAMON_ASAAS_API_KEY", "$aact_prod_xyz")
    monkeypatch.delenv("RAMON_ASAAS_ENV", raising=False)
    assert AsaasConfig.from_env().env == "production"
    assert AsaasConfig.from_env().base_url == "https://api.asaas.com/v3"
    monkeypatch.setenv("RAMON_ASAAS_API_KEY", "$aact_hmlg_xyz")
    assert AsaasConfig.from_env().env == "sandbox"
    monkeypatch.delenv("RAMON_ASAAS_API_KEY")
    assert AsaasConfig.from_env() is None


def test_cliente_envia_headers_e_pagina(fake):
    for i in range(230):
        fake.add_payment(customer="cus_x", value=10.0 + i)
    c = AsaasClient(AsaasConfig(TEST_KEY, "sandbox", ""), transport=fake.transport())
    assert len(c.list_payments()) == 230
    req = fake.requests[-1]
    assert req.headers["access_token"] == TEST_KEY and req.headers["user-agent"].startswith("ramon")
    assert req.url.host == "api-sandbox.asaas.com"


def test_chave_invalida_vira_erro_claro():
    fa = FakeAsaas(key="outra")
    c = AsaasClient(AsaasConfig(TEST_KEY, "sandbox", ""), transport=fa.transport())
    with pytest.raises(Exception) as e:
        c.balance()
    assert e.value.status == 401 and "inválida" in e.value.detail


def test_status_ao_vivo_mostra_saldo_sem_expor_chave(fake):
    r = client.get("/v1/admin/payments/gateway?live=true", headers=owner_h()).json()
    assert r["configured"] and r["connection"] == "ok" and r["balance"] == "1234.56"
    assert TEST_KEY not in str(r) and r["key_fingerprint"].startswith(TEST_KEY[:10])


def test_gateway_fora_do_ar(fake):
    fake.down = True
    r = client.get("/v1/admin/payments/gateway?live=true", headers=owner_h()).json()
    assert r["connection"] == "erro" and "Sem comunicação" in r["connection_error"]


# ------------------------------------------------------------------ checkout → webhook → CRM
def test_fluxo_completo_checkout_webhook_crm(fake):
    h, uid = new_customer("marina.asaas@exemplo.com")
    bad = client.post("/v1/billing/checkout", json={"plan": "pro", "cpf_cnpj": "111.111.111-11"}, headers=h)
    assert bad.status_code == 422
    r = client.post("/v1/billing/checkout", json={"plan": "pro", "cpf_cnpj": "529.982.247-25"}, headers=h)
    assert r.status_code == 200, r.text
    assert r.json()["invoice_url"].startswith("https://www.asaas.com/i/")
    cust = next(iter(fake.customers.values()))
    assert cust["externalReference"] == uid and cust["cpfCnpj"] == "52998224725" and cust["mobilePhone"] == "69998765432"
    sub = next(iter(fake.subscriptions.values()))
    assert sub["value"] == 89.9 and sub["cycle"] == "MONTHLY" and sub["billingType"] == "UNDEFINED"

    oh = owner_h()
    det = client.get(f"/v1/admin/crm/customers/{uid}", headers=oh).json()
    assert det["stage"] == "aguardando_pagamento" and det["payments"][0]["status"] == "pendente"
    assert client.get("/v1/billing/subscription", headers=h).json()["payer_doc"] == "***.982.247-**"

    pay = fake.confirm(next(iter(fake.payments)))
    evt = {"id": "evt_0001", "event": "PAYMENT_RECEIVED", "payment": pay}
    assert client.post("/v1/webhooks/asaas", json=evt).status_code == 401
    assert client.post("/v1/webhooks/asaas", json=evt, headers={"asaas-access-token": "errado"}).status_code == 401
    ok = client.post("/v1/webhooks/asaas", json=evt, headers={"asaas-access-token": WEBHOOK_TOKEN}).json()
    assert ok["status"] == "pago" and ok["matched"] is True
    dup = client.post("/v1/webhooks/asaas", json=evt, headers={"asaas-access-token": WEBHOOK_TOKEN}).json()
    assert dup["duplicate"] is True

    det = client.get(f"/v1/admin/crm/customers/{uid}", headers=oh).json()
    assert det["stage"] == "pagante" and det["total_paid"] == "89.90"
    assert det["subscription"]["next_due"] == "2026-10-27" and det["payments"][0]["method"] == "pix"
    assert len(det["payments"]) == 1   # sem duplicar

    allp = client.get("/v1/admin/payments?q=marina.asaas", headers=oh).json()
    assert allp["total"] == 1 and allp["items"][0]["origin"] == "asaas" and allp["items"][0]["net_value"] == "87.20"

    overdue = {**pay, "id": fake.add_payment(customer=pay["customer"], value=89.9, status="OVERDUE", due="2026-08-01",
                                            ext=uid)["id"], "status": "OVERDUE", "dueDate": "2026-08-01"}
    client.post("/v1/webhooks/asaas", json={"id": "evt_0002", "event": "PAYMENT_OVERDUE", "payment": overdue},
                headers={"asaas-access-token": WEBHOOK_TOKEN})
    assert client.get(f"/v1/admin/crm/customers/{uid}", headers=oh).json()["stage"] == "inadimplente"

    client.post("/v1/webhooks/asaas", json={"id": "evt_0003", "event": "PAYMENT_DELETED", "payment": overdue},
                headers={"asaas-access-token": WEBHOOK_TOKEN})
    assert len(client.get(f"/v1/admin/crm/customers/{uid}", headers=oh).json()["payments"]) == 1


def test_sincronizacao_traz_todas_as_cobrancas_inclusive_sem_vinculo(fake):
    h, uid = new_customer("paulo.sync@exemplo.com")
    fake.customers["cus_ext"] = {"id": "cus_ext", "name": "Cliente Direto Asaas", "email": "direto@exemplo.com"}
    fake.add_payment(customer="cus_ext", value=149.9, status="CONFIRMED", billing="CREDIT_CARD", paid="2026-09-20")
    fake.customers["cus_pl"] = {"id": "cus_pl", "name": "Paulo", "email": "paulo.sync@exemplo.com"}
    fake.add_payment(customer="cus_pl", value=89.9, status="RECEIVED", billing="BOLETO", paid="2026-09-21")
    oh = owner_h()
    r = client.post("/v1/admin/payments/sync", headers=oh).json()
    assert r["ok"] and r["fetched"] >= 2 and r["unmatched"] >= 1
    rows = client.get("/v1/admin/payments?origin=sem_vinculo", headers=oh).json()["items"]
    assert any(x["customer_name"] == "Cliente Direto Asaas" and x["method"] == "cartao" for x in rows)
    det = client.get(f"/v1/admin/crm/customers/{uid}", headers=oh).json()
    assert det["stage"] == "pagante" and det["payments"][0]["method"] == "boleto"   # vinculado pelo e-mail
    csv = client.get("/v1/admin/payments/export.csv", headers=oh)
    assert csv.status_code == 200 and "Cliente Direto Asaas" in csv.text


def test_pagamentos_e_webhook_restritos(fake):
    h, _ = new_customer("curioso.pay@exemplo.com")
    assert client.get("/v1/admin/payments", headers=h).status_code == 403
    assert client.post("/v1/admin/payments/sync", headers=h).status_code == 403


def test_sem_chave_checkout_indisponivel():
    old = main.C.billing
    main.C.billing = BillingService(main.C.store, main.C.crm, main.C.identity, None)
    try:
        h, _ = new_customer("semchave@exemplo.com")
        r = client.post("/v1/billing/checkout", json={"plan": "pro", "cpf_cnpj": "529.982.247-25"}, headers=h)
        assert r.status_code == 503 and r.json()["code"] == "gateway_off"
        assert client.get("/v1/admin/payments", headers=owner_h()).status_code == 200   # manuais continuam visíveis
    finally:
        main.C.billing = old


def test_cnpj():
    assert cnpj_is_valid("11.222.333/0001-81") and not cnpj_is_valid("11.222.333/0001-80")


def test_chave_de_producao_nunca_no_repositorio():
    pat = re.compile(r"\$aact_prod_[A-Za-z0-9]{20,}")
    for p in ROOT.rglob("*"):
        if p.is_file() and ".git" not in p.parts and p.suffix not in (".png", ".jpg", ".webp", ".woff2", ".pyc", ".zip"):
            assert not pat.search(p.read_text(errors="ignore")), f"chave Asaas encontrada em {p}"


def test_data_ref():
    assert date.fromisoformat(os.environ["RAMON_REFERENCE_DATE"]) == date(2026, 9, 27)
