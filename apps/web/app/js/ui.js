/* Utilitários de UI: formatação pt-BR, escape, ícones e gráficos SVG acessíveis. */
export const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const nf = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
export const brl = v => nf.format(+v || 0);
export const pct = (v, d = 1) => `${((+v || 0) * 100).toFixed(d).replace(".", ",")}%`;
export const num = v => new Intl.NumberFormat("pt-BR").format(+v || 0);
export const dt = s => s ? new Date(s.length === 10 ? s + "T12:00:00" : s).toLocaleDateString("pt-BR") : "—";
export const dtm = s => s ? new Date(s).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" }) : "—";
export const mes = m => { const [y, mm] = m.split("-"); return ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"][+mm - 1] + (y ? "/" + y.slice(2) : ""); };
export const sevLabel = { critico: "Crítico", alto: "Alto", atencao: "Atenção", informativo: "Informativo", oportunidade: "Oportunidade" };

export const ICONS = {
  home: '<path d="M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',
  wealth: '<path d="M3 21h18M5 21V10l7-5 7 5v11"/><path d="M9 21v-6h6v6"/>',
  finance: '<path d="M4 7h11M4 7l3-3M4 7l3 3M20 17H9m11 0l-3-3m3 3l-3 3"/>',
  tax: '<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M9 8h6M9 12h6M9 16h3"/>',
  sim: '<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 7h8M8 11h2M12 11h2M16 11h0M8 15h2M12 15h2M8 18h8"/>',
  bell: '<path d="M6 16V11a6 6 0 0 1 12 0v5l2 2H4z"/><path d="M10 20a2 2 0 0 0 4 0"/>',
  doc: '<path d="M6 2.5h8.5L19 7v14.5H6z"/><path d="M14 2.5V7h5M9 12h7M9 16h7"/>',
  link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
  ai: '<path d="M12 3l1.8 4.7L18.5 9.5l-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8z"/><path d="M19 15l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8z"/>',
  plan: '<path d="M12 2l3 6 6 .9-4.5 4.3 1 6.3L12 16.6 6.5 19.5l1-6.3L3 8.9 9 8z"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  moon: '<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/>',
  auto: '<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/>',
  menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
  shield: '<path d="M12 3l8 3v6c0 5-3.5 8.3-8 9.7C7.5 20.3 4 17 4 12V6z"/><path d="M9 12l2 2 4-4"/>',
  logout: '<path d="M15 4h4v16h-4M10 16l-4-4 4-4M6 12h10"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 8h.01M11 12h1v5h1"/>',
  upload: '<path d="M12 16V4M7 9l5-5 5 5"/><path d="M4 16v4h16v-4"/>',
  inbox: '<path d="M3 13l3-8h12l3 8v6H3z"/><path d="M3 13h5l1 3h6l1-3h5"/>',
};
export const icon = (n, cls = "") => `<svg class="${cls}" viewBox="0 0 24 24" aria-hidden="true">${ICONS[n] || ""}</svg>`;

export const PALETTE = ["var(--c1)", "var(--c2)", "var(--c3)", "var(--c4)", "var(--c5)"];

/** Área + linha (evolução). Acessível: role=img + aria-label com resumo. */
export function areaChart(values, { h = 90, w = 320, label = "" } = {}) {
  if (!values.length) return "";
  const min = Math.min(...values), max = Math.max(...values), r = max - min || 1;
  const pts = values.map((v, i) => [i * (w / (values.length - 1 || 1)), h - 8 - ((v - min) / r) * (h - 22)]);
  const line = pts.map((p, i) => (i ? "L" : "M") + p[0].toFixed(1) + " " + p[1].toFixed(1)).join(" ");
  const id = "g" + Math.random().toString(36).slice(2, 7);
  return `<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" style="width:100%;height:${h}px" role="img" aria-label="${esc(label)}">
    <defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="var(--c1)" stop-opacity=".45"/><stop offset="1" stop-color="var(--c1)" stop-opacity="0"/></linearGradient></defs>
    <path d="${line} L${w} ${h} L0 ${h} Z" fill="url(#${id})"/><path d="${line}" fill="none" stroke="var(--c2)" stroke-width="2" vector-effect="non-scaling-stroke"/></svg>`;
}

/** Barras verticais com rótulos de mês. */
export function barChart(items, { h = 110, label = "" } = {}) {
  const max = Math.max(...items.map(i => +i.value), 1);
  const w = 100 / items.length;
  return `<div role="img" aria-label="${esc(label)}" style="display:flex;align-items:flex-end;gap:6px;height:${h}px;margin-top:12px">
    ${items.map(i => `<div style="flex:1;display:flex;flex-direction:column;align-items:center;gap:5px;min-width:0" title="${esc(i.label)}: ${brl(i.value)}">
      <div style="width:min(18px,70%);height:${Math.max(3, (+i.value / max) * (h - 22))}px;border-radius:3px 3px 1px 1px;background:linear-gradient(180deg,var(--c2),var(--c1))"></div>
      <span style="font-size:10px;color:var(--ink-4)">${esc(i.label)}</span></div>`).join("")}</div>`;
}

/** Rosca (alocação). */
export function donut(items, { size = 150, stroke = 22, label = "" } = {}) {
  const r = (size - stroke) / 2, c = 2 * Math.PI * r;
  let acc = 0;
  const segs = items.map((it, i) => {
    const len = it.weight * c, s = `<circle r="${r}" cx="${size / 2}" cy="${size / 2}" fill="none" stroke="${PALETTE[i % 5]}" stroke-width="${stroke}"
      stroke-dasharray="${Math.max(0, len - 2)} ${c}" stroke-dashoffset="${-acc}" transform="rotate(-90 ${size / 2} ${size / 2})"/>`;
    acc += len; return s;
  }).join("");
  return `<svg viewBox="0 0 ${size} ${size}" style="width:${size}px;height:${size}px;flex:none" role="img" aria-label="${esc(label)}">
    <circle r="${r}" cx="${size / 2}" cy="${size / 2}" fill="none" stroke="var(--surface-3)" stroke-width="${stroke}"/>${segs}</svg>`;
}

/** Barras horizontais (categorias). */
export function hbars(items) {
  const max = Math.max(...items.map(i => +i.value), 1);
  return `<ul class="stack" style="margin-top:12px">${items.map((i, k) => `<li>
    <div class="row between small"><span>${esc(i.label)}</span><b style="font-variant-numeric:tabular-nums">${brl(i.value)}</b></div>
    <div style="height:7px;border-radius:4px;background:var(--surface-3);margin-top:5px;overflow:hidden"><i style="display:block;height:100%;width:${(+i.value / max) * 100}%;background:${PALETTE[k % 5]}"></i></div></li>`).join("")}</ul>`;
}

export function confidence(v) {
  return `<span class="confidence" title="Confiança: qualidade/completude dos dados e das regras aplicadas">Confiança <span class="bar"><i style="width:${(v || 0) * 100}%"></i></span> ${pct(v, 0)}</span>`;
}

export function toast(msg) {
  const t = document.createElement("div");
  t.className = "toast"; t.setAttribute("role", "status"); t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 3800);
}

export const empty = (text, ic = "inbox") => `<div class="empty">${icon(ic)}<p>${esc(text)}</p></div>`;
export const loading = () => `<div class="grid g-3">${[1, 2, 3].map(() => `<div class="card"><div class="skeleton" style="width:50%"></div><div class="skeleton" style="width:80%;height:26px;margin-top:14px"></div><div class="skeleton" style="margin-top:14px"></div></div>`).join("")}</div>`;
export const errorBox = e => `<div class="card" role="alert"><h3>Não foi possível carregar</h3><p class="muted small" style="margin-top:6px">${esc(e.message || e)}</p><button class="btn btn--ghost btn--sm" style="margin-top:12px" onclick="location.reload()">Tentar novamente</button></div>`;
