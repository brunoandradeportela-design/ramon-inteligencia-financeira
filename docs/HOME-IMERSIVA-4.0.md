# Tela inicial imersiva 4.0 — relatório de implementação

**Data:** 08/10/2026
**Versão de origem:** `0a00cfd`, o último commit antes desta mudança.
**Reversão:** a mudança está em um único commit. Para voltar ao estado anterior, basta `git revert <commit>`. A página anterior volta inteira: `index.html`, `landing.css` e `stage.js`.

## 1. Arquivos alterados

| Arquivo | O que é |
|---|---|
| `apps/web/index.html` | Nova página inicial: cenário, menu, hero, notebook, hologramas, seções e diálogos |
| `apps/web/css/home.css` | Estilos da página: paleta oficial, logotipo metálico, vidro translúcido, responsivo, modo leve e redução de movimento |
| `apps/web/js/home.js` | Interações: dashboard de demonstração navegável, hologramas, apresentação, globo, partículas, parallax, conteúdo, contato e sessão |
| `apps/web/assets/img/home/city.svg` | Cidade noturna (camada distante, 14 KB) |
| `apps/web/assets/img/home/arch.svg` | Arquitetura envidraçada, anel de luz e piso refletivo (camada próxima, 8 KB) |
| `apps/web/assets/data/land-mask.json` | Máscara de continentes para o globo (2 KB, Natural Earth, domínio público) |
| `apps/web/assets/data/home-demo.json` | Recorte da demonstração com dados fictícios (6 KB) |
| `scripts/site/build_home_demo.py` | Gera o arquivo acima a partir de `app/data/demo.json` |
| `worker/src/contact.js` | Contato público e leitura das mensagens pelo administrador |
| `worker/src/index.js`, `worker/src/ratelimit.js` | Rotas novas e limite de 5 envios de contato por minuto por IP |
| `apps/web/app/js/views_crm.js`, `apps/web/app/js/api.js` | Cartão "Mensagens do site" no CRM |
| `worker/test/site_e2e.mjs` | Teste ponta a ponta do contato e da demonstração sem dados reais |
| Removidos | `css/landing.css`, `js/stage.js`, `assets/img/globe.jpg` (só a página antiga usava) |

## 2. Funcionalidades implementadas

**Logotipo**
- Cromado, com gradiente prata, grafite e azul metálico, contorno, brilho azul e sombra.
- No carregamento, uma linha de luz atravessa as letras em 1,5 s, sem bloquear nada.
- Ao passar o mouse, o reflexo acompanha o ponteiro. O clique volta à página inicial.

**Cenário**
- Céu noturno, cidade iluminada, caixilhos de vidro, anel de luz, piso refletivo e partículas.
- Parallax sutil, guiado pelo mouse e pela rolagem.

**Menu**
- Pílula de vidro com contorno azul. Ao passar o mouse, o contorno acende e surge uma linha ciano (200 ms).
- O item ativo acompanha a seção visível.
- No celular, o menu vira gaveta e fecha com Esc.

**Texto e botões**
- Título com "Inteligência que transforma" em branco-prateado e "decisões." em azul-elétrico e ciano, seguido de cursor luminoso piscando.
- "Começar agora" leva ao cadastro e repassa `utm_*`, `plano` e `ref`.
- "Ver como funciona" abre a apresentação.

**Notebook 3D com dashboard real de demonstração**
- Menu lateral: Início, Patrimônio, Finanças, Tributação, Simulador, Alertas, Documentos e Configurações. Cada item mostra estado ativo e o botão "← Voltar" refaz o caminho.
- Busca: leva à seção correspondente ou lista os resultados.
- Seletor de período: recalcula patrimônio, variação e impostos até o mês escolhido.
- Sino: abre os avisos.
- Avatar: para visitante, mostra Entrar e Criar conta; logado, mostra Minha conta, Configurações e "Sair com segurança" (encerra a sessão na API).
- Indicadores: patrimônio, impostos estimados (com o rótulo "estimativa") e alertas abrem a seção correspondente.
- Alocação: rosca clicável e legenda com valores; os percentuais fecham em 100% pelo método do maior resto.
- Próximas ações: abrem a tarefa no aplicativo e não marcam nada como concluído.
- Cada seção tem "Abrir no aplicativo" com a rota real.

**Hologramas**
Todos são painéis de vidro translúcido com profundidade 3D, linhas de varredura, reflexo animado e linhas de conexão com o notebook. Ao passar o mouse, ganham brilho e aproximação; ao clicar, abrem um painel animado que fecha pelo botão ou por Esc, com o foco devolvido ao holograma.
- **Projeção de crescimento:** períodos de 3 e 6 meses, indicadores e projeção de 6 meses rotulada como ilustrativa.
- **Cenários simulados:** simulador com seis variáveis editáveis e validadas, gráfico e tabela comparativa, hipóteses explícitas e aviso de que não é garantia.
- **Globo financeiro:** canvas 2D com malha, continentes reais, rotação e conexões ilustrativas. Mostra a distribuição geográfica da carteira de demonstração (100% Brasil, 0% exterior) e diz que o globo é ilustrativo.

