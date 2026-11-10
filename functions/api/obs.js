// GET /api/obs?cod=330021&hora=2026-11-10T12:00&antes=2&despues=2 : observaciones archivadas (Ts, Td, HR y demás) de una estación
// alrededor de una hora (UTC), desde la rama «datos» (sensorial/AAAA/MM/DD.json.gz). Solo con clave.
import { json } from "./_kv.js";
const RAW = "https://raw.githubusercontent.com/orlalv/metotec/datos/sensorial/";
export async function onRequestGet({ request, env }){
  if (!env.CLAVE_DOCENTE || request.headers.get("x-clave") !== env.CLAVE_DOCENTE) return new Response("Clave incorrecta", { status: 401 });
  const u = new URL(request.url), cod = u.searchParams.get("cod") || "", hora = u.searchParams.get("hora") || "";
  const antes = Math.min(6, +(u.searchParams.get("antes") || 2)), despues = Math.min(6, +(u.searchParams.get("despues") || 2));
  const t = Date.parse(hora.slice(0, 13) + ":00:00Z");
  if (!/^\d{4,7}$/.test(cod) || !t) return new Response("parámetros: cod, hora", { status: 400 });
  const horas = []; for (let k = -antes; k <= despues; k++) horas.push(t + k * 3600e3);
  const dias = [...new Set(horas.map(x => new Date(x).toISOString().slice(0, 10)))], arch = {};
  await Promise.all(dias.map(async d => {
    try {
      const r = await fetch(RAW + d.replace(/-/g, "/") + ".json.gz", { cf: { cacheTtl: 60 } });
      if (r.ok) arch[d] = JSON.parse(await new Response(r.body.pipeThrough(new DecompressionStream("gzip"))).text());
    } catch (e){}
  }));
  const val = (o, el, c) => { const x = ((o || {})[el] || {})[c || el]; return typeof x === "number" ? x : null; };
  const filas = horas.map(x => { const iso = new Date(x).toISOString(), d = iso.slice(0, 10), h = iso.slice(11, 13), o = ((arch[d] || {})[cod] || {})[h];
    return { hora: iso.slice(0, 16), hay: !!o, Ts: val(o, "Ts"), Td: val(o, "Td"), HR: val(o, "HR"), QFE: val(o, "QFE"), QFF: val(o, "QFF") }; });
  return json({ cod, filas });
}
