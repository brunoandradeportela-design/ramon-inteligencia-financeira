# Tours guiados — relatório (todas as páginas do cliente)

**Data:** 08/10/2026
**Origem:** `docs/PROMPT-TOUR-TRIBUTACAO.md`
**Situação:** publicado. É uma mudança aditiva: a página continua igual para quem não abre o tour.

## 1. O que foi entregue

| Arquivo | Função |
|---|---|
| `apps/web/app/js/tour.js` | Motor genérico, sem bibliotecas externas |
| `apps/web/app/js/tour_tributacao.js` | Catálogo dos passos da página Tributação (versão `1`) |
| `apps/web/app/js/tour_explain.js` | Funções puras que geram as frases dos números, lidas dos dados da tela |
| `apps/web/app/css/tour.css` | Camada escura com destaque, balão, folha inferior no celular, progresso; usa os tokens de `glass.css` (claro e escuro) |
| `worker/test/tour_explain.test.mjs` | 13 testes unitários, no `npm test` |
| Âncoras `data-tour` | `views.js` (página Tributação), `views_tax2.js`, `views_guias.js` e a barra superior em `app.js`. Não mudam a aparência nem o comportamento |

### Como abrir
- Botão **"? Tour da página"** no cabeçalho da Tributação.
- **Busca (Ctrl K / ⌘K):** comando "Fazer o tour desta página". Aparece em primeiro lugar quando a página tem tour.
- **Pela URL:** `#/tributacao?tour=1`.
- **Primeira visita:** convite discreto no canto, com "Começar" e "Agora não". Nunca abre sozinho, e "Agora não" fica gravado.
  - Se o usuário parou no meio, o convite oferece "Continuar de onde parei" ou "Recomeçar".
- **Persistência:** `localStorage["aurion.tour.tributacao"]` guarda versão, concluído, pulado, recusado e último passo, sempre dentro de `try/catch`.
  - Mudar `TOUR_TRIBUTACAO_VERSAO` oferece o tour de novo.

### No balão
- **Blocos fixos:** Por que existe · O que faz · O que representa · **Por que este número** (este em destaque).
- **Botões:** "← Anterior", "Próximo →" ou "Concluir", "Índice" (passos agrupados por seção, com salto direto), "Ver de novo depois", "Pular tour" e ×.
- **Progresso:** "Passo 11 de 36" e uma barra.
- **Teclado:**
  - → e Enter avançam, ← volta, Esc fecha;
  - o foco fica preso no balão e volta ao elemento de origem ao sair;
  - `role="dialog"`, `aria-modal`, `aria-labelledby` e anúncio por `aria-live`.
- **Proteções:**
  - a camada bloqueia cliques na página, então o tour **não aciona nenhum botão**;
  - só os links de ação sugeridos (ex.: "Importar negociações") navegam, e eles fecham o tour.
- **Comportamento da página:**
  - troca de aba automática;
  - espera o elemento aparecer;
  - pula passos cujo elemento não existe naquela conta.
- **Celular (até 760 px):** o balão vira folha fixa embaixo, e o elemento sobe para a metade de cima, descontando a barra fixa.
- **Movimento reduzido** (do sistema ou do modo calmo): sem animação.

## 2. Passos (36 com dados reais; 30 no modo demonstração)

Cada passo de número usa os dados reais da conta, lidos de `/v1/tax/summary`, `/v1/tax/events` e `/v1/tax/rules`. As alíquotas, o limite de isenção, o mínimo do DARF e as retenções vêm dos parâmetros das regras.

