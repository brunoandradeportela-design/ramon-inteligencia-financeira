# Análise dos documentos de referência

Fontes analisadas:

1. **Dossiê de Execução v2.0** — *Sistema de Inteligência Financeira e Tributária* (27/09/2026), 65 seções.
2. **Plano Técnico de Backend, IA, Conectores e Execução v1.0** — *Ramon Inteligência Financeira* (handoff para desenvolvimento).
3. **Imagem aprovada** — landing page "Fintechs" 1024 × 1536 px (referência visual de produção).

## 1. O que o produto é (e o que não é)

| Dimensão | Definição extraída | Onde foi aplicada |
|---|---|---|
| Núcleo | consolidar → analisar → simular → alertar → explicar | Arquitetura de serviços (`services/`) |
| Regra de ouro | **IA interpreta; motores determinísticos calculam** | `ai_orchestrator` só lê resultados de tools; checagem de consistência bloqueia números sem evidência |
| Fronteira regulatória | Sem recomendação individualizada de compra/venda (CVM Res. 19), sem carteira recomendada, sem ordens/trading | Guardrail no classificador de intenção, textos da UI, testes `test_recomendacao_individual_bloqueada` |
| Público inicial | PF com investimentos e vida financeira complexa | Dados de demonstração (renda variável, previdência, múltiplas instituições) |
| Monetização | Free R$ 0 · Pro R$ 24,90 · Premium R$ 59,90 (hipóteses em teste) | `services/billing/plans.py` com entitlements; preços marcados `hipotese_em_teste` |
| Data Hub | Open Finance / Open Investment como camada nativa de entrada, com consentimento de primeira classe | `connectors/`, `services/consent`, `services/ingestion`, tela Conexões |
| Tema | Claro, Escuro e Sistema; troca não altera cálculo (RN-12) | Tokens CSS, `ThemeProvider` em `app.js`, `PUT /v1/theme-preference`, teste `test_tema_nao_altera_calculo` |

## 2. Requisitos convertidos em implementação

### Requisitos funcionais (Dossiê §11)

| RF | Implementação |
|---|---|
| RF-001/002 Cadastro e onboarding | `POST /v1/auth/register`; cadastro em 3 etapas (conta, objetivos, perfil mínimo) |
| RF-003 Entrada manual e arquivos | `POST /v1/portfolio/trades`, `POST /v1/documents` (CSV importado automaticamente) |
| RF-004/005/006 Contas, transações, categorias | `DataHub.add_transactions`, categorização por regras (`financial_engine.categorize`) |
| RF-007/008 Investimentos e patrimônio | `PortfolioEngine.consolidate` (preço médio, alocação, concentração HHI, liquidez, custódia) |
| RF-009/010/011 Tributação versionada e determinística | `TaxEngine` + `rules/br_irpf_2026.json` (código, versão, vigência, fonte, fórmula, exceções, testes) |
| RF-012 Explicabilidade | Cada evento e mês expõem regra/versão, fonte, premissas, confiança; aba "Regras e fontes" |
| RF-013 Simulação | `SimulationEngine` (venda de ativos e PGBL) com hash de reprodutibilidade |
| RF-014 Alertas | `AlertEngine` com prioridade = impacto × urgência × relevância × confiança |
| RF-015/016 IA e barreira | `AIOrchestrator` + guardrails (recomendação, prompt injection, pedido de credencial) |
| RF-017 Documentos | Validação de extensão, MIME, assinatura binária, tamanho, PDF com conteúdo ativo |
| RF-018 Consentimento | Criação, confirmação, expiração, revogação e histórico |
| RF-019 Auditoria | Log append-only encadeado por hash (`verify_chain`) |
| RF-020 Relatórios | Exportação LGPD (`/v1/privacy/export`); relatório PDF fica para P1 |

### Regras de negócio

RN-01 a RN-14 estão cobertas; destaque para RN-05 (dados incompletos reduzem confiança — venda sem custo derruba a confiança para 55% e gera alerta), RN-06 (histórico imutável), RN-11 (origem e última atualização em cada dado: `Lineage`), RN-13 (alertas críticos distinguíveis nos dois temas: cor + ícone + rótulo).

