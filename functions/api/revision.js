// POST /api/revision  {dia:"AAAA-MM-DD", id:"<id del hallazgo>", v:"real"|"falsa"|"resuelto"|"omitir"|"", msg?, quien?}  (con x-clave)
// Marca manual de un aviso: «resuelto» (quitado de la lista; no vuelve mientras el dato sea el mismo),
// «omitir» (archivada: no vuelve a salir nunca para esa estación/hora/regla, aunque el dato siga igual),
// «falsa» (falsa alarma: mide y ajusta reglas) o «real». Se guarda por día en qc/rev/AAAA-MM-DD y se ve en el Historial.
import { json } from "./_kv.js";
export async function onRequestPost({ request, env }){
  if (!env.CLAVE_DOCENTE || request.headers.get("x-clave") !== env.CLAVE_DOCENTE) return new Response("Clave incorrecta", { status: 401 });
  let b; try { b = await request.json(); } catch (e) { return new Response("JSON inválido", { status: 400 }); }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(b.dia || "") || !b.id || !["real", "falsa", "resuelto", "omitir", ""].includes(b.v)) return new Response("Datos inválidos", { status: 400 });
  const k = "qc/rev/" + b.dia, R = (await env.DATOS.get(k, "json")) || {};
  if (b.v) R[b.id] = { v: b.v, t: new Date().toISOString().slice(0, 19), msg: String(b.msg || "").slice(0, 400), quien: String(b.quien || "").slice(0, 40) || undefined };
  else delete R[b.id];
  await env.DATOS.put(k, JSON.stringify(R));
  return json({ ok: true, marca: R[b.id] || null });
}
