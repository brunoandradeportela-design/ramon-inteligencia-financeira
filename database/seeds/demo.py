"""Dados de DEMONSTRAÇÃO (fictícios) para o titular demo. Nunca usar em produção.

Login demo (cliente): demo@ramon.app / demo2026ramon
Dono/administrador: definido em services/identity/owner.py (senha só por variável de ambiente).
"""
from __future__ import annotations

import random
from datetime import date
from decimal import Decimal

from services.common.core import new_id, utcnow
from services.consent.service import Connection
from services.billing.plans import PLANS
from services.document_engine.engine import Document
from services.identity.owner import OWNER_NAME

DEMO_EMAIL = "demo@ramon.app"
DEMO_PASSWORD = "demo2026ramon"

# Clientes fictícios para o CRM (nomes inventados; telefones com final 0000–0099 não pertencem a ninguém real)
FIRST = ["Ana", "Carlos", "Juliana", "Marcos", "Patrícia", "Rafael", "Fernanda", "Eduardo", "Camila", "Lucas", "Mariana",
         "Thiago", "Beatriz", "Gustavo", "Larissa", "Rodrigo", "Aline", "Felipe", "Vanessa", "Diego", "Renata", "Paulo"]
LAST = ["Ferreira Lima", "Souza Costa", "Oliveira Prado", "Almeida Rocha", "Ribeiro Nunes", "Carvalho Dias", "Martins Teixeira",
        "Barbosa Moura", "Gomes Pires", "Araújo Freitas", "Mendes Cardoso", "Castro Vieira", "Rezende Lopes", "Monteiro Farias"]
PROFESSIONS = ["Médica", "Dentista", "Advogado", "Engenheiro civil", "Empresária", "Arquiteta", "Fisioterapeuta", "Contador",
               "Servidor público", "Psicóloga", "Produtor rural", "Analista de sistemas", "Veterinária", "Farmacêutico"]
DDDS = ["69", "69", "69", "11", "21", "31", "41", "61", "65", "68", "92", "48"]
ORIGINS = ["site", "site", "instagram", "indicação", "google", "contador parceiro"]

TRADES = [
    # data, ticker, lado, qtd, preço, custos, daytrade, corretora
    ("2025-03-10", "PETR4", "C", 3000, "36.50", "10.40", False, "XP"),
    ("2025-04-15", "VALE3", "C", 1200, "62.00", "8.90", False, "XP"),
    ("2025-05-20", "ITUB4", "C", 2500, "30.20", "9.10", False, "BTG"),
    ("2025-06-10", "WEGE3", "C", 1500, "44.00", "7.60", False, "XP"),
    ("2025-08-05", "BBAS3", "C", 2000, "26.00", "6.20", False, "BTG"),
    ("2025-09-01", "BOVA11", "C", 400, "118.00", "5.40", False, "XP"),
    ("2025-10-10", "HGLG11", "C", 200, "158.00", "4.10", False, "XP"),
    ("2025-10-10", "KNRI11", "C", 150, "150.00", "3.20", False, "XP"),
    ("2026-02-12", "VALE3", "V", 200, "68.40", "4.30", False, "XP"),
    ("2026-03-18", "PETR4", "C", 500, "38.00", "4.90", False, "XP"),
    ("2026-04-22", "ITUB4", "V", 800, "34.10", "6.10", False, "BTG"),
    ("2026-05-14", "TAEE11", "V", 100, "35.00", "2.10", False, "XP"),
    ("2026-06-05", "PETR4", "C", 1000, "37.80", "4.80", True, "XP"),
    ("2026-06-05", "PETR4", "V", 1000, "38.35", "4.80", True, "XP"),
    ("2026-07-15", "WEGE3", "V", 600, "52.30", "6.40", False, "XP"),
    ("2026-07-15", "BBAS3", "V", 1000, "24.10", "5.10", False, "BTG"),
    ("2026-08-20", "BOVA11", "V", 150, "131.50", "4.40", False, "XP"),
    ("2026-08-20", "HGLG11", "V", 80, "164.00", "3.10", False, "XP"),
    ("2026-09-10", "PETR4", "V", 450, "39.90", "4.20", False, "XP"),
]
QUOTES = {"PETR4": "40.12", "VALE3": "66.20", "ITUB4": "35.40", "WEGE3": "51.80", "BBAS3": "24.62",
          "BOVA11": "132.10", "HGLG11": "165.30", "KNRI11": "152.40", "TAEE11": "35.60"}
