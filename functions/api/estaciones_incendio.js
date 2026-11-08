// GET /api/estaciones_incendio : estaciones automáticas a ≤ 30 km de un incendio (público, para satelite.metotec.cl/incendios).
export async function onRequestGet({ env }){
  const v = await env.DATOS.get("pub/incendios_estaciones");
  return new Response(v || '{"estaciones":[]}', { headers: { "content-type": "application/json; charset=utf-8",
    "access-control-allow-origin": "*", "cache-control": "public, max-age=120" } });
}
