"""Persistência em PostgreSQL para o `Store`.

Estratégia (write-behind com verificação de mudanças):
* Na inicialização, todo o conteúdo é carregado do banco para a memória — as regras de negócio
  continuam usando o mesmo contrato `Store` (leituras rápidas, isolamento por titular).
* `flush()` serializa cada objeto, compara o hash com o último gravado e faz upsert apenas do que
  mudou (inclusive objetos alterados "no lugar", como `user.plan = ...`) e remove o que foi apagado.
* O flush roda após toda requisição que altera dados (middleware da API) e a cada 20 s em segundo
  plano, então nada se perde num reinício/deploy.

Os objetos são serializados com pickle porque o domínio usa dataclasses/Decimal. O conteúdo vem
exclusivamente do próprio banco da aplicação (nunca de entrada externa).
"""
from __future__ import annotations

import hashlib
import logging
import pickle
import threading
import time

from services.common.store import Store

log = logging.getLogger("ramon.pgstore")

DDL = """
CREATE TABLE IF NOT EXISTS app_store (
    scope      TEXT NOT NULL,          -- 'o' (dados do titular) | 'g' (globais)
    collection TEXT NOT NULL,
    owner_id   TEXT NOT NULL,          -- '' para globais
    obj_key    TEXT NOT NULL,
    payload    BYTEA NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (scope, collection, owner_id, obj_key)
);
"""

UPSERT = """
INSERT INTO app_store (scope, collection, owner_id, obj_key, payload, updated_at)
VALUES (%s, %s, %s, %s, %s, now())
ON CONFLICT (scope, collection, owner_id, obj_key)
DO UPDATE SET payload = EXCLUDED.payload, updated_at = now()
"""

DELETE = "DELETE FROM app_store WHERE scope=%s AND collection=%s AND owner_id=%s AND obj_key=%s"


def normalize_dsn(dsn: str) -> str:
    return "postgresql://" + dsn[len("postgres://"):] if dsn.startswith("postgres://") else dsn


class PostgresStore(Store):
    def __init__(self, dsn: str, autoflush_seconds: float = 20.0) -> None:
        super().__init__()
        import psycopg  # import tardio: só exigido em produção

        self._psycopg = psycopg
        self._dsn = normalize_dsn(dsn)
        self._hashes: dict[tuple[str, str, str, str], str] = {}
        self._flush_lock = threading.Lock()
        with psycopg.connect(self._dsn, autocommit=True) as conn:
            conn.execute(DDL)
            rows = conn.execute("SELECT scope, collection, owner_id, obj_key, payload FROM app_store").fetchall()
        for scope, coll, owner, key, payload in rows:
            raw = bytes(payload)
            obj = pickle.loads(raw)
            if scope == "g":
                self._global[coll][key] = obj
            else:
                self._data[coll][owner][key] = obj
            self._hashes[(scope, coll, owner, key)] = hashlib.sha256(raw).hexdigest()
        log.info("PostgresStore carregado: %d registros", len(rows))
        if autoflush_seconds > 0:
            threading.Thread(target=self._loop, args=(autoflush_seconds,), daemon=True, name="pgstore-flush").start()

    # ------------------------------------------------------------------ gravação
    def _current(self) -> dict[tuple[str, str, str, str], bytes]:
        out: dict[tuple[str, str, str, str], bytes] = {}
        with self._lock:
            for coll, owners in self._data.items():
                for owner, objs in owners.items():
                    for key, obj in objs.items():
                        out[("o", coll, owner, key)] = pickle.dumps(obj, protocol=pickle.HIGHEST_PROTOCOL)
            for coll, objs in self._global.items():
                for key, obj in objs.items():
                    out[("g", coll, "", key)] = pickle.dumps(obj, protocol=pickle.HIGHEST_PROTOCOL)
        return out

    def flush(self) -> int:
        """Grava no banco o que mudou desde o último flush. Retorna o nº de linhas afetadas."""
        with self._flush_lock:
            cur = self._current()
            hashes = {k: hashlib.sha256(v).hexdigest() for k, v in cur.items()}
            changed = [k for k, h in hashes.items() if self._hashes.get(k) != h]
            removed = [k for k in self._hashes if k not in cur]
            if not changed and not removed:
                return 0
            with self._psycopg.connect(self._dsn) as conn:
                with conn.cursor() as c:
                    if changed:
                        c.executemany(UPSERT, [(*k, cur[k]) for k in changed])
                    if removed:
                        c.executemany(DELETE, removed)
                conn.commit()
            for k in changed:
                self._hashes[k] = hashes[k]
            for k in removed:
                self._hashes.pop(k, None)
            return len(changed) + len(removed)

    def _loop(self, every: float) -> None:
        while True:
            time.sleep(every)
            try:
                self.flush()
            except Exception:  # noqa: BLE001 — nunca derrubar o processo por falha de flush
                log.exception("Falha ao gravar no PostgreSQL (nova tentativa no próximo ciclo)")
