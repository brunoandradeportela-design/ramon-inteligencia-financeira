/* Frases do tour que explicam os números da página Tributação.
 * Funções PURAS: recebem os mesmos objetos que desenharam a tela (/v1/tax/summary, /v1/tax/events, /v1/tax/rules)
 * e devolvem texto em pt-BR. Não recalculam imposto: só leem os valores já arredondados pelo servidor.
 * Nenhum número é escrito à mão aqui — alíquotas, limites e mínimos vêm do catálogo de regras. */

const nf = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
export const brl = v => nf.format(+v || 0).replace(/ /g, " ");
const n = v => +v || 0;
/** percentual de um parâmetro da regra: 0.15 → "15%", 0.00005 → "0,005%" */
export const pctParam = v => { const x = n(v) * 100; return (Number.isInteger(+x.toFixed(6)) ? x.toFixed(0) : String(+x.toFixed(4))).replace(".", ",") + "%"; };
export const dataBR = iso => { if (!iso) return "—"; const [y, m, d] = String(iso).slice(0, 10).split("-"); return d ? `${d}/${m}/${y}` : `${m}/${y}`; };
const MES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
export const mesBR = mk => { const [y, m] = String(mk).split("-"); return `${MES[+m - 1]}/${y}`; };
const lista = arr => arr.length <= 1 ? arr.join("") : arr.slice(0, -1).join(", ") + " e " + arr.at(-1);
const plural = (q, s, p) => `${q} ${q === 1 ? s : p}`;
export const SELO_DEMO = "Exemplo ilustrativo: estes números não são seus. ";
const out = (o, s) => (o?.demo ? SELO_DEMO : "") + s;

const regra = (rules, code) => (rules?.items || []).find(r => r.code === code) || null;
const param = (rules, code, k) => regra(rules, code)?.parameters?.[k];
export const isDemo = (t, DEMO) => !!(DEMO || t?.sample);

/* ------------------------------------------------------------------ fatores da confiança */
export const CONF = { regra: 0.5, sem_custo: 0.55, classe: 0.8 };
/** o que reduziu a confiança, do mais grave para o menos grave */
export function fatoresConfianca(t, ev) {
  const lim = t?.limitations || [], q = t?.quality?.factors || [];
  const semCusto = (ev?.items || []).filter(e => e.status === "pendente_dado");
  const f = [];
  const regraNota = lim.find(l => /^Não há versão de regra validada/.test(l));
  if (regraNota || q.some(x => x.factor === "Versão da regra" && !x.ok)) f.push({ id: "regra", valor: CONF.regra, nota: regraNota || q.find(x => x.factor === "Versão da regra")?.detail,
    elevar: q.find(x => x.factor === "Versão da regra")?.improve || "Aguardar a versão validada da regra para o ano." });
  if (semCusto.length || q.some(x => x.factor === "Custo de aquisição" && !x.ok)) f.push({ id: "sem_custo", valor: CONF.sem_custo, vendas: semCusto,
    elevar: q.find(x => x.factor === "Custo de aquisição")?.improve || "Importe o relatório de Negociação da B3 desde a primeira compra." });
  if (lim.some(l => /inferida/.test(l)) || q.some(x => x.factor === "Classe dos ativos" && !x.ok)) f.push({ id: "classe", valor: CONF.classe,
    elevar: q.find(x => x.factor === "Classe dos ativos")?.improve || "Importe a posição da B3 para confirmar ações, FIIs e ETFs." });
  const escopo = q.find(x => x.factor === "Escopo" && !x.ok);
  if (escopo) f.push({ id: "escopo", valor: null, nota: escopo.detail, elevar: escopo.improve });
  return f;
}
const vendaTxt = e => `${e.ticker} vendido em ${dataBR(e.date)} por ${brl(e.sale_value)}`;

