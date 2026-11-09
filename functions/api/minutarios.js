// GET /api/minutarios?cod=330006&desde=2026-11-09T00&hasta=2026-11-10T00
// Datos minutarios de una estación desde el archivo horario de METOTEC (rama «datos» en GitHub).
// Se hace del lado del servidor para que el navegador haga una sola descarga (redes con filtros o límites
// cortaban las 25 descargas sueltas). Devuelve CSV con cabecera y la lista de horas sin archivo.
const RAW = "https://raw.githubusercontent.com/orlalv/metotec/datos/ema/";

export async function onRequestGet({ request }){
  const u = new URL(request.url), cod = (u.searchParams.get("cod") || "").trim();
  if (u.searchParams.has("estaciones")){            // catálogo de estaciones (código, nombre, coordenadas, altura)
    const r = await fetch("https://raw.githubusercontent.com/orlalv/metotec/datos/estaciones.json", { cf: { cacheTtl: 3600, cacheEverything: true } });
    return new Response(r.ok ? await r.text() : "[]", { headers: { "content-type": "application/json; charset=utf-8", "cache-control": "public, max-age=3600" } });
  }
  const desde = Date.parse((u.searchParams.get("desde") || "") + ":00:00Z"), hasta = Date.parse((u.searchParams.get("hasta") || "") + ":00:00Z");
  if (!/^\d{4,7}$/.test(cod) || !desde || !hasta || hasta < desde || hasta - desde > 49 * 3600e3)
    return new Response(JSON.stringify({ error: "parámetros: cod, desde y hasta (AAAA-MM-DDTHH, máx. 49 h)" }), { status: 400, headers: { "content-type": "application/json" } });
  const horas = []; for (let t = desde; t <= hasta && t <= Date.now(); t += 3600e3) horas.push(new Date(t).toISOString().slice(0, 13));
  let cab = null; const faltan = [], filas = [];
  await Promise.all(horas.map(async k => {
    try {
      const r = await fetch(RAW + k.replace(/-/g, "/").replace("T", "/") + ".csv.gz", { cf: { cacheTtl: k < new Date(Date.now() - 2 * 3600e3).toISOString() ? 86400 : 120, cacheEverything: true } });
      if (!r.ok){ faltan.push(k); return; }
      const tx = await new Response(r.body.pipeThrough(new DecompressionStream("gzip"))).text();
      const ls = tx.split("\n"); cab = cab || ls[0];
      for (let i = 1; i < ls.length; i++) if (ls[i].startsWith(cod + ",")) filas.push(ls[i]);
    } catch (e){ faltan.push(k); }
  }));
  filas.sort();
  return new Response(JSON.stringify({ cab, filas, faltan: faltan.sort() }), {
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "public, max-age=120", "access-control-allow-origin": "*" } });
}