HOLDINGS = [
    ("CDB-XP-110", "CDB XP 110% CDI", "renda_fixa", "XP", "226400.00", "205000.00", 1),
    ("NTNB-2035", "Tesouro IPCA+ 2035", "tesouro", "Tesouro Direto", "184300.00", "160000.00", 1),
    ("LCI-BTG-2027", "LCI BTG 94% CDI", "renda_fixa", "BTG", "96500.00", "90000.00", 90),
    ("LCA-ITAU-2027", "LCA Itaú 92% CDI", "renda_fixa", "Itaú", "60000.00", "57500.00", 180),
    ("FIM-XP-MACRO", "XP Macro FIM", "fundo", "XP", "108700.00", "100000.00", 30),
    ("FIC-ITAU-CP", "Itaú Crédito Privado FIC", "fundo", "Itaú", "52300.00", "50000.00", 30),
    ("PGBL-ITAU", "Itaú Previdência PGBL", "previdencia", "Itaú", "91200.00", "78000.00", 60),
]


def _tx_rows():
    rnd = random.Random(42)
    rows = []
    for m in range(4, 10):
        def d(day):
            return date(2026, m, min(day, 28 if m == 2 else 30))
        rows += [
            (d(5), "Salário empresa", Decimal("28500.00"), "Itaú Personnalité"),
            (d(12), "Honorários consultoria", Decimal(str(rnd.choice([6200, 7400, 8100, 5900, 9300, 6800]))), "Itaú Personnalité"),
            (d(6), "Aluguel apartamento", Decimal("-4800.00"), "Itaú Personnalité"),
            (d(8), "Condomínio", Decimal("-1150.00"), "Itaú Personnalité"),
            (d(10), "Energia elétrica", Decimal(str(-rnd.randint(380, 470))), "Itaú Personnalité"),
            (d(10), "Internet fibra", Decimal("-149.90"), "Nubank"),
            (d(11), "Plano de saúde Unimed", Decimal("-1380.00"), "Itaú Personnalité"),
            (d(12), "Escola mensalidade", Decimal("-2650.00"), "Itaú Personnalité"),
            (d(15), "Netflix assinatura", Decimal("-55.90"), "Nubank"),
            (d(15), "Spotify assinatura", Decimal("-21.90"), "Nubank"),
            (d(7), "Supermercado Pague Menos", Decimal(str(-rnd.randint(980, 1150))), "Nubank"),
            (d(21), "Supermercado Pague Menos", Decimal(str(-rnd.randint(900, 1100))), "Nubank"),
            (d(18), "Posto combustível", Decimal(str(-rnd.randint(520, 700))), "Nubank"),
            (d(19), "Farmácia Drogasil", Decimal(str(-rnd.randint(150, 320))), "Nubank"),
            (d(23), "Restaurante e delivery", Decimal(str(-(rnd.randint(780, 980) if m < 9 else 1960))), "Nubank"),
            (d(25), "Aplicação CDB", Decimal("-8000.00"), "Itaú Personnalité"),
        ]
    rows.append((date(2026, 7, 9), "Passagem aérea viagem", Decimal("-3180.00"), "Nubank"))
    rows.append((date(2026, 7, 10), "Hotel viagem", Decimal("-2140.00"), "Nubank"))
    rows.append((date(2026, 5, 29), "DARF renda variável", Decimal("-464.60"), "Itaú Personnalité"))
    rows.append((date(2026, 7, 31), "DARF renda variável", Decimal("-102.50"), "Itaú Personnalité"))
    rows.append((date(2026, 8, 31), "DARF renda variável", Decimal("-456.58"), "Itaú Personnalité"))
    return rows


