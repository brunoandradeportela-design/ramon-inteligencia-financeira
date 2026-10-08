/* Limite de requisições (Engenharia v6.0 §24): por IP e por grupo de rota, janela fixa de 60 s.
 * Contadores na memória do isolate (sem custo de banco). É uma barreira de abuso por instância, somada à proteção
 * de rede da Cloudflare; para limite global entre regiões, ligar o Rate Limiting do Cloudflare no plano pago.
 * RATE_LIMIT_SCALE multiplica os limites (testes automatizados usam um valor alto). */
const MEM = new Map();
export const POLICIES = [
  { id: "auth", test: (m, p) => (m === "POST" && /^\/v1\/auth\/(login|register|recover|reset|mfa\/verify)$/.test(p)) || p === "/v1/auth/email-available", limit: 20 },
  { id: "mercado", test: (m, p) => p === "/v1/public/market/history", limit: 60 },
  { id: "contato", test: (m, p) => m === "POST" && p === "/v1/public/contact", limit: 5 },
  { id: "pesado", test: (m, p) => m !== "GET" && /^\/v1\/(imports|documents|trader\/backtests|assistant\/query|simulations|voice\/tts)(\/|$)/.test(p), limit: 40 },
  { id: "geral", test: () => true, limit: 600 },
];
export function checkRate(ip, method, path, { scale = 1, now = Date.now() } = {}) {
  const pol = POLICIES.find(x => x.test(method, path)), win = Math.floor(now / 60000), key = `${pol.id}|${ip}|${win}`;
  const n = (MEM.get(key) || 0) + 1; MEM.set(key, n);
  if (MEM.size > 20000) for (const k of MEM.keys()) if (!k.endsWith("|" + win)) MEM.delete(k);
  const limit = Math.round(pol.limit * (+scale || 1));
  return { ok: n <= limit, policy: pol.id, limit, remaining: Math.max(0, limit - n), retry_after: 60 - Math.floor((now % 60000) / 1000) };
}
export const _reset = () => MEM.clear();
