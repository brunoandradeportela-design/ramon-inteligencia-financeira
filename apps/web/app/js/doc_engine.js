/* Documentos do cliente: classificação pelo nome e checklist da declaração do IRPF montado
 * a partir dos dados reais (instituições, DARFs pagos, despesas de saúde e educação, previdência, negociações). */

const norm = s => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
const brn = v => (+v || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const DOC_KINDS = {
  informe_rendimentos: "Informe de rendimentos", nota_corretagem: "Nota de corretagem", darf: "Comprovante de DARF", recibo_saude: "Recibo de saúde",
  recibo_educacao: "Recibo de educação", previdencia: "Informe de previdência", extrato: "Extrato", declaracao: "Declaração de IR", contrato: "Contrato", outro: "Outro documento",
};
const RULES = [
  [/informe|rendimento/, "informe_rendimentos"], [/corretagem|nota.?de.?negocia|nota.?neg/, "nota_corretagem"], [/darf|6015|sicalc/, "darf"],
  [/recibo|nota.?fiscal|nf.?e|consulta|medic|odonto|dentista|hospital|clinica|exame|plano.?de.?saude|unimed|psicolog/, "recibo_saude"],
  [/escola|faculdade|mensalidade|educa|curso|colegio|universidade/, "recibo_educacao"], [/previd|pgbl|vgbl/, "previdencia"],
  [/extrato/, "extrato"], [/declaracao|irpf|recibo.?de.?entrega|dirpf/, "declaracao"], [/contrato|escritura/, "contrato"],
];
export function classifyDoc(filename) {
  const f = norm(filename).replace(/[_\-.]+/g, " ");
  // declaração vem antes de recibo (o "recibo de entrega" é da declaração)
  if (/declaracao|irpf|dirpf|recibo de entrega/.test(f)) return "declaracao";
  const hit = RULES.find(([re]) => re.test(f));
  return hit ? hit[1] : "outro";
}
export function guessYear(filename, fallback) {
  const m = String(filename).match(/(?:^|\D)(20[1-3]\d)(?:\D|$)/);
  return m ? +m[1] : fallback;
}

/* checklist do ano-calendário (a declaração é entregue no ano seguinte) */
export function irpfChecklist({ year, accounts = [], holdings = [], txs = [], tax = null, docs = [], hasTrades = false, trades = [] }) {
  const yDocs = docs.filter(d => +d.year === +year);
  const has = (kind, test = () => true) => yDocs.filter(d => d.kind === kind && test(d));
  const items = [];
  const insts = [...new Set([...accounts.map(a => a.institution), ...holdings.map(h => h.custodian), ...trades.filter(t => String(t.date).startsWith(String(year))).map(t => t.custodian)].map(s => String(s || "").trim()).filter(s => s && s !== "—" && !/negocia/i.test(s)))];
  for (const inst of insts) {
    const key = norm(inst).split(/\s+/)[0];
    const got = has("informe_rendimentos", d => norm(d.title + " " + d.filename + " " + (d.institution || "")).includes(key));
    items.push({ id: "informe:" + key, title: `Informe de rendimentos ${year} — ${inst}`, done: got.length > 0,
      detail: got.length ? `Guardado: ${got[0].title}` : `A instituição disponibiliza até o fim de fevereiro de ${year + 1}.`, kind: "informe_rendimentos" });
  }
  if (hasTrades) {
    const got = has("nota_corretagem");
    items.push({ id: "notas", title: `Notas de corretagem de ${year}`, done: got.length > 0, kind: "nota_corretagem",
      detail: got.length ? `${got.length} nota(s) guardada(s).` : "Comprovam o custo de compra e venda. O relatório de Negociação da B3 já alimenta o cálculo; guarde as notas como comprovante." });
  }
  const paid = (tax?.months || []).filter(m => m.darf?.status === "pago" && m.month.startsWith(String(year)));
  if (paid.length) {
    const got = has("darf");
    items.push({ id: "darfs", title: `Comprovantes dos ${paid.length} DARF(s) pagos em ${year}`, done: got.length >= paid.length, kind: "darf",
      detail: `${got.length} de ${paid.length} comprovante(s) guardado(s) · competências ${paid.map(m => m.month.slice(5) + "/" + m.month.slice(0, 4)).join(", ")}.` });
  }
  const sum = cat => -txs.filter(t => String(t.date).startsWith(String(year)) && +t.amount < 0 && t.category === cat).reduce((s, t) => s + +t.amount, 0);
  const saude = sum("Saúde"), educ = sum("Educação");
  if (saude > 0) { const got = has("recibo_saude");
    items.push({ id: "saude", title: "Recibos de despesas médicas", done: got.length > 0, kind: "recibo_saude",
      detail: `R$ ${brn(saude)} em lançamentos de saúde no ano (inclui farmácia, que não é dedutível). Guarde recibos com CPF/CNPJ do profissional — ${got.length} guardado(s).` }); }
  if (educ > 0) { const got = has("recibo_educacao");
    items.push({ id: "educacao", title: "Recibos de educação", done: got.length > 0, kind: "recibo_educacao",
      detail: `R$ ${brn(educ)} em lançamentos de educação no ano (dedução sujeita a limite por pessoa) — ${got.length} guardado(s).` }); }
  if (holdings.some(h => h.asset_class === "previdencia")) { const got = has("previdencia");
    items.push({ id: "previdencia", title: "Informe da previdência privada (PGBL/VGBL)", done: got.length > 0, kind: "previdencia",
      detail: got.length ? "Guardado." : "PGBL pode ser deduzido até 12% da renda tributável no modelo completo." }); }
  const losses = Object.entries(tax?.losses_available || {}).filter(([, v]) => +v > 0);
  if (losses.length) items.push({ id: "prejuizos", title: "Prejuízos a informar na ficha Renda Variável", done: false, kind: null,
    detail: losses.map(([k, v]) => `${({ comum: "operações comuns", daytrade: "day trade", fii: "FII" })[k]} R$ ${brn(v)}`).join("; ") + " — informe para compensar nos anos seguintes." });
  const last = has("declaracao").length || docs.some(d => d.kind === "declaracao" && +d.year === year - 1);
  items.push({ id: "declaracao_anterior", title: `Cópia da declaração anterior (ano-calendário ${year - 1})`, done: !!last, kind: "declaracao",
    detail: last ? "Guardada." : "Facilita importar dados e conferir bens e direitos." });
  return { year, delivery_year: year + 1, done: items.filter(i => i.done).length, total: items.length, items };
}

/* confere o conteúdo pelos primeiros bytes (não confia só na extensão) */
export function sniff(bytes) {
  const b = bytes, s = String.fromCharCode(...b.slice(0, 8));
  if (s.startsWith("%PDF")) return "application/pdf";
  if (b[0] === 0x89 && s.slice(1, 4) === "PNG") return "image/png";
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b[0] === 0x50 && b[1] === 0x4b) return "application/zip";      // xlsx/docx
  if ([...b.slice(0, 64)].every(c => c === 9 || c === 10 || c === 13 || (c >= 32 && c < 127) || c >= 128)) return "text/plain";
  return null;
}
export const ALLOWED = { pdf: ["application/pdf"], png: ["image/png"], jpg: ["image/jpeg"], jpeg: ["image/jpeg"], csv: ["text/plain"], ofx: ["text/plain"], txt: ["text/plain"],
  xlsx: ["application/zip"], docx: ["application/zip"] };
