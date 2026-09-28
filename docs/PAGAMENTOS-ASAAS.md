# Pagamentos com Asaas — configuração e operação

Decisão D-06 resolvida: gateway **Asaas** (Pix, boleto e cartão; assinatura mensal).

## Como funciona

| Etapa | O que acontece |
|---|---|
| Cliente clica em **Assinar** (tela Planos) | informa CPF/CNPJ → a API cria/recupera o cliente no Asaas (`externalReference` = id do usuário), cria a assinatura mensal (`billingType=UNDEFINED`, o cliente escolhe Pix/boleto/cartão) e redireciona para a fatura (`invoiceUrl`) |
| Asaas confirma/recebe/vence/estorna | **webhook** `POST /v1/webhooks/asaas` atualiza a cobrança e o CRM na hora (idempotente pelo id do evento; exige o header `asaas-access-token`) |
| A cada 15 min (e no botão **Sincronizar agora**) | a API lê **todas** as cobranças da conta Asaas (paginado) e concilia — rede de segurança se algum webhook se perder |
| Ramon abre **Pagamentos** no CRM | vê tudo: recebido (bruto e líquido), a receber, em atraso, estornado; filtros por status, forma, origem e período; link da fatura; exportação CSV; saldo da conta Asaas e saúde da conexão |

Cobranças criadas diretamente no painel do Asaas para pessoas sem conta na plataforma também aparecem, marcadas **“sem vínculo”**. Se o e-mail bater com um cliente cadastrado, a cobrança é vinculada automaticamente.

Mapeamento de status: `RECEIVED/CONFIRMED/RECEIVED_IN_CASH` → **pago** · `PENDING` → **pendente** · `OVERDUE` → **atrasado** (cliente vai para *Inadimplente*) · `REFUNDED/CHARGEBACK_*` → **estornado** · `PAYMENT_DELETED` → removida.

## Configuração (uma vez)

1. **Chave de API** — painel Asaas → *Integrações* → *Chaves de API*. Guarde **somente** como secret do servidor:
   `RAMON_ASAAS_API_KEY=<chave>` (a chave de produção começa com `$aact_prod_`).
2. **Token do webhook** — invente uma senha longa (ex.: 40 caracteres aleatórios) e guarde em `RAMON_ASAAS_WEBHOOK_TOKEN`.
3. **Webhook no Asaas** — *Integrações* → *Webhooks* → *Adicionar*:
   * URL: `https://api.aurionfinance.com.br/v1/webhooks/asaas` (endereço da API hospedada)
   * Token de autenticação: o mesmo do passo 2
   * Versão da API: v3 · Tipo de envio: sequencial · Ativo: sim
   * Eventos: todos de **Cobranças** (`PAYMENT_*`) e de **Assinaturas** (`SUBSCRIPTION_*`)
4. Suba a API, entre como dono → **Pagamentos** → **Testar conexão** (mostra “Conectado” e o saldo) → **Sincronizar agora**.

## Segurança

* A chave nunca aparece no código, no site, em logs ou em respostas da API (só um *fingerprint*: 10 primeiros caracteres + hash).
* Um teste automático falha se uma chave `$aact_prod_…` for encontrada em qualquer arquivo do repositório.
* CPF/CNPJ do pagador vai só para o Asaas; na plataforma fica mascarado.
* Se a chave vazar, gere outra no painel do Asaas (a antiga é invalidada) e troque o secret.

## Teste sem risco

Use uma conta **sandbox** (`https://sandbox.asaas.com`, chave `$aact_hmlg_…`): a API detecta o ambiente pelo prefixo. Em sandbox é possível simular o pagamento de uma cobrança pelo painel e ver o cliente virar *Pagante* no CRM.
