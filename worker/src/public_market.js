/* Serviço centralizado de cotações públicas (login/cadastro 4.0).
 * Busca no provedor pelo servidor (nenhuma chave no navegador), guarda em cache no D1 e entrega a todos os visitantes.
 * Cache com renovação em segundo plano: a resposta nunca espera o provedor quando já há um valor guardado.
 * Falha do provedor mantém o último valor válido, marcado como desatualizado; sem nenhum valor, "indisponível". */
import { Problem, kvGet, kvSet, nowIso } from "./shared.js";
import { INSTRUMENTS, PERIODS, SNAPSHOT_TTL_MIN, SOURCE, chartUrl, instrument, mergeSnapshot, parseHistory, parseQuote } from "../../apps/web/app/js/market_public.js";

const UA = { "User-Agent": "Mozilla/5.0 (compatible; AurionBot/1.0; +https://aurionfinance.com.br)", Accept: "application/json" };
const ageMin = iso => iso ? (Date.now() - Date.parse(iso)) / 6e4 : Infinity;
const pub = (data, maxAge) => new Response(JSON.stringify(data), { status: 200, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": `public, max-age=${maxAge}`, "X-Content-Type-Options": "nosniff" } });

export async function refreshSnapshot(env, db) {
  if (env.MARKET_OFFLINE === "1" && !env.YAHOO_BASE_URL) return kvGet(db, "pub_market", null);
  const prev = await kvGet(db, "pub_market", null), now = Date.now() / 1000;
  const res = await Promise.allSettled(INSTRUMENTS.map(async inst => {
    const r = await fetch(chartUrl(env.YAHOO_BASE_URL, inst, "1d", "5m"), { headers: UA, signal: AbortSignal.timeout(9000), cf: { cacheTtl: 60 } });
    if (!r.ok) throw new Error("HTTP " + r.status);
    return parseQuote(await r.json(), inst, now);
  }));
  const results = Object.fromEntries(INSTRUMENTS.map((inst, i) => [inst.id, res[i].status === "fulfilled" ? { ok: true, item: res[i].value } : { ok: false, error: String(res[i].reason?.message || res[i].reason).slice(0, 120) }]));
  const snap = mergeSnapshot(prev, results, nowIso());
  await kvSet(db, "pub_market", snap);
  return snap;
}
const anyOpen = snap => (snap?.items || []).some(i => i.mercado === "aberto");

export async function publicMarketRoute(m, p, q, env, db, ctx) {
  if (m !== "GET") throw new Problem(405, "Método não permitido", p);
  if (p === "/v1/public/market") {
    let snap = await kvGet(db, "pub_market", null);
    const ttl = anyOpen(snap) ? SNAPSHOT_TTL_MIN : 30;
    if (!snap) snap = await refreshSnapshot(env, db);
    else if (ageMin(snap.at) > ttl) {
      const lock = await kvGet(db, "pub_market_lock", null);
      if (ageMin(lock) > 1) { await kvSet(db, "pub_market_lock", nowIso()); ctx?.waitUntil ? ctx.waitUntil(refreshSnapshot(env, db).catch(() => {})) : await refreshSnapshot(env, db); }
    }
    if (!snap) return pub({ at: null, fonte: SOURCE, tempo_real: false, items: INSTRUMENTS.map(i => ({ id: i.id, simbolo: i.id, nome: i.nome, tipo: i.tipo, ultimo: null, indisponivel: true })), ok: 0, falhas: INSTRUMENTS.length }, 30);
    return pub({ ...snap, idade_min: Math.round(ageMin(snap.at) * 10) / 10, proxima_atualizacao_min: ttl }, 30);
  }
  if (p === "/v1/public/market/history") {
    const inst = instrument(q.id), per = PERIODS[String(q.period || "").toUpperCase()];
    if (!inst) throw new Problem(422, "Ativo inválido", `Use um destes: ${INSTRUMENTS.map(i => i.id).join(", ")}.`);
    if (!per) throw new Problem(422, "Período inválido", "Use 1D, 1S, 1M, 1A ou 5A.");
    const pk = String(q.period).toUpperCase(), key = `pmh:${inst.id}:${pk}`, cached = await kvGet(db, key, null);
    if (cached && ageMin(cached.at) < per.ttl) return pub({ ...cached, cache: true }, 60);
    try {
      const r = await fetch(chartUrl(env.YAHOO_BASE_URL, inst, per.range, per.interval), { headers: UA, signal: AbortSignal.timeout(9000), cf: { cacheTtl: 120 } });
      if (!r.ok) throw new Error("HTTP " + r.status);
      const pontos = parseHistory(await r.json());
      if (pontos.length < 2) throw new Error("histórico insuficiente");
      const out = { id: inst.id, periodo: pk, intervalo: per.interval, pontos, at: nowIso(), fonte: SOURCE, tempo_real: false };
      await kvSet(db, key, out);
      return pub(out, 60);
    } catch (e) {
      if (cached) return pub({ ...cached, cache: true, desatualizado: true, erro: e.message }, 30);
      throw new Problem(503, "Histórico indisponível", `Não foi possível obter o histórico de ${inst.nome} (${pk}) agora. Tente novamente em instantes.`);
    }
  }
  throw new Problem(404, "Não encontrado", p);
}
