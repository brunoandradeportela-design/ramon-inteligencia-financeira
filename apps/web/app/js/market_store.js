/* Estado compartilhado das cotações públicas (faixa de painéis, notebook e globo leem daqui — mesmos números).
 * Consulta o serviço centralizado da API (/v1/public/market): nenhuma chave de provedor no navegador.
 * Atualização periódica com pausa em aba oculta, reconexão com espera crescente e aviso de indisponibilidade. */
const BASE = () => (window.RAMON_API_BASE || "").replace(/\/$/, "");
const subs = new Set(), hist = new Map();
export const market = { snap: null, status: "carregando", erro: null, selected: null, ultima_tentativa: null, intervaloSeg: 60 };
let timer = 0, backoff = 0, started = false;
const emit = () => subs.forEach(f => { try { f(market); } catch (e) { console.error(e); } });
export function subscribe(fn) { subs.add(fn); fn(market); return () => subs.delete(fn); }
export const item = id => market.snap?.items?.find(i => i.id === id) || null;
export function select(id) { market.selected = id; emit(); }

async function poll() {
  clearTimeout(timer);
  if (!BASE()) { market.status = "sem_api"; emit(); return; }
  market.ultima_tentativa = new Date().toISOString();
  try {
    const r = await fetch(BASE() + "/v1/public/market", { cache: "no-store" });
    if (!r.ok) throw new Error("HTTP " + r.status);
    market.snap = await r.json(); market.status = "ok"; market.erro = null; backoff = 0;
  } catch (e) {
    market.erro = e.message; backoff = Math.min(backoff ? backoff * 2 : 15, 120);
    market.status = market.snap ? "reconectando" : "erro";
  }
  emit();
  if (!document.hidden && market.intervaloSeg > 0) timer = setTimeout(poll, (backoff || market.intervaloSeg) * 1000);
}
export function startMarket() {
  if (started) return; started = true; poll();
  document.addEventListener("visibilitychange", () => { if (!document.hidden) poll(); else clearTimeout(timer); });
  addEventListener("online", () => poll());
}
export function stopMarket() { clearTimeout(timer); }
export function setInterval_(seg) { market.intervaloSeg = seg; if (seg > 0) poll(); else clearTimeout(timer); emit(); }
export const refreshNow = () => poll();

/** histórico por período (cache na sessão; o servidor também guarda em cache) */
export function history(id, period) {
  const k = id + ":" + period;
  if (hist.has(k)) return hist.get(k);
  if (!BASE()) return Promise.reject(new Error("API não configurada neste ambiente"));
  const p = fetch(`${BASE()}/v1/public/market/history?id=${encodeURIComponent(id)}&period=${encodeURIComponent(period)}`)
    .then(async r => { const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.detail || "histórico indisponível"); return j; })
    .catch(e => { hist.delete(k); throw e; });
  hist.set(k, p);
  return p;
}
