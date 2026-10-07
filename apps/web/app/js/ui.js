/* Utilitários de UI: formatação pt-BR, escape, ícones e gráficos SVG acessíveis. */
export const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const nf = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
export const brl = v => nf.format(+v || 0);
export const pct = (v, d = 1) => `${((+v || 0) * 100).toFixed(d).replace(".", ",")}%`;
export const num = v => new Intl.NumberFormat("pt-BR").format(+v || 0);
export const dt = s => s ? new Date(s.length === 10 ? s + "T12:00:00" : s).toLocaleDateString("pt-BR") : "—";
export const dtm = s => !s ? "—" : s.length === 10 ? dt(s) : new Date(s).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
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
  search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/>',
  chev: '<path d="M9 6l6 6-6 6"/>', chevd: '<path d="M6 9l6 6 6-6"/>', dots: '<circle cx="5" cy="12" r="1.3"/><circle cx="12" cy="12" r="1.3"/><circle cx="19" cy="12" r="1.3"/>',
  layers: '<path d="M12 3l9 5-9 5-9-5z"/><path d="M3 13l9 5 9-5"/>', receipt: '<path d="M6 3h12v18l-3-2-3 2-3-2-3 2z"/><path d="M9 8h6M9 12h6"/>',
  radar: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><path d="M12 12l6-6"/>', target: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.5"/>',
  chart: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>', trend: '<path d="M3 17l6-6 4 4 8-8"/><path d="M15 7h6v6"/>', drop: '<path d="M12 3c4 5 6 8 6 11a6 6 0 0 1-12 0c0-3 2-6 6-11z"/>',
  bulb: '<path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-4 10.5c.8.8 1 1.5 1 2.5h6c0-1 .2-1.7 1-2.5A6 6 0 0 0 12 3z"/>', news: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 8h10M7 12h10M7 16h6"/>',
  cart: '<path d="M3 4h2l2.5 11h11L21 7H7"/><circle cx="10" cy="19" r="1.4"/><circle cx="17" cy="19" r="1.4"/>', food: '<path d="M7 3v8M5 3v5a2 2 0 0 0 4 0V3M7 11v10M17 3c-2 2-2 6 0 8v10"/>',
  file: '<path d="M6 2.5h8.5L19 7v14.5H6z"/><path d="M14 2.5V7h5"/>', wallet: '<rect x="3" y="6" width="18" height="14" rx="3"/><path d="M3 10h18M16 15h2"/>', grid: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
  candle: '<path d="M7 3v4M7 17v4M17 3v6M17 15v6"/><rect x="5" y="7" width="4" height="10" rx="1"/><rect x="15" y="9" width="4" height="6" rx="1"/>', arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
};
export const icon = (n, cls = "") => `<svg class="${cls}" viewBox="0 0 24 24" aria-hidden="true">${ICONS[n] || ""}</svg>`;

export const PALETTE = ["var(--c1)", "var(--c2)", "var(--c3)", "var(--c4)", "var(--c5)"];

let _gid = 0;
const gid = p => p + (++_gid) + Math.random().toString(36).slice(2, 5);
/** valor compacto: R$ 1,24 mi / R$ 820 mil */
export const brlShort = v => { const n = +v || 0, a = Math.abs(n); return a >= 1e6 ? "R$ " + (n / 1e6).toFixed(2).replace(".", ",") + " mi" : a >= 1e4 ? "R$ " + Math.round(n / 1e3) + " mil" : brl(n); };

