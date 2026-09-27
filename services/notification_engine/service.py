"""Notification Engine — entrega de alertas respeitando preferências e com deduplicação."""
from __future__ import annotations

from services.common.core import sha256, utcnow
from services.common.store import Store

DEFAULT_PREFS = {"in_app": True, "email": False, "min_severity": "atencao"}
RANK = {"informativo": 0, "oportunidade": 1, "atencao": 2, "alto": 3, "critico": 4}


class NotificationService:
    def __init__(self, store: Store) -> None:
        self.store = store

    def prefs(self, owner_id: str) -> dict:
        return self.store.get("notif_prefs", owner_id, "prefs") or dict(DEFAULT_PREFS)

    def set_prefs(self, owner_id: str, prefs: dict) -> dict:
        merged = {**self.prefs(owner_id), **{k: v for k, v in prefs.items() if k in DEFAULT_PREFS}}
        self.store.put("notif_prefs", owner_id, "prefs", merged)
        return merged

    def dispatch(self, owner_id: str, alerts: list[dict]) -> list[dict]:
        p = self.prefs(owner_id)
        sent = []
        for a in alerts:
            if RANK.get(a["severity"], 0) < RANK[p["min_severity"]] or a["status"] == "resolvido":
                continue
            key = sha256(f"{a['id']}|{a['detail']}")
            if self.store.get("notif_sent", owner_id, key):
                continue   # dedup: mesmo alerta com mesmo conteúdo já notificado
            n = {"alert_id": a["id"], "title": a["title"], "channel": "in_app", "at": utcnow().isoformat()}
            self.store.put("notif_sent", owner_id, key, n)
            sent.append(n)
        return sent
