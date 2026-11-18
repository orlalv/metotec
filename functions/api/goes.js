// GOES histórico (NOAA AWS) para «Verificar». POST {cod, lat, lon, t:"AAAA-MM-DDTHH:MM", prod:"ir"|"color"} (con x-clave) deja el pedido en el KV
// (qc/pedidos_goes) y la cadena de GitHub Actions lo toma en < 1 min. GET ?id=… → estado/límites; GET ?id=…&img=1 → PNG.
import { json } from "./_kv.js";
const ok = (request, env) => env.CLAVE_DOCENTE && request.headers.get("x-clave") === env.CLAVE_DOCENTE;
const ID = /^[a-z]+_[0-9a-z]+_\d{8}T\d{4}$/;
export async function onRequestPost({ request, env }){
  if (!ok(request, env)) return new Response("Clave incorrecta", { status: 401 });
  const B = await request.json().catch(() => ({}));
  const { cod, lat, lon, t, prod } = B;
  if (!/^\d{4,7}$/.test(cod || "")) return new Response("Código inválido", { status: 400 });
  if (!(Math.abs(lat) <= 90 && Math.abs(lon) <= 180)) return new Response("Coordenadas inválidas", { status: 400 });
  if (!/^\d{4}-\d\d-\d\dT\d\d:\d\d$/.test(t || "")) return new Response("Fecha inválida", { status: 400 });
  if (!["ir", "color"].includes(prod)) return new Response("Producto inválido", { status: 400 });
  const id = `${prod}_${cod}_${t.replace(/[-:]/g, "")}`;
  const previo = await env.DATOS.get(`qc/goes/${id}`, "json");
  if (previo && (previo.estado === "listo" || (previo.estado !== "error" && Date.now() - Date.parse(previo.pedido || 0) < 10 * 60 * 1000))) return json({ ok: true, id, estado: previo.estado });
  const ped = { id, cod, lat: +lat, lon: +lon, t, prod, radio_km: 250, pedido: new Date().toISOString() };
  const p = (await env.DATOS.get("qc/pedidos_goes", "json")) || {};
  p[id] = ped;
  await env.DATOS.put("qc/pedidos_goes", JSON.stringify(p));
  await env.DATOS.put(`qc/goes/${id}`, JSON.stringify({ ...ped, estado: "pendiente" }), { expirationTtl: 60 * 60 * 24 * 90 });
  return json({ ok: true, id, estado: "pendiente" });
}
export async function onRequestGet({ request, env }){
  const u = new URL(request.url), id = u.searchParams.get("id") || "";
  if (!ID.test(id)) return new Response("id inválido", { status: 400 });
  if (u.searchParams.get("img")){
    const b = await env.DATOS.get(`qc/goesimg/${id}`, "arrayBuffer");
    return b ? new Response(b, { headers: { "Content-Type": "image/png", "Cache-Control": "public, max-age=86400" } }) : new Response("sin imagen", { status: 404 });
  }
  const r = await env.DATOS.get(`qc/goes/${id}`, "text");
  return r ? new Response(r, { headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" } }) : json({ estado: "no existe" }, { status: 404 });
}
