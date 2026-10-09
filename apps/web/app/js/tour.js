/* Motor genérico de tour guiado (sem bibliotecas externas).
 * Uma página registra seu catálogo com registerTour(pageId, versao, steps, ctx). O motor:
 *  - destaca o elemento (camada escura com recorte) e mostra o balão com 4 blocos:
 *    Por que existe · O que faz · O que representa · Por que este número;
 *  - troca abas (ctx.setTab), espera o elemento aparecer e pula passos sem elemento;
 *  - teclado (→/Enter avança, ← volta, Esc sai), foco preso no balão e devolvido ao sair, aria-live;
 *  - celular (≤ 760 px): folha fixa embaixo, elemento rolado para a metade de cima;
 *  - movimento reduzido: sem animação;
 *  - persistência por página no navegador (versão, concluído, último passo).
 * O tour NUNCA clica em botões da página: a camada bloqueia cliques e só os links de ação sugeridos navegam. */

const RM = () => matchMedia("(prefers-reduced-motion: reduce)").matches || document.documentElement.classList.contains("a4-calm");
const MOBILE = () => innerWidth <= 760;
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const KEY = id => "aurion.tour." + id;
const load = id => { try { return JSON.parse(localStorage.getItem(KEY(id)) || "null"); } catch { return null; } };
const save = (id, v) => { try { localStorage.setItem(KEY(id), JSON.stringify(v)); } catch { /* sem armazenamento: segue sem persistir */ } };
const BLOCOS = [["porque", "Por que existe"], ["faz", "O que faz"], ["representa", "O que representa"], ["numero", "Por que este número"]];

let reg = null, run = null;
export const currentTour = () => reg;
export const tourRunning = () => !!run;

/** botão "Tour da página" (HTML) */
export const tourButton = pageId => `<button type="button" class="tour-btn" data-tour-start="${esc(pageId)}" aria-label="Fazer o tour guiado desta página"><span aria-hidden="true">?</span> Tour da página</button>`;

/** a página informa seu catálogo; mostra o botão no cabeçalho, o convite da primeira visita ou abre direto (?tour=1) */
export function registerTour(pageId, versao, steps, ctx, { autostart = false } = {}) {
  reg = { pageId, versao: String(versao), steps, ctx };
  const ph = document.querySelector("[data-pagehead]");
  const head = document.querySelector("[data-tour-slot]") || (ph && !ph.hidden ? ph.querySelector("h1")?.parentElement : null);   // Visão Geral não tem cabeçalho: usa o espaço reservado na própria página
  if (head && !head.querySelector("[data-tour-start]")) head.insertAdjacentHTML("beforeend", tourButton(pageId));
  if (run) return;                                  // re-registro durante o tour (a página redesenhou): mantém o tour aberto
  if (autostart) return void setTimeout(() => startTour(), 60);   // depois de a casca devolver o foco à página
  const st = load(pageId);
  if (st && st.versao === reg.versao && (st.concluido || st.recusado || st.pulado)) return;
  invite(st && st.versao === reg.versao && st.ultimo_passo ? st : null);
}

/** chamado na troca de rota */
export function clearTour() {
  stopTour({ keep: true });
  document.querySelectorAll("[data-pagehead] [data-tour-start]").forEach(b => b.remove());
  document.querySelector(".tour-invite")?.remove();
  reg = null;
}

function invite(st) {
  document.querySelector(".tour-invite")?.remove();
  const el = document.createElement("div");
  el.className = "tour-invite"; el.setAttribute("role", "region"); el.setAttribute("aria-label", "Convite para o tour da página");
  el.innerHTML = st
    ? `<p><b>Tour da página</b><br>Você parou no passo ${st.ultimo_passo + 1}. Quer continuar?</p><div><button type="button" class="btn btn--primary btn--sm" data-ti="continuar">Continuar de onde parei</button><button type="button" class="btn btn--ghost btn--sm" data-ti="recomecar">Recomeçar</button><button type="button" class="btn btn--ghost btn--sm" data-ti="nao">Agora não</button></div>`
    : `<p><b>É sua primeira vez aqui?</b><br>Faça o tour de 2 minutos: cada cartão e cada número explicados com os seus dados.</p><div><button type="button" class="btn btn--primary btn--sm" data-ti="comecar">Começar</button><button type="button" class="btn btn--ghost btn--sm" data-ti="nao">Agora não</button></div>`;
  el.addEventListener("click", e => {
    const b = e.target.closest("[data-ti]"); if (!b || !reg) return;
    const a = b.dataset.ti; el.remove();
    if (a === "nao") save(reg.pageId, { ...(load(reg.pageId) || {}), versao: reg.versao, recusado: true });
    else startTour({ from: a === "continuar" ? st.ultimo_passo : 0 });
  });
  document.body.appendChild(el);
}

