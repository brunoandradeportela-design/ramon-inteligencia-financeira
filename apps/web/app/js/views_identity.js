/* AURION Identity no app: login por e-mail ou CPF, mostrar/ocultar senha, MFA, recuperação e redefinição,
 * segurança da conta (CPF, senha, MFA, sessões) e privacidade (auditoria, exportação, eliminação). */
import { api, ApiError, DEMO } from "./api.js";
import { UI4 } from "./ui4.js";
import { onLogin, themeSwitch } from "./app.js";
import { docValid } from "./crm_rules.js";
import { dtm, esc, icon, toast } from "./ui.js";

const msg = e => e instanceof ApiError ? (e.problem.detail || e.problem.title) + (e.problem.errors?.length ? " — " + e.problem.errors.map(x => x.msg).join("; ") : "") : String(e.message || e);
const trust = txt => `<p class="trust-line">${icon("info")}<span>${txt}</span></p>`;
const go = h => { location.hash = h; };
const digits = v => String(v || "").replace(/\D/g, "");
export const looksCpf = v => !String(v).includes("@") && digits(v).length === 11;

export function authLayout(inner) {
  if (UI4) return `<div class="a4-panel">${inner}</div>`;
  return `<div class="auth">
    <div class="auth__art" aria-hidden="true"><div><p class="eyebrow" style="color:#c6d3e0">Seu dinheiro gera dados.</p>
      <h2>Nossa inteligência mostra o que eles significam.</h2><p>Consolide, analise, simule e antecipe cenários financeiros e tributários.</p></div></div>
    <div class="auth__form">${inner}</div></div>`;
}
/* campo de senha com mostrar/ocultar */
export const pwField = (id, label, auto, extra = "") => `<div class="field"><label for="${id}">${label}</label>
  <div style="position:relative"><input class="input" id="${id}" type="password" autocomplete="${auto}" required style="padding-right:84px" ${extra}>
  <button type="button" class="btn btn--ghost btn--sm" data-eye="${id}" aria-controls="${id}" aria-pressed="false" style="position:absolute;right:6px;top:50%;transform:translateY(-50%)">Mostrar</button></div></div>`;
export function wireEyes(root) {
  root.querySelectorAll("[data-eye]").forEach(b => b.onclick = () => {
    const i = root.querySelector("#" + b.dataset.eye), show = i.type === "password";
    i.type = show ? "text" : "password"; b.textContent = show ? "Ocultar" : "Mostrar"; b.setAttribute("aria-pressed", String(show));
  });
}
const done = (res, r) => { onLogin(res.token, res.user); go("#/" + (res.user.roles?.includes("admin") ? "crm" : (r?.params?.get("next") || "dashboard"))); };

export function loginReal(root, r, ownerSetup) {
  root.innerHTML = authLayout(`
    <a href="../index.html" class="muted small">← Voltar ao site</a>
    <h1>Entrar</h1>
    <form id="f" class="stack" novalidate>
      <div class="field"><label for="ident">E-mail ou CPF</label><input class="input" id="ident" autocomplete="username" required inputmode="email" placeholder="voce@email.com ou 000.000.000-00">
        <span class="small muted" id="kind" aria-live="polite"></span></div>
      ${pwField("pw", "Senha", "current-password")}
      <div class="row between"><span></span><a class="small" href="#/recuperar">Esqueci minha senha</a></div>
      <p class="err" id="err" role="alert"></p>
      <button class="btn btn--primary" style="width:100%;height:44px">Entrar</button>
    </form>
    <p class="small muted">Ainda não tem conta? <a href="#/cadastro">Começar agora</a></p>
    ${trust("Nunca pedimos senha de banco. Conexões com instituições acontecem pelo Open Finance, com autenticação feita na própria instituição.")}
    <div>${themeSwitch()}</div>`);
  wireEyes(root);
  const ident = root.querySelector("#ident"), kind = root.querySelector("#kind");
  ident.addEventListener("input", () => { kind.textContent = looksCpf(ident.value) ? (docValid(digits(ident.value)) ? "Entrando com CPF" : "CPF incompleto ou inválido") : ident.value.includes("@") ? "Entrando com e-mail" : ""; });
  root.querySelector("#f").addEventListener("submit", async e => {
    e.preventDefault();
    const btn = e.target.querySelector(".btn--primary"), err = root.querySelector("#err"); btn.disabled = true; err.textContent = "";
    try {
      const res = await api.post("/v1/auth/login", { identifier: ident.value.trim(), password: root.querySelector("#pw").value });
      if (res.mfa_required) return mfaStep(root, r, res.mfa_token);
      done(res, r);
    } catch (x) {
      if (x instanceof ApiError && x.problem.code === "owner_setup_required") return ownerSetup(root, ident.value);
      err.textContent = msg(x); btn.disabled = false;
    }
  });
}

