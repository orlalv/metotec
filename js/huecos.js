/* Completar huecos de una variable suave (Ts, Td, humedad, presión) en los datos minutarios de un día.
   Tres métodos: interpolación lineal (huecos de hasta 3 h con valor a ambos lados), regresión con una estación vecina
   (huecos largos o sin un borde) y curva dibujada a mano con el mouse. Los valores completados NUNCA se mezclan con los
   observados: se dibujan aparte, llevan su método y solo salen en un CSV marcado «estimado». No sirve para lluvia, extremas ni viento. */
(function(){
const VARS_H = [["T", "Ts (temp. seca)", "°C"], ["Td", "Td (punto de rocío)", "°C"], ["HR", "Humedad", "%"], ["P_est", "QFE", "hPa"], ["P_mar", "QFF", "hPa"], ["P_std", "QNH", "hPa"]];
const MAX_INT = 3 * 3600e3, R2_MIN = .5, COB_MIN = .8, N_MIN = 20;
const LIM = {T: [-40, 45], Td: [-60, 35], HR: [1, 100], P_est: [450, 1080], P_mar: [900, 1080], P_std: [900, 1080]};

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
function manoInicial(gp, g, est, L){                // puntos de control cada ~30 min, partiendo de la curva automática (o plana desde un borde)
  const paso = Math.max(1, Math.round(30 * 60e3 / g.cad)), saltos = Math.max(paso, Math.ceil(gp.n / 24)), ks = [];
  for (let k = gp.k0 + Math.floor(saltos / 2); k <= gp.k1; k += saltos) ks.push(k);
  if (!ks.length) ks.push(Math.floor((gp.k0 + gp.k1) / 2));
  const base = gp.izq ?? gp.der; if (base == null && !est) return null;
  return ks.map(k => ({k, y: est && est[k - gp.k0] != null ? est[k - gp.k0] : base ?? (L[0] + L[1]) / 2}));
}
function curvaMano(gp, hand){                       // recta por tramos entre los bordes observados y los puntos de control
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
  const gaps = detectar(g, cerrado).map(gp => { const a = auto(gp, g, vecs); return Object.assign(gp, {met: a.met, est: a.est, det: a.det, auto: a, hand: null}); });
  return {g, gaps, L};
}
const valores = gp => gp.hand && gp.tocado ? curvaMano(gp, gp.hand) : gp.est;   // lo que vale hoy en el hueco (null si nada)
const redondeo = (x, v) => Math.round(x * 10) / 10;
function csv(S, v, cod, nombre, dia){
  const f = x => String(x).replace(/"/g, '""'); const L = [`# ${nombre} (${cod}) · ${dia} · ${v} · VALORES ESTIMADOS, no observados`, "t_utc,variable,valor,metodo,detalle,estimado"];
  S.gaps.forEach(gp => { const e = valores(gp); if (!e) return; e.forEach((x, i) => { if (x == null) return;
    L.push(`${new Date(S.g.t(gp.k0 + i)).toISOString().slice(0, 16).replace("T", " ")},${v},${redondeo(Math.min(S.L[1], Math.max(S.L[0], x)), v)},${gp.tocado ? "manual" : gp.met},"${f(gp.tocado ? "curva dibujada con el mouse" : gp.det)}",sí`); }); });
  return L.join("\n");
}
const API = {rejilla, detectar, interp, ajuste, regresion, auto, manoInicial, curvaMano, analizar, valores, csv, VARS_H, LIM, MAX_INT};
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
  $("#hNota").innerHTML = `${S.gaps.length ? `${S.gaps.length} hueco(s) en ${esc(mi.NOM[VAR] || VAR)} · ${nOk} con valor estimado (${pts} puntos). ` : ""}Lo observado va en línea continua; lo estimado, punteado y naranja, y nunca se mezcla con los datos de la estación. Solo sirve para variables suaves: no se completan lluvia, extremas ni viento.`;
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
  const mi = window.MINU, M = ST.M, S = datos(), g = S.g, uni = (VARS_H.find(x => x[0] === VAR) || [])[2], span = M.fin - M.ini;
  const obs = g.y.map((y, k) => y == null ? null : [g.t(k), y]).filter(Boolean);
  const todos = obs.map(p => p[1]); S.gaps.forEach(gp => (valores(gp) || []).forEach(x => x != null && todos.push(x)));
  let y0 = Math.min(...todos), y1 = Math.max(...todos); const dy = (y1 - y0) || 1; y0 -= dy * .08; y1 += dy * .08;
  const X = t => iz + (W - iz - de) * (t - M.ini) / span, Y = y => ar + (H - ar - ab) * (1 - (y - y0) / (y1 - y0)), invY = py => y0 + (1 - (py - ar) / (H - ar - ab)) * (y1 - y0);
  let ruta = "", ant = null; obs.forEach(p => { ruta += (ant == null || p[0] - ant > 1.5 * g.cad ? "M" : "L") + X(p[0]).toFixed(1) + " " + Y(p[1]).toFixed(1); ant = p[0]; });
  const bandas = S.gaps.map((gp, i) => `<rect x="${X(g.t(gp.k0) - g.cad)}" y="${ar}" width="${Math.max(2, X(g.t(gp.k1)) - X(g.t(gp.k0) - g.cad))}" height="${H - ar - ab}" fill="${EST}" opacity="${SEL === i ? .22 : .1}"/>`).join("");
  const dinamica = () => { const sel = SEL != null ? S.gaps[SEL] : null;
    const estim = S.gaps.map(gp => { const e = valores(gp); if (!e) return ""; let p = "";
      if (gp.izq != null) p += "M" + X(g.t(gp.k0 - 1)).toFixed(1) + " " + Y(gp.izq).toFixed(1);
      e.forEach((x, j) => { if (x != null) p += (p ? "L" : "M") + X(g.t(gp.k0 + j)).toFixed(1) + " " + Y(Math.min(S.L[1], Math.max(S.L[0], x))).toFixed(1); });
      if (gp.der != null) p += "L" + X(g.t(gp.k1 + 1)).toFixed(1) + " " + Y(gp.der).toFixed(1);
      return `<path d="${p}" fill="none" stroke="${EST}" stroke-width="2" stroke-dasharray="5 4"/>`; }).join("");
    const manos = sel && sel.hand ? sel.hand.map(h => `<circle cx="${X(g.t(h.k))}" cy="${Y(h.y)}" r="6" fill="${EST}" stroke="var(--panel)" stroke-width="2" style="cursor:ns-resize"/>`).join("") : "";
    $("#hDin").innerHTML = estim + manos; };
  const sel = SEL != null ? S.gaps[SEL] : null;
  const ticks = []; for (let h = 0; h <= 24; h += 3){ const t = M.ini + h * 3600e3; if (t <= M.fin) ticks.push(`<line x1="${X(t)}" x2="${X(t)}" y1="${ar}" y2="${H - ab}" stroke="#ffffff" opacity=".07"/><text x="${X(t)}" y="${H - 8}" fill="#9fb0cc" font-size="11" text-anchor="middle">${mi.hhmm(t)}</text>`); }
  const yt = [y0 + dy * .08, (y0 + y1) / 2, y1 - dy * .08].map(y => `<text x="${iz - 6}" y="${Y(y) + 4}" fill="#9fb0cc" font-size="11" text-anchor="end">${mi.f1(y)}</text>`).join("");
  $("#hGraf").innerHTML = `<svg viewBox="0 0 ${W} ${H}" style="width:100%;background:var(--panel);border:1px solid var(--bd);border-radius:8px;touch-action:none;user-select:none">${ticks.join("")}${yt}${bandas}
    <path d="${ruta}" fill="none" stroke="${COL}" stroke-width="1.6"/><g id="hDin"></g>
    <text x="${iz}" y="${ar - 3}" fill="#9fb0cc" font-size="11">${mi.NOM[VAR] || VAR} (${uni}) · hora UTC · <tspan fill="${COL}">━ observado</tspan>  <tspan fill="${EST}">╍ estimado</tspan>${sel ? "  ·  arrastre los puntos o pase el mouse con el botón apretado para dibujar la curva" : ""}</text>
    <rect id="hHit" x="${iz}" y="${ar}" width="${W - iz - de}" height="${H - ar - ab}" fill="transparent" style="${sel ? "cursor:crosshair" : ""}"/></svg>`;
  const svg = $("#hGraf svg"); dinamica();
  if (sel && sel.hand){
    let bajo = false;
    const mover = ev => { const r = svg.getBoundingClientRect(), px = (ev.clientX - r.left) * W / r.width, py = (ev.clientY - r.top) * H / r.height;
      const t = M.ini + (px - iz) / (W - iz - de) * span, k = Math.round((t - M.ini) / g.cad) - 1;
      if (k < sel.k0 - 1 || k > sel.k1 + 1) return;
      let h = sel.hand[0]; sel.hand.forEach(q => { if (Math.abs(q.k - k) < Math.abs(h.k - k)) h = q; });
      h.y = Math.min(S.L[1], Math.max(S.L[0], Math.min(y1, Math.max(y0, invY(py)))));
      const primera = !sel.tocado; sel.tocado = true; dinamica(); if (primera) tabla(); };
    svg.addEventListener("pointerdown", ev => { bajo = true; try { svg.setPointerCapture(ev.pointerId); } catch (e) {} mover(ev); });
    svg.addEventListener("pointermove", ev => { if (bajo) mover(ev); });
    svg.addEventListener("pointerup", () => { bajo = false; if (SEL != null) tabla(); });
  }
}
window.HUECOS = Object.assign({render}, API);
})();
