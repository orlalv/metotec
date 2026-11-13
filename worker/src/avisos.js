// «Mis alertas»: qué avisar ahora. Lógica pura (sin red ni KV) para poder probarla.
import { evaluar } from "../../js/alertas_core.js";

/** previo = {nombre: [ids]} (lo que ya estaba activo en la pasada anterior).
    sinEma / sinObs: la fuente no se pudo leer ahora; sus alertas no se dan por terminadas (se conservan en el estado).
    Devuelve {estado: {nombre: [ids]}, avisar: [{persona, nuevos: [alerta]}], activas}. Avisa solo lo que aparece, no a ausentes
    ni a quien no tiene Telegram ni correo. */
export function planificar(equipo, ema, obs, previo, {ahora = Date.now(), sinEma = false, sinObs = false} = {}){
  const estado = {}, avisar = []; let activas = 0;
  for (const p of (equipo || {}).personas || []){
    const H = evaluar(p, sinEma ? {estaciones: []} : ema, sinObs ? {estaciones: []} : obs, ahora);
    activas += H.length;
    const ant = new Set((previo || {})[p.nombre] || []);
    const fuente = {}; (p.alertas || []).forEach(r => fuente[r.id] = r.fuente === "obs" ? "obs" : "ema");
    const retenidas = [...ant].filter(id => (sinEma && fuente[id.split("|")[0]] === "ema") || (sinObs && fuente[id.split("|")[0]] === "obs"));
    estado[p.nombre] = [...new Set([...H.map(h => h.id), ...retenidas])].sort();
    const nuevos = H.filter(h => !ant.has(h.id));
    if (nuevos.length && !p.ausente && (p.telegram || p.correo)) avisar.push({persona: p, nuevos});
  }
  return {estado, avisar, activas};
}

export const mensaje = nuevos => (nuevos.slice(0, 30).map(h => h.texto).join("\n") + (nuevos.length > 30 ? "\n…" : "")).slice(0, 3900);
