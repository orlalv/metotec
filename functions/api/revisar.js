// POST /api/revisar {cod}: pide revisar ya las observaciones de una estación (después de corregir en SACLIM).
// Deja el pedido en el KV («qc/pedidos»); la cadena de GitHub Actions lo toma en menos de un minuto y lanza la revisión.
// GET /api/revisar?cod=…: estado del pedido (pendiente / revisado y a qué hora).
import { json } from "./_kv.js";
const ok = (request, env) => env.CLAVE_DOCENTE && request.headers.get("x-clave") === env.CLAVE_DOCENTE;
export async function onRequestPost({ request, env }){
  if (!ok(request, env)) return new Response("Clave incorrecta", { status: 401 });
  const { cod } = await request.json().catch(() => ({}));
  if (!/^\d{4,7}$/.test(cod || "")) return new Response("Código inválido", { status: 400 });
  const p = (await env.DATOS.get("qc/pedidos", "json")) || {};
  p[cod] = new Date().toISOString();
  await env.DATOS.put("qc/pedidos", JSON.stringify(p));
  return json({ ok: true, pedido: p[cod] });
}
export async function onRequestGet({ request, env }){
  if (!ok(request, env)) return new Response("Clave incorrecta", { status: 401 });
  const cod = new URL(request.url).searchParams.get("cod") || "";
  const [p, h] = await Promise.all([env.DATOS.get("qc/pedidos", "json"), env.DATOS.get("qc/revisado_ahora", "json")]);
  return json({ pendiente: !!(p || {})[cod], revisado: (h || {})[cod] || null });
}
