/* Motor de guias de arrecadação — DARF (federal) e DARE (estadual).
 * Função pura, compartilhada pela API (Worker) e pelo navegador (modo demonstração).
 *
 * DARF: monta os 10 campos do DARF comum com o código de receita certo, CPF ou CNPJ validados, período de apuração,
 * vencimento legal (calendário bancário nacional) e, se o pagamento for depois do vencimento, multa e juros de mora:
 *   • multa de mora: 0,33% por dia de atraso, a partir do dia seguinte ao vencimento, limitada a 20% (Lei 9.430/96, art. 61);
 *   • juros de mora: Selic acumulada mensal do mês seguinte ao vencimento até o mês anterior ao pagamento, mais 1% no mês
 *     do pagamento (art. 61, § 3º; mesmo critério do Sicalc). Selic mensal = série 4390 do Banco Central, 2 casas, como a Receita publica;
 *   • valor mínimo: DARF abaixo de R$ 10,00 não pode ser recolhido; o valor soma ao do período seguinte (Lei 9.430/96, art. 68).
 * O código de barras do DARF é numerado pela Receita: só o Sicalc (site ou Integra Contador/SERPRO) o emite. Sem esse
 * serviço contratado, a guia sai sem código de barras, com os mesmos campos que o banco pede em "DARF sem código de barras".
 *
 * DARE: o documento e o código de barras são emitidos pela Secretaria de Fazenda de cada estado. O motor confere os dados,
 * o código de receita (tabela de Rondônia incluída) e prepara o preenchimento; multa e juros estaduais são calculados pela SEFAZ. */

export const GUIA_ENGINE_VERSION = "guias@1.0.0";
export const SICALC_URL = "https://sicalc.receita.fazenda.gov.br/sicalc/principal";
const r2 = v => Math.round((+v || 0) * 100 + Number.EPSILON * 100) / 100;
const m2 = v => r2(v).toFixed(2);
export const onlyDigits = s => String(s ?? "").replace(/\D/g, "");

/* ------------------------------------------------------------------ CPF / CNPJ */
export function cpfValido(v) {
  const d = onlyDigits(v);
  if (d.length !== 11 || /^(\d)\1{10}$/.test(d)) return false;
  const dv = n => { let s = 0; for (let i = 0; i < n; i++) s += +d[i] * (n + 1 - i); const r = (s * 10) % 11; return r === 10 ? 0 : r; };
  return dv(9) === +d[9] && dv(10) === +d[10];
}
export function cnpjValido(v) {
  const d = onlyDigits(v);
  if (d.length !== 14 || /^(\d)\1{13}$/.test(d)) return false;
  const dv = n => { const w = n === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]; let s = 0; for (let i = 0; i < n; i++) s += +d[i] * w[i]; const r = s % 11; return r < 2 ? 0 : 11 - r; };
  return dv(12) === +d[12] && dv(13) === +d[13];
}
export const tipoDocumento = v => { const d = onlyDigits(v); return d.length === 11 ? "CPF" : d.length === 14 ? "CNPJ" : null; };
export const formatDocumento = v => { const d = onlyDigits(v);
  return d.length === 11 ? d.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, "$1.$2.$3-$4") : d.length === 14 ? d.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, "$1.$2.$3/$4-$5") : d; };

