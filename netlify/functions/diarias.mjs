// Planilla común de la observación diaria (GET /api/diarias): devuelve solo los datos de cada observación registrada.
import { getStore } from "@netlify/blobs";

export default async (req) => {
  if (req.method !== "GET") return new Response("Método no permitido", { status: 405 });
  const store = getStore("resultados");
  const { blobs } = await store.list({ prefix: "obs_diaria/" });
  const datos = await Promise.all(blobs.map(b => store.get(b.key, { type: "json" })));
  const recs = datos.filter(d => d && d.rec && d.rec.mom).map(d => ({ ...d.rec, alumno: d.nombre, curso: d.curso || "", origen: d.origen || "", reg: d.recibido }));
  recs.sort((a, b) => a.mom < b.mom ? -1 : a.mom > b.mom ? 1 : (a.reg || "").localeCompare(b.reg || ""));
  return Response.json(recs, { headers: { "Cache-Control": "no-store" } });
};

export const config = { path: "/api/diarias" };
