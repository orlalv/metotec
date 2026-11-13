// Registro de correcciones (KV «qc/correcciones»): {id: {cod, momento, hasta?, var, anterior, nuevo, estado: "corregido"|"rellenado", motivo, quien, t}}
// GET (con clave)          : todo el registro
// POST (con clave) {…}     : agrega una corrección (la usa el formulario del punto 35)
// POST {borrar: id}        : quita una
// Las correcciones se ven en la ficha de cada estación (/api/calidad, público) en azul (corregido) o gris (rellenado).
import { json } from "./_kv.js";
const ok = (request, env) => env.CLAVE_DOCENTE && request.headers.get("x-clave") === env.CLAVE_DOCENTE;
export async function onRequestGet({ request, env }){
  if (!ok(request, env)) return new Response("Clave incorrecta", { status: 401 });
  return json((await env.DATOS.get("qc/correcciones", "json")) || {});
}
export async function onRequestPost({ request, env }){
  if (!ok(request, env)) return new Response("Clave incorrecta", { status: 401 });
  let b; try { b = await request.json(); } catch (e) { return new Response("JSON inválido", { status: 400 }); }
  const C = (await env.DATOS.get("qc/correcciones", "json")) || {};
  if (b.borrar){ delete C[b.borrar]; await env.DATOS.put("qc/correcciones", JSON.stringify(C)); return json({ ok: true }); }
  const f = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}$/;
  if (!/^\d{4,8}$/.test(b.cod || "") || !f.test(b.momento || "") || (b.hasta && !f.test(b.hasta)) || !b.var || !["corregido", "rellenado"].includes(b.estado))
    return new Response("Datos inválidos", { status: 400 });
  const id = b.id || "c|" + b.cod + "|" + b.momento + "|" + b.var;
  C[id] = { cod: b.cod, momento: b.momento, hasta: b.hasta || undefined, var: String(b.var).slice(0, 10), anterior: b.anterior ?? null, nuevo: b.nuevo ?? null,
    estado: b.estado, motivo: String(b.motivo || "").slice(0, 300), quien: String(b.quien || "").slice(0, 40), t: new Date().toISOString().slice(0, 19) };
  await env.DATOS.put("qc/correcciones", JSON.stringify(C));
  return json({ ok: true, id, reg: C[id] });
}