/* ------------------------------------------------------------------ calendário bancário nacional */
const iso = d => d.toISOString().slice(0, 10);
const D = s => new Date(s + "T12:00:00Z");
const addDays = (s, n) => { const x = D(s); x.setUTCDate(x.getUTCDate() + n); return iso(x); };
function pascoa(y) {   // algoritmo de Meeus/Jones/Butcher
  const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3),
    h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451),
    mes = Math.floor((h + l - 7 * m + 114) / 31), dia = ((h + l - 7 * m + 114) % 31) + 1;
  return `${y}-${String(mes).padStart(2, "0")}-${String(dia).padStart(2, "0")}`;
}
const _fer = {};
/** feriados nacionais e dias sem expediente bancário (Carnaval, Sexta-feira Santa, Corpus Christi) */
export function feriados(y) {
  if (_fer[y]) return _fer[y];
  const p = pascoa(y);
  const fixos = ["01-01", "04-21", "05-01", "09-07", "10-12", "11-02", "11-15", "12-25", ...(y >= 2024 ? ["11-20"] : [])].map(md => `${y}-${md}`);
  return (_fer[y] = new Set([...fixos, addDays(p, -48), addDays(p, -47), addDays(p, -2), addDays(p, 60)]));
}
export const diaUtil = s => { const w = D(s).getUTCDay(); return w !== 0 && w !== 6 && !feriados(+s.slice(0, 4)).has(s); };
export const diaUtilAnterior = s => { let x = s; while (!diaUtil(x)) x = addDays(x, -1); return x; };
export const proximoDiaUtil = s => { let x = s; while (!diaUtil(x)) x = addDays(x, 1); return x; };
const ultimoDia = (y, m) => iso(new Date(Date.UTC(y, m, 0, 12)));            // m: 1..12
const mesSeguinte = (y, m) => (m === 12 ? [y + 1, 1] : [y, m + 1]);
const ym = s => [+s.slice(0, 4), +s.slice(5, 7)];

/* ------------------------------------------------------------------ códigos de receita (DARF) */
/* vencimento: ultimo_util_mes_seguinte | dia_N_mes_seguinte_antecipa | informado. periodo: ME (mensal), TR (trimestral), AN (anual), DT (data do fato) */
export const RECEITAS_DARF = [
  { codigo: "6015", ext: "01", grupo: "Pessoa física", quem: "PF", descricao: "IRPF — ganhos líquidos em operações em bolsa (renda variável)", periodo: "ME", venc: "ultimo_util_mes_seguinte", minimo_acumula: true },
  { codigo: "4600", ext: "01", grupo: "Pessoa física", quem: "PF", descricao: "IRPF — ganho de capital na alienação de bens e direitos", periodo: "ME", venc: "ultimo_util_mes_seguinte", nota: "Período de apuração: mês da alienação. Use o GCAP para apurar o valor." },
  { codigo: "8523", ext: "01", grupo: "Pessoa física", quem: "PF", descricao: "IRPF — ganho de capital na alienação de bens e moeda estrangeira", periodo: "ME", venc: "ultimo_util_mes_seguinte" },
  { codigo: "0190", ext: "01", grupo: "Pessoa física", quem: "PF", descricao: "IRPF — carnê-leão (rendimentos recebidos de pessoa física ou do exterior)", periodo: "ME", venc: "ultimo_util_mes_seguinte", minimo_acumula: true },
  { codigo: "0211", ext: "01", grupo: "Pessoa física", quem: "PF", descricao: "IRPF — quota única ou quotas do imposto apurado na declaração", periodo: "AN", venc: "informado", nota: "Informe o vencimento da quota (prazo da declaração do ano). A quota não pode ser menor que R$ 50,00; imposto abaixo de R$ 10,00 não é cobrado." },
  { codigo: "2089", ext: "01", grupo: "Pessoa jurídica", quem: "PJ", descricao: "IRPJ — lucro presumido (quota única trimestral)", periodo: "TR", venc: "ultimo_util_mes_seguinte" },
  { codigo: "2372", ext: "01", grupo: "Pessoa jurídica", quem: "PJ", descricao: "CSLL — lucro presumido ou arbitrado (quota única trimestral)", periodo: "TR", venc: "ultimo_util_mes_seguinte" },
  { codigo: "2362", ext: "01", grupo: "Pessoa jurídica", quem: "PJ", descricao: "IRPJ — lucro real, estimativa mensal", periodo: "ME", venc: "ultimo_util_mes_seguinte" },
  { codigo: "2484", ext: "01", grupo: "Pessoa jurídica", quem: "PJ", descricao: "CSLL — lucro real, estimativa mensal", periodo: "ME", venc: "ultimo_util_mes_seguinte" },
  { codigo: "8109", ext: "01", grupo: "Pessoa jurídica", quem: "PJ", descricao: "PIS/Pasep — faturamento, regime cumulativo", periodo: "ME", venc: "dia_25_mes_seguinte_antecipa" },
  { codigo: "2172", ext: "01", grupo: "Pessoa jurídica", quem: "PJ", descricao: "Cofins — faturamento, regime cumulativo", periodo: "ME", venc: "dia_25_mes_seguinte_antecipa" },
  { codigo: "0561", ext: "01", grupo: "Retenções na fonte", quem: "PJ/PF", descricao: "IRRF — rendimentos do trabalho assalariado", periodo: "ME", venc: "dia_20_mes_seguinte_antecipa" },
  { codigo: "1708", ext: "01", grupo: "Retenções na fonte", quem: "PJ", descricao: "IRRF — serviços profissionais prestados por pessoa jurídica", periodo: "ME", venc: "dia_20_mes_seguinte_antecipa" },
  { codigo: "5952", ext: "01", grupo: "Retenções na fonte", quem: "PJ", descricao: "CSRF — retenção de CSLL, Cofins e PIS/Pasep sobre serviços", periodo: "ME", venc: "dia_20_mes_seguinte_antecipa" },
  { codigo: "3208", ext: "01", grupo: "Retenções na fonte", quem: "PJ", descricao: "IRRF — aluguéis e royalties pagos a pessoa física", periodo: "ME", venc: "dia_20_mes_seguinte_antecipa" },
];
export const receita = c => RECEITAS_DARF.find(r => r.codigo === String(c).padStart(4, "0")) || null;
export const VALOR_MINIMO_DARF = 10;

