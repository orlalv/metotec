// Pestaña Agro · datos sacados a mano del ranking (KV «qc/agro»): {sacados: {id: {p, vk, cod, dia, valor, motivo, quien, t, por}}, log: [{accion, id, quien, motivo, t, por}]}
//   id = «AAAA-MM-DD|utc|tmax|330020|2» (jueves de inicio | tipo de día | variable | estación | día del periodo)
// GET ?p=AAAA-MM-DD|utc  : lo sacado de ese periodo
// POST {accion:"sacar", p, id, vk, cod, dia, valor, motivo, quien} · POST {accion:"devolver", p, id, quien}
// Clave: la general (CLAVE_DOCENTE) o, si existe, CLAVE_AGRO (solo sirve para esta pestaña). Todo queda en el registro (log).
import { json } from "./_kv.js";
const KEY = "qc/agro";
const quien = (request, env) => { const k = request.headers.get("x-clave") || ""; if (env.CLAVE_DOCENTE && k === env.CLAVE_DOCENTE) return "docente"; if (env.CLAVE_AGRO && k === env.CLAVE_AGRO) return "agro"; return ""; };
const PER = /^\d{4}-\d{2}-\d{2}\|(utc|loc|bol)$/;   // bol = compendio de los boletines regionales
// GET ?bol=ult | AAAA-MM-DD : compendio de los boletines regionales (qc/agro_bol/…) · ?bol=lista : semanas disponibles
export async function onRequestGet({ request, env }){
  if (!quien(request, env)) return new Response("Clave incorrecta", { status: 401 });
  const bol = new URL(request.url).searchParams.get("bol");
  if (bol === "lista"){ const L = await env.DATOS.list({ prefix: "qc/agro_bol/" }); return json({ semanas: L.keys.map(k => k.name.slice(12)).filter(x => /^\d{4}-\d{2}-\d{2}$/.test(x)).sort().reverse() }); }
  if (bol){ if (bol !== "ult" && !/^\d{4}-\d{2}-\d{2}$/.test(bol)) return new Response("Semana inválida", { status: 400 });
    const t = await env.DATOS.get("qc/agro_bol/" + bol, "text"); return t ? new Response(t, { headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } }) : new Response("Sin compendio", { status: 404 }); }
  const p = new URL(request.url).searchParams.get("p") || "", D = (await env.DATOS.get(KEY, "json")) || { sacados: {}, log: [] };
  const out = {}; for (const [id, v] of Object.entries(D.sacados)) if (v.p === p) out[id] = v;
  return json({ sacados: out });
}
export async function onRequestPost({ request, env }){
  const por = quien(request, env); if (!por) return new Response("Clave incorrecta", { status: 401 });
  let b; try { b = await request.json(); } catch (e) { return new Response("JSON inválido", { status: 400 }); }
  if (!PER.test(b.p || "") || typeof b.id !== "string" || !b.id.startsWith(b.p + "|") || b.id.length > 80) return new Response("Datos inválidos", { status: 400 });
  const D = (await env.DATOS.get(KEY, "json")) || { sacados: {}, log: [] }, t = new Date().toISOString().slice(0, 19), q = String(b.quien || "").slice(0, 40);
  if (b.accion === "sacar"){
    const motivo = String(b.motivo || "").trim().slice(0, 300);
    if (motivo.length < 3 || !["tmax", "tmin", "pp6", "pp24"].includes(b.vk) || !/^\d{4,8}$/.test(b.cod || "") || !(b.dia == null || (b.dia >= 0 && b.dia <= 6))) return new Response("Datos inválidos", { status: 400 });
    D.sacados[b.id] = { p: b.p, vk: b.vk, cod: b.cod, dia: b.dia, valor: Number(b.valor) || 0, motivo, quien: q, t, por };
    D.log.push({ accion: "sacar", id: b.id, quien: q, motivo, t, por });
  } else if (b.accion === "devolver"){
    if (!D.sacados[b.id]) return new Response("No estaba sacado", { status: 404 });
    delete D.sacados[b.id]; D.log.push({ accion: "devolver", id: b.id, quien: q, t, por });
  } else return new Response("Acción inválida", { status: 400 });
  D.log = D.log.slice(-1000);
  await env.DATOS.put(KEY, JSON.stringify(D));
  const out = {}; for (const [id, v] of Object.entries(D.sacados)) if (v.p === b.p) out[id] = v;
  return json({ ok: true, sacados: out });
}
