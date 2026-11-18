// Estaciones externas (INIA, CEAZA, SERVIMET…): lluvia horaria/diaria de agrometeorologia.cl, dejada en el KV por qc/externas.py (cada hora).
import { json } from "./_kv.js";
export async function onRequestGet({ request, env }){
  if (!env.CLAVE_DOCENTE || request.headers.get("x-clave") !== env.CLAVE_DOCENTE) return new Response("Clave incorrecta", { status: 401 });
  const r = await env.DATOS.get("qc/externas_pp", "text");
  return r ? new Response(r, { headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "public, max-age=300" } }) : json({ error: "sin datos todavía" }, { status: 404 });
}
