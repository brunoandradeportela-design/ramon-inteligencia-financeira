"""Backup lógico do AURION (todas as tabelas do D1) e restauração em outro ambiente.

backup:   python aurion_backup.py backup  --api URL --out arquivo.enc
restore:  python aurion_backup.py restore --api URL --in  arquivo.enc
Variáveis: BACKUP_TOKEN (igual ao segredo do Worker) e BACKUP_PASSPHRASE (criptografia AES-256 via openssl, PBKDF2).
O arquivo aberto é um .tar.gz com manifest.json e uma linha JSON por registro em tables/<tabela>.jsonl.
"""
import argparse
import hashlib
import io
import json
import os
import subprocess
import sys
import tarfile
import urllib.request

UA = "AURION-backup/1.0"


def api(method, base, path, body=None):
    req = urllib.request.Request(base.rstrip("/") + path, method=method, data=json.dumps(body).encode() if body is not None else None,
                                 headers={"User-Agent": UA, "Content-Type": "application/json", "X-Backup-Token": os.environ["BACKUP_TOKEN"]})
    with urllib.request.urlopen(req, timeout=120) as r:
        return json.loads(r.read())


def crypt(data, decrypt=False):
    if not os.environ.get("BACKUP_PASSPHRASE"):
        sys.exit("BACKUP_PASSPHRASE ausente: o backup nunca é gravado sem criptografia.")
    cmd = ["openssl", "enc", "-aes-256-cbc", "-pbkdf2", "-iter", "200000", "-salt", "-pass", "env:BACKUP_PASSPHRASE"] + (["-d"] if decrypt else [])
    return subprocess.run(cmd, input=data, capture_output=True, check=True).stdout


def backup(base, out):
    man = api("GET", base, "/v1/admin/backup/manifest")
    buf = io.BytesIO()
    summary = []
    with tarfile.open(fileobj=buf, mode="w:gz") as tar:
        for t in man["tables"]:
            lines, after, n = [], 0, 0
            while True:
                page = api("GET", base, f"/v1/admin/backup/tabela/{t['name']}?after={after}")
                lines += [json.dumps(r, ensure_ascii=False, sort_keys=True) for r in page["rows"]]
                n += len(page["rows"])
                if page["next"] is None:
                    break
                after = page["next"]
            data = ("\n".join(lines) + ("\n" if lines else "")).encode()
            info = tarfile.TarInfo(f"tables/{t['name']}.jsonl")
            info.size = len(data)
            tar.addfile(info, io.BytesIO(data))
            summary.append({"name": t["name"], "rows": n, "sha256": hashlib.sha256(data).hexdigest()})
        man["exported"] = summary
        m = json.dumps(man, ensure_ascii=False, indent=1).encode()
        info = tarfile.TarInfo("manifest.json")
        info.size = len(m)
        tar.addfile(info, io.BytesIO(m))
    with open(out, "wb") as f:
        f.write(crypt(buf.getvalue()))
    total = sum(s["rows"] for s in summary)
    print(f"backup ok: {len(summary)} tabelas, {total} registros -> {out}")
    return summary


def restore(base, inp, batch=40):
    with open(inp, "rb") as f:
        raw = crypt(f.read(), decrypt=True)
    with tarfile.open(fileobj=io.BytesIO(raw), mode="r:gz") as tar:
        man = json.loads(tar.extractfile("manifest.json").read())
        for t in man["exported"]:
            data = tar.extractfile(f"tables/{t['name']}.jsonl").read()
            if hashlib.sha256(data).hexdigest() != t["sha256"]:
                sys.exit(f"arquivo corrompido: {t['name']}")
            rows = [json.loads(x) for x in data.decode().splitlines() if x]
            size = 1 if t["name"] == "doc_chunks" else batch
            for i in range(0, len(rows), size):
                api("POST", base, f"/v1/admin/restore/tabela/{t['name']}", {"rows": rows[i:i + size]})
            print(f"  {t['name']}: {len(rows)} registros")
    print("restauração ok")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("acao", choices=["backup", "restore"])
    ap.add_argument("--api", required=True)
    ap.add_argument("--out")
    ap.add_argument("--in", dest="inp")
    a = ap.parse_args()
    if not os.environ.get("BACKUP_TOKEN"):
        sys.exit("BACKUP_TOKEN ausente.")
    backup(a.api, a.out) if a.acao == "backup" else restore(a.api, a.inp)
