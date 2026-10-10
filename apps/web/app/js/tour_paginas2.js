/* Catálogos do tour de Notícias, Trader Intelligence, Inteligência, Documentos, Importar, Conexões e Configurações.
 * Textos fixos explicam o porquê e o funcionamento; números vêm de tour_explain3.js com os dados da tela. */
import * as Z from "./tour_explain3.js";

export const TOUR_PAGINAS2_VERSAO = "1";
const n = v => +v || 0;

/* ================================================================ NOTÍCIAS */
export function stepsNoticias() {
  return [
    { id: "intro", secao: "Abertura", titulo: "Notícias",
      porque: "O que acontece no mercado e nos órgãos oficiais pode afetar seus ativos e seus impostos.",
      faz: "Reúne o AURION Daily e as notícias de fontes oficiais e públicas, com data e link de origem.",
      representa: "Informação, não recomendação: nada aqui diz para comprar ou vender." },
    { id: "news-daily", secao: "AURION Daily", target: '[data-tour="news-daily"]', titulo: "AURION Daily",
      porque: "Em um minuto você sabe o que mudou na sua vida financeira e no mercado.",
      faz: "Resume patrimônio, impostos, eventos, índices, notícias e divulgações ligados a você.",
      representa: "Um boletim diário montado por regras sobre os seus dados.",
      numero: c => Z.daily(c.daily) },
    { id: "news-ouvir", secao: "AURION Daily", target: '[data-tour="news-ouvir"]', titulo: "Ouvir o Daily",
      porque: "Para acompanhar no trânsito ou longe da tela.",
      faz: "Lê o resumo em voz alta. Clique de novo para parar. O tour não aciona o áudio.",
      representa: "O mesmo texto do Daily, em áudio." },
    { id: "news-lista", secao: "Notícias", target: '[data-tour="news-lista"]', titulo: "Notícias",
      porque: "Separar o que importa para você do volume de notícias do dia.",
      faz: "Lista títulos com fonte, data e o motivo de estar ali; o link abre a publicação original.",
      representa: "Notícias coletadas automaticamente das fontes listadas no rodapé.",
      numero: c => Z.noticias(c.ranked, c.sources) },
    { id: "news-filtro", secao: "Notícias", target: '[data-tour="news-filtro"]', titulo: "Para você ou Todas",
      porque: "Às vezes você quer só o que afeta a carteira; às vezes, o panorama completo.",
      faz: "“Para você” mostra só notícias ligadas aos seus ativos e temas; “Todas” mostra tudo.",
      representa: "O filtro de relevância pessoal." },
    { id: "news-fontes", secao: "Notícias", target: '[data-tour="news-fontes"]', titulo: "Fontes",
      porque: "Você precisa saber de onde veio cada informação e se a fonte está em dia.",
      faz: "Lista as fontes e avisa quando alguma está sem publicações recentes ou indisponível.",
      representa: "Transparência sobre a coleta." },
  ];
}

