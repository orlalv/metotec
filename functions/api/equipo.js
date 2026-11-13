// Etapa 3 · Equipo (KV «qc/equipo»): personas (hasta 8), sus estaciones, sus reglas de «Mis alertas» y cómo avisarles.
//   {personas: [{nombre, ausente, estaciones: [cod], alertas: [regla], telegram, correo}]}
// GET               : el equipo (con clave general)
// POST {persona, antes?} : crea o actualiza una persona (antes = nombre anterior, para renombrar)
// POST {borrar: nombre}  : quita a una persona
import { json } from "./_kv.js";
const ok = (request, env) => env.CLAVE_DOCENTE && request.headers.get("x-clave") === env.CLAVE_DOCENTE;
const limpio = p => ({
  nombre: String(p.nombre || "").trim().slice(0, 40), ausente: !!p.ausente,
  estaciones: [...new Set((p.estaciones || []).map(String))].filter(c => /^\d{4,8}$/.test(c)).slice(0, 400),
  alertas: (p.alertas || []).slice(0, 40).map(r => ({ id: String(r.id || Date.now().toString(36)).slice(0, 20), nombre: String(r.nombre || "").slice(0, 80),
    fuente: r.fuente === "obs" ? "obs" : "ema", donde: String(r.donde || "todas").slice(0, 10), cods: (r.cods || []).map(String).slice(0, 100),
    var: String(r.var || "").slice(0, 10), op: [">", ">=", "<", "<=", "=", "en", "sin"].includes(r.op) ? r.op : ">", valor: String(r.valor ?? "").slice(0, 60), activa: r.activa !== false })),
  telegram: String(p.telegram || "").trim().slice(0, 30), correo: String(p.correo || "").trim().slice(0, 80)
});
export async function onRequestGet({ request, env }){
  if (!ok(request, env)) return new Response("Clave incorrecta", { status: 401 });
  return json((await env.DATOS.get("qc/equipo", "json")) || { personas: [] });
}
export async function onRequestPost({ request, env }){
  if (!ok(request, env)) return new Response("Clave incorrecta", { status: 401 });
  let b; try { b = await request.json(); } catch (e) { return new Response("JSON inválido", { status: 400 }); }
  const E = (await env.DATOS.get("qc/equipo", "json")) || { personas: [] };
  if (b.borrar) E.personas = E.personas.filter(p => p.nombre !== b.borrar);
  else {
    const p = limpio(b.persona || {}); if (!p.nombre) return new Response("Falta el nombre", { status: 400 });
    const i = E.personas.findIndex(x => x.nombre === (b.antes || p.nombre));
    if (i >= 0) E.personas[i] = p;
    else { if (E.personas.length >= 8) return new Response("Máximo 8 personas", { status: 400 }); E.personas.push(p); }
  }
  await env.DATOS.put("qc/equipo", JSON.stringify(E));
  return json(E);
}
