// Utilidades comunes: listar todas las claves de un prefijo en el KV "DATOS".
export async function listar(kv, prefix){
  const keys = []; let cursor;
  do { const r = await kv.list({ prefix, cursor }); keys.push(...r.keys.map(k => k.name)); cursor = r.list_complete ? null : r.cursor; } while (cursor);
  return keys;
}
export const json = (d, init = {}) => new Response(JSON.stringify(d), { ...init, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...(init.headers || {}) } });
