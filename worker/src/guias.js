/* Guias de arrecadação: DARF (federal) e DARE (estadual) — rotas /v1/tax/guias.
 * O cálculo é do motor puro guia_engine.js (mesmo código do navegador). CPF/CNPJ das guias ficam cifrados (AES-GCM);
 * listas mostram o documento mascarado. Cada geração fica na trilha de auditoria.
 * Integra Contador (SERPRO, serviço SICALC "CONSOLIDARGERARDARF51"): com contrato e segredos, a API pede o DARF oficial
 * com código de barras; sem eles, a guia sai sem código de barras (pagamento por "DARF sem código de barras" ou Sicalc). */
import { Problem, Resp, kvGet, nowIso, str, today } from "./shared.js";
import { RECEITAS_DARF, DARE_UF, UFS, montarDarf, montarDare, receita, SICALC_URL, GUIA_ENGINE_VERSION } from "../../apps/web/app/js/guia_engine.js";
import { seal, unseal, cpfHash, getSec } from "./identity.js";

const mask = d => d.length === 11 ? `***.${d.slice(3, 6)}.${d.slice(6, 9)}-**` : `**.${d.slice(2, 5)}.***/****-${d.slice(12)}`;
export const integraConfigured = env => !!(env.SERPRO_CONSUMER_KEY && env.SERPRO_CONSUMER_SECRET && env.SERPRO_CONTRATANTE_CNPJ && env.SERPRO_CERT);

async function loadGuias(db, uid) {
  const { results } = await db.prepare("SELECT id, data FROM fin_items WHERE user_id=? AND kind='guia'").bind(uid).all();
  return results.map(r => JSON.parse(r.data)).sort((a, b) => b.created_at.localeCompare(a.created_at));
}
const summary = g => ({ id: g.id, tipo: g.tipo, created_at: g.created_at, receita: g.receita, uf: g.uf || null, periodo: g.periodo?.rotulo || g.periodo || null,
  vencimento: g.vencimento, pagamento: g.pagamento || null, total: g.valores.total || g.valores.total_estimado, situacao: g.situacao, documento: g.documento_mascarado,
  oficial: !!g.oficial, origem: g.origem || "manual" });

/* ---- Integra Contador (SERPRO): autenticação OAuth2 com certificado e-CNPJ (mTLS) e emissão pelo SICALC */
async function integraToken(env) {
  const r = await env.SERPRO_CERT.fetch(env.SERPRO_AUTH_URL || "https://autenticacao.sapi.serpro.gov.br/authenticate", {
    method: "POST", headers: { Authorization: "Basic " + btoa(`${env.SERPRO_CONSUMER_KEY}:${env.SERPRO_CONSUMER_SECRET}`), "Role-Type": "TERCEIROS", "Content-Type": "application/x-www-form-urlencoded" },
    body: "grant_type=client_credentials" });
  if (!r.ok) throw new Problem(502, "Integra Contador indisponível", `Autenticação no SERPRO falhou (HTTP ${r.status}).`);
  return r.json();   // { access_token, jwt_token, expires_in }
}
async function integraEmitir(env, guia, documento) {
  const tok = await integraToken(env);
  const base = env.SERPRO_BASE_URL || "https://gateway.apiserpro.serpro.gov.br/integra-contador/v1";
  const tipo = d => (d.length === 11 ? 1 : 2);
  const autor = String(env.SERPRO_AUTOR || env.SERPRO_CONTRATANTE_CNPJ).replace(/\D/g, "");
  const pedido = { contratante: { numero: String(env.SERPRO_CONTRATANTE_CNPJ).replace(/\D/g, ""), tipo: 2 }, autorPedidoDados: { numero: autor, tipo: tipo(autor) },
    contribuinte: { numero: documento, tipo: tipo(documento) },
    pedidoDados: { idSistema: guia.integra_contador.idSistema, idServico: guia.integra_contador.idServico, versaoSistema: guia.integra_contador.versaoSistema,
      dados: JSON.stringify({ uf: env.SERPRO_UF_PADRAO || "RO", municipio: +(env.SERPRO_MUNICIPIO_PADRAO || 0), ...guia.integra_contador.dados }) } };
  const r = await fetch(base + "/Emitir", { method: "POST", headers: { Authorization: "Bearer " + tok.access_token, jwt_token: tok.jwt_token, "Content-Type": "application/json" }, body: JSON.stringify(pedido) });
  const out = await r.json().catch(() => ({}));
  if (!r.ok || +out.status >= 300) {
    const msg = (out.mensagens || []).map(x => x.texto).join(" ") || `HTTP ${r.status}`;
    throw new Problem(502, "Sicalc não emitiu o DARF", `${msg} Para PF, o contribuinte precisa ter dado procuração eletrônica no e-CAC ao CNPJ contratante.`);
  }
  const dados = typeof out.dados === "string" ? JSON.parse(out.dados) : out.dados || {};
  return { pdf_base64: dados.darf || null, numero_documento: dados.numeroDocumento || null, consolidado: dados.consolidado || null };
}

