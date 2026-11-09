// GET /api/historial?desde=AAAA-MM-DD&hasta=AAAA-MM-DD : hallazgos guardados por día (solo con clave, máx. 62 días).
import { json } from "./_kv.js";
export async function onRequestGet({ request, env }){
  if (!env.CLAVE_DOCENTE) return new Response("Falta configurar CLAVE_DOCENTE", { status: 500 });
  if (request.headers.get("x-clave") !== env.CLAVE_DOCENTE) return new Response("Clave incorrecta", { status: 401 });
  const u = new URL(request.url), dia = d => d.toISOString().slice(0, 10);
  const hasta = new Date((u.searchParams.get("hasta") || dia(new Date())) + "T00:00:00Z");
  let desde = new Date((u.searchParams.get("desde") || dia(new Date(hasta - 6 * 864e5))) + "T00:00:00Z");
  if (isNaN(hasta) || isNaN(desde)) return new Response("Fechas inválidas", { status: 400 });
  if ((hasta - desde) / 864e5 > 61) desde = new Date(hasta - 61 * 864e5);
  const dias = [];
  for (let t = +desde; t <= +hasta; t += 864e5) dias.push(dia(new Date(t)));
  const vals = await Promise.all(dias.map(d => env.DATOS.get("qc/hist/" + d, "json")));
  const revs = await Promise.all(dias.map(d => env.DATOS.get("qc/rev/" + d, "json")));
  return json({ desde: dia(desde), hasta: dia(hasta), dias: Object.fromEntries(dias.map((d, i) => [d, vals[i]]).filter(x => x[1])),
                revisiones: Object.fromEntries(dias.map((d, i) => [d, revs[i]]).filter(x => x[1])) });
}
