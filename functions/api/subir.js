// POST /api/subir (cuerpo: el archivo .xlsx de la «Extracción de datos» de SACLIM) → {clave}
// Lo deja en el KV por 2 días para que la revisión de período (GitHub) lo lea.
import { json } from "./_kv.js";
export async function onRequestPost({ request, env }){
  if (!env.CLAVE_DOCENTE || request.headers.get("x-clave") !== env.CLAVE_DOCENTE) return new Response("Clave incorrecta", { status: 401 });
  const b = await request.arrayBuffer();
  if (b.byteLength < 100) return new Response("Archivo vacío", { status: 400 });
  if (b.byteLength > 24 * 1024 * 1024) return new Response("El archivo pasa de 24 MB: divida la extracción en períodos más cortos", { status: 413 });
  const clave = "qc/subida/" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  await env.DATOS.put(clave, b, { expirationTtl: 60 * 60 * 48 });
  return json({ ok: true, clave, bytes: b.byteLength });
}
