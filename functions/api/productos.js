// GET /api/productos?tipo=extremas|lluvia|boletin[&dia=AAAA-MM-DD] : productos públicos (sin clave).
//   extremas : extremas del día local (hoy y ayer) de la red automática, con ranking           (KV pub/extremas)
//   lluvia   : lluvia del último periodo 12–12 UTC de las estaciones con observador            (KV pub/lluvia_obs)
//   boletin  : boletín climatológico diario con la revisión (qué dato difiere y cuál debería ir) (KV qc/boletin/<día>)
// Si el KV no lo tiene, se lee el archivo guardado en la rama «datos».
const RAW = "https://raw.githubusercontent.com/orlalv/metotec/datos/";
const cab = { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "public, max-age=120", "Access-Control-Allow-Origin": "*" };
const resp = (d, st = 200) => new Response(JSON.stringify(d), { status: st, headers: cab });

async function leer(env, clave, ruta){
  try { const r = await env.DATOS.get(clave, "json"); if (r) return r; } catch (e){}
  try { const g = await fetch(RAW + ruta, { cf: { cacheTtl: 60 } }); return g.ok ? await g.json() : null; } catch (e){ return null; }
}
// del boletín revisado solo sale lo que sirve al público: valores, calidad de cada celda y el valor probable
function publico(b){
  return {
    dia: b.dia, fecha_txt: b.fecha_txt, revisado: b.revisado, pasadas: (b.pasadas || []).length,
    filas: (b.filas || []).map(f => ({ nombre: f.nombre, v: f.v, marcas: Object.fromEntries(Object.entries(f.marcas || {}).map(([k, m]) =>
      [k, { nivel: m.nivel, sub: m.sub, msg: m.msg, real: m.real ? { valor: m.real.valor, hora: m.real.hora || null, fuente: m.real.fuente } : null }])) })),
    cambios: (b.cambios || []).map(c => ({ hora: c.hora, estacion: c.estacion, col: c.col, antes: c.antes, ahora: c.ahora }))
  };
}
export async function onRequestGet({ request, env }){
  const u = new URL(request.url), tipo = u.searchParams.get("tipo");
  if (tipo === "extremas"){ const r = await leer(env, "pub/extremas", "productos/extremas.json"); return r ? resp(r) : resp({ error: "sin datos" }, 503); }
  if (tipo === "lluvia"){ const r = await leer(env, "pub/lluvia_obs", "productos/lluvia_obs.json"); return r ? resp(r) : resp({ error: "sin datos" }, 503); }
  if (tipo === "boletin"){
    const pedido = u.searchParams.get("dia");
    if (pedido && !/^\d{4}-\d{2}-\d{2}$/.test(pedido)) return resp({ error: "fecha inválida" }, 400);
    const hoy = new Date(Date.now() - 3 * 3600e3);
    const dias = pedido ? [pedido] : Array.from({ length: 8 }, (_, k) => new Date(hoy - k * 864e5).toISOString().slice(0, 10));
    for (const d of dias){
      const r = await leer(env, "qc/boletin/" + d, "boletin/" + d.replace(/-/g, "/") + ".json");
      if (r && r.filas) return resp(publico(r));
    }
    return resp({ dia: dias[0], vacio: true });
  }
  return resp({ error: "tipo: extremas, lluvia o boletin" }, 400);
}
