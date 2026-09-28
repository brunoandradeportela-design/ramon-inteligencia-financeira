# Decisões pendentes antes de produção

Registradas conforme o Dossiê §35 ("não invente silenciosamente"). Cada item traz opções com prós e contras.

| ID | Decisão | Opções | Prós / contras | Impacto no código |
|---|---|---|---|---|
| D-01 | Provedor/estrutura regulatória de Open Finance | (a) Iniciador/agregador parceiro (ex.: Pluggy, Belvo, Celcoin); (b) Participação direta como instituição receptora | (a) rápido, custo por conexão, dependência de terceiro; (b) controle total, exige autorização BCB e alto custo | Novo adaptador implementando `ConnectorAdapter`; o sandbox atual fica para testes |
| D-02 | Matriz real de instituições prioritárias | começar pelas 5 maiores corretoras + 3 bancos digitais | define cobertura do MVP | `COVERAGE_MATRIX` versionada |
| D-03 | Base legal, retenção e eliminação (LGPD) | consentimento + execução de contrato; retenção de auditoria 5 anos | exige parecer jurídico | `purge_owner(keep=...)`, políticas de storage |
| D-04 | Regras tributárias da primeira versão produtiva | RV comum/day trade/FII/PGBL (prontas) + tabela anual 2026 (pendente) | a tabela anual exige transcrição da fonte vigente e golden tests | `rules/*.json` |
| D-05 | Provedor de LLM, política de dados e custos | (a) só templates determinísticos; (b) LLM para redação com checagem de consistência | (b) mais natural, custo por consulta e revisão de política de dados | `AnthropicProvider` já isolado atrás de `RAMON_LLM_ENABLED` |
| D-06 | Gateway de cobrança | **RESOLVIDA (28/09/2026): Asaas** | — | `services/billing/asaas.py`, `gateway.py` · [guia](PAGAMENTOS-ASAAS.md) |
| D-07 | Calendário de feriados no vencimento do DARF | tabela de feriados nacionais versionada | hoje usa último dia útil seg–sex | `last_business_day` |
| D-08 | Cloud, região, RTO/RPO, DR | AWS sa-east-1 / GCP southamerica-east1 | latência e residência de dados no Brasil | `infrastructure/` |
| D-09 | Piloto B2B2C e permissões do contador | escopo granular por cliente (RN-07) | canal de aquisição | novo papel `contador` + escopos |
