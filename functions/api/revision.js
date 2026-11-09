// POST /api/revision  {dia:"AAAA-MM-DD", id:"<id del hallazgo>", v:"real"|"falsa"|""}  (con x-clave)
// Guarda la revisión manual de un aviso: error real o falsa alarma. Sirve para medir el desempeño de cada prueba.
import { json } from "./_kv.js";
export async function onRequestPost({ request, env }){
  if (!env.CLAVE_DOCENTE || request.headers.get("x-clave") !== env.CLAVE_DOCENTE) return new Response("Clave incorrecta", { status: 401 });
  let b; try { b = await request.json(); } catch (e) { return new Response("JSON inválido", { status: 400 }); }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(b.dia || "") || !b.id || !["real", "falsa", ""].includes(b.v)) return new Response("Datos inválidos", { status: 400 });
  const k = "qc/rev/" + b.dia, R = (await env.DATOS.get(k, "json")) || {};
  if (b.v) R[b.id] = { v: b.v, t: new Date().toISOString().slice(0, 16) }; else delete R[b.id];
  await env.DATOS.put(k, JSON.stringify(R));
  return json({ ok: true, n: Object.keys(R).length });
}
