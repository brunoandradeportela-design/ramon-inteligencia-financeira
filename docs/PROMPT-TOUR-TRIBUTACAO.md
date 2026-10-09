# PROMPT — Tour guiado completo da página Tributação (AURION)

> Cole este prompt inteiro numa sessão do Claude com o repositório `ramon-inteligencia-financeira` aberto.

---

## 0. Papel e objetivo

Você é o engenheiro responsável pelo app AURION:
- frontend em `apps/web/app`, com JavaScript modular sem framework e roteamento por hash em `app.js`;
- backend no Worker `aurion-api`, em `worker/src`.

Implemente um **tour guiado completo da página Tributação** (`#/tributacao`). O tour percorre **todos os elementos visíveis da página, um por um**. Cada passo explica ao usuário, em português simples:

1. **Por que existe** — qual problema esse elemento resolve para quem investe.
2. **O que faz** — o que acontece ao clicar ou usar o elemento.
3. **O que representa** — o conceito tributário ou financeiro por trás dele.
4. **Por que este número** — de onde vem o valor que o usuário está vendo, calculado com os dados reais dele naquele momento.

A regra mais importante é a do item 4: **nenhum número pode ser explicado com texto fixo.** A explicação lê o mesmo objeto que desenhou a tela (`/v1/tax/summary`, `/v1/tax/events`, `/v1/tax/rules`) e monta a frase com os valores reais. Exemplo do que se espera: "Sua confiança está em 55% porque 2 das 9 vendas de 2026 (PETR4 em 12/03 e VALE3 em 04/05) não têm a compra registrada. Importe o relatório de Negociação da B3 desde a primeira compra para subir para 100%."

Construa o motor do tour de forma **reutilizável** (a primeira página atendida é Tributação; Visão Geral, Patrimônio, Trader e as demais virão depois com o mesmo motor).

---

## 1. Restrições obrigatórias

- **Idioma e tom:** todos os textos em português do Brasil, frases curtas, sem jargão sem explicação. Ao usar um termo técnico ("IRRF", "day trade", "base de cálculo"), explique-o na mesma frase.
- **Nunca invente números.** Se um dado não existir (conta sem negociações, modo demonstração, erro da API), o passo diz isso: "Ainda não há negociações importadas; este cartão mostrará…". Nunca mostre exemplos inventados como se fossem do usuário.
- **Modo demonstração:**
  - Em modo demonstração (`DEMO`) ou com `t.sample === true`, todo passo começa com o selo "Exemplo ilustrativo".
  - O tour funciona normalmente, mas deixa claro que os números não são do usuário.
- **Citações legais:**
  - Venha do catálogo de regras já existente (`/v1/tax/rules`, `knowledge.js`, `tax_engine.js`) — **não escreva artigos de lei de memória**.
  - Se a regra tiver `sources`, use o `id` e o `title` dela, com link.
  - Se não tiver, não cite artigo.
- **Sem recomendação de investimento.** O tour explica e orienta sobre dados e obrigações, nunca diz para comprar ou vender (Resolução CVM 19/2021).
- **O tour não altera dados:**
  - Passos que mostram botões ("marcar pago", "gerar DARF", "Salvar e recalcular") apenas destacam e explicam.
  - O tour nunca clica nesses botões por conta própria.
  - Trocar de aba durante o tour é permitido, porque é só navegação.
- **Acessibilidade:**
  - Navegável só pelo teclado: → e Enter avançam, ← volta, Esc sai.
  - O foco fica preso no balão do tour e volta ao elemento de origem ao sair.
  - O balão tem `role="dialog"`, `aria-modal="true"` e `aria-labelledby`.
  - Os passos são anunciados por `aria-live="polite"`.
- **Movimento e desempenho:**
  - Respeite `prefers-reduced-motion` e a classe `a4-calm`: sem animação, só troca instantânea.
  - Sem bibliotecas externas: nada de Shepherd, Intro.js ou Driver.js. Escreva o motor em um único módulo.
- **Telas:**
  - Celular (até 760 px): o balão vira uma folha fixa na parte de baixo, e o elemento destacado rola para a metade de cima da tela.
  - Tema claro e escuro: use os tokens de `glass.css`.

---

## 2. Arquitetura

### 2.1 Arquivos novos
| Arquivo | Conteúdo |
|---|---|
| `apps/web/app/js/tour.js` | Motor genérico: `startTour(pageId, steps, ctx)`, `stopTour()`, `tourButton(pageId)`, persistência e acessibilidade |
| `apps/web/app/js/tour_tributacao.js` | Catálogo de passos da página Tributação; cada passo é um objeto com funções que recebem os dados reais |
| `apps/web/app/js/tour_explain.js` | Funções **puras** que geram as frases dos números (testáveis sem navegador) |
| `apps/web/app/css/tour.css` | Camada escura com recorte (*spotlight*), balão, folha inferior no celular, barra de progresso |
| `worker/test/tour_explain.test.mjs` | Testes unitários das frases (entrar no `npm test`) |

