/* Catálogos do tour de Visão Geral, Patrimônio, Finanças, Radar e Simulador (mesmo motor da Tributação).
 * Os textos fixos explicam o porquê e o funcionamento; os números vêm de tour_explain2.js com os dados da tela. */
import * as Y from "./tour_explain2.js";
import { SELO_DEMO, mesBR } from "./tour_explain.js";

export const TOUR_PAGINAS_VERSAO = "1";
const o = c => ({ demo: c.demo });
const n = v => +v || 0;
const exemplo = c => c.demo ? SELO_DEMO : "";

/* passos da barra superior: só na Visão Geral, que é a porta de entrada */
const barra = () => [
  { id: "menu", secao: "Navegação", target: '[data-tour="menu"]', titulo: "Menu",
    porque: "Cada área responde a uma pergunta: quanto tenho, quanto gasto, quanto devo de imposto.",
    faz: "Leva às páginas do aplicativo. No celular, abre a gaveta com todas elas.",
    representa: "A navegação principal da sua conta." },
  { id: "tema", secao: "Navegação", target: '[data-tour="tema"]', titulo: "Tema",
    porque: "Conforto de leitura de dia, à noite ou acompanhando o sistema.",
    faz: "Troca só a aparência; nenhum número muda.",
    representa: "Sua preferência visual, guardada neste navegador." },
  { id: "sino", secao: "Navegação", target: '[data-tour="sino"]', titulo: "Avisos",
    porque: "Prazos e dados faltando não podem passar despercebidos.",
    faz: "Abre os avisos. O ponto vermelho indica avisos não lidos.",
    representa: "Notificações de vencimentos, segurança e alertas." },
  { id: "avatar", secao: "Navegação", target: '[data-tour="avatar"]', titulo: "Sua conta",
    porque: "Reúne o que é pessoal: dados, plano, privacidade e saída segura.",
    faz: "Abre Configurações, Privacidade, Planos e Sair.",
    representa: "A sua conta, identificada pela inicial do nome." },
];
const exemploAviso = { id: "aviso-exemplo", secao: "Avisos", target: '[data-tour="aviso-exemplo"]', when: c => !!c.sample, titulo: "Exemplo ilustrativo",
  porque: "Enquanto você não envia seus dados, a página mostra um exemplo para você entender o funcionamento.",
  faz: "Leva a Importar dados, onde você envia extratos e relatórios da B3.",
  representa: "Números fictícios: nada nesta tela é seu ainda.",
  acao: () => ({ label: "Importar dados", href: "#/importar" }) };
const fim = (titulo, txt) => ({ id: "fim", secao: "Encerramento", titulo, final: c => { const r = txt(c); return { intro: exemplo(c) + r.intro, itens: r.itens, vazio: r.vazio }; } });