/** período de apuração normalizado: mensal "AAAA-MM", trimestral "AAAA-T1..T4", anual "AAAA" → data do campo 02 (último dia do período) */
export function periodoApuracao(rec, periodo) {
  const p = String(periodo || "").trim();
  if (rec.periodo === "ME") { const m = p.match(/^(\d{4})-(\d{2})$/); if (!m || +m[2] < 1 || +m[2] > 12) return null; return { tipo: "ME", ano: +m[1], fim: ultimoDia(+m[1], +m[2]), mesFim: +m[2], rotulo: `${m[2]}/${m[1]}` }; }
  if (rec.periodo === "TR") { const m = p.match(/^(\d{4})-T([1-4])$/i); if (!m) return null; const mf = +m[2] * 3; return { tipo: "TR", ano: +m[1], fim: ultimoDia(+m[1], mf), mesFim: mf, rotulo: `${m[2]}º trimestre de ${m[1]}` }; }
  if (rec.periodo === "AN") { const m = p.match(/^(\d{4})$/); if (!m) return null; return { tipo: "AN", ano: +m[1], fim: `${m[1]}-12-31`, mesFim: 12, rotulo: `Ano-calendário ${m[1]}` }; }
  return null;
}

/** vencimento legal pelo código e período */
export function vencimentoLegal(rec, pa) {
  const [y, m] = mesSeguinte(pa.ano, pa.mesFim);
  if (rec.venc === "ultimo_util_mes_seguinte") return diaUtilAnterior(ultimoDia(y, m));
  const dia = rec.venc.match(/^dia_(\d+)_mes_seguinte_antecipa$/);
  if (dia) return diaUtilAnterior(`${y}-${String(m).padStart(2, "0")}-${dia[1].padStart(2, "0")}`);
  return null;   // informado pelo contribuinte
}

