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

Próximos módulos: M3 (cotações e índices diários), M4 (imposto sobre dados reais), M5 (Open Finance via agregador, mesmo formato de registros).
