"""Repositório em memória com isolamento por titular (tenant = usuário).

O MVP roda sem dependências externas. O contrato `Store` é o mesmo que a
implementação PostgreSQL deverá cumprir (ver database/migrations/0001_init.sql).
Toda leitura/escrita exige `owner_id`: não há API para listar dados de outro titular.
"""
from __future__ import annotations

import copy
import threading
from collections import defaultdict
from typing import Any, Callable, Iterable


class Store:
    def __init__(self) -> None:
        self._data: dict[str, dict[str, dict[str, Any]]] = defaultdict(lambda: defaultdict(dict))
        self._global: dict[str, dict[str, Any]] = defaultdict(dict)
        self._lock = threading.RLock()

    # ---- dados do titular -------------------------------------------------
    def put(self, collection: str, owner_id: str, obj_id: str, obj: Any) -> Any:
        if not owner_id:
            raise ValueError("owner_id obrigatório (isolamento por titular)")
        with self._lock:
            self._data[collection][owner_id][obj_id] = obj
        return obj

    def get(self, collection: str, owner_id: str, obj_id: str) -> Any | None:
        with self._lock:
            return self._data[collection][owner_id].get(obj_id)

    def list(self, collection: str, owner_id: str, where: Callable[[Any], bool] | None = None) -> list[Any]:
        with self._lock:
            items = list(self._data[collection][owner_id].values())
        return [i for i in items if where is None or where(i)]

    def delete(self, collection: str, owner_id: str, obj_id: str) -> bool:
        with self._lock:
            return self._data[collection][owner_id].pop(obj_id, None) is not None

    def purge_owner(self, owner_id: str, keep: Iterable[str] = ("audit",)) -> None:
        """Eliminação de dados do titular (LGPD art. 18, VI), preservando coleções de retenção legal."""
        keep = set(keep)
        with self._lock:
            for name, parts in self._data.items():
                if name not in keep:
                    parts.pop(owner_id, None)

    # ---- dados globais (catálogo, regras, índice de login) -----------------
    def gput(self, collection: str, key: str, obj: Any) -> Any:
        with self._lock:
            self._global[collection][key] = obj
        return obj

    def gget(self, collection: str, key: str) -> Any | None:
        with self._lock:
            return self._global[collection].get(key)

    def glist(self, collection: str) -> list[Any]:
        with self._lock:
            return list(self._global[collection].values())

    def gdelete(self, collection: str, key: str) -> None:
        with self._lock:
            self._global[collection].pop(key, None)

    def snapshot(self) -> dict:
        with self._lock:
            return copy.deepcopy({k: dict(v) for k, v in self._data.items()})