/* ================================================================ VISÃO GERAL */
export function stepsDashboard() {
  return [
    { id: "boas-vindas", secao: "Abertura", target: '[data-tour="dash-hero"]', titulo: "Visão Geral",
      porque: "Antes de decidir, você precisa ver o todo: patrimônio, impostos, alertas e liquidez num lugar só.",
      faz: "Resume as outras páginas. Cada cartão leva ao detalhe; a busca encontra telas e responde perguntas.",
      representa: "O painel da sua vida financeira, calculado pelos motores do AURION com os dados que você enviou." },
    ...barra(), exemploAviso,
    { id: "dash-patrimonio", secao: "Painel", target: '[data-tour="dash-patrimonio"]', titulo: "Patrimônio total",
      porque: "É o número que resume se a sua situação está melhorando ou piorando.",
      faz: "Mostra o total, a variação no período e a curva mês a mês. O título leva a Patrimônio.",
      representa: "Investimentos mais saldo em conta, na data de referência.",
      numero: c => Y.patrimonioTotal(c.d, o(c)) },
    { id: "dash-impostos", secao: "Painel", target: '[data-tour="dash-impostos"]', titulo: "Impostos estimados (ano)",
      porque: "Imposto da bolsa vence todo mês; ver o acumulado evita surpresa no caixa.",
      faz: "Mostra o total do ano, o lucro isento, as barras por mês e a confiança do cálculo. Leva à Tributação.",
      representa: "Estimativa do imposto de renda sobre a bolsa, não valor pago.",
      numero: c => Y.impostosAno(c.d, o(c)) },
    { id: "dash-alertas", secao: "Painel", target: '[data-tour="dash-alertas"]', titulo: "Alertas",
      porque: "Prazo, dado faltando ou risco precisam chegar até você sem precisar procurar.",
      faz: "Mostra quantos pontos de atenção estão abertos e leva ao Radar.",
      representa: "Alertas gerados por regras sobre os seus dados.",
      numero: c => Y.alertasPainel(c.d, o(c)) },
    { id: "dash-alocacao", secao: "Painel", target: '[data-tour="dash-alocacao"]', titulo: "Minha alocação",
      porque: "Saber onde o dinheiro está mostra riscos e concentrações.",
      faz: "Mostra a rosca por classe; o seletor troca para a visão por instituição.",
      representa: "Distribuição do patrimônio entre classes de ativos e saldo em conta.",
      numero: c => Y.alocacao(c.d, o(c)) },
    { id: "dash-acoes", secao: "Painel", target: '[data-tour="dash-acoes"]', titulo: "Próximas ações",
      porque: "Transforma os números em uma lista curta do que fazer primeiro.",
      faz: "Cada item tem um botão que leva à tela onde a ação se resolve. Nada é feito sem você.",
      representa: "Sugestões geradas por regras (reserva curta, concentração, dados faltando).",
      numero: c => Y.proximasAcoes(c.d, o(c)) },
    { id: "dash-mudou", secao: "Painel", target: '[data-tour="dash-mudou"]', titulo: "O que mudou",
      porque: "Gastos que sobem devagar passam despercebidos no extrato.",
      faz: "Lista as categorias cujo gasto do último mês fugiu da média e leva a Finanças.",
      representa: "Variação de gastos por categoria.",
      numero: c => Y.mudancas(c.d.changes, o(c)) },
    { id: "dash-liquidez", secao: "Painel", target: '[data-tour="dash-liquidez"]', titulo: "Liquidez",
      porque: "Dinheiro disponível é o que protege você de imprevistos sem vender investimentos às pressas.",
      faz: "Mostra o saldo em conta e por quantos meses ele cobre a sua despesa média.",
      representa: "Reserva imediata comparada ao seu custo de vida.",
      numero: c => Y.liquidez(c.d, o(c)) },
    { id: "dash-como", secao: "Painel", target: '[data-tour="dash-como"]', titulo: "Como calculamos",
      porque: "Você precisa poder confiar e conferir cada número.",
      faz: "Leva às regras e fontes oficiais usadas nos cálculos.",
      representa: "Motores determinísticos com regras versionadas; a IA só explica, não calcula." },
    fim("Por onde começar", c => {
      const it = [];
      if (c.sample) it.push({ texto: "Os números são de exemplo. Envie seus extratos e o relatório da B3.", href: "#/importar", label: "Importar dados" });
      if (n(c.d.liquidity?.avg_monthly_expense) > 0 && n(c.d.liquidity?.months_covered) < 3) it.push({ texto: Y.liquidez(c.d), href: "#/financas", label: "Ver finanças" });
      if (n(c.d.alerts?.open)) it.push({ texto: Y.alertasPainel(c.d), href: "#/alertas", label: "Abrir o Radar" });
      return { intro: "Com base nos dados de hoje:", itens: it.slice(0, 3), vazio: "Nada urgente agora. Continue enviando seus extratos para manter os números em dia." };
    }),
  ];
}