/* ------------------------------------------------------------------ acréscimos legais (multa e juros de mora) */
/** selic: [{ date: "AAAA-MM-01", value: % a.m. }] (série 4390). Retorna percentuais e valores; meses sem taxa publicada ficam marcados. */
export function acrescimos({ principal, vencimento, pagamento, selic = [] }) {
  const p = r2(principal);
  if (!vencimento || pagamento <= vencimento) return { atraso_dias: 0, multa_pct: 0, multa: 0, juros_pct: 0, juros: 0, total: p, selic_meses: [], selic_faltando: [] };
  const dias = Math.round((D(pagamento) - D(vencimento)) / 864e5);
  const multaPct = Math.min(20, r2(dias * 0.33));
  const [vy, vm] = ym(vencimento), [py, pm] = ym(pagamento);
  const tabela = Object.fromEntries((selic || []).map(s => [String(s.date).slice(0, 7), r2(s.value)]));
  const meses = [], faltando = [];
  let [y, m] = mesSeguinte(vy, vm);
  while (y < py || (y === py && m < pm)) {
    const k = `${y}-${String(m).padStart(2, "0")}`;
    if (tabela[k] == null) faltando.push(k); else meses.push({ mes: k, pct: tabela[k] });
    [y, m] = mesSeguinte(y, m);
  }
  const mesmoMes = vy === py && vm === pm;
  const jurosPct = mesmoMes ? 0 : r2(meses.reduce((s, x) => s + x.pct, 0) + 1);
  const multa = r2(p * multaPct / 100), juros = r2(p * jurosPct / 100);
  return { atraso_dias: dias, multa_pct: multaPct, multa, juros_pct: jurosPct, juros, total: r2(p + multa + juros), selic_meses: meses, selic_faltando: faltando,
    termo_inicial_juros: mesmoMes ? null : `${mesSeguinte(vy, vm)[0]}-${String(mesSeguinte(vy, vm)[1]).padStart(2, "0")}-01` };
}

/* ------------------------------------------------------------------ hash curto (identifica a guia; não é segurança) */
function fnv(s) { let h = 0x811c9dc5; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; } return h.toString(16).padStart(8, "0"); }
const brDate = s => s ? s.split("-").reverse().join("/") : "";
const brMoney = v => r2(v).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Monta um DARF. entrada: { codigo, documento, nome, telefone, periodo, principal, pagamento (AAAA-MM-DD), vencimento? (só p/ "informado"),
 *  referencia?, observacao?, hoje (AAAA-MM-DD), selic?, acumulado_anterior? } */