export async function guiasRoute(m, p, body, q, req, u, db, env, G) {
  const uid = u.me.id;
  if (u.me.acting) throw new Problem(403, "Fora do escopo", "Guias de pagamento são geradas pelo próprio contribuinte.");
  const A = (action, o = {}) => G.audit({ user_id: uid, actor: uid, resource: "guia", action, ...o });

  if (m === "GET" && p === "/v1/tax/guias/receitas")
    return { version: GUIA_ENGINE_VERSION, darf: RECEITAS_DARF, dare: Object.fromEntries(Object.entries(DARE_UF).map(([k, v]) => [k, { nome: v.nome, orgao: v.orgao, portal: v.portal, receitas: v.receitas }])),
      ufs: UFS, sicalc_url: SICALC_URL, integra_contador: integraConfigured(env) };

  if (m === "GET" && p === "/v1/tax/guias") return { items: (await loadGuias(db, uid)).map(summary), integra_contador: integraConfigured(env) };

  const one = p.match(/^\/v1\/tax\/guias\/((?:darf|dare)_[a-f0-9]{16})(\/oficial)?$/);
  if (one) {
    const row = await db.prepare("SELECT data FROM fin_items WHERE user_id=? AND kind='guia' AND id=?").bind(uid, one[1]).first();
    if (!row) throw new Problem(404, "Guia não encontrada", one[1]);
    const g = JSON.parse(row.data);
    if (m === "DELETE" && !one[2]) {
      await db.prepare("DELETE FROM fin_items WHERE user_id=? AND kind='guia' AND id=?").bind(uid, one[1]).run();
      await A("guia.apagada", { entity_id: g.id });
      return new Resp(204);
    }
    const documento = await unseal(db, g.documento_cifrado);
    const full = { ...g, contribuinte: { ...g.contribuinte, documento, documento_formatado: g.documento_formatado_cifrado ? await unseal(db, g.documento_formatado_cifrado) : documento } };
    delete full.documento_cifrado; delete full.documento_formatado_cifrado;
    if (g.tipo === "DARF") full.campos = { ...g.campos, "03": { ...g.campos["03"], valor: full.contribuinte.documento_formatado } };
    else full.campos = g.campos.map(c => c.rotulo === "CPF/CNPJ" ? { ...c, valor: full.contribuinte.documento_formatado } : c);
    if (m === "GET" && !one[2]) { await A("guia.consultada", { entity_id: g.id }); return full; }
    if (m === "POST" && one[2]) {
      if (g.tipo !== "DARF") throw new Problem(422, "Não se aplica", "O DARE com código de barras é emitido no portal da Secretaria de Fazenda do estado.");
      if (!integraConfigured(env)) throw new Problem(501, "Integra Contador não contratado", "A emissão do DARF com código de barras pela API depende do contrato com o SERPRO. Use o Sicalc com os mesmos dados.", { sicalc_url: SICALC_URL });
      const of = await integraEmitir(env, g, documento);
      await A("guia.darf_oficial_emitido", { entity_id: g.id, meta: { numero_documento: of.numero_documento } });
      return { id: g.id, ...of };
    }
  }

  if (m === "POST" && (p === "/v1/tax/guias/darf" || p === "/v1/tax/guias/dare")) {
    const hoje = today();
    let built, origem = "manual";
    if (p.endsWith("/darf")) {
      const input = { codigo: str(body.codigo, 4), documento: str(body.documento, 20), nome: str(body.nome, 120), telefone: str(body.telefone, 20), periodo: str(body.periodo, 10),
        principal: body.principal, pagamento: str(body.pagamento, 10), vencimento: str(body.vencimento, 10), referencia: str(body.referencia, 30), observacao: str(body.observacao, 50), hoje,
        acumulado_anterior: 0, selic: await G.selic() };
      if (body.origem === "apuracao") {   // DARF 6015 a partir da apuração mensal do próprio sistema
        const comp = str(body.periodo, 7);
        if (!/^\d{4}-\d{2}$/.test(comp)) throw new Problem(422, "Dados inválidos", "Informe a competência (AAAA-MM).");
        const tax = await G.taxFor(uid, +comp.slice(0, 4));
        const mo = (tax.months || []).find(x => x.month === comp);
        if (!mo || !(+mo.tax_due_gross > 0)) throw new Problem(422, "Sem imposto na competência", `A apuração de ${comp.split("-").reverse().join("/")} não tem imposto a pagar.`);
        if (mo.darf?.status === "pago") throw new Problem(409, "DARF já pago", "Esta competência está marcada como paga.");
        input.codigo = "6015"; input.principal = mo.darf ? +mo.darf.valor : +mo.tax_due; origem = "apuracao";
        if (!mo.darf) throw new Problem(422, "Abaixo do mínimo", `O imposto de ${comp.split("-").reverse().join("/")} (R$ ${String(mo.tax_due).replace(".", ",")}) é menor que R$ 10,00 e soma ao mês seguinte, como manda a lei.`);
      }
      built = montarDarf(input);
    } else {
      built = montarDare({ uf: str(body.uf, 2), codigo: str(body.codigo, 8), descricao: str(body.descricao, 80), documento: str(body.documento, 20), nome: str(body.nome, 120), ie: str(body.ie, 20),
        referencia: str(body.referencia, 40), periodo: str(body.periodo, 7), vencimento: str(body.vencimento, 10), principal: body.principal, hoje });
    }
    if (!built.ok) throw new Problem(422, built.abaixo_minimo ? "Abaixo do valor mínimo" : "Dados inválidos", built.erros.map(e => e.msg).join(" "), { errors: built.erros.map(e => ({ field: e.campo, msg: e.msg })), avisos: built.avisos || [] });
    const doc = built.contribuinte.documento;
    // confere com o CPF da conta (guardado só como hash)
    const sec = await getSec(db, uid);
    if (sec.cpf_hash && doc.length === 11) built.cpf_da_conta = (await cpfHash(db, doc)) === sec.cpf_hash;
    const stored = { ...built, origem, created_at: nowIso(), documento_mascarado: mask(doc), documento_cifrado: await seal(db, doc), documento_formatado_cifrado: await seal(db, built.contribuinte.documento_formatado),
      contribuinte: { ...built.contribuinte, documento: mask(doc), documento_formatado: mask(doc) } };
    if (built.tipo === "DARF") stored.campos = { ...built.campos, "03": { ...built.campos["03"], valor: mask(doc) } };
    else stored.campos = built.campos.map(c => c.rotulo === "CPF/CNPJ" ? { ...c, valor: mask(doc) } : c);
    await db.prepare("INSERT INTO fin_items (user_id,kind,id,import_id,data) VALUES (?,?,?,?,?) ON CONFLICT(user_id,kind,id) DO UPDATE SET data=excluded.data")
      .bind(uid, "guia", built.id, "guias", JSON.stringify(stored)).run();
    await A(built.tipo === "DARF" ? "guia.darf_gerado" : "guia.dare_gerado", { entity_id: built.id,
      meta: { codigo: built.receita.codigo, ...(built.uf ? { uf: built.uf } : {}), periodo: built.periodo?.informado || built.periodo || null, total: built.valores.total || built.valores.total_estimado, situacao: built.situacao, origem } });
    return new Resp(201, { ...built, origem, integra_contador_disponivel: built.tipo === "DARF" && integraConfigured(env) });
  }
  throw new Problem(404, "Não encontrado", p);
}
export { receita };
