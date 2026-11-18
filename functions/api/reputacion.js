// GET /api/reputacion : estado de cada estación (semáforo, cuarentena, en revisión) y diagnóstico de pluviómetros (qc/reputacion.py, qc/pluviometros.py).
import { json } from "./_kv.js";
export async function onRequestGet({ request, env }){
  if (!env.CLAVE_DOCENTE || request.headers.get("x-clave") !== env.CLAVE_DOCENTE) return new Response("Clave incorrecta", { status: 401 });
  const [rep, plu] = await Promise.all([env.DATOS.get("qc/reputacion", "json"), env.DATOS.get("qc/pluviometros", "json")]);
  return json({ reputacion: rep || { estaciones: [], generado: null }, pluviometros: plu || { estaciones: [], generado: null } });
}