### 2.2 Formato de um passo
```js
{
  id: "kpi-confianca",
  target: '[data-tour="kpi-confianca"]',        // âncora estável; nunca seletor por posição
  tab: null,                                    // ou "resumo" | "guias" | "eventos" | "regras" — o motor troca a aba antes
  when: ctx => true,                            // pula o passo se o elemento não se aplica (ex.: sem DARF no ano)
  titulo: "Qualidade do cálculo",
  porque: ctx => "…",                           // 1. por que existe
  faz: ctx => "…",                              // 2. o que faz
  representa: ctx => "…",                       // 3. o que representa
  numero: ctx => explain.confianca(ctx.t),      // 4. por que este número (null se não houver número)
  acao: ctx => ({ label: "Importar negociações", href: "#/importar" }) // opcional: próximo passo sugerido
}
```
O balão mostra os quatro blocos com rótulos fixos: **Por que existe · O que faz · O que representa · Por que este número**. Um bloco sem conteúdo não aparece.

### 2.3 Âncoras
Adicione `data-tour="…"` aos elementos em `views.js` (função `tax`), em `views_tax2.js` (`taxExtras`, `irpfSection`), em `views_guias.js` e na casca do app em `app.js` (barra superior). Não mude a aparência nem o comportamento desses elementos.

### 2.4 Como iniciar o tour
- **Botão na página:** "Tour da página", com ícone "?", no cabeçalho da página Tributação, ao lado do título.
- **Paleta ⌘K:** novo comando "Fazer o tour desta página".
- **Primeira visita:** um convite discreto ("É sua primeira vez aqui? Faça o tour de 2 minutos") com as opções "Começar" e "Agora não".
  - Nunca abre sozinho por cima da tela.
  - "Agora não" grava a recusa no navegador.
- **Persistência:** `localStorage["aurion.tour.tributacao"] = { versao: "1", concluido, ultimo_passo }`, com leitura e escrita dentro de `try/catch`.
  - "Continuar de onde parei" retoma o `ultimo_passo`.
  - Mudar a `versao` do catálogo oferece o tour de novo.
- **Pela URL:** `#/tributacao?tour=1` abre o tour direto, para o link de ajuda e para o suporte.

### 2.5 Comandos do balão
- **Botões:** "← Anterior", "Próximo →" ("Concluir" no último passo), "Pular tour" e ×.
- **Progresso:** "Passo 7 de 31" e uma barra.
- **Índice:** "Índice" abre a lista dos passos agrupada por seção; um clique pula direto para o passo.
- **"Ver de novo depois":** fecha o tour e mantém o ponto onde parou.
- **Elemento ausente** (ex.: o cartão "Auditoria do cálculo" só aparece com dados reais): o motor pula para o passo seguinte, sem quebrar.
- **Ao concluir:** resumo final com os 3 pontos de atenção da conta, gerados dos dados — confiança abaixo de 100%, DARF vencido ou em aberto e vendas sem custo. Cada ponto traz o link para resolver.

---

## 3. Roteiro dos passos (página Tributação, nesta ordem)

Para cada item: o **alvo**, os quatro blocos e, quando houver número, a **regra de cálculo** que a função de `tour_explain.js` deve reproduzir em palavras. **Antes de escrever as frases, confira cada regra no código** (`tax_engine.js`, `guia_engine.js`, `views*.js`). Se o código divergir deste roteiro, o código manda: ajuste a frase e anote a divergência no relatório.

### A. Abertura e barra superior
1. **Boas-vindas** (sem alvo, balão centralizado).
   - Diga o que a página faz: calcula o imposto de renda sobre a bolsa mês a mês, mostra o que é isento, gera a guia de pagamento e explica cada número.
   - Avise que é uma **estimativa** e não substitui o contador.
   - Diga o ano apurado (`t.year`) e a data de referência (`t.reference_date`).
2. **Menu (☰)** — leva às outras áreas do app.
3. **Logotipo** — volta à Visão Geral.
4. **Tema (lua ou sol)** — alterna claro, escuro e automático. Só muda a aparência, nunca os dados.
5. **Sino de avisos** — o ponto vermelho indica avisos não lidos, como DARF perto do vencimento ou dado faltando.
   - O número vem das notificações da conta.
   - Se houver aviso tributário, cite o mais próximo do vencimento.
