// GET /api/completitud : horas con observación por estación y día (últimos 40 días) y programa de cada estación (qc/correr.py).
import { json } from "./_kv.js";
export async function onRequestGet({ request, env }){
  if (!env.CLAVE_DOCENTE || request.headers.get("x-clave") !== env.CLAVE_DOCENTE) return new Response("Clave incorrecta", { status: 401 });
  return json((await env.DATOS.get("qc/completitud", "json")) || { estaciones: [], generado: null });
}
