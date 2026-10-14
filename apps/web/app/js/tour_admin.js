/* Tours das páginas do administrador: CRM, Pagamentos e Operações.
 * Números explicados com as fórmulas de crm_rules.js (métricas do funil e receita) e worker/src/metrics.js (SLOs). */
import { brl } from "./tour_explain.js";

export const TOUR_ADMIN_VERSAO = "1";
const n = v => +v || 0;
const pct = (v, d = 0) => (v == null || !isFinite(v) ? "—" : (Math.round(v * 100 * 10 ** d) / 10 ** d).toLocaleString("pt-BR", { maximumFractionDigits: d }) + "%");
const plural = (q, s, p) => `${q} ${q === 1 ? s : p}`;

/* ------------------------------------------------------------------ frases puras */
export function crmKpis(m) {
  if (!m) return "Métricas indisponíveis.";
  return `${plural(n(m.total), "cliente", "clientes")}, ${n(m.paying)} pagante(s). Conversão = pagantes ÷ cadastrados = ${pct(m.conversion)}. Ativação = clientes que passaram da etapa “novo cadastro” ÷ cadastrados = ${pct(m.activation)}. MRR = soma das mensalidades dos pagantes = ${brl(m.mrr)}; ARR = MRR × 12 = ${brl(m.arr)}. Ticket médio = MRR ÷ pagantes = ${brl(m.ticket_medio)}, ${m.ticket_ok ? "acima" : "abaixo"} da meta de ${brl(m.ticket_target)}. Inadimplentes: ${n(m.overdue)}, somando ${brl(m.overdue_value)} por mês.`;
}
export function crmFunil(m) {
  const st = m?.stages || [];
  return st.length ? `Clientes por etapa: ${st.map(s => `${s.label} ${s.count}`).join(", ")}. A barra é proporcional ao total de cadastrados; clicar numa etapa filtra a lista.` : "Sem clientes ainda.";
}
export function pagamentosKpis(res) {
  const t = res?.totals; if (!t) return "Sem cobranças carregadas.";
  return `Recebido ${brl(t.recebido)} em ${plural(n(t.count?.pago), "cobrança", "cobranças")} (líquido de taxas ${brl(t.recebido_liquido)}). A receber ${brl(t.pendente)}; em atraso ${brl(t.atrasado)} em ${plural(n(t.count?.atrasado), "cobrança vencida", "cobranças vencidas")}; estornado ${brl(t.estornado)}. ${plural(n(t.sem_vinculo), "cobrança está", "cobranças estão")} sem vínculo com um cliente cadastrado. Os totais seguem os filtros aplicados.`;
}
export function opsKpis(d) {
  if (!d) return "Métricas indisponíveis.";
  return `${n(d.requests).toLocaleString("pt-BR")} requisições nas últimas ${d.window_hours} h. Disponibilidade = 1 − respostas 5xx ÷ requisições = ${d.availability == null ? "—" : pct(d.availability, 2)} (meta ${pct(d.slo?.availability_target, 1)}: ${d.slo?.availability_ok ? "cumprida" : d.slo?.availability_ok === false ? "não cumprida" : "sem tráfego"}). Latência p95 ${d.p95_ms == null ? "—" : "≤ " + d.p95_ms + " ms"}: 95% das respostas saíram nesse tempo ou menos (meta ${d.slo?.p95_target_ms} ms). Falhas de login na janela: ${n(d.security?.login_failures)}.`;
}