/* ------------------------------------------------------------------ cartões de resumo */
export function impostoEstimado(t, rules, o = {}) {
  const ms = t?.months || [], total = n(t?.total_tax_due), ano = t?.year;
  const comAliq = [["BR-IRPF-RV-COMUM", "operações comuns"], ["BR-IRPF-RV-DAYTRADE", "day trade"], ["BR-IRPF-FII", "fundos imobiliários (FII)"]]
    .map(([c, l]) => param(rules, c, "aliquota") != null ? `${pctParam(param(rules, c, "aliquota"))} em ${l}` : null).filter(Boolean);
  const minimo = param(rules, "BR-IRPF-RV-COMUM", "darf_valor_minimo");
  const comoCalcula = `Em cada mês, o imposto é ${comAliq.length ? lista(comAliq) : "a alíquota de cada modalidade"} sobre o lucro tributável, depois de abater o prejuízo da mesma modalidade e o IRRF retido pela corretora.`;
  if (!ms.length) return out(o, `Ainda não há negociações de ${ano || "este ano"} importadas, por isso o valor é ${brl(0)}. Ao importar suas notas ou o relatório da B3, este cartão soma as guias de cada mês.`);
  const darfs = ms.filter(m => m.darf);
  if (total > 0) {
    const itens = darfs.map(m => `${mesBR(m.month)}: ${brl(m.darf.valor)} (${m.darf.status === "pago" ? "pago" : m.darf.status === "vencido" ? "vencido" : "em aberto"})`);
    return out(o, `${brl(total)} é a soma das guias DARF ${darfs[0]?.darf.codigo || ""} de ${ano}: ${lista(itens)}. ${comoCalcula}${minimo != null ? ` Meses com imposto abaixo de ${brl(minimo)} ficam acumulados para o mês seguinte.` : ""}`.replace("DARF  de", "DARF de"));
  }
  const vendeu = ms.some(m => n(m.sales_acoes) > 0 || n(m.result_comum) || n(m.result_daytrade) || n(m.result_fii) || n(m.result_acoes));
  if (!vendeu) return out(o, `Não houve vendas em ${ano}, então não há imposto: na bolsa, o imposto só aparece quando você vende com lucro.`);
  const acumulado = ms.filter(m => n(m.tax_due_gross) > 0 && !m.darf);
  if (acumulado.length) return out(o, `O imposto devido em ${lista(acumulado.map(m => mesBR(m.month)))} ficou abaixo do mínimo de ${brl(minimo ?? 10)} por guia e está acumulado para somar com o mês seguinte; por isso o total pago no ano ainda é ${brl(0)}.`);
  const lucroTrib = ms.some(m => n(m.base_comum) > 0 || n(m.base_daytrade) > 0 || n(m.base_fii) > 0);
  const soIsento = ms.some(m => n(m.exempt_gain) > 0) && !lucroTrib;
  if (soIsento) return out(o, `Todo o lucro de ${ano} veio de ações vendidas em meses dentro do limite de isenção (${brl(t.total_exempt_gain)} isentos), então não há imposto a pagar.`);
  return out(o, `As vendas de ${ano} não deixaram lucro tributável: houve prejuízo ou ele foi totalmente compensado por prejuízos da mesma modalidade. Por isso o imposto é ${brl(0)}.`);
}

export function irrf(t, rules, o = {}) {
  const total = n(t?.total_irrf), ms = (t?.months || []).filter(m => n(m.irrf) > 0);
  const vC = param(rules, "BR-IRPF-RV-COMUM", "irrf_aliquota_sobre_venda"), vF = param(rules, "BR-IRPF-FII", "irrf_aliquota_sobre_venda"), dt = param(rules, "BR-IRPF-RV-DAYTRADE", "irrf_aliquota_sobre_ganho");
  const regras = [vC != null ? `${pctParam(vC)} sobre o valor de cada venda em operações comuns` : null, vF != null && vF !== vC ? `${pctParam(vF)} sobre o valor de venda de FII` : vF != null ? "o mesmo percentual nas vendas de FII" : null,
    dt != null ? `${pctParam(dt)} sobre o lucro do day trade` : null].filter(Boolean);
  if (!total) return out(o, `Nenhuma retenção na fonte em ${t?.year || "este ano"}: a corretora só retém quando há venda.${regras.length ? " A retenção é de " + lista(regras) + "." : ""}`);
  const comImposto = ms.filter(m => n(m.tax_due_gross) > 0).map(m => mesBR(m.month)), semImposto = ms.filter(m => !(n(m.tax_due_gross) > 0)).map(m => mesBR(m.month));
  return out(o, `${brl(total)} é a soma do que as corretoras retiveram em ${plural(ms.length, "mês", "meses")} (${lista(ms.map(m => `${mesBR(m.month)} ${brl(m.irrf)}`))})${regras.length ? ": " + lista(regras) : ""}. Não é imposto extra: é descontado do imposto do mês${comImposto.length ? ` (abatido em ${lista(comImposto)})` : ""}${semImposto.length ? `; nos meses sem imposto (${lista(semImposto)}) vira crédito para os meses seguintes do ano` : ""}.`);
}

export function ganhosIsentos(t, rules, o = {}) {
  const lim = param(rules, "BR-IRPF-RV-COMUM", "limite_isencao_vendas_mes"), total = n(t?.total_exempt_gain);
  const ms = (t?.months || []).filter(m => n(m.exempt_gain) > 0);
  const regraTxt = `Só vale para ações: quando o total de vendas de ações no mês fica em até ${lim != null ? brl(lim) : "o limite da regra"}, o lucro dessas vendas é isento. Day trade, FII e ETF não entram na isenção.`;
  if (!total) return out(o, `Nenhum lucro isento em ${t?.year || "este ano"} até agora. ${regraTxt}`);
  return out(o, `${brl(total)} é o lucro com ações em ${plural(ms.length, "mês", "meses")} dentro do limite: ${lista(ms.map(m => `${mesBR(m.month)} (vendas de ${brl(m.sales_acoes)}, lucro de ${brl(m.exempt_gain)})`))}. ${regraTxt} Esse valor deve ser informado na declaração anual como rendimento isento.`);
}

