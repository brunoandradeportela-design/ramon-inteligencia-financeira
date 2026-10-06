/* Base de conhecimento do Copilot (Engenharia v6.0 §20): coleções com políticas distintas, metadados obrigatórios,
 * recuperação com autorização antes de qualquer contexto e citação com fonte e versão.
 * - "regras": gerada do registro versionado do Tax Engine (só versões validadas entram; pendentes ficam de fora).
 * - "produto": como o AURION calcula, importa, protege e limita (texto curado, versionado).
 * - "fontes_publicas": referências regulatórias oficiais (link e do que tratam; o conteúdo é da fonte).
 * Conteúdo externo nunca sobrescreve uma regra interna aprovada: em empate, a coleção "regras" vence.
 * Recuperação lexical (BM25) determinística — mesma pergunta, mesmos trechos. */
import { RULE_VERSIONS, CATALOG } from "./tax_rules.js";

const pct = (v, d = 1) => ((+v || 0) * 100).toFixed(d).replace(".", ",") + "%";
const brl = v => "R$ " + (+v || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const KB_VERSION = "aurion-kb@1.0.0";
const PRIORITY = { regras: 3, produto: 2, fontes_publicas: 1 };

const PRODUCT = [
  { id: "prod-calculo", title: "Como o AURION calcula o imposto da bolsa", text: "A apuração usa as negociações importadas (relatório da B3, notas de corretagem ou registro no Trader). O custo é o preço médio ponderado, com os custos da nota somados à compra e descontados da venda. Compra e venda do mesmo ativo no mesmo dia formam day trade na quantidade casada; o excedente é operação comum. O resultado de cada mês é separado em operações comuns, day trade e fundos imobiliários, cada um com sua alíquota e seu prejuízo acumulado. O imposto mostrado é estimativa até ser conferido; o valor de referência é o da tela Tributação, que guarda a versão das regras e do motor usados." },
  { id: "prod-reproducao", title: "Reprodutibilidade e Excel de auditoria", text: "Cada cálculo guarda um retrato das entradas, a versão das regras e a versão do motor. Reprocessar com as mesmas entradas e versões dá o mesmo resultado e o mesmo hash. O Excel de auditoria tem oito abas (resumo, entradas, premissas, regras, cálculos com fórmulas de conferência, resultado, fontes e auditoria) e é artefato de conferência: a fonte de verdade é o motor tributário." },
  { id: "prod-darf", title: "DARF no AURION", text: "Quando o imposto do mês atinge o valor mínimo do DARF, o AURION mostra código, competência, valor estimado e vencimento (último dia útil do mês seguinte, considerando feriados nacionais). Abaixo do mínimo, o valor acumula para o mês seguinte. Você marca o DARF como pago informando o valor ou lendo o comprovante em Documentos; DARF vencido e não pago aparece no sino e na agenda." },
  { id: "prod-importacao", title: "Como importar dados", text: "Extratos (OFX ou CSV), relatórios da B3 (posição e negociação), notas de corretagem em PDF e conexões de Open Finance alimentam os painéis. Toda importação guarda o arquivo de origem, o número de registros aceitos e rejeitados e a versão do leitor. Registros repetidos entre fontes são deduplicados, com preferência para o Open Finance. Uma importação pode ser desfeita, e as categorias alteradas por você ficam com o original guardado e o motivo." },
  { id: "prod-documentos", title: "Leitura de documentos", text: "O AURION lê notas de corretagem no padrão das corretoras, comprovantes de DARF, informes de rendimentos e recibos em PDF com texto. A leitura confere somas, valor líquido, CPF e CNPJ; nada entra nos cálculos sem a sua confirmação. Códigos de negociação que você informar ficam lembrados para as próximas notas. PDFs escaneados (imagem) ainda não são lidos." },
  { id: "prod-trader", title: "Trader Intelligence", text: "O AURION não executa ordens: registra e analisa operações que você já fez na corretora. Mostra resultado bruto, custos, resultado líquido e impacto tributário estimado separados, taxa de acerto, payoff, drawdown e risco. Backtests usam sinal no fechamento e execução na abertura seguinte, com amostra separada para validação, e são reproduzíveis pela chave do conjunto de dados, estratégia e motor. Nada disso é recomendação de compra ou venda." },
  { id: "prod-privacidade", title: "Privacidade, segurança e seus direitos", text: "O CPF é guardado só como impressão protegida, nunca em claro. Há verificação em duas etapas, gestão de sessões e aviso de acesso por aparelho novo. Toda alteração relevante fica numa trilha de auditoria encadeada. Você pode exportar seus dados e excluir a conta em Privacidade. O acesso de um contador é concedido por você, somente leitura, com prazo, e cada consulta fica registrada." },
  { id: "prod-limites", title: "O que o AURION não faz", text: "O AURION não é corretora, não executa ordens, não faz recomendação individualizada de investimento e não substitui o contador. Ele consolida, calcula com regras versionadas, simula cenários, alerta e explica. Simulações mostram consequências estimadas de cenários que você escolhe." },
  { id: "prod-simulador", title: "Simulador de cenários", text: "O simulador recalcula a apuração do ano com vendas hipotéticas e compara com o cenário atual: imposto, isenção usada, prejuízo disponível e liquidez gerada. Também estima o efeito de aportes em PGBL na declaração completa, lembrando que a dedução é diferimento: o valor será tributado no resgate. Cada cenário guarda premissas, versões das regras e limitações." },
];
const PUBLIC = [
  { id: "pub-pr-irpf", title: "Receita Federal — Perguntas e Respostas IRPF 2026", url: "https://www.gov.br/receitafederal/pt-br/centrais-de-conteudo/publicacoes/perguntas-e-respostas/dirpf/p-r-irpf-2026-v1-00-2026-04-23.pdf", text: "Manual oficial de perguntas e respostas da declaração do imposto de renda da pessoa física: rendimentos, deduções, bens e direitos, ganhos de capital e operações em bolsa (renda variável).", published_at: "2026-04-23" },
  { id: "pub-compensacoes", title: "Receita Federal — compensação de prejuízos em bolsa", url: "https://www.gov.br/receitafederal/pt-br/assuntos/meu-imposto-de-renda/pagamento/renda-variavel/bolsa-de-valores-1/compensacoes", text: "Página oficial sobre compensação de perdas em operações de bolsa de valores (renda variável): como prejuízos podem reduzir ganhos de meses seguintes." },
  { id: "pub-cvm-19", title: "CVM — Resolução 19 (consultoria de valores mobiliários)", url: "https://conteudo.cvm.gov.br/export/sites/cvm/legislacao/resolucoes/anexos/001/resol019consolid.pdf", text: "Norma da CVM que regula a atividade de consultoria de valores mobiliários, isto é, recomendação de investimento individualizada, atividade que o AURION não exerce." },
  { id: "pub-open-finance", title: "Banco Central — Open Finance (perguntas frequentes)", url: "https://www.bcb.gov.br/meubc/faqs/s/open-finance", text: "Explicação oficial do Open Finance: compartilhamento de dados com consentimento do cliente, que pode ser revogado a qualquer momento; a autenticação acontece no ambiente da instituição." },
  { id: "pub-anpd", title: "ANPD — direitos do titular de dados", url: "https://www.gov.br/anpd/pt-br/assuntos/titular-de-dados", text: "Página oficial sobre os direitos do titular previstos na LGPD: acesso, correção, portabilidade, eliminação e revogação do consentimento." },
];

/* ------------------------------------------------------------------ montagem das coleções (metadados obrigatórios) */
export function buildKnowledge() {
  const docs = [];
  for (const r of RULE_VERSIONS) {
    if (r.status !== "validated") continue;                       // regra pendente nunca vira contexto
    const params = Object.entries(r.parameters || {}).filter(([, v]) => typeof v !== "object").map(([k, v]) => `${k.replace(/_/g, " ")}: ${v}`).join("; ");
    // índice só com afirmações positivas: "sem isenção" não deve atrair perguntas sobre isenção
    const posExc = (r.exceptions || []).filter(e => !/PREMISSA A CONFIRMAR/.test(e)).flatMap(e => e.split(/;\s*/)).filter(c => !/^(sem |nao |não )/i.test(c.trim()) && !/não (têm|tem|é) /i.test(c));
    docs.push({ id: `rule-${r.code}-${r.version}`, collection: "regras", title: r.title, text: `${r.title}. Parâmetros: ${params}. Como calcula: ${r.formula} Exceções: ${(r.exceptions || []).join(" ")}`,
      index_text: `${r.title}. ${ruleText(r.code, r.version, { exceptions: false }).replace(/[^:]*: /, "").replace(/(R\$ 20\.000,00)/, "$1 R$ 20 mil")}. ${r.formula} ${posExc.join(" ")}`,
      meta: { source_id: r.code, source_type: "regra_versionada", version: r.version, published_at: r.validated_at || null, effective_at: r.validity.start, checksum: null, tenant_scope: "public", access_policy: "todos",
        sources: r.sources.map(s => ({ id: s.id, title: s.title, url: s.url })), catalog_version: CATALOG.catalog_version } });
  }
  for (const d of PRODUCT) docs.push({ ...d, collection: "produto", meta: { source_id: d.id, source_type: "documentacao_produto", version: KB_VERSION, published_at: "2026-10-06", effective_at: "2026-10-06", checksum: null, tenant_scope: "public", access_policy: "todos", sources: [] } });
  for (const d of PUBLIC) docs.push({ id: d.id, collection: "fontes_publicas", title: d.title, text: d.text, meta: { source_id: d.id, source_type: "fonte_publica_oficial", version: d.published_at || "referência", published_at: d.published_at || null, effective_at: null, checksum: null, tenant_scope: "public", access_policy: "todos", sources: [{ id: d.id, title: d.title, url: d.url }] } });
  return docs;
}

/* ------------------------------------------------------------------ recuperação (BM25 com radicais simples) */
const STOP = new Set("a o os as um uma de do da dos das e é em no na nos nas por para com sem que se ao à às como qual quais quanto quando onde meu minha meus minhas me eu voce você isso esse essa este esta ser sao são tem ter ha há mais menos sobre entre ou mas the of explica explique explicar funciona significa oque aurion regra regras".split(" ").map(w => w.normalize("NFD").replace(/[\u0300-\u036f]/g, "")));
const norm = s => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
export const tokens = s => norm(s).replace(/[^a-z0-9 ]+/g, " ").split(/\s+/).filter(w => w.length > 1 && !STOP.has(w)).map(w => w.length > 3 ? w.replace(/s$/, "") : w).map(w => w.length > 5 ? w.slice(0, 5) : w);
let INDEX = null;
function index() {
  if (INDEX) return INDEX;
  const docs = buildKnowledge().map(d => ({ ...d, toks: tokens(d.title + " " + d.title + " " + (d.index_text || d.text)) }));
  const df = {}; docs.forEach(d => new Set(d.toks).forEach(t => { df[t] = (df[t] || 0) + 1; }));
  const avg = docs.reduce((s, d) => s + d.toks.length, 0) / docs.length;
  return (INDEX = { docs, df, avg, N: docs.length });
}
/* autorização ANTES de entregar contexto: só documentos cujo escopo o pedido pode ver */
export function retrieve(query, { userId = null, k = 3, minScore = 1.2 } = {}) {
  const { docs, df, avg, N } = index(), q = [...new Set(tokens(query))].filter(t => df[t] || t.length > 2);
  if (!q.length) return [];
  const allowed = d => d.meta.tenant_scope === "public" || (userId && d.meta.tenant_scope === "user:" + userId);
  const scored = docs.filter(allowed).map(d => {
    let s = 0; const len = d.toks.length;
    for (const t of q) { const f = d.toks.filter(x => x === t).length; if (!f) continue; const idf = Math.log(1 + (N - df[t] + 0.5) / (df[t] + 0.5)); s += idf * (f * 2.2) / (f + 1.2 * (0.25 + 0.75 * len / avg)); }
    const covered = q.filter(t => d.toks.includes(t)).length / q.length;     // a maior parte da pergunta precisa aparecer no trecho
    return { d, s, covered };
  }).filter(x => x.s >= minScore && x.covered >= 0.6);
  scored.sort((a, b) => (b.s - a.s) || (PRIORITY[b.d.collection] - PRIORITY[a.d.collection]) || a.d.id.localeCompare(b.d.id));
  // empate próximo entre regra interna e conteúdo externo: a regra vem primeiro
  if (scored.length > 1 && scored[0].d.collection === "fontes_publicas") { const r = scored.find(x => x.d.collection === "regras" && x.s >= scored[0].s * 0.8); if (r) { scored.splice(scored.indexOf(r), 1); scored.unshift(r); } }
  return scored.slice(0, k).map(({ d, s }) => ({ id: d.id, collection: d.collection, title: d.title, text: d.text, score: Math.round(s * 100) / 100, meta: d.meta }));
}
export const citation = h => ({ document: h.title, source_id: h.meta.source_id, version: h.meta.version, effective_at: h.meta.effective_at, collection: h.collection, links: (h.meta.sources || []).map(s => s.url).filter(Boolean) });

/* regra versionada em linguagem simples, direto do registro (o texto acompanha a versão) */
const PLAB = { aliquota: "alíquota", limite_isencao_vendas_mes: "vendas de ações isentas até", irrf_aliquota_sobre_venda: "IRRF (dedo-duro) sobre o valor de venda", irrf_aliquota_sobre_ganho: "IRRF sobre o ganho",
  darf_codigo: "código do DARF", darf_valor_minimo: "valor mínimo do DARF", limite_percentual: "dedução limitada a", exige_modelo_completo: "exige declaração completa", exige_contribuicao_regime_previdencia: "exige contribuição à previdência oficial (INSS ou regime próprio)" };
export function ruleText(code, version, { exceptions = true } = {}) {
  const r = RULE_VERSIONS.find(x => x.code === code && x.version === version); if (!r) return "";
  const fmt = (k, v) => v === true ? "sim" : /aliquota/.test(k) && +v < 1 ? pct(v, String(v).length > 5 ? 3 : 0) : k === "limite_percentual" ? pct(v, 0) + " da renda tributável" : /limite_isencao|valor_minimo/.test(k) ? brl(v) + (k === "limite_isencao_vendas_mes" ? " por mês" : "") : String(v);
  const params = Object.entries(r.parameters || {}).filter(([k, v]) => PLAB[k] && typeof v !== "object" && v !== false).map(([k, v]) => v === true ? PLAB[k] : `${PLAB[k]}: ${fmt(k, v)}`).join("; ");
  const exc = (r.exceptions || []).filter(e => !/PREMISSA A CONFIRMAR/.test(e));
  return `${r.title}: ${params}.${exceptions && exc.length ? " " + exc.join(" ") : ""}`;
}
