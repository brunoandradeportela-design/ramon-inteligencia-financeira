# QA de release — AURION v5.0/v6.0 na base atual

Data: 06/10/2026. Base: Cloudflare Worker `aurion-api` com D1, mais o site no GitHub Pages. O desvio de stack está registrado na ADR-0005.

Como reproduzir:
- **Unitários e compliance:** `cd worker && npm test`.
- **Python:** `pytest` na raiz (motores, golden tax e coletores públicos).
- **E2E:** são as 9 suítes de `worker/test/*_e2e.mjs`, rodadas contra o `wrangler dev --local` com simuladores. A lista exata está em `.github/workflows/ci.yml`.

## Critérios de aceitação (Engenharia v6.0 §34)

| Critério | Situação | Evidência |
|---|---|---|
| Criar conta, recuperar acesso, MFA e sessões | ✅ | `identity_e2e`: e-mail/CPF, recuperação de uso único, MFA TOTP com códigos de recuperação, sessões revogáveis |
| Conexão externa sem guardar credencial bancária | ✅ | `openfinance_e2e` (Pluggy, simulado): a autenticação ocorre no ambiente da instituição; só o id do item é guardado |
| Transação rastreável até a origem e as transformações | ✅ | `connect_finance_e2e`: rota `/v1/finance/transactions/:id/lineage`, com payload bruto preservado (`raw_ref`) |
| Alteração manual não apaga o original | ✅ | `connect_finance_e2e`: override versionado com `original_category` e motivo |
| TaxCalculation reproduzível (snapshot + regra + motor) | ✅ | `tax_e2e` e `tax_regression.test.mjs`: `/verify` recalcula e compara o hash |
| Trade gera analytics e TaxEvent sem ordem à corretora | ✅ | `trader_e2e`: Trade-to-Tax; não existe rota de ordem |
| Backtest reproduzível | ✅ | `trader_e2e` e `trader_events.test.mjs`: mesma chave e mesmo resultado; `/reproduce` |
| Public Disclosure com fonte e data, não tratada como informação privilegiada | ✅ | `test_public_data.py`: protocolo, link CVM e data; aviso explícito na tela |
| Copilot bloqueia recomendação individualizada | ✅ | `docs_assistant_e2e` e `assistant_docs.test.mjs` (guardrails) |
| Nenhum módulo executa submit/cancel/replace order | ✅ | `compliance.test.mjs` varre o código; `trader_e2e` confirma 404 em `/orders` |
| Usuário A não lê dados do B | ✅ | Testes de isolamento em todas as suítes E2E; `hub_e2e` cobre terceiro sem concessão (403) |
| Logs e auditoria permitem investigar | ✅ | Trilha encadeada por hash (`/v1/audit`), `X-Correlation-ID` e observabilidade do Workers ligada |

## Checklist de pré-produção (Prompt Mestre v5.0 §41)

