"""Persistência PostgreSQL: dados sobrevivem a reinício, incluindo alterações feitas "no lugar".

Roda apenas quando RAMON_TEST_DATABASE_URL aponta para um banco de teste descartável.
"""
import os
from decimal import Decimal

import pytest

DSN = os.environ.get("RAMON_TEST_DATABASE_URL")
pytestmark = pytest.mark.skipif(not DSN, reason="RAMON_TEST_DATABASE_URL não definido")


@pytest.fixture()
def fresh_db():
    import psycopg
    with psycopg.connect(DSN, autocommit=True) as c:
        c.execute("DROP TABLE IF EXISTS app_store")
    yield DSN


def test_reinicio_preserva_dados_e_mutacoes(fresh_db):
    from services.common.pg_store import PostgresStore
    from services.identity.owner import OWNER_EMAIL, ensure_owner
    from services.identity.service import IdentityService

    s1 = PostgresStore(fresh_db, autoflush_seconds=0)
    owner = ensure_owner(IdentityService(s1))
    s1.put("payments", owner.id, "p1", {"id": "p1", "value": Decimal("89.90"), "status": "pago"})
    s1.gput("asaas_events", "evt_1", "2026-09-28")
    assert s1.flush() >= 4
    assert s1.flush() == 0                      # nada mudou → nenhuma escrita

    owner.plan = "pro"                           # alteração "no lugar", sem novo gput
    s1.get("payments", owner.id, "p1")["status"] = "estornado"
    s1.gdelete("asaas_events", "evt_1")
    assert s1.flush() == 3

    s2 = PostgresStore(fresh_db, autoflush_seconds=0)   # "reinício do servidor"
    u = s2.gget("users", s2.gget("users_by_email", OWNER_EMAIL))
    assert u.plan == "pro" and "admin" in u.roles and "owner" in u.roles
    p = s2.get("payments", owner.id, "p1")
    assert p["status"] == "estornado" and p["value"] == Decimal("89.90")
    assert s2.gget("asaas_events", "evt_1") is None


def test_isolamento_por_titular_mantido(fresh_db):
    from services.common.pg_store import PostgresStore
    s = PostgresStore(fresh_db, autoflush_seconds=0)
    s.put("documents", "usr_a", "d1", {"x": 1})
    s.flush()
    s2 = PostgresStore(fresh_db, autoflush_seconds=0)
    assert s2.list("documents", "usr_b") == [] and len(s2.list("documents", "usr_a")) == 1


def test_dsn_do_render_normalizado():
    from services.common.pg_store import normalize_dsn
    assert normalize_dsn("postgres://u:p@h/db") == "postgresql://u:p@h/db"