/* ================================================================ TRADER */
export function stepsTrader() {
  return [
    { id: "tr-banner", secao: "Abertura", target: '[data-tour="tr-banner"]', titulo: "Trader Intelligence",
      porque: "Quem opera com frequência precisa medir desempenho, risco e imposto de cada operação.",
      faz: "Analisa as operações que você registrou ou importou. Não envia, não cancela e não automatiza ordens.",
      representa: "“AURION não executa a operação. AURION entende a operação.” Sem recomendação individualizada." },
    { id: "tr-abas", secao: "Abertura", target: '[data-tour="tr-abas"]', titulo: "Áreas do Trader",
      porque: "Cada aba responde a uma pergunta diferente sobre as suas operações.",
      faz: "Mercado (cotações e indicadores), Watchlist, Operações (registro), Estratégias, Backtest, Performance, Análise Tributária, Divulgações, Eventos, Radar, Journal, Risco e Paper (simulação sem dinheiro).",
      representa: "Este tour cobre a Visão Trader; as outras abas abrem a partir daqui." },
    { id: "tr-kpis", secao: "Indicadores", target: '[data-tour="tr-kpis"]', titulo: "Resultado e imposto das operações",
      porque: "Resultado sem descontar custos e imposto engana.",
      faz: "Mostra o resultado líquido das operações fechadas e o imposto estimado delas.",
      representa: "Desempenho realizado: só entram operações já encerradas.",
      numero: c => `${Z.traderResultado(c.o)} ${Z.traderImposto(c.o)}` },
    { id: "tr-acerto", secao: "Indicadores", target: '[data-tour="tr-kpis"]', titulo: "Taxa de acerto, profit factor e drawdown",
      porque: "Acertar muito e perder grande pode dar prejuízo; estes números mostram o equilíbrio.",
      faz: "Medem a frequência de acertos, a relação entre ganhos e perdas e a maior queda acumulada.",
      representa: "Indicadores clássicos de desempenho de operações.",
      numero: c => `${Z.traderAcerto(c.o)} ${Z.traderDrawdown(c.o)}` },
    { id: "tr-abertas", secao: "Carteira", target: '[data-tour="tr-abertas"]', titulo: "Posições abertas",
      porque: "O que ainda está em aberto representa risco em andamento.",
      faz: "Lista ativo, lado (comprado ou vendido), quantidade e preço médio.",
      representa: c => `${(c.o.open || []).length} posição(ões) aberta(s), que ainda não entram no resultado.` },
    { id: "tr-estrategia", secao: "Carteira", target: '[data-tour="tr-estrategia"]', titulo: "Performance por estratégia",
      porque: "Saber qual estratégia funciona ajuda a manter disciplina.",
      faz: "Soma o resultado líquido das operações associadas a cada estratégia.",
      representa: c => (c.o.by_strategy || []).length ? `${c.o.by_strategy.length} estratégia(s) com operações associadas.` : "Associe operações a estratégias na aba Operações para ver esta comparação." },
    { id: "tr-ferramentas", secao: "Carteira", target: '[data-tour="tr-ferramentas"]', titulo: "Watchlist, journal e backtests",
      porque: "Registro e teste antes de operar melhoram decisões.",
      faz: "Conta ativos acompanhados, anotações do diário e backtests feitos.",
      representa: c => `${(c.o.watched || []).length} ativo(s) acompanhado(s), ${n(c.o.journal_entries)} registro(s) no journal e ${n(c.o.backtests)} backtest(s).` },
    { id: "tr-darf", secao: "Imposto", target: '[data-tour="tr-darf"]', titulo: "Próximo DARF",
      porque: "Day trade e operações comuns geram guia mensal com prazo.",
      faz: "Mostra a próxima guia em aberto, vinda da apuração da Tributação.",
      representa: c => c.o.tax?.next_darf ? `Guia de ${Z.mesBR(c.o.tax.next_darf.competencia)}: vencimento no último dia útil do mês seguinte. Gere a guia na Tributação.` : "Sem guia em aberto.",
      acao: () => ({ label: "Abrir a Tributação", href: "#/tributacao" }) },
  ];
}

/* ================================================================ INTELIGÊNCIA */
export function stepsInteligencia() {
  return [
    { id: "intro", secao: "Abertura", titulo: "Inteligência",
      porque: "Às vezes é mais rápido perguntar do que procurar o número em várias telas.",
      faz: "Responde perguntas sobre os seus números com evidência, fonte e premissas.",
      representa: "A IA explica; quem calcula são os motores determinísticos do AURION." },
    { id: "ia-chat", secao: "Conversa", target: '[data-tour="ia-chat"]', titulo: "Conversa",
      porque: "Cada resposta precisa poder ser conferida.",
      faz: "Mostra a resposta, botões para a tela certa, evidências com a origem de cada número e fontes oficiais quando houver.",
      representa: "Cada resposta registra intenção, ferramentas usadas e checagem de consistência." },
    { id: "ia-pergunta", secao: "Conversa", target: '[data-tour="ia-pergunta"]', titulo: "Fazer uma pergunta",
      porque: "Você pergunta do seu jeito, sem precisar saber o nome da tela.",
      faz: "Escreva a pergunta e envie. Para simular, escreva por exemplo “simular venda de 100 PETR4”. O tour não envia perguntas.",
      representa: "Perguntas de compra ou venda são bloqueadas pela regulação da CVM." },
    { id: "ia-sugestoes", secao: "Conversa", target: '[data-tour="ia-sugestoes"]', titulo: "Perguntas sugeridas",
      porque: "Um ponto de partida para quem não sabe o que perguntar.",
      faz: "Um clique envia a pergunta.",
      representa: "As dúvidas mais comuns sobre imposto, gastos, alertas e patrimônio." },
    { id: "ia-como", secao: "Conversa", target: '[data-tour="ia-como"]', titulo: "Como a IA funciona aqui",
      porque: "Confiança vem de saber os limites.",
      faz: "Explica a classificação da pergunta, a checagem dos números e os bloqueios.",
      representa: "Nenhum número sem evidência é exibido." },
  ];
}

