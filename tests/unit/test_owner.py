import pytest

from services.common.core import DomainError, sha256
from services.common.store import Store
from services.identity import owner
from services.identity.service import IdentityService


def test_cpf_validacao_e_mascara():
    assert owner.cpf_is_valid("529.982.247-25")
    assert not owner.cpf_is_valid("111.111.111-11") and not owner.cpf_is_valid("529.982.247-26")
    assert owner.cpf_masked("52998224725") == "***.982.247-**"


def test_bootstrap_sem_senha_gera_token_de_uso_unico(monkeypatch, caplog):
    monkeypatch.delenv("RAMON_OWNER_PASSWORD", raising=False)
    ident = IdentityService(Store())
    u = owner.ensure_owner(ident)
    assert u.password_hash == "!" and {"owner", "admin"} <= set(u.roles)
    token = next(r.getMessage().split(": ")[-1] for r in caplog.records if "Token de configuração" in r.getMessage())
    with pytest.raises(DomainError):
        owner.complete_setup(ident, "errado", "senhaNova2026x")
    owner.complete_setup(ident, token, "senhaNova2026x")
    tok, user = ident.login(email=owner.OWNER_EMAIL, password="senhaNova2026x")
    assert user.id == u.id
    with pytest.raises(DomainError):                     # token não pode ser reutilizado
        owner.complete_setup(ident, token, "outraSenha2026x")
    assert ident.store.gget("owner_setup", "token") is None and sha256(token)
