# AURION Financial Experience 4.0 — login e cadastro

**Data:** 08/10/2026
**Situação:** **em homologação.** A versão de produção continua com o login e o cadastro clássicos até a aprovação.

**Como ver**

| Ação | Endereço |
|---|---|
| Abrir a nova versão | https://aurionfinance.com.br/app/?ui=4#/cadastro |
| Abrir a tela de entrar | https://aurionfinance.com.br/app/?ui=4#/entrar |
| Voltar ao layout clássico | https://aurionfinance.com.br/app/?ui=classico#/entrar |

**Como funciona a ativação**
- O parâmetro `?ui=4` fica guardado no navegador de quem abriu o link. Os outros visitantes continuam no layout clássico.
- Depois da aprovação, a nova versão vira o padrão para todos com a troca de uma linha em `apps/web/app/js/ui4.js`.

## 1. O que foi entregue

**Lado esquerdo (cerca de 60%): ambiente financeiro**
- **Logotipo e frase:**
  - Logotipo AURION metálico; o reflexo acompanha o ponteiro e o clique volta ao site.
  - Frase "INTELIGÊNCIA FINANCEIRA PARA O SEU PRÓXIMO NÍVEL".
- **Faixa de cotações:**
  - 11 painéis: IBOV, PETR4, VALE3, ITUB4, BBDC4, B3SA3, S&P 500, Nasdaq, Dow Jones, USD/BRL e EUR/BRL.
  - Cada painel mostra o último valor, a variação, o horário e um selo: **atrasado**, **fechamento**, **desatualizado** ou **indisponível**.
  - A faixa rola sozinha devagar. Ela para quando o ponteiro ou o foco do teclado está sobre ela.
  - Abaixo da faixa aparecem a fonte e o aviso "Não é tempo real".
- **Candles holográficos:** histórico real de 1 mês do Ibovespa, com candles diários.
- **Touro low-poly:** SVG com brilho e flutuação. É decorativo e fica invisível para leitores de tela.
- **Globo:**
  - Malha, continentes reais, órbitas e marcadores de **B3, NYSE e Nasdaq**, com a variação do índice principal de cada bolsa.
  - Os marcadores, e também os botões abaixo do globo para quem usa teclado, abrem um painel com a situação do pregão e os ativos da bolsa.
  - O botão "Ver no painel" leva o notebook a Mercados com o ativo selecionado.
- **Notebook com o dashboard de demonstração:**
  - Seções: Início, Patrimônio, Mercados, Carteira, Análises, Oportunidades, Simulador, Alertas, Documentos e Configurações.
  - Períodos 1D, 1S, 1M, 1A e 5A, com "← Voltar" em todas as seções.
- **Mensagem institucional:** "SEU DINHEIRO GERA DADOS. Nossa inteligência mostra o que eles significam."

**Lado direito (cerca de 40%): painel de vidro com o formulário**
- **Etapa 1 — dados:**
  - **Campos:** nome completo, e-mail (formato e disponibilidade conferidos no servidor ao sair do campo), profissão e telefone de WhatsApp (máscara, com DDD e número validados).
  - **CPF opcional:** com máscara e dígitos verificadores conferidos. O servidor guarda o CPF cifrado e só uma impressão protegida para o login.
  - **Senha:** botão de mostrar e ocultar, e lista de requisitos marcada enquanto se digita (10 ou mais caracteres, letras e números).
  - **Termos de Uso e Política de Privacidade:** links para documentos reais, `termos.html` e `privacidade.html`.
  - **Comunicações:** consentimento opcional, separado dos termos.
  - **Erros:** cada erro aparece ao lado do seu campo, com contorno vermelho. O foco vai para o primeiro campo com erro e um resumo informa quantos campos revisar.
- **Etapa 2 — plano:**
  - Free, Pro e Premium, com preços vindos do cadastro de planos. O plano informado em `?plano=` já vem selecionado.
  - O botão "Criar minha conta" não aceita envio duplo: fica desativado e marcado como ocupado.
- **Depois do cadastro:**
  - A sessão é criada e o usuário vai para o primeiro diagnóstico.
  - Nos planos pagos, a assinatura fica "aguardando pagamento" e o pagamento é feito em Planos. É o mesmo fluxo de cobrança que já existia, sem mudanças.
- **Conflitos:**
  - E-mail já cadastrado: oferece Entrar e "recuperar o acesso".
  - CPF já usado em outra conta: o aviso aparece no próprio campo do CPF.
- **Entrar, recuperar, redefinir, verificação em duas etapas e primeiro acesso do administrador:**
  - São as mesmas telas e regras de antes, agora dentro do painel de vidro.
  - O ambiente da esquerda continua montado durante a troca entre essas telas.