/* ------------------------------------------------------------------ execução */
export function startTour({ from = 0 } = {}) {
  if (!reg) return;
  stopTour({ keep: true });
  document.querySelector(".tour-invite")?.remove();
  const { ctx } = reg;
  const steps = reg.steps.filter(s => !s.when || s.when(ctx));
  if (!steps.length) return;
  run = { steps, i: -1, opener: document.activeElement, pageId: reg.pageId, versao: reg.versao, idx: false, token: 0 };
  const ov = document.createElement("div");
  ov.className = "tour-ov" + (RM() ? " tour-rm" : "");
  ov.innerHTML = `<div class="tour-dim" data-d="t" aria-hidden="true"></div><div class="tour-dim" data-d="b" aria-hidden="true"></div><div class="tour-dim" data-d="l" aria-hidden="true"></div><div class="tour-dim" data-d="r" aria-hidden="true"></div><div class="tour-hole" aria-hidden="true"></div>
    <div class="tour-pop" role="dialog" aria-modal="true" aria-labelledby="tour-t" tabindex="-1"></div>
    <div class="sr-only" aria-live="polite" data-tour-live></div>`;
  document.body.appendChild(ov);
  document.documentElement.classList.add("tour-on");
  run.ov = ov; run.pop = ov.querySelector(".tour-pop"); run.hole = ov.querySelector(".tour-hole");
  ov.addEventListener("click", onClick);
  document.addEventListener("keydown", onKey, true);
  run.onMove = () => place();
  addEventListener("resize", run.onMove); addEventListener("scroll", run.onMove, true);
  go(Math.min(Math.max(from, 0), steps.length - 1), 1);
}

export function stopTour({ keep = false, concluido = false, pulado = false } = {}) {
  if (!run) return;
  const r = run; run = null;
  const prev = load(r.pageId) || {};
  save(r.pageId, { ...prev, versao: r.versao, concluido: concluido || (!!prev.concluido && prev.versao === r.versao), pulado: pulado || undefined, ultimo_passo: concluido ? 0 : Math.max(r.i, 0) });
  removeEventListener("resize", r.onMove); removeEventListener("scroll", r.onMove, true); document.removeEventListener("keydown", onKey, true);
  r.ov.remove(); document.documentElement.classList.remove("tour-on");
  try { if (r.opener?.isConnected) r.opener.focus({ preventScroll: true }); } catch { /* elemento saiu da tela */ }
}

const wait = ms => new Promise(r => setTimeout(r, ms));
/** primeiro elemento VISÍVEL que casa com o seletor (ex.: menu em pílula no computador, botão ☰ no celular) */
export const pick = sel => [...document.querySelectorAll(sel)].find(el => el.getClientRects().length && getComputedStyle(el).visibility !== "hidden") || null;
async function findTarget(sel, ms = 2500) {
  const t0 = performance.now();
  while (performance.now() - t0 < ms) {
    const el = pick(sel);
    if (el) return el;
    await wait(80);
  }
  return null;
}

async function go(i, dir) {
  if (!run || run.busy) return;
  run.busy = true;
  try { await goNow(i, dir); } finally { if (run) run.busy = false; }
}
async function goNow(i, dir) {
  if (!run) return;
  const token = ++run.token, { steps } = run, ctx = reg?.ctx;
  if (i < 0) return goNow(0, 1);
  if (i >= steps.length) return stopTour({ concluido: true });
  const s = steps[i];
  if (s.tab && ctx?.getTab?.() !== s.tab) { ctx.setTab(s.tab); await wait(30); }
  let el = null;
  const sel = val(s.target);
  if (sel) {
    el = await findTarget(sel, s.espera || (s.tab ? 3000 : 350));
    if (!run || token !== run.token) return;
    if (!el) return goNow(i + dir, dir || 1);           // elemento ausente nesta conta/tela: pula sem quebrar
  }
  run.i = i; run.el = el; run.step = s; run.idx = false;
  save(run.pageId, { ...(load(run.pageId) || {}), versao: run.versao, ultimo_passo: i });
  if (el) {
    const r = el.getBoundingClientRect(), vh = innerHeight;
    const fixo = [...document.querySelectorAll(".gtop,.gnav")].reduce((m, x) => { const cs = getComputedStyle(x); return /sticky|fixed/.test(cs.position) ? Math.max(m, x.getBoundingClientRect().bottom) : m; }, 0);
    const topAlvo = MOBILE() ? fixo + 16 : Math.max(fixo + 16, (vh - Math.min(r.height, vh * .55)) / 2 - 60);
    if (r.top < fixo + 8 || r.bottom > (MOBILE() ? vh * .5 : vh - 20) || r.top > vh * .6)
      scrollTo({ top: Math.max(0, scrollY + r.top - topAlvo), behavior: RM() ? "auto" : "smooth" });
  }
  draw(); place();
  if (!RM()) { setTimeout(place, 220); setTimeout(place, 480); }
  run.pop.focus({ preventScroll: true });
  run.ov.querySelector("[data-tour-live]").textContent = `Passo ${i + 1} de ${steps.length}: ${val(s.titulo)}`;
}

