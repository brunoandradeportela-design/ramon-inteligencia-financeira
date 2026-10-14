/* Catálogo do tour das abas do Trader Intelligence (a Visão Trader fica em tour_paginas2.js).
 * Cada aba é uma rota própria (#/trader?tab=…) e tem progresso próprio (aurion.tour.trader-<aba>). */
import * as W from "./tour_explain4.js";

export const TOUR_TRADER_VERSAO = "1";
const AVISO = "O tour só explica: não registra, não apaga e não roda nada.";
const s = (id, titulo, target, porque, faz, representa, numero, extra = {}) => ({ id, secao: "Trader", titulo, target, porque, faz, representa, numero, ...extra });

const ABAS = {
  mercado: () => [
    s("trm-form", "Escolher ativo e período", '[data-tour="trm-form"]', "Analisar um ativo antes de operar ou para entender o que aconteceu.",
      "Digite o código, escolha 3 meses, 6 meses, 1 ou 2 anos e clique em Ver.", "Consulta de preços históricos diários."),
    s("trm-kpis", "Indicadores do ativo", '[data-tour="trm-kpis"]', "Resumem tendência, força e risco do preço sem precisar ler o gráfico inteiro.",
      "Mostram último preço, variação do dia, médias de 20 e 50 pregões, IFR(14) e volatilidade anual.", "Indicadores técnicos calculados sobre os fechamentos. Não são recomendação.",
      c => W.mercadoIndicadores(c.o)),
    s("trm-grafico", "Gráfico de candles", '[data-tour="trm-grafico"]', "O candle mostra abertura, máxima, mínima e fechamento de cada pregão.",
      "Corpo verde: fechou acima da abertura; vermelho: abaixo. O texto alternativo descreve o gráfico para leitores de tela.", "Histórico diário do ativo.",
      c => W.mercadoFonte(c.o)),
  ],
  watchlist: () => [
    s("trw-form", "Criar lista", '[data-tour="trw-form"]', "Acompanhar de perto os ativos que você estuda.", "Dê um nome e informe os códigos separados por vírgula. " + AVISO, "Listas pessoais de acompanhamento."),
    s("trw-listas", "Suas listas", '[data-tour="trw-listas"]', "Ver de uma vez como estão os ativos que interessam.", "Cada lista mostra último fechamento, variação do dia e data; o código abre a aba Mercado.", "Cotações de fechamento dos ativos acompanhados.",
      c => W.watchlists(c.o)),
  ],
  operacoes: () => [
    s("tro-form", "Registrar operação", '[data-tour="tro-form"]', "Sem registro, não há como calcular resultado nem imposto.",
      "Anote compra ou venda já feita na corretora: ativo, quantidade, preço, custos, data e estratégia. Ou importe as negociações da B3. " + AVISO,
      "Um registro alimenta Finanças, Tributação e Trader ao mesmo tempo. O AURION não envia ordens."),
    s("tro-lista", "Histórico de operações", '[data-tour="tro-lista"]', "Erros de digitação acontecem; o histórico garante que nada some.",
      "“Corrigir preço” cria nova versão; “Anular” vale para registros manuais. A versão anterior fica no histórico e na auditoria.", "Todas as operações, com origem e situação.",
      c => W.operacoes(c.o)),
  ],
  estrategias: () => [
    s("tre-form", "Strategy Lab", '[data-tour="tre-form"]', "Escrever as regras antes de operar ajuda a manter a disciplina.",
      "Dê um nome, descreva as regras e, se quiser, ligue a um modelo testável no Backtest. " + AVISO, "Estratégia é hipótese de estudo, não recomendação."),
    s("tre-lista", "Suas estratégias", '[data-tour="tre-lista"]', "Comparar estratégias pelo resultado real.", "Cada cartão mostra as regras e, se houver modelo, o link “testar”.", "Estratégias registradas.",
      c => W.estrategias(c.o)),
  ],
  backtest: () => [
    s("trb-form", "Configurar o backtest", '[data-tour="trb-form"]', "Ver como uma regra teria se saído no passado antes de arriscar dinheiro.",
      "Escolha ativo, modelo, capital, custo por operação, slippage (diferença entre o preço pedido e o executado) e a parte fora da amostra. " + AVISO,
      "Simulação histórica com custos; a parte fora da amostra testa a regra em dados que não foram usados para ajustá-la."),
    s("trb-resultado", "Resultado", null, "Retorno sozinho engana; é preciso ver risco e comparar com simplesmente comprar e segurar.",
      "Depois de rodar, mostra retorno total e anual, queda máxima, operações, acerto e comparação com comprar e segurar, para o período completo, dentro e fora da amostra.",
      "Resultado passado não garante resultado futuro.", null, { espera: 400 }),
    s("trb-execucoes", "Execuções anteriores", '[data-tour="trb-execucoes"]', "Guardar permite comparar e conferir.", "“Reproduzir” roda de novo com os mesmos dados e parâmetros.", "Histórico reproduzível.",
      c => W.backtests(c.o), { when: c => (c.o?.bt?.items || []).length > 0 }),
  ],
  performance: () => [
    s("trp-kpis1", "Resultado, custos e imposto", '[data-tour="trp-kpis1"]', "O que fica no bolso é o líquido depois do imposto.", "Mostra bruto, custos, líquido e imposto estimado.", "Resultado das operações fechadas.",
      c => W.performance(c.o)),
    s("trp-kpis2", "Qualidade das operações", '[data-tour="trp-kpis2"]', "Mostram se o resultado vem de método ou de sorte.", "Taxa de acerto, payoff, profit factor e expectativa por operação.", "Indicadores de desempenho."),
    s("trp-curva", "Resultado acumulado", '[data-tour="trp-curva"]', "A curva mostra a consistência e as fases de perda.", "Soma o líquido operação a operação; o drawdown máximo é a maior queda da curva.", "Evolução do resultado líquido."),
    s("trp-tabelas", "Por ativo, estratégia, dia e tipo", '[data-tour="trp-tabelas"]', "Descobrir onde você ganha e onde perde.", "Agrupa operações, acerto e líquido.", "O mesmo resultado em recortes diferentes.",
      c => W.performanceTabelas(c.o)),
    s("trp-fechadas", "Operações fechadas", '[data-tour="trp-fechadas"]', "Cada número acima vem destas linhas.", "Lista entrada, saída, quantidade, bruto, custos, líquido e imposto estimado de cada operação.", "Pareamento de compras e vendas por ordem de entrada (FIFO)."),
  ],
  impostos: () => [
    s("tri-kpis", "Imposto do ano e qualidade", '[data-tour="tri-kpis"]', "Ligar cada operação ao imposto evita surpresa no fim do mês.", "Mostra o imposto do ano pela apuração, os prejuízos a compensar e a qualidade do cálculo.", "Números da apuração mensal da Tributação.",
      c => W.impostos(c.o)),
    s("tri-tabela", "Impacto por operação", '[data-tour="tri-tabela"]', "Saber quanto de imposto cada operação gera ajuda a avaliar o resultado real.", "Para cada operação fechada: bruto, custos, líquido, alíquota, imposto estimado e valor após imposto.", "Estimativa por operação; o valor oficial é o da apuração mensal.",
      null, { acao: () => ({ label: "Ver apuração mensal", href: "#/tributacao" }) }),
  ],
  risco: () => [
    s("trr-kpis1", "Exposição, concentração e VaR", '[data-tour="trr-kpis1"]', "Saber quanto pode perder num dia ruim é tão importante quanto saber quanto ganhou.", "Mostra exposição total, maior posição, VaR 95% de 1 dia e drawdown das operações.", "Medidas de risco da carteira em bolsa.",
      c => W.risco(c.o)),
    s("trr-kpis2", "Histórico de perdas", '[data-tour="trr-kpis2"]', "Os piores momentos mostram quanto risco você realmente correu.", "Pior dia, pior semana, número de operações, tamanho médio e perda média.", "Risco realizado.",
      c => W.riscoHistorico(c.o)),
    s("trr-exposicao", "Exposição por ativo", '[data-tour="trr-exposicao"]', "Risco concentrado num ativo pesa mais.", "Valor, peso, volatilidade anual e VaR de cada ativo.", "VaR somado sem diversificação: visão conservadora."),
  ],
  diario: () => [
    s("trd-form", "Novo registro no journal", '[data-tour="trd-form"]', "Anotar contexto e justificativa revela padrões de comportamento.", "Data, operação vinculada, tags, contexto, justificativa e resultado. " + AVISO, "Seu diário de operações."),
    s("trd-lista", "Journal", '[data-tour="trd-lista"]', "Reler decisões passadas melhora as próximas.", "Lista os registros com as tags.", "Histórico de anotações.",
      c => W.journal(c.o)),
  ],
  paper: () => [
    s("trpa-form", "Registrar simulação", '[data-tour="trpa-form"]', "Testar decisões sem dinheiro.", "Informe ativo, lado, quantidade, preço e data. " + AVISO, "Operações simuladas, fora dos impostos e do patrimônio."),
    s("trpa-kpis", "Resultado simulado", '[data-tour="trpa-kpis"]', "Mostra se a ideia funcionaria.", "Resultado, acerto e operações fechadas das simulações.", "Desempenho das simulações.",
      c => W.paper(c.o)),
    s("trpa-lista", "Registros", '[data-tour="trpa-lista"]', "Conferir e limpar simulações.", "Lista as simulações com o botão Remover.", "Histórico das simulações."),
  ],
  radar: () => [
    s("trra-lista", "Radar Trader", '[data-tour="trra-lista"]', "Avisa o que merece atenção nas suas operações: limite de isenção, DARF, concentração, dados faltando.",
      "Cada item tem gravidade, explicação e, quando houver, um botão para a tela certa.", "Alertas gerados por regras sobre as suas operações.",
      c => W.radarTrader(c.o)),
  ],
  divulgacoes: () => [
    s("trdv", "Divulgações públicas", "#tb", "Fatos relevantes e comunicados da CVM podem mexer com os ativos que você tem.",
      "Lista as divulgações recentes, com prioridade para as empresas da sua carteira, e o link do documento original.", "Documentos públicos da CVM. Não são recomendação.", null, { espera: 1500 }),
  ],
  eventos: () => [
    s("trev", "Eventos", "#tb", "Datas como pagamento de proventos, assembleias e vencimentos afetam caixa e imposto.",
      "Mostra os eventos ligados aos seus ativos e o que cada um muda para você.", "Calendário de eventos de fontes públicas.", null, { espera: 1500 }),
  ],
};

export function stepsTraderAba(tab) {
  const passos = (ABAS[tab] || (() => []))();
  return [{ id: "intro-" + tab, secao: "Trader", titulo: "Trader Intelligence", porque: "Cada aba do Trader responde a uma pergunta sobre as suas operações.",
    faz: "Este tour explica os blocos desta aba. A Visão Trader tem o tour geral.", representa: "O AURION analisa operações; não executa ordens nem faz recomendação individualizada." }, ...passos];
}
export const ABAS_COM_TOUR = Object.keys(ABAS);