## 3. Motor tributário — regras modeladas

| Código | Status | Conteúdo |
|---|---|---|
| BR-IRPF-RV-COMUM 2026.1 | validada | 15%, isenção de vendas de ações ≤ R$ 20.000/mês, IRRF 0,005%, DARF 6015, mínimo R$ 10, compensação de prejuízo na mesma modalidade |
| BR-IRPF-RV-DAYTRADE 2026.1 | validada | 20%, IRRF 1% do ganho, prejuízo só compensa day trade |
| BR-IRPF-FII 2026.1 | validada | 20% no ganho de alienação de cotas |
| BR-IRPF-PGBL-DEDUCAO 2026.1 | validada | dedução até 12% dos rendimentos tributáveis, modelo completo, VGBL não dedutível |
| BR-IRPF-TABELA-ANUAL 2026.0-draft | **pendente** | não entra em cálculo (o Dossiê exige fonte vigente antes de uso) |

Premissa marcada explicitamente como *a confirmar*: compensação de prejuízo apurado em mês de vendas isentas (parâmetro `compensar_prejuizo_mes_isento`). **Todas as regras precisam da revisão de um contador habilitado antes de produção** (Gate 3 — Confiança).

## 4. Referência visual — leitura pixel a pixel

A arte tem 1024 px de largura. A landing foi construída num "palco" de 1024 px com as medidas exatas da arte e escalada proporcionalmente (`zoom`) para qualquer largura de desktop; abaixo de 760 px vira layout responsivo empilhado.

| Seção | Faixa vertical (px) | Elementos |
|---|---|---|
| Hero | 0–605 | logo metálico, menu (Produto, Soluções, Planos, Conteúdo, Sobre), Entrar, CTA com brilho; eyebrow, H1 em 3 linhas com "decisões." em azul, subtítulo, 2 CTAs, 3 selos; notebook sobre rocha com cidade noturna |
| Selos | 605–705 | Open Finance · CVM · LGPD · "Tecnologia a favor da sua tranquilidade." |
| Visão | 705–1033 | título, texto, link, globo com órbitas, 5 cartões de recursos |
| Planos | 1033–1334 | painel arredondado, Free / Pro (destacado, selo "Mais escolhido") / Premium |
| CTA | 1334–1468 | "Conecte sua vida financeira…", botão "Começar gratuitamente", nota |
| Rodapé | 1468–1536 | logo, tagline, links, copyright |

Paleta medida na imagem: fundo `#000B16`, painel `#020E18`, cartões `#081624`, azul do botão `#0B63F0 → #2F86FF`, azul do destaque `#33A3F7`. Os elementos fotográficos (notebook/cidade e globo) foram recortados da própria arte aprovada e tratados (máscara alfa, remoção do menu por inpainting); textos, botões, cartões e ícones são HTML/CSS/SVG reais e acessíveis. A comparação por sobreposição (`docs/visual-check/`) mostra alinhamento de ±2 px nos blocos principais.

## 5. Decisões pendentes (não inventadas silenciosamente)

Ver [DECISOES-PENDENTES.md](DECISOES-PENDENTES.md). Resumo: provedor Open Finance (D-01), matriz real de instituições (D-02), base legal/retenção (D-03), regras produtivas e tabela anual (D-04), provedor de LLM (D-05), gateway de cobrança (D-06), feriados no vencimento do DARF (D-07), cloud/RTO/RPO (D-08), piloto B2B2C (D-09).

## 6. Divergências e ajustes de engenharia

* O Plano Técnico cita "Ramon" e a imagem cita "Fintechs": a marca visual segue a imagem; o nome técnico do repositório segue o Plano. Nome comercial continua não definitivo (Dossiê §32).
* O card "Impostos estimados (ano) R$ 98.430,00" do mockup inclui tributos que o MVP não calcula (a tabela anual está pendente). No app, o card mostra somente o imposto estimado sobre renda variável, com o escopo explícito.
* Persistência: o MVP roda com repositório em memória (mesmo contrato do schema PostgreSQL entregue em `database/migrations`), para permitir demo sem infraestrutura. Ver ADR-0002.
