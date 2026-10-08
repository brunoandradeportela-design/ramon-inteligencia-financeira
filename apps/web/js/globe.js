/* Globo financeiro (canvas 2D, projeção ortográfica) — compartilhado pela página inicial e pelo login/cadastro 4.0.
 * Continentes reais (Natural Earth, máscara de 2 KB), malha, órbita de dados, conexões e marcadores clicáveis.
 * Pausa fora da tela; com redução de movimento, desenha um quadro estático. Não precisa de WebGL. */
const RM = matchMedia("(prefers-reduced-motion: reduce)").matches;
const DEG = Math.PI / 180;
let LAND = null, landP = null;
export function landPoints(url) {
  if (LAND) return Promise.resolve(LAND);
  return landP || (landP = fetch(url).then(r => r.json()).then(m => {
    const bytes = Uint8Array.from(atob(m.bits), c => c.charCodeAt(0)), pts = [];
    for (let r = 0; r < m.rows; r++) for (let c = 0; c < m.cols; c++) {
      const i = r * m.cols + c;
      if (bytes[i >> 3] & (1 << (7 - (i & 7)))) pts.push([(m.lat0 - r * m.step - m.step / 2) * DEG, (-180 + c * m.step + m.step / 2) * DEG]);
    }
    return (LAND = pts);
  }));
}
export const DEFAULT_CITIES = [[-23.55, -46.63], [40.71, -74.0], [51.5, -0.12], [35.68, 139.69], [1.35, 103.82], [-33.86, 151.2], [19.43, -99.13]];

