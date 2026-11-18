/* Completar huecos de una variable suave (Ts, Td, humedad, presión) en los datos minutarios de un día.
   Tres métodos: interpolación lineal (huecos de hasta 3 h con valor a ambos lados), regresión con una estación vecina
   (huecos largos o sin un borde) y curva dibujada a mano con el mouse. Los valores completados NUNCA se mezclan con los
   observados: se dibujan aparte, llevan su método y solo salen en un CSV marcado «estimado». No sirve para extremas ni viento.
   Lluvia (rr1m, agua caída del minuto): solo huecos cortos y siempre como estimación. Se prolonga la intensidad de los 15 min previos
   (no se interpola: no se inventa lluvia entre dos ceros); si la RRR6 informada de la estación cierra el período, el total del hueco es
   RRR6 − lo observado y la intensidad previa solo decide cómo se reparte en el tiempo. Se muestra como acumulada. */
(function(){
const VARS_H = [["T", "Ts (temp. seca)", "°C"], ["Td", "Td (punto de rocío)", "°C"], ["HR", "Humedad", "%"], ["P_est", "QFE", "hPa"], ["P_mar", "QFF", "hPa"], ["P_std", "QNH", "hPa"], ["rr1m", "Agua caída (acumulada)", "mm"]];
const MAX_INT = 3 * 3600e3, R2_MIN = .5, COB_MIN = .8, N_MIN = 20, MAX_LL = 3600e3, VENT_LL = 15 * 60e3, TOL_RR6 = .2;
const LIM = {T: [-40, 45], Td: [-60, 35], HR: [1, 100], P_est: [450, 1080], P_mar: [900, 1080], P_std: [900, 1080], rr1m: [0, 5]};
const MINY = {T: 1, Td: 1, HR: 5, P_est: .5, P_mar: .5, P_std: .5, rr1m: .5};   // alto mínimo del eje Y (evita amplificar ruido al acercar)

/* ---------- cálculo (sin DOM) ---------- */
function rejilla(F, v, ini, lim, cad, L){          // un valor por paso de la rejilla; el minuto k cubre (ini+k·cad, ini+(k+1)·cad]
  const n = Math.max(0, Math.floor((lim - ini) / cad)), y = new Array(n).fill(null), d = new Array(n).fill(Infinity);
  for (const o of F){
    const x = o[v]; if (x == null || x < L[0] || x > L[1] || o["_p" + v]) continue;
    const k = Math.round((o.t - ini) / cad) - 1, dist = Math.abs(o.t - (ini + (k + 1) * cad));
    if (k >= 0 && k < n && dist < cad / 2 + 1 && dist < d[k]){ y[k] = x; d[k] = dist; }
  }
  return {y, n, ini, cad, t: k => ini + (k + 1) * cad};
}
function detectar(g, cerrado){                      // tramos consecutivos sin dato; el hueco final solo cuenta si el día ya terminó
  const out = []; let k = 0;
  while (k < g.n){
    if (g.y[k] != null){ k++; continue; }
    let k1 = k; while (k1 + 1 < g.n && g.y[k1 + 1] == null) k1++;
    if (k1 < g.n - 1 || cerrado) out.push({k0: k, k1, n: k1 - k + 1, izq: k > 0 ? g.y[k - 1] : null, der: k1 < g.n - 1 ? g.y[k1 + 1] : null});
    k = k1 + 1;
  }
  return out;
}
function interp(gp){
  if (gp.izq == null || gp.der == null) return null;
  const a = gp.k0 - 1, b = gp.k1 + 1, out = [];
  for (let k = gp.k0; k <= gp.k1; k++) out.push(gp.izq + (gp.der - gp.izq) * (k - a) / (b - a));
  return out;
}
function ajuste(ym, yv){                            // y = a + b·x con los pares válidos de ambas estaciones
  let n = 0, sx = 0, sy = 0, sxx = 0, sxy = 0, syy = 0;
  for (let k = 0; k < ym.length; k++) if (ym[k] != null && yv[k] != null){ const x = yv[k], y = ym[k]; n++; sx += x; sy += y; sxx += x * x; sxy += x * y; syy += y * y; }
  if (n < N_MIN) return null;
  const d = n * sxx - sx * sx, e = n * syy - sy * sy; if (d <= 1e-9 || e <= 1e-9) return null;
  const b = (n * sxy - sx * sy) / d, r = (n * sxy - sx * sy) / Math.sqrt(d * e);
  return {a: (sy - b * sx) / n, b, r2: r * r, n};
}
function regresion(gp, g, vecs){                    // la mejor vecina que cubra el hueco; se ancla a los bordes observados
  let m = null;
  for (const V of vecs){
    const f = ajuste(g.y, V.y); if (!f || f.r2 < R2_MIN) continue;
    let c = 0; for (let k = gp.k0; k <= gp.k1; k++) if (V.y[k] != null) c++;
    const cob = c / gp.n; if (cob < COB_MIN) continue;
    if (!m || cob + f.r2 > m.cob + m.f.r2) m = {V, f, cob};
  }
  if (!m) return null;
  const pr = k => m.V.y[k] == null ? null : m.f.a + m.f.b * m.V.y[k];
  const eI = gp.izq != null && pr(gp.k0 - 1) != null ? gp.izq - pr(gp.k0 - 1) : null, eD = gp.der != null && pr(gp.k1 + 1) != null ? gp.der - pr(gp.k1 + 1) : null;
  const est = [];
  for (let k = gp.k0; k <= gp.k1; k++){
    const p = pr(k); if (p == null){ est.push(null); continue; }
    const e = eI != null && eD != null ? eI + (eD - eI) * (k - (gp.k0 - 1)) / ((gp.k1 + 1) - (gp.k0 - 1)) : eI ?? eD ?? 0;
    est.push(p + e);
  }
  return {est, cod: m.V.cod, nombre: m.V.nombre, r2: m.f.r2, n: m.f.n, cob: m.cob, anclado: eI != null || eD != null};
}
function auto(gp, g, vecs){                         // elige el método; deja «ninguno» si no hay con qué estimar con seguridad
  const dur = gp.n * g.cad;
  if (gp.izq != null && gp.der != null && dur <= MAX_INT) return {met: "interpolación", est: interp(gp), det: "recta entre el valor anterior y el siguiente"};
  const r = regresion(gp, g, vecs);
  if (r) return {met: "regresión", est: r.est, det: `con ${r.nombre || r.cod} · r² ${r.r2.toFixed(2)} · ${r.n} pares${r.anclado ? " · anclada a los bordes" : ""}`};
  return {met: "ninguno", est: null, det: dur > MAX_INT && gp.izq != null && gp.der != null ? "más de 3 h y sin vecina que acompañe: dibújelo a mano" : "sin vecina parecida y sin valor a ambos lados: dibújelo a mano"};
}
/* ---------- lluvia (rr1m): estimar por intensidad previa, nunca por interpolación ---------- */
const r3 = x => Math.round(x * 1000) / 1000;
function totalRR6(gp, g, F){                        // mm que faltan para que lo observado complete la RRR6 informada del período (a, a+6 h]; null si no se puede saber
  const H6 = 6 * 3600e3, t0 = g.t(gp.k0), pe = Math.ceil(t0 / H6) * H6, ps = pe - H6;
  if (g.t(gp.k1) > pe) return null;                 // el hueco cruza el cierre del período
  const ka = Math.round((ps - g.ini) / g.cad), kb = Math.round((pe - g.ini) / g.cad) - 1;
  if (ka < 0 || kb > g.n - 1) return null;          // el período no está entero en la rejilla
  let obs = 0; for (let k = ka; k <= kb; k++){ if (k >= gp.k0 && k <= gp.k1) continue; if (g.y[k] == null) return null; obs += g.y[k]; }
  const fila = F.find(o => o.t === pe && o.rr6 != null); if (!fila) return null;
  return {total: r3(fila.rr6 - obs), rr6: fila.rr6, obs: r3(obs)};
}
function autoLluvia(gp, g, F){
  const dur = gp.n * g.cad, mx = LIM.rr1m[1], nW = Math.max(1, Math.round(VENT_LL / g.cad)), media = a => a.reduce((s, x) => s + x, 0) / a.length;
  const pre = [], pos = [];
  for (let k = gp.k0 - 1; k >= 0 && pre.length < nW; k--){ if (g.y[k] == null) break; pre.push(g.y[k]); }
  for (let k = gp.k1 + 1; k < g.n && pos.length < nW; k++){ if (g.y[k] == null) break; pos.push(g.y[k]); }
  const tasa = pre.length ? media(pre) : null, mmh = x => (x * 3600e3 / g.cad).toFixed(1), ceros = () => new Array(gp.n).fill(0);
  const A = totalRR6(gp, g, F);
  if (A){
    gp.total = Math.max(0, A.total);
    if (A.total < -TOL_RR6) return {met: "ninguno", est: null, det: `lo observado (${A.obs} mm) ya supera la RRR6 informada (${A.rr6} mm): revise la estación`};
    if (A.total <= TOL_RR6 && (tasa == null || tasa === 0)) return {met: "relleno 0", est: ceros(), det: `la RRR6 informada (${A.rr6} mm) ya queda completa con lo observado (${A.obs} mm)`, anclado: true};
    const forma = tasa > 0 ? new Array(gp.n).fill(tasa) : new Array(gp.n).fill(1);       // sin lluvia previa, se reparte parejo
    const f = gp.total / (forma.reduce((s, x) => s + x, 0) || 1), est = forma.map(x => Math.min(mx, r3(x * f)));
    return {met: "intensidad previa + RRR6", est, anclado: true, det: `faltan ${gp.total.toFixed(2)} mm para la RRR6 informada (${A.rr6} mm − ${A.obs} mm observados), repartidos con la intensidad previa${tasa > 0 ? " (" + mmh(tasa) + " mm/h)" : ""}`};
  }
  if (!pre.length) return {met: "ninguno", est: null, det: "sin datos de lluvia justo antes del hueco: dibújelo a mano"};
  if (tasa === 0){
    if (pos.length && media(pos) > 0) return {met: "ninguno", est: null, det: "no llovía antes, pero llueve después del hueco: dibújelo a mano"};
    if (dur <= MAX_INT) return {met: "relleno 0", est: ceros(), det: "sin lluvia antes ni después del hueco"};
    return {met: "ninguno", est: null, det: "más de 3 h sin dato de lluvia: dibújelo a mano"};
  }
  if (dur > MAX_LL) return {met: "ninguno", est: null, det: "más de 1 h con lluvia y sin RRR6 que cierre el total: dibújelo a mano"};
  return {met: "intensidad previa", est: new Array(gp.n).fill(Math.min(mx, r3(tasa))), det: `prolonga la intensidad de los ${Math.round(pre.length * g.cad / 60e3)} min previos (${mmh(tasa)} mm/h); es una estimación, sin valor posterior que la confirme`};
}
function manoLluvia(gp, g, est){                    // puntos de control = lluvia ACUMULADA dentro del hueco (mm), en pasos parejos
  const saltos = Math.max(1, Math.ceil(gp.n / 8)), ks = []; for (let k = gp.k0 + Math.floor(saltos / 2); k <= gp.k1; k += saltos) ks.push(k);
  if (!ks.length) ks.push(Math.floor((gp.k0 + gp.k1) / 2));
  return ks.map(k => ({k, y: est ? r3(est.slice(0, k - gp.k0 + 1).reduce((s, x) => s + (x ?? 0), 0)) : 0}));
}
function moverLluvia(gp, h, y, tope){               // sube/baja un punto de la acumulada; los vecinos se arrastran para que la curva nunca baje
  const hs = gp.hand, i = hs.indexOf(h), mx = Math.min(tope ?? Infinity, gp.total ?? Infinity);
  h.y = Math.max(0, Math.min(mx, y));
  for (let j = i + 1; j < hs.length; j++) if (hs[j].y < h.y) hs[j].y = h.y;
  for (let j = i - 1; j >= 0; j--) if (hs[j].y > h.y) hs[j].y = h.y;
}
function incLluvia(gp, hand){                       // curva acumulada por tramos (no decreciente) → mm de cada minuto
  const P = [[gp.k0 - 1, 0]]; hand.slice().sort((a, b) => a.k - b.k).forEach(h => P.push([h.k, Math.max(0, h.y)])); if (gp.total != null) P.push([gp.k1, gp.total]);
  const cum = []; let mxAcum = 0;
  for (let k = gp.k0; k <= gp.k1; k++){
    let a = null, b = null; for (const p of P){ if (p[0] <= k) a = p; if (p[0] >= k && !b) b = p; }
    let c = a && b && a[0] !== b[0] ? a[1] + (b[1] - a[1]) * (k - a[0]) / (b[0] - a[0]) : (a || b)[1];
    mxAcum = Math.max(mxAcum, c); cum.push(mxAcum);
  }
  return cum.map((c, i) => Math.min(LIM.rr1m[1], r3(Math.max(0, c - (i ? cum[i - 1] : 0)))));
}
function manoInicial(gp, g, est, L){                // puntos de control (hasta ~8 por hueco, a lo más cada ~30 min), partiendo de la curva automática (o plana desde un borde)
  if (gp.lluvia) return manoLluvia(gp, g, est);
  const paso = Math.max(1, Math.round(30 * 60e3 / g.cad)), saltos = Math.max(1, Math.min(paso, Math.ceil(gp.n / 8))), ks = [];
  for (let k = gp.k0 + Math.floor(saltos / 2); k <= gp.k1; k += saltos) ks.push(k);
  if (!ks.length) ks.push(Math.floor((gp.k0 + gp.k1) / 2));
  const base = gp.izq ?? gp.der; if (base == null && !est) return null;
  return ks.map(k => ({k, y: est && est[k - gp.k0] != null ? est[k - gp.k0] : base ?? (L[0] + L[1]) / 2}));
}
function curvaMano(gp, hand){                       // recta por tramos entre los bordes observados y los puntos de control
  if (gp.lluvia) return incLluvia(gp, hand);
  const P = []; if (gp.izq != null) P.push([gp.k0 - 1, gp.izq]); hand.forEach(h => P.push([h.k, h.y])); if (gp.der != null) P.push([gp.k1 + 1, gp.der]);
  const out = [];
  for (let k = gp.k0; k <= gp.k1; k++){
    let a = null, b = null; for (const p of P){ if (p[0] <= k) a = p; if (p[0] >= k && !b) b = p; }
    out.push(a && b && a[0] !== b[0] ? a[1] + (b[1] - a[1]) * (k - a[0]) / (b[0] - a[0]) : (a || b)[1]);
  }
  return out;
}
function analizar(F, v, ini, lim, cad, cerrado, vecF){   // vecF: [{cod, nombre, F}]
  const L = LIM[v], g = rejilla(F, v, ini, lim, cad, L);
  const vecs = vecF.map(V => Object.assign(rejilla(V.F, v, ini, lim, cad, L), {cod: V.cod, nombre: V.nombre}));
  const ll = v === "rr1m", gaps = detectar(g, cerrado).map(gp => { if (ll) gp.lluvia = true; const a = ll ? autoLluvia(gp, g, F) : auto(gp, g, vecs); return Object.assign(gp, {met: a.met, est: a.est, det: a.det, auto: a, hand: null}); });
  return {g, gaps, L};
}
const valores = gp => gp.hand && gp.tocado ? curvaMano(gp, gp.hand) : gp.est;   // lo que vale hoy en el hueco (null si nada)
const redondeo = (x, v) => v === "rr1m" ? Math.round(x * 1000) / 1000 : Math.round(x * 10) / 10;
function csv(S, v, cod, nombre, dia){
  const f = x => String(x).replace(/"/g, '""'); const L = [`# ${nombre} (${cod}) · ${dia} · ${v} · VALORES ESTIMADOS, no observados`, "t_utc,variable,valor,metodo,detalle,estimado"];
  S.gaps.forEach(gp => { const e = valores(gp); if (!e) return; e.forEach((x, i) => { if (x == null) return;
    L.push(`${new Date(S.g.t(gp.k0 + i)).toISOString().slice(0, 16).replace("T", " ")},${v},${redondeo(Math.min(S.L[1], Math.max(S.L[0], x)), v)},${gp.tocado ? "manual" : gp.met},"${f(gp.tocado ? "curva dibujada con el mouse" : gp.det)}",sí`); }); });
  return L.join("\n");
}
const API = {rejilla, detectar, interp, ajuste, regresion, auto, autoLluvia, totalRR6, incLluvia, moverLluvia, manoInicial, curvaMano, analizar, valores, csv, VARS_H, LIM, MAX_INT};
if (typeof module !== "undefined") module.exports = API;
if (typeof window === "undefined") return;

/* ---------- pantalla ---------- */
const $ = s => document.querySelector(s);
let ST = null, VAR = "T", SEL = null, TOK = 0;
const W = 1100, H = 270, iz = 58, de = 12, ar = 16, ab = 26, COL = "#C9A54C", EST = "#F2994A";

async function render(){
  const el = $("#mHue"); if (!el || !window.MINU) return;
  const mi = window.MINU, M = mi.M; if (!M) return;
  const tok = ++TOK, vars = VARS_H.filter(x => M.F.some(o => o[x[0]] != null)); if (!vars.length){ el.innerHTML = '<p style="color:var(--mu)">Sin variables para completar.</p>'; return; }
  if (!vars.some(x => x[0] === VAR)) VAR = vars[0][0];
  el.innerHTML = '<p style="color:var(--mu)">Buscando huecos y estaciones vecinas…</p>';
  const vecD = await mi.vecD(); if (tok !== TOK) return;
  const cad = mi.cadencia(M.F), lim = Math.min(M.fin, Date.now() - 50 * 60e3), cerrado = M.fin <= Date.now() - 50 * 60e3;
  ST = {M, vecD, cad, lim, cerrado, vars, porVar: {}}; SEL = null; pintar();
}
function datos(){
  if (!ST.porVar[VAR]) ST.porVar[VAR] = analizar(ST.M.F, VAR, ST.M.ini, ST.lim, ST.cad, ST.cerrado, ST.vecD.filter(D => D.F && D.F.length).map(D => ({cod: D.cod, nombre: D.nombre, F: D.F})));
  return ST.porVar[VAR];
}
function pintar(){
  const mi = window.MINU, esc = mi.esc, S = datos();
  const nOk = S.gaps.filter(gp => valores(gp)).length, pts = S.gaps.reduce((a, gp) => a + (valores(gp) ? gp.n : 0), 0);
  $("#mHue").innerHTML = `<div class="htools"><span style="color:var(--mu);font-size:12.5px">Variable:</span>${ST.vars.map(x => `<button data-hv="${x[0]}" style="${x[0] === VAR ? "border-color:var(--oro);color:var(--oro)" : ""}">${x[1]}</button>`).join("")}
    <button id="hCsv" ${nOk ? "" : "disabled"} title="Descarga solo los valores estimados, marcados como tales">Descargar estimados (CSV)</button></div>
    <p class="nota" id="hNota" style="margin:0 0 8px"></p>
    ${S.gaps.length ? `<div id="hGraf"></div><div id="hTab" style="overflow:auto;margin-top:8px"></div>` : `<p style="color:var(--mu)">No hay huecos en ${esc(mi.NOM[VAR] || VAR)} para este día.</p>`}`;
  document.querySelectorAll("#mHue [data-hv]").forEach(b => b.onclick = () => { VAR = b.dataset.hv; SEL = null; pintar(); });
  const cb = $("#hCsv"); if (cb) cb.onclick = () => { const M = ST.M, t = csv(datos(), VAR, M.cod, M.nombre, M.dia), a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob(["\ufeff" + t], {type: "text/csv"})); a.download = `estimados_${M.cod}_${M.dia}_${VAR}.csv`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000); };
  if (S.gaps.length){ tabla(); grafico(); }
}
function tabla(){                                    // la tabla se repinta sola (sin tocar el gráfico) cuando cambia un método
  const mi = window.MINU, esc = mi.esc, S = datos(); if (!$("#hTab")) return;
  const nOk = S.gaps.filter(gp => valores(gp)).length, pts = S.gaps.reduce((a, gp) => a + (valores(gp) ? gp.n : 0), 0);
  $("#hNota").innerHTML = `${S.gaps.length ? `${S.gaps.length} hueco(s) en ${esc(mi.NOM[VAR] || VAR)} · ${nOk} con valor estimado (${pts} puntos). ` : ""}Lo observado va en línea continua; lo estimado, punteado y naranja, y nunca se mezcla con los datos de la estación. Sirve para variables suaves y, en agua caída, para huecos cortos (siempre como estimación). No se completan extremas ni viento.`;
  const cb = $("#hCsv"); if (cb) cb.disabled = !nOk;
  $("#hTab").innerHTML = `<table><tr><th>Desde (UTC)</th><th>Hasta</th><th>Duración</th><th>Método</th><th>Detalle</th><th></th></tr>
    ${S.gaps.map((gp, i) => { const d = gp.n * S.g.cad / 60e3;
      return `<tr style="${SEL === i ? "background:#16264a" : ""}"><td>${mi.hhmm(S.g.t(gp.k0))}</td><td>${mi.hhmm(S.g.t(gp.k1))}</td><td>${d >= 120 ? (d / 60).toFixed(1) + " h" : Math.round(d) + " min"}</td>
      <td><b>${gp.tocado ? "manual" : esc(gp.met)}</b></td><td style="color:var(--mu)">${esc(gp.tocado ? "curva dibujada con el mouse" : gp.det)}</td>
      <td style="white-space:nowrap"><button data-hs="${i}">${SEL === i ? "Cerrar" : "Dibujar a mano"}</button>${gp.tocado ? ` <button data-hr="${i}">Volver al automático</button>` : ""}</td></tr>`; }).join("")}</table>`;
  document.querySelectorAll("#hTab [data-hs]").forEach(b => b.onclick = () => { const i = +b.dataset.hs, gp = S.gaps[i];
    if (SEL === i){ if (!gp.tocado) gp.hand = null; SEL = null; tabla(); grafico(); return; }
    const ant = SEL != null ? S.gaps[SEL] : null; if (ant && !ant.tocado) ant.hand = null;
    if (!gp.hand){ const h = manoInicial(gp, S.g, gp.est, S.L); if (!h){ b.textContent = "Sin borde de referencia"; return; } gp.hand = h; }
    SEL = i; tabla(); grafico(); });
  document.querySelectorAll("#hTab [data-hr]").forEach(b => b.onclick = () => { const gp = S.gaps[+b.dataset.hr]; gp.hand = null; gp.tocado = false; SEL = null; tabla(); grafico(); });
}
function grafico(){
  const mi = window.MINU, M = ST.M, S = datos(), g = S.g, ll = VAR === "rr1m", uni = (VARS_H.find(x => x[0] === VAR) || [])[2], sel = SEL != null ? S.gaps[SEL] : null;
  let v0 = M.ini, v1 = M.fin;                        // con un hueco elegido se acerca: el hueco más un margen a cada lado (al menos 30 min)
  if (sel){ const mg = Math.max(30 * 60e3, sel.n * g.cad); v0 = Math.max(M.ini, g.t(sel.k0) - g.cad - mg); v1 = Math.min(M.fin, g.t(sel.k1) + mg); }
  const span = Math.max(1, v1 - v0), enV = t => t >= v0 - g.cad && t <= v1 + g.cad;
  const cumul = () => {                              // lluvia acumulada del día: observado + estimado vigente de cada hueco
    const porK = new Map(); S.gaps.forEach(gp => { const e = valores(gp); for (let k = gp.k0; k <= gp.k1; k++) porK.set(k, e ? e[k - gp.k0] : null); });
    const pts = [], cumK = []; let c = 0;
    for (let k = 0; k < g.n; k++){
      if (porK.has(k)){ const x = porK.get(k); if (x != null){ c += x; pts.push({t: g.t(k), c, e: true}); } }
      else if (g.y[k] != null){ c += g.y[k]; pts.push({t: g.t(k), c, e: false}); }
      cumK.push(c);
    }
    return {pts, cumK};
  };
  const rutasLl = () => {
    const {pts} = cumul(); let sol = "", ant = null, est = "";
    pts.forEach(p => { if (p.e) return; sol += (ant == null || p.t - ant > 1.5 * g.cad ? "M" : "L") + X(p.t).toFixed(1) + " " + Y(p.c).toFixed(1); ant = p.t; });
    for (let i = 0; i < pts.length; i++){ if (!pts[i].e) continue; let j = i; while (j + 1 < pts.length && pts[j + 1].e) j++;
      const seg = pts.slice(Math.max(0, i - 1), Math.min(pts.length, j + 2)); est += seg.map((p, q) => (q ? "L" : "M") + X(p.t).toFixed(1) + " " + Y(p.c).toFixed(1)).join(""); i = j; }
    return {sol, est};
  };
  const obs = g.y.map((y, k) => y == null ? null : [g.t(k), y]).filter(Boolean);
  let base = 0, y0, y1;
  if (ll){
    const {pts, cumK} = cumul(); base = sel && sel.k0 > 0 ? cumK[sel.k0 - 1] : 0;
    const en = pts.filter(p => enV(p.t)).map(p => p.c); en.push(base); if (sel) en.push(base + (sel.total ?? 0) + (sel.total == null ? 1 : 0));
    y0 = Math.min(...en); y1 = Math.max(...en);
  } else {
    const todos = obs.filter(p => enV(p[0])).map(p => p[1]); S.gaps.forEach(gp => (valores(gp) || []).forEach((x, i) => x != null && enV(g.t(gp.k0 + i)) && todos.push(x)));
    if (sel && sel.hand) sel.hand.forEach(h => todos.push(h.y));
    y0 = Math.min(...todos); y1 = Math.max(...todos);
  }
  if (!isFinite(y0)){ y0 = 0; y1 = 1; }
  let dy = Math.max(y1 - y0, MINY[VAR] || 0) || 1; const mid = (y0 + y1) / 2; if (y1 - y0 < dy){ y0 = mid - dy / 2; y1 = mid + dy / 2; } y0 -= dy * .08; y1 += dy * .08; if (ll && y0 < 0) y0 = Math.min(0, y0 + 0);
  dy = y1 - y0;
  const X = t => iz + (W - iz - de) * (t - v0) / span, Y = y => ar + (H - ar - ab) * (1 - (y - y0) / (y1 - y0)), invY = py => y0 + (1 - (py - ar) / (H - ar - ab)) * (y1 - y0);
  let ruta = "", ant = null; if (!ll) obs.forEach(p => { if (!enV(p[0])) { ant = null; return; } ruta += (ant == null || p[0] - ant > 1.5 * g.cad ? "M" : "L") + X(p[0]).toFixed(1) + " " + Y(p[1]).toFixed(1); ant = p[0]; });
  const bandas = S.gaps.map((gp, i) => `<rect x="${X(g.t(gp.k0) - g.cad)}" y="${ar}" width="${Math.max(2, X(g.t(gp.k1)) - X(g.t(gp.k0) - g.cad))}" height="${H - ar - ab}" fill="${EST}" opacity="${SEL === i ? .22 : .1}"/>`).join("");
  const dinamica = () => {
    let estim = "";
    if (ll){ const r = rutasLl(); $("#hObs").setAttribute("d", r.sol); estim = r.est ? `<path d="${r.est}" fill="none" stroke="${EST}" stroke-width="2" stroke-dasharray="5 4"/>` : ""; }
    else estim = S.gaps.map(gp => { const e = valores(gp); if (!e) return ""; let p = "";
      if (gp.izq != null) p += "M" + X(g.t(gp.k0 - 1)).toFixed(1) + " " + Y(gp.izq).toFixed(1);
      e.forEach((x, j) => { if (x != null) p += (p ? "L" : "M") + X(g.t(gp.k0 + j)).toFixed(1) + " " + Y(Math.min(S.L[1], Math.max(S.L[0], x))).toFixed(1); });
      if (gp.der != null) p += "L" + X(g.t(gp.k1 + 1)).toFixed(1) + " " + Y(gp.der).toFixed(1);
      return `<path d="${p}" fill="none" stroke="${EST}" stroke-width="2" stroke-dasharray="5 4"/>`; }).join("");
    const manos = sel && sel.hand ? sel.hand.map(h => `<circle cx="${X(g.t(h.k))}" cy="${Y(ll ? base + h.y : h.y)}" r="6" fill="${EST}" stroke="var(--panel)" stroke-width="2" style="cursor:ns-resize"/>`).join("") : "";
    $("#hDin").innerHTML = estim + manos; };
  const ticks = [], paso = [1, 2, 5, 10, 15, 30, 60, 180].map(m => m * 60e3).find(p => span / p <= 10) || 180 * 60e3;
  for (let t = M.ini + Math.ceil((v0 - M.ini) / paso) * paso; t <= v1 && t <= M.fin; t += paso) ticks.push(`<line x1="${X(t)}" x2="${X(t)}" y1="${ar}" y2="${H - ab}" stroke="#ffffff" opacity=".07"/><text x="${X(t)}" y="${H - 8}" fill="#9fb0cc" font-size="11" text-anchor="middle">${mi.hhmm(t)}</text>`);
  const yt = [y0 + dy * .08, (y0 + y1) / 2, y1 - dy * .08].map(y => `<text x="${iz - 6}" y="${Y(y) + 4}" fill="#9fb0cc" font-size="11" text-anchor="end">${(ll ? mi.f1 && Math.abs(y1 - y0) < 3 ? y.toFixed(2) : mi.f1(y) : mi.f1(y))}</text>`).join("");
  $("#hGraf").innerHTML = `<svg viewBox="0 0 ${W} ${H}" style="width:100%;background:var(--panel);border:1px solid var(--bd);border-radius:8px;touch-action:none;user-select:none"><defs><clipPath id="hClip"><rect x="${iz}" y="${ar}" width="${W - iz - de}" height="${H - ar - ab}"/></clipPath></defs>${ticks.join("")}${yt}<g clip-path="url(#hClip)">${bandas}
    <path id="hObs" d="${ruta}" fill="none" stroke="${COL}" stroke-width="1.6"/><g id="hDin"></g></g>
    <text x="${iz}" y="${ar - 3}" fill="#9fb0cc" font-size="11">${mi.NOM[VAR] || VAR}${ll ? " acumulada" : ""} (${uni}) · hora UTC · <tspan fill="${COL}">━ observado</tspan>  <tspan fill="${EST}">╍ estimado</tspan>${sel ? `  ·  vista ampliada del hueco · ${ll ? "arrastre los puntos hacia arriba o abajo (la lluvia acumulada no puede bajar)" : "arrastre los puntos o pase el mouse con el botón apretado para dibujar la curva"}` : ""}</text>
    <rect id="hHit" x="${iz}" y="${ar}" width="${W - iz - de}" height="${H - ar - ab}" fill="transparent" style="${sel ? "cursor:crosshair" : ""}"/></svg>`;
  const svg = $("#hGraf svg"); dinamica();
  if (sel && sel.hand){
    let bajo = false;
    const mover = ev => { const r = svg.getBoundingClientRect(), px = (ev.clientX - r.left) * W / r.width, py = (ev.clientY - r.top) * H / r.height;
      const t = v0 + (px - iz) / (W - iz - de) * span, k = Math.round((t - M.ini) / g.cad) - 1;
      const kk = Math.min(sel.k1, Math.max(sel.k0, k));       // el mouse puede estar fuera de la banda: se usa el punto más cercano
      let h = sel.hand[0]; sel.hand.forEach(q => { if (Math.abs(q.k - kk) < Math.abs(h.k - kk)) h = q; });
      if (ll) moverLluvia(sel, h, invY(py) - base, y1 - base);
      else h.y = Math.min(S.L[1], Math.max(S.L[0], Math.min(y1, Math.max(y0, invY(py)))));
      const primera = !sel.tocado; sel.tocado = true; dinamica(); if (primera) tabla(); };
    svg.addEventListener("pointerdown", ev => { bajo = true; try { svg.setPointerCapture(ev.pointerId); } catch (e) {} mover(ev); });
    svg.addEventListener("pointermove", ev => { if (bajo) mover(ev); });
    svg.addEventListener("pointerup", () => { bajo = false; if (SEL != null) tabla(); });
  }
}
window.HUECOS = Object.assign({render}, API);
})();