def seed(c) -> None:
    if c.store.gget("users_by_email", DEMO_EMAIL):
        return
    u = c.identity.register(email=DEMO_EMAIL, name="Bruno Almeida", password=DEMO_PASSWORD, accept_terms=True, plan="pro",
                            phone="(69) 99300-0001", profession="Contador", origin="site")
    u.created_at = "2026-07-02T10:15:00+00:00"
    u.profile = {"objetivos": ["entender impostos", "acompanhar investimentos"], "faixa_patrimonio": "1M-2M",
                 "renda_variavel": True, "previdencia": True, "contador": True, "demo": True}
    uid = u.id
    c.hub.add_trades(uid, [{"date": date.fromisoformat(d), "ticker": t, "side": s, "quantity": q, "price": Decimal(p),
                            "fees": Decimal(f), "daytrade": dt, "broker": b} for d, t, s, q, p, f, dt, b in TRADES],
                     source="file:notas_corretagem_demo.csv", raw_id=None)
    for t, p in QUOTES.items():
        c.hub.set_quote(t, p, date(2026, 9, 25), "cotação de fechamento (demo)")
    for aid, name, cls, cust, val, inv, liq in HOLDINGS:
        c.hub.upsert_holding(uid, asset_id=aid, name=name, asset_class=cls, custodian=cust, value=val, invested=inv,
                             as_of=date(2026, 9, 26), liquidity_days=liq, source=f"open_finance:{cust.lower()}" if cust != "Tesouro Direto" else "manual")
    c.hub.ensure_account(uid, "Itaú Personnalité", "Itaú", balance=Decimal("21450.00"), source="open_finance:itau")
    c.hub.ensure_account(uid, "Nubank", "Nubank", balance=Decimal("6870.00"), source="open_finance:nubank")
    c.hub.add_transactions(uid, [{"date": d, "description": desc, "amount": v, "account": acc} for d, desc, v, acc in _tx_rows()
                                 if acc == "Nubank"], source="open_finance:nubank", raw_id=None, institution="Nubank")
    c.hub.add_transactions(uid, [{"date": d, "description": desc, "amount": v, "account": acc} for d, desc, v, acc in _tx_rows()
                                 if acc != "Nubank"], source="open_finance:itau", raw_id=None, institution="Itaú")
    c.store.put("tax_prefs", uid, "prefs", {"prior_losses": {}, "paid_darfs": {"2026-04": "464.60", "2026-06": "102.50", "2026-07": "456.58"}})

    now = utcnow().isoformat()
    docs = [
        ("Informe de rendimentos 2025 — XP", "informe_rendimentos", "validado", "Associado a 8 posições de 2025."),
        ("Nota de corretagem 20/08/2026", "nota_corretagem", "utilizado", "Operações BOVA11 e HGLG11."),
        ("Informe de rendimentos — Itaú previdência", "informe_rendimentos", "pendente", "Esperado para conciliar o PGBL (3 documentos pendentes no total)."),
        ("Nota de corretagem — compra TAEE11", "nota_corretagem", "pendente", "Necessária para o custo de aquisição da venda de 14/05/2026."),
    ]
    for title, kind, status, detail in docs:
        d = Document(id=new_id("doc"), owner_id=uid, filename=title.lower().replace(" ", "_") + ".pdf", mime="application/pdf",
                     size=0 if status == "pendente" else 184_320, checksum="", kind=kind, title=title, status=status,
                     uploaded_at=now, storage_key="", detail=detail)
        c.store.put("documents", uid, d.id, d)

    inst = {i["id"]: i for i in c.institutions()["institutions"]}
    for iid, scope, months in (("xp", ["accounts", "investments"], 12), ("itau", ["accounts", "transactions", "investments"], 12),
                               ("nubank", ["accounts", "transactions"], 12)):
        consent = c.consent.create(owner_id=uid, institution=inst[iid], scope=scope, months=months)
        c.consent.confirm(uid, consent.id)
        if iid == "itau":   # demonstra estado "expirando"
            from datetime import timedelta
            consent.expires_at = (utcnow() + timedelta(days=9)).isoformat()
        conn = Connection(id=new_id("con"), owner_id=uid, institution_id=iid, institution=inst[iid]["name"],
                          institution_type=inst[iid]["type"], consent_id=consent.id, scope=consent.scope, status="ativo",
                          mode="sandbox", last_sync_at=now, created_at=now, updated_at=now, data_quality_score=0.98,
                          sync_runs=[{"id": new_id("sync"), "started_at": now, "result": "ok", "stats": {}}])
        c.store.put("connections", uid, conn.id, conn)
    c.audit.record(owner_id=uid, actor="system", resource="seed", action="demo_data_loaded", reason="ambiente de demonstração")
    c.crm.subscription(u)
    for per, d in (("2026-07", "2026-07-02"), ("2026-08", "2026-08-02"), ("2026-09", "2026-09-02")):
        c.crm.record_payment(u, amount=PLANS["pro"]["price_month"], method="cartao", status="pago", date_=d, period=per, recorded_by="seed")
    u.last_login_at = "2026-09-27T09:40:00+00:00"
    seed_crm(c)