/** markers: [{ id, lat, lon, label?: () => string }]; onSelect(marker) ao clicar; lite(): reduzir quadros */
export function makeGlobe(canvas, { speed = 0.12, tilt = -0.32, lon0: L0 = -0.87, landUrl = "assets/data/land-mask.json", cities = DEFAULT_CITIES, markers = [], onSelect = null, orbit = false, lite = () => false } = {}) {
  const ctx = canvas.getContext("2d");
  const CITY = cities.map(([a, b]) => [a * DEG, b * DEG]);
  let lon0 = L0, raf = 0, running = false, last = 0, hits = [], hover = null;
  const size = () => { const d = Math.min(devicePixelRatio || 1, 2), w = canvas.clientWidth || 220; canvas.width = w * d; canvas.height = w * d; return d; };
  let dpr = size();
  const proj = (lat, lon) => {
    const x = Math.cos(lat) * Math.sin(lon - lon0), y0 = Math.sin(lat), z0 = Math.cos(lat) * Math.cos(lon - lon0);
    const y = y0 * Math.cos(tilt) - z0 * Math.sin(tilt), z = y0 * Math.sin(tilt) + z0 * Math.cos(tilt);
    return [x, -y, z];
  };
  const line = (pts, C, R) => { ctx.beginPath(); let first = true; for (const [x, y, z] of pts) { if (z < 0) { first = true; continue; } first ? ctx.moveTo(C + x * R, C + y * R) : ctx.lineTo(C + x * R, C + y * R); first = false; } ctx.stroke(); };
  function frame(t) {
    if (!LAND) return;
    const W = canvas.width, R = W * (markers.length ? 0.38 : 0.42), C = W / 2;
    ctx.clearRect(0, 0, W, W);
    const g = ctx.createRadialGradient(C - R * .3, C - R * .35, R * .1, C, C, R * 1.12);
    g.addColorStop(0, "rgba(32,217,255,.30)"); g.addColorStop(.7, "rgba(22,125,255,.12)"); g.addColorStop(1, "rgba(22,125,255,0)");
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(C, C, R * 1.1, 0, 7); ctx.fill();
    ctx.strokeStyle = "rgba(32,217,255,.8)"; ctx.lineWidth = 1.2 * dpr; ctx.shadowColor = "#20D9FF"; ctx.shadowBlur = 10 * dpr;
    ctx.beginPath(); ctx.arc(C, C, R, 0, 7); ctx.stroke(); ctx.shadowBlur = 0;
    ctx.strokeStyle = "rgba(32,217,255,.16)"; ctx.lineWidth = 0.7 * dpr;
    for (let lon = 0; lon < 360; lon += 30) line(Array.from({ length: 31 }, (_, k) => proj((-90 + k * 6) * DEG, lon * DEG)), C, R);
    for (let lat = -60; lat <= 60; lat += 30) line(Array.from({ length: 61 }, (_, k) => proj(lat * DEG, k * 6 * DEG)), C, R);
    const s0 = W / 220;
    for (const [lat, lon] of LAND) {
      const [x, y, z] = proj(lat, lon); if (z <= 0) continue;
      ctx.fillStyle = `rgba(${90 + 120 * z | 0},${210 + 40 * z | 0},255,${0.25 + 0.7 * z})`;
      const s = (0.9 + 1.4 * z) * s0;
      ctx.fillRect(C + x * R - s / 2, C + y * R - s / 2, s, s);
    }
    if (orbit) {   // órbitas de dados (decorativas)
      ctx.save(); ctx.translate(C, C);
      for (const [rx, ry, rot, a] of [[1.32, .42, -.35, .5], [1.22, .3, .5, .35]]) { ctx.rotate(rot); ctx.strokeStyle = `rgba(32,217,255,${a})`; ctx.setLineDash([3 * dpr, 6 * dpr]); ctx.beginPath(); ctx.ellipse(0, 0, R * rx, R * ry, 0, 0, 7); ctx.stroke(); ctx.rotate(-rot); }
      ctx.setLineDash([]); const ang = (t / 2400) % (2 * Math.PI); ctx.rotate(-.35); ctx.fillStyle = "#ffffff"; ctx.shadowColor = "#20D9FF"; ctx.shadowBlur = 10 * dpr;
      ctx.beginPath(); ctx.arc(Math.cos(ang) * R * 1.32, Math.sin(ang) * R * .42, 2.4 * dpr, 0, 7); ctx.fill(); ctx.restore(); ctx.shadowBlur = 0;
    }
    const vis = CITY.map(c => proj(...c)).filter(p => p[2] > 0.05);
    ctx.lineWidth = 1 * dpr; ctx.strokeStyle = "rgba(32,217,255,.55)";
    for (let i = 1; i < vis.length; i++) { const a = vis[0], b = vis[i], mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2; ctx.beginPath(); ctx.moveTo(C + a[0] * R, C + a[1] * R); ctx.quadraticCurveTo(C + mx * R * 1.25, C + my * R * 1.25, C + b[0] * R, C + b[1] * R); ctx.stroke(); }
    for (const p of vis) { ctx.fillStyle = "#ffffff"; ctx.shadowColor = "#20D9FF"; ctx.shadowBlur = 8 * dpr; ctx.beginPath(); ctx.arc(C + p[0] * R, C + p[1] * R, 2 * dpr, 0, 7); ctx.fill(); ctx.shadowBlur = 0; }
    hits = [];
    for (const mk of markers) {   // marcadores das bolsas (clicáveis)
      const [x, y, z] = proj(mk.lat * DEG, mk.lon * DEG); if (z <= 0.08) continue;
      const px = C + x * R, py = C + y * R, on = hover === mk.id || mk.selected;
      ctx.fillStyle = on ? "#20D58A" : "#20D9FF"; ctx.shadowColor = ctx.fillStyle; ctx.shadowBlur = 12 * dpr;
      ctx.beginPath(); ctx.arc(px, py, (on ? 5 : 3.6) * dpr, 0, 7); ctx.fill(); ctx.shadowBlur = 0;
      const lbl = mk.label ? mk.label() : mk.id;
      ctx.font = `${600} ${11 * dpr}px Figtree, system-ui, sans-serif`; const tw = ctx.measureText(lbl).width;
      const bx = px + 8 * dpr, by = py - 22 * dpr + (mk.dy || 0) * dpr;
      ctx.fillStyle = "rgba(6,20,38,.82)"; ctx.strokeStyle = on ? "rgba(32,213,138,.9)" : "rgba(32,217,255,.7)"; ctx.lineWidth = 1 * dpr;
      ctx.beginPath(); ctx.roundRect ? ctx.roundRect(bx, by, tw + 12 * dpr, 18 * dpr, 4 * dpr) : ctx.rect(bx, by, tw + 12 * dpr, 18 * dpr); ctx.fill(); ctx.stroke();
      ctx.fillStyle = "#F4F8FF"; ctx.fillText(lbl, bx + 6 * dpr, by + 13 * dpr);
      hits.push({ mk, x: px / dpr, y: py / dpr, x2: (bx + tw + 12 * dpr) / dpr, y1: by / dpr });
    }
    if (running && !RM) { const slow = lite(); lon0 -= speed * (slow ? .5 : 1) * Math.min((t - last) / 1000, .05); last = t; raf = requestAnimationFrame(frame); }
  }
  const at = e => { const r = canvas.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top; return hits.find(h => (Math.hypot(h.x - x, h.y - y) < 14) || (x >= h.x && x <= h.x2 && y >= h.y1 && y <= h.y)); };
  if (onSelect) {
    canvas.addEventListener("click", e => { const h = at(e); if (h) onSelect(h.mk); });
    canvas.addEventListener("pointermove", e => { const h = at(e); hover = h ? h.mk.id : null; canvas.style.cursor = h ? "pointer" : ""; if (!running) frame(performance.now()); });
  }
  const start = () => { if (running) return; running = true; last = performance.now(); raf = requestAnimationFrame(frame); };
  const stop = () => { running = false; cancelAnimationFrame(raf); };
  landPoints(landUrl).then(() => { frame(performance.now()); if (!RM) start(); });
  const io = new IntersectionObserver(es => es.forEach(e => (e.isIntersecting && !RM ? start() : stop()))); io.observe(canvas);
  const onResize = () => { dpr = size(); frame(performance.now()); }; addEventListener("resize", onResize);
  return { stop, start, redraw: () => frame(performance.now()), destroy: () => { stop(); io.disconnect(); removeEventListener("resize", onResize); }, focusOn: (lon) => { lon0 = lon * DEG; frame(performance.now()); } };
}
