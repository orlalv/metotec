// GET /api/pendientes?e=CÓDIGO&k=FIRMA : pendientes de una sola estación, para el observador (sin la clave docente).
// La firma es SHA-256("CLAVE_DOCENTE|código"), primeros 16 caracteres; el docente la obtiene desde qc.html.
import { json } from "./_kv.js";
async function firma(clave, cod){
  const b = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(clave + "|" + cod));
  return [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, "0")).join("").slice(0, 16);
}
export async function onRequestGet({ request, env }){
  const u = new URL(request.url), cod = (u.searchParams.get("e") || "").trim(), k = (u.searchParams.get("k") || "").trim();
  if (!env.CLAVE_DOCENTE || !cod || k !== await firma(env.CLAVE_DOCENTE, cod)) return new Response("Enlace no válido", { status: 401 });
  const s = await env.DATOS.get("qc/sensorial", "json");
  const e = ((s || {}).estaciones || []).find(x => x.codigo === cod);
  return json({ generado: (s || {}).generado || null, codigo: cod, nombre: e ? e.nombre : null, ultima: e ? e.ultima : null, hallazgos: e ? e.hallazgos : [] });
}
