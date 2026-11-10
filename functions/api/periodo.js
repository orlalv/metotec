// Revisión de un período pasado (mensajes METAR/SYNOP de SACLIM).
// POST {cod, desde, hasta}: deja el pedido en el KV (qc/pedidos_periodo); la cadena de GitHub Actions lo toma en < 1 min.
// GET ?id=…: resultado (o estado «pendiente»). GET sin id: últimos pedidos.
import { json } from "./_kv.js";
const ok = (request, env) => env.CLAVE_DOCENTE && request.headers.get("x-clave") === env.CLAVE_DOCENTE;
const MAX_DIAS = 31;
export async function onRequestPost({ request, env }){
  if (!ok(request, env)) return new Response("Clave incorrecta", { status: 401 });
  const { cod, desde, hasta } = await request.json().catch(() => ({}));
  if (!/^\d{4,7}$/.test(cod || "")) return new Response("Código inválido", { status: 400 });
  if (!/^\d{4}-\d\d-\d\d$/.test(desde || "") || !/^\d{4}-\d\d-\d\d$/.test(hasta || "")) return new Response("Fechas inválidas", { status: 400 });
  const d0 = Date.parse(desde + "T00:00Z"), d1 = Date.parse(hasta + "T00:00Z"), dias = (d1 - d0) / 864e5 + 1;
  if (!(dias >= 1)) return new Response("La fecha final es anterior a la inicial", { status: 400 });
  if (dias > MAX_DIAS) return new Response(`Máximo ${MAX_DIAS} días por revisión`, { status: 400 });
  if (d1 + 864e5 > Date.now()) return new Response("La fecha final debe ser ayer o antes (el día debe estar completo)", { status: 400 });
  const id = `${cod}_${desde}_${hasta}_${Date.now().toString(36)}`;
  const ped = { id, cod, desde, hasta, pedido: new Date().toISOString() };
  const p = (await env.DATOS.get("qc/pedidos_periodo", "json")) || {};
  p[id] = ped;
  await env.DATOS.put("qc/pedidos_periodo", JSON.stringify(p));
  await env.DATOS.put(`qc/periodo/${id}`, JSON.stringify({ ...ped, estado: "pendiente" }), { expirationTtl: 60 * 60 * 24 * 30 });
  const L = (await env.DATOS.get("qc/periodo_lista", "json")) || [];
  L.unshift(ped); await env.DATOS.put("qc/periodo_lista", JSON.stringify(L.slice(0, 30)));
  return json({ ok: true, id });
}
export async function onRequestGet({ request, env }){
  if (!ok(request, env)) return new Response("Clave incorrecta", { status: 401 });
  const id = new URL(request.url).searchParams.get("id");
  if (!id) return json((await env.DATOS.get("qc/periodo_lista", "json")) || []);
  const r = await env.DATOS.get(`qc/periodo/${id}`, "text");
  return r ? new Response(r, { headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" } }) : json({ estado: "no existe" }, { status: 404 });
}
