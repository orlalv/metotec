// GET /api/aguacaida?cod=270008            → {cod, desde, hasta, n, dias: [[fecha, parcial, total, traza], …]}
// GET /api/aguacaida?cod=270008&crudo=1    → respuesta original del servicio (para revisar su formato)
// Agua caída diaria histórica de una estación (servicio serviciosb/getAguaCaidaDiaria de la DMC). La consulta se hace
// del lado del servidor para no exponer el usuario ni el token de la DMC (secretos DMC_USUARIO y DMC_TOKEN de Pages).
// Con clave general (x-clave), como el resto del control de calidad.
import { json } from "./_kv.js";
import { normalizar } from "./_aguacaida.js";

const BASE = "https://climatologia.meteochile.gob.cl/application/serviciosb/getAguaCaidaDiaria/";

export async function onRequestGet({ request, env }){
  if (!env.CLAVE_DOCENTE || request.headers.get("x-clave") !== env.CLAVE_DOCENTE) return new Response("Clave incorrecta", { status: 401 });
  const u = new URL(request.url), cod = (u.searchParams.get("cod") || "").trim();
  if (!/^\d{4,7}$/.test(cod)) return json({ error: "Código de estación inválido" }, { status: 400 });
  if (!env.DMC_USUARIO || !env.DMC_TOKEN)
    return json({ error: "Faltan los secretos DMC_USUARIO y DMC_TOKEN en Cloudflare Pages (se copian al publicar el sitio con «Publicar en Cloudflare Pages»)." }, { status: 503 });
  const url = new URL(BASE + cod);
  url.searchParams.set("usuario", env.DMC_USUARIO); url.searchParams.set("token", env.DMC_TOKEN);
  let r, txt;
  try {
    r = await fetch(url, { signal: AbortSignal.timeout(28000), cf: { cacheTtl: 3600, cacheEverything: true } });
    txt = await r.text();
  } catch (e){
    return json({ error: "El servicio de la DMC no respondió a tiempo. Intente de nuevo en unos minutos." }, { status: 504 });
  }
  if (!r.ok) return json({ error: `El servicio de la DMC respondió ${r.status}.` }, { status: 502 });
  if (u.searchParams.has("crudo")) return new Response(txt, { headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" } });
  let js; try { js = JSON.parse(txt); } catch (e){ return json({ error: "La respuesta de la DMC no es JSON." }, { status: 502 }); }
  const N = normalizar(js);
  if (!N.n) return json({ error: N.mensaje ? `La DMC respondió: ${N.mensaje}` : "El servicio no devolvió días que se puedan reconocer. Revise el formato con ?crudo=1.", hojas: N.hojas, sinFecha: N.sinFecha }, { status: 502 });
  return json({ cod, desde: N.desde, hasta: N.hasta, n: N.n, dias: N.dias });
}