**Apresentação "Ver como funciona"**
- Sete etapas sobre o mesmo dashboard, com voltar, avançar, pausar ou reproduzir e fechar.
- Responde às teclas ← → e Esc; tem avanço automático a cada 7 s e barra de progresso.
- Cada etapa tem o link da tela no aplicativo.

**Indicadores de confiança**
- **LGPD:** só recursos que existem — CPF protegido, verificação em duas etapas, auditoria, exportação e exclusão.
- **Open Finance:** explica o consentimento e diz claramente que o agregador está pronto e é ativado quando o contrato for concluído. Enquanto isso, os dados entram por arquivos.
- **Inteligência:** motores determinísticos, simulador, alertas e assistente.

**Seções da página**
- **Produto:** seis módulos, cada um com demonstração e rota.
- **Soluções:**
  - pessoa física;
  - profissionais, com o acesso somente leitura concedido pelo cliente;
  - investidores, com o Trader Intelligence;
  - empresas, só com as guias DARF de PJ e o DARE (contabilidade e folha completas declaradas como fora do escopo).
- **Planos:** os três planos e a tabela comparativa, gerada dos recursos reais de cada plano.
- **Conteúdo:** títulos recentes das fontes oficiais, de `news.json`, com fonte, data e link.
- **Sobre:** proposta, princípios e formulário de contato.

**Contato real**
- `POST /v1/public/contact` valida os campos, descarta robôs com um campo-isca, limita a 5 por minuto por IP e a 3 por hora por e-mail, e registra na auditoria.
- A mensagem avisa o administrador por e-mail quando o Resend estiver ligado.
- As mensagens aparecem no CRM, em "Mensagens do site", com situação editável.
- O antigo link `mailto:contato@exemplo.com.br`, que era falso, foi removido.

**Nome dinâmico**
- Com sessão ativa, a saudação usa o primeiro nome do usuário e o menu mostra "Minha conta".
- Os números continuam sendo da demonstração e vêm identificados como tal.

## 3. Comandos ligados a rotas existentes

| Origem | Destino |
|---|---|
| Entrar | `app/#/entrar` |
| Começar agora | `app/#/cadastro` |
| Planos | `app/#/cadastro?plano=free\|pro\|premium` e `app/#/planos` |
| Notebook e módulos | `app/#/dashboard`, `patrimonio`, `financas`, `tributacao`, `tributacao?tab=guias`, `simulador`, `alertas`, `documentos`, `configuracoes`, `alocacao`, `trader`, `noticias`, `conexoes`, `importar`, `privacidade` |

O teste automático confirmou que todas as âncoras internas têm destino e que nenhum botão ficou sem ação.

## 4. Desempenho e alternativas

- **Sem bibliotecas novas:** não há Three.js nem WebGL. O 3D é feito com transformações CSS, o globo com canvas 2D e os efeitos com SVG. Por isso não é preciso uma alternativa para navegador sem WebGL.
- **Peso:** a página inteira carrega cerca de 205 KB em 14 requisições.
- **Modo leve automático:** se o aparelho renderiza abaixo de 40 quadros por segundo, a página desliga desfoques, brilhos animados e partículas. Num navegador sem GPU, isso subiu de 21 para 61 quadros por segundo.
- **Redução de movimento:** com a preferência ligada, todas as animações e o parallax ficam desligados.
- **Fora da tela:** o globo para quando não está visível e as partículas param com a aba oculta.
- **Celular:** o dashboard troca para um layout compacto, com abas e uma coluna, e os hologramas viram cartões empilhados. Não há rolagem horizontal em 390, 900, 1440 e 1672 px.

## 5. Testes executados

**Visuais**
- Capturas em 1672×941 (tamanho da referência), 1440×900, 900 px e 390 px, no modo normal e no modo leve.

**Funcionais (Playwright)**
- Menu do notebook, voltar, período, sino, avatar, alocação e busca.
- Os três hologramas: abrir, fechar com Esc e foco devolvido.
- Recálculo dos cenários.
- Apresentação: avançar, voltar, pausar, setas e Esc.
- Painéis de confiança, âncoras, notícias e tabela de planos.
- Sessão logada: saudação, "Minha conta", menu da conta, envio do contato e saída.

**Segurança**
- `site_e2e`: validação dos campos, campo-isca, limite por e-mail, leitura só pelo administrador (401 sem login, 403 para cliente) e demonstração sem CPF ou e-mail.
- A página não usa credenciais e só fala com a API do próprio domínio.

**Regressão**
- 69 testes unitários.
- Python: pytest e ruff sem falhas.
- Sintaxe de todos os módulos JS conferida.
- 16 suítes ponta a ponta, incluindo a nova `site_e2e`, todas aprovadas.
- O aplicativo (Visão Geral, Tributação, Alertas e CRM) abre sem erros.

## 6. Pendências

- **Integração bancária:** o agregador de Open Finance depende do contrato para ser ativado. O texto da página já informa isso.
- **Aviso de contato por e-mail:** depende do `RESEND_API_KEY` estar cadastrado. Sem ele, as mensagens ficam só no CRM.
- **Exposição internacional no globo:** só aparece com dados reais quando houver ativos no exterior; a demonstração não tem nenhum.
