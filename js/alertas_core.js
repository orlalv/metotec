/* «Mis alertas»: evaluación de las reglas de cada persona. Módulo único, sin DOM:
   lo usan la página (js/equipo.js, con import dinámico) y el Worker de cron (worker/src/index.js).

   Regla: {id, nombre, fuente: "ema"|"obs", donde: "mias"|"todas"|"norte"|"centro"|"sur"|"austral"|"cods", cods: [..],
           var, op: ">"|">="|"<"|"<="|"="|"en"|"sin", valor, activa}
   · op "en": lista y rangos de códigos, ej. "07-09,30-35" (tormentas de polvo/arena con ww).
   · op "sin": sin dato (EMA con nivel 3; observación sin mensaje en las últimas 2 h).
   ema = {estaciones: [{codigo, nombre, lat, nivel, hora, valores: {T, Td, HR, P_mar, ff10, dd10, rr1h}}], datos_hasta}
   obs = {estaciones: [{codigo, nombre, lat, ultima, ult: [{h, Ts, Td, HR, ff, dd, VV, ww, RRR6, QFE}]}]} */

export const ZONAS = {todas: [-90, 0], norte: [-27.5, 0], centro: [-38, -27.5], sur: [-46, -38], austral: [-90, -46]};
export const VARS_EMA = {T: "Ts", Td: "Td", HR: "HR", P_mar: "QFF", ff10: "viento (kt)", dd10: "dirección", rr1h: "lluvia 1 h (mm)"};
export const VARS_OBS = {Ts: "Ts", Td: "Td", HR: "HR", ff: "viento (kt)", VV: "visibilidad (m)", ww: "ww", RRR6: "RRR6 (mm)", QFE: "QFE"};

export const rangos = t => String(t ?? "").replace(/\s/g, "").split(",").filter(Boolean)
  .map(p => { const [a, b] = p.split("-"); return [parseFloat(a), parseFloat(b ?? a)]; })
  .filter(x => !isNaN(x[0]) && !isNaN(x[1]));

export function cumple(x, op, v){
  if (x == null || typeof x === "string") return false;
  if (op === "en") return rangos(v).some(([a, b]) => x >= a && x <= b);
  const y = String(v ?? "").trim() === "" ? NaN : Number(v); if (isNaN(y)) return false;     // "5-15" o vacío no son un número
  return {">": x > y, ">=": x >= y, "<": x < y, "<=": x <= y, "=": x === y}[op] || false;
}

export function donde(r, e, mias){
  const d = r.donde || "todas";
  if (d === "mias") return mias.has(e.codigo);
  if (d === "cods") return (r.cods || []).includes(e.codigo);
  const [lo, hi] = ZONAS[d] || ZONAS.todas;
  return e.lat != null && e.lat >= lo && e.lat < hi;
}

const aMs = u => { if (!u) return NaN; const t = Date.parse(String(u).slice(0, 19).replace(" ", "T") + "Z"); return t; };

/** Alertas que se cumplen ahora para una persona: [{id, r, codigo, nombre, x, hora, texto}] (hora: "AAAA-MM-DDTHH:MM"). */
export function evaluar(persona, ema, obs, ahora = Date.now()){
  const t0 = ahora instanceof Date ? ahora.getTime() : ahora;
  const mias = new Set(persona.estaciones || []), out = [];
  (persona.alertas || []).filter(r => r.activa !== false).forEach(r => {
    const esObs = r.fuente === "obs";
    const L = esObs ? (obs || {}).estaciones || [] : (ema || {}).estaciones || [];
    L.forEach(e => {
      if (!donde(r, e, mias)) return;
      let ok, x = null, h;
      if (!esObs){
        if (r.op === "sin"){ ok = e.nivel === 3; h = (ema || {}).datos_hasta; }
        else { x = (e.valores || {})[r.var]; h = e.hora || (ema || {}).datos_hasta; ok = cumple(x, r.op, r.valor); }
      } else {
        const u = (e.ult || []).slice(-1)[0] || {};
        if (r.op === "sin"){ const t = aMs(e.ultima); ok = isNaN(t) || t0 - t > 2 * 3600e3; h = e.ultima; }
        else { x = u[r.var]; h = u.h; ok = cumple(x, r.op, r.valor); }
      }
      if (!ok) return;
      const hora = String(h ?? "").slice(0, 16).replace(" ", "T");
      const nv = (esObs ? VARS_OBS : VARS_EMA)[r.var] || r.var;
      const cond = r.op === "sin" ? "sin dato" : `${nv} = ${x} (${r.op} ${r.valor})`;
      out.push({id: `${r.id}|${e.codigo}`, r, codigo: e.codigo, nombre: e.nombre, x, hora,
                texto: `${r.nombre || "Alerta"} · ${e.nombre} (${e.codigo}) · ${cond} · ${hora.replace("T", " ")} UTC`});
    });
  });
  return out;
}