def seed_crm(c) -> None:
    rnd = random.Random(2026)
    from datetime import datetime, timedelta
    ref = date(2026, 9, 27)
    for i in range(24):
        first, last = FIRST[i % len(FIRST)], LAST[(i * 5) % len(LAST)]
        name = f"{first} {last}"
        email = f"{first.lower().replace('í', 'i').replace('á', 'a')}.{last.split()[0].lower().replace('ú', 'u')}{i}@exemplo.com.br"
        plan = rnd.choices(["free", "pro", "premium"], weights=[45, 40, 15])[0]
        u = c.identity.register(email=email, name=name, password="clienteDemo2026", accept_terms=True, plan=plan,
                                phone=f"({DDDS[i % len(DDDS)]}) 9{rnd.randint(8100, 9899)}-00{i:02d}",
                                profession=PROFESSIONS[(i * 3) % len(PROFESSIONS)], origin=rnd.choice(ORIGINS))
        created = datetime(2026, 7, 1, 9) + timedelta(days=int(88 * (i / 24) ** 0.8), hours=rnd.randint(0, 10))
        u.created_at = created.isoformat() + "+00:00"
        if rnd.random() < 0.75:
            u.last_login_at = (created + timedelta(days=rnd.randint(0, max(0, (ref - created.date()).days)))).isoformat() + "+00:00"
        c.crm.subscription(u)["started_at"] = created.date().isoformat()
        c.crm.subscription(u)["next_due"] = None if plan == "free" else created.date().isoformat()
        if plan == "free":
            if rnd.random() < 0.5:   # sinal de ativação: documento enviado
                d = Document(id=new_id("doc"), owner_id=u.id, filename="extrato.csv", mime="text/csv", size=2048, checksum="",
                             kind="extrato", title="Extrato", status="utilizado", uploaded_at=u.created_at, storage_key="")
                c.store.put("documents", u.id, d.id, d)
            continue
        price = PLANS[plan]["price_month"]
        fate = rnd.choices(["em_dia", "atrasado", "aguardando", "cancelado"], weights=[62, 14, 14, 10])[0]
        if fate == "aguardando":
            if (ref - created.date()).days <= 3:
                continue
            fate = "atrasado"
        pay_day = created.date()
        while pay_day <= ref:
            if fate == "atrasado" and pay_day > ref - timedelta(days=30):
                break
            c.crm.record_payment(u, amount=price, method=rnd.choice(["pix", "cartao", "cartao", "boleto"]), status="pago",
                                 date_=pay_day.isoformat(), period=pay_day.strftime("%Y-%m"), recorded_by="seed")
            y, m = (pay_day.year + 1, 1) if pay_day.month == 12 else (pay_day.year, pay_day.month + 1)
            pay_day = date(y, m, min(pay_day.day, 28))
        if fate == "cancelado":
            c.crm.subscription(u)["status"] = "cancelada"
            c.crm.add_note(u, text="Cliente pediu cancelamento: vai reavaliar no próximo ano.", kind="whatsapp", author=OWNER_NAME)
    late = c.identity.register(email="helena.duarte@exemplo.com.br", name="Helena Duarte Siqueira", password="clienteDemo2026",
                               accept_terms=True, plan="pro", phone="(69) 99911-0098", profession="Nutricionista", origin="instagram")
    late.created_at = "2026-09-25T14:20:00+00:00"
    c.crm.subscription(late).update({"started_at": "2026-09-25", "next_due": "2026-09-25"})
    notes = [("Primeiro contato feito; interessado no simulador de PGBL.", "whatsapp"),
             ("Pediu demonstração das conexões Open Finance.", "ligacao"), ("Enviado material sobre o plano Premium.", "email")]
    for u, (t, k) in zip(c.identity.all_customers()[1:4], notes):
        c.crm.add_note(u, text=t, kind=k, author=OWNER_NAME)
        c.crm.update(u, next_action="Retornar contato", next_action_date="2026-09-30", tags=["lead quente"])
