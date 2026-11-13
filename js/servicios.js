/* Estado de los servicios (indicador «Servicios» de la barra superior) y texto del resumen de fin de turno.
   Estado: DMC (Worker de alertas, cada 5 min), pasada de control de calidad (GitHub, cada 30 min), observaciones SACLIM,
   modelos (Open-Meteo, WRF-DMC) y satélite. Los umbrales de atraso están en LIM (minutos). */
(function(){
const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;"})[c]);
const ms = t => { if (typeof t === "number") return t; if (!t) return NaN; let s = String(t).replace(" ", "T"); if (!/(Z|[+-]\d\d:?\d\d)$/.test(s)) s += "Z"; return Date.parse(s); };
const edad = t => { const m = ms(t); return isNaN(m) ? null : (Date.now() - m) / 60e3; };
const dur = m => m == null ? "—" : m < 1 ? "menos de 1 min" : m < 90 ? Math.round(m) + " min" : m < 48 * 60 ? (m / 60).toFixed(1).replace(".0", "") + " h" : Math.round(m / 1440) + " días";
const hora = t => isNaN(ms(t)) ? "—" : new Date(ms(t)).toLocaleString("es-CL", {timeZone: "America/Santiago", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false});
const LIM = {worker: [15, 30], dato: [30, 60], pasada: [50, 90], obs: [90, 180]};     // [atrasado, caído]
const nivelEdad = (m, [a, c]) => m == null ? 3 : m >= c ? 2 : m >= a ? 1 : 0;
const NOMN = {0: "Al día", 1: "Atrasado", 2: "Sin respuesta", 3: "Sin información"};
const COLN = {0: "var(--ok)", 1: "var(--sos)", 2: "var(--err)", 3: "var(--sin)"};

/** R = respuesta de /api/qc → lista de servicios [{nombre, nivel (0 al día, 1 atrasado, 2 sin respuesta, 3 sin información), detalle}] */
function estado(R){
  const L = [], w = R.servicios_worker, f = R.servicios;
  if (w){
    const m = edad(w.t);
    if (m != null && m >= LIM.worker[1]) L.push({nombre: "DMC · red de estaciones (Worker)", nivel: 2, detalle: `El Worker no corre hace ${dur(m)} (último ciclo ${hora(w.t)}). Revisar Cloudflare → Workers → metotec-alertas.`});
    else if (!w.dmc_ok) L.push({nombre: "DMC · red de estaciones (Worker)", nivel: 2, detalle: `La DMC no respondió en el último ciclo (${hora(w.t)}); último dato recibido ${hora(w.dmc_ultimo_ok)}. ${(w.error || []).join(" · ")}`});
    else L.push({nombre: "DMC · red de estaciones (Worker)", nivel: nivelEdad(m, LIM.worker), detalle: `Último ciclo hace ${dur(m)} · ${w.estaciones ?? "?"} estaciones.`});
    const d = edad(w.datos_hasta);
    L.push({nombre: "Datos EMA más recientes", nivel: nivelEdad(d, LIM.dato), detalle: `Último dato de las estaciones: ${hora(w.datos_hasta)} (hace ${dur(d)}).`});
  } else {
    L.push({nombre: "DMC · red de estaciones (Worker)", nivel: 3, detalle: "El Worker no ha dejado su estado. Revisar en GitHub → Actions que «Publicar Worker de alertas» terminó bien (necesita el plan Workers Paid y un token con «Workers Scripts: Edit») y en Cloudflare → Workers → metotec-alertas → Logs."});
    const d = edad(R.datos_hasta);
    L.push({nombre: "Datos EMA más recientes", nivel: nivelEdad(d, LIM.dato), detalle: `Último dato en la pasada de control: ${hora(R.datos_hasta)} (hace ${dur(d)}).`});
  }
  const p = edad(R.generado);
  L.push({nombre: "Pasada de control de calidad", nivel: nivelEdad(p, LIM.pasada), detalle: `Última pasada ${hora(R.generado)} (hace ${dur(p)}); se repite cada 30 min.`});
  const o = edad((R.observaciones || {}).generado);
  L.push({nombre: "Observaciones (SACLIM)", nivel: nivelEdad(o, LIM.obs), detalle: `Última revisión ${hora((R.observaciones || {}).generado)} (hace ${dur(o)}).`});
  [["modelo", "Modelo Open-Meteo"], ["wrf", "Modelo WRF-DMC"], ["satelite", "Satélite GOES-19"]].forEach(([k, n]) => {
    if (!f) L.push({nombre: n, nivel: 3, detalle: "Se informa desde la próxima pasada de control."});
    else if (f[k] && k === "modelo" && (f.motivos || {}).modelo_parcial) L.push({nombre: n, nivel: 1, detalle: "Respondió solo en parte: " + f.motivos.modelo_parcial + ". Se usó lo recibido y se reintenta en la pasada siguiente."});
    else if (f[k]) L.push({nombre: n, nivel: 0, detalle: "Disponible en la última pasada."});
    else L.push({nombre: n, nivel: 1, detalle: "No respondió en la última pasada: esas pruebas quedaron sin revisar." + ((f.motivos || {})[k] ? " Motivo: " + f.motivos[k] + "." : "") + " Se reintenta en la pasada siguiente."});
  });
  return L;
}

function pintar(R){
  const b = document.getElementById("svc"), p = document.getElementById("svcP"); if (!b || !p || !R) return;
  const L = estado(R), peor = Math.max(0, ...L.filter(x => x.nivel < 3).map(x => x.nivel));
  b.style.setProperty("--c", COLN[peor]);
  b.title = peor === 0 ? "Todos los servicios al día" : peor === 1 ? "Algún servicio va atrasado" : "Algún servicio no responde";
  b.querySelector("span").textContent = peor === 0 ? "Servicios" : peor === 1 ? "Servicios · atraso" : "Servicios · falla";
  p.innerHTML = `<h4>Estado de los servicios</h4>` + L.map(x => `<div class="svr"><i style="background:${COLN[x.nivel]}"></i><div><b>${esc(x.nombre)}</b> <small>${NOMN[x.nivel]}</small><br><small>${esc(x.detalle)}</small></div></div>`).join("");
}
function iniciar(getR){
  const b = document.getElementById("svc"), p = document.getElementById("svcP"); if (!b || !p) return;
  b.addEventListener("click", e => { e.stopPropagation(); p.hidden = !p.hidden; });
  document.addEventListener("click", e => { if (!p.hidden && !p.contains(e.target)) p.hidden = true; });
  setInterval(() => { const r = getR(); if (r && !p.hidden) pintar(r); }, 30e3);      // las edades se refrescan solas con el panel abierto
}

/** Texto del resumen de fin de turno. act = fallas activas, sin = estaciones sin datos, E = estaciones. */
function turno(R, horas, {act, sin, E}){
  const t1 = Date.now(), t0 = t1 - horas * 3600e3, dentro = t => { const m = ms(t); return m >= t0 && m <= t1; };
  const inf = Object.values(R.informados || {}), nombre = r => `${r.nombre} (${r.codigo})`;
  const nuevas = inf.filter(r => dentro(r.t)), cerradas = inf.filter(r => r.fin && dentro(r.fin));
  const M = Object.values(R.marcas || {}).filter(m => dentro(m.t));
  const cuenta = v => M.filter(m => m.v === v).length;
  const quien = {}; M.forEach(m => { const q = m.quien || "sin nombre"; quien[q] = (quien[q] || 0) + 1; });
  const sinInf = act.filter(p => !p.informado);
  const lin = (L, f) => L.length ? L.map(x => "  · " + f(x)).join("\n") : "  (ninguna)";
  return [
    `RESUMEN DE TURNO · últimas ${horas} h (${hora(t0)} a ${hora(t1)}, hora local)`,
    `- Fallas informadas: ${nuevas.length} · resueltas: ${cerradas.length} · activas ahora: ${act.length} (${sinInf.length} sin informar) · estaciones sin datos: ${sin.length}`,
    `- Avisos revisados a mano: ${cuenta("resuelto")} resueltos, ${cuenta("falsa")} falsas alarmas, ${cuenta("real")} confirmados` + (M.length ? ` (${Object.entries(quien).map(([q, n]) => q + " " + n).join(", ")})` : ""),
    ``,
    `INFORMADAS EN EL TURNO`, lin(nuevas, r => `${nombre(r)}: ${FALLAS.sensor(r)}, desde ${hora(r.inicio)}`),
    `RESUELTAS EN EL TURNO`, lin(cerradas, r => `${nombre(r)}: ${FALLAS.sensor(r)}, hasta ${hora(r.fin)}`),
    `PASAN AL SIGUIENTE TURNO`,
    lin(act, p => `${p.nombre} (${p.codigo}): ${FALLAS.sensor(p)}, ${FALLAS.que(p)}, desde ${hora(p.inicio)}${p.informado ? " [informada]" : " [SIN INFORMAR]"}`),
    `  Sin datos: ${sin.length ? sin.map(e => e.nombre).join(", ") : "ninguna"}`
  ].join("\n");
}
window.SERV = {estado, pintar, iniciar, turno};
})();