6. **Avatar (inicial do nome)** — Minha conta, Planos, Privacidade e Sair. O tour nunca mostra dados pessoais além da inicial.

### B. Avisos no topo (só se aparecerem)
7. **"Exemplo ilustrativo"** (`t.sample`): por que aparece e como trocar pelos dados reais (Importar dados).
8. **"Faltam compras no histórico"** (`t.limitations[0]` começando com "Há vendas sem"):
   - Explique que, sem a compra, o preço médio é desconhecido, então o lucro daquela venda não pode ser calculado.
   - Liste as vendas afetadas (`ev.items` com `status === "pendente_dado"`: ativo, data e valor).

### C. Os quatro cartões de resumo
9. **Imposto estimado {ano}**
   - **Representa:** soma dos DARFs 6015 (renda variável) do ano que atingiram o mínimo de pagamento.
   - **Número:** some os `t.months[].darf.valor` e explique a composição:
     - alíquota sobre o lucro tributável de cada modalidade: operações comuns, day trade e FII (use `aliquota` de cada regra em `/v1/tax/rules`: hoje 15%, 20% e 20%);
     - menos o IRRF compensado;
     - prejuízo da mesma modalidade abate antes do imposto;
     - valores abaixo do mínimo (`darf_valor_minimo`, R$ 10) acumulam para o mês seguinte.
   - Diga em quais meses houve DARF e de quanto.
   - Se der zero, explique o porquê: só meses isentos, só prejuízo ou nenhuma venda.
10. **IRRF ("dedo-duro")**
    - **Representa:** imposto retido na fonte pela corretora na venda. Não é imposto extra: é uma antecipação que serve de rastro para a Receita.
    - **Número:** `t.total_irrf` = soma de `months[].irrf`. Explique a alíquota sobre o valor de venda nas operações comuns e FII e sobre o ganho no day trade, usando os parâmetros da regra (`irrf_aliquota_sobre_venda`, `irrf_aliquota_sobre_ganho`).
    - Explique que o valor é **abatido** do imposto do mês. Se sobrar, vira crédito para os meses seguintes do ano.
11. **Ganhos isentos**
    - **Representa:** lucro com ações em meses em que o total de **vendas** de ações (não o lucro) ficou dentro do limite (`limite_isencao_vendas_mes`, hoje R$ 20 mil).
    - **Número:** `t.total_exempt_gain` = soma de `months[].exempt_gain`. Liste os meses isentos com o total vendido em cada um.
    - Avise as exceções: day trade, FII e ETF **não** entram na isenção. Esse lucro precisa ser informado na declaração anual como rendimento isento.
12. **Qualidade do cálculo (Confiança %)** — o passo mais importante. Explique:
    - **Por que existe:** o imposto só é tão bom quanto os dados. O índice mostra se falta algo antes de você pagar ou declarar.
    - **O que representa:** completude dos dados e das regras usadas. **Não é** garantia jurídica nem probabilidade de acerto.
    - **Número:** `t.confidence` é o **menor** valor entre os meses do ano, limitado pela regra:

      | Situação | Valor |
      |---|---|
      | Tudo certo | 100% |
      | Classe do ativo deduzida pelo código (ação, FII ou ETF), sem a posição da B3 | 80% |
      | Alguma venda sem a compra registrada (custo desconhecido) | 55% |
      | Não existe versão de regra validada para o ano | teto de 50% |

    - Diga **qual situação** derrubou o índice e **em qual mês**, citando as vendas (`ev.items` com `pendente_dado`).
    - Use os fatores de `t.quality.factors` (`factor`, `detail`, `improve`) para dizer **o que fazer para subir**.
    - Exemplo: 55% → "a venda de X em dd/mm não tem compra registrada".
    - **Linha de prejuízos:** explique "Sem prejuízos a compensar" ou os valores de `t.losses_available` por modalidade. Prejuízo de uma modalidade só abate lucro da mesma modalidade e não prescreve.

### D. Abas
13. **Barra de abas** — as quatro visões do mesmo cálculo.
14. **Aba "Apuração mensal"** (troque para `resumo`). Destaque a tabela e explique cada coluna, um passo por grupo para não lotar o balão:
    - **14a. Mês e "Vendas de ações":** soma do valor vendido em ações no mês. É o que decide a isenção.
    - **14b. Isenção:** selo "até 20 mil" ou "tributável". Use o mês com maior venda como exemplo real.
    - **14c. Resultado comum, Day trade e FII:** lucro ou prejuízo de cada modalidade. A linha verde "+R$ x isento" mostra o lucro que ficou fora do imposto.
    - **14d. IR bruto e IRRF:** imposto antes e depois de descontar a retenção.
    - **14e. DARF 6015:**
      - situação (aberto, vencido ou pago), valor e vencimento;
      - o vencimento é o último dia útil do mês seguinte ao da venda;
      - "acumula (< R$ 10)" significa que o valor fica para somar com o mês seguinte.
    - **14f. Botões "marcar pago" e "desfazer":** registram o pagamento para o sistema parar de cobrar e contar o DARF como pago. Não pagam nada.
    - **14g. Botão "gerar DARF":** leva à aba Guias já com o código 6015, a competência e o valor preenchidos.