function mfaStep(root, r, ticket) {
  root.innerHTML = authLayout(`
    <a href="#/entrar" class="muted small">← Voltar</a>
    <h1>Verificação em duas etapas</h1>
    <p class="small muted">Digite o código de 6 dígitos do seu aplicativo autenticador. Sem o celular? Use um código de recuperação (formato XXXXX-XXXXX).</p>
    <form id="m" class="stack" novalidate>
      <div class="field"><label for="code">Código</label><input class="input" id="code" autocomplete="one-time-code" inputmode="numeric" required maxlength="11" style="letter-spacing:.2em;font-size:20px"></div>
      <p class="err" id="err" role="alert"></p>
      <button class="btn btn--primary" style="width:100%;height:44px">Confirmar</button></form>`);
  root.querySelector("#code").focus();
  root.querySelector("#m").addEventListener("submit", async e => {
    e.preventDefault();
    const btn = e.target.querySelector("button"), err = root.querySelector("#err"); btn.disabled = true; err.textContent = "";
    try { done(await api.post("/v1/auth/mfa/verify", { mfa_token: ticket, code: root.querySelector("#code").value }), r); }
    catch (x) { err.textContent = msg(x); btn.disabled = false; if (x.status === 401 && /expirou/.test(msg(x))) setTimeout(() => go("#/entrar"), 1500); }
  });
}

export function recoverView(root) {
  root.innerHTML = authLayout(`
    <a href="#/entrar" class="muted small">← Voltar</a>
    <h1>Recuperar acesso</h1>
    <p class="small muted">Informe o e-mail ou o CPF da sua conta. Enviaremos um link de uso único, válido por 30 minutos.</p>
    <form id="r" class="stack" novalidate>
      <div class="field"><label for="ident">E-mail ou CPF</label><input class="input" id="ident" autocomplete="username" required></div>
      <p class="err" id="err" role="alert"></p><div id="ok" role="status"></div>
      <button class="btn btn--primary" style="width:100%;height:44px">Enviar link</button></form>
    ${trust("Por segurança, a resposta é a mesma exista ou não uma conta com esse dado.")}`);
  root.querySelector("#r").addEventListener("submit", async e => {
    e.preventDefault();
    const btn = e.target.querySelector("button"); btn.disabled = true;
    try {
      const res = await api.post("/v1/auth/recover", { identifier: root.querySelector("#ident").value.trim() });
      root.querySelector("#ok").innerHTML = `<div class="card" style="box-shadow:none;border-color:var(--brand-2)"><p class="small">${esc(res.message)}</p>${res.email_enabled ? "" : `<p class="small" style="margin-top:6px"><a href="https://wa.me/5569993071708" target="_blank" rel="noopener">Falar com o suporte pelo WhatsApp</a></p>`}</div>`;
    } catch (x) { root.querySelector("#err").textContent = msg(x); btn.disabled = false; }
  });
}

