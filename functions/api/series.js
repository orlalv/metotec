// GET /api/series            → resumen nacional de las series de temperatura revisadas
// GET /api/series?cod=…      → resultado completo de una estación (datos, hallazgos, corregidos, cambios)
// Se lee de la rama «datos» (series/resultado/…), que actualiza el flujo «Series de temperatura» de GitHub.
import { json } from "./_kv.js";
export async function onRequestGet({ request, env }){
  if (!env.CLAVE_DOCENTE || request.headers.get("x-clave") !== env.CLAVE_DOCENTE) return new Response("Clave incorrecta", { status: 401 });
  const u = new URL(request.url), cod = u.searchParams.get("cod"), dir = u.searchParams.get("fuente") === "hora" ? "saclim" : "series";
  if (cod && !/^\d{4,7}$/.test(cod)) return new Response("Código inválido", { status: 400 });
  const r = await fetch(`https://raw.githubusercontent.com/orlalv/metotec/datos/${dir}/resultado/${cod || "resumen"}.json`, { cf: { cacheTtl: 120 } });
  if (!r.ok) return json(cod ? { vacio: true } : { estaciones: [] });
  return new Response(await r.text(), { headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" } });
}
