"""Document Engine — upload seguro, classificação, extração e vínculo (Dossiê §9.11).

Fluxo: recebido -> classificado -> extraído -> validado -> utilizado.
Validações (Plano técnico §14): extensão, MIME declarado, assinatura (magic bytes), tamanho, nome.
"""
from __future__ import annotations

import re
from dataclasses import asdict, dataclass, field

from services.common.core import ValidationFailed, new_id, sha256, utcnow

MAX_BYTES = 10 * 1024 * 1024
ALLOWED = {
    ".pdf": ("application/pdf", [b"%PDF-"]),
    ".png": ("image/png", [b"\x89PNG\r\n\x1a\n"]),
    ".jpg": ("image/jpeg", [b"\xff\xd8\xff"]),
    ".jpeg": ("image/jpeg", [b"\xff\xd8\xff"]),
    ".csv": ("text/csv", []),
}
CLASSIFIERS = [
    (r"informe.*rendimento|rendimentos", "informe_rendimentos", "Informe de rendimentos"),
    (r"nota.*corretagem|corretagem|negocia", "nota_corretagem", "Nota de corretagem"),
    (r"darf", "darf", "DARF"),
    (r"extrato", "extrato", "Extrato"),
    (r"previd|pgbl|vgbl", "previdencia", "Previdência"),
    (r"recibo|m[eé]dico|sa[uú]de|educa", "dedutivel", "Comprovante dedutível"),
]


@dataclass
class Document:
    id: str
    owner_id: str
    filename: str
    mime: str
    size: int
    checksum: str
    kind: str
    title: str
    status: str
    uploaded_at: str
    storage_key: str
    extraction: dict = field(default_factory=dict)
    links: list = field(default_factory=list)
    detail: str = ""

    def public(self) -> dict:
        d = asdict(self)
        d.pop("storage_key")
        return d


def safe_name(name: str) -> str:
    base = name.replace("\\", "/").split("/")[-1]
    base = re.sub(r"[^\w.\- ()À-ÿ]", "_", base)[:120]
    if not base or base.startswith("."):
        raise ValidationFailed("Nome de arquivo inválido")
    return base


def validate_upload(filename: str, declared_mime: str, content: bytes) -> tuple[str, str]:
    name = safe_name(filename)
    ext = "." + name.rsplit(".", 1)[-1].lower() if "." in name else ""
    if ext not in ALLOWED:
        raise ValidationFailed(f"Extensão não permitida: {ext or '(sem extensão)'}. Aceitos: PDF, PNG, JPG e CSV.")
    if len(content) == 0 or len(content) > MAX_BYTES:
        raise ValidationFailed("Arquivo vazio ou acima de 10 MB.")
    mime, magics = ALLOWED[ext]
    if declared_mime and declared_mime.split(";")[0].strip() not in (mime, "application/octet-stream", "application/vnd.ms-excel", "text/plain"):
        raise ValidationFailed("Tipo de conteúdo não corresponde à extensão.")
    if magics and not any(content.startswith(m) for m in magics):
        raise ValidationFailed("Conteúdo do arquivo não corresponde ao formato informado.")
    if ext == ".csv":
        try:
            content.decode("utf-8")
        except UnicodeDecodeError:
            try:
                content.decode("latin-1")
            except UnicodeDecodeError:
                raise ValidationFailed("CSV com codificação inválida.")
        if b"\x00" in content:
            raise ValidationFailed("CSV contém bytes binários.")
    if ext == ".pdf" and re.search(rb"/JavaScript|/Launch|/EmbeddedFile", content[:200_000]):
        raise ValidationFailed("PDF com conteúdo ativo não é aceito.")
    return name, mime


def classify(filename: str, text: str = "") -> tuple[str, str]:
    hay = f"{filename} {text[:2000]}".lower()
    for pattern, kind, title in CLASSIFIERS:
        if re.search(pattern, hay):
            return kind, title
    return "outro", "Documento"


class DocumentEngine:
    def __init__(self, blob_store: dict | None = None) -> None:
        self.blobs = blob_store if blob_store is not None else {}

    def receive(self, owner_id: str, filename: str, mime: str, content: bytes) -> Document:
        name, mime = validate_upload(filename, mime, content)
        text = content.decode("utf-8", "ignore") if mime == "text/csv" else ""
        kind, title = classify(name, text)
        checksum = sha256(content)
        key = f"{owner_id}/{checksum}"
        self.blobs[key] = content      # S3-compatible em produção (criptografia + retenção)
        return Document(id=new_id("doc"), owner_id=owner_id, filename=name, mime=mime, size=len(content),
                        checksum=checksum, kind=kind, title=title, status="classificado",
                        uploaded_at=utcnow().isoformat(), storage_key=key)