| # | Item | Situação |
|---|---|---|
| 1–3 | Autenticação, MFA, recuperação | ✅ `identity_e2e` |
| 4 | Isolamento de tenant | ✅ Todas as E2E, mais leitura delegada só com concessão ativa |
| 5 | Consentimento e revogação | ✅ `connect_finance_e2e` (Open Finance) e `hub_e2e` (compartilhamento) |
| 6 | Adaptadores Open Finance | ✅ Pluggy simulado; real liga com `PLUGGY_CLIENT_ID/SECRET` |
| 7 | Normalização e reconciliação | ✅ `data_alloc.test.mjs`, `connect_finance_e2e` |
| 8–9 | Regras fiscais, regressão e reprodutibilidade | ✅ `tax_regression.test.mjs`, `tax_e2e`; validação cruzada JS×Python |
| 10 | Excel de auditoria | ✅ 8 abas com fórmulas; conferido no LibreOffice (coluna "Confere" = ok) |
| 11 | Trader Intelligence | ✅ `trader_e2e` |
| 12 | Divulgações públicas | ✅ Coleta real da CVM pelo GitHub Actions (IPE + FCA); teste offline |
| 13 | Notícias e fontes | ✅ 6 feeds oficiais ativos (Agência Brasil, Banco Central e Copom, CVM, Receita por pasta de ano/mês); só título e link; fonte sem publicação recente sinalizada |
| 14 | Guardrails de IA | ✅ Injeção, credencial, recomendação; intents de Trader e Eventos |
| 15 | Sem execução de ordens | ✅ `compliance.test.mjs` |
| 16 | Sem recomendação individualizada | ✅ Guardrails, avisos em Daily, Radar Trader e backtest; testes verificam o texto |
| 17 | Sem uso de informação privilegiada | ✅ Só fontes públicas; aviso na tela de divulgações |
| 18 | Acessibilidade | ✅ Rótulos ARIA, alternativa textual em gráficos, foco no conteúdo; sem rolagem horizontal a 390 px |
| 19 | Temas | ✅ Visual "vidro" futurista (barra superior em pílula, cartões translúcidos, gráficos 3D, busca ⌘K). Claro é o padrão; Escuro e Sistema conferidos por captura de tela em desktop e celular (390 px, sem rolagem horizontal) |
| 20 | Backup e restauração | ✅ `backup_e2e` em todo CI: backup criptografado, ambiente vazio restaurado, login, mesmo hash de cálculo, documento binário idêntico e auditoria íntegra. Em produção: D1 Time Travel e rotina semanal criptografada (liga com segredos). Ver `docs/BACKUP-RESTAURACAO.md` |
| 21 | Observabilidade | ✅ Painel **Operações** do administrador: requisições, disponibilidade e p95 contra os SLOs (§26), latência e erros por rota, saúde dos jobs e eventos de segurança, IA, Tax e Trader. Métricas sem dados pessoais (`ops_e2e`). Também: `[observability] enabled`, `X-Correlation-ID` e trilha de auditoria |
| 22 | Resultado e riscos | Este documento |

## Integrações prontas e desligadas (ligam ao cadastrar o segredo no Cloudflare)

| Integração | Segredos | Sem segredo |
|---|---|---|
| Pagamentos Asaas | `ASAAS_API_KEY`, `ASAAS_WEBHOOK_TOKEN` | Planos sem cobrança automática |
| Open Finance Pluggy | `PLUGGY_CLIENT_ID`, `PLUGGY_CLIENT_SECRET` | Importação de arquivos |
| E-mail Resend | `RESEND_API_KEY`, `MAIL_FROM` | Avisos só no app; recuperação sem e-mail. Com chave: alertas e AURION Daily automáticos (cron, um de cada por dia, de manhã) — `mail_e2e` |
| Backup semanal | Cloudflare `BACKUP_TOKEN`; GitHub `AURION_BACKUP_TOKEN`, `AURION_BACKUP_PASSPHRASE` | Só D1 Time Travel |
| Voz neural (Google TTS) | `TTS_API_KEY` (opcional `TTS_VOICE`) | Voz do navegador |
| Power BI Embedded | `PBI_TENANT_ID`, `PBI_CLIENT_ID`, `PBI_CLIENT_SECRET`, `PBI_WORKSPACE_ID`, `PBI_REPORT_ID`, `PBI_DATASET_ID` (opcional `PBI_RLS_ROLE`) | Gráficos próprios |
| Notícias licenciadas | `NEWS_API_KEY` (adaptador a escolher com o contrato) | RSS públicos |
| DARF com código de barras (Integra Contador/SERPRO, serviço SICALC) | `SERPRO_CONSUMER_KEY`, `SERPRO_CONSUMER_SECRET`, `SERPRO_CONTRATANTE_CNPJ`, certificado e-CNPJ no binding mTLS `SERPRO_CERT` (opcional `SERPRO_UF_PADRAO`, `SERPRO_MUNICIPIO_PADRAO`). Para PF, o cliente dá procuração no e-CAC ao CNPJ contratante | DARF completo sem código de barras (internet banking) e atalho para o Sicalc |

## Riscos e pendências

### Resolvidos em 06/10/2026
- **E-mails automáticos.** O cron do Worker envia em lotes pequenos, só para quem ativou. Usa o retrato salvo quando o cliente abriu o app; sem ele, calcula só os prazos.
- **Feeds de notícias.** CVM e Receita passaram a ser lidas pelas pastas de ano e mês, porque o RSS da raiz só trazia itens antigos. O Banco Central entrou pelos feeds de notícias e do Copom. A escolha foi validada por uma sonda que roda no GitHub.
- **Backup e restauração.** O ensaio automatizado roda a cada envio de código.
- **Desempenho do Tax Engine.** Ficou cerca de 2,5 vezes mais rápido, com o mesmo resultado e o mesmo hash de reprodutibilidade.
  - 1.000 negociações: cerca de 4 ms, contra 10,6 ms antes.
  - 3.000 negociações: cerca de 10 ms, contra 25 ms antes.
