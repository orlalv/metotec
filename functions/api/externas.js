// Estaciones externas (INIA, CEAZA, SERVIMET…) de agrometeorologia.cl, dejadas en el KV por qc/externas.py (cada hora).
// GET ?v=cat → catálogo; ?v=PP|TA|HR|VV|RD|PS|TS00|TS10 → valores por hora (UTC) de esa variable. Con x-clave.
import { json } from "./_kv.js";
const VARS = ["cat", "PP", "TA", "HR", "VV", "RD", "PS", "TS00", "TS10"];
export async function onRequestGet({ request, env }){
  if (!env.CLAVE_DOCENTE || request.headers.get("x-clave") !== env.CLAVE_DOCENTE) return new Response("Clave incorrecta", { status: 401 });
  const v = new URL(request.url).searchParams.get("v") || "cat";
  if (!VARS.includes(v)) return new Response("Variable inválida", { status: 400 });
  const r = await env.DATOS.get(`qc/externas/${v}`, "text");
  return r ? new Response(r, { headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "private, max-age=300" } }) : json({ error: "sin datos todavía" }, { status: 404 });
}
