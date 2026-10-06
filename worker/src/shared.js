/* Utilitários compartilhados entre os módulos da API (modular monolith — ADR-001). */
export class Resp { constructor(status, body = null) { this.status = status; this.body = body; } }
export class Problem extends Error {
  constructor(status, title, detail, extra = {}) { super(detail); this.status = status; this.title = title; this.detail = detail; this.extra = extra; }
}
export const nowIso = () => new Date().toISOString();
export const today = () => new Date(Date.now() - 3 * 3600e3).toISOString().slice(0, 10);   // data de Brasília
export const money = v => (Math.round(Number(v || 0) * 100) / 100).toFixed(2);
export const enc = new TextEncoder();
export const b64u = buf => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
export const randomToken = (n = 32) => b64u(crypto.getRandomValues(new Uint8Array(n)));
export async function sha256(s) { return b64u(await crypto.subtle.digest("SHA-256", enc.encode(s))); }
export function safeEqual(a, b) {
  a = String(a || ""); b = String(b || "");
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
}
export async function hashPassword(pw, salt = randomToken(16), iter = 100000) {
  const key = await crypto.subtle.importKey("raw", enc.encode(pw), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: enc.encode(salt), iterations: iter }, key, 256);
  return `pbkdf2$${iter}$${salt}$${b64u(bits)}`;
}
export async function checkPassword(pw, stored) {
  const [, iter, salt] = String(stored || "").split("$");
  if (!iter) return false;
  return safeEqual(await hashPassword(pw, salt, +iter), stored);
}
export const kvGet = async (db, k, d = null) => { const r = await db.prepare("SELECT v FROM kv WHERE k=?").bind(k).first(); return r ? JSON.parse(r.v) : d; };
export const kvSet = (db, k, v) => db.prepare("INSERT INTO kv (k,v) VALUES (?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v").bind(k, JSON.stringify(v)).run();
export const str = (v, n = 200) => String(v ?? "").slice(0, n);
export const numOrNull = v => (v === null || v === undefined || v === "" || !isFinite(+v)) ? null : Math.round(+v * 1e6) / 1e6;
export const isoDate = v => /^\d{4}-\d{2}-\d{2}$/.test(String(v || "")) ? String(v) : null;
export const ageH = iso => iso ? (Date.now() - Date.parse(iso)) / 36e5 : Infinity;
