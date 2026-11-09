// GET /api/boletin?dia=AAAA-MM-DD : revisión del boletín climatológico diario (solo con clave).
// Sin «dia»: el último día disponible (hoy o, si aún no sale, los días anteriores hasta 7).
import { json } from "./_kv.js";
export async function onRequestGet({ request, env }){
  if (!env.CLAVE_DOCENTE) return new Response("Falta configurar CLAVE_DOCENTE", { status: 500 });
  if (request.headers.get("x-clave") !== env.CLAVE_DOCENTE) return new Response("Clave incorrecta", { status: 401 });
  const u = new URL(request.url), pedido = u.searchParams.get("dia");
  if (pedido){
    if (!/^\d{4}-\d{2}-\d{2}$/.test(pedido)) return new Response("Fecha inválida", { status: 400 });
    const r = await env.DATOS.get("qc/boletin/" + pedido, "json");
    return r ? json(r) : json({ dia: pedido, vacio: true });
  }
  const hoy = new Date(Date.now() - 3 * 3600e3);
  for (let k = 0; k < 8; k++){
    const d = new Date(hoy - k * 864e5).toISOString().slice(0, 10), r = await env.DATOS.get("qc/boletin/" + d, "json");
    if (r) return json(r);
  }
  return json({ dia: hoy.toISOString().slice(0, 10), vacio: true });
}
