// Estaciones externas (INIA, CEAZA, SERVIMET…) de agrometeorologia.cl, dejadas en el KV por qc/externas.py (cada 15 min).
// Son vecinas solo para los controles (no se muestran como estaciones). Todo con x-clave.
// GET ?v=cat → catálogo; ?v=PP|TA|HR|VV|RD|PS|TS00|TS10 → valores por hora (UTC) de esa variable;
//     ?v=off → {off: [id…]} estaciones desactivadas; ?v=desvio → {desvios: {id: {T, HR, n}}} las que se apartan de sus vecinas DMC (lo escribe qc/correr.py).
// POST {id | ids: [id…], activa: true|false} → activa o desactiva estaciones (KV qc/externas/off) y devuelve la lista nueva.
import { json } from "./_kv.js";
const VARS = ["cat", "PP", "TA", "HR", "VV", "RD", "PS", "TS00", "TS10", "off", "desvio"];
const ok = (request, env) => env.CLAVE_DOCENTE && request.headers.get("x-clave") === env.CLAVE_DOCENTE;
export async function onRequestGet({ request, env }){
  if (!ok(request, env)) return new Response("Clave incorrecta", { status: 401 });
  const v = new URL(request.url).searchParams.get("v") || "cat";
  if (!VARS.includes(v)) return new Response("Variable inválida", { status: 400 });
  const r = await env.DATOS.get(`qc/externas/${v}`, "text");
  if (!r && v === "off") return json({ off: [] });
  return r ? new Response(r, { headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": v === "off" ? "no-store" : "private, max-age=300" } }) : json({ error: "sin datos todavía" }, { status: 404 });
}
export async function onRequestPost({ request, env }){
  if (!ok(request, env)) return new Response("Clave incorrecta", { status: 401 });
  let b; try { b = await request.json(); } catch (e) { return new Response("JSON inválido", { status: 400 }); }
  const ids = (Array.isArray(b.ids) ? b.ids : [b.id]).filter(x => typeof x === "string" && /^[A-Za-z0-9_.-]{1,30}:[A-Za-z0-9_.-]{1,40}$/.test(x));
  if (!ids.length || ids.length > 2000 || typeof b.activa !== "boolean") return new Response("Datos inválidos", { status: 400 });
  const prev = (await env.DATOS.get("qc/externas/off", "json")) || {};
  const off = new Set(Array.isArray(prev.off) ? prev.off : []);
  ids.forEach(i => (b.activa ? off.delete(i) : off.add(i)));
  const nuevo = { off: [...off].sort(), t: new Date().toISOString().slice(0, 19) };
  await env.DATOS.put("qc/externas/off", JSON.stringify(nuevo));
  return json(nuevo);
}