/* ================================================================ DOCUMENTOS */
export function stepsDocumentos() {
  return [
    { id: "intro", secao: "Abertura", titulo: "Documentos",
      porque: "Na hora da declaração, ter cada comprovante no lugar evita correria e erro.",
      faz: "Guarda informes, notas, comprovantes de DARF e recibos, e liga cada um ao checklist do IR.",
      representa: "Seu arquivo pessoal, acessível só por você.",
      numero: c => Z.documentosLista(c.res) },
    { id: "doc-guardar", secao: "Guardar", target: '[data-tour="doc-guardar"]', titulo: "Guardar documento",
      porque: "Um lugar único para os papéis do imposto.",
      faz: "Envie o arquivo, escolha o tipo (ou deixe detectar pelo nome) e o ano-calendário. Extratos e relatórios da B3 que entram nos cálculos vão em Importar dados.",
      representa: "Arquivos de até 8 MB, guardados na sua conta." },
    { id: "doc-checklist", secao: "Declaração", target: '[data-tour="doc-checklist"]', titulo: "Checklist da declaração",
      porque: "Mostra o que já está pronto e o que falta para declarar.",
      faz: "Marca cada item conforme os documentos guardados e os dados importados; troque o ano no seletor.",
      representa: "Lista de conferência; confira com o seu contador.",
      numero: c => Z.checklistIR(c.res.checklist) },
    { id: "doc-lista", secao: "Declaração", target: '[data-tour="doc-lista"]', titulo: "Meus documentos",
      porque: "Corrigir o tipo e o ano mantém o checklist certo.",
      faz: "Lista os arquivos; “Ler dados” extrai as informações de PDFs e o resultado é revalidado antes de ser usado. O tour não altera nada.",
      representa: "Seus documentos com tipo, ano, tamanho e data." },
  ];
}

/* ================================================================ IMPORTAR */
export function stepsImportar() {
  return [
    { id: "imp-intro", secao: "Abertura", target: '[data-tour="imp-intro"]', titulo: "Importar dados",
      porque: "Os painéis, o imposto e os alertas só refletem a sua realidade com os seus dados.",
      faz: "Lê no navegador os arquivos que você já baixa do banco e da B3; só lançamentos e posições vão para a sua conta.",
      representa: "A porta de entrada dos seus números reais. Você pode apagar qualquer importação." },
    { id: "imp-tipos", secao: "Arquivos", target: '[data-tour="imp-tipos"]', titulo: "Que arquivos enviar",
      porque: "Cada arquivo alimenta uma parte: extrato → Finanças; posição → Patrimônio; negociações → custo médio e imposto.",
      faz: "Mostra onde baixar cada arquivo. As negociações devem vir desde a primeira compra.",
      representa: "OFX/CSV do banco, Excel da Área do Investidor da B3 e nota de corretagem em PDF." },
    { id: "imp-form", secao: "Arquivos", target: '[data-tour="imp-form"]', titulo: "Ler arquivo",
      porque: "Conferir antes de gravar evita dados errados nos cálculos.",
      faz: "Escolha o arquivo e clique em Ler: aparece uma prévia para você confirmar. O tour não envia arquivos.",
      representa: "Leitura com validação de tipo, conteúdo e duplicidade." },
    { id: "imp-lista", secao: "Histórico", target: '[data-tour="imp-lista"]', titulo: "Importações",
      porque: "Saber o que entrou e de onde veio permite corrigir ou desfazer.",
      faz: "Lista cada importação com os registros que trouxe; apagar uma remove só o que ela trouxe.",
      representa: "O histórico das suas fontes de dados.",
      numero: c => Z.importacoes(c.list) },
  ];
}

