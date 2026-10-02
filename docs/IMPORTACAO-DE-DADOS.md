# Importação de dados do cliente (M1 + M2)

Enquanto o Open Finance via agregador não é contratado, o cliente traz os próprios dados em **Importar dados**.
O arquivo é lido no navegador (`apps/web/app/js/importers.js`); só os registros normalizados vão para a API
(`POST /v1/imports`, tabela `fin_items` no D1, isolada por cliente). Os painéis Início, Patrimônio e Finanças
passam a ser calculados por `apps/web/app/js/fin_engine.js` sobre esses dados. Sem importação, mostram o exemplo
com o aviso "Exemplo ilustrativo".

| Arquivo | Onde o cliente baixa | O que vira |
|---|---|---|
| OFX (conta e cartão) | app/internet banking → Extrato → Exportar | contas, saldo, lançamentos |
| CSV (Nubank, Inter, BB, Itaú, C6, genérico) | idem | lançamentos (colunas detectadas) |
| B3 · Posição (.xlsx) | investidor.b3.com.br → Extratos → Posição | posições (ações, FII, ETF, BDR, Tesouro, renda fixa) |
| B3 · Negociação (.xlsx) | investidor.b3.com.br → Extratos → Negociação | negociações → custo médio e resultado |
| B3 · Movimentação (.xlsx) | investidor.b3.com.br → Extratos → Movimentação | liquidações → negociações |
| Nota de corretagem (PDF, SINACOR) — beta | corretora | negociações |

Regras: lançamentos repetidos não duplicam (id = hash do conteúdo); nova posição da B3 substitui a anterior;
aplicações, resgates e pagamento de fatura não contam como receita/despesa; cada importação pode ser apagada.

Rotas: `POST/GET /v1/imports`, `DELETE /v1/imports/{id}`, `DELETE /v1/imports` (apaga tudo do cliente),
`GET /v1/finance/summary|transactions`, `/v1/portfolio/consolidated`, `/v1/dashboard` (`has_data=false` quando vazio).

Testes: `cd worker && npm test` (leitores e motor) · `node test/imports_e2e.mjs` contra `wrangler dev`.

## M4 — Imposto sobre as negociações reais

`apps/web/app/js/tax_engine.js` é a porta em JS do `services/tax_engine/engine.py` (mesmas regras BR-IRPF 2026.1; validado
contra o snapshot de demonstração: R$ 1.419,88 de imposto, R$ 12,94 de IRRF e R$ 2.701,62 isentos, idênticos ao Python).

- Operações comuns 15% (ações isentas com vendas ≤ R$ 20 mil/mês), day trade 20% com IRRF de 1%, FII 20%.
- Prejuízos compensados por modalidade; IRRF de 0,005% abatido; DARF 6015 no último dia útil do mês seguinte (feriados
  nacionais incluídos); abaixo de R$ 10 acumula.
- Day trade identificado por compra e venda do mesmo ativo no mesmo dia (ou marcação "D" da nota de corretagem).
- Venda sem compra registrada vira evento `pendente_dado` e baixa a confiança para 55%.
- Classe do ativo: posição da B3 quando houver; senão, inferida pelo código (lista de ETFs e units; final 11 = FII, com aviso).
- O cliente informa prejuízos de anos anteriores e marca DARFs pagos (`GET/PUT /v1/tax/settings`, `PUT/DELETE /v1/tax/darfs/AAAA-MM`).
- Rotas: `GET /v1/tax/summary`, `GET /v1/tax/events` (`?year=AAAA`) — planos Pro e Premium (Free recebe 402).

## M3 — Cotações e índices diários

`apps/web/app/js/market.js` + cron do Worker (a cada 15 min verifica; índices a cada 6 h, cotações a cada 4 h, até 20 ativos por execução).

- Índices do Banco Central (SGS): CDI diário (12), CDI anualizado (4389), Selic meta (432), IPCA mensal (433) → Selic, CDI 12 meses e no ano, IPCA 12 meses.
- Cotações de fechamento: Yahoo Finance (gratuito, sem chave); reserva opcional brapi.dev com o secret `BRAPI_TOKEN`.
- A carteira usa a cotação quando ela é mais nova que a posição importada; sem posição da B3, as negociações formam as posições.
- Rota pública de verificação: `GET /v1/market/indices`. O dono pode forçar: `POST /v1/market/refresh`.

## M6 — Radar de alertas e simulador sobre os dados reais

- `alert_engine.js`: DARF vencido ou a vencer (15 dias), venda sem custo, vendas de ações perto do limite de R$ 20 mil no mês,
  limite ultrapassado, prejuízo a compensar, classe inferida, reserva curta, gasto acima do normal, assinaturas, saídas maiores
  que entradas, concentração e posições sem preço médio. Status (novo/visto/resolvido) salvo por cliente; Free vê 3 alertas.
  Rotas: `GET /v1/alerts`, `PATCH /v1/alerts/{id}`. O painel inicial passa a contar os alertas reais.
- `sim_engine.js`: venda hipotética recalcula a apuração do ano e compara com o cenário atual (imposto, mês afetado, DARF,
  liquidez); posição da B3 sem negociações usa o valor aplicado como custo. PGBL: dedução até 12%.
  Rotas: `POST/GET /v1/simulations` (planos Pro e Premium).
- Datas do servidor no horário de Brasília. Cotação que falhou nunca zera uma posição.

## M5 — Open Finance via agregador (Pluggy)

Pronto e testado contra um simulador da API da Pluggy (`worker/test/fake_pluggy.mjs`). Liga sozinho quando os secrets existem.

- Fluxo: o cliente clica em **Conectar banco ou corretora** → a API gera um *connect token* (`POST /v1/openfinance/connect-token`,
  `clientUserId` = id do cliente) → o widget da Pluggy abre e o cliente autoriza no ambiente da instituição → o site registra o item
  (`POST /v1/openfinance/items`), a API confere que o item pertence ao cliente e baixa contas, 12 meses de lançamentos e investimentos.
- `openfinance.js` converte para os mesmos registros da importação; cada conexão grava com `import_id = of_<item>` e é substituída
  inteira a cada sincronização (sem duplicar).
- Atualização: webhook `POST /v1/webhooks/pluggy` (a URL vai no connect token, com `?token=` se `PLUGGY_WEBHOOK_TOKEN` existir) e,
  como rede de segurança, o cron sincroniza até 2 conexões por execução com mais de 20 h.
- Rotas: `GET /v1/openfinance`, `POST /v1/openfinance/items/{id}/sync`, `DELETE /v1/openfinance/items/{id}` (apaga na Pluggy e os dados aqui).
- Sem os secrets, a tela Conexões explica que a conexão automática está em ativação e leva para Importar dados.

### Como ativar
1. Criar a conta da empresa em dashboard.pluggy.ai e pegar **Client ID** e **Client Secret** (começa no ambiente de testes).
2. Cloudflare → Workers → aurion-api → Settings → Variables and Secrets → adicionar como **Secret**:
   `PLUGGY_CLIENT_ID`, `PLUGGY_CLIENT_SECRET` e, opcional, `PLUGGY_WEBHOOK_TOKEN` (qualquer texto longo aleatório).
3. Para testar com as instituições de teste da Pluggy, adicionar a variável `PLUGGY_SANDBOX = 1`; remover ao ir para produção.
4. Produção com bancos reais exige o contrato comercial com a Pluggy.
