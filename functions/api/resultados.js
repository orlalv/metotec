// GET/DELETE /api/resultados (solo docente): cabecera x-clave = secreto CLAVE_DOCENTE.
import { listar, json } from "./_kv.js";
function auth(request, env){
  if (!env.CLAVE_DOCENTE) return new Response("Falta configurar CLAVE_DOCENTE en Cloudflare", { status: 500 });
  if (request.headers.get("x-clave") !== env.CLAVE_DOCENTE) return new Response("Clave incorrecta", { status: 401 });
  return null;
}
export async function onRequestGet({ request, env }){
  const no = auth(request, env); if (no) return no;
  const p = new URL(request.url).searchParams.get("prueba");
  const keys = await listar(env.DATOS, p ? p + "/" : undefined);
  const datos = await Promise.all(keys.map(async k => ({ key: k, ...(JSON.parse(await env.DATOS.get(k)) || {}) })));
  datos.sort((a, b) => (b.recibido || "").localeCompare(a.recibido || ""));
  return json(datos);
}
export async function onRequestDelete({ request, env }){
  const no = auth(request, env); if (no) return no;
  const key = new URL(request.url).searchParams.get("key");
  if (!key) return new Response("Falta key", { status: 400 });
  await env.DATOS.delete(key);
  return json({ ok: true });
}