export function montarDarf(e) {
  const erros = [], avisos = [];
  const rec = receita(e.codigo);
  if (!rec) return { ok: false, erros: [{ campo: "codigo", msg: "Código de receita não suportado. Escolha um da lista ou gere no Sicalc." }] };
  const doc = onlyDigits(e.documento), tipo = tipoDocumento(doc);
  if (!tipo) erros.push({ campo: "documento", msg: "Informe um CPF (11 dígitos) ou CNPJ (14 dígitos)." });
  else if (tipo === "CPF" ? !cpfValido(doc) : !cnpjValido(doc)) erros.push({ campo: "documento", msg: `${tipo} inválido: confira os dígitos verificadores.` });
  if (tipo && rec.quem === "PF" && tipo !== "CPF") erros.push({ campo: "documento", msg: `O código ${rec.codigo} é de pessoa física: informe o CPF do contribuinte.` });
  if (tipo && rec.quem === "PJ" && tipo !== "CNPJ") erros.push({ campo: "documento", msg: `O código ${rec.codigo} é de pessoa jurídica: informe o CNPJ.` });
  const nome = String(e.nome || "").trim();
  if (nome.length < 3) erros.push({ campo: "nome", msg: "Informe o nome ou a razão social do contribuinte." });
  const pa = periodoApuracao(rec, e.periodo);
  if (!pa) erros.push({ campo: "periodo", msg: rec.periodo === "TR" ? "Período no formato AAAA-T1 a AAAA-T4." : rec.periodo === "AN" ? "Informe o ano (AAAA)." : "Período no formato AAAA-MM." });
  const principalBruto = r2(e.principal), anterior = r2(e.acumulado_anterior || 0), principal = r2(principalBruto + anterior);
  if (!(principalBruto > 0)) erros.push({ campo: "principal", msg: "Informe o valor principal do tributo." });
  const hoje = e.hoje || iso(new Date());
  let vencimento = pa ? vencimentoLegal(rec, pa) : null;
  if (rec.venc === "informado") {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(e.vencimento || "")) erros.push({ campo: "vencimento", msg: "Informe a data de vencimento da quota." });
    else vencimento = e.vencimento;
  }
  let pagamento = /^\d{4}-\d{2}-\d{2}$/.test(e.pagamento || "") ? e.pagamento : hoje;
  if (pagamento < hoje) erros.push({ campo: "pagamento", msg: "A data de pagamento não pode estar no passado." });
  if (!diaUtil(pagamento)) { const nx = proximoDiaUtil(pagamento); avisos.push(`${brDate(pagamento)} não é dia útil bancário; o cálculo usa ${brDate(nx)}.`); pagamento = nx; }
  if (pa && pa.fim > hoje && rec.periodo !== "AN") avisos.push("O período de apuração ainda não terminou: o valor pode mudar até o fim do período.");
  if (erros.length) return { ok: false, erros, avisos };

  if (principal < VALOR_MINIMO_DARF) {
    return { ok: false, abaixo_minimo: true, principal: m2(principal), erros: [{ campo: "principal", msg: `Valor de R$ ${brMoney(principal)} é menor que R$ 10,00: não se emite DARF. Some ao imposto do período seguinte e recolha quando o total atingir R$ 10,00 (Lei 9.430/96, art. 68).` }], avisos };
  }
  // o Banco Central publica o mês corrente parcial; só meses encerrados entram nos juros
  const ac = acrescimos({ principal, vencimento, pagamento, selic: (e.selic || []).filter(x => String(x.date).slice(0, 7) < hoje.slice(0, 7)) });
  if (ac.selic_faltando.length) avisos.push(`Taxa Selic ainda não publicada para ${ac.selic_faltando.join(", ")}: os juros podem estar subestimados. Confira no Sicalc antes de pagar.`);
  if (ac.multa_pct >= 20) avisos.push("Multa de mora no limite de 20%.");
  if (anterior > 0) avisos.push(`Inclui R$ ${brMoney(anterior)} de período(s) anterior(es) abaixo do mínimo.`);
  const atrasado = pagamento > vencimento;
  const campos = {
    "01": { rotulo: "Nome / Telefone", valor: `${nome}${e.telefone ? " — " + e.telefone : ""}` },
    "02": { rotulo: "Período de apuração", valor: brDate(pa.fim) },
    "03": { rotulo: "Número do CPF ou CNPJ", valor: formatDocumento(doc) },
    "04": { rotulo: "Código da receita", valor: rec.codigo },
    "05": { rotulo: "Número de referência", valor: String(e.referencia || "").trim() },
    "06": { rotulo: "Data de vencimento", valor: brDate(vencimento) },
    "07": { rotulo: "Valor do principal", valor: brMoney(principal) },
    "08": { rotulo: "Valor da multa", valor: ac.multa ? brMoney(ac.multa) : "" },
    "09": { rotulo: "Valor dos juros e/ou encargos DL 1.025/69", valor: ac.juros ? brMoney(ac.juros) : "" },
    "10": { rotulo: "Valor total", valor: brMoney(ac.total) },
  };
  const ident = `${rec.codigo}|${doc}|${pa.fim}|${m2(principal)}|${pagamento}|${String(e.referencia || "")}`;
  return {
    ok: true, tipo: "DARF", version: GUIA_ENGINE_VERSION, id: "darf_" + fnv(ident) + fnv(ident.split("").reverse().join("")),
    receita: { codigo: rec.codigo, extensao: rec.ext, descricao: rec.descricao, grupo: rec.grupo },
    contribuinte: { nome, documento: doc, tipo_documento: tipo, documento_formatado: formatDocumento(doc), telefone: e.telefone || null },
    periodo: { informado: e.periodo, tipo: pa.tipo, fim: pa.fim, rotulo: pa.rotulo },
    vencimento, pagamento, situacao: atrasado ? "em_atraso" : "no_prazo",
    valores: { principal: m2(principal), multa: m2(ac.multa), juros: m2(ac.juros), total: m2(ac.total), multa_pct: ac.multa_pct, juros_pct: ac.juros_pct, atraso_dias: ac.atraso_dias,
      selic_meses: ac.selic_meses, termo_inicial_juros: ac.termo_inicial_juros || null },
    valido_ate: atrasado ? pagamento : vencimento,
    campos, referencia: String(e.referencia || "").trim() || null, observacao: String(e.observacao || "").trim().slice(0, 50) || null,
    codigo_barras: null,
    como_pagar: [
      `Internet banking: Pagamentos → Tributos → "DARF sem código de barras" (ou "DARF comum"). Preencha os campos 02 a 10 exatamente como na guia${atrasado ? ", pagando até " + brDate(pagamento) : ""}.`,
      `Precisa de código de barras (bancos digitais, lotérica, Pix)? Gere no Sicalc da Receita com os mesmos dados: código ${rec.codigo}, período ${brDate(pa.fim)}, valor ${brMoney(principal)}.`,
    ],
    sicalc_url: SICALC_URL, avisos, nota: rec.nota || null,
    integra_contador: {   // pedido pronto para o serviço SICALC do Integra Contador (SERPRO), quando contratado
      idSistema: "SICALC", idServico: "CONSOLIDARGERARDARF51", versaoSistema: "2.9",
      dados: { codigoReceita: rec.codigo, codigoReceitaExtensao: rec.ext, tipoPA: pa.tipo === "AN" ? "AN" : pa.tipo, dataPA: pa.tipo === "AN" ? String(pa.ano) : `${String(pa.mesFim).padStart(2, "0")}/${pa.ano}`,
        vencimento: vencimento + "T00:00:00", valorImposto: r2(principal), dataConsolidacao: pagamento + "T00:00:00", ...(e.referencia ? { numeroReferencia: String(e.referencia) } : {}), ...(e.observacao ? { observacao: String(e.observacao).slice(0, 50) } : {}) },
    },
    aviso_legal: "Guia calculada com as regras indicadas. Confira código, período e valor antes de pagar; o recolhimento é de responsabilidade do contribuinte.",
  };
}