/** Área + linha com brilho (evolução). Acessível: role=img + aria-label com resumo. labels = eixo X; tag = etiqueta no último ponto. */
export function areaChart(values, { h = 90, w = 320, label = "", labels = null, tag = null } = {}) {
  if (!values.length) return "";
  const min = Math.min(...values), max = Math.max(...values), r = max - min || 1, padT = tag ? 30 : 10, padB = 10;
  const pts = values.map((v, i) => [i * (w / (values.length - 1 || 1)), padT + (1 - (v - min) / r) * (h - padT - padB)]);
  const line = pts.map((p, i) => (i ? "L" : "M") + p[0].toFixed(1) + " " + p[1].toFixed(1)).join(" ");
  const g = gid("a"), ln = gid("l"), last = pts.at(-1);
  const grid = [0.25, 0.5, 0.75].map(f => `<line x1="0" x2="${w}" y1="${(h * f).toFixed(1)}" y2="${(h * f).toFixed(1)}" class="ch-grid"/>`).join("");
  const dots = pts.map((p, i) => i % 3 === 1 || i === pts.length - 1 ? `<circle cx="${p[0].toFixed(1)}" cy="${p[1].toFixed(1)}" r="${i === pts.length - 1 ? 5.5 : 4}" class="ch-dot${i === pts.length - 1 ? " ch-dot--last" : ""}"/>` : "").join("");
  return `<div class="chart-area" role="img" aria-label="${esc(label)}"><svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" style="width:100%;height:${h}px;overflow:visible">
    <defs><linearGradient id="${g}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="var(--c1)" stop-opacity=".38"/><stop offset="1" stop-color="var(--c1)" stop-opacity="0"/></linearGradient>
      <linearGradient id="${ln}" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="var(--c2)"/><stop offset="1" stop-color="var(--c1)"/></linearGradient></defs>
    ${grid}<path d="${line} L${w} ${h} L0 ${h} Z" fill="url(#${g})"/><path d="${line}" fill="none" stroke="url(#${ln})" stroke-width="2.6" class="ch-glow" vector-effect="non-scaling-stroke"/>${dots}</svg>
    ${tag ? `<span class="ch-tag" style="right:${Math.max(0, 100 - last[0] / w * 100)}%;top:${Math.max(0, last[1] - 34)}px">${esc(tag)}</span>` : ""}
    ${labels ? `<div class="ch-x">${labels.map(l => `<span>${esc(l)}</span>`).join("")}</div>` : ""}</div>`;
}

/** Barras 3D com brilho e rótulo de valor; a barra mais recente com valor fica destacada. */
export function barChart(items, { h = 110, label = "" } = {}) {
  const max = Math.max(...items.map(i => +i.value), 1);
  const lastIdx = items.map((i, k) => +i.value > 0 ? k : -1).filter(k => k >= 0).at(-1);
  return `<div class="bars3d" role="img" aria-label="${esc(label)}" style="height:${h + 34}px">
    ${items.map((i, k) => { const hh = Math.max(6, (+i.value / max) * (h - 18));
      return `<div class="b3" title="${esc(i.label)}: ${brl(i.value)}"><span class="b3-v">${+i.value ? brlShort(i.value).replace(",00", "") : "R$ 0"}</span>
        <div class="b3-col${k === lastIdx ? " b3-col--hi" : ""}${+i.value ? "" : " b3-col--zero"}" style="height:${hh}px"><i></i></div><span class="b3-l">${esc(i.label)}</span></div>`; }).join("")}</div>`;
}

