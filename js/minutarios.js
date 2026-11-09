/* Datos minutarios de un día para cualquier estación automática: extremas con su hora, precipitación por 6 horas,
   comparación con lo que la propia estación informa (Tn12, Tx12, RRR6, RRR24, QNH, QFF) e inconsistencias de la serie.
   Fuente: archivo propio de METOTEC (rama «datos», una hoja por hora con todas las estaciones), que guarda el servicio
   de la DMC cada 30 minutos desde el 8 de noviembre de 2026. */
(function(){
const RAW = "https://raw.githubusercontent.com/orlalv/metotec/datos/";
const VARS = [["T", "Ts (temp. seca)", "°C"], ["Td", "Td (punto de rocío)", "°C"], ["HR", "Humedad", "%"], ["P_est", "QFE", "hPa"], ["P_mar", "QFF", "hPa"],
  ["P_std", "QNH", "hPa"], ["dd10", "Dir. 10 min", "°"], ["ff10", "Viento 10 min", "kt"], ["fx10", "Racha", "kt"], ["rr1m", "Agua caída", "mm"],
  ["rr6", "RRR6 informada", "mm"], ["rr24", "RRR24 informada", "mm"], ["Tn12", "Tmín 12 h informada", "°C"], ["Tx12", "Tmáx 12 h informada", "°C"], ["Rad", "Radiación", "W/m²"]];
const NOM = Object.fromEntries(VARS.map(v => [v[0], v[1]])), UNI = Object.fromEntries(VARS.map(v => [v[0], v[2]]));
const CACHE = new Map();
let EST = [], M = null, mVar = "T";
const $ = s => document.querySelector(s), esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;"}[c]));
const hhmm = t => new Date(t).toISOString().slice(11, 16), f1 = v => v == null ? "—" : (Math.round(v * 10) / 10).toFixed(1);
const loc = t => new Date(t).toLocaleTimeString("es-CL", {timeZone: "America/Santiago", hour: "2-digit", minute: "2-digit"});

async function hora(t){
  const k = new Date(t).toISOString().slice(0, 13);
  if (CACHE.has(k)) return CACHE.get(k);
  const url = RAW + "ema/" + k.replace(/-/g, "/").replace("T", "/") + ".csv.gz";
  const p = (async () => {
    for (let i = 0; i < 3; i++){                       // hasta 3 intentos: GitHub a veces corta descargas seguidas
      try { const r = await fetch(url + (i ? "?r=" + i : ""));
        if (r.status === 404) return null;
        if (r.ok) return await new Response(r.body.pipeThrough(new DecompressionStream("gzip"))).text(); } catch (e) {}
      await new Promise(z => setTimeout(z, 800 * (i + 1)));
    }
    throw new Error("sin conexión");
  })();
  CACHE.set(k, p); p.catch(() => CACHE.delete(k));      // lo que falla no queda guardado: se reintenta al volver a generar
  return p.catch(() => null);
}
async function estaciones(){
  if (EST.length) return EST;
  for (const url of ["/api/minutarios?estaciones=1", RAW + "estaciones.json"]){
    try { const r = await fetch(url); const j = await r.json(); EST = (Array.isArray(j) ? j : j.estaciones || []).sort((a, b) => a.codigo.localeCompare(b.codigo)); if (EST.length) break; } catch (e) {}
  }
  return EST;
}
const sinTilde = x => String(x || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
function buscarCod(q){                 // acepta «330006 · nombre», el código solo o parte del nombre (sin importar tildes)
  q = String(q || "").trim();
  if (!q) return SUB.size ? [...SUB.keys()][0] : null;               // sin texto: la estación de los archivos subidos
  const m = q.match(/^(\d+)/);
  if (m){ if (SUB.has(m[1])) return m[1];
    const e = EST.find(x => x.codigo === m[1]) || EST.find(x => x.codigo.startsWith(m[1])); return e ? e.codigo : (EST.length ? null : m[1]); }
  const t = sinTilde(q), e = EST.find(x => sinTilde(x.nombre).startsWith(t)) || EST.find(x => sinTilde(x.nombre).includes(t)) || EST.find(x => (x.oaci || "").toLowerCase() === t);
  return e ? e.codigo : null;
}
function offsetChile(t){            // horas de diferencia de Chile continental con UTC en esa fecha (3 o 4)
  const s = new Date(t).toLocaleString("en-US", {timeZone: "America/Santiago", hour12: false, hour: "2-digit"});
  return ((new Date(t).getUTCHours() - +s) % 24 + 24) % 24;
}

async function cargar(cod, dia, local){
  const [y, m, d] = dia.split("-").map(Number);
  let ini = Date.UTC(y, m - 1, d);
  if (local) ini += offsetChile(ini + 12 * 3600e3) * 3600e3;
  const fin = ini + 864e5, d0 = Date.UTC(y, m - 1, d), filas = [];
  const a = Math.min(ini, d0), b = Math.max(fin, d0 + 864e5);           // siempre se lee también el día UTC completo (extremas sinópticas)
  const horas = []; for (let t = a; t <= b; t += 3600e3) horas.push(t);
  let sinArchivo = 0;
  const leer = (c0, lineas) => lineas.forEach(l => { const v = l.split(","), o = {t: Date.parse(v[1].replace(" ", "T") + "Z")};
    c0.forEach((c, j) => { if (j > 1) o[c] = v[j] === "" ? null : +v[j]; }); filas.push(o); });
  const sub = subidos(cod, a, b);                   // 1) archivos de la DMC que subió el usuario
  let api = null, origen = "archivo METOTEC", errApi = "";
  if (sub.length){ filas.push(...sub); origen = "archivos subidos"; }
  else try {                                        // 2) el servidor de METOTEC: una sola descarga const iso = t => new Date(t).toISOString().slice(0, 13);
    const ac = new AbortController(), to = setTimeout(() => ac.abort(), 20000);          // si el servidor tarda, se usa el respaldo
    const r = await fetch(`/api/minutarios?cod=${cod}&desde=${iso(a)}&hasta=${iso(b)}`, {signal: ac.signal, cache: "no-store"});
    if (r.ok) api = await r.json(); else errApi = "el servidor respondió " + r.status; clearTimeout(to); } catch (e) { errApi = e.name === "AbortError" ? "el servidor tardó más de 20 s" : e.message; }
  if (sub.length){}
  else if (api && api.cab){
    leer(api.cab.split(","), api.filas);
    sinArchivo = api.faltan.filter(k => Date.parse(k + ":00:00Z") < Date.now() - 3600e3).length;
  } else {                                          // si no responde, directo desde GitHub hora por hora
    const txt = await Promise.all(horas.map(t => t <= Date.now() ? hora(t) : null));
    txt.forEach((tx, i) => {
      if (!tx){ if (horas[i] < Date.now() - 3600e3) sinArchivo++; return; }
      const ls = tx.split("\n"); leer(ls[0].split(","), ls.slice(1).filter(l => l.startsWith(cod + ",")));
    });
  }
  const vistos = new Set(), T = filas.filter(o => !vistos.has(o.t) && vistos.add(o.t)).sort((p, q) => p.t - q.t);
  marcarPicos(T);
  return {cod, dia, local, ini, fin, F: T.filter(o => o.t > ini && o.t <= fin), T, sinArchivo: sub.length ? 0 : sinArchivo, horas: horas.length, origen: api || sub.length ? origen : "GitHub directo (respaldo)", errApi};
}

/* --------- archivos de la DMC subidos por el usuario (portal: datos históricos EMA, ZIP o CSV mensual por variable) --------- */
const SUB = new Map();                   // código → Map(t → fila)
const MAPA = {ts: "T", td: "Td", tMin12Horas: "Tn12", tMax12Horas: "Tx12", hr: "HR", qfe1: "P_est", qff: "P_mar", qnh: "P_std",
  dd10Minutos: "dd10", ff10Minutos: "ff10", ff10MinutosMax: "fx10", dd02Minutos: "dd2", ff02Minutos: "ff2",
  rrInst: "rr1m", rr6Horas: "rr6", rr24Horas: "rr24", radiacionGlobalInst: "Rad",
  Ts: "T", Td: "Td", HR: "HR", QFE: "P_est", QFF: "P_mar", dd: "dd10", ff: "ff10"};          // también los anuales horarios (Instante)
const ARCH = [];
function subidos(cod, a, b){
  const m = SUB.get(String(cod)); if (!m) return [];
  return [...m.values()].filter(o => o.t >= a && o.t <= b);
}
function leerCSV(nombre, tx){
  const ls = tx.replace(/\r/g, "").split("\n").filter(Boolean); if (ls.length < 2) return null;
  const sep = ls[0].includes(";") ? ";" : ",", cab = ls[0].split(sep).map(x => x.trim());
  const iC = cab.findIndex(c => /^codigo/i.test(c)), iT = cab.findIndex(c => c === "momento" || c === "Instante"), iR = cab.indexOf("momentoRegistro");
  if (iC < 0 || iT < 0) return {nombre, error: "formato no reconocido (se esperan columnas codigoNacional y momento o Instante)"};
  const cols = cab.map((c, j) => [j, MAPA[c]]).filter(x => x[1]);
  let n = 0, t0 = Infinity, t1 = -Infinity; const cods = new Set();
  for (let i = 1; i < ls.length; i++){
    const v = ls[i].split(sep), cod = v[iC].trim(), t = Date.parse(v[iT].trim().replace(" ", "T") + (v[iT].length <= 16 ? ":00Z" : "Z"));
    if (!cod || !t) continue;
    let m = SUB.get(cod); if (!m){ m = new Map(); SUB.set(cod, m); }
    const o = m.get(t) || {t};
    cols.forEach(([j, k]) => { const x = v[j] === undefined || v[j] === "" ? null : +v[j]; if (x != null && !isNaN(x)) o[k] = x; else if (!(k in o)) o[k] = null; });
    if (iR >= 0 && v[iR]) o._reg = Math.round((Date.parse(v[iR].replace(" ", "T") + "Z") - t) / 60e3);
    m.set(t, o); n++; cods.add(cod); t0 = Math.min(t0, t); t1 = Math.max(t1, t);
  }
  return {nombre, n, cods: [...cods], t0, t1, vars: [...new Set(cols.map(x => NOM[x[1]] || x[1]))]};
}
async function zipLib(){
  if (window.JSZip) return window.JSZip;
  await new Promise((ok, mal) => { const sc = document.createElement("script"); sc.src = "https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js"; sc.onload = ok; sc.onerror = mal; document.head.appendChild(sc); });
  return window.JSZip;
}
async function leerArchivos(files){
  for (const f of files){
    try {
      if (/\.zip$/i.test(f.name)){
        const Z = await (await zipLib()).loadAsync(f);
        for (const e of Object.values(Z.files)) if (!e.dir && /\.(csv|txt)$/i.test(e.name)) ARCH.push(leerCSV(e.name, await e.async("string")) || {nombre: e.name, error: "vacío"});
      } else ARCH.push(leerCSV(f.name, await f.text()) || {nombre: f.name, error: "vacío"});
    } catch (e){ ARCH.push({nombre: f.name, error: "no se pudo leer (" + e.message + ")"}); }
  }
  DC.clear();
}
async function subir(files){
  $("#mSubInfo").innerHTML = `<span style="color:var(--mu)">Leyendo ${files.length} archivo(s)…</span>`;
  await leerArchivos(files); pintarSub();
  const ok = ARCH.filter(a => !a.error && a.n);
  if (ok.length){                                   // deja lista la estación y el primer día de los archivos, y genera
    const a = ok[ok.length - 1], c = a.cods[0], e = EST.find(x => x.codigo === c);
    if (!buscarCod($("#mEst").value) || !SUB.has(buscarCod($("#mEst").value))) $("#mEst").value = c + (e ? " · " + e.nombre : "");
    const dia = $("#mDia").value, t = Date.parse(dia + "T12:00Z");
    if (!(t >= a.t0 && t <= a.t1)) $("#mDia").value = new Date(a.t0 + 864e5 / 2).toISOString().slice(0, 10);
    generar();
  }
}
function pintarSub(sel){
  const d = t => new Date(t).toISOString().slice(0, 10), el = document.querySelector(sel || "#mSubInfo"); if (!el) return;
  el.innerHTML = ARCH.length ? `<table style="width:auto;font-size:12.5px">${ARCH.map(a => a.error ? `<tr><td>${esc(a.nombre)}</td><td colspan="3" style="color:#eb5757">${esc(a.error)}</td></tr>`
    : `<tr><td>${esc(a.nombre)}</td><td>${a.cods.map(c => esc((EST.find(e => e.codigo === c) || {}).nombre || c)).join(", ")}</td><td>${d(a.t0)} a ${d(a.t1)}</td><td>${a.n.toLocaleString("es-CL")} filas · ${esc(a.vars.join(", "))}</td></tr>`).join("")}</table>
    <p class="nota" style="margin:4px 0 0">Los archivos se leen solo en este navegador (no se suben a ningún servidor). Para un día con archivos subidos se usan esos datos en vez del archivo de METOTEC.</p>` : "";
}

/* --------- cálculos --------- */
/* picos aislados: valor que se aparta más de U de la mediana de sus vecinos válidos (±5 registros, hasta 20 min) */
const PICO = {T: 3, Td: 4, HR: 15, P_est: 2};
function marcarPicos(T){
  Object.entries(PICO).forEach(([v, u]) => {
    const L = VAL[v], P = T.filter(o => o[v] != null && o[v] >= L[0] && o[v] <= L[1]);
    P.forEach((o, i) => { const w = P.slice(Math.max(0, i - 5), i).concat(P.slice(i + 1, i + 6)).filter(q => Math.abs(q.t - o.t) <= 20 * 60e3).map(q => q[v]).sort((a, b) => a - b);
      if (w.length >= 2 && Math.abs(o[v] - w[Math.floor(w.length / 2)]) > u) o["_p" + v] = 1; });
  });
}
const en = (F, a, b) => F.filter(o => o.t > a && o.t <= b);           // minuto m = período (m−1, m]
const VAL = {T: [-40, 45], Td: [-60, 35], HR: [1, 100], P_est: [450, 1080], fx10: [0, 200], ff10: [0, 150]};
function ext(F, v, max){
  const L = VAL[v] || [-Infinity, Infinity];
  let r = null; F.forEach(o => { const x = o[v]; if (x != null && x >= L[0] && x <= L[1] && !o["_p" + v] && (r == null || (max ? x > r.v : x < r.v))) r = {v: x, t: o.t}; }); return r;
}
const suma = (F, v) => { const x = F.map(o => o[v]).filter(x => x != null); return x.length ? x.reduce((a, b) => a + b, 0) : null; };
const fila = (F, t) => F.find(o => o.t === t);
function cadencia(F){
  const d = []; for (let i = 1; i < F.length; i++) d.push(F[i].t - F[i - 1].t);
  d.sort((a, b) => a - b); return d.length ? Math.max(60e3, d[Math.floor(d.length / 2)]) : 60e3;
}
const HRm = (T, Td) => 100 * Math.exp(17.625 * Td / (243.04 + Td)) / Math.exp(17.625 * T / (243.04 + T));
const qnh = (qfe, h) => Math.pow(Math.pow(qfe, .190263) + Math.pow(1013.25, .190263) * .0065 * h / 288.15, 1 / .190263);

function inconsistencias(D, alt){
  const F = D.F, cad = cadencia(F), I = [];
  const add = (nivel, t1, t2, v, msg) => I.push({nivel, t1, t2, v, msg});
  // episodios: junta minutos seguidos con la misma falla
  function episodios(clave, test, nivel, msg){
    let a = null, n = 0, peor = null;
    const cerrar = (tFin) => { if (a != null){ add(nivel(peor), a, tFin, clave, msg(peor, n)); a = null; n = 0; peor = null; } };
    F.forEach((o, i) => { const r = test(o, i);
      if (r != null && r !== false){ if (a == null) a = o.t; n++; peor = peor == null || Math.abs(r) > Math.abs(peor) ? r : peor; }
      else cerrar(F[i - 1] ? F[i - 1].t : o.t); });
    cerrar(F.length ? F[F.length - 1].t : 0);
  }
  // 1. completitud y vacíos
  const hasta = Math.min(D.fin, Math.floor((Date.now() - 50 * 60e3) / cad) * cad), esperados = Math.round((hasta - D.ini) / cad);
  if (F.length < esperados * .95) add(F.length < esperados * .8 ? 2 : 1, D.ini, hasta, "—", `Hay ${F.length} de ${esperados} registros esperados hasta ${hhmm(hasta)} UTC (${Math.round(100 * F.length / esperados)} %)`);
  let prev = D.ini;
  F.filter(o => o.t <= hasta).concat([{t: hasta + cad}]).forEach(o => { if (o.t - prev > 2 * cad) add((o.t - prev) > 3600e3 ? 2 : 1, prev + cad, Math.min(o.t - cad, D.fin), "—", `Faltan datos (${Math.round((o.t - prev - cad) / 60e3)} min)`); prev = o.t; });
  if (D.sinArchivo) add(1, D.ini, hasta, "—", `${D.sinArchivo} hora(s) sin archivo en METOTEC: el vacío puede ser nuestro y no de la estación`);
  // 2. rangos
  const LIM = {T: [-40, 45], Td: [-60, 35], HR: [1, 100], P_est: [450, 1080], P_mar: [920, 1060], P_std: [920, 1080], ff10: [0, 150], fx10: [0, 200], dd10: [0, 360], rr1m: [0, 5]};
  Object.entries(LIM).forEach(([v, [a, b]]) => episodios(v, o => o[v] != null && (o[v] < a || o[v] > b) ? o[v] : null, () => 2, (p, n) => `${NOM[v]} fuera de rango: ${p} ${UNI[v]} (${n} reg.)`));
  // 3. coherencia T, Td, HR
  episodios("Td", o => o.T != null && o.Td != null && o.Td > o.T + .1 ? o.Td - o.T : null, p => p > 1 ? 2 : 1, (p, n) => `Punto de rocío mayor que la temperatura (hasta ${f1(p)} °C, ${n} reg.)`);
  episodios("HR", o => o.T != null && o.Td != null && o.HR != null && o.Td <= o.T + .1 && Math.abs(o.HR - HRm(o.T, o.Td)) > 5 ? o.HR - HRm(o.T, o.Td) : null,
    p => Math.abs(p) > 10 ? 2 : 1, (p, n) => `Humedad no cuadra con T y Td (diferencia hasta ${f1(p)} %, ${n} reg.)`);
  // 4. saltos entre registros seguidos
  const SAL = {T: [2, 4], Td: [3, 6], HR: [12, 25], P_est: [1, 2]}, k = cad / 60e3;
  Object.entries(SAL).forEach(([v, [a, b]]) => episodios(v, (o, i) => { const q = F[i - 1]; if (!q || o[v] == null || q[v] == null || o.t - q.t > 2 * cad) return null;
    const d = o[v] - q[v]; return Math.abs(d) > a * Math.max(1, k / 2) ? d : null; }, p => Math.abs(p) > b * Math.max(1, k / 2) ? 2 : 1, (p, n) => `Salto de ${NOM[v]} de ${p > 0 ? "+" : ""}${f1(p)} ${UNI[v]} entre registros seguidos`));
  // 5. valor pegado
  const PEG = {T: 180, Td: 180, HR: 240, P_est: 240};
  Object.entries(PEG).forEach(([v, min]) => { let a = 0;
    for (let i = 1; i <= F.length; i++){ const igual = i < F.length && F[i][v] != null && F[i][v] === F[a][v] && !(v === "HR" && F[i][v] >= 97);
      if (!igual){ if (F[a][v] != null && F[i - 1].t - F[a].t >= min * 60e3) add(1, F[a].t, F[i - 1].t, v, `${NOM[v]} sin cambios en ${Math.round((F[i - 1].t - F[a].t) / 60e3)} min (${F[a][v]} ${UNI[v]})`); a = i; } } });
  // 6. viento
  episodios("ff10", o => o.ff10 != null && o.fx10 != null && o.fx10 + .5 < o.ff10 ? o.ff10 - o.fx10 : null, () => 1, (p, n) => `Viento medio mayor que la racha (${n} reg.)`);
  // 7. presión: QNH con la atmósfera estándar y QFF reducido
  if (alt != null){
    episodios("P_std", o => o.P_est != null && o.P_std != null && Math.abs(o.P_std - qnh(o.P_est, alt)) > .5 ? o.P_std - qnh(o.P_est, alt) : null,
      p => Math.abs(p) > 1.5 ? 2 : 1, (p, n) => `QNH no cuadra con QFE y la altura ${alt} m (diferencia ${p > 0 ? "+" : ""}${f1(p)} hPa, ${n} reg.; puede ser error de ingreso, de configuración o de la altura en los metadatos)`);
    if (alt < 800) episodios("P_mar", o => { if (o.P_est == null || o.P_mar == null || o.T == null) return null;
      const pr = o.P_est * Math.exp(alt / (29.27 * (o.T + 273.15 + .0065 * alt / 2))); return Math.abs(pr - o.P_mar) > 3 ? o.P_mar - pr : null; },
      p => Math.abs(p) > 6 ? 2 : 1, (p, n) => `QFF no cuadra con QFE reducido al nivel del mar (${p > 0 ? "+" : ""}${f1(p)} hPa, ${n} reg.)`);
  }
  // 8. lo informado por la estación frente a lo calculado del minutario
  R(D).comp.forEach(c => { if (c.inf != null && c.cal != null && Math.abs(c.inf - c.cal) > c.tol) add(Math.abs(c.inf - c.cal) > 3 * c.tol ? 2 : 1, c.t, c.t, c.v, `${c.nom}: la estación informa ${f1(c.inf)} y del minutario sale ${f1(c.cal)} ${c.u}`); });
  return I.sort((a, b) => a.t1 - b.t1);
}

function R(D){                     // resumen del día
  if (D._R) return D._R;
  const F = D.T, d0 = Date.UTC(...D.dia.split("-").map((x, i) => i === 1 ? x - 1 : +x)), h = x => d0 + x * 3600e3;
  const noche = en(F, h(0), h(12)), tarde = en(F, h(12), h(24));
  const tn = ext(noche, "T", false), tx = ext(tarde, "T", true);
  const per = [0, 6, 12, 18].map(a => { const G = en(F, h(a), h(a + 6)), s = suma(G, "rr1m"), r = fila(F, h(a + 6)); return {a, s, n: G.length, inf: r ? r.rr6 : null, t: h(a + 6)}; });
  const r24 = en(F, h(12) - 864e5, h(12)), comp = [];
  const r12 = fila(F, h(12)), r00 = fila(F, h(24));
  if (r12) comp.push({nom: "Tn12 de las 12 UTC", v: "Tn12", inf: r12.Tn12, cal: tn && tn.v, tol: .3, u: "°C", t: h(12)});
  if (r00) comp.push({nom: "Tx12 de las 00 UTC", v: "Tx12", inf: r00.Tx12, cal: tx && tx.v, tol: .3, u: "°C", t: h(24)});
  per.forEach(p => { if (p.inf != null || p.s) comp.push({nom: `RRR6 de ${String(p.a).padStart(2, "0")} a ${String(p.a + 6).padStart(2, "0")} UTC`, v: "rr6", inf: p.inf, cal: p.n ? (p.s || 0) : null, tol: .2, u: "mm", t: p.t}); });
  if (r00 && r00.rr24 != null){ const s = suma(en(F, h(0), h(24)), "rr1m"); comp.push({nom: "RRR24 de las 00 UTC", v: "rr24", inf: r00.rr24, cal: s || 0, tol: .3, u: "mm", t: h(24)}); }
  const G = D.F;
  return D._R = {tn, tx, per, comp, d: {Tmin: ext(G, "T", false), Tmax: ext(G, "T", true), HRmin: ext(G, "HR", false), HRmax: ext(G, "HR", true),
    Pmin: ext(G, "P_est", false), Pmax: ext(G, "P_est", true), fx: ext(G, "fx10", true), ff: ext(G, "ff10", true), rr: suma(G, "rr1m")}};
}

/* --------- pantalla --------- */
function init(){
  const s = $("#minu"); if (s.dataset.ok) return; s.dataset.ok = 1;
  const ayer = new Date(Date.now() - (new Date().getUTCHours() < 6 ? 864e5 : 0)).toISOString().slice(0, 10);   // hoy (UTC), salvo recién empezado el día
  s.innerHTML = `<div class="htools"><button id="mVolver" style="border-color:var(--oro);color:var(--oro)">← Volver al mapa</button>
    <input id="mEst" list="mLista" placeholder="Estación (nombre o código)" style="min-width:280px"><datalist id="mLista"></datalist>
    <input type="date" id="mDia" value="${ayer}"><select id="mDiaT"><option value="utc">Día UTC (00 a 24 UTC)</option><option value="loc">Día local (00 a 24 hora de Chile)</option></select>
    <button id="mVer" style="border-color:var(--oro);color:var(--oro)">Generar</button><button id="mCsv">Descargar CSV</button></div>
    <p class="nota" style="margin:0 0 10px">Las extremas descartan valores fuera de rango y picos aislados (minutos que se apartan bruscamente de sus vecinos). Datos minutarios del archivo de METOTEC (guardado cada 30 min desde el 8-11-2026, todas las estaciones automáticas). Extremas sinópticas: mínima de 00 a 12 UTC (se informa a las 12) y máxima de 12 a 24 UTC (se informa a las 00). Cada minuto cuenta para el período que termina en él.</p>
    <div id="mOut"></div>`;
  estaciones().then(E => { $("#mLista").innerHTML = E.map(e => `<option value="${e.codigo} · ${esc(e.nombre)}">`).join(""); });
  $("#mVolver").addEventListener("click", () => document.querySelector('.modos button[data-m="ema"]').click());
  $("#mVer").addEventListener("click", generar); $("#mEst").addEventListener("change", generar); $("#mDia").addEventListener("change", generar); $("#mDiaT").addEventListener("change", generar);
  $("#mCsv").addEventListener("click", csv);

  s.addEventListener("toggle", ev => { const d = ev.target; if (d.classList && d.classList.contains("mblo")) d.open ? CERR.delete(d.dataset.k) : CERR.add(d.dataset.k); }, true);
  s.addEventListener("change", ev => { if (ev.target.id === "mSoloDif"){ soloDif = ev.target.checked; grafico(); return; }
    const c = ev.target.closest(".mcmp"); if (c){ const k = c.dataset.c;
      if (c.checked){ if (M.cmp.length >= 2) M.cmp.shift(); M.cmp.push(k); } else M.cmp = M.cmp.filter(x => x !== k); vecinas(); }
    if (ev.target.id === "mAgr"){ const k = buscarCod(ev.target.value);
      if (k && k !== M.cod && !M.vec.includes(k)){ M.vec.push(k); if (M.cmp.length < 2) M.cmp.push(k); } ev.target.value = ""; vecinas(); } });
  s.addEventListener("click", ev => { const b = ev.target.closest("[data-mv]"); if (b){ mVar = b.dataset.mv; grafico(); }
    const qx = ev.target.closest(".mqui"); if (qx){ M.vec = M.vec.filter(x => x !== qx.dataset.c); M.cmp = M.cmp.filter(x => x !== qx.dataset.c); vecinas(); return; }
    const i = ev.target.closest("tr.inc"); if (i){ const r = document.getElementById("m" + i.dataset.t); if (r){ r.scrollIntoView({block: "center"}); r.classList.add("vis"); setTimeout(() => r.classList.remove("vis"), 2500); } } });
}
async function generar(){
  await estaciones();
  const cod = buscarCod($("#mEst").value);
  if (!cod){ $("#mOut").innerHTML = `<p style="color:var(--mu)">No encontré esa estación. Escriba el código (6 dígitos), el nombre o el OACI.</p>`; return; }
  $("#mOut").innerHTML = `<p style="color:var(--mu)">Leyendo 25 horas de datos…</p>`;
  M = await cargar(cod, $("#mDia").value, $("#mDiaT").value === "loc");
  const e = EST.find(x => x.codigo === cod) || {};
  M.nombre = e.nombre || cod; M.alt = e.alt ?? null;
  if (!M.F.length){ $("#mOut").innerHTML = `<p style="color:var(--mu)">No hay datos de ${esc(M.nombre)} para ese día en el archivo de METOTEC (parte el 8-11-2026). Para fechas anteriores use «Completar serie», que acepta los ZIP del portal de climatología${M.sinArchivo ? ` (faltan ${M.sinArchivo} de ${M.horas} horas de archivo)` : ""}.${M.errApi ? ` <br><b style="color:#f2c94c">No se pudo usar el servidor de METOTEC (${esc(M.errApi)}); se intentó directo desde GitHub, que su red puede bloquear.</b>` : ""}</p>`; return; }
  M.I = inconsistencias(M, M.alt); pintar();
}
function tarjeta(t, x, u, sub){ return `<div><span>${t}</span><b>${x ? f1(x.v) + " " + u : "—"}</b>${x ? `<span>${hhmm(x.t)} UTC · ${loc(x.t)} hora local</span>` : ""}${sub ? `<span>${sub}</span>` : ""}</div>`; }
function pintar(){
  const r = R(M), d = r.d, mal = {}; M.I.forEach(i => { if (i.v !== "—") for (const o of M.F) if (o.t >= i.t1 && o.t <= i.t2) (mal[o.t] = mal[o.t] || {})[i.v] = Math.max(i.nivel, (mal[o.t] || {})[i.v] || 0); });
  M.mal = mal;
  const cmp = c => !c ? "" : c.inf == null ? "sin valor informado" : `informada ${f1(c.inf)} · ${c.cal != null && Math.abs(c.inf - c.cal) > c.tol ? `<b style="color:#f2c94c;display:inline;font-size:inherit">no cuadra</b>` : "cuadra"}`;
  const cn = r.comp.find(c => c.v === "Tn12"), cx = r.comp.find(c => c.v === "Tx12");
  const vars = VARS.filter(v => M.F.some(o => o[v[0]] != null));
  $("#mOut").innerHTML = `<h3 style="margin:4px 0 10px">${esc(M.nombre)} <small style="color:var(--mu)">${M.cod}${M.alt != null ? " · " + M.alt + " m" : ""} · ${M.dia} ${M.local ? "(día local)" : "(día UTC)"} · ${M.F.length} registros cada ${cadencia(M.F) / 60e3} min · fuente: ${M.origen}</small></h3>
    <div class="hres">${tarjeta("Mínima 00–12 UTC (Tn12)", r.tn, "°C", cmp(cn))}${tarjeta("Máxima 12–24 UTC (Tx12)", r.tx, "°C", cmp(cx))}
      ${tarjeta("Mínima del período", d.Tmin, "°C")}${tarjeta("Máxima del período", d.Tmax, "°C")}${tarjeta("Racha máxima", d.fx, "kt")}${tarjeta("Humedad mínima", d.HRmin, "%")}${tarjeta("QFE mínimo", d.Pmin, "hPa")}${tarjeta("QFE máximo", d.Pmax, "hPa")}</div>
    <div class="hres">${r.per.map(p => `<div><span>Agua caída ${String(p.a).padStart(2, "0")}–${String(p.a + 6).padStart(2, "0")} UTC</span><b>${p.n ? f1(p.s || 0) + " mm" : "—"}</b><span>${p.inf != null ? "RRR6 informada " + f1(p.inf) : "sin RRR6 informada"}${p.n ? ` · ${p.n} reg.` : ""}</span></div>`).join("")}
      <div><span>Total del período</span><b>${d.rr != null ? f1(d.rr) + " mm" : "—"}</b><span>suma de agua caída del minuto</span></div></div>
    ${bloque("inc", `Inconsistencias en la serie (${M.I.length})`, M.I.length ? `<table><tr><th>Nivel</th><th>Desde (UTC)</th><th>Hasta</th><th>Elemento</th><th>Detalle</th></tr>${M.I.map(i => `<tr class="inc" data-t="${i.t1}" style="cursor:pointer"><td><span class="pb" style="background:${i.nivel === 2 ? "#eb5757" : "#f2c94c"};color:#111">${i.nivel === 2 ? "Erróneo" : "Sospechoso"}</span></td><td>${hhmm(i.t1)}</td><td>${i.t2 !== i.t1 ? hhmm(i.t2) : ""}</td><td>${esc(NOM[i.v] || "General")}</td><td>${esc(i.msg)}</td></tr>`).join("")}</table>` : `<p style="color:#6fcf97">Sin inconsistencias en la serie.</p>`)}
    ${bloque("vec", "Estaciones cercanas", `<div class="htools"><input id="mAgr" list="mLista" placeholder="Agregar otra estación…" style="min-width:260px"><span style="color:var(--mu);font-size:12.5px">Marque hasta 2 para compararlas minuto a minuto con ${esc(M.nombre)}.</span></div>
    <div id="mVec"><p style="color:var(--mu)">Buscando las más cercanas…</p></div>`)}
    ${bloque("graf", "Gráfico", `<div class="htools">${vars.filter(v => !["rr6", "rr24", "Tn12", "Tx12"].includes(v[0])).map(v => `<button data-mv="${v[0]}" ${v[0] === mVar ? 'style="border-color:var(--oro);color:var(--oro)"' : ""}>${v[1]}</button>`).join("")}</div><div id="mGraf"></div>`)}<div id="mCompTab"></div>
    ${bloque("datos", "Datos minutarios", `<div style="max-height:60vh;overflow:auto;border:1px solid var(--bd);border-radius:8px"><table class="mtab"><tr><th>UTC</th><th>Local</th>${vars.map(v => `<th>${v[1]}<br><small>${v[2]}</small></th>`).join("")}</tr>
    ${M.F.map(o => `<tr id="m${o.t}"><td>${hhmm(o.t)}</td><td>${loc(o.t)}</td>${vars.map(v => { const n = (mal[o.t] || {})[v[0]]; return `<td${n ? ` style="background:${n === 2 ? "#5a1f1f" : "#4a3f12"}"` : ""}>${o[v[0]] ?? ""}</td>`; }).join("")}</tr>`).join("")}</table></div>`)}`;
  grafico(); vecinas();
}
/* bloques que se pliegan: se recuerda cuáles cerró el usuario */
const CERR = new Set();
const bloque = (k, titulo, html) => `<details class="mblo" data-k="${k}" ${CERR.has(k) ? "" : "open"}><summary>${titulo}</summary><div class="mcont">${html}</div></details>`;
/* umbral de diferencia entre estaciones por variable (se marca desde 1 umbral; fuerte desde 2) */
const UMB = {T: 1, Td: 2, HR: 10, P_est: .5, P_mar: 1, P_std: .5, ff10: 5, fx10: 8, dd10: 45, rr1m: .2, Rad: 100};
let soloDif = false;
/* ---------- estaciones cercanas y comparación ---------- */
const DC = new Map(), COLS = ["#C9A54C", "#56CCF2", "#EB5757"];
const km = (a, b) => 6371 * Math.hypot((b.lat - a.lat) * Math.PI / 180, (b.lon - a.lon) * Math.PI / 180 * Math.cos(a.lat * Math.PI / 180));
async function otra(cod){
  const k = cod + "|" + M.dia + "|" + M.local;
  if (!DC.has(k)) DC.set(k, cargar(cod, M.dia, M.local).then(D => { const e = EST.find(x => x.codigo === cod) || {}; D.nombre = e.nombre || cod; D.alt = e.alt ?? null; return D; }));
  return DC.get(k);
}
async function vecinas(){
  const yo = EST.find(e => e.codigo === M.cod);
  if (!M.vec){ M.vec = yo && yo.lat != null ? EST.filter(e => e.codigo !== M.cod && e.lat != null).map(e => ({c: e.codigo, d: km(yo, e)})).filter(x => x.d <= 60).sort((a, b) => a.d - b.d).slice(0, 5).map(x => x.c) : []; M.cmp = []; }
  const Ds = await Promise.all(M.vec.map(otra));
  const fila = (D, yo2) => { const r = R(D), pct = Math.round(100 * D.F.length / Math.max(1, Math.round(Math.min(D.fin, Date.now() - 50 * 60e3) - D.ini) / cadencia(D.F))),
      cn = r.comp.find(c => c.v === "Tn12"), cx = r.comp.find(c => c.v === "Tx12"), d = yo && yo2 ? km(yo, yo2) : 0, i = M.cmp.indexOf(D.cod);
    return `<tr${D === M ? ' style="background:#16264a"' : ""}><td>${D === M ? `<span style="color:${COLS[0]}">●</span>` : `<input type="checkbox" class="mcmp" data-c="${D.cod}" ${i >= 0 ? "checked" : ""}> ${i >= 0 ? `<span style="color:${COLS[i + 1]}">●</span>` : ""}`}</td>
      <td>${esc(D.nombre)} <small style="color:var(--mu)">${D.cod}</small></td><td>${D === M ? "—" : d.toFixed(1) + " km"}</td><td>${D.alt ?? "—"} m</td>
      <td><b>${r.tn ? f1(r.tn.v) : "—"}</b></td><td>${r.tn ? hhmm(r.tn.t) : ""}</td><td>${cn && cn.inf != null ? f1(cn.inf) : "—"}</td>
      <td><b>${r.tx ? f1(r.tx.v) : "—"}</b></td><td>${r.tx ? hhmm(r.tx.t) : ""}</td><td>${cx && cx.inf != null ? f1(cx.inf) : "—"}</td>
      <td>${r.d.rr != null ? f1(r.d.rr) + " mm" : "—"}</td><td>${D.F.length ? Math.min(100, pct) + " %" : "sin datos"}</td>${D === M ? "<td></td>" : `<td><button class="mqui" data-c="${D.cod}" title="Quitar" style="background:none;border:0;color:var(--mu);cursor:pointer">✕</button></td>`}</tr>`; };
  $("#mVec").innerHTML = `<table><tr><th></th><th>Estación</th><th>Distancia</th><th>Altura</th><th>Mín 00–12 UTC</th><th>Hora UTC</th><th>Tn12 informada</th><th>Máx 12–24 UTC</th><th>Hora UTC</th><th>Tx12 informada</th><th>Agua caída</th><th>Datos</th><th></th></tr>
    ${fila(M, yo)}${Ds.map(D => fila(D, EST.find(e => e.codigo === D.cod))).join("")}</table>
    ${M.vec.length ? "" : `<p style="color:var(--mu)">No hay estaciones a menos de 60 km; agregue una arriba.</p>`}`;
  grafico();
}
function grafico(){
  if (!M) return;
  document.querySelectorAll("#minu [data-mv]").forEach(b => b.style.cssText = b.dataset.mv === mVar ? "border-color:var(--oro);color:var(--oro)" : "");
  const v = mVar, W = 1100, H = 250, iz = 46, de = 12, ar = 14, ab = 26;
  const otras = (M.cmp || []).map(c => [...DC.entries()].find(([k]) => k.startsWith(c + "|" + M.dia + "|" + M.local))).filter(Boolean).map(x => x[1]);
  Promise.all(otras).then(Ds => dibujar([M, ...Ds]));
  function dibujar(S){
  const series = S.map(D => { let acum = 0; const L = VAL[v] || [-Infinity, Infinity];
    return D.F.filter(o => o[v] != null && o[v] >= L[0] && o[v] <= L[1] && !o["_p" + v]).map(o => [o.t, v === "rr1m" ? (acum += o[v]) : o[v], o]); });
  const ys = series.flat().map(p => p[1]);
  if (!ys.length){ $("#mGraf").innerHTML = `<p style="color:var(--mu)">Sin datos válidos de ${NOM[v]}.</p>`; $("#mCompTab").innerHTML = ""; return; }
  const y0 = Math.min(...ys), y1 = Math.max(...ys), dy = (y1 - y0) || 1;
  const X = t => iz + (W - iz - de) * (t - M.ini) / (M.fin - M.ini), Y = y => ar + (H - ar - ab) * (1 - (y - y0 + dy * .05) / (dy * 1.1));
  const linea = (pts, D, i) => { let path = "", ant = null; const cad = cadencia(D.F);
    pts.forEach(p => { path += (ant == null || p[0] - ant > 2 * cad ? "M" : "L") + X(p[0]).toFixed(1) + " " + Y(p[1]).toFixed(1); ant = p[0]; });
    return `<path d="${path}" fill="none" stroke="${COLS[i]}" stroke-width="${i ? 1.2 : 1.5}" opacity="${i ? .9 : 1}"/>`; };
  const paths = series.map((p, i) => linea(p, S[i], i)).reverse().join("");
  const marcas = series[0].filter(p => (M.mal[p[0]] || {})[v] || p[2]["_p" + v]).map(p => `<circle cx="${X(p[0]).toFixed(1)}" cy="${Y(p[1]).toFixed(1)}" r="2.5" fill="${(M.mal[p[0]] || {})[v] === 2 || p[2]["_p" + v] ? "#eb5757" : "#f2c94c"}"/>`).join("");
  const ley = S.length > 1 ? S.map((D, i) => `<tspan fill="${COLS[i]}">● ${esc(D.nombre)}</tspan>`).join("   ") : "";

  const ticks = []; for (let h = 0; h <= 24; h += 3) ticks.push(`<line x1="${X(M.ini + h * 3600e3)}" x2="${X(M.ini + h * 3600e3)}" y1="${ar}" y2="${H - ab}" stroke="#ffffff14"/><text x="${X(M.ini + h * 3600e3)}" y="${H - 8}" fill="#9fb0cc" font-size="11" text-anchor="middle">${hhmm(M.ini + h * 3600e3)}</text>`);
  const yt = [y0, (y0 + y1) / 2, y1].map(y => `<text x="${iz - 6}" y="${Y(y) + 4}" fill="#9fb0cc" font-size="11" text-anchor="end">${f1(y)}</text>`).join("");
  $("#mGraf").innerHTML = `<svg viewBox="0 0 ${W} ${H}" style="width:100%;background:var(--panel);border:1px solid var(--bd);border-radius:8px">${ticks.join("")}${yt}
    ${paths}${marcas}<text x="${iz}" y="${ar - 2}" fill="#9fb0cc" font-size="11">${NOM[v]}${v === "rr1m" ? " acumulada" : ""} (${UNI[v]}) · hora UTC   ${ley}</text></svg>`;
  tablaComp(S, series);
  }
}
function tablaComp(S, series){
  if (S.length < 2){ $("#mCompTab").innerHTML = ""; return; }
  const v = mVar, idx = series.map(p => new Map(p.map(x => [x[0], x[1]])));
  const cads = S.map(D => cadencia(D.F)), gruesa = cads.indexOf(Math.max(...cads));     // con cadencias distintas (1 y 10 min) se usan los horarios de la más espaciada
  const base = Math.max(...cads) > Math.min(...cads) ? series[gruesa] : series.flat();
  const tiempos = [...new Set(base.map(p => p[0]))].filter(t => t > M.ini && t <= M.fin).sort((a, b) => a - b);
  const dif = S.slice(1).map((D, j) => { const d = tiempos.map(t => idx[0].has(t) && idx[j + 1].has(t) ? idx[j + 1].get(t) - idx[0].get(t) : null).filter(x => x != null);
    return d.length ? {m: d.reduce((a, b) => a + b, 0) / d.length, n: d.length, max: d.reduce((a, b) => Math.abs(b) > Math.abs(a) ? b : a, 0)} : null; });
  const U = UMB[v] || Infinity, dd = (a, b) => v === "dd10" ? ((b - a + 540) % 360) - 180 : b - a;
  const col = d => d == null ? "" : Math.abs(d) >= 2 * U ? "#6b2020" : Math.abs(d) >= U ? "#5a4a12" : Math.abs(d) >= U / 2 ? "#1f3a66" : "";
  const filasT = tiempos.filter(t => !soloDif || idx.slice(1).some(m => { const a = idx[0].get(t), b = m.get(t); return a != null && b != null && Math.abs(dd(a, b)) >= U; }));
  $("#mCompTab").innerHTML = bloque("comp", `Comparación entre estaciones · ${NOM[v]}${v === "rr1m" ? " acumulada" : ""} (${UNI[v]})`, `<div class="hres" style="margin-top:4px">${S.slice(1).map((D, j) => `<div><span style="color:${COLS[j + 1]}">● ${esc(D.nombre)} − ${esc(M.nombre)}</span><b>${dif[j] ? (dif[j].m > 0 ? "+" : "") + f1(dif[j].m) + " " + UNI[v] : "—"}</b><span>${dif[j] ? `diferencia media en ${dif[j].n} min · mayor ${dif[j].max > 0 ? "+" : ""}${f1(dif[j].max)}` : "sin minutos en común"}</span></div>`).join("")}</div>
    <div class="htools" style="font-size:12.5px;color:var(--mu)"><label style="display:flex;gap:6px;align-items:center;cursor:pointer"><input type="checkbox" id="mSoloDif" ${soloDif ? "checked" : ""}> Solo filas con diferencia de ${U === Infinity ? "—" : U} ${UNI[v]} o más</label>
      <span><i style="display:inline-block;width:12px;height:12px;background:#1f3a66;vertical-align:-2px"></i> ≥ ${U / 2}</span><span><i style="display:inline-block;width:12px;height:12px;background:#5a4a12;vertical-align:-2px"></i> ≥ ${U}</span><span><i style="display:inline-block;width:12px;height:12px;background:#6b2020;vertical-align:-2px"></i> ≥ ${2 * U} ${UNI[v]}</span><span>${filasT.length} filas</span></div>
    <div style="max-height:45vh;overflow:auto;border:1px solid var(--bd);border-radius:8px"><table class="mtab mcomp"><tr><th>UTC</th><th>Local</th>${S.map((D, i) => `<th style="color:${COLS[i]}">${esc(D.nombre)}</th>`).join("")}${S.slice(1).map((D, j) => `<th>Dif. ${j + 2} − 1</th>`).join("")}</tr>
    ${filasT.map(t => { const a = idx[0].get(t), ds = idx.slice(1).map(m => { const b = m.get(t); return a != null && b != null ? dd(a, b) : null; });
      return `<tr><td>${hhmm(t)}</td><td>${loc(t)}</td>${idx.map((m, i) => { const c = i ? col(ds[i - 1]) : "";
        return `<td${c ? ` style="background:${c}"` : ""}>${m.has(t) ? f1(m.get(t)) : ""}</td>`; }).join("")}${ds.map(d => `<td${col(d) ? ` style="background:${col(d)};font-weight:700"` : ""}>${d == null ? "" : (d > 0 ? "+" : "") + f1(d)}</td>`).join("")}</tr>`; }).join("")}</table></div>`);
}
function csv(){
  if (!M) return;
  const cols = VARS.map(v => v[0]).filter(c => M.F.some(o => o[c] != null));
  const L = [["fecha_utc", "hora_local", ...cols, "inconsistencias"].join(";")].concat(M.F.map(o => [new Date(o.t).toISOString().slice(0, 16).replace("T", " "), loc(o.t),
    ...cols.map(c => o[c] == null ? "" : String(o[c]).replace(".", ",")), Object.keys(M.mal[o.t] || {}).map(k => NOM[k]).join(" / ")].join(";")));
  const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob(["﻿" + L.join("\n")], {type: "text/csv"}));
  a.download = `minutarios_${M.cod}_${M.dia}.csv`; a.click();
}
window.MINU = {init, cargar, inconsistencias, R, estaciones, buscarCod, leerArchivos, pintarSub, get EST(){ return EST; }, SUB, ARCH, VAL, VARS, NOM, UNI,
  cadencia, f1, hhmm, loc, km, esc, fechaArchivo: () => { const ok = ARCH.filter(a => !a.error && a.n); return ok.length ? ok[ok.length - 1] : null; }};
})();