/* ------------------------------------------------------------------ DARE (estadual) */
export const DARE_UF = {
  RO: { nome: "Rondônia", orgao: "SEFIN-RO — Coordenadoria da Receita Estadual", portal: "https://www.sefin.ro.gov.br", fonte: "SEFIN-RO, tabela de códigos de receita do DARE",
    receitas: [
      { codigo: "2120", descricao: "IPVA", quem: "PF/PJ", referencia: "Placa ou Renavam" }, { codigo: "2245", descricao: "Parcelamento de IPVA", quem: "PF/PJ" },
      { codigo: "3112", descricao: "ITCD — transmissão causa mortis e doação", quem: "PF/PJ", referencia: "Número do processo/declaração do ITCD" }, { codigo: "3226", descricao: "Parcelamento de ITCD", quem: "PF/PJ" },
      { codigo: "1112", descricao: "ICMS — indústria, normal", quem: "PJ", ie: true }, { codigo: "1212", descricao: "ICMS — comércio, normal", quem: "PJ", ie: true },
      { codigo: "1231", descricao: "ICMS — comércio, substituição tributária na entrada", quem: "PJ", ie: true }, { codigo: "1659", descricao: "ICMS — diferencial de alíquota", quem: "PJ", ie: true },
      { codigo: "1627", descricao: "ICMS — serviço de comunicação", quem: "PJ", ie: true }, { codigo: "1662", descricao: "ICMS — denúncia espontânea", quem: "PJ", ie: true },
      { codigo: "6120", descricao: "Taxa de serviço da administração fazendária", quem: "PF/PJ" }, { codigo: "6127", descricao: "Taxa ambiental", quem: "PF/PJ" },
      { codigo: "6135", descricao: "Taxa florestal", quem: "PF/PJ" }, { codigo: "6187", descricao: "Outras taxas", quem: "PF/PJ" },
    ] },
};
export const UFS = ["AC", "AL", "AP", "AM", "BA", "CE", "DF", "ES", "GO", "MA", "MT", "MS", "MG", "PA", "PB", "PR", "PE", "PI", "RJ", "RN", "RS", "RO", "RR", "SC", "SP", "SE", "TO"];