| # | Seção | Passo | Aparece quando | Número explicado com dados |
|---|---|---|---|---|
| 1 | Abertura | Boas-vindas | sempre | ano e data de referência |
| 2 | Abertura | Menu | sempre (pílula no computador, ☰ no celular) | — |
| 3 | Abertura | Logotipo | sempre | — |
| 4 | Abertura | Tema | sempre | — |
| 5 | Abertura | Avisos (sino) | sempre | guia vencida ou a mais próxima do vencimento |
| 6 | Abertura | Sua conta | sempre | — |
| 7 | Avisos | Exemplo ilustrativo | `t.sample` | — |
| 8 | Avisos | Faltam compras no histórico | conta real com venda sem compra | vendas afetadas: ativo, data e valor |
| 9 | Resumo | Imposto estimado | sempre | soma das guias por mês e situação, alíquotas, mínimo; motivo quando é zero |
| 10 | Resumo | IRRF (dedo-duro) | sempre | total, valor de cada mês, percentuais da regra, meses abatidos e meses que viraram crédito |
| 11 | Resumo | Ganhos isentos | sempre | total, meses isentos com vendas e lucro, limite da regra |
| 12 | Resumo | **Qualidade do cálculo** | sempre | percentual, fator limitante, vendas e mês afetados, "para elevar" |
| 13 | Resumo | Prejuízos a compensar | sempre | saldos por modalidade |
| 14 | Abas | Quatro visões | sempre | — |
| 15 | Apuração mensal | Tabela | sempre | quantidade de meses |
| 16 | Apuração mensal | Mês e vendas de ações | sempre | mês com mais vendas |
| 17 | Apuração mensal | Isenção | sempre | limite da regra e o mês de exemplo |
| 18 | Apuração mensal | Resultado comum, day trade e FII | sempre | — |
| 19 | Apuração mensal | IR bruto e IRRF | sempre | — |
| 20 | Apuração mensal | DARF 6015 | sempre | mínimo da regra para "acumula" |
| 21 | Apuração mensal | Lendo uma linha | há meses | linha completa do mês com mais vendas |
| 22 | Apuração mensal | Marcar pago / desfazer | conta real com guia | — |
| 23 | Apuração mensal | Gerar DARF | há guia não paga | — |
| 24 | Guias | DARF ou DARE | sempre | — |
| 25 | Guias | Dados da guia | sempre | — |
| 26 | Guias | Vencimento, multa e juros | sempre | regra de acréscimos legais |
| 27 | Guias | Guias geradas | sempre | — |
| 28 | Eventos | Cada venda vira um evento | há eventos | o evento mais recente |
| 29 | Eventos | Situação e confiança do evento | há venda pendente | o evento pendente e a sua confiança |
| 30 | Regras | Regras e fontes | sempre | número de regras e versão do catálogo |
| 31 | Base do cálculo | Premissas | sempre | número de premissas |
| 32 | Base do cálculo | Limitações e snapshot | sempre | impressão das entradas |
| 33 | Base do cálculo | Qualidade — detalhe | conta real | igual ao passo 12 |
| 34 | Base do cálculo | Auditoria do cálculo | conta real | — |
| 35 | Base do cálculo | Relatório para a declaração | conta real | — |
| 36 | Base do cálculo | Ajustes da apuração | conta real | — |
| 37 | Encerramento | Seus pontos de atenção | sempre | até 3 pendências: DARF vencido, DARF a vencer em até 10 dias, confiança abaixo de 100% com as vendas sem compra. Cada uma com link |

São 37 passos no catálogo. Os que não se aplicam saem da contagem, por isso a conta real mostra "de 36" e a demonstração mostra "de 30".

**Exemplo real da conta de teste**, com uma venda de VALE3 sem compra:
> "Está em 55% porque 1 venda de 2026 não tem a compra registrada (VALE3 vendido em 04/05/2026 por R$ 6.200,00) — sem a compra, o preço médio é desconhecido e o lucro dessa venda fica fora do cálculo. Mês afetado: mai/2026. O índice é o menor valor entre os meses, não a média (venda sem custo limita a 55%). Para elevar: Importe o relatório de Negociação da B3 desde a primeira compra."

## 3. Capturas

| Tela | Arquivo |
|---|---|
| Qualidade do cálculo, 1440 px, tema claro | `docs/visual-check/tour/qualidade-1440.png` |
| Qualidade do cálculo, 390 px (folha inferior) | `docs/visual-check/tour/qualidade-390.png` |
| Resumo final (modo demonstração) | `docs/visual-check/tour/resumo-final-1440.png` |

## 4. Testes executados

**Unitários: 13 testes, todos aprovados**
- **Confiança:**
  - 55% cita o ativo, a data, o mês e "Importe o relatório de Negociação";
  - 80% cita a posição da B3;
  - 50% cita a nota da regra;
  - 100% não sugere ação.
- **Imposto zero:** três motivos, com três frases diferentes.
- **Isenção pela regra `<=`:** R$ 19.999,99 sai isento e R$ 20.000,01 sai tributável.
- **Valores pequenos:** DARF abaixo de R$ 10 "acumula para o mês seguinte".
- **Demonstração:** todas as frases começam com "Exemplo ilustrativo".
- **Resumo final:** limite de 3 pendências, com o DARF vencido primeiro.
- **Nenhum número inventado:** todo número das frases existe nos dados ou é uma contagem.
- **Catálogo:** ids únicos, cerca de 30 passos e blocos curtos.

**Interface (Playwright, API local, conta com venda sem compra)**
- **Abertura:** pelo botão, pela busca Ctrl K e por `?tour=1`.
- **Navegação:**
  - os 36 passos percorridos só com o teclado;
  - → → ← funciona;
  - o Índice pula direto para "Qualidade do cálculo".
- **Fechamento:** Esc fecha e devolve o foco ao botão.
- **Convite:** aparece na primeira visita e some depois de "Agora não".
- **Persistência:** gravada no navegador.
- **Proteções:**
  - clique fora do balão não aciona a página;
  - **nenhuma requisição de escrita** à API durante o tour (só GET).