export function resetView(root, r) {
  const token = r.params.get("token") || "";
  root.innerHTML = authLayout(`
    <h1>Criar nova senha</h1>
    <form id="n" class="stack" novalidate>
      ${pwField("np", "Nova senha", "new-password", 'minlength="10"')}<span class="small muted">10+ caracteres, com letras e números.</span>
      ${pwField("np2", "Repita a nova senha", "new-password")}
      <p class="err" id="err" role="alert"></p>
      <button class="btn btn--primary" style="width:100%;height:44px">Salvar e entrar</button></form>
    ${trust("Ao trocar a senha, todas as outras sessões abertas são encerradas.")}`);
  wireEyes(root);
  root.querySelector("#n").addEventListener("submit", async e => {
    e.preventDefault();
    const err = root.querySelector("#err"), pw = root.querySelector("#np").value, btn = e.target.querySelector(".btn--primary");
    err.textContent = "";
    if (pw !== root.querySelector("#np2").value) return err.textContent = "As senhas não conferem.";
    if (pw.length < 10 || !/\d/.test(pw) || !/[a-z]/i.test(pw)) return err.textContent = "Use 10+ caracteres, com letras e números.";
    btn.disabled = true;
    try { const res = await api.post("/v1/auth/reset", { token, password: pw }); toast("Senha alterada."); done(res); }
    catch (x) { err.textContent = msg(x); btn.disabled = false; }
  });
}

