// GET /api/emahora?h=2026-11-18T14 : archivo horario de todas las estaciones (ema/AAAA/MM/DD/HH.csv.gz de la rama «datos»), tal cual (gzip).
// Lo usa el navegador (Series y Sensores) por el mismo dominio, porque algunas redes bloquean raw.githubusercontent.com.
const RAW = "https://raw.githubusercontent.com/orlalv/metotec/datos/ema/";

export async function onRequestGet({ request }){
  const h = new URL(request.url).searchParams.get("h") || "";
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}$/.test(h)) return new Response("parámetro h = AAAA-MM-DDTHH", { status: 400 });
  const reciente = Date.parse(h + ":00:00Z") > Date.now() - 2 * 3600e3;
  const r = await fetch(RAW + h.replace(/-/g, "/").replace("T", "/") + ".csv.gz", { cf: { cacheTtl: reciente ? 120 : 86400, cacheEverything: true } });
  if (!r.ok) return new Response("", { status: r.status === 404 ? 404 : 502 });
  return new Response(r.body, { headers: { "content-type": "application/octet-stream", "cache-control": reciente ? "public, max-age=120" : "public, max-age=86400" } });
}
