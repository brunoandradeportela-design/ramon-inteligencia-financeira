import os

# Ambiente determinístico de testes (secrets fictícios; nunca usar em produção)
os.environ.setdefault("RAMON_REFERENCE_DATE", "2026-09-27")
os.environ.setdefault("RAMON_OWNER_PASSWORD", "donoTeste2026seguro")
os.environ.setdefault("RAMON_OWNER_CPF", "529.982.247-25")   # CPF de exemplo público (válido e fictício)