/* ------------------------------------------------------------------ Configurações › Segurança */
function loadQr() {
  return new Promise((ok, ko) => {
    if (window.qrcode) return ok(window.qrcode);
    const s = document.createElement("script"); s.src = "https://cdnjs.cloudflare.com/ajax/libs/qrcode-generator/1.4.4/qrcode.min.js";
    s.onload = () => ok(window.qrcode); s.onerror = () => ko(new Error("Não foi possível gerar o QR code; use a chave em texto.")); document.head.appendChild(s);
  });
}
export async function securitySection(el) {
  if (DEMO) { el.innerHTML = ""; return; }
  const [sec, ss] = await Promise.all([api.get("/v1/security"), api.get("/v1/sessions")]);
  el.innerHTML = `
    <section class="card section" data-tour="cfg-seguranca"><h3>Segurança da conta</h3>
      <div class="grid g-2" style="margin-top:12px">
        <div><b class="small">CPF para entrar</b><p class="small muted" style="margin-top:4px">${sec.cpf_masked ? `Cadastrado: <b>${esc(sec.cpf_masked)}</b>. Você pode entrar com e-mail ou CPF.` : "Cadastre o CPF para entrar também com ele. Guardamos só uma impressão protegida, nunca o número em claro."}</p>
          <form id="cpff" class="row" style="gap:8px;margin-top:8px"><label class="sr-only" for="cpf">CPF</label><input class="input" id="cpf" inputmode="numeric" placeholder="000.000.000-00" style="max-width:200px"><button class="btn btn--ghost btn--sm">${sec.cpf_masked ? "Trocar" : "Cadastrar"}</button></form></div>
        <div><b class="small">Senha</b>
          <form id="pwf" class="stack" style="margin-top:8px">${pwField("cur", "Senha atual", "current-password")}${pwField("nw", "Nova senha", "new-password")}<button class="btn btn--ghost btn--sm" style="align-self:flex-start">Alterar senha</button></form></div>
      </div>
      <div style="margin-top:18px"><b class="small">Verificação em duas etapas (MFA)</b>
        <p class="small muted" style="margin-top:4px">${sec.mfa_enabled ? `Ativa. Restam <b>${sec.recovery_codes_left}</b> códigos de recuperação.` : "Desativada. Use um aplicativo autenticador (Google Authenticator, Microsoft Authenticator, Authy…)."}</p>
        <div id="mfa" style="margin-top:8px">${sec.mfa_enabled ? `<form id="mfad" class="row" style="gap:8px"><input class="input" id="dcode" placeholder="código do app" style="max-width:180px" autocomplete="one-time-code"><button class="btn btn--danger btn--sm">Desativar MFA</button></form>` : `<button class="btn btn--primary btn--sm" id="mfas">Ativar MFA</button>`}</div></div>
      <p class="err" id="serr" role="alert"></p></section>
    <section class="card section" data-tour="cfg-sessoes"><h3>Sessões e dispositivos <span class="right small muted">${ss.items.length}</span></h3>
      <div class="table-wrap"><table class="table" style="margin-top:10px"><thead><tr><th>Dispositivo</th><th>Local aproximado</th><th>Entrou em</th><th>Último uso</th><th></th></tr></thead>
      <tbody>${ss.items.map(s => `<tr><td><b>${esc(s.device || "—")}</b>${s.current ? ` <span class="badge b-ativo">esta sessão</span>` : ""}</td><td class="small">${esc(s.place || "—")}</td><td class="small muted">${dtm(s.created_at)}</td><td class="small muted">${dtm(s.last_seen_at)}</td>
        <td>${s.current ? "" : `<button class="btn btn--ghost btn--sm" data-rev="${esc(s.id)}">Encerrar</button>`}</td></tr>`).join("")}</tbody></table></div>
      ${ss.items.length > 1 ? `<button class="btn btn--ghost btn--sm" id="revall" style="margin-top:10px">Encerrar todas as outras sessões</button>` : ""}</section>`;
  wireEyes(el);
  const err = el.querySelector("#serr"), reload = () => securitySection(el);
  el.querySelector("#cpff").onsubmit = async e => { e.preventDefault(); err.textContent = "";
    const v = digits(el.querySelector("#cpf").value); if (!docValid(v) || v.length !== 11) return err.textContent = "CPF inválido.";
    try { await api.put("/v1/security/cpf", { cpf: v }); toast("CPF cadastrado para login."); reload(); } catch (x) { err.textContent = msg(x); } };
  el.querySelector("#pwf").onsubmit = async e => { e.preventDefault(); err.textContent = "";
    try { const r = await api.post("/v1/auth/password", { current_password: el.querySelector("#cur").value, new_password: el.querySelector("#nw").value });
      toast(`Senha alterada.${r.other_sessions_revoked ? ` ${r.other_sessions_revoked} outra(s) sessão(ões) encerrada(s).` : ""}`); reload(); } catch (x) { err.textContent = msg(x); } };
  el.querySelector("#mfas")?.addEventListener("click", async () => {
    err.textContent = "";
    try {
      const s = await api.post("/v1/security/mfa/setup");
      const box = el.querySelector("#mfa");
      box.innerHTML = `<div class="row wrap" style="gap:16px;align-items:flex-start"><div id="qr" aria-label="QR code para o aplicativo autenticador" style="background:#fff;padding:8px;border-radius:8px"></div>
        <div class="stack small" style="max-width:420px"><p>1. Escaneie o QR code no aplicativo autenticador (ou digite a chave: <code style="word-break:break-all">${esc(s.secret)}</code>).</p>
        <p>2. Digite o código de 6 dígitos que aparecer:</p>
        <form id="mfae" class="row" style="gap:8px"><input class="input" id="ecode" inputmode="numeric" maxlength="6" autocomplete="one-time-code" style="max-width:140px;letter-spacing:.2em"><button class="btn btn--primary btn--sm">Confirmar</button></form></div></div>`;
      try { const q = (await loadQr())(0, "M"); q.addData(s.otpauth_uri); q.make(); box.querySelector("#qr").innerHTML = q.createSvgTag({ cellSize: 4, margin: 2 }); } catch (x) { box.querySelector("#qr").textContent = x.message; }
      box.querySelector("#mfae").onsubmit = async e => { e.preventDefault();
        try { const r = await api.post("/v1/security/mfa/enable", { code: box.querySelector("#ecode").value });
          box.innerHTML = `<div class="card" style="box-shadow:none;border-color:var(--pos)"><b class="small">MFA ativado. Guarde estes códigos de recuperação em local seguro — cada um vale uma vez:</b>
            <pre style="margin-top:8px;font-size:14px;line-height:1.7">${r.recovery_codes.map(esc).join("\n")}</pre><button class="btn btn--ghost btn--sm" id="okc">Já guardei</button></div>`;
          box.querySelector("#okc").onclick = reload; toast("Verificação em duas etapas ativada.");
        } catch (x) { err.textContent = msg(x); } };
    } catch (x) { err.textContent = msg(x); }
  });
  el.querySelector("#mfad")?.addEventListener("submit", async e => { e.preventDefault(); err.textContent = "";
    try { await api.post("/v1/security/mfa/disable", { code: el.querySelector("#dcode").value }); toast("MFA desativado."); reload(); } catch (x) { err.textContent = msg(x); } });
  el.querySelectorAll("[data-rev]").forEach(b => b.onclick = async () => { try { await api.del(`/v1/sessions/${b.dataset.rev}`); toast("Sessão encerrada."); reload(); } catch (x) { toast(msg(x)); } });
  el.querySelector("#revall")?.addEventListener("click", async () => { try { const r = await api.del("/v1/sessions"); toast(`${r?.revoked ?? ""} sessão(ões) encerrada(s).`); reload(); } catch (x) { toast(msg(x)); } });
}

