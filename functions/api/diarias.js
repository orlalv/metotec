// GET /api/diarias: planilla común de la observación diaria.
import { listar, json } from "./_kv.js";
export async function onRequestGet({ env }){
  const keys = await listar(env.DATOS, "obs_diaria/");
  const datos = await Promise.all(keys.map(async k => JSON.parse(await env.DATOS.get(k))));
  const recs = datos.filter(d => d && d.rec && d.rec.mom).map(d => ({ ...d.rec, alumno: d.nombre, curso: d.curso || "", origen: d.origen || "", reg: d.recibido }));
  recs.sort((a, b) => a.mom < b.mom ? -1 : a.mom > b.mom ? 1 : (a.reg || "").localeCompare(b.reg || ""));
  return json(recs);
}
