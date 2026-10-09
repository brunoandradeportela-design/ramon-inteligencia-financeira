/* Guias de pagamento: DARF (federal) e DARE (estadual), dentro de Tributação.
 * O cálculo (código, vencimento, multa, juros, mínimo) é do motor guia_engine.js — o mesmo da API. */
import { api, ApiError, HAS_API } from "./api.js";
import { brl, dt, esc, icon, toast, empty } from "./ui.js";

const msg = e => e instanceof ApiError ? (e.problem.detail || e.problem.title) : String(e.message || e);
const hojeBr = () => new Date(Date.now() - 3 * 3600e3).toISOString().slice(0, 10);
const num = s => String(s ?? "").trim().replace(/\./g, "").replace(",", ".");
const maskDoc = v => { const d = String(v).replace(/\D/g, "").slice(0, 14);
  return d.length <= 11 ? d.replace(/(\d{3})(\d)/, "$1.$2").replace(/(\d{3})(\d)/, "$1.$2").replace(/(\d{3})(\d{1,2})$/, "$1-$2")
    : d.replace(/^(\d{2})(\d)/, "$1.$2").replace(/^(\d{2})\.(\d{3})(\d)/, "$1.$2.$3").replace(/\.(\d{3})(\d)/, ".$1/$2").replace(/(\d{4})(\d)/, "$1-$2"); };
const badgeSit = s => s === "em_atraso" ? `<span class="badge b-vencido">em atraso</span>` : `<span class="badge b-ativo">no prazo</span>`;
const copyBtn = (v, label) => `<button type="button" class="btn btn--ghost btn--sm" data-copy="${esc(v)}" aria-label="Copiar ${esc(label)}">${icon("doc")}<span>Copiar</span></button>`;
const quarters = () => { const y = +hojeBr().slice(0, 4), out = []; for (let a = y; a >= y - 3; a--) for (let t = 4; t >= 1; t--) out.push(`${a}-T${t}`); return out; };

