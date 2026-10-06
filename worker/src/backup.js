/* Backup lógico e restauração do banco (D1), tabela a tabela, em páginas pequenas (limite de CPU do Worker).
 * Exportar: administrador (sessão do dono) ou rotina com BACKUP_TOKEN. Restaurar: só com RESTORE_ENABLED=1 no
 * ambiente de destino (desligado em produção para evitar sobrescrita acidental) e BACKUP_TOKEN.
 * O arquivo de backup contém dados pessoais e hashes de senha: a rotina do GitHub o criptografa antes de guardar.
 * Complementa o D1 Time Travel (restauração de ponto no tempo feita no painel da Cloudflare). */
import { Problem, safeEqual, nowIso } from "./shared.js";

export const BACKUP_FORMAT = "aurion-backup@1";
const PAGE = 200, BLOB_TABLES = { doc_chunks: ["bytes"] };

const toB64 = u8 => { let s = ""; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s); };
const fromB64 = b => { const s = atob(b), u = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i); return u; };
const asU8 = v => v instanceof Uint8Array ? v : v instanceof ArrayBuffer ? new Uint8Array(v) : Array.isArray(v) ? Uint8Array.from(v) : null;

async function tables(db) {
  const { results } = await db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' AND name NOT LIKE 'd1_%' ORDER BY name").all();
  return results.map(r => r.name);
}
async function columns(db, t) { const { results } = await db.prepare(`PRAGMA table_info("${t}")`).all(); return results.map(r => r.name); }

/* quem pode: token da rotina (comparação em tempo constante) ou o dono logado */
export function backupAuth(req, env) {
  const tok = req.headers.get("X-Backup-Token") || "";
  return !!env.BACKUP_TOKEN && env.BACKUP_TOKEN.length >= 32 && tok && safeEqual(tok, env.BACKUP_TOKEN);
}

export async function backupRoute(m, p, body, q, req, env, db, { ownerOk }) {
  const viaToken = backupAuth(req, env);
  if (!viaToken && !ownerOk) throw new Problem(403, "Acesso negado", "Backup exige o administrador ou o token da rotina de backup.");
  const list = await tables(db);
  if (m === "GET" && p === "/v1/admin/backup/manifest") {
    const out = [];
    for (const t of list) out.push({ name: t, rows: (await db.prepare(`SELECT COUNT(*) AS n FROM "${t}"`).first()).n, columns: await columns(db, t) });
    return { format: BACKUP_FORMAT, created_at: nowIso(), tables: out, note: "Exporte cada tabela com /v1/admin/backup/tabela/{nome}?after=0 até next=null." };
  }
  const mt = p.match(/^\/v1\/admin\/(backup|restore)\/tabela\/([a-z_]+)$/);
  if (!mt || !list.includes(mt[2])) throw new Problem(404, "Não encontrado", "Tabela desconhecida.");
  const t = mt[2], blobs = BLOB_TABLES[t] || [];
  if (mt[1] === "backup" && m === "GET") {
    const after = Math.max(0, parseInt(q.after || "0", 10) || 0), lim = blobs.length ? 1 : PAGE;
    const { results } = await db.prepare(`SELECT rowid AS _rid, * FROM "${t}" WHERE rowid > ? ORDER BY rowid LIMIT ?`).bind(after, lim).all();
    const rows = results.map(r => { const o = { ...r }; delete o._rid; for (const c of blobs) { const u = asU8(o[c]); if (u) o[c] = { $b64: toB64(u) }; } return o; });
    return { table: t, rows, next: results.length === lim ? results.at(-1)._rid : null };
  }
  if (mt[1] === "restore" && m === "POST") {
    if (env.RESTORE_ENABLED !== "1") throw new Problem(409, "Restauração desligada", "Ative RESTORE_ENABLED=1 apenas no ambiente de destino da restauração.");
    if (!viaToken) throw new Problem(403, "Acesso negado", "Restauração exige o token da rotina de backup.");
    const rows = Array.isArray(body.rows) ? body.rows : [];
    if (!rows.length) return { table: t, restored: 0 };
    const cols = await columns(db, t);
    const stmts = rows.map(r => {
      const use = cols.filter(c => c in r);
      const vals = use.map(c => r[c] && typeof r[c] === "object" && "$b64" in r[c] ? fromB64(r[c].$b64) : r[c]);
      return db.prepare(`INSERT OR REPLACE INTO "${t}" (${use.map(c => `"${c}"`).join(",")}) VALUES (${use.map(() => "?").join(",")})`).bind(...vals);
    });
    for (let i = 0; i < stmts.length; i += 50) await db.batch(stmts.slice(i, i + 50));
    return { table: t, restored: rows.length };
  }
  throw new Problem(405, "Método não permitido", `${m} ${p}`);
}