- **Telas:**
  - troca automática de abas;
  - o destaque fica exatamente sobre o cartão;
  - o balão nunca sai da tela em 1440, 900 e 390 px;
  - folha inferior no celular;
  - movimento reduzido sem animação;
  - tema claro e escuro.
- **Fora da Tributação:** o botão do tour some.
- **Console:** sem nenhum erro em todas as execuções.

**Regressão**
- 87 testes unitários.
- pytest e ruff.
- Sintaxe de todos os módulos.
- **As 17 suítes ponta a ponta aprovadas.**

## 5. Divergências entre o roteiro e o código (o código prevaleceu)

1. **Logotipo:** o roteiro dizia "volta à Visão Geral", mas no código o logotipo abre a página inicial do site (`../index.html`). A frase segue o código.
2. **IRRF "quanto foi compensado":** o servidor não devolve o valor compensado em cada mês, porque o crédito passa de um mês para outro dentro do motor. A frase informa em quais meses a retenção foi abatida e em quais virou crédito, sem calcular um valor por fora (o tour explica, não refaz).
3. **Confiança sem `quality`:** o resumo da demonstração não traz `t.quality`. Nesse caso, os fatores são deduzidos das mesmas fontes que o motor usa: limitações e eventos pendentes. Os textos "para elevar" são os mesmos do motor.
4. **Botão do tour:** fica logo abaixo do subtítulo da página, não na mesma linha do título. O cabeçalho da casca não tem espaço ao lado do título no celular.
5. **Sino:** o número de avisos não lidos vem de outra rota (`/v1/notifications`), que a página Tributação não carrega. O passo cita a guia mais urgente, a partir dos dados de impostos.
6. **"Exemplo ilustrativo":** o modo demonstração não marca `t.sample`, então o passo 7 só aparece em contas reais sem dados. A demonstração é sinalizada pelo selo no topo de cada passo.

## 6. Limitações

- **Resolvido em 09/10/2026:** o passo "Resultado: vencimento, multa e juros" agora lê a guia exibida na aba Guias (dias de atraso, multa, juros, total e data válida para pagamento). Sem guia aberta, ele cita a mais recente da lista. A leitura é feita pela função `guiasEstado()`, somente leitura, em `views_guias.js`.
- **Resolvido em 10/10/2026:** todas as páginas do cliente têm tour (ver seção 9).
- **Trader Intelligence:** o tour cobre a aba Visão Trader. As outras 13 abas são explicadas no passo "Áreas do Trader", porque cada aba é uma rota própria.
- **Modo demonstração** (endereço sem a API): Notícias, Trader, Importar e Conexões mostram só um aviso nesse modo e não têm tour.

## 7. Como adicionar o tour a outra página

1. Marque os elementos com `data-tour="nome"`, sem mudar o visual.
2. Crie `tour_<pagina>.js` exportando `steps<Pagina>()`, no mesmo formato. Um passo tem `id`, `secao`, `target` (texto ou função), `tab`, `when`, `titulo`, `porque`, `faz`, `representa`, `numero` e `acao`. O passo final usa `final: ctx => ({ intro, itens, vazio })`.
3. Coloque as frases com números em funções puras, como em `tour_explain.js`, e teste-as.
4. No final da função da página, chame:
   ```js
   registerTour("pagina", VERSAO, stepsPagina(), ctx, { autostart: r.params.get("tour") === "1" })
   ```
   O `ctx` deve conter os dados e, se a página tiver abas, `getTab` e `setTab`.
5. O botão, a busca, o convite e a persistência passam a funcionar sozinhos. O roteador limpa o tour na troca de página.

## 8. Tours das outras páginas (09/10/2026)

O mesmo motor foi levado às páginas principais. Os catálogos estão em `apps/web/app/js/tour_paginas.js`. As frases com números ficam em `apps/web/app/js/tour_explain2.js`: são funções puras que repetem as fórmulas de `fin_engine.js` e `alert_engine.js`. Os testes estão em `worker/test/tour_paginas.test.mjs` (8 testes).

| Página | Passos | Números explicados com os dados reais |
|---|---|---|
| **Visão Geral** | 14 (inclui a barra superior) | Patrimônio total = investimentos + saldo em conta, com a curva estimada e a variação. Imposto do ano e barras por mês. Alertas abertos e prioritários. Peso de cada classe. Liquidez = saldo ÷ despesa média, em meses. Mudanças de gasto (≥ 30% e R$ 100). Próximas ações. Resumo final com pendências |
| **Patrimônio** | 9 a 10 | Soma das posições. Custo conhecido e cobertura. Resultado = valor − custo, em R$ e %. Liquidez em até D+2. Pesos por classe. Maior posição e HHI (limites 0,15 e 0,25). Posições sem custo |
| **Finanças** | 11 a 12 | Entradas e saídas, sem aplicações, resgates e fatura. Saldo e taxa de poupança = saldo ÷ entradas. Saldo das contas. Melhor e pior mês. Participação de cada categoria. Recorrências (3 ou mais meses, variação abaixo de 60%). Mudanças de gasto |
| **Radar** | 6 | Alertas em aberto por gravidade. Prioridade = impacto × urgência × relevância × confiança. Ciclo novo, visto, resolvido. Os 3 mais prioritários com o link de cada um |
| **Simulador** | 7 | Posições disponíveis e simulações salvas. Os dois cenários (venda e PGBL) com as abas trocadas automaticamente. O tour não executa simulação |

