// Lista o borra resultados (solo docente). Requiere la cabecera x-clave = variable de entorno CLAVE_DOCENTE.
import { getStore } from "@netlify/blobs";

export default async (req) => {
  const clave = process.env.CLAVE_DOCENTE;
  if (!clave) return new Response("Falta configurar CLAVE_DOCENTE en Netlify", { status: 500 });
  if (req.headers.get("x-clave") !== clave) return new Response("Clave incorrecta", { status: 401 });
  const store = getStore("resultados");
  const url = new URL(req.url);
  if (req.method === "DELETE"){
    const key = url.searchParams.get("key");
    if (!key) return new Response("Falta key", { status: 400 });
    await store.delete(key);
    return Response.json({ ok: true });
  }
  const prefix = url.searchParams.get("prueba") || undefined;
  const { blobs } = await store.list(prefix ? { prefix: prefix + "/" } : {});
  const datos = await Promise.all(blobs.map(async b => ({ key: b.key, ...(await store.get(b.key, { type: "json" })) })));
  datos.sort((a, b) => (b.recibido || "").localeCompare(a.recibido || ""));
  return Response.json(datos);
};

export const config = { path: "/api/resultados" };