export function confianca(t, ev, o = {}) {
  const c = n(t?.confidence), p = Math.round(c * 100), f = fatoresConfianca(t, ev);
  const meses = (t?.months || []).filter(m => m.confidence != null && n(m.confidence) < 1).map(m => mesBR(m.month));
  if (!(t?.months || []).length) return out(o, `${p}%: ainda não há negociações para avaliar. O índice aparece quando você importa suas operações.`);
  if (c >= 1 && !f.length) return out(o, `100%: todas as vendas têm o custo de compra registrado, as classes dos ativos estão confirmadas e a regra do ano é validada.`);
  const partes = f.map(x => x.id === "sem_custo" ? `${plural(x.vendas.length, "venda", "vendas")} de ${t.year} ${x.vendas.length === 1 ? "não tem" : "não têm"} a compra registrada${x.vendas.length ? ` (${lista(x.vendas.map(vendaTxt))})` : ""} — sem a compra, o preço médio é desconhecido e o lucro dessa venda fica fora do cálculo`
    : x.id === "classe" ? "a classe de alguns ativos (ação, FII ou ETF) foi deduzida pelo código, sem a posição da B3"
    : x.id === "regra" ? (x.nota || "não há regra validada para o ano")
    : x.nota);
  const lider = f.find(x => x.valor != null && Math.round(x.valor * 100) === p) || f[0];
  return out(o, `Está em ${p}% porque ${lista(partes)}.${meses.length ? ` ${meses.length === 1 ? "Mês afetado" : "Meses afetados"}: ${lista(meses)}.` : ""} O índice é o menor valor entre os meses, não a média${lider?.valor != null ? ` (${lider.id === "sem_custo" ? "venda sem custo limita a" : lider.id === "classe" ? "classe deduzida limita a" : "regra não validada limita a"} ${Math.round(lider.valor * 100)}%)` : ""}. Para elevar: ${lista([...new Set(f.map(x => x.elevar).filter(Boolean))])}`);
}

export function prejuizos(t, o = {}) {
  const L = { comum: "operações comuns", daytrade: "day trade", fii: "FII" };
  const pos = Object.entries(t?.losses_available || {}).filter(([, v]) => n(v) > 0);
  const regraTxt = "Prejuízo de uma modalidade só abate lucro da mesma modalidade e não tem prazo para ser usado.";
  if (!pos.length) return out(o, `Sem prejuízos a compensar: em ${t?.year || "este ano"} não sobrou prejuízo acumulado. ${regraTxt}`);
  return out(o, `Prejuízos guardados para abater lucros futuros: ${lista(pos.map(([k, v]) => `${L[k] || k} ${brl(v)}`))}. ${regraTxt}`);
}

/* ------------------------------------------------------------------ tabela mensal e eventos */
export function mesDarf(m, rules, o = {}) {
  if (!m) return out(o, "Ainda não há meses apurados.");
  const lim = param(rules, "BR-IRPF-RV-COMUM", "limite_isencao_vendas_mes"), minimo = param(rules, "BR-IRPF-RV-COMUM", "darf_valor_minimo");
  const s = [`Em ${mesBR(m.month)} você vendeu ${brl(m.sales_acoes)} em ações`];
  s.push(m.exempt ? `, dentro do limite de ${lim != null ? brl(lim) : "isenção"}: o lucro com ações do mês (${brl(m.exempt_gain)}) ficou isento.` : `, acima do limite de ${lim != null ? brl(lim) : "isenção"}: o lucro com ações é tributável.`);
  const res = [["operações comuns", m.result_comum], ["day trade", m.result_daytrade], ["FII", m.result_fii]].filter(([, v]) => n(v)).map(([l, v]) => `${l} ${brl(v)}`);
  if (res.length) s.push(` Resultado tributável: ${lista(res)}.`);
  s.push(` IR bruto ${brl(m.tax_due_gross)}, IRRF retido ${brl(m.irrf)}.`);
  if (m.darf) s.push(` Guia DARF ${m.darf.codigo} de ${brl(m.darf.valor)}, vencimento ${dataBR(m.darf.vencimento)} (último dia útil do mês seguinte), situação: ${m.darf.status === "pago" ? `paga${m.darf.valor_pago ? " (" + brl(m.darf.valor_pago) + ")" : ""}` : m.darf.status}.`);
  else if (n(m.tax_due_gross) > 0) s.push(` O imposto ficou abaixo do mínimo de ${brl(minimo ?? 10)} por guia: acumula para o mês seguinte.`);
  else s.push(" Não há guia a pagar neste mês.");
  return out(o, s.join(""));
}