const val = v => typeof v === "function" ? v(reg?.ctx) : v;

function draw() {
  const { steps, i, step: s } = run, ctx = reg?.ctx, demo = ctx?.demo;
  const total = steps.length, last = i === total - 1;
  const body = s.final ? finalHtml(s, ctx) : BLOCOS.map(([k, l]) => { const v = String(val(s[k]) || "").replace(/^Exemplo ilustrativo: estes números não são seus\. /, ""); return v ? `<section class="tour-b tour-b--${k}"><h3>${l}</h3><p>${esc(v)}</p></section>` : ""; }).join("");
  const acao = val(s.acao);
  run.pop.innerHTML = `
    <header class="tour-h"><span class="tour-sec">${esc(s.secao || "")}</span><button type="button" class="tour-x" data-t="fechar" aria-label="Fechar o tour (continua depois)">×</button></header>
    ${demo ? `<p class="tour-demo">Exemplo ilustrativo — estes números não são seus.</p>` : ""}
    <h2 id="tour-t">${esc(val(s.titulo))}</h2>
    <div class="tour-body">${run.idx ? indexHtml() : body}</div>
    ${acao && !run.idx ? `<a class="tour-acao" href="${esc(acao.href)}" data-t="acao">${esc(acao.label)} →</a>` : ""}
    <div class="tour-prog"><span>Passo ${i + 1} de ${total}</span><i aria-hidden="true"><b style="width:${((i + 1) / total * 100).toFixed(1)}%"></b></i></div>
    <footer class="tour-f">
      <div class="tour-f1"><button type="button" class="tour-lnk" data-t="indice" aria-expanded="${run.idx}">Índice</button><button type="button" class="tour-lnk" data-t="depois">Ver de novo depois</button><button type="button" class="tour-lnk" data-t="pular">Pular tour</button></div>
      <div class="tour-f2">${i > 0 ? `<button type="button" class="btn btn--ghost btn--sm" data-t="ant">← Anterior</button>` : ""}<button type="button" class="btn btn--primary btn--sm" data-t="prox">${last ? "Concluir" : "Próximo →"}</button></div>
    </footer>`;
  run.pop.classList.toggle("tour-pop--center", !run.el);
}
function indexHtml() {
  let g = "";
  return `<nav class="tour-idx" aria-label="Índice do tour"><ol>${run.steps.map((s, k) => `${s.secao !== g ? `</ol><p class="tour-idx-g">${esc(g = s.secao || "")}</p><ol>` : ""}<li><button type="button" data-t="ir" data-k="${k}" ${k === run.i ? 'aria-current="step"' : ""}>${k + 1}. ${esc(val(s.titulo))}</button></li>`).join("")}</ol></nav>`;
}
function finalHtml(s, ctx) {
  const r = s.final(ctx);
  return `<p class="tour-final-t">${esc(r.intro)}</p>${r.itens.length ? `<ol class="tour-pend">${r.itens.map(x => `<li><span>${esc(x.texto)}</span><a href="${esc(x.href)}" data-t="acao">${esc(x.label)} →</a></li>`).join("")}</ol>` : `<p class="tour-ok">✓ ${esc(r.vazio)}</p>`}
    <p class="tour-mut">Você pode refazer o tour a qualquer momento pelo botão “Tour da página” ou pela busca (Ctrl K).</p>`;
}

