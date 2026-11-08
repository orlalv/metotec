// GET /api/qc: último resultado del control de calidad (solo con clave). Cabecera x-clave = CLAVE_DOCENTE.
export async function onRequestGet({ request, env }){
  if (!env.CLAVE_DOCENTE) return new Response("Falta configurar CLAVE_DOCENTE", { status: 500 });
  if (request.headers.get("x-clave") !== env.CLAVE_DOCENTE) return new Response("Clave incorrecta", { status: 401 });
  const [a, s] = await Promise.all([env.DATOS.get("qc/ultimo", "json"), env.DATOS.get("qc/sensorial", "json")]);
  const r = a || { estaciones: [], resumen: {}, generado: null };
  r.observaciones = s || { estaciones: [], generado: null };
  return new Response(JSON.stringify(r), { headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" } });
}
