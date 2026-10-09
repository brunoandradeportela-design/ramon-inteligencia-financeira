# Tour guiado da página Tributação — relatório

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

- **Resultado da guia:** o passo explica a regra de multa (0,33% ao dia, limitada a 20%) e de juros (Selic acumulada mais 1%), conferida em `guia_engine.js`. Ele não lê os valores da última guia exibida, porque esse painel é gerado sob demanda.
- **Cobertura:** por enquanto, só a página Tributação tem tour. O motor já está pronto para as outras páginas.

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
