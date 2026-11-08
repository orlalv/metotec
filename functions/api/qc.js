// GET /api/qc: último resultado del control de calidad (solo con clave). Cabecera x-clave = CLAVE_DOCENTE.
export async function onRequestGet({ request, env }){
  if (!env.CLAVE_DOCENTE) return new Response("Falta configurar CLAVE_DOCENTE", { status: 500 });
  if (request.headers.get("x-clave") !== env.CLAVE_DOCENTE) return new Response("Clave incorrecta", { status: 401 });
  const txt = await env.DATOS.get("qc/ultimo");
  if (!txt) return new Response(JSON.stringify({ estaciones: [], resumen: {}, generado: null }), { headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" } });
  return new Response(txt, { headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" } });
}