## 2. Sincronização

- Uma única fonte alimenta a faixa, o globo, o notebook e os candles: o `market_store.js`. Por isso, os números são os mesmos em todos os lugares.
- **Clique num painel da faixa:**
  - o notebook abre em Mercados com aquele ativo;
  - o cartão do ativo pisca em destaque;
  - o painel da faixa fica marcado;
  - aparece o botão "Voltar ao painel geral".
- Clique num ativo dentro do notebook marca o painel correspondente na faixa.
- O botão "D" (conta) do notebook leva o foco ao formulário. A demonstração nunca mostra dados de usuário.

## 3. Dados de mercado: origem e regras

| Item | Como funciona |
|---|---|
| Fonte | Endpoint público de gráficos do Yahoo Finance, chamado **só pela API** (`GET /v1/public/market`). Não há chave nem token no navegador. |
| Rótulos | Pregão aberto: "atrasado" (B3 com pelo menos 15 min de atraso). Mercado fechado: "fechamento". Câmbio: mercado contínuo, cotação atrasada. A resposta traz sempre `tempo_real: false`. |
| Cache | Instantâneo de 5 min com pregão aberto e de 30 min com mercado fechado. A atualização é em segundo plano e não atrasa a resposta. O agendador de 15 em 15 min mantém o cache aquecido. Histórico (`/v1/public/market/history`) com cache por período. |
| Falha do provedor | Mantém o último valor válido marcado como **desatualizado**. Sem valor anterior, mostra **indisponível**. Nada é inventado. Sem cotações, o notebook informa que não exibe patrimônio. |
| Navegador | Consulta a cada 60 s (configurável: 2 min ou manual). Pausa com a aba oculta. Ao falhar, reconecta com espera crescente (15 a 120 s). |
| Carteira de demonstração | Quantidades **fictícias** (PETR4 400, VALE3 250, ITUB4 600, BBDC4 800, B3SA3 1.200), mais renda fixa e caixa fixos, sempre rotulados como fictícios. Os preços são as cotações reais. O preço médio é simulado com a cotação de 12 meses atrás. |
| Análises e oportunidades | Retorno, volatilidade (desvio-padrão semanal × √52), queda máxima e média de 52 semanas, todos calculados no histórico real. O filtro usa critérios explícitos e traz o aviso da Resolução CVM 19/2021. |
| Alertas | Eventos reais (variação de ±2%, ativo indisponível, situação do pregão), divulgações públicas da CVM e um alerta fictício identificado como tal. |

## 4. Backend (aditivo, já compatível com a produção atual)

- **Rotas novas:**
  - `GET /v1/public/market` e `GET /v1/public/market/history?id=&period=`. O histórico tem limite de 60 consultas por minuto por IP; um `id` ou `period` inválido devolve 422.
  - `GET /v1/auth/email-available?email=`, sob o limite de autenticação. A resposta só diz se o e-mail está livre, sem outros dados.
- **Cadastro:** registra `consents.termos_uso` e `consents.politica_privacidade` com versão (`2026-10-08`) e horário. Também registra `consents.comunicacoes` (opcional) e grava a versão aceita na auditoria (`conta.criada`).
- **Inalterados:** recuperação de senha (sem revelar se o e-mail existe), encerramento de sessão no servidor, bloqueio por tentativas e hash PBKDF2 da senha.

## 5. Acessibilidade, desempenho e alternativas

- **Sem WebGL:**
  - 3D por transformações CSS (sem `preserve-3d` nos elementos clicáveis);
  - globo e candles em canvas 2D;
  - touro e gráficos em SVG.
- **Modo leve automático:** abaixo de 40 quadros por segundo, desliga desfoques e animações.
- **Movimento:**
  - "Reduzir movimento" do sistema e a opção "Reduzir animações" do notebook desligam todas as animações e a rolagem da faixa.
- **Teclado e leitores de tela:**
  - todos os comandos são botões ou links focáveis, com contorno de foco;
  - o painel do globo fecha com Esc e devolve o foco;
  - os erros usam `role="alert"`;
  - cada campo é ligado à sua mensagem por `aria-describedby`.
- **Celular (até 1040 px):**
  - o formulário vem primeiro;
  - "Ver demonstração financeira" abre o ambiente;
  - o notebook fica com o menu em abas e uma coluna;
  - sem rolagem horizontal em 390, 900 e 1440 px.

## 6. Testes executados

