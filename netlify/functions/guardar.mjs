// Guarda un resultado (POST /api/guardar) en Netlify Blobs, almacén "resultados".
import { getStore } from "@netlify/blobs";

const PRUEBAS = ["diagnostico", "simulador", "obs12_sd", "obs_diaria"];

export default async (req) => {
  if (req.method !== "POST") return new Response("Método no permitido", { status: 405 });
  const texto = await req.text();
  if (texto.length > 200000) return new Response("Demasiado grande", { status: 413 });
  let d;
  try { d = JSON.parse(texto); } catch (e) { return new Response("JSON inválido", { status: 400 }); }
  if (!PRUEBAS.includes(d.prueba) || typeof d.nombre !== "string" || !d.nombre.trim())
    return new Response("Faltan datos", { status: 400 });
  d.nombre = d.nombre.trim().slice(0, 120);
  d.recibido = new Date().toISOString();
  const key = `${d.prueba}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  await getStore("resultados").setJSON(key, d);
  return Response.json({ ok: true, key });
};

export const config = { path: "/api/guardar" };
