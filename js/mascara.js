/* Mesa de corrección (etapa 1): datos minutarios de una estación y sus vecinas, valor esperado con las vecinas,
   calculadora de humedad relativa y contexto de satélite (NASA GIBS: IMERG 30 min y GOES-19) a la hora elegida.
   Fuente de datos: archivo de METOTEC (/api/minutarios). Solo mira: todavía no guarda correcciones. */
(function(){
const VARS = [["T", "Ts (temp. seca)", "°C"], ["Td", "Td (punto de rocío)", "°C"], ["HR", "Humedad", "%"], ["P_est", "QFE", "hPa"], ["P_mar", "QFF", "hPa"],
  ["P_std", "QNH", "hPa"], ["dd10", "Dir. 10 min", "°"], ["ff10", "Viento 10 min", "kt"], ["fx10", "Racha", "kt"], ["rr1m", "Agua caída", "mm"],
  ["rr6", "RRR6 informada", "mm"], ["rr24", "RRR24 informada", "mm"], ["Tn12", "Tmín 12 h informada", "°C"], ["Tx12", "Tmáx 12 h informada", "°C"], ["Rad", "Radiación", "W/m²"]];
const UMBRAL = {T: 3, Td: 4, HR: 20, P_est: 3, P_mar: 3, P_std: 3, ff10: 12, fx10: 15, Tn12: 3, Tx12: 3};      // diferencia con lo esperado que se marca
const SIN_ESPERADO = new Set(["dd10", "rr1m", "rr6", "rr24", "Rad"]);
const PAL = ["#E2791A", "#2A9D6F", "#8C5BD6", "#C8467C", "#6B7686", "#B59B2A"];
const $ = s => document.querySelector(s), HP = 1800e3;
const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;"}[c]));
const f1 = v => v == null || isNaN(v) ? "—" : (Math.round(v * 10) / 10).toFixed(1);
const utc = t => new Date(t).toISOString().slice(11, 16);
const loc = t => new Date(t).toLocaleTimeString("es-CL", {timeZone: "America/Santiago", hour: "2-digit", minute: "2-digit", hour12: false});
const sinTilde = x => String(x || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
let EST = [], S = null, mapa = null, capa = null, cap = "imerg", grupoMk = null;

function km(a, b){
  const r = Math.PI / 180, dx = (b.lon - a.lon) * r * Math.cos((a.lat + b.lat) * r / 2), dy = (b.lat - a.lat) * r;
  return 6371 * Math.hypot(dx, dy);
}
async function estaciones(){
  for (const url of ["/api/minutarios?estaciones=1", "/api/datosraw?p=estaciones.json"]){
    try { const j = await (await fetch(url)).json(); EST = (Array.isArray(j) ? j : j.estaciones || []).filter(e => e.lat != null).sort((a, b) => a.codigo.localeCompare(b.codigo)); if (EST.length) break; } catch (e){}
  }
  $("#lst").innerHTML = EST.map(e => `<option value="${esc(e.nombre)} — ${e.codigo}">`).join("");
}
function buscar(q){
  q = String(q || "").trim(); const m = q.match(/(\d{5,7})\s*$/) || q.match(/^(\d+)/);
  if (m){ const e = EST.find(x => x.codigo === m[1]); if (e) return e; }
  const t = sinTilde(q.replace(/\s*[—-]\s*\d+$/, ""));
  return EST.find(x => sinTilde(x.nombre) === t) || EST.find(x => sinTilde(x.nombre).includes(t)) || null;
}
const iso = t => new Date(t).toISOString().slice(0, 13);
async function cargar(cod, ini, fin){
  const r = await fetch(`/api/minutarios?cod=${cod}&desde=${iso(ini)}&hasta=${iso(fin)}`, {cache: "no-store"});
  if (!r.ok) throw new Error("el servidor respondió " + r.status);
  const j = await r.json(), cab = (j.cab || "").split(","), filas = [], vistos = new Set();
  (j.filas || []).forEach(l => { const v = l.split(","), t = Date.parse(v[1].replace(" ", "T") + "Z"); if (vistos.has(t)) return; vistos.add(t);
    const o = {t}; cab.forEach((c, i) => { if (i > 1) o[c] = v[i] === "" ? null : +v[i]; }); filas.push(o); });
  filas.sort((a, b) => a.t - b.t);
  return {filas, por: new Map(filas.map(o => [o.t, o])), faltan: (j.faltan || []).length};
}

/* ---------------- valor esperado con las vecinas ---------------- */
const mediana = a => { a = a.slice().sort((x, y) => x - y); const n = a.length; return n ? (n % 2 ? a[(n - 1) / 2] : (a[n / 2 - 1] + a[n / 2]) / 2) : 0; };
function mco(X, Y){ const n = X.length; let mx = 0, my = 0; for (let i = 0; i < n; i++){ mx += X[i]; my += Y[i]; } mx /= n; my /= n;
  let sxy = 0, sxx = 0; for (let i = 0; i < n; i++){ sxy += (X[i] - mx) * (Y[i] - my); sxx += (X[i] - mx) * (X[i] - mx); }
  const b = sxx > 1e-9 ? sxy / sxx : 0; return {a: my - b * mx, b}; }
function ajusta(X, Y){                                   // regresión de la estación contra una vecina, sin los puntos que se alejan (así el error no la tuerce)
  let f = mco(X, Y); const r = Y.map((y, i) => y - (f.a + f.b * X[i])), s = 1.4826 * mediana(r.map(Math.abs)) || 0;
  const k = X.map((_, i) => Math.abs(r[i]) <= 3 * Math.max(s, 1e-6)); const X2 = X.filter((_, i) => k[i]), Y2 = Y.filter((_, i) => k[i]);
  if (X2.length >= 8) f = mco(X2, Y2);
  const r2 = Y.map((y, i) => y - (f.a + f.b * X[i])); f.s = 1.4826 * mediana(r2.map(Math.abs)); return f; }
const CACHE_E = new Map();
function esperado(p, v){
  const key = p + "|" + v; if (CACHE_E.has(key)) return CACHE_E.get(key);
  const out = new Map(); out.sigma = 0; CACHE_E.set(key, out); if (SIN_ESPERADO.has(v)) return out;
  const P = S.d[p]; if (!P) return out;
  const otras = S.cods.filter(c => c !== p && S.d[c]).map(c => {
    const X = [], Y = []; P.filas.forEach(o => { const q = S.d[c].por.get(o.t); if (o[v] != null && q && q[v] != null){ X.push(q[v]); Y.push(o[v]); } });
    if (X.length < 12) return null; const f = ajusta(X, Y), s = Math.max(f.s, 0.05 * (UMBRAL[v] || 1));
    return {c, a: f.a, b: f.b, w: 1 / (s * s) / Math.sqrt(Math.max(1, km(S.e[p], S.e[c])))};
  }).filter(Boolean);
  const dif = [];
  P.filas.forEach(o => { let sw = 0, sv = 0, n = 0;
    otras.forEach(x => { const q = S.d[x.c].por.get(o.t); if (q && q[v] != null){ sw += x.w; sv += x.w * (x.a + x.b * q[v]); n++; } });
    if (n >= 2){ const e = sv / sw; out.set(o.t, e); if (o[v] != null) dif.push(Math.abs(o[v] - e)); } });
  out.sigma = 1.4826 * mediana(dif);
  return out;
}
const umbral = (v, E) => UMBRAL[v] ? Math.max(UMBRAL[v] / 2, 4 * (E.sigma || 0)) : null;       // diferencia que se marca: nunca menos de la mitad del umbral ni de 4 veces lo normal de ese día

/* ---------------- gráfico ---------------- */
function rango(v){
  const vals = []; S.cods.forEach(c => S.d[c] && S.d[c].filas.forEach(o => { if (o[v] != null) vals.push(o[v]); }));
  if (!vals.length) return null; let a = Math.min(...vals), b = Math.max(...vals); if (a === b){ a -= 1; b += 1; }
  const m = (b - a) * .08; return [a - m, b + m];
}
function pintar(){
  if (!S) return; const v = S.v, p = S.vista, R = rango(v), W = 900, H = 300, L = 48, Rr = 10, T = 10, B = 28;
  if (!R){ $("#gr").innerHTML = `<p class="mu">Sin datos de ${esc(v)} ese día.</p>`; pintarTabla(); return; }
  const x = t => L + (t - S.ini) / (S.fin - S.ini) * (W - L - Rr), y = z => T + (R[1] - z) / (R[1] - R[0]) * (H - T - B);
  let g = `<svg id="svg" viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="Serie de ${esc(v)}"><title>Serie de ${esc(v)}</title>`;
  for (let i = 0; i <= 4; i++){ const z = R[0] + (R[1] - R[0]) * i / 4; g += `<line x1="${L}" x2="${W - Rr}" y1="${y(z)}" y2="${y(z)}" stroke="#e3e7ec"/><text x="${L - 6}" y="${y(z) + 4}" font-size="11" text-anchor="end" fill="#6B7686">${f1(z)}</text>`; }
  for (let h = 0; h <= 24; h += 3){ const t = S.ini + h * 3600e3; g += `<line x1="${x(t)}" x2="${x(t)}" y1="${T}" y2="${H - B}" stroke="#f0f2f5"/><text x="${x(t)}" y="${H - 10}" font-size="11" text-anchor="middle" fill="#6B7686">${String(h % 24).padStart(2, "0")}</text>`; }
  g += `<text x="${L}" y="${H - 1}" font-size="10" fill="#6B7686">hora UTC</text>`;
  const linea = (c, col, ancho) => { const F = S.d[c] ? S.d[c].filas : []; let seg = [], s = "";
    const cierra = () => { if (seg.length > 1) s += `<polyline fill="none" stroke="${col}" stroke-width="${ancho}" points="${seg.join(" ")}"/>`; else if (seg.length === 1) s += `<circle cx="${seg[0].split(",")[0]}" cy="${seg[0].split(",")[1]}" r="${ancho}" fill="${col}"/>`; seg = []; };
    let ant = null; F.forEach(o => { if (o[v] == null || (ant != null && o.t - ant > 2.5 * HP)) cierra(); if (o[v] != null){ seg.push(`${x(o.t).toFixed(1)},${y(o[v]).toFixed(1)}`); } ant = o.t; });
    cierra(); return s; };
  let i = 0; S.cods.forEach(c => { if (c !== p) g += linea(c, PAL[i++ % PAL.length], 1.2); });
  g += linea(p, "#1688D4", 2.6);
  const E = esperado(p, v), U = umbral(v, E); let ultimo = -1e15;
  S.d[p].filas.forEach(o => { const e = E.get(o.t); if (o[v] != null && e != null && U && Math.abs(o[v] - e) > U && o.t - ultimo >= 600e3){ ultimo = o.t; g += `<circle cx="${x(o.t)}" cy="${y(o[v])}" r="5" fill="none" stroke="#c0392b" stroke-width="2"/>`; } });
  if (S.sel != null) g += `<line x1="${x(S.sel)}" x2="${x(S.sel)}" y1="${T}" y2="${H - B}" stroke="#C9A54C" stroke-width="2"/>`;
  g += `<rect id="cap" x="${L}" y="${T}" width="${W - L - Rr}" height="${H - T - B}" fill="transparent"/></svg>`;
  const lg = [`<span style="color:#1688D4">● ${esc(S.e[p].nombre)}</span>`]; i = 0; S.cods.forEach(c => { if (c !== p) lg.push(`<span style="color:${PAL[i++ % PAL.length]}">● ${esc(S.e[c].nombre)} (${Math.round(km(S.e[p], S.e[c]))} km)</span>`); });
  $("#gr").innerHTML = g + `<div class="mu" style="display:flex;gap:14px;flex-wrap:wrap">${lg.join("")}<span style="color:#c0392b">◯ sospecha frente a las vecinas</span></div>`;
  const svg = $("#svg"), tAt = ev => { const r = svg.getBoundingClientRect(), px = (ev.clientX - r.left) / r.width * W; return Math.round(((px - L) / (W - L - Rr) * (S.fin - S.ini) + S.ini) / HP) * HP; };
  $("#cap").addEventListener("mousemove", ev => { const t = tAt(ev), u = [`${utc(t)} UTC (${loc(t)} local)`];
    S.cods.forEach(c => { const o = S.d[c] && S.d[c].por.get(t); u.push(`${esc(S.e[c].nombre)}: ${o && o[v] != null ? f1(o[v]) : "—"}`); }); $("#lec").innerHTML = u.join(" · "); });
  $("#cap").addEventListener("click", ev => elegir(tAt(ev)));
  pintarTabla();
}
function pintarTabla(){
  const v = S.v, p = S.vista, E = esperado(p, v), U = umbral(v, E);
  let h = `<tr><th>UTC</th><th>Local</th><th>Valor</th><th>Esperado</th><th>Dif.</th><th class="l">Estado</th></tr>`;
  for (let t = S.ini + HP; t <= S.fin; t += HP){
    const o = S.d[p].por.get(t), val = o ? o[v] : null, e = E.get(t), d = val != null && e != null ? val - e : null;
    const mal = U && d != null && Math.abs(d) > U, est = val == null ? "sin dato" : mal ? "sospechoso" : e == null ? "" : "ok";
    h += `<tr data-t="${t}" class="${t === S.sel ? "sel" : ""}"><td>${utc(t)}</td><td>${loc(t)}</td><td class="${mal ? "err2" : ""}">${f1(val)}</td><td>${f1(e)}</td><td>${d == null ? "—" : (d > 0 ? "+" : "") + f1(d)}</td><td class="n ${val == null ? "inf2" : mal ? "err2" : "ok"}">${est}</td></tr>`;
  }
  $("#tb").innerHTML = h; const s = $("#tb tr.sel"); if (s) s.scrollIntoView({block: "nearest"});
}
$("#tb").addEventListener("click", ev => { const tr = ev.target.closest("tr[data-t]"); if (tr) elegir(+tr.dataset.t); });

/* ---------------- calculadora de HR (fórmula de Magnus) ---------------- */
const es = T => 6.112 * Math.exp(17.62 * T / (243.12 + T));
const calcHR = (T, Td) => Math.min(100, 100 * es(Td) / es(T));
const calcTd = (T, HR) => { const g = Math.log(HR / 100) + 17.62 * T / (243.12 + T); return 243.12 * g / (17.62 - g); };
const num = id => { const v = $(id).value; return v === "" ? NaN : +v; };
function resultado(){
  const o = S && S.sel != null && S.d[S.vista] ? S.d[S.vista].por.get(S.sel) : null;
  return o;
}
$("#bHR").addEventListener("click", () => { const T = num("#cT"), Td = num("#cTd");
  if (isNaN(T) || isNaN(Td)) return $("#cRes").textContent = "Falta Ts o Td";
  if (Td > T) return $("#cRes").textContent = "Td no puede ser mayor que Ts";
  const h = calcHR(T, Td); $("#cHR").value = Math.round(h); $("#cRes").textContent = `HR ${Math.round(h)} %`; comparar("HR", h); });
$("#bTd").addEventListener("click", () => { const T = num("#cT"), H = num("#cHR");
  if (isNaN(T) || isNaN(H)) return $("#cRes").textContent = "Falta Ts o HR";
  if (H <= 0 || H > 100) return $("#cRes").textContent = "HR debe estar entre 1 y 100";
  const d = calcTd(T, H); $("#cTd").value = f1(d); $("#cRes").textContent = `Td ${f1(d)} °C`; comparar("Td", d); });
$("#bUsar").addEventListener("click", () => usarFila(true));
function comparar(k, val){ const o = resultado(); $("#cDif").textContent = o && o[k] != null ? `Informada en la fila elegida: ${f1(o[k])}${k === "HR" ? " %" : " °C"} (difiere ${f1(Math.abs(o[k] - val))})` : ""; }
function usarFila(forzar){ const o = resultado(); if (!o){ if (forzar) $("#cRes").textContent = "Elige una fila o un punto del gráfico"; return; }
  $("#cT").value = o.T ?? ""; $("#cTd").value = o.Td ?? ""; $("#cHR").value = o.HR ?? ""; $("#cRes").textContent = "—"; $("#cDif").textContent = ""; }

/* ---------------- mapa y capas de satélite (NASA GIBS) ---------------- */
const GIBS = "https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/";
const CAPAS = {
  imerg: {id: "IMERG_Precipitation_Rate", nivel: "GoogleMapsCompatible_Level6", z: 6, ext: "png"},
  goes: {id: "GOES-East_ABI_GeoColor", nivel: "GoogleMapsCompatible_Level7", z: 7, ext: "jpeg"},
  ir: {id: "GOES-East_ABI_Band13_Clean_Infrared", nivel: "GoogleMapsCompatible_Level7", z: 7, ext: "png"}};
function iniciarMapa(){
  if (mapa || !window.L) return;
  mapa = L.map("mp", {zoomControl: true}).setView([-33.4, -70.7], 6);
  L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {maxZoom: 12, attribution: "© OpenStreetMap"}).addTo(mapa);
  grupoMk = L.layerGroup().addTo(mapa);
}
function tiempoCapa(){ const t = S ? S.ini + (+$("#tSl").value) * HP : Date.now(); return new Date(Math.floor(t / HP) * HP).toISOString().slice(0, 19) + "Z"; }
function pintarCapa(){
  if (!mapa) return; if (capa){ mapa.removeLayer(capa); capa = null; }
  const C = CAPAS[cap]; $("#tTx").textContent = S ? `${utc(S.ini + (+$("#tSl").value) * HP)} UTC (${loc(S.ini + (+$("#tSl").value) * HP)} local)` : "";
  if (!C || !S) return;
  const f = new Date(S.ini + (+$("#tSl").value) * HP);
  if (f.getTime() > Date.now()) return;
  capa = L.tileLayer(`${GIBS}${C.id}/default/${tiempoCapa()}/${C.nivel}/{z}/{y}/{x}.${C.ext}`, {maxNativeZoom: C.z, maxZoom: 12, opacity: +$("#op").value / 100, attribution: "NASA GIBS"}).addTo(mapa);
}
function pintarMarcas(){
  iniciarMapa(); if (!mapa || !S) return; grupoMk.clearLayers(); const pts = [];
  S.cods.forEach((c, i) => { const e = S.e[c], pr = c === S.vista; pts.push([e.lat, e.lon]);
    L.circleMarker([e.lat, e.lon], {radius: pr ? 8 : 6, color: "#fff", weight: 2, fillColor: pr ? "#1688D4" : PAL[(i - 1 + PAL.length) % PAL.length], fillOpacity: 1}).bindTooltip(`${e.nombre} · ${e.codigo}`, {permanent: pr, direction: "right"}).addTo(grupoMk); });
  mapa.fitBounds(pts, {padding: [40, 40], maxZoom: 9});
}
document.querySelectorAll(".capas button[data-c]").forEach(b => b.addEventListener("click", () => { cap = b.dataset.c;
  document.querySelectorAll(".capas button[data-c]").forEach(x => x.classList.toggle("on", x === b)); pintarCapa(); }));
$("#op").addEventListener("input", () => capa && capa.setOpacity(+$("#op").value / 100));
$("#tSl").addEventListener("input", () => elegir(S.ini + (+$("#tSl").value) * HP, true));
$("#tAnt").addEventListener("click", () => elegir(S.sel != null ? S.sel - HP : S.ini));
$("#tSig").addEventListener("click", () => elegir(S.sel != null ? S.sel + HP : S.ini));

/* ---------------- elegir una hora, pestañas y carga ---------------- */
function elegir(t, desdeBarra){
  if (!S) return; t = Math.min(S.fin - HP, Math.max(S.ini, t)); S.sel = t;
  if (!desdeBarra) $("#tSl").value = Math.round((t - S.ini) / HP);
  pintarCapa(); pintar(); usarFila(false);
}
function pestanas(){
  $("#pest").innerHTML = S.cods.map(c => `<button data-c="${c}" class="${c === S.vista ? "on" : ""}">${c === S.cods[0] ? "Esta estación" : esc(S.e[c].nombre) + " · " + Math.round(km(S.e[S.cods[0]], S.e[c])) + " km"}</button>`).join("");
  $("#vars").innerHTML = VARS.map(([k, n, u]) => `<button data-v="${k}" class="${k === S.v ? "on" : ""}" title="${esc(n)} (${u})">${esc(n)}</button>`).join("");
}
$("#pest").addEventListener("click", ev => { const b = ev.target.closest("button[data-c]"); if (!b || !S) return; S.vista = b.dataset.c; pestanas(); pintarMarcas(); pintar(); });
$("#vars").addEventListener("click", ev => { const b = ev.target.closest("button[data-v]"); if (!b || !S) return; S.v = b.dataset.v; pestanas(); pintar(); });

async function ver(){
  const e = buscar($("#est").value), dia = $("#dia").value;
  if (!e) return $("#msg").textContent = "No encontré esa estación";
  if (!dia) return $("#msg").textContent = "Elige un día";
  const ini = Date.parse(dia + "T00:00:00Z"), fin = ini + 864e5;
  if (ini > Date.now()) return $("#msg").textContent = "Ese día todavía no llega";
  const nv = Math.min(6, Math.max(0, parseInt($("#nv").value) || 0));
  const vec = EST.filter(x => x.codigo !== e.codigo).map(x => ({x, d: km(e, x)})).filter(o => o.d <= 300).sort((a, b) => a.d - b.d).slice(0, nv).map(o => o.x);
  const cods = [e.codigo, ...vec.map(x => x.codigo)], E = Object.fromEntries([e, ...vec].map(x => [x.codigo, x]));
  $("#go").disabled = true; $("#msg").textContent = `Cargando ${cods.length} estaciones…`;
  const res = await Promise.allSettled(cods.map(c => cargar(c, ini, fin))), d = {}; let falla = 0;
  res.forEach((r, i) => { if (r.status === "fulfilled") d[cods[i]] = r.value; else falla++; });
  $("#go").disabled = false;
  if (!d[e.codigo]){ $("#msg").textContent = "No se pudo cargar la estación: " + (res[0].reason && res[0].reason.message || "error"); return; }
  const vivas = cods.filter(c => d[c]); CACHE_E.clear(); S = {ini, fin, cods: vivas, e: E, d, vista: e.codigo, v: S ? S.v : "T", sel: null};
  const hay = d[e.codigo].filas.length;
  $("#msg").textContent = hay ? `${hay} datos de ${E[e.codigo].nombre}${falla ? " · " + falla + " vecina(s) sin cargar" : ""}${d[e.codigo].faltan ? " · " + d[e.codigo].faltan + " hora(s) sin archivo" : ""}` : "Sin datos archivados ese día (el archivo parte el 8-11-2026)";
  pestanas(); pintarMarcas();
  CACHE_E.clear(); const E0 = esperado(e.codigo, S.v), U = umbral(S.v, E0); let primero = null, mx = 0;
  d[e.codigo].filas.forEach(o => { const z = E0.get(o.t); if (o[S.v] != null && z != null && U && Math.abs(o[S.v] - z) > U && Math.abs(o[S.v] - z) > mx){ mx = Math.abs(o[S.v] - z); primero = Math.round(o.t / HP) * HP; } });
  elegir(primero != null ? primero : ini + 12 * 3600e3);
}
$("#go").addEventListener("click", ver);
$("#est").addEventListener("keydown", ev => { if (ev.key === "Enter"){ ev.preventDefault(); ver(); } });
(async function(){
  const ayer = new Date(Date.now() - 864e5).toISOString().slice(0, 10); $("#dia").value = ayer; $("#dia").max = new Date().toISOString().slice(0, 10);
  iniciarMapa(); await estaciones();
  const q = new URLSearchParams(location.search), c = q.get("cod"), e0 = c && EST.find(x => x.codigo === c) || EST.find(x => x.codigo === "270008") || EST[0];
  if (e0) $("#est").value = `${e0.nombre} — ${e0.codigo}`;
  if (q.get("dia")) $("#dia").value = q.get("dia");
  if (c) ver();
})();
})();
