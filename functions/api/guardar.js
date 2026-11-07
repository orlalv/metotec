// POST /api/guardar: guarda un resultado en el KV "DATOS".
import { json } from "./_kv.js";
const PRUEBAS = ["diagnostico", "simulador", "obs12_sd", "obs_diaria"];
export async function onRequestPost({ request, env }){
  const texto = await request.text();
  if (texto.length > 200000) return new Response("Demasiado grande", { status: 413 });
  let d;
  try { d = JSON.parse(texto); } catch (e) { return new Response("JSON inválido", { status: 400 }); }
  if (!PRUEBAS.includes(d.prueba) || typeof d.nombre !== "string" || !d.nombre.trim()) return new Response("Faltan datos", { status: 400 });
  d.nombre = d.nombre.trim().slice(0, 120);
  d.recibido = new Date().toISOString();
  const key = `${d.prueba}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  await env.DATOS.put(key, JSON.stringify(d));
  return json({ ok: true, key });
}
export const onRequest = () => new Response("Método no permitido", { status: 405 });