/* ================================================================ CONEXÕES */
export function stepsConexoes() {
  return [
    { id: "con-of", secao: "Open Finance", target: '[data-tour="con-of"]', titulo: "Conexão com bancos e corretoras",
      porque: "Conectar mantém os dados atualizados sem enviar arquivos.",
      faz: "Pelo Open Finance regulado pelo Banco Central, a autorização acontece no ambiente da instituição; você pode desconectar quando quiser.",
      representa: "Nunca pedimos nem guardamos a senha do banco.",
      numero: c => Z.openFinance(c.st) },
    { id: "con-qualidade", secao: "Dados", target: '[data-tour="con-qualidade"]', titulo: "Qualidade dos dados",
      porque: "Cálculo bom depende de dado bom; a nota mostra onde melhorar.",
      faz: `Avalia cinco indicadores com pesos: ${Z.COMO_INDICADORES}. Mostra também reconciliação e origens.`,
      representa: "Qualidade e completude dos dados, não garantia jurídica ou fiscal.",
      numero: c => Z.qualidadeDados(c.dq) },
    { id: "con-consentimentos", secao: "Dados", target: '[data-tour="con-consentimentos"]', titulo: "Consentimentos",
      porque: "Pela LGPD, você controla quem acessa seus dados, para quê e até quando.",
      faz: "Lista cada consentimento com instituição, escopo, finalidade, validade e situação.",
      representa: "O registro das autorizações que você deu." },
  ];
}

/* ================================================================ CONFIGURAÇÕES */
export function stepsConfiguracoes() {
  return [
    { id: "cfg-aparencia", secao: "Conta", target: '[data-tour="cfg-aparencia"]', titulo: "Aparência",
      porque: "Conforto de leitura.", faz: "Claro, escuro ou seguir o sistema.", representa: "Trocar o tema nunca altera dados ou cálculos." },
    { id: "cfg-perfil", secao: "Conta", target: '[data-tour="cfg-perfil"]', titulo: "Perfil",
      porque: "Seus dados de contato e objetivos personalizam alertas e o Daily.", faz: "Mostra nome, e-mail, profissão e objetivos.", representa: "Os dados do cadastro." },
    { id: "cfg-email", secao: "Avisos", target: '[data-tour="cfg-email"]', espera: 2500, titulo: "Notificações por e-mail",
      porque: "Prazos importantes não podem depender de você abrir o aplicativo.", faz: "Escolha quais avisos e resumos chegam por e-mail.", representa: "Suas preferências de comunicação." },
    { id: "cfg-compartilhar", secao: "Compartilhar", target: '[data-tour="cfg-compartilhar"]', espera: 2500, titulo: "Compartilhar com o contador",
      porque: "O contador ou assessor pode conferir seus números sem pedir arquivos.", faz: "Concede acesso somente leitura, que você revoga quando quiser; cada consulta fica na auditoria.", representa: "Acesso delegado e rastreado." },
    { id: "cfg-integracoes", secao: "Compartilhar", target: '[data-tour="cfg-integracoes"]', espera: 2500, titulo: "Integrações",
      porque: "Levar os números para as ferramentas que você já usa.", faz: "Mostra as integrações disponíveis e o estado de cada uma.", representa: "Conexões opcionais com outros serviços." },
    { id: "cfg-seguranca", secao: "Segurança", target: '[data-tour="cfg-seguranca"]', espera: 2500, titulo: "Segurança da conta",
      porque: "Sua conta guarda dados financeiros sensíveis.", faz: "Troque a senha, cadastre o CPF para entrar e ative a verificação em duas etapas.", representa: "Proteções de acesso." },
    { id: "cfg-sessoes", secao: "Segurança", target: '[data-tour="cfg-sessoes"]', espera: 2500, titulo: "Sessões e dispositivos",
      porque: "Ver onde a conta está aberta ajuda a perceber acessos estranhos.", faz: "Lista os aparelhos conectados e permite encerrar sessões. O tour não encerra nada.", representa: "Os acessos ativos da sua conta." },
  ];
}