/* ================================================================ PATRIMÔNIO */
export function stepsPatrimonio() {
  return [
    { id: "intro", secao: "Abertura", titulo: "Patrimônio",
      porque: "Seus investimentos ficam espalhados em bancos e corretoras; aqui eles aparecem juntos.",
      faz: "Consolida as posições, mostra custo, resultado, liquidez, concentração e a origem de cada preço.",
      representa: c => exemplo(c) + "Fotografia da carteira na data das cotações. Informação descritiva: não é recomendação de compra ou venda." },
    exemploAviso,
    { id: "pat-total", secao: "Resumo", target: '[data-tour="pat-total"]', titulo: "Patrimônio consolidado",
      porque: "Um número único para acompanhar a carteira ao longo do tempo.",
      faz: "Soma todas as posições importadas.",
      representa: "Valor de mercado dos seus investimentos.",
      numero: c => Y.consolidado(c.p, o(c)) },
    { id: "pat-aplicado", secao: "Resumo", target: '[data-tour="pat-aplicado"]', titulo: "Valor aplicado",
      porque: "Sem saber quanto custou, não dá para saber se ganhou ou perdeu.",
      faz: "Mostra o custo das posições e avisa quando falta histórico de compras.",
      representa: "Custo de aquisição (preço médio × quantidade).",
      numero: c => Y.aplicado(c.p, o(c)),
      acao: c => c.p.result_coverage != null && n(c.p.result_coverage) < 0.999 && (c.p.positions || []).length ? { label: "Importar negociações", href: "#/importar" } : null },
    { id: "pat-resultado", secao: "Resumo", target: '[data-tour="pat-resultado"]', titulo: "Resultado",
      porque: "Mostra quanto a carteira rendeu sobre o que você pagou.",
      faz: "Mostra o resultado em reais e em percentual.",
      representa: "Ganho ou perda ainda não realizado.",
      numero: c => Y.resultado(c.p, o(c)) },
    { id: "pat-liquidez", secao: "Resumo", target: '[data-tour="pat-liquidez"]', titulo: "Liquidez em até D+2",
      porque: "Numa emergência, importa quanto vira dinheiro rápido.",
      faz: "Mostra a parte da carteira que pode ser resgatada em até 2 dias úteis.",
      representa: "D+2 significa dinheiro na conta até dois dias úteis depois do pedido.",
      numero: c => Y.liquidezD2(c.p, o(c)) },
    { id: "pat-mercado", secao: "Resumo", target: '[data-tour="pat-mercado"]', when: c => !!(c.p.market || c.p.quotes_as_of), titulo: "Referências de mercado",
      porque: "Resultado só faz sentido comparado com alternativas, como o CDI e a inflação.",
      faz: "Mostra Selic, CDI e IPCA de fontes oficiais, com data.",
      representa: "Indicadores de referência; a fonte aparece no rodapé do cartão." },
    { id: "pat-composicao", secao: "Detalhe", target: '[data-tour="pat-composicao"]', titulo: "Composição",
      porque: "Diversificar entre classes reduz o risco de um único evento.",
      faz: "Mostra a rosca e a legenda com valor e peso de cada classe.",
      representa: "Distribuição por classe de ativo.",
      numero: c => Y.composicaoPatrimonio(c.p, o(c)) },
    { id: "pat-concentracao", secao: "Detalhe", target: '[data-tour="pat-concentracao"]', titulo: "Concentração e custódia",
      porque: "Muito dinheiro num só ativo ou numa só instituição aumenta o risco.",
      faz: "Mostra a maior posição, o índice HHI e as barras por instituição.",
      representa: "Grau de concentração da carteira e onde ela está custodiada.",
      numero: c => Y.concentracao(c.p, o(c)) },
    { id: "pat-posicoes", secao: "Detalhe", target: '[data-tour="pat-posicoes"]', titulo: "Posições",
      porque: "Cada número do resumo vem destas linhas; você pode conferir uma a uma.",
      faz: "Lista ativo, classe, custódia, quantidade, aplicado, valor, resultado, peso e origem do preço.",
      representa: "A carteira ativo por ativo, com a data da cotação.",
      numero: c => Y.posicoes(c.p, o(c)) },
    fim("Resumo do patrimônio", c => {
      const it = [];
      if (c.p.result_coverage != null && n(c.p.result_coverage) < 0.999 && (c.p.positions || []).length) it.push({ texto: Y.aplicado(c.p), href: "#/importar", label: "Importar negociações" });
      if (n(c.p.concentration?.largest_weight) > 0.3) it.push({ texto: `${c.p.concentration.largest_position} concentra ${Y.pct(c.p.concentration.largest_weight, 0)} da carteira.`, href: "#/alocacao", label: "Ver alocação" });
      return { intro: "Pontos para olhar:", itens: it, vazio: "Carteira com custo conhecido e sem concentração acima de 30%." };
    }),
  ];
}