**Ponta a ponta (`auth4_e2e`)**
- Valores da API iguais aos do provedor (simulado).
- Os quatro estados: aberto/atrasado, fechado/fechamento, câmbio contínuo e indisponível.
- Histórico nos 5 períodos e 422 para entradas inválidas.
- Cache servido com o provedor fora do ar.
- E-mail disponível ou em uso.
- Versão dos termos registrada na auditoria.
- Cadastro nos planos Free e Pro, login, recuperação e saída que invalida a sessão.

**Interface (Playwright, contra a API local)**
- Os 11 painéis com valor, variação, selo e horário.
- Clique em PETR4 abre Mercados com PETR4 e destaque; "Voltar ao painel geral".
- As 10 seções do notebook e a troca de período.
- Painel da B3 no globo e "Ver no painel" levando ao Ibovespa.
- Formulário:
  - os 6 erros obrigatórios ao lado dos campos;
  - máscaras de telefone e CPF;
  - lista de requisitos da senha;
  - mostrar e ocultar a senha.
- Plano Pro gravado na conta, sem duplicidade com dois cliques em "Criar minha conta". Consentimentos com versão e horário conferidos no banco.
- E-mail duplicado avisado ao sair do campo.
- Entrar sem desmontar o ambiente.
- Sem a flag, o layout clássico continua igual: cadastro, entrar e login de demonstração funcionando.
- `?ui=classico` desliga a nova versão.
- A tela inicial 4.0 continua funcionando com o globo compartilhado.
- Nenhum erro no console em todas as execuções.

**Larguras e preferências:** 1672×941, 1440×900, 900 e 390 px, com movimento reduzido.

**Regressão**
- 74 testes unitários.
- pytest e ruff.
- Sintaxe de todos os módulos.
- **17 suítes ponta a ponta aprovadas.**

## 7. Dependências de contrato ou licença

| Item | Situação | O que destrava |
|---|---|---|
| **Cotações em tempo real** | Não disponíveis. A fonte atual é pública, atrasada e de uso informativo, sem licença de redistribuição. | Contratar um distribuidor licenciado de dados da B3 (*market data vendor*) ou um provedor com token (ex.: brapi Pro, Twelve Data, Polygon). A troca é feita só em `worker/src/public_market.js`, sem mudar a tela. |
| **Uso comercial da fonte atual** | Os termos do Yahoo não autorizam uso comercial. É aceitável para homologação; para a versão definitiva, recomenda-se o provedor licenciado acima. | Decisão de negócio (Bruno). |
| **Identificação do controlador** | Termos e Política estão publicados, mas sem razão social, CNPJ e contato do encarregado (DPO). A falta está sinalizada nas próprias páginas. | Bruno informar os dados da empresa. |
| **Revisão jurídica** | Os textos seguem a LGPD, o Marco Civil (art. 15), o CDC (art. 49) e a CVM 19/2021, mas não foram revisados por advogado. | Revisão por advogado antes da publicação definitiva. |
| **Open Finance** | Continua dependendo do contrato com o agregador (já documentado). | Contrato. |

## 8. Arquivos

**Frontend**
- `apps/web/app/js/ui4.js`: a flag de homologação.
- `apps/web/app/js/auth4.js`: o ambiente e o cadastro.
- `apps/web/app/js/dash4.js`: o notebook.
- `apps/web/app/js/market_store.js`: o estado compartilhado das cotações.
- `apps/web/app/css/auth4.css`: os estilos.
- `apps/web/app/img/bull.svg`: o touro.
- `apps/web/js/globe.js`: o globo, agora compartilhado com a tela inicial.
- `apps/web/termos.html`, `apps/web/privacidade.html` e `apps/web/css/legal.css`: os documentos legais.
- Arquivos ajustados: `app.js` (rota), `views.js` e `views_identity.js` (painel de vidro) e `sw.js` (v3).

**Backend**
- `apps/web/app/js/market_public.js`: regras puras, compartilhadas com a API.
- `worker/src/public_market.js`: as rotas de cotações.
- Arquivos ajustados: `worker/src/index.js`, `identity.js` e `ratelimit.js`.

**Testes**
- `worker/test/market_public.test.mjs` e `worker/test/auth4_e2e.mjs`.
- `worker/test/fake_market.mjs`, ampliado com a simulação de mercado fechado e de falha.

## 9. Para publicar em produção (após aprovação)

1. Em `apps/web/app/js/ui4.js`, trocar o padrão para a 4.0: `return localStorage.getItem("aurion.ui") !== "classico";`, e fazer `?ui=classico` gravar `"classico"`.
2. Fazer commit e push; o GitHub Pages publica sozinho.
3. Para voltar atrás: reverter esse commit de uma linha.