15. **Aba "Guias DARF/DARE"** (troque para `guias`):
    - **15a. Seletor DARF · federal / DARE · estadual:** DARF paga tributos federais (como o IR da bolsa); DARE paga tributos estaduais (como ITCD e ICMS).
    - **15b. Formulário:**
      - **Código de receita:** identifica o tributo, e o código errado faz o pagamento cair no lugar errado.
      - **CPF/CNPJ:** o sistema confere os dígitos.
      - **Período de apuração** e **valor principal.**
    - **15c. Resultado da guia:** vencimento legal, multa e juros.
      - Pagamento atrasado: multa de 0,33% por dia, limitada a 20%; juros pela Selic acumulada mais 1% no mês do pagamento.
      - Use os valores reais da última guia exibida e confira a regra em `guia_engine.js`.
    - **15d. Guias geradas:** o histórico das guias, com situação. Explique que o código de barras oficial vem do Sicalc até o Integra Contador estar contratado (veja `docs/INTEGRA-CONTADOR.md`).
16. **Aba "Eventos tributários"** (troque para `eventos`):
    - **16a. Um cartão de evento:** cada venda vira um evento com valor de venda, custo, resultado, regra aplicada (código e versão), fontes e origem do dado.
    - **16b. Situações:** "calculado", "isento", "pendente_dado".
    - **16c. Confiança do evento:**

      | Situação do evento | Confiança |
      |---|---|
      | Normal | 100% |
      | Day trade identificado por inferência | 90% |
      | Classe deduzida | 80% |
      | Sem custo | 30% |

      O número do cartão de resumo é o menor de todos os meses, não a média — diga isso.
17. **Aba "Regras e fontes"** (troque para `regras`):
    - cada regra com versão, vigência, fórmula, exceções e links das fontes oficiais;
    - selo validada ou pendente;
    - "não usada em cálculo" quando aparecer;
    - é aqui que o usuário confere de onde vêm as alíquotas que o tour citou.

### E. Blocos abaixo das abas
18. **Premissas** — as bases do cálculo (`t.premises`), lidas da tela.
19. **Limitações:**
    - o que o cálculo **não** cobre: opções, termo, futuros, aluguel, proventos e eventos corporativos;
    - o **snapshot** (impressão das entradas): mesmas entradas + mesma versão da regra = mesmo resultado, para auditoria.
20. **Qualidade do cálculo — detalhe** (`taxExtras`, só com dados reais): os quatro fatores (custo de aquisição, classe dos ativos, versão da regra e escopo) com ✓ ou !, e o "Para elevar" de cada um.
21. **Auditoria do cálculo:**
    - código do cálculo, versão do motor e das regras, hash das entradas;
    - **"Baixar Excel de auditoria":** o artefato para o contador;
    - **"Reprocessar e conferir":** refaz o cálculo e confirma que dá o mesmo resultado. Explique por que isso importa: reprodutibilidade numa fiscalização.
22. **Relatório para a declaração (IRPF):** o que entra em cada ficha da declaração anual (renda variável, rendimentos isentos, bens e direitos), gerado do mesmo cálculo.
23. **Ajustes da apuração:**
    - prejuízos acumulados até 31/12 do ano anterior, por modalidade;
    - onde encontrar o valor: declaração anterior, ficha Renda Variável, ou controle do contador;
    - "Salvar e recalcular" refaz toda a apuração.
    - O tour **não** salva nada.

### F. Encerramento
24. **Resumo personalizado:**
    - até 3 pendências reais, em ordem de urgência: DARF vencido, DARF a vencer em até 10 dias, confiança abaixo de 100% (com o motivo) e vendas sem custo;
    - cada pendência com o link de ação;
    - sem pendências: "Sua apuração está completa para os dados enviados".
    - Botões "Concluir" e "Rever um passo" (abre o índice).

> **Contagem esperada:** cerca de 30 passos com os subpassos. Mire em 15 a 40 palavras por bloco. Cada bloco deve caber no balão sem rolagem em 1440×900, e na folha inferior com rolagem curta em 390 px.

