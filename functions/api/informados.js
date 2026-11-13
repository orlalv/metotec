// Fallas de estaciones automáticas informadas (botón «Informar»). KV «qc/informados»: {clave: registro}
//   clave = código|prueba|variable|inicio (un episodio). registro: {codigo, nombre, prueba, var, inicio, ultima, t (cuándo se informó), fin?, texto}
// POST {clave, reg}        : marca como informada (o actualiza «ultima» / «fin» cuando la falla terminó)
// POST {clave, borrar:true}: quita la marca
import { json } from "./_kv.js";
export async function onRequestPost({ request, env }){
  if (!env.CLAVE_DOCENTE || request.headers.get("x-clave") !== env.CLAVE_DOCENTE) return new Response("Clave incorrecta", { status: 401 });
  let b; try { b = await request.json(); } catch (e) { return new Response("JSON inválido", { status: 400 }); }
  if (!b.clave || typeof b.clave !== "string" || b.clave.length > 120) return new Response("Datos inválidos", { status: 400 });
  const I = (await env.DATOS.get("qc/informados", "json")) || {};
  if (b.borrar) delete I[b.clave];
  else I[b.clave] = { ...(I[b.clave] || { t: new Date().toISOString().slice(0, 19) }), ...(b.reg || {}) };
  const lim = new Date(Date.now() - 62 * 864e5).toISOString();      // se guardan 2 meses
  for (const [k, r] of Object.entries(I)) if (r.fin && r.fin < lim) delete I[k];
  await env.DATOS.put("qc/informados", JSON.stringify(I));
  return json({ ok: true, reg: I[b.clave] || null });
}