const CONF_EVENTO = [[1, "custo e classe conhecidos"], [0.9, "day trade identificado por inferência (compra e venda no mesmo dia)"], [0.8, "classe do ativo deduzida pelo código"], [0.3, "venda sem o custo de compra registrado"]];
export function evento(e, o = {}) {
  if (!e) return out(o, "Ainda não há eventos tributários no ano.");
  const p = Math.round(n(e.confidence) * 100), motivo = (CONF_EVENTO.find(([v]) => Math.round(v * 100) === p) || [0, "dados parciais"])[1];
  const sit = { calculado: "calculado normalmente", isento: "isento (mês dentro do limite de vendas de ações)", pendente_dado: "pendente de dado: falta a compra" }[e.status] || e.status;
  const tipo = e.kind === "daytrade" ? "Day trade" : "Venda";
  const custo = e.cost_basis === "?" ? "custo não informado" : `custo ${brl(e.cost_basis)}`;
  const res = e.result === "?" ? "resultado ainda não calculável" : `${n(e.result) < 0 ? "prejuízo" : "lucro"} de ${brl(Math.abs(n(e.result)))}`;
  return out(o, `${tipo} de ${e.ticker} em ${dataBR(e.date)}: ${brl(e.sale_value)} vendidos, ${custo}, ${res}. Situação: ${sit}. Regra ${e.rule?.code} versão ${e.rule?.version}. Confiança ${p}% porque: ${motivo}.`);
}

/* ------------------------------------------------------------------ encerramento */
const diasEntre = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 864e5);
/** até 3 pendências reais, da mais urgente para a menos urgente: [{ texto, href, label }] */
export function resumoFinal(t, ev, hoje, o = {}) {
  const ms = t?.months || [], it = [], hj = String(hoje || t?.reference_date || "").slice(0, 10);
  ms.filter(m => m.darf?.status === "vencido").forEach(m => it.push({ texto: `DARF de ${mesBR(m.month)} (${brl(m.darf.valor)}) venceu em ${dataBR(m.darf.vencimento)}: pague com multa e juros recalculados.`, href: `#/tributacao?competencia=${m.month}`, label: "Gerar a guia atualizada" }));
  ms.filter(m => m.darf?.status === "aberto" && diasEntre(hj, m.darf.vencimento) <= 10 && diasEntre(hj, m.darf.vencimento) >= 0)
    .forEach(m => it.push({ texto: `DARF de ${mesBR(m.month)} (${brl(m.darf.valor)}) vence em ${dataBR(m.darf.vencimento)}.`, href: `#/tributacao?competencia=${m.month}`, label: "Gerar DARF" }));
  const f = fatoresConfianca(t, ev), sc = f.find(x => x.id === "sem_custo");
  if (n(t?.confidence) < 1 && ms.length) {
    if (sc?.vendas.length) it.push({ texto: `Confiança em ${Math.round(n(t.confidence) * 100)}%: ${plural(sc.vendas.length, "venda sem compra registrada", "vendas sem compra registrada")} (${lista(sc.vendas.map(vendaTxt))}).`, href: "#/importar", label: "Importar negociações" });
    else if (f[0]) it.push({ texto: `Confiança em ${Math.round(n(t.confidence) * 100)}%. ${f[0].elevar || ""}`.trim(), href: f[0].id === "regra" ? "#/tributacao?tab=regras" : "#/importar", label: f[0].id === "regra" ? "Ver regras" : "Importar dados" });
  }
  const itens = it.slice(0, 3);
  return { itens, texto: out(o, itens.length ? `Pontos de atenção: ${itens.map((x, i) => `${i + 1}) ${x.texto}`).join(" ")}` : "Sua apuração está completa para os dados enviados.") };
}

/* ------------------------------------------------------------------ outros números da página */
export function abertura(t, o = {}) {
  return out(o, `Apuração de ${t?.year || "—"} com dados até ${dataBR(t?.reference_date)}. A página calcula o imposto de renda sobre a bolsa mês a mês, mostra o que é isento, gera a guia de pagamento e explica cada número. É uma estimativa: não substitui a apuração oficial nem o seu contador.`);
}
export function vendasSemCompra(ev, o = {}) {
  const v = (ev?.items || []).filter(e => e.status === "pendente_dado");
  return out(o, v.length ? `${plural(v.length, "venda sem compra registrada", "vendas sem compra registrada")}: ${lista(v.map(vendaTxt))}.` : "Nenhuma venda sem compra registrada.");
}
export function maiorVenda(t) { return [...(t?.months || [])].sort((a, b) => n(b.sales_acoes) - n(a.sales_acoes))[0] || null; }