let receitas = null;
/* estado lido pelo tour (somente leitura): a guia exibida e a lista de guias geradas */
const estadoTour = { ultimo: null, lista: [] };
export const guiasEstado = () => estadoTour;
export async function guiasTab(el, { me, prefill = null, onPaid = null } = {}) {
  if (!receitas) receitas = await api.get("/v1/tax/guias/receitas");
  let modo = prefill?.tipo === "DARE" ? "dare" : "darf", ultimo = null;
  const draw = async () => {
    const lista = await api.get("/v1/tax/guias").catch(() => ({ items: [] }));
    estadoTour.ultimo = ultimo; estadoTour.lista = lista.items || [];
    el.innerHTML = `
      <div class="row between wrap" style="gap:12px;margin-bottom:14px">
        <div class="seg" role="group" aria-label="Tipo de guia" data-tour="guia-tipo"><button type="button" data-modo="darf" aria-pressed="${modo === "darf"}">DARF · federal</button><button type="button" data-modo="dare" aria-pressed="${modo === "dare"}">DARE · estadual</button></div>
        <a class="small" href="${esc(receitas.sicalc_url)}" target="_blank" rel="noopener">Sicalc da Receita ↗</a></div>
      <div class="grid g-dash2" style="align-items:start">
        <section class="card" id="gform" data-tour="guia-form"></section>
        <section class="card" id="gres" data-tour="guia-resultado">${ultimo ? "" : `<h3>Guia</h3><p class="small muted" style="margin-top:8px">Preencha os dados ao lado. O sistema confere o código de receita, o CPF ou CNPJ e o vencimento legal, e calcula multa e juros se o pagamento for depois do vencimento.</p>
          <ul class="stack small" style="margin-top:12px"><li>• <b>DARF</b>: sai pronta para pagar no internet banking ("DARF sem código de barras"). Com código de barras, pelo Sicalc${receitas.integra_contador ? " ou direto aqui (Integra Contador)" : ""}.</li>
          <li>• <b>DARE</b>: dados conferidos e prontos para emitir no portal da Secretaria de Fazenda, que gera o código de barras.</li></ul>`}</section>
      </div>
      <section class="card section" data-tour="guia-lista"><h3>Guias geradas</h3>${lista.items.length ? `<div class="table-wrap"><table class="table" style="margin-top:10px"><thead><tr><th>Guia</th><th>Período</th><th>CPF/CNPJ</th><th>Vencimento</th><th class="num">Total</th><th>Situação</th><th></th></tr></thead>
        <tbody>${lista.items.map(g => `<tr><td><b>${g.tipo} ${esc(g.receita.codigo)}</b>${g.uf ? " · " + esc(g.uf) : ""}<div class="small muted">${esc(g.receita.descricao)}</div></td><td>${esc(g.periodo || "—")}</td><td class="small">${esc(g.documento)}</td>
          <td>${dt(g.vencimento)}</td><td class="num">${brl(g.total)}</td><td>${badgeSit(g.situacao)}</td>
          <td style="white-space:nowrap"><button class="btn btn--ghost btn--sm" data-open="${esc(g.id)}">abrir</button> <button class="btn btn--ghost btn--sm" data-del="${esc(g.id)}" aria-label="Apagar guia ${esc(g.receita.codigo)}">apagar</button></td></tr>`).join("")}</tbody></table></div>`
        : empty("Nenhuma guia gerada ainda.", "doc")}</section>`;
    el.querySelectorAll("[data-modo]").forEach(b => b.onclick = () => { modo = b.dataset.modo; ultimo = null; prefill = null; draw(); });
    el.querySelectorAll("[data-open]").forEach(b => b.onclick = async () => { try { ultimo = await api.get(`/v1/tax/guias/${b.dataset.open}`); modo = ultimo.tipo === "DARE" ? "dare" : "darf"; await draw(); el.querySelector("#gres").scrollIntoView({ behavior: "smooth", block: "start" }); } catch (e) { toast(msg(e)); } });
    el.querySelectorAll("[data-del]").forEach(b => b.onclick = async () => { try { await api.del(`/v1/tax/guias/${b.dataset.del}`); if (ultimo?.id === b.dataset.del) ultimo = null; toast("Guia apagada."); draw(); } catch (e) { toast(msg(e)); } });
    (modo === "darf" ? formDarf : formDare)(el.querySelector("#gform"));
    if (ultimo) (ultimo.tipo === "DARE" ? showDare : showDarf)(el.querySelector("#gres"), ultimo);
  };

  /* -------------------------------------------------- DARF */
  const formDarf = box => {
    const p = prefill || {};
    const grupos = [...new Set(receitas.darf.map(r => r.grupo))];
    box.innerHTML = `<h3>Gerar DARF</h3>
      <form id="fdarf" class="stack" style="margin-top:12px" novalidate>
        <div class="field"><label for="g_cod">Código da receita</label><select class="input" id="g_cod">${grupos.map(g => `<optgroup label="${esc(g)}">${receitas.darf.filter(r => r.grupo === g).map(r =>
          `<option value="${r.codigo}" ${r.codigo === (p.codigo || "6015") ? "selected" : ""}>${r.codigo} — ${esc(r.descricao)}</option>`).join("")}</optgroup>`).join("")}</select><p class="small muted" id="g_nota"></p></div>
        <div class="form-grid">
          <div class="field"><label for="g_doc">CPF ou CNPJ do contribuinte</label><input class="input" id="g_doc" inputmode="numeric" autocomplete="off" placeholder="000.000.000-00" value="${esc(p.documento ? maskDoc(p.documento) : "")}"></div>
          <div class="field"><label for="g_nome">Nome ou razão social</label><input class="input" id="g_nome" value="${esc(p.nome || me?.name || "")}"></div>
        </div>
        <div class="form-grid">
          <div class="field"><label for="g_per">Período de apuração</label><span id="g_perbox"></span></div>
          <div class="field"><label for="g_val">Valor principal (R$)</label><input class="input" id="g_val" inputmode="decimal" placeholder="0,00" value="${esc(p.principal ? String(p.principal).replace(".", ",") : "")}"></div>
          <div class="field"><label for="g_pag">Data do pagamento</label><input class="input" id="g_pag" type="date" min="${hojeBr()}" value="${hojeBr()}"></div>
          <div class="field" id="g_vencf" hidden><label for="g_venc">Vencimento da quota</label><input class="input" id="g_venc" type="date"></div>
        </div>
        <details><summary>Mais campos (telefone, referência, observação)</summary><div class="form-grid" style="margin-top:10px">
          <div class="field"><label for="g_tel">Telefone</label><input class="input" id="g_tel" inputmode="tel"></div>
          <div class="field"><label for="g_ref">Número de referência</label><input class="input" id="g_ref" maxlength="30"></div>
          <div class="field"><label for="g_obs">Observação (até 50)</label><input class="input" id="g_obs" maxlength="50"></div></div></details>
        <p class="err" id="g_err" role="alert"></p>
        <button class="btn btn--primary">Calcular e gerar DARF</button>
        ${p.origem === "apuracao" ? `<p class="small muted">Valor e período vêm da sua apuração mensal (código 6015).</p>` : ""}
      </form>`;
    const sel = box.querySelector("#g_cod");
    const setPer = () => {
      const r = receitas.darf.find(x => x.codigo === sel.value), pb = box.querySelector("#g_perbox"), cur = p.periodo || "";
      pb.innerHTML = r.periodo === "TR" ? `<select class="input" id="g_per">${quarters().map(q => `<option ${q === cur ? "selected" : ""}>${q}</option>`).join("")}</select>`
        : r.periodo === "AN" ? `<input class="input" id="g_per" inputmode="numeric" maxlength="4" placeholder="AAAA" value="${esc(/^\d{4}$/.test(cur) ? cur : String(+hojeBr().slice(0, 4) - 1))}">`
        : `<input class="input" id="g_per" type="month" max="${hojeBr().slice(0, 7)}" value="${esc(/^\d{4}-\d{2}$/.test(cur) ? cur : "")}">`;
      box.querySelector("#g_vencf").hidden = r.venc !== "informado";
      box.querySelector("#g_nota").textContent = [r.quem === "PF" ? "Pessoa física (CPF)." : r.quem === "PJ" ? "Pessoa jurídica (CNPJ)." : "CPF ou CNPJ.", r.nota || ""].join(" ");
    };
    sel.onchange = setPer; setPer();
    const doc = box.querySelector("#g_doc"); doc.oninput = () => { doc.value = maskDoc(doc.value); };
    box.querySelector("#fdarf").onsubmit = async ev => {
      ev.preventDefault();
      const v = id => box.querySelector(id)?.value || "";
      const payload = { codigo: v("#g_cod"), documento: v("#g_doc"), nome: v("#g_nome"), periodo: v("#g_per"), principal: num(v("#g_val")), pagamento: v("#g_pag"),
        vencimento: v("#g_venc"), telefone: v("#g_tel"), referencia: v("#g_ref"), observacao: v("#g_obs") };
      if (p.origem === "apuracao" && HAS_API && payload.codigo === "6015" && payload.periodo === p.periodo) payload.origem = "apuracao";
      box.querySelector("#g_err").textContent = "";
      box.querySelectorAll("[aria-invalid]").forEach(x => x.removeAttribute("aria-invalid"));
      try { ultimo = await api.post("/v1/tax/guias/darf", payload); prefill = { ...payload, origem: p.origem }; await draw(); toast("DARF gerado."); el.querySelector("#gres").scrollIntoView({ behavior: "smooth", block: "start" }); }
      catch (e) {
        box.querySelector("#g_err").textContent = msg(e);
        const map = { codigo: "#g_cod", documento: "#g_doc", nome: "#g_nome", periodo: "#g_per", principal: "#g_val", pagamento: "#g_pag", vencimento: "#g_venc" };
        (e.problem?.errors || []).forEach(x => box.querySelector(map[x.field])?.setAttribute("aria-invalid", "true"));
      }
    };
  };

  const showDarf = (box, g) => {
    const v = g.valores, c = g.campos;
    const linha = (k, destaque) => `<tr${destaque ? ' class="darf-tot"' : ""}><th scope="row"><span>${k}</span>${esc(c[k].rotulo)}</th><td>${esc(c[k].valor || "")}</td><td class="no-print">${c[k].valor ? copyBtn(c[k].valor.replace(/^R\$\s?/, ""), c[k].rotulo) : ""}</td></tr>`;
    box.innerHTML = `<div class="row between wrap" style="gap:8px"><h3>DARF ${esc(g.receita.codigo)} ${badgeSit(g.situacao)}</h3><span class="small muted">${esc(g.receita.descricao)}</span></div>
      <div class="trust-line" style="margin-top:10px">${icon("info")}<span>${g.situacao === "em_atraso"
        ? `Venceu em <b>${dt(g.vencimento)}</b>: ${v.atraso_dias} dia(s) de atraso, multa de ${String(v.multa_pct).replace(".", ",")}% e juros de ${String(v.juros_pct).replace(".", ",")}% (Selic + 1%). <b>Valores válidos para pagamento em ${dt(g.pagamento)}.</b>`
        : `No prazo: pague até <b>${dt(g.vencimento)}</b> pelo valor principal.`}</span></div>
      <div class="darf print-area" id="darfdoc">
        <div class="darf-h"><div><b>MINISTÉRIO DA FAZENDA</b><span>Secretaria Especial da Receita Federal do Brasil</span><span>Documento de Arrecadação de Receitas Federais</span></div><strong>DARF</strong></div>
        <table class="darf-t"><tbody>${["01", "02", "03", "04", "05", "06", "07", "08", "09"].map(k => linha(k)).join("")}${linha("10", true)}</tbody></table>
        <p class="darf-f">Sem código de barras — pague no internet banking em "DARF sem código de barras" ou gere o código de barras no Sicalc. Guia ${esc(g.id)} · ${esc(g.version)}${g.cpf_da_conta ? " · CPF confere com o da conta" : ""}</p>
      </div>
      ${g.avisos?.length ? `<ul class="stack small" style="margin-top:10px">${g.avisos.map(a => `<li class="neg">• ${esc(a)}</li>`).join("")}</ul>` : ""}
      <div class="row wrap" style="gap:8px;margin-top:14px">
        <button class="btn btn--primary btn--sm" data-print>${icon("file")}<span>Imprimir ou salvar PDF</span></button>
        <a class="btn btn--ghost btn--sm" href="${esc(g.sicalc_url || receitas.sicalc_url)}" target="_blank" rel="noopener">Código de barras no Sicalc ↗</a>
        ${g.integra_contador_disponivel || receitas.integra_contador ? `<button class="btn btn--ghost btn--sm" data-oficial="${esc(g.id)}">Emitir DARF oficial com código de barras</button>` : ""}
        ${g.receita.codigo === "6015" && g.periodo?.informado && HAS_API ? `<button class="btn btn--ghost btn--sm" data-pago="${esc(g.periodo.informado)}" data-val="${esc(v.principal)}">Marcar como pago</button>` : ""}
      </div>
      <details style="margin-top:12px"><summary>Como pagar</summary><ul class="stack small" style="margin-top:8px">${g.como_pagar.map(x => `<li>• ${esc(x)}</li>`).join("")}</ul>
        ${v.selic_meses?.length ? `<p class="small muted" style="margin-top:8px">Selic usada: ${v.selic_meses.map(s => `${s.mes.split("-").reverse().join("/")} ${String(s.pct).replace(".", ",")}%`).join(" · ")} + 1% no mês do pagamento.</p>` : ""}
        ${g.nota ? `<p class="small muted" style="margin-top:8px">${esc(g.nota)}</p>` : ""}</details>
      <p class="note">${esc(g.aviso_legal)}</p>`;
    wireResult(box);
  };

  /* -------------------------------------------------- DARE */
  const formDare = box => {
    const p = prefill || {};
    let uf = p.uf || "RO";
    const render = () => {
      const tab = receitas.dare[uf];
      box.innerHTML = `<h3>Preparar DARE</h3>
        <form id="fdare" class="stack" style="margin-top:12px" novalidate>
          <div class="form-grid">
            <div class="field"><label for="d_uf">Estado</label><select class="input" id="d_uf">${receitas.ufs.map(u => `<option ${u === uf ? "selected" : ""}>${u}</option>`).join("")}</select></div>
            <div class="field" style="grid-column:span 2"><label for="d_cod">Código da receita estadual</label>${tab
              ? `<select class="input" id="d_cod">${tab.receitas.map(r => `<option value="${r.codigo}">${r.codigo} — ${esc(r.descricao)}</option>`).join("")}</select>`
              : `<input class="input" id="d_cod" inputmode="numeric" placeholder="código do portal da SEFAZ">`}</div>
          </div>
          ${tab ? `<p class="small muted">Tabela: ${esc(tab.orgao)}.</p>` : `<div class="field"><label for="d_desc">Descrição do tributo</label><input class="input" id="d_desc" maxlength="80" placeholder="ex.: ITCMD — doação"></div>
            <p class="small muted">A tabela de códigos de ${uf} ainda não está no sistema: confira o código no portal da Secretaria de Fazenda.</p>`}
          <div class="form-grid">
            <div class="field"><label for="d_doc">CPF ou CNPJ</label><input class="input" id="d_doc" inputmode="numeric" autocomplete="off"></div>
            <div class="field"><label for="d_nome">Nome ou razão social</label><input class="input" id="d_nome" value="${esc(me?.name || "")}"></div>
            <div class="field"><label for="d_ie">Inscrição estadual (se houver)</label><input class="input" id="d_ie" inputmode="numeric"></div>
          </div>
          <div class="form-grid">
            <div class="field"><label for="d_ref">Documento de origem</label><input class="input" id="d_ref" maxlength="40" placeholder="placa, processo, NF…"></div>
            <div class="field"><label for="d_per">Referência (mês)</label><input class="input" id="d_per" type="month"></div>
            <div class="field"><label for="d_venc">Vencimento</label><input class="input" id="d_venc" type="date"></div>
            <div class="field"><label for="d_val">Valor principal (R$)</label><input class="input" id="d_val" inputmode="decimal" placeholder="0,00"></div>
          </div>
          <p class="err" id="d_err" role="alert"></p>
          <button class="btn btn--primary">Conferir e preparar DARE</button></form>`;
      box.querySelector("#d_uf").onchange = e => { uf = e.target.value; render(); };
      const doc = box.querySelector("#d_doc"); doc.oninput = () => { doc.value = maskDoc(doc.value); };
      box.querySelector("#fdare").onsubmit = async ev => {
        ev.preventDefault();
        const v = id => box.querySelector(id)?.value || "";
        try { ultimo = await api.post("/v1/tax/guias/dare", { uf, codigo: v("#d_cod"), descricao: v("#d_desc"), documento: v("#d_doc"), nome: v("#d_nome"), ie: v("#d_ie"), referencia: v("#d_ref"),
          periodo: v("#d_per"), vencimento: v("#d_venc"), principal: num(v("#d_val")) }); await draw(); toast("DARE preparado."); }
        catch (e) { box.querySelector("#d_err").textContent = msg(e); }
      };
    };
    render();
  };

  const showDare = (box, g) => {
    box.innerHTML = `<div class="row between wrap" style="gap:8px"><h3>DARE ${esc(g.uf)} · ${esc(g.receita.codigo)} ${badgeSit(g.situacao)}</h3><span class="small muted">${esc(g.orgao)}</span></div>
      <div class="darf print-area" style="margin-top:12px"><div class="darf-h"><div><b>${esc(g.orgao)}</b><span>Documento de Arrecadação Estadual — dados para emissão</span></div><strong>DARE</strong></div>
        <table class="darf-t"><tbody>${g.campos.map(c => `<tr><th scope="row">${esc(c.rotulo)}</th><td>${esc(c.valor)}</td><td class="no-print">${copyBtn(c.valor, c.rotulo)}</td></tr>`).join("")}</tbody></table>
        <p class="darf-f">O código de barras e o número do DARE são gerados pela Secretaria de Fazenda. Guia ${esc(g.id)}</p></div>
      ${g.avisos?.length ? `<ul class="stack small" style="margin-top:10px">${g.avisos.map(a => `<li class="neg">• ${esc(a)}</li>`).join("")}</ul>` : ""}
      <div class="row wrap" style="gap:8px;margin-top:14px">${g.portal ? `<a class="btn btn--primary btn--sm" href="${esc(g.portal)}" target="_blank" rel="noopener">Emitir no portal ${esc(g.uf === "RO" ? "da SEFIN-RO" : "da SEFAZ")} ↗</a>` : ""}
        <button class="btn btn--ghost btn--sm" data-print>${icon("file")}<span>Imprimir</span></button></div>
      <ul class="stack small" style="margin-top:12px">${g.como_pagar.map(x => `<li>• ${esc(x)}</li>`).join("")}</ul><p class="note">${esc(g.aviso_legal)}</p>`;
    wireResult(box);
  };

  const wireResult = box => {
    box.querySelectorAll("[data-copy]").forEach(b => b.onclick = async () => { try { await navigator.clipboard.writeText(b.dataset.copy); toast("Copiado."); } catch { toast(b.dataset.copy); } });
    box.querySelector("[data-print]")?.addEventListener("click", () => window.print());
    box.querySelector("[data-oficial]")?.addEventListener("click", async e => {
      const b = e.currentTarget; b.disabled = true;
      try { const r = await api.post(`/v1/tax/guias/${b.dataset.oficial}/oficial`, {});
        if (r.pdf_base64) { const a = document.createElement("a"); a.href = "data:application/pdf;base64," + r.pdf_base64; a.download = `DARF-${r.numero_documento || ultimo.receita.codigo}.pdf`; a.click(); toast("DARF oficial emitido pelo Sicalc."); }
      } catch (x) { toast(msg(x)); } finally { b.disabled = false; }
    });
    box.querySelector("[data-pago]")?.addEventListener("click", async e => {
      const b = e.currentTarget;
      try { await api.put(`/v1/tax/darfs/${b.dataset.pago}`, { paid_value: b.dataset.val }); toast("DARF marcado como pago na apuração."); onPaid?.(); } catch (x) { toast(msg(x)); }
    });
  };
  await draw();
}