/* ================================================================ FINANÇAS */
export function stepsFinancas() {
  return [
    { id: "intro", secao: "Abertura", titulo: "Finanças",
      porque: "Entender para onde vai o dinheiro é o primeiro passo para decidir melhor.",
      faz: "Organiza os extratos em entradas, saídas, categorias, recorrências e mudanças, com a origem de cada lançamento.",
      representa: c => `${exemplo(c)}Período de ${c.f.period?.from ? mesBR(c.f.period.from) : "—"} a ${c.f.period?.to ? mesBR(c.f.period.to) : "—"}. ${c.f.reading || ""}.` },
    exemploAviso,
    { id: "fin-entradas", secao: "Resumo", target: '[data-tour="fin-entradas"]', titulo: "Entradas",
      porque: "Mostra a sua capacidade real de renda no período.",
      faz: "Soma o que entrou nas contas.",
      representa: "Receitas do período, sem movimentações entre contas e aplicações.",
      numero: c => Y.entradas(c.f, o(c)) },
    { id: "fin-saidas", secao: "Resumo", target: '[data-tour="fin-saidas"]', titulo: "Saídas",
      porque: "É o seu custo de vida: base para reserva e planejamento.",
      faz: "Soma o que saiu das contas como despesa.",
      representa: "Despesas do período.",
      numero: c => Y.saidas(c.f, o(c)) },
    { id: "fin-saldo", secao: "Resumo", target: '[data-tour="fin-saldo"]', titulo: "Saldo do período e taxa de poupança",
      porque: "Diz se você está construindo patrimônio ou consumindo.",
      faz: "Mostra entradas menos saídas e quanto da renda sobrou.",
      representa: "Taxa de poupança: parte da renda que não foi gasta.",
      numero: c => Y.saldoPeriodo(c.f, o(c)) },
    { id: "fin-contas", secao: "Resumo", target: '[data-tour="fin-contas"]', titulo: "Saldo em contas",
      porque: "É o dinheiro disponível agora.",
      faz: "Soma o saldo das contas importadas.",
      representa: "Liquidez imediata.",
      numero: c => Y.saldoContas(c.f, o(c)) },
    { id: "fin-fluxo", secao: "Gráficos", target: '[data-tour="fin-fluxo"]', titulo: "Fluxo mensal",
      porque: "Mostra meses de aperto e de folga.",
      faz: "Compara entradas e saídas de cada mês; passe o mouse para ver os valores.",
      representa: "Barras de entradas e saídas por mês.",
      numero: c => Y.fluxoMensal(c.f, o(c)) },
    { id: "fin-categorias", secao: "Gráficos", target: '[data-tour="fin-categorias"]', titulo: "Despesas por categoria",
      porque: "Mostra onde está o maior peso do orçamento.",
      faz: "Ordena as categorias do maior para o menor gasto.",
      representa: "Participação de cada categoria nas saídas.",
      numero: c => Y.categorias(c.f, o(c)) },
    { id: "fin-recorrencias", secao: "Detalhe", target: '[data-tour="fin-recorrencias"]', titulo: "Recorrências detectadas",
      porque: "Assinaturas e contas fixas somam muito sem chamar atenção.",
      faz: "Lista gastos que se repetem todo mês com valor parecido.",
      representa: "Compromissos mensais identificados nos extratos.",
      numero: c => Y.recorrencias(c.f, o(c)) },
    { id: "fin-mudancas", secao: "Detalhe", target: '[data-tour="fin-mudancas"]', titulo: "Mudanças relevantes",
      porque: "Gastos que fogem do padrão merecem atenção antes de virar hábito.",
      faz: "Compara o último mês com a média dos meses anteriores, por categoria.",
      representa: "Variações relevantes de gasto.",
      numero: c => Y.mudancas(c.f.changes, o(c)) },
    { id: "fin-cartoes", secao: "Detalhe", target: '[data-tour="fin-cartoes"]', when: c => (c.f.cards || []).length > 0, titulo: "Cartões",
      porque: "A fatura é uma dívida de curto prazo que precisa caber no saldo.",
      faz: "Mostra a fatura atual e os gastos do mês de cada cartão.",
      representa: "Cartões de crédito importados; o pagamento da fatura não conta duas vezes como despesa." },
    { id: "fin-transacoes", secao: "Detalhe", target: '[data-tour="fin-transacoes"]', titulo: "Transações",
      porque: "Todo total da página vem destas linhas; nada é calculado escondido.",
      faz: c => c.editable ? "Lista os lançamentos. Você pode corrigir a categoria: o original fica guardado e a correção vai para a auditoria. O tour não altera nada." : "Lista os lançamentos com data, descrição, categoria, valor e origem.",
      representa: c => `${n(c.tx?.total)} lançamentos no total, com o arquivo de origem de cada um.` },
    fim("Resumo das finanças", c => {
      const it = [];
      if (n(c.f.totals?.savings_rate) < 0) it.push({ texto: Y.saldoPeriodo(c.f), href: "#/alertas", label: "Ver o Radar" });
      if (n(c.f.liquidity?.avg_monthly_expense) > 0 && n(c.f.liquidity?.months_covered) < 3) it.push({ texto: Y.liquidez({ liquidity: c.f.liquidity }), href: "#/simulador", label: "Simular cenários" });
      if ((c.f.changes || []).length) it.push({ texto: Y.mudancas(c.f.changes), href: "#/financas", label: "Rever as categorias" });
      return { intro: "Pontos para olhar:", itens: it.slice(0, 3), vazio: "Saldo positivo, reserva adequada e sem mudanças fora do padrão." };
    }),
  ];
}

