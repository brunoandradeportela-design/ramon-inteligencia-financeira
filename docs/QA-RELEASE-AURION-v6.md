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
| 13 | Notícias e fontes | ✅ RSS oficiais com só título e link; fonte indisponível sinalizada |
| 14 | Guardrails de IA | ✅ Injeção, credencial, recomendação; intents de Trader e Eventos |
| 15 | Sem execução de ordens | ✅ `compliance.test.mjs` |
| 16 | Sem recomendação individualizada | ✅ Guardrails, avisos em Daily, Radar Trader e backtest; testes verificam o texto |
| 17 | Sem uso de informação privilegiada | ✅ Só fontes públicas; aviso na tela de divulgações |
| 18 | Acessibilidade | ✅ Rótulos ARIA, alternativa textual em gráficos, foco no conteúdo; sem rolagem horizontal a 390 px |
| 19 | Temas | ✅ Claro, Escuro e Sistema conferidos por captura de tela |
| 20 | Backup e restauração | ⚠️ D1 Time Travel (restauração de ponto no tempo pelo painel ou `wrangler d1 time-travel`) e exportação LGPD por usuário. Falta um ensaio de restauração documentado em produção |
| 21 | Observabilidade | ✅ `[observability] enabled`, `X-Correlation-ID` em toda resposta, trilha de auditoria |
| 22 | Resultado e riscos | Este documento |

## Integrações prontas e desligadas (ligam ao cadastrar o segredo no Cloudflare)

| Integração | Segredos | Sem segredo |
|---|---|---|
| Pagamentos Asaas | `ASAAS_API_KEY`, `ASAAS_WEBHOOK_TOKEN` | Planos sem cobrança automática |
| Open Finance Pluggy | `PLUGGY_CLIENT_ID`, `PLUGGY_CLIENT_SECRET` | Importação de arquivos |
| E-mail Resend | `RESEND_API_KEY`, `MAIL_FROM` | Avisos só no app; recuperação sem e-mail |
| Voz neural (Google TTS) | `TTS_API_KEY` (opcional `TTS_VOICE`) | Voz do navegador |
| Power BI Embedded | `PBI_TENANT_ID`, `PBI_CLIENT_ID`, `PBI_CLIENT_SECRET`, `PBI_WORKSPACE_ID`, `PBI_REPORT_ID`, `PBI_DATASET_ID` (opcional `PBI_RLS_ROLE`) | Gráficos próprios |
| Notícias licenciadas | `NEWS_API_KEY` (adaptador a escolher com o contrato) | RSS públicos |

## Riscos e pendências

- **Limite de CPU do plano gratuito (10 ms por requisição).** Contas com muitos milhares de negociações podem estourar o limite na apuração. A mitigação é o plano Workers Paid ou mover a apuração para um job.
- **Envio automático de e-mails.** As preferências ficam salvas e o e-mail de teste funciona, mas o envio periódico ainda não está agendado. Depende do provedor e do limite de CPU do cron.
- **Ensaio de restauração.** Falta executar e registrar uma restauração D1 Time Travel em produção.
- **Imagem `hero-laptop.webp`.** Ainda mostra a marca antiga e precisa de uma nova arte.
- **Chave Asaas antiga.** Precisa ser revogada no painel do Asaas, porque foi exposta em conversa.