/** Rosca 3D (alocação) com texto central opcional. */
export function donut(items, { size = 150, stroke = 22, label = "", center = null, sub = null } = {}) {
  const r = (size - stroke) / 2, c = 2 * Math.PI * r, cx = size / 2;
  let acc = 0;
  const segs = items.map((it, i) => {
    const len = it.weight * c, s = `<circle r="${r}" cx="${cx}" cy="${cx}" fill="none" stroke="${PALETTE[i % 5]}" stroke-width="${stroke}"
      stroke-dasharray="${Math.max(0, len - 1.5)} ${c}" stroke-dashoffset="${-acc}" transform="rotate(-90 ${cx} ${cx})"/>`;
    acc += len; return s;
  }).join("");
  const sh = gid("s");
  return `<div class="donut3d" style="width:${size}px;height:${size}px"><svg viewBox="0 0 ${size} ${size}" style="width:${size}px;height:${size}px" role="img" aria-label="${esc(label)}">
    <defs><radialGradient id="${sh}" cx="50%" cy="35%" r="65%"><stop offset="0" stop-color="#fff" stop-opacity=".55"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient></defs>
    <circle r="${r}" cx="${cx}" cy="${cx}" fill="none" stroke="var(--surface-3)" stroke-width="${stroke}"/>${segs}
    <circle r="${r}" cx="${cx}" cy="${cx}" fill="none" stroke="url(#${sh})" stroke-width="${stroke}"/></svg>
    ${center ? `<div class="donut3d-c"><b>${esc(center)}</b>${sub ? `<span>${esc(sub)}</span>` : ""}</div>` : ""}</div>`;
}

/** Anel com brilho (contagem de alertas). */
export function ringGauge(n, { size = 132, tone = "neg" } = {}) {
  return `<div class="ring ring--${tone}" style="width:${size}px;height:${size}px"><span class="ring-w"></span><span class="ring-m"></span><b>${esc(String(n))}</b></div>`;
}

/** Ilustrações decorativas de vidro (sem dados). */
export const deco = {
  bars: (cls = "") => `<svg class="deco ${cls}" viewBox="0 0 120 90" aria-hidden="true"><defs><linearGradient id="dg1" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#bfe0ff" stop-opacity=".95"/><stop offset="1" stop-color="#2f7bff" stop-opacity=".55"/></linearGradient></defs>
    ${[[10, 50], [34, 32], [58, 18], [82, 40]].map(([x, y]) => `<path d="M${x} ${y} l12 -6 l12 6 v${84 - y} l-12 6 l-12 -6z" fill="url(#dg1)" stroke="#fff" stroke-opacity=".7"/><path d="M${x} ${y} l12 6 l12 -6" fill="none" stroke="#fff" stroke-opacity=".9"/><path d="M${x + 12} ${y + 6} v${84 - y}" stroke="#fff" stroke-opacity=".5"/>`).join("")}</svg>`,
  layers: (cls = "") => `<svg class="deco ${cls}" viewBox="0 0 120 100" aria-hidden="true"><defs><linearGradient id="dg2" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#9fd0ff"/><stop offset="1" stop-color="#1f5fff"/></linearGradient></defs>
    ${[70, 52, 34, 16].map((y, i) => `<path d="M60 ${y} l46 18 l-46 18 l-46 -18z" fill="url(#dg2)" fill-opacity="${0.35 + i * 0.15}" stroke="#fff" stroke-opacity=".85"/><path d="M14 ${y + 18} v6 l46 18 l46 -18 v-6" fill="#1f5fff" fill-opacity="${0.18 + i * 0.1}" stroke="#fff" stroke-opacity=".5"/>`).join("")}</svg>`,
  city: (cls = "") => `<svg class="deco ${cls}" viewBox="0 0 160 90" aria-hidden="true"><defs><linearGradient id="dg3" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#e6f3ff"/><stop offset="1" stop-color="#4b8dff" stop-opacity=".75"/></linearGradient></defs>
    ${[[8, 46, 18], [30, 22, 22], [56, 8, 26], [86, 30, 20], [110, 16, 24], [138, 44, 16]].map(([x, y, w]) => `<rect x="${x}" y="${y}" width="${w}" height="${90 - y}" rx="2" fill="url(#dg3)" stroke="#fff" stroke-opacity=".8"/>${Array.from({ length: Math.floor((90 - y) / 9) }, (_, k) => `<line x1="${x + 3}" x2="${x + w - 3}" y1="${y + 6 + k * 9}" y2="${y + 6 + k * 9}" stroke="#fff" stroke-opacity=".55"/>`).join("")}`).join("")}</svg>`,
};

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