/* ================================================================ RADAR */
export function stepsRadar() {
  return [
    { id: "intro", secao: "Abertura", titulo: "Radar",
      porque: "Você não precisa vigiar os números: o Radar avisa o que merece atenção.",
      faz: "Lista alertas com evidência, prioridade, regra e próximo passo.",
      representa: "Pontos de atenção gerados por regras sobre os seus dados.",
      numero: c => Y.radarResumo(c.res, o(c)) },
    exemploAviso,
    { id: "radar-criterio", secao: "Como ler", target: '[data-tour="radar-criterio"]', titulo: "Critério de prioridade",
      porque: "Nem todo alerta é urgente; a ordem precisa ser explicável.",
      faz: "Explica como a lista é ordenada.",
      representa: "Impacto × urgência × relevância × confiança. Cor sempre vem com rótulo e ícone." },
    { id: "radar-filtro", secao: "Como ler", target: '[data-tour="radar-filtro"]', titulo: "Filtro",
      porque: "Separar o que está pendente do que já foi tratado.",
      faz: "Alterna entre Em aberto, Resolvidos e Todos.",
      representa: "A situação de cada alerta." },
    { id: "radar-alerta", secao: "Um alerta", target: '[data-tour="radar-lista"] article', when: c => (c.res.items || []).length > 0, titulo: c => `Lendo um alerta: ${(c.res.items || [])[0]?.title || ""}`,
      porque: "Cada alerta mostra o que aconteceu, a evidência e o que fazer.",
      faz: "Mostra título, gravidade, detalhe, evidências com valores, prioridade, regra e prazo.",
      representa: "Um ponto de atenção rastreável até a regra que o gerou.",
      numero: c => Y.alertaPrioridade(c.res.items[0], o(c)) },
    { id: "radar-botoes", secao: "Um alerta", target: '[data-tour="radar-lista"] article [data-st]', when: c => (c.res.items || []).length > 0, titulo: "Visto, resolver e explicar",
      porque: "Você controla o que já tratou; o alerta não some sozinho.",
      faz: "“Marcar como visto” e “Resolver” mudam só a situação do alerta. “Explicar com IA” abre o assistente com a pergunta pronta. O tour não clica em nada.",
      representa: "O ciclo do alerta: novo → visto → resolvido (e reabrir, se precisar)." },
    fim("Resumo do Radar", c => {
      const ab = (c.res.items || []).filter(a => a.status !== "resolvido").slice(0, 3);
      return { intro: "Os mais prioritários agora:", itens: ab.map(a => ({ texto: `${a.title} — prioridade ${String(a.priority).replace(".", ",")}.`, href: a.action ? "#" + a.action.route : "#/alertas", label: a.action?.label || "Ver alerta" })), vazio: "Nenhum alerta em aberto." };
    }),
  ];
}