---

## 4. Funções de explicação (`tour_explain.js`)

São funções puras, que recebem `t` (summary), `ev` (events) e `rules`, devolvem uma string em pt-BR, formatam moeda com `Intl.NumberFormat("pt-BR")` e datas como dd/mm/aaaa. Implemente no mínimo:

| Função | O que a frase precisa conter |
|---|---|
| `impostoEstimado(t, rules)` | Total do ano, meses com DARF e valores, alíquotas aplicadas e menção ao IRRF abatido. Se der zero, o motivo |
| `irrf(t, rules)` | Total, como é calculado por modalidade e quanto foi compensado |
| `ganhosIsentos(t, rules)` | Total, meses isentos com o total vendido e o aviso de que day trade e FII não entram |
| `confianca(t, ev)` | Percentual, fator limitante, mês ou meses e vendas afetadas, e o "para elevar" de `t.quality.factors` |
| `prejuizos(t)` | Saldos por modalidade, ou "sem prejuízos" |
| `mesDarf(m)` | Explicação de uma linha da tabela (isenção, resultado, IR bruto, IRRF, DARF, vencimento, "acumula") |
| `evento(e)` | Explicação de um evento e da confiança dele |
| `resumoFinal(t, ev, hoje)` | Até 3 pendências ordenadas, com links |

Arredondamento sempre igual ao da tela: o tour lê os valores já arredondados que o servidor devolve, sem recalcular imposto. O tour **explica** o cálculo, **não refaz** o cálculo.

---

## 5. Testes obrigatórios

**Unitários** (`worker/test/tour_explain.test.mjs`, rodando no `npm test`):
- **Confiança 55%:** uma venda sem compra. A frase cita o ativo, a data e "Importe o relatório de Negociação".
- **Confiança 80%:** classe inferida. Cita a posição da B3.
- **Confiança 50%:** ano sem regra validada. Cita a regra.
- **Confiança 100%:** a frase não sugere ação.
- **Imposto zero:** três cenários (só isentos, só prejuízo, sem vendas), com três frases diferentes.
- **Isenção:** um mês com R$ 19.999,99 vendidos fica isento; um com R$ 20.000,01 é tributável. A frase segue a regra `<=` do motor.
- **DARF abaixo de R$ 10:** "acumula para o mês seguinte".
- **Modo demonstração:** todas as frases começam com "Exemplo ilustrativo".
- **Números da tela:** nenhuma frase contém número que não esteja em `t`, `ev` ou `rules`. Teste por amostragem: extraia os números da frase e confira cada um contra os dados.

**Interface** (Playwright, com API local e conta com negociações importadas, incluindo uma venda sem compra):
- abrir pelo botão, pela paleta ⌘K e por `?tour=1`;
- percorrer todos os passos com → e voltar com ←;
- Esc fecha e devolve o foco;
- troca automática das abas;
- passos ausentes pulados sem erro (conta sem dados reais);
- o balão nunca sai da tela em 1440, 900 e 390 px;
- a folha inferior aparece no celular;
- movimento reduzido sem animações;
- o resumo final lista a pendência da venda sem compra;
- nenhum erro no console;
- nenhuma chamada de escrita à API durante o tour (verifique as requisições: só GET).

**Regressão:** as 17 suítes ponta a ponta, pytest e ruff continuam verdes.

---

## 6. Critérios de aceite

- [ ] Todos os elementos visíveis da página Tributação têm um passo, ou estão listados no relatório como deliberadamente fora do tour, com o motivo.
- [ ] Todo passo com número explica **por que aquele valor**, com os dados reais da conta.
- [ ] O índice de confiança explica qual fator o reduziu, em qual mês e como elevar.
- [ ] Nenhum número inventado; nenhuma citação legal fora do catálogo de regras.
- [ ] O tour não altera dados.
- [ ] Teclado, leitor de tela, celular, tema escuro e movimento reduzido funcionam.
- [ ] O motor `tour.js` é genérico; o catálogo da página fica separado.
- [ ] Testes unitários e de interface aprovados.
- [ ] Relatório `docs/TOUR-TRIBUTACAO.md` com a lista dos passos, as capturas (1440 e 390 px), as divergências entre o roteiro e o código, se houver, e como adicionar o tour a outra página.

## 7. Entrega

1. Implemente, rode todos os testes e corrija até ficar tudo verde.
2. Faça o commit em `main` com mensagem descritiva e acompanhe o CI e o deploy.
3. Responda com: o que foi feito, as capturas do passo "Qualidade do cálculo" (desktop e celular), a lista dos passos e qualquer limitação encontrada.
