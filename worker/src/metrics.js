/* Observabilidade (Engenharia v6.0 §25–26) dentro do orçamento do plano gratuito:
 * contadores e histograma de latência agregados em memória do isolate e gravados no D1 no máximo
 * uma vez por minuto (uma escrita por chave por minuto, não por requisição). Buckets por hora, 7 dias.
 * Sem dados pessoais: só rota normalizada, status e tempos. */
export const METRICS_SCHEMA = ["CREATE TABLE IF NOT EXISTS metrics (bucket TEXT NOT NULL, key TEXT NOT NULL, n INTEGER NOT NULL DEFAULT 0, e4 INTEGER NOT NULL DEFAULT 0, e5 INTEGER NOT NULL DEFAULT 0, ms_sum REAL NOT NULL DEFAULT 0, ms_max REAL NOT NULL DEFAULT 0, h TEXT NOT NULL DEFAULT '[0,0,0,0,0,0,0]', v REAL NOT NULL DEFAULT 0, PRIMARY KEY (bucket, key))"];
export const HIST = [50, 100, 250, 500, 1000, 2500];          // limites (ms) do histograma; último balde = acima
const MEM = new Map();
let lastFlush = Date.now();
const bucketOf = (d = new Date()) => d.toISOString().slice(0, 13);

export function routeGroup(method, path) {
  return method + " " + path.replace(/\/(doc|tra|alr|imp|bt|grt|calc|tc|stg|jr|wl|pt|usr|ext|of|itm|pay|ntf|trd)_[A-Za-z0-9_-]+/g, "/:id")
    .replace(/\/\d{4}-\d{2}(-\d{2})?(?=\/|$)/g, "/:data").replace(/\/[A-Z]{4}\d{1,2}(?=\/|$)/g, "/:ativo").slice(0, 80);
}
const slot = key => { const b = bucketOf(), k = b + "|" + key; let s = MEM.get(k); if (!s) MEM.set(k, s = { bucket: b, key, n: 0, e4: 0, e5: 0, ms_sum: 0, ms_max: 0, h: [0, 0, 0, 0, 0, 0, 0], v: 0 }); return s; };

export function recordRequest(group, ms, status) {
  const s = slot("api " + group); s.n++; if (status >= 500) s.e5++; else if (status >= 400) s.e4++;
  s.ms_sum += ms; s.ms_max = Math.max(s.ms_max, ms);
  let i = HIST.findIndex(lim => ms < lim); if (i < 0) i = HIST.length; s.h[i]++;
}
/* eventos de domínio: count("ai.block.recomendacao"), count("tax.calc", qualidade) */
export function count(key, value = 0) { const s = slot(key); s.n++; s.v += +value || 0; }

export async function flush(db, { force = false } = {}) {
  if (!MEM.size || (!force && Date.now() - lastFlush < 60000 && MEM.size < 150)) return 0;
  const rows = [...MEM.values()]; MEM.clear(); lastFlush = Date.now();
  const stmts = rows.map(r => db.prepare(`INSERT INTO metrics (bucket,key,n,e4,e5,ms_sum,ms_max,h,v) VALUES (?,?,?,?,?,?,?,?,?)
    ON CONFLICT(bucket,key) DO UPDATE SET n=n+excluded.n, e4=e4+excluded.e4, e5=e5+excluded.e5, ms_sum=ms_sum+excluded.ms_sum, ms_max=MAX(ms_max,excluded.ms_max), v=v+excluded.v,
    h=json_array(json_extract(h,'$[0]')+json_extract(excluded.h,'$[0]'), json_extract(h,'$[1]')+json_extract(excluded.h,'$[1]'), json_extract(h,'$[2]')+json_extract(excluded.h,'$[2]'),
      json_extract(h,'$[3]')+json_extract(excluded.h,'$[3]'), json_extract(h,'$[4]')+json_extract(excluded.h,'$[4]'), json_extract(h,'$[5]')+json_extract(excluded.h,'$[5]'), json_extract(h,'$[6]')+json_extract(excluded.h,'$[6]'))`)
    .bind(r.bucket, r.key, r.n, r.e4, r.e5, r.ms_sum, r.ms_max, JSON.stringify(r.h), r.v));
  try { for (let i = 0; i < stmts.length; i += 50) await db.batch(stmts.slice(i, i + 50)); } catch (e) { console.error("métricas: falha ao gravar", e.message || e); }
  return rows.length;
}
export async function prune(db) { await db.prepare("DELETE FROM metrics WHERE bucket < ?").bind(bucketOf(new Date(Date.now() - 7 * 864e5))).run(); }

/* percentil estimado pelo histograma (limite superior do balde onde o percentil cai) */
export function pctl(h, p) { const tot = h.reduce((a, b) => a + b, 0); if (!tot) return null; let acc = 0; for (let i = 0; i < h.length; i++) { acc += h[i]; if (acc / tot >= p) return i < HIST.length ? HIST[i] : HIST.at(-1) * 2; } return null; }

/* resumo das últimas `hours` horas para o painel do administrador */
export async function summary(db, hours = 24) {
  const since = bucketOf(new Date(Date.now() - hours * 36e5));
  const { results } = await db.prepare("SELECT key, SUM(n) n, SUM(e4) e4, SUM(e5) e5, SUM(ms_sum) ms_sum, MAX(ms_max) ms_max, SUM(v) v, json_group_array(h) hs FROM metrics WHERE bucket >= ? GROUP BY key").bind(since).all();
  const merge = hs => JSON.parse(hs).map(x => JSON.parse(x)).reduce((acc, h) => acc.map((v, i) => v + (h[i] || 0)), [0, 0, 0, 0, 0, 0, 0]);
  const api = [], events = [];
  for (const r of results) {
    if (r.key.startsWith("api ")) { const h = merge(r.hs); api.push({ route: r.key.slice(4), requests: r.n, errors_4xx: r.e4, errors_5xx: r.e5, avg_ms: r.n ? Math.round(r.ms_sum / r.n) : 0, max_ms: Math.round(r.ms_max), p50_ms: pctl(h, 0.5), p95_ms: pctl(h, 0.95), p99_ms: pctl(h, 0.99) }); }
    else events.push({ key: r.key, count: r.n, avg_value: r.n ? Math.round(r.v / r.n * 100) / 100 : 0 });
  }
  api.sort((a, b) => b.requests - a.requests);
  const tot = api.reduce((s, x) => s + x.requests, 0), e5 = api.reduce((s, x) => s + x.errors_5xx, 0);
  const allH = results.filter(r => r.key.startsWith("api ")).map(r => merge(r.hs)).reduce((acc, h) => acc.map((v, i) => v + h[i]), [0, 0, 0, 0, 0, 0, 0]);
  return { window_hours: hours, requests: tot, availability: tot ? 1 - e5 / tot : null, p95_ms: pctl(allH, 0.95), api, events,
    slo: { availability_target: 0.995, p95_target_ms: 500, availability_ok: tot ? 1 - e5 / tot >= 0.995 : null, p95_ok: pctl(allH, 0.95) == null ? null : pctl(allH, 0.95) <= 500 },
    note: "p95 estimado por histograma (limite superior do balde). Tempo medido no Worker, incluindo espera de banco e serviços externos." };
}
