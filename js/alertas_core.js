/* «Mis alertas»: evaluación de las reglas de cada persona. Módulo único, sin DOM:
   lo usan la página (js/equipo.js, con import dinámico) y el Worker de cron (worker/src/index.js).

   Regla: {id, nombre, fuente: "ema"|"obs", donde: "mias"|"todas"|"norte"|"centro"|"sur"|"austral"|"cods", cods: [..],
           var, op: ">"|">="|"<"|"<="|"="|"en"|"sin"|"hay", valor, activa}
   · op "hay" (var "fen"): fenómenos de tiempo presente por ww o METAR: chubasco, nieve, tormenta, granizo, engelante, ventisca, lluvia, llovizna, niebla, neblina, calima, polvo, o siglas (SH, SHSN, TS…)
   · op "en": lista y rangos de códigos, ej. "07-09,30-35" (tormentas de polvo/arena con ww).
   · op "sin": sin dato (EMA con nivel 3; observación sin mensaje en las últimas 2 h).
   ema = {estaciones: [{codigo, nombre, lat, nivel, hora, valores: {T, Td, HR, P_mar, ff10, dd10, rr1h}}], datos_hasta}
   obs = {estaciones: [{codigo, nombre, lat, ultima, ult: [{h, Ts, Td, HR, ff, dd, VV, ww, RRR6, QFE}]}]} */

export const ZONAS = {todas: [-90, 0], norte: [-27.5, 0], centro: [-38, -27.5], sur: [-46, -38], austral: [-90, -46]};
export const VARS_EMA = {T: "Ts", Td: "Td", HR: "HR", P_mar: "QFF", ff10: "viento (kt)", dd10: "dirección", rr1h: "lluvia 1 h (mm)"};
export const VARS_OBS = {Ts: "Ts", Td: "Td", HR: "HR", ff: "viento (kt)", VV: "visibilidad (m)", ww: "ww", RRR6: "RRR6 (mm)", QFE: "QFE", fen: "fenómeno (ww o METAR)"};

// Fenómenos de tiempo presente: cada uno se reconoce por el ww del SYNOP o por el METAR (descriptores y fenómenos), sin importar cuál de los dos lo informe.
// op "hay": valor = nombres separados por coma (chubasco, nieve…) o siglas METAR (SH, SHSN, TS…).
const R_ = (a, b) => Array.from({length: b - a + 1}, (_, i) => a + i);
export const FENOMENOS = {
  chubasco: {n: "Chubascos", ww: [25, ...R_(80, 90)], m: /(^|\s)(?!VC|RE)[-+]?\w*SH/},
  nieve: {n: "Nieve", ww: [...R_(70, 79), 83, 84, 85, 86, 22, 23], m: /(^|\s)(?!VC|RE)[-+]?(?!BL|DR)\w*(SN|SG)/},
  tormenta: {n: "Tormenta", ww: [17, ...R_(91, 99)], m: /(^|\s)(?!VC|RE)[-+]?TS/},
  granizo: {n: "Granizo", ww: [27, 87, 88, 89, 90, 93, 94, 95, 96], m: /(^|\s)(?!VC|RE)[-+]?\w*(GR|GS)/},
  engelante: {n: "Engelante", ww: [24, 56, 57, 66, 67], m: /(^|\s)(?!VC|RE)[-+]?FZ/},
  ventisca: {n: "Ventisca", ww: R_(36, 39), m: /(^|\s)(?!VC|RE)(BL|DR)/},
  lluvia: {n: "Lluvia", ww: R_(60, 69), m: /(^|\s)(?!VC|RE)[-+]?\w*RA/},
  llovizna: {n: "Llovizna", ww: R_(50, 59), m: /(^|\s)(?!VC|RE)[-+]?\w*DZ/},
  niebla: {n: "Niebla", ww: R_(40, 49), m: /(^|\s)(?!VC|RE)\w*FG/},
  neblina: {n: "Neblina", ww: [10], m: /(^|\s)BR/},
  calima: {n: "Calima", ww: [5], m: /(^|\s)HZ/},
  polvo: {n: "Polvo o arena", ww: [...R_(6, 9), ...R_(30, 35)], m: /(^|\s)\w*(DU|SA|DS|SS)/}
};
/** Fenómenos de la lista pedida que informa la observación u (ww del SYNOP y/o texto METAR u.fm): [nombre…]. Nombres de FENOMENOS o siglas METAR. */
export function fenomenos(u, valor){
  const ids = String(valor ?? "").toLowerCase().split(",").map(t => t.trim()).filter(Boolean), fm = String(u.fm || "").toUpperCase(), out = [];
  ids.forEach(t => {
    const F = FENOMENOS[t];
    if (F){ if ((u.ww != null && F.ww.includes(u.ww)) || F.m.test(fm)) out.push(F.n); }
    else if (fm.split(/\s+/).some(g => g.replace(/^[-+]/, "").includes(t.toUpperCase().replace(/^[-+]/, "")) && !/^(VC|RE)/.test(g.replace(/^[-+]/, "")))) out.push(t.toUpperCase());
  });
  return out;
}

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
        if (r.var === "fen" || r.op === "hay"){         // fenómeno: cualquier observación de las últimas 3 h (también SPECI)
          const rec = (e.ult || []).filter(o => { const t = aMs(o.h); return !isNaN(t) && t0 - t <= 3 * 3600e3; }), hit = rec.filter(o => fenomenos(o, r.valor).length).slice(-1)[0];
          if (!hit) return;
          x = fenomenos(hit, r.valor).join(", ") + (hit.ww != null ? ` · ww ${hit.ww}` : "") + (hit.fm ? ` · METAR ${hit.fm}` : ""); h = hit.h; ok = true;
          const hora = String(h).slice(0, 16).replace(" ", "T");
          out.push({id: `${r.id}|${e.codigo}|${hora}`, r, codigo: e.codigo, nombre: e.nombre, x, hora,
                    texto: `${r.nombre || "Fenómeno"} · ${e.nombre} (${e.codigo}) · ${x} · ${hora.replace("T", " ")} UTC`});
          return;
        }
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
