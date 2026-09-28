"""Dono e administrador da plataforma.

Nome e e-mail do dono ficam no código (podem ser sobrescritos por variáveis de ambiente).
O CPF é dado pessoal sensível de identificação: NUNCA fica no repositório nem no front-end.
Ele é lido somente da variável de ambiente RAMON_OWNER_CPF (secret do servidor), validado e
exposto apenas mascarado — e apenas para o próprio dono.

Senha: definida por RAMON_OWNER_PASSWORD (secret) ou, na ausência dela, por um token de
configuração de uso único exibido no log do servidor na primeira inicialização
(POST /v1/auth/owner/setup). Nenhuma senha do dono é gravada no código.
"""
from __future__ import annotations

import logging
import os
import re

from services.common.core import DomainError, new_token, sha256, utcnow
from services.identity.service import IdentityService, User, hash_password

log = logging.getLogger("ramon.owner")

OWNER_NAME = os.environ.get("RAMON_OWNER_NAME", "Ramon Junio Araujo Pereira")
OWNER_EMAIL = os.environ.get("RAMON_OWNER_EMAIL", "ramonjunio07@gmail.com").strip().lower()
OWNER_ROLES = ["owner", "admin"]


def cpf_is_valid(cpf: str) -> bool:
    d = re.sub(r"\D", "", cpf or "")
    if len(d) != 11 or len(set(d)) == 1:
        return False
    nums = [int(x) for x in d]
    for n in (9, 10):
        s = sum(nums[i] * (n + 1 - i) for i in range(n))
        if (s * 10) % 11 % 10 != nums[n]:
            return False
    return True


def cpf_masked(cpf: str) -> str:
    d = re.sub(r"\D", "", cpf or "")
    return f"***.{d[3:6]}.{d[6:9]}-**" if len(d) == 11 else ""


def owner_cpf() -> str | None:
    raw = os.environ.get("RAMON_OWNER_CPF", "")
    if not raw:
        return None
    if not cpf_is_valid(raw):
        log.error("RAMON_OWNER_CPF inválido — ignorado")
        return None
    return re.sub(r"\D", "", raw)


def ensure_owner(identity: IdentityService) -> User:
    """Garante a conta do dono com papéis owner+admin. Idempotente."""
    store = identity.store
    uid = store.gget("users_by_email", OWNER_EMAIL)
    user = store.gget("users", uid) if uid else None
    if user is None:
        user = User(id="usr_owner", email=OWNER_EMAIL, name=OWNER_NAME, password_hash="!", roles=list(OWNER_ROLES),
                    plan="premium", created_at=utcnow().isoformat(), accepted_terms_version="2026-09",
                    phone="", profession="Proprietário da plataforma", origin="interno")
        store.gput("users_by_email", OWNER_EMAIL, user.id)
        store.gput("users", user.id, user)
    user.roles = sorted(set(user.roles) | set(OWNER_ROLES))
    user.name = OWNER_NAME
    cpf = owner_cpf()
    user.profile = {**user.profile, "cpf_masked": cpf_masked(cpf) if cpf else None, "cpf_configured": bool(cpf)}
    pw = os.environ.get("RAMON_OWNER_PASSWORD")
    if pw:
        if len(pw) < 10:
            raise RuntimeError("RAMON_OWNER_PASSWORD precisa de 10+ caracteres")
        user.password_hash = hash_password(pw)
    elif user.password_hash == "!" and not store.gget("owner_setup", "token"):
        token = new_token()
        store.gput("owner_setup", "token", {"hash": sha256(token), "created_at": utcnow().isoformat()})
        log.warning("Conta do dono criada sem senha. Token de configuração (uso único): %s", token)
    return user


def complete_setup(identity: IdentityService, token: str, password: str) -> User:
    rec = identity.store.gget("owner_setup", "token")
    if not rec or rec["hash"] != sha256(token or ""):
        raise DomainError(403, "Token inválido", "Token de configuração inválido ou já utilizado.")
    if len(password) < 10 or not re.search(r"\d", password) or not re.search(r"[A-Za-z]", password):
        raise DomainError(422, "Dados inválidos", "Senha com 10+ caracteres, letras e números.")
    user = identity.store.gget("users", identity.store.gget("users_by_email", OWNER_EMAIL))
    user.password_hash = hash_password(password)
    identity.store.gdelete("owner_setup", "token")
    return user