/* ------------------------------------------------------------------ Privacidade (LGPD) */
const ACTION = { "conta.criada": "Conta criada", login: "Entrada", "login.falhou": "Tentativa de entrada recusada", logout: "Saída", "mfa.ativado": "MFA ativado", "mfa.desativado": "MFA desativado",
  "mfa.falhou": "Código MFA recusado", "senha.alterada": "Senha alterada", "senha.redefinida": "Senha redefinida", "senha.recuperacao_solicitada": "Recuperação solicitada",
  "senha.link_gerado_pelo_admin": "Link de redefinição gerado pelo suporte", "cpf.definido": "CPF cadastrado", "sessao.encerrada": "Sessão encerrada", "sessoes.encerradas": "Sessões encerradas",
  "importacao.criada": "Importação", "importacao.apagada": "Importação apagada", "documento.enviado": "Documento guardado", "documento.apagado": "Documento apagado", "documento.alterado": "Documento alterado",
  "conexao.criada": "Conexão Open Finance", "conexao.revogada": "Conexão revogada", "conexao.sincronizada": "Sincronização", "consentimento.revogado": "Consentimento revogado",
  "simulacao.executada": "Simulação", "alerta.status": "Alerta atualizado", "darf.marcado_pago": "DARF marcado como pago", "darf.desmarcado": "DARF desmarcado",
  "tributacao.prejuizos_informados": "Prejuízos informados", "dados.exportados": "Dados exportados", "admin.cliente_alterado": "Cadastro alterado pelo suporte", "admin.pagamento_registrado": "Pagamento registrado",
  "categoria.corrigida": "Categoria corrigida", "acesso_profissional.concedido": "Acesso de profissional concedido", "acesso_profissional.revogado": "Acesso de profissional revogado" };
