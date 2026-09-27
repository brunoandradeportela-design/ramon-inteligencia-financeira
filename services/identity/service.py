"""Identity — cadastro, login, sessões, papéis e proteção contra força bruta."""
from __future__ import annotations

import hashlib
import hmac
import os
import re
from dataclasses import dataclass, field
from datetime import datetime, timedelta

from services.common.core import (DomainError, Unauthorized, ValidationFailed, new_id, new_token, sha256,
                                  utcnow)
from services.common.store import Store

PBKDF2_ITER = 310_000
SESSION_TTL = timedelta(hours=12)
MAX_FAILS = 5
LOCK_WINDOW = timedelta(minutes=15)
EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


@dataclass
class User:
    id: str
    email: str
    name: str
    password_hash: str
    roles: list[str] = field(default_factory=lambda: ["titular"])
    plan: str = "free"
    created_at: str = ""
    accepted_terms_version: str = ""
    profile: dict = field(default_factory=dict)
    theme: str = "system"

    def public(self) -> dict:
        return {"id": self.id, "email": self.email, "name": self.name, "roles": self.roles, "plan": self.plan,
                "profile": self.profile, "theme": self.theme, "created_at": self.created_at}


@dataclass
class Session:
    token_hash: str
    user_id: str
    expires_at: datetime
    device: str = ""


def hash_password(password: str, salt: bytes | None = None) -> str:
    salt = salt or os.urandom(16)
    dk = hashlib.pbkdf2_hmac("sha256", password.encode(), salt, PBKDF2_ITER)
    return f"pbkdf2_sha256${PBKDF2_ITER}${salt.hex()}${dk.hex()}"


def verify_password(password: str, stored: str) -> bool:
    try:
        _, it, salt, dk = stored.split("$")
        calc = hashlib.pbkdf2_hmac("sha256", password.encode(), bytes.fromhex(salt), int(it))
        return hmac.compare_digest(calc.hex(), dk)
    except Exception:
        return False


class IdentityService:
    def __init__(self, store: Store) -> None:
        self.store = store

    def register(self, *, email: str, name: str, password: str, accept_terms: bool, plan: str = "free") -> User:
        email = email.strip().lower()
        errors = []
        if not EMAIL_RE.match(email):
            errors.append({"field": "email", "msg": "E-mail inválido"})
        if len(name.strip()) < 2:
            errors.append({"field": "name", "msg": "Informe seu nome"})
        if len(password) < 10 or not re.search(r"\d", password) or not re.search(r"[A-Za-z]", password):
            errors.append({"field": "password", "msg": "Senha com 10+ caracteres, letras e números"})
        if not accept_terms:
            errors.append({"field": "accept_terms", "msg": "É necessário aceitar os termos e a política de privacidade"})
        if errors:
            raise ValidationFailed("Cadastro inválido", errors)
        if self.store.gget("users_by_email", email):
            raise DomainError(409, "Conflito", "Já existe uma conta com este e-mail.")
        user = User(id=new_id("usr"), email=email, name=name.strip(), password_hash=hash_password(password),
                    plan=plan if plan in ("free", "pro", "premium") else "free",
                    created_at=utcnow().isoformat(), accepted_terms_version="2026-09")
        self.store.gput("users_by_email", email, user.id)
        self.store.gput("users", user.id, user)
        return user

    def login(self, *, email: str, password: str, device: str = "") -> tuple[str, User]:
        email = email.strip().lower()
        fails = [t for t in (self.store.gget("login_fails", email) or []) if utcnow() - t < LOCK_WINDOW]
        if len(fails) >= MAX_FAILS:
            raise DomainError(429, "Muitas tentativas", "Conta temporariamente bloqueada. Tente em 15 minutos.")
        uid = self.store.gget("users_by_email", email)
        user = self.store.gget("users", uid) if uid else None
        if not user or not verify_password(password, user.password_hash):
            fails.append(utcnow())
            self.store.gput("login_fails", email, fails)
            raise Unauthorized("E-mail ou senha incorretos.")
        self.store.gdelete("login_fails", email)
        token = new_token()
        self.store.gput("sessions", sha256(token), Session(sha256(token), user.id, utcnow() + SESSION_TTL, device))
        return token, user

    def authenticate(self, token: str | None) -> User:
        if not token:
            raise Unauthorized()
        sess = self.store.gget("sessions", sha256(token))
        if not sess or sess.expires_at < utcnow():
            raise Unauthorized("Sessão expirada. Entre novamente.")
        user = self.store.gget("users", sess.user_id)
        if not user:
            raise Unauthorized()
        return user

    def logout(self, token: str) -> None:
        self.store.gdelete("sessions", sha256(token))

    def get(self, user_id: str) -> User:
        return self.store.gget("users", user_id)
