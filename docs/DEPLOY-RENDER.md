# Colocar a API no ar (Render + PostgreSQL)

Resultado: `https://api.aurionfinance.com.br` com login real do Ramon (dono/admin, acesso irrestrito),
CRM e pagamentos Asaas persistidos em PostgreSQL. O site `aurionfinance.com.br` passa a usar essa API.

## 1. Criar a conta e o Blueprint (Bruno — ~5 min)
1. https://render.com → **Get Started** → entrar com o GitHub (`brunoandradeportela-design`).
2. Autorizar o Render a ler o repositório `ramon-inteligencia-financeira`.
3. **New → Blueprint** → escolher o repositório → o Render lê o `render.yaml` e mostra:
   `aurion-api` (web, Starter) + `aurion-db` (Postgres, Basic 256 MB).
4. Preencher os secrets pedidos (digitados por você, direto no Render — nunca no chat):
   | Variável | O que colocar |
   |---|---|
   | `RAMON_OWNER_PASSWORD` | senha do Ramon (10+ caracteres, letras e números) |
   | `RAMON_OWNER_CPF` | CPF do Ramon |
   | `RAMON_ASAAS_API_KEY` | chave **nova** do Asaas (revogar a antiga) |
5. **Apply**. Custo estimado: ~US$ 7/mês (API) + ~US$ 6/mês (banco).

## 2. Domínio da API
1. Render → `aurion-api` → **Settings → Custom Domains → Add** `api.aurionfinance.com.br`.
2. Registro.br → aurionfinance.com.br → DNS (modo avançado) → novo registro
   **CNAME** `api` → `aurion-api.onrender.com` (o Render mostra o destino exato).
3. O Render emite o certificado HTTPS sozinho.

## 3. Ligar o site à API
`apps/web/app/js/config.js` aponta para `https://api.aurionfinance.com.br` quando o site roda no
domínio de produção. Fora dele (link de demonstração) continua em modo demo.

## 4. Webhook do Asaas
Asaas → Integrações → Webhooks → novo:
* URL: `https://api.aurionfinance.com.br/v1/webhooks/asaas`
* Token de autenticação: valor de `RAMON_ASAAS_WEBHOOK_TOKEN` (Render → aurion-api → Environment)
* Eventos: todos de **Cobranças** (PAYMENT_*).

## Notas técnicas
* Persistência: `services/common/pg_store.py` — carrega tudo na inicialização e grava no Postgres
  após cada requisição que altera dados + a cada 20 s. Rodar **1 worker** (já definido).
* Backups: o Postgres Basic do Render tem backup diário automático.
* Trocar a senha do Ramon: alterar `RAMON_OWNER_PASSWORD` no Render → o serviço reinicia e aplica.