**Como abrir:** pelo botão "Tour da página" (na Visão Geral, ele fica abaixo da saudação, porque essa página não tem cabeçalho), pela busca Ctrl K ou por `#/<página>?tour=1`. Cada página guarda o próprio progresso (`aurion.tour.<página>`).

**Testes**
- **Unitários:** 95 no total, todos aprovados.
- **Playwright:** as 5 páginas percorridas pelo teclado em 1440 e 390 px, no modo demonstração e com uma conta real (extrato, posição da B3 e negociações). Nenhum balão saiu da tela, não houve requisição de escrita e o console não teve erros.
- **Tributação:** continua com 36 passos.
- **Regressão:** as 17 suítes ponta a ponta, pytest e ruff aprovados.

**Ajustes encontrados no teste**
- Sem a cobertura de custo informada (`result_coverage`), a frase não diz "0%".
- O passo de referências de mercado só aparece quando o cartão existe.
- No painel inicial, a explicação do imposto deixou de dizer que as barras somam o total. Na demonstração, as barras mostram o imposto mensal antes do IRRF e do mínimo por guia, então a soma delas não bate com o total.

**Capturas:** `docs/visual-check/tour/visao-geral-liquidez-1440.png`, `financas-poupanca-390.png`, `patrimonio-concentracao-1440.png` e `guia-atraso-1440.png`.

## 9. Tours das páginas restantes (10/10/2026)

Os catálogos estão em `apps/web/app/js/tour_paginas2.js` e as frases com números em `apps/web/app/js/tour_explain3.js`. As frases repetem as regras de `daily_engine.js`, `trader_engine.js` e `data_quality.js`. Os testes estão em `worker/test/tour_paginas2.test.mjs` (5 testes).

| Página | Passos | Números explicados com os dados reais |
|---|---|---|
| **Notícias** | 6 | Data e blocos do AURION Daily, que é montado por regras e não por IA. Notícias coletadas, fontes e quantas são ligadas à carteira. Regra de relevância: 3 pontos por ativo citado e 1 ponto por tema da carteira. Motivo da notícia mais relevante. Fontes sem publicação recente |
| **Trader Intelligence** | 8 | Resultado líquido = bruto − custos, nas operações fechadas. Imposto estimado por operação (15%, 20% no day trade e no FII, 0% em mês isento), comparado com a apuração da Tributação. Taxa de acerto = operações com lucro ÷ operações. Profit factor = ganhos ÷ perdas. Drawdown máximo |
| **Inteligência** | 5 | Explica evidências, fontes, guardrails da CVM e auditoria das respostas. O tour não envia perguntas |
| **Documentos** | 4 | Documentos guardados e conferidos, espaço usado. Checklist do IR: itens prontos, percentual e o que falta |
| **Importar** | 4 | Importações feitas, com o total de lançamentos, contas, posições e negociações, e a mais recente |
| **Conexões** | 3 | Situação do Open Finance. Nota de qualidade dos dados = média ponderada de atualização (20%), completude (25%), validade (15%), consistência (25%) e ausência de duplicidade (15%) |
| **Configurações** | 7 | Aparência, perfil, e-mails, compartilhamento com o contador, integrações, segurança e sessões |

**Correção junto com os tours**
- A faixa "Seus dados: os painéis mostram os seus números quando você envia arquivos…" aparecia mesmo para quem já tinha dados.
- Agora ela só aparece enquanto a conta não tem dados próprios. Isso vem da resposta `has_data` dos painéis e fica guardado na sessão do navegador; entrar ou sair da conta zera essa informação.
- Testado com duas contas: na conta com dados a faixa fica oculta; na conta vazia, ela aparece.

**Testes**
- 100 testes unitários aprovados.
- **Playwright:** as 7 páginas percorridas pelo teclado em 1440 e 390 px com uma conta real. As 6 páginas anteriores foram percorridas de novo. Nenhum balão saiu da tela, não houve requisição de escrita e o console não teve erros.
- **Regressão:** as 17 suítes ponta a ponta, pytest e ruff aprovados.

**Capturas:** `docs/visual-check/tour/trader-acerto-1440.png` e `conexoes-qualidade-390.png`.
