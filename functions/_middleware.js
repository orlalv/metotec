// vigia.metotec.cl: la raíz abre el control de calidad (el resto del sitio se sirve igual).
export async function onRequest({ request, next, env }){
  const u = new URL(request.url);
  if (u.hostname.startsWith("vigia.") && (u.pathname === "/" || u.pathname === "")){
    return env.ASSETS.fetch(new Request(new URL("/qc", u), request));
  }
  return next();
}
