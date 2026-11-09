/* Datos minutarios de un día para cualquier estación automática: extremas con su hora, precipitación por 6 horas,
   comparación con lo que la propia estación informa (Tn12, Tx12, RRR6, RRR24, QNH, QFF) e inconsistencias de la serie.
   Fuente: archivo propio de METOTEC (rama «datos», una hoja por hora con todas las estaciones), que guarda el servicio
   de la DMC cada 30 minutos desde el 8 de noviembre de 2026. */
(function(){
const RAW = "https://raw.githubusercontent.com/orlalv/metotec/datos/";
const VARS = [["T", "Temperatura", "°C"], ["Td", "Punto de rocío", "°C"], ["HR", "Humedad", "%"], ["P_est", "QFE", "hPa"], ["P_mar", "QFF", "hPa"],
  ["P_std", "QNH", "hPa"], ["dd10", "Dir. 10 min", "°"], ["ff10", "Viento 10 min", "kt"], ["fx10", "Racha", "kt"], ["rr1m", "Agua caída", "mm"],
  ["rr6", "RRR6 informada", "mm"], ["rr24", "RRR24 informada", "mm"], ["Tn12", "Tn12 informada", "°C"], ["Tx12", "Tx12 informada", "°C"], ["Rad", "Radiación", "W/m²"]];
const NOM = Object.fromEntries(VARS.map(v => [v[0], v[1]])), UNI = Object.fromEntries(VARS.map(v => [v[0], v[2]]));
const CACHE = new Map();
let EST = [], M = null, mVar = "T";
const $ = s => document.querySelector(s), esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;"}[c]));
const hhmm = t => new Date(t).toISOString().slice(11, 16), f1 = v => v == null ? "—" : (Math.round(v * 10) / 10).toFixed(1);
const loc = t => new Date(t).toLocaleTimeString("es-CL", {timeZone: "America/Santiago", hour: "2-digit", minute: "2-digit"});

async function hora(t){
  const k = new Date(t).toISOString().slice(0, 13);
  if (CACHE.has(k)) return CACHE.get(k);
  const p = (async () => {
    const r = await fetch(RAW + "ema/" + k.replace(/-/g, "/").replace("T", "/") + ".csv.gz");
    if (!r.ok) return null;
    return await new Response(r.body.pipeThrough(new DecompressionStream("gzip"))).text();
  })().catch(() => null);
  CACHE.set(k, p); return p;
}
async function estaciones(){
  if (EST.length) return EST;
  try { const r = await fetch(RAW + "estaciones.json"); const j = await r.json(); EST = (Array.isArray(j) ? j : j.estaciones || []).sort((a, b) => a.codigo.localeCompare(b.codigo)); } catch (e) { EST = []; }
  return EST;
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
  const txt = await Promise.all(horas.map(t => t <= Date.now() ? hora(t) : null));
  let cab = null, sinArchivo = 0;
  txt.forEach((tx, i) => {
    if (!tx){ if (horas[i] < Date.now() - 3600e3) sinArchivo++; return; }
    const ls = tx.split("\n"); cab = cab || ls[0].split(",");
    const c0 = ls[0].split(","), pre = cod + ",";
    for (let i = 1; i < ls.length; i++) if (ls[i].startsWith(pre)){
      const v = ls[i].split(","), o = {t: Date.parse(v[1].replace(" ", "T") + "Z")};
      c0.forEach((c, j) => { if (j > 1) o[c] = v[j] === "" ? null : +v[j]; });
      filas.push(o);
    }
  });
  const vistos = new Set(), T = filas.filter(o => !vistos.has(o.t) && vistos.add(o.t)).sort((p, q) => p.t - q.t);
  return {cod, dia, local, ini, fin, F: T.filter(o => o.t > ini && o.t <= fin), T, sinArchivo, horas: horas.length};
}

/* --------- cálculos --------- */
const en = (F, a, b) => F.filter(o => o.t > a && o.t <= b);           // minuto m = período (m−1, m]
const VAL = {T: [-40, 45], HR: [1, 100], P_est: [450, 1080], fx10: [0, 200], ff10: [0, 150]};
function ext(F, v, max){
  const L = VAL[v] || [-Infinity, Infinity];
  let r = null; F.forEach(o => { const x = o[v]; if (x != null && x >= L[0] && x <= L[1] && (r == null || (max ? x > r.v : x < r.v))) r = {v: x, t: o.t}; }); return r;
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
  const hasta = Math.min(D.fin, Math.floor((Date.now() - 20 * 60e3) / cad) * cad), esperados = Math.round((hasta - D.ini) / cad);
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
  const ayer = new Date(Date.now() - 864e5).toISOString().slice(0, 10);
  s.innerHTML = `<div class="htools"><button id="mVolver" style="border-color:var(--oro);color:var(--oro)">← Volver al mapa</button>
    <input id="mEst" list="mLista" placeholder="Estación (nombre o código)" style="min-width:280px"><datalist id="mLista"></datalist>
    <input type="date" id="mDia" value="${ayer}" min="2026-11-08"><select id="mDiaT"><option value="utc">Día UTC (00 a 24 UTC)</option><option value="loc">Día local (00 a 24 hora de Chile)</option></select>
    <button id="mVer" style="border-color:var(--oro);color:var(--oro)">Generar</button><button id="mCsv">Descargar CSV</button></div>
    <p class="nota" style="margin:0 0 10px">Las extremas usan solo valores dentro de rango físico. Datos minutarios del archivo de METOTEC (guardado cada 30 min desde el 8-11-2026, todas las estaciones automáticas). Extremas sinópticas: mínima de 00 a 12 UTC (se informa a las 12) y máxima de 12 a 24 UTC (se informa a las 00). Cada minuto cuenta para el período que termina en él.</p>
    <div id="mOut"></div>`;
  estaciones().then(E => { $("#mLista").innerHTML = E.map(e => `<option value="${e.codigo} · ${esc(e.nombre)}">`).join(""); });
  $("#mVolver").addEventListener("click", () => document.querySelector('.modos button[data-m="ema"]').click());
  $("#mVer").addEventListener("click", generar); $("#mEst").addEventListener("change", generar); $("#mDia").addEventListener("change", generar); $("#mDiaT").addEventListener("change", generar);
  $("#mCsv").addEventListener("click", csv);
  s.addEventListener("click", ev => { const b = ev.target.closest("[data-mv]"); if (b){ mVar = b.dataset.mv; grafico(); }
    const i = ev.target.closest("tr.inc"); if (i){ const r = document.getElementById("m" + i.dataset.t); if (r){ r.scrollIntoView({block: "center"}); r.classList.add("vis"); setTimeout(() => r.classList.remove("vis"), 2500); } } });
}
async function generar(){
  const q = $("#mEst").value.trim(), cod = (q.match(/^\d{6}/) || [])[0] || (EST.find(e => (e.nombre || "").toLowerCase().includes(q.toLowerCase())) || {}).codigo;
  if (!cod){ $("#mOut").innerHTML = `<p style="color:var(--mu)">Elija una estación de la lista.</p>`; return; }
  $("#mOut").innerHTML = `<p style="color:var(--mu)">Leyendo 25 horas de datos…</p>`;
  M = await cargar(cod, $("#mDia").value, $("#mDiaT").value === "loc");
  const e = EST.find(x => x.codigo === cod) || {};
  M.nombre = e.nombre || cod; M.alt = e.alt ?? null;
  if (!M.F.length){ $("#mOut").innerHTML = `<p style="color:var(--mu)">No hay datos de ${esc(M.nombre)} para ese día en el archivo${M.sinArchivo ? ` (faltan ${M.sinArchivo} de ${M.horas} horas de archivo)` : ""}.</p>`; return; }
  M.I = inconsistencias(M, M.alt); pintar();
}
function tarjeta(t, x, u, sub){ return `<div><span>${t}</span><b>${x ? f1(x.v) + " " + u : "—"}</b>${x ? `<span>${hhmm(x.t)} UTC · ${loc(x.t)} hora local</span>` : ""}${sub ? `<span>${sub}</span>` : ""}</div>`; }
function pintar(){
  const r = R(M), d = r.d, mal = {}; M.I.forEach(i => { if (i.v !== "—") for (const o of M.F) if (o.t >= i.t1 && o.t <= i.t2) (mal[o.t] = mal[o.t] || {})[i.v] = Math.max(i.nivel, (mal[o.t] || {})[i.v] || 0); });
  M.mal = mal;
  const cmp = c => !c ? "" : c.inf == null ? "sin valor informado" : `informada ${f1(c.inf)} · ${c.cal != null && Math.abs(c.inf - c.cal) > c.tol ? `<b style="color:#f2c94c;display:inline;font-size:inherit">no cuadra</b>` : "cuadra"}`;
  const cn = r.comp.find(c => c.v === "Tn12"), cx = r.comp.find(c => c.v === "Tx12");
  const vars = VARS.filter(v => M.F.some(o => o[v[0]] != null));
  $("#mOut").innerHTML = `<h3 style="margin:4px 0 10px">${esc(M.nombre)} <small style="color:var(--mu)">${M.cod}${M.alt != null ? " · " + M.alt + " m" : ""} · ${M.dia} ${M.local ? "(día local)" : "(día UTC)"} · ${M.F.length} registros cada ${cadencia(M.F) / 60e3} min</small></h3>
    <div class="hres">${tarjeta("Mínima 00–12 UTC (Tn12)", r.tn, "°C", cmp(cn))}${tarjeta("Máxima 12–24 UTC (Tx12)", r.tx, "°C", cmp(cx))}
      ${tarjeta("Mínima del período", d.Tmin, "°C")}${tarjeta("Máxima del período", d.Tmax, "°C")}${tarjeta("Racha máxima", d.fx, "kt")}${tarjeta("Humedad mínima", d.HRmin, "%")}${tarjeta("QFE mínimo", d.Pmin, "hPa")}${tarjeta("QFE máximo", d.Pmax, "hPa")}</div>
    <div class="hres">${r.per.map(p => `<div><span>Agua caída ${String(p.a).padStart(2, "0")}–${String(p.a + 6).padStart(2, "0")} UTC</span><b>${p.n ? f1(p.s || 0) + " mm" : "—"}</b><span>${p.inf != null ? "RRR6 informada " + f1(p.inf) : "sin RRR6 informada"}${p.n ? ` · ${p.n} reg.` : ""}</span></div>`).join("")}
      <div><span>Total del período</span><b>${d.rr != null ? f1(d.rr) + " mm" : "—"}</b><span>suma de agua caída del minuto</span></div></div>
    <h4 style="margin:14px 0 6px">Inconsistencias en la serie (${M.I.length})</h4>
    ${M.I.length ? `<table><tr><th>Nivel</th><th>Desde (UTC)</th><th>Hasta</th><th>Elemento</th><th>Detalle</th></tr>${M.I.map(i => `<tr class="inc" data-t="${i.t1}" style="cursor:pointer"><td><span class="pb" style="background:${i.nivel === 2 ? "#eb5757" : "#f2c94c"};color:#111">${i.nivel === 2 ? "Erróneo" : "Sospechoso"}</span></td><td>${hhmm(i.t1)}</td><td>${i.t2 !== i.t1 ? hhmm(i.t2) : ""}</td><td>${esc(NOM[i.v] || "General")}</td><td>${esc(i.msg)}</td></tr>`).join("")}</table>` : `<p style="color:#6fcf97">Sin inconsistencias en la serie.</p>`}
    <h4 style="margin:16px 0 6px">Gráfico</h4><div class="htools">${vars.filter(v => !["rr6", "rr24", "Tn12", "Tx12"].includes(v[0])).map(v => `<button data-mv="${v[0]}" ${v[0] === mVar ? 'style="border-color:var(--oro);color:var(--oro)"' : ""}>${v[1]}</button>`).join("")}</div><div id="mGraf"></div>
    <h4 style="margin:16px 0 6px">Datos minutarios</h4>
    <div style="max-height:60vh;overflow:auto;border:1px solid var(--bd);border-radius:8px"><table class="mtab"><tr><th>UTC</th><th>Local</th>${vars.map(v => `<th>${v[1]}<br><small>${v[2]}</small></th>`).join("")}</tr>
    ${M.F.map(o => `<tr id="m${o.t}"><td>${hhmm(o.t)}</td><td>${loc(o.t)}</td>${vars.map(v => { const n = (mal[o.t] || {})[v[0]]; return `<td${n ? ` style="background:${n === 2 ? "#5a1f1f" : "#4a3f12"}"` : ""}>${o[v[0]] ?? ""}</td>`; }).join("")}</tr>`).join("")}</table></div>`;
  grafico();
}
function grafico(){
  if (!M) return;
  document.querySelectorAll("#minu [data-mv]").forEach(b => b.style.cssText = b.dataset.mv === mVar ? "border-color:var(--oro);color:var(--oro)" : "");
  const v = mVar, P = M.F.filter(o => o[v] != null), W = 1100, H = 230, iz = 46, de = 12, ar = 12, ab = 26;
  if (!P.length){ $("#mGraf").innerHTML = ""; return; }
  let acum = 0; const val = o => v === "rr1m" ? (acum += o[v]) : o[v];
  const pts = P.map(o => [o.t, val(o)]), ys = pts.map(p => p[1]), y0 = Math.min(...ys), y1 = Math.max(...ys), dy = (y1 - y0) || 1;
  const X = t => iz + (W - iz - de) * (t - M.ini) / (M.fin - M.ini), Y = y => ar + (H - ar - ab) * (1 - (y - y0 + dy * .05) / (dy * 1.1));
  let path = "", ant = null; const cad = cadencia(M.F);
  pts.forEach(p => { path += (ant == null || p[0] - ant > 2 * cad ? "M" : "L") + X(p[0]).toFixed(1) + " " + Y(p[1]).toFixed(1); ant = p[0]; });
  const marcas = P.filter(o => (M.mal[o.t] || {})[v]).map(o => `<circle cx="${X(o.t).toFixed(1)}" cy="${Y(v === "rr1m" ? pts.find(p => p[0] === o.t)[1] : o[v]).toFixed(1)}" r="2.5" fill="${M.mal[o.t][v] === 2 ? "#eb5757" : "#f2c94c"}"/>`).join("");
  const ticks = []; for (let h = 0; h <= 24; h += 3) ticks.push(`<line x1="${X(M.ini + h * 3600e3)}" x2="${X(M.ini + h * 3600e3)}" y1="${ar}" y2="${H - ab}" stroke="#ffffff14"/><text x="${X(M.ini + h * 3600e3)}" y="${H - 8}" fill="#9fb0cc" font-size="11" text-anchor="middle">${hhmm(M.ini + h * 3600e3)}</text>`);
  const yt = [y0, (y0 + y1) / 2, y1].map(y => `<text x="${iz - 6}" y="${Y(y) + 4}" fill="#9fb0cc" font-size="11" text-anchor="end">${f1(y)}</text>`).join("");
  $("#mGraf").innerHTML = `<svg viewBox="0 0 ${W} ${H}" style="width:100%;background:var(--panel);border:1px solid var(--bd);border-radius:8px">${ticks.join("")}${yt}
    <path d="${path}" fill="none" stroke="#C9A54C" stroke-width="1.4"/>${marcas}<text x="${iz}" y="${ar}" fill="#9fb0cc" font-size="11">${NOM[v]}${v === "rr1m" ? " acumulada" : ""} (${UNI[v]}) · hora UTC</text></svg>`;
}
function csv(){
  if (!M) return;
  const cols = VARS.map(v => v[0]).filter(c => M.F.some(o => o[c] != null));
  const L = [["fecha_utc", "hora_local", ...cols, "inconsistencias"].join(";")].concat(M.F.map(o => [new Date(o.t).toISOString().slice(0, 16).replace("T", " "), loc(o.t),
    ...cols.map(c => o[c] == null ? "" : String(o[c]).replace(".", ",")), Object.keys(M.mal[o.t] || {}).map(k => NOM[k]).join(" / ")].join(";")));
  const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob(["﻿" + L.join("\n")], {type: "text/csv"}));
  a.download = `minutarios_${M.cod}_${M.dia}.csv`; a.click();
}
window.MINU = {init, cargar, inconsistencias, R};
})();