/* ------------------------------------------------------------------ catálogos */
const st = (id, secao, titulo, target, porque, faz, representa, numero, extra = {}) => ({ id, secao, titulo, target, porque, faz, representa, numero, ...extra });
export const stepsCrm = () => [
  st("crm-kpis", "Indicadores", "Indicadores do negócio", '[data-tour="crm-kpis"]', "Mostram se a plataforma está crescendo e pagando as contas.",
    "Cadastros, pagantes, receita recorrente, ticket médio, recebido no mês e inadimplência.", "Métricas de cadastro e assinatura — nunca dados financeiros dos clientes (minimização da LGPD).", c => crmKpis(c.m)),
  st("crm-funil", "Funil", "Funil de clientes", '[data-tour="crm-funil"]', "Mostra onde os clientes param entre o cadastro e o pagamento.",
    "Cada etapa mostra quantos clientes estão nela; clicar filtra a lista.", "Novo cadastro → ativado → aguardando pagamento → pagante, além de inadimplente e cancelado.", c => crmFunil(c.m)),
  st("crm-semana", "Funil", "Cadastros por semana", '[data-tour="crm-semana"]', "Ver o efeito de campanhas e divulgação.", "Barras de cadastros por semana, com profissões e planos.", "Ritmo de aquisição."),
  st("crm-busca", "Clientes", "Busca e exportação", '[data-tour="crm-busca"]', "Encontrar um cliente rápido e levar a lista para outra ferramenta.",
    "Busque por nome, e-mail, telefone ou profissão; filtre por etapa e plano; exporte em CSV. Abrir um cliente fica registrado na auditoria dele.", "A base de clientes."),
  st("crm-msgs", "Clientes", "Mensagens do site", '[data-tour="crm-msgs"]', "Contatos pelo formulário do site precisam de resposta.",
    "Lista as mensagens; a situação (novo, respondido, arquivado) muda no seletor. O tour não altera nada.", "Mensagens recebidas pelo “Fale com a AURION”.", null, { espera: 2000 }),
];
export const stepsPagamentos = () => [
  st("pag-gw", "Gateway", "Asaas", '[data-tour="pag-gw"]', "Saber se a cobrança automática está funcionando.",
    "Mostra se o gateway está configurado e conectado, o ambiente (produção ou sandbox) e permite sincronizar.", "Conexão com o Asaas: as cobranças chegam pelo webhook em tempo real e por sincronização automática.", null, { espera: 2000 }),
  st("pag-kpis", "Totais", "Totais das cobranças", '[data-tour="pag-kpis"]', "Fluxo de caixa da assinatura num relance.", "Recebido, a receber, em atraso, estornado e total de cobranças.", "Soma das cobranças filtradas.", c => pagamentosKpis(c.res), { espera: 2000 }),
  st("pag-filtros", "Lista", "Filtros e exportação", '[data-tour="pag-filtros"]', "Conciliar com o extrato do banco.", "Busque por cliente ou id e filtre por status, forma, origem e datas; exporte em CSV.", "As cobranças do Asaas e os pagamentos manuais."),
  st("pag-lista", "Lista", "Cobranças", '[data-tour="pag-lista"]', "Cada linha liga o pagamento ao cliente.", "Mostra data, cliente, descrição, forma, status, valor, líquido, origem e fatura. “Sem vínculo” é cobrança de alguém sem conta na plataforma.", "Histórico de cobranças.", null, { espera: 2000 }),
];
export const stepsOperacoes = () => [
  st("ops-janela", "Janela", "Período", '[data-tour="ops-janela"]', "Comparar a última hora, o dia e a semana.", "Troca a janela de tempo das métricas.", "1 hora, 24 horas ou 7 dias."),
  st("ops-kpis", "Saúde", "Requisições, disponibilidade e latência", '[data-tour="ops-kpis"]', "Disponibilidade e velocidade são o que o cliente sente.", "Mostra o volume, a disponibilidade, a latência p95 e as falhas de login, com as metas (SLOs).", "Indicadores de nível de serviço.", c => opsKpis(c.d)),
  st("ops-saude", "Saúde", "Jobs e integrações", '[data-tour="ops-saude"]', "Tarefas agendadas e integrações falham em silêncio se ninguém olhar.", "Lista a situação de cada job (cotações, e-mails, backups) e integração.", "Estado dos processos automáticos."),
  st("ops-rotas", "Detalhe", "Rotas da API", '[data-tour="ops-rotas"]', "Encontrar a rota lenta ou com erro.", "Requisições, erros 4xx e 5xx e tempos (média, p50, p95) por rota.", "Rotas normalizadas, sem dados pessoais."),
  st("ops-eventos", "Detalhe", "Eventos de domínio", '[data-tour="ops-eventos"]', "Ver o que os usuários estão fazendo: cadastros, importações, cálculos.", "Conta os eventos da janela.", "Contagens, sem identificar pessoas."),
];