function place() {
  if (!run) return;
  const { pop, hole } = run, el = run.el && run.el.isConnected ? run.el : (run.step?.target ? pick(val(run.step.target)) : null);
  if (el) run.el = el;
  const vw = innerWidth, vh = innerHeight, m = 12;
  const D = k => run.ov.querySelector(`[data-d="${k}"]`).style;
  if (!el) { hole.style.cssText = "opacity:0"; D("t").cssText = "top:0;left:0;right:0;bottom:0"; ["b", "l", "r"].forEach(k => D(k).cssText = "display:none"); pop.style.cssText = ""; pop.classList.add("tour-pop--center"); pop.classList.toggle("tour-pop--sheet", MOBILE()); return; }
  const r = el.getBoundingClientRect(), pad = 6;
  hole.style.cssText = `opacity:1;top:${r.top - pad}px;left:${r.left - pad}px;width:${r.width + pad * 2}px;height:${r.height + pad * 2}px`;
  const y1 = Math.max(0, r.top - pad), y2 = Math.max(y1, r.bottom + pad), x1 = Math.max(0, r.left - pad), x2 = r.right + pad;   // camada escura em 4 partes ao redor do destaque
  D("t").cssText = `top:0;left:0;right:0;height:${y1}px`; D("b").cssText = `top:${y2}px;left:0;right:0;bottom:0`;
  D("l").cssText = `top:${y1}px;left:0;width:${x1}px;height:${y2 - y1}px`; D("r").cssText = `top:${y1}px;left:${x2}px;right:0;height:${y2 - y1}px`;
  pop.classList.remove("tour-pop--center");
  if (MOBILE()) { pop.classList.add("tour-pop--sheet"); pop.style.cssText = ""; return; }
  pop.classList.remove("tour-pop--sheet");
  const pw = Math.min(420, vw - 2 * m), ph = pop.offsetHeight || 320;
  let top, left;
  if (vh - r.bottom >= ph + 16) top = r.bottom + 14;
  else if (r.top >= ph + 16) top = r.top - ph - 14;
  else { top = Math.min(Math.max(m, r.top), vh - ph - m); left = r.right + 14 + pw <= vw - m ? r.right + 14 : r.left - pw - 14; }
  if (left == null) left = r.left + r.width / 2 - pw / 2;
  left = Math.min(Math.max(m, left), vw - pw - m); top = Math.min(Math.max(m, top), Math.max(m, vh - ph - m));
  pop.style.cssText = `top:${top}px;left:${left}px;width:${pw}px`;
}

function onClick(e) {
  const b = e.target.closest("[data-t]");
  if (!b) { if (!e.target.closest(".tour-pop")) { e.preventDefault(); e.stopPropagation(); } return; }   // fora do balão: bloqueia (o tour não aciona a página)
  const a = b.dataset.t;
  if (a === "prox") return run.i === run.steps.length - 1 ? stopTour({ concluido: true }) : go(run.i + 1, 1);
  if (a === "ant") return go(run.i - 1, -1);
  if (a === "fechar" || a === "depois") return stopTour({ keep: true });
  if (a === "pular") return stopTour({ pulado: true });
  if (a === "indice") { run.idx = !run.idx; draw(); place(); return; }
  if (a === "ir") return go(+b.dataset.k, 1);
  if (a === "acao") stopTour({ keep: true });       // o link navega normalmente
}
function onKey(e) {
  if (!run) return;
  e.stopPropagation();
  const inField = /^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName);
  if (e.key === "Escape") { e.preventDefault(); return stopTour({ keep: true }); }
  if (e.key === "ArrowRight" && !inField) { e.preventDefault(); return run.i === run.steps.length - 1 ? stopTour({ concluido: true }) : go(run.i + 1, 1); }
  if (e.key === "ArrowLeft" && !inField) { e.preventDefault(); return go(run.i - 1, -1); }
  if (e.key === "Enter" && e.target === run.pop) { e.preventDefault(); return run.i === run.steps.length - 1 ? stopTour({ concluido: true }) : go(run.i + 1, 1); }
  if (e.key === "Tab") {                            // foco preso no balão
    const f = [...run.pop.querySelectorAll("button,a[href]")]; if (!f.length) return;
    const first = f[0], lastEl = f.at(-1);
    if (e.shiftKey && (document.activeElement === first || document.activeElement === run.pop)) { e.preventDefault(); lastEl.focus(); }
    else if (!e.shiftKey && document.activeElement === lastEl) { e.preventDefault(); first.focus(); }
  }
}

/* botão do cabeçalho (delegado, funciona após redesenhos) */
document.addEventListener("click", e => { if (e.target.closest("[data-tour-start]")) { e.preventDefault(); startTour({ from: 0 }); } });
