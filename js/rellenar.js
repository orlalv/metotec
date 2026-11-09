/* Completar serie: rellenar huecos de una serie minutaria u horaria dibujando con el mouse, apoyado en estaciones vecinas.
   - Fuente: archivo de METOTEC o archivos subidos de la DMC (mismo lector que «Datos minutarios»).
   - Propuesta automática: regresión con cada vecina (Tuya = a + b·Vecina, ajustada con los datos válidos del mismo día),
     combinadas según su correlación y empalmadas con los bordes de cada hueco. Sin vecinas: interpolación lineal.
   - El usuario dibuja sobre los huecos (el trazo se suaviza y se empalma con los bordes) y puede quitar tramos dudosos.
   - Solo variables continuas: Ts, Td, HR, QFE, QFF, QNH. El dato original nunca se modifica: se exporta aparte con bandera E. */
(function(){
const $ = s => document.querySelector(s);
const VARS_OK = [["T", "Ts (temp. seca)", "°C"], ["Td", "Td (punto de rocío)", "°C"], ["HR", "HR (humedad)", "%"], ["P_est", "QFE", "hPa"], ["P_mar", "QFF", "hPa"], ["P_std", "QNH", "hPa"]];
const NOMV = Object.fromEntries(VARS_OK.map(v => [v[0], v[1]])), UNIV = Object.fromEntries(VARS_OK.map(v => [v[0], v[2]]));
const COLS = ["#56CCF2", "#EB5757", "#9B8AFB", "#6FCF97"];
let S = null;            // estado: {D, refs[], v, step, grid[], obs Map, malos Set, dib Map, prop Map, deshacer[]}
let modo = "dib", vSel = "T";

const M = () => window.MINU;
const f1 = v => v == null || isNaN(v) ? "—" : (Math.round(v * 10) / 10).toFixed(1);
const hhmm = t => new Date(t).toISOString().slice(11, 16);

function init(){
  const s = $("#rell"); if (s.dataset.ok) return; s.dataset.ok = 1;
  const hoy = new Date(Date.now() - (new Date().getUTCHours() < 6 ? 864e5 : 0)).toISOString().slice(0, 10);
  s.innerHTML = `<div class="htools"><button id="rVolver" style="border-color:var(--oro);color:var(--oro)">← Volver al mapa</button>
    <input id="rEst" list="rLista" placeholder="Estación (nombre o código)" style="min-width:280px"><datalist id="rLista"></datalist>
    <input type="date" id="rDia" value="${hoy}">
    <select id="rVar">${VARS_OK.map(v => `<option value="${v[0]}">${v[1]}</option>`).join("")}</select>
    <button id="rVer" style="border-color:var(--oro);color:var(--oro)">Cargar</button>
    <button id="rAnt" title="Problema anterior de la serie" hidden>◀ Anterior</button><button id="rSig" title="Siguiente problema de la serie" hidden>Siguiente ▶</button>
    <label style="cursor:pointer;background:var(--panel);border:1px dashed var(--oro);color:var(--oro);border-radius:8px;padding:6px 10px;font:600 13px inherit">⬆ Subir archivos de la DMC (ZIP o CSV)<input type="file" id="rArch" multiple accept=".zip,.csv,.txt" hidden></label></div>
    <div id="rSubInfo" style="margin:-2px 0 8px;overflow-x:auto"></div><div id="rRev"></div>
    <p class="nota" style="margin:0 0 10px">Para huecos de temperatura, humedad o presión. Dibuje con el mouse sobre las zonas sombreadas: el trazo se suaviza y se empalma con los datos válidos a cada lado. Las vecinas aparecen corridas por su relación con la estación (regresión con los datos del mismo día), como guía. El dato original no se modifica: lo estimado se descarga aparte con bandera <b>E</b>.</p>
    <div id="rOut"></div>`;
  M().estaciones().then(E => { $("#rLista").innerHTML = E.map(e => `<option value="${e.codigo} · ${M().esc(e.nombre)}">`).join(""); });
  $("#rVolver").addEventListener("click", () => document.querySelector('.modos button[data-m="ema"]').click());
  $("#rVer").addEventListener("click", cargar); $("#rEst").addEventListener("change", cargar); $("#rDia").addEventListener("change", cargar);
  $("#rVar").addEventListener("change", () => { vSel = $("#rVar").value; revisar(); if (S) preparar(S.D, S.refs); });
  $("#rEst").addEventListener("change", revisar);
  $("#rAnt").addEventListener("click", () => saltar(-1)); $("#rSig").addEventListener("click", () => saltar(1));
  $("#rArch").addEventListener("change", async ev => { const fs = [...ev.target.files]; ev.target.value = ""; if (!fs.length) return;
    $("#rSubInfo").innerHTML = `<span style="color:var(--mu)">Leyendo ${fs.length} archivo(s)…</span>`;
    await M().leerArchivos(fs); M().pintarSub("#rSubInfo");
    const a = M().fechaArchivo(); if (a){ const c = a.cods[0], e = M().EST.find(x => x.codigo === c);
      if (!$("#rEst").value.trim() || !M().SUB.has(M().buscarCod($("#rEst").value))) $("#rEst").value = c + (e ? " · " + e.nombre : "");
      const t = Date.parse($("#rDia").value + "T12:00Z"); if (!(t >= a.t0 && t <= a.t1)) $("#rDia").value = new Date(a.t0 + 432e5).toISOString().slice(0, 10);
      revisar(); const E0 = REV && REV.eps[0]; if (E0) ir(0); else cargar(); } });
  s.addEventListener("click", ev => {
    const b = ev.target.closest("[data-rm]"); if (b){ modo = b.dataset.rm; pintarBotones(); return; }
    const a = ev.target.closest("[data-ra]"); if (!a || !S) return;
    const k = a.dataset.ra;
    if (k === "deshacer" && S.deshacer.length){ const u = S.deshacer.pop(); S.dib = u.dib; S.malos = u.malos; recalcular(); }
    if (k === "borrar"){ guardarDeshacer(); S.dib = new Map(); recalcular(); }
    if (k === "propuesta"){ guardarDeshacer(); S.dib = new Map([...S.prop].filter(([t]) => !valido(t))); recalcular(); }
    if (k === "csvh") csv(true); if (k === "csvm") csv(false);
    const ie = ev.target.closest("[data-ie]"); if (ie){ ir(+ie.dataset.ie); return; }
    const id = ev.target.closest("[data-id]"); if (id){ REV.i = -1; FOCO = null; S && (S.foco = null); $("#rDia").value = id.dataset.id; cargar(); return; }
    const ft = ev.target.closest("[data-ft]"); if (ft){ REV.filtro = ft.dataset.ft === REV.filtro ? "" : ft.dataset.ft; pintarRev(); return; }
    const rq = ev.target.closest("[data-rq]"); if (rq){ S.refs = S.refs.filter(r => r.cod !== rq.dataset.rq); preparar(S.D, S.refs); }
  });
  s.addEventListener("change", async ev => {
    if (ev.target.id === "rAgr" && S){ const c = M().buscarCod(ev.target.value); ev.target.value = "";
      if (c && c !== S.D.cod && !S.refs.some(r => r.cod === c)){ const D = await cargarUna(c); S.refs.push(D); preparar(S.D, S.refs); } }
  });
}

async function cargarUna(cod){
  const D = await M().cargar(cod, $("#rDia").value, false), e = M().EST.find(x => x.codigo === cod) || {};
  D.nombre = e.nombre || cod; D.alt = e.alt ?? null; D.lat = e.lat; D.lon = e.lon; return D;
}
async function cargar(){
  await M().estaciones();
  const cod = M().buscarCod($("#rEst").value);
  if (!cod){ $("#rOut").innerHTML = `<p style="color:var(--mu)">Escriba el código, el nombre o el OACI de la estación, o suba archivos.</p>`; return; }
  $("#rOut").innerHTML = `<p style="color:var(--mu)">Cargando la estación y sus vecinas…</p>`;
  if (REV && REV.cod !== cod) revisar(); else if (REV) pintarRev();
  const D = await cargarUna(cod), yo = M().EST.find(e => e.codigo === cod);
  if (M().SUB.has(cod) && !D.F.some(o => o[vSel] != null)){
    const hay = VARS_OK.filter(v => D.F.some(o => o[v[0]] != null)).map(v => v[1]);
    $("#rOut").innerHTML = `<p style="color:#f2c94c">Los archivos subidos de esta estación no traen ${NOMV[vSel]} para el ${$("#rDia").value}. ${hay.length ? "Ese día sí traen: " + hay.join(", ") + ". Cámbielo en el selector de variable." : "Esta herramienta completa Ts, Td, HR y presiones: suba los archivos <b>Temperatura</b> o <b>PresionHumedad</b> (el de agua caída no sirve aquí)."}</p>`; return; }
  const vec = yo && yo.lat != null ? M().EST.filter(e => e.codigo !== cod && e.lat != null).map(e => ({c: e.codigo, d: M().km(yo, e)})).filter(x => x.d <= 60).sort((a, b) => a.d - b.d).slice(0, 4) : [];
  const Rs = (await Promise.all(vec.map(x => cargarUna(x.c)))).filter(R => R.F.length);
  preparar(D, Rs.slice(0, 2));
}

/* ---------- revisión de toda la serie subida: lleva a cada problema ---------- */
// Recorre todo el período de los archivos subidos (no solo un día) y arma la lista de problemas de la variable elegida:
// huecos (> 5 min), valores fuera de rango, picos aislados y valores pegados. «Anterior/Siguiente» y la lista llevan a cada uno.
let REV = null, FOCO = null;
const PICO_U = {T: 3, Td: 4, HR: 15, P_est: 2, P_mar: 2, P_std: 2}, PEGADO = {T: 2, Td: 3, HR: 3, P_est: 4, P_mar: 4, P_std: 4};   // h
const TIPOS = {hueco: ["Hueco", "#8aa0c8"], rango: ["Fuera de rango", "#eb5757"], pico: ["Pico aislado", "#F2994A"], pegado: ["Valor pegado", "#f2c94c"]};
const diaUTC = t => new Date(t).toISOString().slice(0, 10);
const durTxt = ms => { const m = Math.round(ms / 60e3); return m >= 1440 ? `${Math.floor(m / 1440)} d ${Math.floor(m % 1440 / 60)} h` : m >= 60 ? `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ""}` : `${m} min`; };
function revisar(){
  const cod = M().buscarCod($("#rEst").value), m = cod && M().SUB.get(cod), v = vSel;
  REV = null; $("#rAnt").hidden = $("#rSig").hidden = true;
  if (!m){ $("#rRev").innerHTML = ""; return; }
  const F = [...m.values()].filter(o => v in o).sort((a, b) => a.t - b.t);
  if (!F.length){ const hay = VARS_OK.filter(x => [...m.values()].some(o => o[x[0]] != null)).map(x => x[1]);
    $("#rRev").innerHTML = `<p class="nota" style="color:#f2c94c">Los archivos subidos no traen ${NOMV[v]}. ${hay.length ? "Traen: " + hay.join(", ") + "." : "Para completar series suba los archivos <b>Temperatura</b> o <b>PresionHumedad</b>."}</p>`; return; }
  const step = M().cadencia(F), L = M().VAL[v] || [-Infinity, Infinity], t0 = F[0].t, t1 = F[F.length - 1].t;
  const val = new Map(F.map(o => [o.t, o[v]])), eps = [];
  const malo = new Map();                 // t → tipo
  const buenos = F.filter(o => o[v] != null && o[v] >= L[0] && o[v] <= L[1]);
  F.forEach(o => { if (o[v] != null && !(o[v] >= L[0] && o[v] <= L[1])) malo.set(o.t, "rango"); });
  const U = PICO_U[v] || 3;
  buenos.forEach((o, i) => { const w = buenos.slice(Math.max(0, i - 5), i).concat(buenos.slice(i + 1, i + 6)).filter(q => Math.abs(q.t - o.t) <= 20 * 60e3).map(q => q[v]).sort((a, b) => a - b);
    if (w.length >= 2 && Math.abs(o[v] - w[Math.floor(w.length / 2)]) > U) malo.set(o.t, "pico"); });
  // valores pegados: el mismo valor repetido durante más de PEGADO[v] horas
  let ia = 0;
  for (let i = 1; i <= buenos.length; i++){
    if (i < buenos.length && buenos[i][v] === buenos[ia][v] && buenos[i].t - buenos[i - 1].t <= 30 * 60e3) continue;
    const a = buenos[ia].t, b = buenos[i - 1].t;
    if (b - a >= (PEGADO[v] || 3) * 3600e3) eps.push({tipo: "pegado", a, b, det: `${M().f1(buenos[ia][v])} ${UNIV[v]} sin cambio`});
    ia = i;
  }
  // recorrido por la grilla: huecos (sin registro o vacío), picos y fuera de rango, agrupados en episodios
  let cur = null; const n = {}, tot = {}, dias = {};
  const cerrar = () => { if (!cur) return; const largo = cur.b - cur.a + step;
    if (cur.tipo !== "hueco" || largo > Math.max(step, 5 * 60e3)) eps.push({tipo: cur.tipo, a: cur.a, b: cur.b,
      det: cur.tipo === "hueco" ? `${durTxt(largo)} sin dato` : cur.tipo === "rango" ? `valor ${M().f1(cur.x)} ${UNIV[v]}` : `${M().f1(cur.x)} ${UNIV[v]}`}); cur = null; };
  for (let t = t0; t <= t1; t += step){
    const x = val.get(t), d = diaUTC(t), tipo = x == null ? "hueco" : malo.get(t) || null;
    dias[d] = dias[d] || {n: 0, ok: 0}; dias[d].n++; if (!tipo) dias[d].ok++;
    if (tipo && cur && cur.tipo === tipo && t - cur.b <= step * (tipo === "pico" ? 3 : 1)){ cur.b = t; continue; }
    cerrar(); if (tipo) cur = {tipo, a: t, b: t, x};
  }
  cerrar();
  eps.sort((p, q) => p.a - q.a);
  eps.forEach(e => { const d = diaUTC(e.a); dias[d] && (dias[d].p = (dias[d].p || 0) + 1); });
  REV = {cod, v, step, t0, t1, eps, dias, i: -1, filtro: ""};
  pintarRev();
}
function visibles(){ return REV.eps.map((e, i) => [e, i]).filter(([e]) => !REV.filtro || e.tipo === REV.filtro); }
function pintarRev(){
  const R = REV, cnt = {}; R.eps.forEach(e => cnt[e.tipo] = (cnt[e.tipo] || 0) + 1);
  $("#rAnt").hidden = $("#rSig").hidden = !R.eps.length;
  const dd = Object.entries(R.dias), col = x => x.ok === x.n ? "#2f7d57" : x.ok / x.n > .9 ? "#9a8a2e" : x.ok / x.n > .5 ? "#b8642a" : "#a33a3a";
  const actual = $("#rDia").value, V = visibles(), MAX = 400;
  $("#rRev").innerHTML = `<details class="mblo" open><summary>Revisión de toda la serie · ${NOMV[R.v]} · ${diaUTC(R.t0)} a ${diaUTC(R.t1)} · ${R.eps.length ? `${R.eps.length} problemas` : "sin problemas"}</summary><div class="mcont">
    <div class="rdias">${dd.map(([d, x]) => `<button data-id="${d}" class="${d === actual ? "on" : ""}" title="${d}: ${Math.round(100 * x.ok / x.n)} % válido${x.p ? ` · ${x.p} problema(s)` : ""}" style="background:${col(x)}">${+d.slice(8)}${x.p ? "<i></i>" : ""}</button>`).join("")}</div>
    <p class="nota" style="margin:4px 0 8px">Cada cuadro es un día UTC (verde completo · amarillo &gt; 90 % · naranjo &gt; 50 % · rojo menos). Clic en un día o en un problema para abrirlo; el tramo queda marcado en el gráfico. También puede usar ◀ Anterior / Siguiente ▶.</p>
    ${R.eps.length ? `<div class="htools">${Object.entries(TIPOS).filter(([k]) => cnt[k]).map(([k, [nom, c]]) => `<button data-ft="${k}" class="${R.filtro === k ? "on" : ""}" style="border-color:${c}">${nom}: ${cnt[k]}</button>`).join("")}${R.filtro ? `<span style="color:var(--mu);font-size:12.5px">(clic de nuevo para ver todos)</span>` : ""}</div>
    <div style="max-height:260px;overflow:auto"><table class="mtab rlista"><tr><th>Día</th><th>Desde (UTC)</th><th>Hasta</th><th>Duración</th><th>Problema</th><th>Detalle</th></tr>
    ${V.slice(0, MAX).map(([e, i]) => `<tr data-ie="${i}" class="inc${i === R.i ? " vis" : ""}" style="cursor:pointer"><td>${diaUTC(e.a)}</td><td>${hhmm(e.a)}</td><td>${diaUTC(e.b) === diaUTC(e.a) ? "" : diaUTC(e.b).slice(5) + " "}${hhmm(e.b)}</td><td>${durTxt(e.b - e.a + R.step)}</td>
      <td><span style="color:${TIPOS[e.tipo][1]};font-weight:700">● ${TIPOS[e.tipo][0]}</span></td><td>${M().esc(e.det)}</td></tr>`).join("")}</table>
    ${V.length > MAX ? `<p class="nota">Se muestran los primeros ${MAX} de ${V.length}.</p>` : ""}</div>` : `<p style="color:#6fcf97;margin:0">La serie completa no tiene huecos de más de 5 min, valores fuera de rango, picos ni valores pegados.</p>`}
  </div></details>`;
}
function ir(i){
  const e = REV && REV.eps[i]; if (!e) return;
  REV.i = i; FOCO = [e.a, e.b]; if (S) S.foco = FOCO;
  const d = diaUTC(e.a);
  if (S && S.D.cod === REV.cod && S.D.dia === d && $("#rDia").value === d){ pintarRev(); pintar(); }
  else { $("#rDia").value = d; pintarRev(); cargar(); }
  const fila = document.querySelector(`#rRev tr[data-ie="${i}"]`); fila && fila.scrollIntoView({block: "nearest"});
}
function saltar(dir){
  if (!REV || !REV.eps.length) return;
  const V = visibles().map(x => x[1]); if (!V.length) return;
  let k = V.indexOf(REV.i);
  if (k < 0){ const d = $("#rDia").value; let j = V.findIndex(i => diaUTC(REV.eps[i].a) >= d); if (j < 0) j = V.length; k = dir > 0 ? j - 1 : j; }
  k = Math.max(0, Math.min(V.length - 1, k + dir)); ir(V[k]);
}

/* ---------- cálculo ---------- */
function valido(t){ return S.obs.has(t) && !S.malos.has(t); }
function preparar(D, refs){
  const v = vSel, L = M().VAL[v] || [-Infinity, Infinity];
  const ok = o => o[v] != null && o[v] >= L[0] && o[v] <= L[1] && !o["_p" + v];
  const step = M().cadencia(D.F) || 60e3, fin = Math.min(D.fin, Math.floor((Date.now() - 50 * 60e3) / step) * step);
  const grid = []; for (let t = D.ini + step; t <= fin; t += step) grid.push(t);
  const obs = new Map(D.F.filter(ok).map(o => [o.t, o[v]]));
  const R = refs.map(r => { const m = new Map(r.F.filter(ok).map(o => [o.t, o[v]]));
    // a cada minuto de la grilla, el valor de la vecina (interpolado si su cadencia es más gruesa)
    const ts = [...m.keys()].sort((a, b) => a - b), val = t => { if (m.has(t)) return m.get(t); let i = ts.findIndex(x => x > t); if (i <= 0) return null;
      const a = ts[i - 1], b = ts[i]; return b - a > 30 * 60e3 ? null : m.get(a) + (m.get(b) - m.get(a)) * (t - a) / (b - a); };
    const serie = new Map(grid.map(t => [t, val(t)]).filter(x => x[1] != null));
    // regresión Tuya = a + b·Vecina con los minutos en que ambas son válidas
    const pares = grid.filter(t => obs.has(t) && serie.has(t)).map(t => [serie.get(t), obs.get(t)]);
    let a = 0, b = 1, rr = 0;
    if (pares.length >= 30){
      const n = pares.length, mx = pares.reduce((s, p) => s + p[0], 0) / n, my = pares.reduce((s, p) => s + p[1], 0) / n;
      const sxx = pares.reduce((s, p) => s + (p[0] - mx) ** 2, 0), syy = pares.reduce((s, p) => s + (p[1] - my) ** 2, 0), sxy = pares.reduce((s, p) => s + (p[0] - mx) * (p[1] - my), 0);
      rr = sxx && syy ? sxy / Math.sqrt(sxx * syy) : 0;
      b = sxx ? sxy / sxx : 1; if (!(b > .5 && b < 1.5)) b = 1;      // pendiente razonable; si no, solo la diferencia media
      a = my - b * mx;
    }
    return {D: r, serie, a, b, r: rr, n: pares.length};
  });
  S = {D, refs, R, v, step, grid, obs, malos: S && S.D === D && S.v === v ? S.malos : new Set(), dib: S && S.D === D && S.v === v ? S.dib : new Map(), prop: new Map(), deshacer: [], foco: FOCO};
  recalcular();
}
function huecos(){
  const H = []; let a = null;
  S.grid.forEach((t, i) => { if (!valido(t)){ if (a == null) a = t; } else if (a != null){ H.push([a, S.grid[i - 1]]); a = null; } });
  if (a != null) H.push([a, S.grid[S.grid.length - 1]]);
  return H;
}
function propuesta(){
  const P = new Map(), Rok = S.R.filter(x => x.n >= 30 && x.r > .5);
  const base = t => { let s = 0, w = 0; Rok.forEach(x => { const y = x.serie.get(t); if (y != null){ const p = x.r * x.r; s += p * (x.a + x.b * y); w += p; } }); return w ? s / w : null; };
  huecos().forEach(([a, b]) => {
    const i0 = S.grid.indexOf(a), i1 = S.grid.indexOf(b), tA = S.grid[i0 - 1], tB = S.grid[i1 + 1];
    const yA = tA != null && valido(tA) ? S.obs.get(tA) : null, yB = tB != null && valido(tB) ? S.obs.get(tB) : null;
    const bA = tA != null ? base(tA) : null, bB = tB != null ? base(tB) : null;
    const oA = yA != null && bA != null ? yA - bA : null, oB = yB != null && bB != null ? yB - bB : null;
    for (let i = i0; i <= i1; i++){
      const t = S.grid[i], w = (i - i0 + 1) / (i1 - i0 + 2), bt = base(t);
      let y = null;
      if (bt != null) y = bt + (oA != null && oB != null ? oA * (1 - w) + oB * w : oA ?? oB ?? 0);
      else if (yA != null && yB != null) y = yA + (yB - yA) * w;          // sin vecinas: interpolación lineal
      if (y != null) P.set(t, y);
    }
  });
  return P;
}
const CORTO = () => Math.max(S.step, 5 * 60e3);         // huecos de hasta 5 min (o 1 dato) se interpolan solos
function cortos(){
  const A = new Map();
  huecos().filter(([a, b]) => b - a + S.step <= CORTO()).forEach(([a, b]) => {
    const i0 = S.grid.indexOf(a), i1 = S.grid.indexOf(b), tA = S.grid[i0 - 1], tB = S.grid[i1 + 1];
    if (tA == null || tB == null || !valido(tA) || !valido(tB)) return;
    for (let i = i0; i <= i1; i++){ const w = (i - i0 + 1) / (i1 - i0 + 2); A.set(S.grid[i], S.obs.get(tA) * (1 - w) + S.obs.get(tB) * w); }
  });
  return A;
}
function recalcular(){ S.prop = propuesta(); S.auto = cortos(); pintar(); }
function guardarDeshacer(){ S.deshacer.push({dib: new Map(S.dib), malos: new Set(S.malos)}); if (S.deshacer.length > 30) S.deshacer.shift(); }
function finalEn(t){ return valido(t) ? S.obs.get(t) : S.dib.has(t) ? S.dib.get(t) : S.auto.has(t) ? S.auto.get(t) : null; }

/* aplica un trazo: interpola entre los puntos, solo en minutos sin dato válido, suaviza y empalma con los bordes */
function aplicarTrazo(pts){
  if (pts.length < 2) return;
  pts.sort((a, b) => a[0] - b[0]);
  const t0 = pts[0][0], t1 = pts[pts.length - 1][0], nuevos = new Map();
  S.grid.filter(t => t >= t0 - S.step && t <= t1 + S.step && !valido(t)).forEach(t => {
    let i = pts.findIndex(p => p[0] >= t); if (i < 0) i = pts.length - 1; if (i === 0) i = 1;
    const [xa, ya] = pts[i - 1], [xb, yb] = pts[i]; nuevos.set(t, xb === xa ? yb : ya + (yb - ya) * Math.max(0, Math.min(1, (t - xa) / (xb - xa))));
  });
  if (!nuevos.size) return;
  guardarDeshacer();
  nuevos.forEach((y, t) => S.dib.set(t, y));
  // suavizado (media móvil de ~9 pasos) y empalme con los bordes de cada hueco
  huecos().forEach(([a, b]) => {
    const ts = S.grid.filter(t => t >= a && t <= b && S.dib.has(t)); if (!ts.length) return;
    const k = Math.max(1, Math.round(4 * 60e3 / S.step)), ys = ts.map(t => S.dib.get(t));
    const sm = ys.map((_, i) => { const w = ys.slice(Math.max(0, i - k), i + k + 1); return w.reduce((s, x) => s + x, 0) / w.length; });
    const iA = S.grid.indexOf(ts[0]) - 1, iB = S.grid.indexOf(ts[ts.length - 1]) + 1;
    const yA = iA >= 0 && valido(S.grid[iA]) ? S.obs.get(S.grid[iA]) : null, yB = iB < S.grid.length && valido(S.grid[iB]) ? S.obs.get(S.grid[iB]) : null;
    const dA = yA != null ? yA - sm[0] : 0, dB = yB != null ? yB - sm[sm.length - 1] : 0, n = sm.length, z = Math.max(1, Math.round(n * .25));
    ts.forEach((t, i) => { let y = sm[i];
      if (i < z) y += dA * (1 - i / z); if (n - 1 - i < z) y += dB * (1 - (n - 1 - i) / z);
      S.dib.set(t, y); });
  });
  recalcular();
}

/* ---------- pantalla ---------- */
function pintarBotones(){ document.querySelectorAll("#rell [data-rm]").forEach(b => b.classList.toggle("on", b.dataset.rm === modo)); const g = $("#rG"); if (g) g.style.cursor = modo === "dib" ? "crosshair" : "col-resize"; }
function pintar(){
  const D = S.D, Htodos = huecos(), H = Htodos.filter(([a, b]) => b - a + S.step > CORTO()), sinDato = Htodos.reduce((s, [a, b]) => s + (b - a) / S.step + 1, 0), largo = H.reduce((m, [a, b]) => Math.max(m, b - a + S.step), 0);
  const horasEst = S.grid.filter(t => t % 3600e3 === 0 && !valido(t) && !S.auto.has(t)).length, conDib = [...S.dib.keys()].filter(t => !valido(t) && !S.auto.has(t)).length + S.auto.size;
  const mejor = S.R.reduce((m, x) => Math.max(m, x.r), 0);
  const apto = !H.length ? ["Sin huecos", "#6fcf97", "la serie está completa"] : largo > 10 * 3600e3 ? ["No recomendado", "#eb5757", "hueco de más de 10 h"]
    : mejor < .7 && largo > 3 * 3600e3 ? ["Con cuidado", "#f2c94c", "vecinas poco parecidas y hueco de más de 3 h"] : ["Apto", "#6fcf97", `vecinas con r = ${mejor.toFixed(2).replace(".", ",")}`];
  const dur = ms => { const m = Math.round(ms / 60e3); return m >= 60 ? `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ""}` : `${m} min`; };
  $("#rOut").innerHTML = `<h3 style="margin:4px 0 10px">${M().esc(D.nombre)} <small style="color:var(--mu)">${D.cod} · ${D.dia} (día UTC) · ${NOMV[S.v]} · datos cada ${S.step / 60e3} min · fuente: ${D.origen}</small></h3>
    <div class="hres"><div><b>${H.length}</b><span>huecos de más de ${CORTO() / 60e3} min${Htodos.length > H.length ? ` (+${Htodos.length - H.length} cortos, interpolados solos)` : ""}</span></div><div><b>${dur(sinDato * S.step)}</b><span>sin dato válido · ${Math.round(100 * sinDato / Math.max(1, S.grid.length))} % del período</span></div>
      <div><b>${horasEst}</b><span>horas (HH:00) sin dato</span></div><div><b>${dur(largo)}</b><span>hueco más largo</span></div>
      <div><b style="color:${apto[1]}">${apto[0]}</b><span>${apto[2]}</span></div><div><b>${Math.round(100 * conDib / Math.max(1, sinDato))} %</b><span>de los huecos ya dibujado</span></div></div>
    <div class="htools"><span style="color:var(--mu);font-size:13px">Referencias:</span>
      ${S.R.map((x, i) => `<span style="border:1px solid ${COLS[i]};color:${COLS[i]};border-radius:8px;padding:5px 9px;font:600 12.5px inherit">● ${M().esc(x.D.nombre)} · ${x.n >= 30 ? `${x.b === 1 ? "" : x.b.toFixed(2).replace(".", ",") + "×"}${x.a >= 0 ? "+" : ""}${f1(x.a)} · r ${x.r.toFixed(2).replace(".", ",")}` : "pocos datos en común"} <button data-rq="${x.D.cod}" style="background:none;border:0;color:var(--mu);cursor:pointer;padding:0 0 0 4px">✕</button></span>`).join("")}
      <input id="rAgr" list="rLista" placeholder="+ Agregar referencia…" style="min-width:200px"></div>
    <div class="htools"><button data-rm="dib">✎ Dibujar</button><button data-rm="quitar">✂ Marcar tramo dudoso</button><button data-ra="propuesta">⚙ Usar la propuesta en todos los huecos</button>
      <button data-ra="deshacer">↶ Deshacer</button><button data-ra="borrar">Borrar trazos</button><button data-ra="csvh" style="border-color:#6fcf97;color:#6fcf97">⬇ CSV horario</button><button data-ra="csvm" style="border-color:#6fcf97;color:#6fcf97">⬇ CSV minutario</button></div>
    <div class="rcols"><details class="mblo" open><summary>Gráfico · ${modo === "dib" ? "dibuje sobre las zonas sombreadas" : "arrastre para marcar un tramo dudoso"}</summary><div class="mcont">
      <div class="ley"><span><i style="border-color:#C9A54C"></i>observado válido</span>${S.R.map((x, i) => `<span><i style="border-color:${COLS[i]};border-top-style:dashed"></i>${M().esc(x.D.nombre)} ajustada</span>`).join("")}
      <span><i style="border-color:#6fcf97;border-top-style:dotted"></i>propuesta</span><span><i style="border-color:#fff"></i>su trazo</span><span><b style="color:#f2c94c">◆</b> hora estimada</span><span><b style="color:#eb5757">×</b> tramo marcado dudoso</span></div>
      <div style="position:relative"><svg id="rG" viewBox="0 0 1100 400" style="width:100%;touch-action:none;user-select:none;background:var(--panel);border:1px solid var(--bd);border-radius:8px"></svg><div id="rTip" class="rtip" hidden></div></div></div></details>
    <details class="mblo" open><summary>Valores horarios</summary><div class="mcont" id="rTab"></div></details></div>`;
  pintarBotones(); grafico(); tabla(); eventosGrafico();
}
let G = null;
function grafico(){
  const W = 1100, Hh = 400, iz = 46, de = 12, ar = 16, ab = 26, D = S.D;
  const ys = [...S.obs.values(), ...S.dib.values(), ...S.prop.values(), ...S.R.flatMap(x => x.n >= 30 ? [...x.serie.values()].map(y => x.a + x.b * y) : [])].filter(y => y != null && isFinite(y));
  if (!ys.length){ $("#rG").innerHTML = `<text x="550" y="200" fill="#9fb0cc" text-anchor="middle">Sin datos de ${NOMV[S.v]}</text>`; return; }
  ys.sort((a, b) => a - b); const y0 = ys[Math.floor(ys.length * .002)] - .3, y1 = ys[Math.ceil(ys.length * .998) - 1] + .3;
  const X = t => iz + (W - iz - de) * (t - D.ini) / (D.fin - D.ini), Y = y => ar + (Hh - ar - ab) * (1 - (y - y0) / (y1 - y0));
  G = {X, Y, iz, de, ar, ab, W, Hh, y0, y1, ini: D.ini, fin: D.fin};
  const linea = (pares, col, w, dash, op) => { let p = "", ant = null; pares.forEach(([t, y]) => { if (y == null){ ant = null; return; } p += (ant != null && t - ant <= 2 * S.step ? "L" : "M") + X(t).toFixed(1) + " " + Y(y).toFixed(1); ant = t; });
    return `<path d="${p}" fill="none" stroke="${col}" stroke-width="${w}" ${dash ? `stroke-dasharray="${dash}"` : ""} opacity="${op || 1}" stroke-linejoin="round"/>`; };
  let svg = "";
  huecos().forEach(([a, b]) => svg += `<rect x="${X(a - S.step / 2)}" y="${ar}" width="${Math.max(2, X(b + S.step / 2) - X(a - S.step / 2))}" height="${Hh - ar - ab}" fill="#8aa0c8" opacity=".13"/>`);
  if (S.foco){ const a = Math.max(D.ini, S.foco[0] - S.step / 2), b = Math.min(D.fin, S.foco[1] + S.step / 2);
    if (b >= a) svg += `<rect x="${X(a) - 3}" y="${ar - 2}" width="${Math.max(6, X(b) - X(a) + 6)}" height="${Hh - ar - ab + 4}" fill="none" stroke="#F2994A" stroke-width="2" stroke-dasharray="5 3" rx="3"/>`; }
  for (let h = 0; h <= 24; h += 3){ const t = D.ini + h * 3600e3; svg += `<line x1="${X(t)}" x2="${X(t)}" y1="${ar}" y2="${Hh - ab}" stroke="#ffffff14"/><text x="${X(t)}" y="${Hh - 8}" fill="#9fb0cc" font-size="11" text-anchor="middle">${String(h).padStart(2, "0")}:00</text>`; }
  const paso = (y1 - y0) > 20 ? 5 : (y1 - y0) > 8 ? 2 : (y1 - y0) > 3 ? 1 : .5;
  for (let y = Math.ceil(y0 / paso) * paso; y <= y1; y += paso) svg += `<line x1="${iz}" x2="${W - de}" y1="${Y(y)}" y2="${Y(y)}" stroke="#ffffff0d"/><text x="${iz - 6}" y="${Y(y) + 4}" fill="#9fb0cc" font-size="11" text-anchor="end">${paso < 1 ? f1(y) : y}</text>`;
  S.R.forEach((x, i) => { if (x.n >= 30) svg += linea(S.grid.map(t => [t, x.serie.has(t) ? x.a + x.b * x.serie.get(t) : null]), COLS[i], 1, "4 3", .7); });
  svg += linea(S.grid.map(t => [t, S.prop.has(t) && !S.dib.has(t) ? S.prop.get(t) : null]), "#6fcf97", 1.6, "1.5 3");
  svg += linea(S.grid.map(t => [t, valido(t) ? S.obs.get(t) : null]), "#C9A54C", 1.7);
  svg += linea(S.grid.map(t => [t, !valido(t) && S.dib.has(t) ? S.dib.get(t) : null]), "#fff", 2.6);
  svg += linea(S.grid.map(t => [t, !valido(t) && !S.dib.has(t) && S.auto.has(t) ? S.auto.get(t) : null]), "#fff", 1.2, "", .7);
  S.grid.filter(t => S.malos.has(t) && S.obs.has(t)).forEach(t => svg += `<text x="${X(t)}" y="${Y(S.obs.get(t)) + 3}" fill="#eb5757" font-size="9" text-anchor="middle">×</text>`);
  S.grid.filter(t => t % 3600e3 === 0 && !valido(t)).forEach(t => { const y = S.dib.has(t) ? S.dib.get(t) : S.prop.get(t); if (y != null) svg += `<rect x="${X(t) - 4}" y="${Y(y) - 4}" width="8" height="8" transform="rotate(45 ${X(t)} ${Y(y)})" fill="${S.dib.has(t) ? "#f2c94c" : "#6fcf97"}" stroke="#10203f"/>`; });
  svg += `<text x="${iz}" y="${ar - 3}" fill="#9fb0cc" font-size="11">${NOMV[S.v]} (${UNIV[S.v]}) · hora UTC</text><g id="rTrazo"></g><rect id="rSel" y="${ar}" height="${Hh - ar - ab}" fill="#eb5757" opacity=".18" width="0"/>`;
  $("#rG").innerHTML = svg;
}
function tabla(){
  const hs = S.grid.filter(t => t % 3600e3 === 0);
  $("#rTab").innerHTML = `<table class="mtab"><tr><th>Hora UTC</th><th>Observado</th><th>Estimado</th><th>Propuesta</th><th>Bandera</th></tr>${hs.map(t => {
    const o = S.obs.get(t), ok = valido(t), d = S.dib.has(t) ? S.dib.get(t) : S.auto.get(t), p = S.prop.get(t), interp = !S.dib.has(t) && S.auto.has(t);
    return ok ? `<tr><td>${hhmm(t)}</td><td>${f1(o)}</td><td></td><td></td><td style="color:#6fcf97">válido</td></tr>`
      : `<tr><td>${hhmm(t)}</td><td style="color:#eb5757">${o != null ? `<s>${f1(o)}</s>` : "—"}</td><td style="background:${d != null ? "#2a2410" : "transparent"};color:#f2d98a;font-weight:700">${d != null ? f1(d) : "—"}</td><td>${f1(p)}</td>
        <td>${d != null ? `<span style="font-size:11px;border-radius:4px;padding:1px 5px;background:#3a3010;color:#f2c94c">E · ${interp ? "interpolado" : "dibujo"}</span>` : `<span style="color:var(--mu);font-size:12px">pendiente</span>`}</td></tr>`;
  }).join("")}</table><p class="nota" style="margin:6px 0 0">Cada hora es el valor del minuto HH:00. Los observados tachados son tramos que usted marcó como dudosos. «Usar la propuesta» deja como estimado lo calculado con las vecinas, que después puede corregir dibujando.</p>`;
}
function eventosGrafico(){
  const svg = $("#rG"), tip = $("#rTip");
  const punto = ev => { const p = svg.createSVGPoint(); p.x = ev.clientX; p.y = ev.clientY; const q = p.matrixTransform(svg.getScreenCTM().inverse());
    const t = G.ini + (q.x - G.iz) / (G.W - G.iz - G.de) * (G.fin - G.ini), y = G.y0 + (1 - (q.y - G.ar) / (G.Hh - G.ar - G.ab)) * (G.y1 - G.y0); return {t, y, x: q.x}; };
  let trazo = null, sel = null;
  svg.addEventListener("pointerdown", ev => { ev.preventDefault(); svg.setPointerCapture(ev.pointerId); const p = punto(ev);
    if (modo === "dib") trazo = [[p.t, p.y]]; else sel = [p.t, p.t]; });
  svg.addEventListener("pointermove", ev => {
    const p = punto(ev);
    if (trazo){ trazo.push([p.t, p.y]); $("#rTrazo").innerHTML = `<polyline points="${trazo.map(([t, y]) => `${G.X(t).toFixed(1)},${G.Y(y).toFixed(1)}`).join(" ")}" fill="none" stroke="#fff" stroke-width="2" opacity=".6"/>`; }
    if (sel){ sel[1] = p.t; const a = Math.min(...sel), b = Math.max(...sel); const r = $("#rSel"); r.setAttribute("x", G.X(a)); r.setAttribute("width", Math.max(0, G.X(b) - G.X(a))); }
    const t = Math.round((p.t - S.D.ini) / S.step) * S.step + S.D.ini;
    if (t < S.D.ini || t > S.D.fin){ tip.hidden = true; return; }
    const filas = [[hhmm(t) + " UTC", ""], ["observado", S.obs.has(t) ? f1(S.obs.get(t)) + (S.malos.has(t) ? " (dudoso)" : "") : "—"]];
    if (S.dib.has(t) && !valido(t)) filas.push(["su trazo", f1(S.dib.get(t))]); else if (S.auto.has(t)) filas.push(["interpolado", f1(S.auto.get(t))]);
    if (S.prop.has(t)) filas.push(["propuesta", f1(S.prop.get(t))]);
    S.R.forEach(x => { if (x.serie.has(t)) filas.push([x.D.nombre.slice(0, 22) + " ajust.", f1(x.a + x.b * x.serie.get(t))]); });
    tip.innerHTML = filas.map(([a, b], i) => i ? `<div><span>${M().esc(a)}</span><b>${b}</b></div>` : `<div style="color:var(--oro);font-weight:700">${a}</div>`).join("");
    tip.hidden = false; const caja = svg.getBoundingClientRect(), fx = (G.X(t) / G.W) * caja.width;
    tip.style.left = (fx > caja.width - 230 ? fx - 225 : fx + 14) + "px"; tip.style.top = "10px";
  });
  svg.addEventListener("pointerleave", () => tip.hidden = true);
  svg.addEventListener("pointerup", () => {
    if (trazo){ const t = trazo; trazo = null; aplicarTrazo(t.map(([a, y]) => [a, y])); }
    if (sel){ const a = Math.min(...sel), b = Math.max(...sel); sel = null;
      if (b - a >= S.step){ guardarDeshacer(); S.grid.filter(t => t >= a && t <= b && S.obs.has(t)).forEach(t => S.malos.has(t) ? null : S.malos.add(t)); recalcular(); }
      else { const r = $("#rSel"); if (r) r.setAttribute("width", 0); } }
  });
}
function csv(horario){
  const ts = horario ? S.grid.filter(t => t % 3600e3 === 0) : S.grid, e = S.D;
  const L = ["codigo;fecha_utc;variable;observado;estimado;valor_final;bandera;metodo"].concat(ts.map(t => {
    const o = S.obs.get(t), ok = valido(t), interp = !S.dib.has(t) && S.auto.has(t), d = S.dib.has(t) ? S.dib.get(t) : S.auto.get(t), fin = finalEn(t);
    return [e.cod, new Date(t).toISOString().slice(0, 16).replace("T", " "), NOMV[S.v], o == null ? "" : String(o).replace(".", ","), !ok && d != null ? f1(d).replace(".", ",") : "",
      fin == null ? "" : (Math.round(fin * 10) / 10).toFixed(1).replace(".", ","), ok ? "O" : d != null ? "E" : "F", ok ? "observado" : d != null ? (interp ? "interpolación lineal (hueco corto)" : "juicio experto apoyado en vecinas (dibujo)") : "faltante"].join(";");
  }));
  const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob(["﻿" + L.join("\n")], {type: "text/csv"}));
  a.download = `serie_completada_${e.cod}_${e.dia}_${S.v}_${horario ? "horaria" : "minutaria"}.csv`; a.click();
}
window.RELL = {init};
})();