/** Prepara um DARE. entrada: { uf, codigo, descricao?, documento, nome, ie?, referencia?, periodo (AAAA-MM), vencimento, principal, hoje } */
export function montarDare(e) {
  const erros = [], avisos = [];
  const uf = String(e.uf || "").toUpperCase();
  if (!UFS.includes(uf)) erros.push({ campo: "uf", msg: "Escolha a UF." });
  const tab = DARE_UF[uf] || null;
  const cod = onlyDigits(e.codigo);
  const rec = tab ? tab.receitas.find(r => r.codigo === cod) : null;
  if (!cod) erros.push({ campo: "codigo", msg: "Informe o código de receita estadual." });
  else if (tab && !rec) erros.push({ campo: "codigo", msg: `Código ${cod} não está na tabela de ${tab.nome}. Confira no portal da SEFAZ.` });
  if (!tab && cod) avisos.push(`A tabela de códigos de ${uf} ainda não está no sistema: o código ${cod} foi aceito como informado. Confira no portal da Secretaria de Fazenda.`);
  const doc = onlyDigits(e.documento), tipo = tipoDocumento(doc);
  if (!tipo || (tipo === "CPF" ? !cpfValido(doc) : !cnpjValido(doc))) erros.push({ campo: "documento", msg: "CPF ou CNPJ inválido." });
  if (rec?.quem === "PJ" && tipo === "CPF") erros.push({ campo: "documento", msg: "Este código é de contribuinte com CNPJ." });
  if (rec?.ie && !onlyDigits(e.ie)) erros.push({ campo: "ie", msg: "Informe a inscrição estadual." });
  const nome = String(e.nome || "").trim(); if (nome.length < 3) erros.push({ campo: "nome", msg: "Informe o nome ou a razão social." });
  if (e.periodo && !/^\d{4}-\d{2}$/.test(e.periodo)) erros.push({ campo: "periodo", msg: "Referência no formato AAAA-MM." });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(e.vencimento || "")) erros.push({ campo: "vencimento", msg: "Informe o vencimento." });
  const principal = r2(e.principal); if (!(principal > 0)) erros.push({ campo: "principal", msg: "Informe o valor." });
  if (erros.length) return { ok: false, erros, avisos };
  const hoje = e.hoje || iso(new Date()), atrasado = e.vencimento < hoje;
  if (atrasado) avisos.push("Vencimento passado: multa e juros estaduais são calculados pela SEFAZ na emissão do DARE.");
  const ident = `${uf}|${cod}|${doc}|${e.periodo || ""}|${e.vencimento}|${m2(principal)}`;
  return {
    ok: true, tipo: "DARE", version: GUIA_ENGINE_VERSION, id: "dare_" + fnv(ident) + fnv(ident.split("").reverse().join("")),
    uf, orgao: tab?.orgao || `Secretaria de Fazenda — ${uf}`, portal: tab?.portal || null,
    receita: { codigo: cod, descricao: rec?.descricao || String(e.descricao || "Informada pelo contribuinte").slice(0, 80) },
    contribuinte: { nome, documento: doc, tipo_documento: tipo, documento_formatado: formatDocumento(doc), ie: onlyDigits(e.ie) || null },
    referencia: String(e.referencia || "").trim() || null, periodo: e.periodo || null, vencimento: e.vencimento, situacao: atrasado ? "em_atraso" : "no_prazo",
    valores: { principal: m2(principal), total_estimado: m2(principal) },
    campos: [["UF / órgão", tab?.orgao || uf], ["Código da receita", `${cod}${rec ? " — " + rec.descricao : ""}`], ["CPF/CNPJ", formatDocumento(doc)], ...(onlyDigits(e.ie) ? [["Inscrição estadual", onlyDigits(e.ie)]] : []),
      ["Nome / razão social", nome], ...(e.periodo ? [["Referência", e.periodo.split("-").reverse().join("/")]] : []), ...(e.referencia ? [[rec?.referencia || "Documento de origem", String(e.referencia)]] : []),
      ["Vencimento", brDate(e.vencimento)], ["Valor principal", brMoney(principal)]].map(([rotulo, valor]) => ({ rotulo, valor })),
    codigo_barras: null,
    como_pagar: [`Emita o DARE com código de barras no portal ${tab ? "da " + tab.orgao : "da Secretaria de Fazenda de " + uf} usando estes dados; o código de barras e o número do documento são gerados pela SEFAZ.`,
      "Pague no banco ou pelo Pix do próprio DARE e guarde o comprovante."],
    avisos, fonte: tab?.fonte || null,
    aviso_legal: "Pré-preenchimento para conferência. O DARE válido para pagamento é o emitido pela Secretaria de Fazenda do estado.",
  };
}
