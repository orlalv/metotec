// GET /api/qc: último resultado del control de calidad (solo con clave). Cabecera x-clave = CLAVE_DOCENTE.
// Incluye el último dato EMA del Worker de alertas (ema_rapido), las marcas manuales de los últimos 5 días (resuelto / falsa alarma / real) y las fallas informadas.
export async function onRequestGet({ request, env }){
  if (!env.CLAVE_DOCENTE) return new Response("Falta configurar CLAVE_DOCENTE", { status: 500 });
  if (request.headers.get("x-clave") !== env.CLAVE_DOCENTE) return new Response("Clave incorrecta", { status: 401 });
  const dias = [0, 1, 2, 3, 4].map(i => new Date(Date.now() - i * 864e5).toISOString().slice(0, 10));
  const [a, s, inf, rap, ...revs] = await Promise.all([env.DATOS.get("qc/ultimo", "json"), env.DATOS.get("qc/sensorial", "json"), env.DATOS.get("qc/informados", "json"), env.DATOS.get("qc/ema_rapido", "json"),
    ...dias.map(d => env.DATOS.get("qc/rev/" + d, "json"))]);
  const r = a || { estaciones: [], resumen: {}, generado: null };
  r.observaciones = s || { estaciones: [], generado: null };
  r.marcas = {}; dias.forEach((d, i) => Object.entries(revs[i] || {}).forEach(([id, m]) => r.marcas[id] = { ...m, dia: d }));
  r.informados = inf || {};
  r.ema_rapido = rap || null;      // último dato EMA que deja el Worker de alertas cada ~5 min (para «Mis alertas»)
  return new Response(JSON.stringify(r), { headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" } });
}
