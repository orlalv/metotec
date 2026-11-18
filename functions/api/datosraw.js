// GET /api/datosraw?p=diario/2026/11.json : archivo de la rama «datos» por el mismo dominio
// (algunas redes, como la de la DGAC, bloquean raw.githubusercontent.com).
const RAW = "https://raw.githubusercontent.com/orlalv/metotec/datos/";
const OK = /^(diario|ema|sensorial|boletin|hallazgos|series|saclim|productos|pluviometros|goes)\/[\w\/.\-]+$|^[\w.\-]+\.json$/;

export async function onRequestGet({ request }){
  const p = new URL(request.url).searchParams.get("p") || "";
  if (!OK.test(p) || p.includes("..")) return new Response("ruta no permitida", { status: 400 });
  const r = await fetch(RAW + p, { cf: { cacheTtl: 120, cacheEverything: true } });
  if (!r.ok) return new Response("", { status: r.status === 404 ? 404 : 502 });
  const tipo = p.endsWith(".json") ? "application/json; charset=utf-8" : "application/octet-stream";
  return new Response(r.body, { headers: { "content-type": tipo, "cache-control": "public, max-age=120" } });
}