/* ================================================================ SIMULADOR */
export function stepsSimulador() {
  return [
    { id: "intro", secao: "Abertura", titulo: "Simulador",
      porque: "Decidir antes de agir: ver o imposto e a liquidez de uma decisão antes de tomá-la.",
      faz: "Compara o cenário atual com cenários hipotéticos de venda de ativos ou de aporte em PGBL.",
      representa: "Planejamento tributário simulado, com premissas explícitas. Não é recomendação.",
      numero: c => Y.simuladorBase(c.pf, c.sims, c.real, o(c)) },
    { id: "sim-exemplo", secao: "Abertura", target: '[data-tour="sim-exemplo"]', when: c => !c.real, titulo: "Exemplo ilustrativo",
      porque: "Sem negociações importadas, a simulação usa uma carteira de exemplo.",
      faz: "Leva a Importar dados para simular sobre a sua carteira.",
      representa: "Dados fictícios.",
      acao: () => ({ label: "Importar dados", href: "#/importar" }) },
    { id: "sim-abas", secao: "Cenários", target: '[data-tour="sim-abas"]', titulo: "Tipos de simulação",
      porque: "Cada decisão tem uma regra tributária diferente.",
      faz: "Alterna entre Venda de ativos e Aporte em PGBL/VGBL.",
      representa: "Os dois simuladores disponíveis." },
    { id: "sim-form-venda", secao: "Cenários", tab: "venda", target: '[data-tour="sim-form"]', titulo: "Cenário de venda",
      porque: "Vender mais em um mês pode estourar o limite de isenção; vender no mês seguinte pode mudar o imposto.",
      faz: "Escolha o ativo, a parte da posição e a data. Com dados reais, dá para informar o preço e comparar com um cenário C.",
      representa: "Uma venda hipotética aplicada sobre as suas negociações reais, pelas mesmas regras da Tributação." },
    { id: "sim-form-pgbl", secao: "Cenários", tab: "pgbl", target: '[data-tour="sim-form"]', titulo: "Cenário de PGBL",
      porque: "No modelo completo, contribuições ao PGBL podem ser deduzidas até 12% da renda tributável.",
      faz: "Informe renda, contribuições já feitas, o aporte extra e a alíquota marginal; o sistema calcula a dedução e o efeito estimado.",
      representa: "Efeito do aporte na base de cálculo do imposto anual. A alíquota é uma premissa sua." },
    { id: "sim-como", secao: "Cenários", target: '[data-tour="sim-como"]', titulo: "Como funciona",
      porque: "Simulação só é útil se você souber o que ela considera.",
      faz: "Explica a comparação entre o cenário atual e a alternativa.",
      representa: "Resultado reprodutível (hash de versão), com as regras da Central Tributária." },
    { id: "sim-resultado", secao: "Resultado", titulo: "Resultado da simulação",
      porque: "O resultado mostra consequências, não promessas.",
      faz: "Depois de clicar em Simular, aparecem o imposto do ano em cada cenário, a diferença, a liquidez gerada, o efeito por mês, a confiança e as premissas.",
      representa: "Quem decide é você ou o seu contador. O tour não executa simulações." },
    { id: "sim-salvas", secao: "Resultado", target: '[data-tour="sim-salvas"]', when: c => (c.sims?.items || []).length > 0, titulo: "Simulações salvas",
      porque: "Guardar permite comparar decisões ao longo do tempo.",
      faz: "Lista as últimas simulações com data e código de reprodutibilidade.",
      representa: c => `${(c.sims.items || []).length} simulação(ões) salvas.` },
  ];
}
