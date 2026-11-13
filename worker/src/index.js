// Worker de «Mis alertas»: cada 5 minutos lee la red EMA de la DMC, evalúa las reglas de cada persona (qc/equipo)
// y avisa por Telegram / correo (Resend) solo lo que aparece. Estado en el KV «DATOS» (qc/avisos_enviados).
// Escribe también qc/ema_rapido (último dato de cada estación) que la página usa para su contador de alertas.
// Secretos: DMC_USUARIO, DMC_TOKEN, TELEGRAM_TOKEN, RESEND_API_KEY, RESEND_FROM (los sube .github/workflows/worker.yml).
import { descargar, resumir } from "./dmc.js";
import { planificar, mensaje } from "./avisos.js";

async function telegram(env, chat, txt){
  if (!(env.TELEGRAM_TOKEN && chat)) return null;      // null = canal sin configurar (no es un fallo)
  const r = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_TOKEN}/sendMessage`, {method: "POST", headers: {"content-type": "application/json"}, body: JSON.stringify({chat_id: chat, text: txt})});
  return r.ok;
}
async function correo(env, dest, txt){
  if (!(env.RESEND_API_KEY && env.RESEND_FROM && dest)) return null;
  const r = await fetch("https://api.resend.com/emails", {method: "POST", headers: {Authorization: `Bearer ${env.RESEND_API_KEY}`, "content-type": "application/json"},
    body: JSON.stringify({from: env.RESEND_FROM, to: [dest], subject: "METOTEC · Mis alertas", text: txt})});
  return r.ok;
}

export async function correr(env, ahora = Date.now()){
  const res = {inicio: new Date(ahora).toISOString().slice(0, 19) + "Z", errores: []};
  const [equipo, obs, previo] = await Promise.all(["qc/equipo", "qc/sensorial", "qc/avisos_enviados"].map(k => env.DATOS.get(k, "json")));
  let ema = null;
  try { ema = resumir(await descargar(env), ahora); res.estaciones = ema.estaciones.length; res.datos_hasta = ema.datos_hasta; }
  catch (e) { res.errores.push("EMA: " + e.message); }
  if (ema) await env.DATOS.put("qc/ema_rapido", JSON.stringify(ema));

  const plan = planificar(equipo, ema, obs, previo, {ahora, sinEma: !ema, sinObs: !obs});
  res.activas = plan.activas; res.envios = 0;
  for (const {persona: p, nuevos} of plan.avisar){
    const txt = mensaje(nuevos), R = [];
    try { R.push(p.telegram ? await telegram(env, p.telegram, txt) : null); } catch (e) { R.push(false); res.errores.push("Telegram: " + e.message); }
    try { R.push(p.correo ? await correo(env, p.correo, txt) : null); } catch (e) { R.push(false); res.errores.push("Correo: " + e.message); }
    res.envios += R.filter(x => x === true).length;
    // si todos los intentos fallaron, no se da por avisado: se reintenta en la pasada siguiente
    if (R.includes(false) && !R.includes(true)){ const ids = new Set(nuevos.map(h => h.id)); plan.estado[p.nombre] = plan.estado[p.nombre].filter(id => !ids.has(id)); }
  }
  const nuevoEstado = JSON.stringify(plan.estado);
  if (nuevoEstado !== JSON.stringify(previo || {})) await env.DATOS.put("qc/avisos_enviados", nuevoEstado);
  // estado del servicio de la DMC y del propio Worker (lo muestra el indicador «Servicios» de la página)
  try {
    const ant = await env.DATOS.get("qc/servicios_worker", "json");
    const ok = !!ema, desde = ok ? res.inicio : (ant && ant.dmc_ultimo_ok) || null;
    await env.DATOS.put("qc/servicios_worker", JSON.stringify({t: res.inicio, dmc_ok: ok, dmc_ultimo_ok: desde, error: res.errores.slice(0, 3), estaciones: res.estaciones ?? null, datos_hasta: res.datos_hasta ?? null, envios: res.envios}));
  } catch (e) { res.errores.push("estado: " + e.message); }
  return res;
}

export default {
  async scheduled(event, env, ctx){
    ctx.waitUntil(correr(env, event.scheduledTime).then(r => console.log(JSON.stringify(r))).catch(e => console.error("alertas: " + e.stack)));
  }
};