- **Imagem da página inicial.** Já mostra a marca AURION.

- **RF-018, extração de documentos.**
  - Notas de corretagem, DARF, informes e recibos em PDF com texto agora são lidos e validados.
  - A nota só é importada depois da conferência do cliente.
  - Testes: `doc_extract.test.mjs`, `docextract_e2e` e um teste com PDF real lido pelo pdf.js no navegador.

- **Segurança (§24).**
  - Limite de requisições por IP e grupo de rota, com resposta 429.
  - Aviso de acesso de aparelho novo no sino, na auditoria e por e-mail (`security_e2e`).
  - Plano de incidentes em `docs/INCIDENTES.md`.
- **Observabilidade (§25–26).** Painel Operações com os SLOs (`ops_e2e`).

- **Copilot com base de conhecimento governada (§20).**
  - Responde perguntas conceituais com citação da regra, da versão e da vigência, com link oficial.
  - Fora da base, diz que não encontrou em vez de inventar (ADR-0018).
- **Relatório de apoio à declaração (IRPF).**
  - Renda variável mês a mês, ganhos isentos e prejuízo a compensar.
  - Bens e direitos pelo custo em 31/12, com Excel; disponível também para o contador no acesso somente leitura.

- **Guias de pagamento (DARF e DARE), 07/10/2026.**
  - DARF com os 10 campos, código de receita (15 códigos PF, PJ e retenções), CPF/CNPJ validados, vencimento legal no calendário bancário (feriados nacionais, Carnaval, Sexta-feira Santa e Corpus Christi).
  - Em atraso: multa de 0,33% ao dia até 20% e juros Selic acumulada mais 1% no mês do pagamento (Lei 9.430/96, art. 61). Abaixo de R$ 10,00 não gera guia e soma ao período seguinte (art. 68).
  - DARF 6015 gerado direto da apuração mensal; CPF conferido com o da conta; documento cifrado no banco e mascarado nas listas; tudo na auditoria.
  - DARE: tabela de códigos de Rondônia (SEFIN-RO) e código informado para as demais UFs; o código de barras do DARE é emitido no portal da SEFAZ.
  - Testes: `guias.test.mjs` e `guias_e2e`. Selic mensal (SGS 4390) coletada pela API e publicada em `data/public/selic.json`.
  - Integração: alertas, próximas ações, agenda e Radar Trader abrem a guia já preenchida (botão "Gerar DARF"). O assistente responde código por assunto, valor do DARF em aberto com multa e juros para pagamento hoje e DARE, citando a Lei 9.430/96 e o Sicalc.
  - Passo a passo para ligar o código de barras pelo SERPRO: `docs/INTEGRA-CONTADOR.md`.

### Ainda abertos
- **Código de barras do DARF pela API.** Depende do contrato do Integra Contador (SERPRO) e do certificado e-CNPJ; até lá, o código de barras é gerado no Sicalc com os mesmos dados.
- **Tabelas de DARE de outros estados.** Só Rondônia está cadastrada; nos outros estados o código é informado pelo usuário.
- **Limite de requisições global.** O limitador atual conta por instância do Worker; o limite global entre regiões exige o Rate Limiting do Cloudflare no plano pago.
- **OCR de documentos escaneados (imagem).** Ainda não é feito; depende de provedor ou plano pago.
- **Limite de CPU do plano gratuito do Workers (10 ms).** Contas com mais de cerca de 2.000 negociações ficam no limite. A solução definitiva é o Workers Paid (5 dólares por mês, até 30 s de CPU), sem mudança de código.
- **Escala dos e-mails.** O lote atual atende até cerca de 140 clientes por manhã (6 por rodada, a cada 15 minutos, das 7h às 13h). Acima disso, é preciso o Workers Paid ou o Cloudflare Queues.
- **Chave Asaas antiga.** Revogar no painel do Asaas e gerar outra; só o Bruno pode fazer isso.
- **Projeto antigo "ramon-inteligencia-financeira" no Cloudflare.** O build dele falha a cada envio de código. Desconectar o repositório ou excluir o projeto no painel; não afeta o `aurion-api`.
