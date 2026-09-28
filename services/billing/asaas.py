"""Cliente da API v3 do Asaas (gateway de cobrança — decisão D-06: Asaas).

Segurança:
* A chave de API é lida SOMENTE de variável de ambiente (RAMON_ASAAS_API_KEY) — nunca do código, do
  front-end, de logs ou do banco. Ela nunca é devolvida por nenhum endpoint (apenas um "fingerprint").
* O ambiente é inferido pelo prefixo da chave ($aact_prod_ → produção; $aact_hmlg_ → sandbox) e pode ser
  forçado por RAMON_ASAAS_ENV=production|sandbox.

Documentação: https://docs.asaas.com/reference
"""
from __future__ import annotations

import os
from dataclasses import dataclass
from typing import Any

import httpx

from services.common.core import DomainError, sha256

BASE_URLS = {"production": "https://api.asaas.com/v3", "sandbox": "https://api-sandbox.asaas.com/v3"}
USER_AGENT = "ramon-inteligencia-financeira/1.0"

# status do Asaas → status do CRM
STATUS_MAP = {
    "RECEIVED": "pago", "CONFIRMED": "pago", "RECEIVED_IN_CASH": "pago", "DUNNING_RECEIVED": "pago",
    "PENDING": "pendente", "AWAITING_RISK_ANALYSIS": "pendente", "AUTHORIZED": "pendente",
    "OVERDUE": "atrasado", "DUNNING_REQUESTED": "atrasado",
    "REFUNDED": "estornado", "REFUND_REQUESTED": "estornado", "REFUND_IN_PROGRESS": "estornado",
    "CHARGEBACK_REQUESTED": "estornado", "CHARGEBACK_DISPUTE": "estornado", "AWAITING_CHARGEBACK_REVERSAL": "estornado",
}
METHOD_MAP = {"PIX": "pix", "BOLETO": "boleto", "CREDIT_CARD": "cartao", "DEBIT_CARD": "cartao",
              "UNDEFINED": "a_definir", "TRANSFER": "transferencia", "DEPOSIT": "transferencia"}


class AsaasError(DomainError):
    def __init__(self, status: int, detail: str, code: str = "asaas_error") -> None:
        super().__init__(502 if status >= 500 or status == 0 else (401 if status == 401 else 422),
                         "Erro no gateway de pagamento (Asaas)", detail, extra={"code": code, "gateway_status": status})


@dataclass(frozen=True)
class AsaasConfig:
    api_key: str
    env: str
    webhook_token: str

    @property
    def base_url(self) -> str:
        return BASE_URLS[self.env]

    @property
    def fingerprint(self) -> str:
        """Identifica a chave sem revelá-la (para conferência no painel)."""
        return f"{self.api_key[:10]}…{sha256(self.api_key)[:8]}" if self.api_key else ""

    @classmethod
    def from_env(cls) -> AsaasConfig | None:
        key = os.environ.get("RAMON_ASAAS_API_KEY", "").strip()
        if not key:
            return None
        env = os.environ.get("RAMON_ASAAS_ENV", "").strip().lower()
        if env not in BASE_URLS:
            env = "sandbox" if key.startswith("$aact_hmlg_") else "production"
        return cls(api_key=key, env=env, webhook_token=os.environ.get("RAMON_ASAAS_WEBHOOK_TOKEN", "").strip())


class AsaasClient:
    def __init__(self, config: AsaasConfig, transport: httpx.BaseTransport | None = None, timeout: float = 20.0) -> None:
        self.config = config
        self._http = httpx.Client(base_url=config.base_url, timeout=timeout, transport=transport,
                                  headers={"access_token": config.api_key, "User-Agent": USER_AGENT,
                                           "Content-Type": "application/json", "Accept": "application/json"})

    # ------------------------------------------------------------------ baixo nível
    def _req(self, method: str, path: str, **kw) -> Any:
        try:
            r = self._http.request(method, path, **kw)
        except httpx.HTTPError as e:
            raise AsaasError(0, f"Sem comunicação com o Asaas: {type(e).__name__}", "asaas_unreachable") from e
        if r.status_code == 401:
            raise AsaasError(401, "Chave de API do Asaas inválida, revogada ou de outro ambiente.", "asaas_unauthorized")
        if r.status_code >= 400:
            try:
                errs = r.json().get("errors") or []
                msg = "; ".join(f"{e.get('code')}: {e.get('description')}" for e in errs) or r.text[:300]
            except ValueError:
                msg = r.text[:300]
            raise AsaasError(r.status_code, msg, "asaas_rejected")
        return r.json() if r.content else {}

    def _list(self, path: str, params: dict | None = None, max_items: int = 5000) -> list[dict]:
        params, out, offset = dict(params or {}), [], 0
        while True:
            page = self._req("GET", path, params={**params, "offset": offset, "limit": 100})
            data = page.get("data") or []
            out.extend(data)
            if not page.get("hasMore") or not data or len(out) >= max_items:
                return out
            offset += len(data)

    # ------------------------------------------------------------------ conta
    def balance(self) -> dict:
        return self._req("GET", "/finance/balance")

    def commercial_info(self) -> dict:
        return self._req("GET", "/myAccount/commercialInfo/")

    # ------------------------------------------------------------------ clientes
    def find_customer(self, *, email: str = "", cpf_cnpj: str = "", external_reference: str = "") -> dict | None:
        for params in ({"externalReference": external_reference}, {"cpfCnpj": cpf_cnpj}, {"email": email}):
            v = next(iter(params.values()))
            if v:
                data = self._req("GET", "/customers", params={**params, "limit": 1}).get("data") or []
                if data:
                    return data[0]
        return None

    def create_customer(self, *, name: str, cpf_cnpj: str, email: str, mobile_phone: str, external_reference: str) -> dict:
        return self._req("POST", "/customers", json={"name": name, "cpfCnpj": cpf_cnpj, "email": email,
                                                    "mobilePhone": mobile_phone, "externalReference": external_reference,
                                                    "notificationDisabled": False})

    def get_customer(self, customer_id: str) -> dict:
        return self._req("GET", f"/customers/{customer_id}")

    # ------------------------------------------------------------------ assinaturas / cobranças
    def create_subscription(self, *, customer: str, value: str, next_due_date: str, description: str,
                            external_reference: str) -> dict:
        return self._req("POST", "/subscriptions", json={
            "customer": customer, "billingType": "UNDEFINED", "value": float(value), "nextDueDate": next_due_date,
            "cycle": "MONTHLY", "description": description, "externalReference": external_reference})

    def subscription_payments(self, subscription_id: str) -> list[dict]:
        return self._list(f"/subscriptions/{subscription_id}/payments")

    def cancel_subscription(self, subscription_id: str) -> dict:
        return self._req("DELETE", f"/subscriptions/{subscription_id}")

    def list_payments(self, **filters) -> list[dict]:
        return self._list("/payments", {k: v for k, v in filters.items() if v})

    def get_payment(self, payment_id: str) -> dict:
        return self._req("GET", f"/payments/{payment_id}")