export async function privacyReal(el) {
  const [a, cons] = await Promise.all([api.get("/v1/audit?limit=200"), api.get("/v1/consents").catch(() => ({ items: [] }))]);
  el.innerHTML = `<div class="grid g-2">
    <section class="card"><h3>Seus direitos (LGPD)</h3><ul class="stack small" style="margin-top:10px"><li>• Confirmação e acesso aos dados</li><li>• Correção (Configurações e cada tela)</li><li>• Portabilidade: exportação completa em JSON</li><li>• Eliminação: apaga conta, dados importados e documentos</li><li>• Informação sobre compartilhamento e revogação do consentimento (Conexões)</li></ul>
      <div class="row wrap" style="gap:8px;margin-top:14px"><button class="btn btn--ghost btn--sm" id="exp">Exportar meus dados</button><button class="btn btn--danger btn--sm" id="del">Excluir minha conta</button></div>
      <div id="delbox"></div>
      <p class="note">A trilha de auditoria é mantida mesmo após a eliminação, por obrigação legal e de segurança.</p></section>
    <section class="card"><h3>Consentimentos</h3>${cons.items.length ? `<ul class="stack small" style="margin-top:10px">${cons.items.map(x => `<li class="row between"><span>${esc(x.institution)} · ${esc((x.scope || []).join(", ") || "dados autorizados")}</span><span class="badge b-${esc(x.status === "ativo" ? "ativo" : "classificado")}">${esc(x.status)}</span></li>`).join("")}</ul>` : `<p class="small muted" style="margin-top:10px">Nenhum compartilhamento ativo. Conexões de bancos e corretoras aparecem aqui com escopo, finalidade e prazo.</p>`}
      <a class="small" href="#/conexoes" style="display:inline-block;margin-top:10px">Gerenciar em Conexões ›</a></section></div>
    <section class="card section"><h3>Trilha de auditoria <span class="right"><span class="badge b-${a.chain_valid ? "ativo" : "vencido"}">${a.chain_valid ? "cadeia íntegra" : "cadeia inválida"}</span></span></h3>
      <p class="small muted" style="margin-top:4px">Cada registro guarda o hash do anterior: qualquer alteração quebra a cadeia. ${a.total} registro(s).</p>
      <div class="table-wrap"><table class="table" style="margin-top:10px"><thead><tr><th>#</th><th>Quando</th><th>Ação</th><th>Por</th><th>Detalhe</th><th>hash</th></tr></thead>
      <tbody>${a.items.slice().reverse().slice(0, 80).map(e => `<tr><td>${e.seq}</td><td class="small">${dtm(e.at)}</td><td>${esc(ACTION[e.action] || e.action)}</td><td class="small muted">${e.actor === "anônimo" ? "não autenticado" : /owner/.test(e.actor) ? "suporte" : "você"}</td>
        <td class="small muted">${esc(e.meta ? Object.entries(e.meta).filter(([, v]) => v !== null && typeof v !== "object").map(([k, v]) => `${k}: ${v}`).join(" · ").slice(0, 90) : "")}</td><td class="small muted"><code>${esc(e.hash.slice(0, 10))}</code></td></tr>`).join("")}</tbody></table></div></section>`;
  el.querySelector("#exp").onclick = async () => { const d = await api.get("/v1/privacy/export"); const b = new Blob([JSON.stringify(d, null, 2)], { type: "application/json" }); const u = URL.createObjectURL(b); Object.assign(document.createElement("a"), { href: u, download: "meus-dados-aurion.json" }).click(); setTimeout(() => URL.revokeObjectURL(u), 2000); toast("Exportação gerada."); };
  el.querySelector("#del").onclick = () => {
    const box = el.querySelector("#delbox");
    box.innerHTML = `<form id="df" class="stack" style="margin-top:12px;border:1px solid var(--neg);border-radius:12px;padding:12px"><b class="small">Isto apaga definitivamente sua conta, dados importados, conexões e documentos.</b>
      ${pwField("dpw", "Confirme com sua senha", "current-password")}<p class="err" id="derr"></p><div class="row" style="gap:8px"><button class="btn btn--danger btn--sm">Excluir definitivamente</button><button type="button" class="btn btn--ghost btn--sm" id="dx">Cancelar</button></div></form>`;
    wireEyes(box);
    box.querySelector("#dx").onclick = () => box.innerHTML = "";
    box.querySelector("#df").onsubmit = async e => { e.preventDefault();
      try { await api.post("/v1/privacy/delete-account", { password: box.querySelector("#dpw").value }); localStorage.removeItem("ramon.token"); location.hash = "#/entrar"; location.reload(); }
      catch (x) { box.querySelector("#derr").textContent = msg(x); } };
  };
}
