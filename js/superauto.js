/* «Super automático»: estaciones automáticas SIN observador, con un control más estricto sobre el minutario (qc/superauto.py).
   Vista «Estaciones» (resumen por estación y variable) y una pestaña por variable: Precipitación, Extremas, Presiones, Temperaturas, Viento.
   Los datos vienen en R.super; las marcas (Resuelto / Falsa alarma / Omitir) usan el mismo mecanismo que las observaciones. */
(function(){
const $ = s => document.querySelector(s);
const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;"})[c]);
const NIVC = ["var(--ok)", "var(--sos)", "var(--err)"];
const ESP = new Set(["ZC01", "ZC02", "ZC03", "ZC04", "ZC05", "ZC06", "ZC07", "ZE05", "ZE08"]);     // controles espaciales (vecinas DMC y externas)
const TABS = {sup_esp: ["esp", "control espacial"], obs_esp: ["esp", "control espacial (estaciones con observador)"], sup_prc: ["pp", "precipitación"], sup_ext: ["ext", "extremas"], sup_pre: ["pre", "presiones"], sup_tem: ["tem", "temperaturas (Ts, Td, HR)"], sup_vie: ["vie", "viento"]};
const COLS = [["pp", "Precipitación", "sup_prc"], ["ext", "Extremas", "sup_ext"], ["pre", "Presiones", "sup_pre"], ["tem", "Temperaturas", "sup_tem"], ["vie", "Viento", "sup_vie"]];
const NOTA = {
  pp: "Agua caída del pluviómetro: lluvia con aire seco, más de 2 mm en un minuto, el mismo valor repetido 10 minutos (pluviómetro pegado) el acumulado de 6 h contra la suma de los minutos y, contra el satélite GOES, lluvia con cielo despejado o pluviómetro en 0 durante 4 h o más con lluvia estimada y nube fría.",
  esp: "Comparación con todas las estaciones cercanas (DMC e INIA y otras externas, con menor peso): Ts, Td, HR y QFF (diferencia sostenida), viento medio y calma prolongada, lluvia sí/no, y mínima, máxima y amplitud del día. Solo estaciones automáticas sin observador.",
  ext: "Extremas: Tn12/Tx12 contra la temperatura por minuto de las últimas 24 h, mínima y máxima de 24 h fuera de rango físico (picos del sensor), contra las vecinas (> 6 °C sospechoso, > 10 °C erróneo), amplitud del día contra las vecinas, el mismo valor 3 días seguidos y Tn12 mayor que Tx12.",
  pre: "QFF contra la mediana de las vecinas y contra el modelo (diferencia sostenida en 2 de las últimas 3 horas), QFE pegado 3 h, QFE lejos de lo esperado por altura, saltos groseros, cambio sobre 10 hPa en 3 h y QFF contra el QFE reducido.",
  tem: "Ts, Td y HR contra la mediana de las vecinas (≥ 3, corregida por altura) y contra el modelo, con diferencia sostenida en 2 de las últimas 3 horas; Td mayor que Ts, HR que no calza con Ts y Td, valores pegados (3 h; HR 8 h), saltos groseros Ts fuera de lo habitual para la zona y Ts que casi no varía en 24 h (poco probable).",
  vie: "Viento contra las vecinas (sostenido) y contra el modelo, calma prolongada con viento en las vecinas, cambio del viento medio sobre 15 kt en 10 min, viento o dirección pegados, dirección fuera de 0–360, racha menor que el medio, viento medio sobre 70 kt o racha más de 4 veces el medio (poco probables)."};
// columnas de la tabla de datos de cada pestaña: [campo del resumen, título, unidad]
const DATOS = {
  pp: [["rr_24h", "Lluvia 24 h (suma de minutos)", "mm"], ["rr_1h", "Lluvia última hora", "mm"], ["rr_min", "Máx. en un minuto", "mm"], ["rr6", "RRR6 informada", "mm"], ["rr24", "RRR24 informada", "mm"], ["HR", "HR", "%"]],
  ext: [["Tmin24", "Ts mínima 24 h (por minuto)", "°C"], ["Tmax24", "Ts máxima 24 h (por minuto)", "°C"], ["Tn12", "Mínima 12 h informada (Tn12)", "°C"], ["Tx12", "Máxima 12 h informada (Tx12)", "°C"]],
  pre: [["P_est", "QFE", "hPa"], ["P_mar", "QFF", "hPa"], ["dP3", "Cambio del QFE en 3 h", "hPa"]],
  tem: [["T", "Ts", "°C"], ["Td", "Td", "°C"], ["HR", "HR", "%"], ["Tmin24", "Ts mín. 24 h", "°C"], ["Tmax24", "Ts máx. 24 h", "°C"]],
  vie: [["ff10", "Viento medio 10 min", "kt"], ["fx10", "Racha", "kt"], ["dd10", "Dirección", "°"], ["ffmax24", "Viento máx. 24 h", "kt"], ["fxmax24", "Racha máx. 24 h", "kt"]]};
let getR = () => null, modo = "sup", q = "", ctlSel = null;
// índice por tipo de control (de más seguro a más blando)
const CTL = [["fis", "Límites físicos", "¿El valor es posible?", ["ZT09", "ZP03", "ZV05", "ZV08", "ZE04"]],
  ["int", "Consistencia interna", "¿Las variables de la estación calzan entre sí?", ["ZT04", "ZT05", "ZP05", "ZV06", "ZV09", "ZE03", "ZR05", "ZR01"]],
  ["sal", "Temporal: saltos", "¿Cambió de golpe?", ["ZT01", "ZT02", "ZT03", "ZP01", "ZP04", "ZV01", "ZR02"]],
  ["peg", "Temporal: pegados o sin variación", "¿El sensor se quedó fijo?", ["ZT06", "ZT07", "ZT08", "ZT10", "ZP02", "ZV02", "ZV03", "ZR03", "ZR04", "ZE07"]],
  ["exm", "Extremas contra minutos", "¿La Tn12/Tx12 calza con lo medido?", ["ZE01", "ZE06"]],
  ["esp", "Control espacial", "¿Calza con las estaciones cercanas (DMC e INIA)?", ["ZC01", "ZC02", "ZC03", "ZC04", "ZC05", "ZC06", "ZC07", "ZE05", "ZE08"]],
  ["mod", "Contra modelo", "¿Calza con lo que da el modelo?", ["ZM01", "ZM02", "ZM03", "ZM04", "ZM05"]],
  ["sat", "Contra satélite", "¿Calza con lo que se ve desde el GOES?", ["ZS01", "ZS02"]]];
const tipoCtl = r => (CTL.find(c => c[3].includes(r)) || [null])[0];
function indiceCtl(F){
  const filasI = CTL.map(([k, n, p, R]) => { const A = F.flatMap(x => x.H.filter(h => R.includes(h.regla)).map(h => ({...h, e: x.e}))), est = new Set(A.map(a => a.e.codigo)), err = A.filter(a => a.nivel >= 2).length;
    return `<tr data-ctl="${k}" style="cursor:pointer;${ctlSel === k ? "background:color-mix(in srgb,var(--oro) 18%,transparent)" : ""}"><td><b>${esc(n)}</b><br><small style="color:var(--mu)">${esc(p)}</small></td><td class="n">${est.size || "—"}</td><td class="n">${A.length || "—"}</td><td class="n" style="color:${err ? "var(--err)" : "var(--mu)"};font-weight:600">${err || "—"}</td><td style="font-size:11.5px;color:var(--mu)">${R.join(" · ")}</td></tr>`; }).join("");
  let det = "";
  if (ctlSel){ const c = CTL.find(x => x[0] === ctlSel), A = F.flatMap(x => x.H.filter(h => c[3].includes(h.regla)).map(h => ({...h, e: x.e}))).sort((a, b) => b.nivel - a.nivel || b.hora.localeCompare(a.hora));
    det = `<h3 style="margin:14px 0 6px;font:600 15px var(--titulo)">${esc(c[1])} · ${A.length} alertas</h3>` + (A.length ? `<div class="bcard" style="padding:0;max-height:520px;overflow:auto"><table class="xtab"><tr><th>Estación</th><th>Obs. UTC</th><th>Alerta</th><th>Ingresado</th><th>Debería ir</th><th>Detalle</th></tr>
      ${A.map(f => `<tr data-ir="${f.e.codigo}" data-tp="${f.tipo}" style="cursor:pointer"><td class="nom"><b>${esc(f.e.nombre)}</b><br><small>${f.e.codigo}</small></td><td style="white-space:nowrap">${hora(f)}</td><td style="color:${NIVC[f.nivel] || "inherit"};font-weight:600">${REGLAS.html(f.regla, esc)}</td><td class="n">${esc(f.ingresado || "—")}</td><td class="n" style="color:var(--oro)">${esc(f.deberia || "")}</td><td>${esc(f.msg)}</td></tr>`).join("")}</table></div>` : `<p style="color:var(--ok)">Sin alertas de este tipo.</p>`); }
  return `<h3 style="margin:18px 0 6px;font:600 15px var(--titulo)">Índice por tipo de control</h3>
    <div class="bcard" style="padding:0"><table class="xtab"><tr><th>Tipo de control</th><th>Estaciones</th><th>Alertas</th><th>Erróneas</th><th>Reglas</th></tr>${filasI}</table></div>
    <p class="nota" style="color:var(--mu);font-size:12px;margin:4px 0">De arriba hacia abajo, de más seguro a más blando: los primeros casi siempre son errores reales; los últimos dependen de una referencia externa (vecinas, modelo o satélite) que también puede fallar. Haga clic en un tipo para ver sus alertas.</p>${det}`;
}
document.addEventListener("click", ev => { const t = ev.target.closest("tr[data-ctl]"); if (!t) return; ctlSel = ctlSel === t.dataset.ctl ? null : t.dataset.ctl; window.supIdxAb = true; pintar(); if (typeof window.pintar === "function") window.pintar(); });

function init(fR, m){
  getR = fR || getR; if (m) modo = m;
  const s = $("#sup");
  if (!s.dataset.ok){
    s.dataset.ok = 1;
    s.innerHTML = `<div class="htools"><input id="zBus" placeholder="Buscar estación…"><span class="tag" id="zHora"></span></div><div id="zOut"></div>`;
    $("#zBus").addEventListener("input", ev => { q = ev.target.value.trim().toLowerCase(); pintar(); });
  }
  $("#zBus").value = q;
  pintar();
}

function filas(){
  const R = getR(), S = (R && R.super) || {};
  const out = [];
  (modo === "obs_esp" ? S.obs_esp || [] : S.estaciones || []).forEach(e => {
    const H = [];
    (e.hallazgos || []).forEach(h => { const x = {...h, gen: S.generado}; if (MARCA.estado(e.codigo, x) !== "oculta") H.push({...x, st: MARCA.estado(e.codigo, x)}); });
    out.push({e, H});
  });
  return out.filter(({e}) => !q || (e.nombre || "").toLowerCase().includes(q) || e.codigo.includes(q));
}

const kpi = (n, t, c) => `<div><b style="color:${c}">${n}</b><span>${esc(t)}</span></div>`;
const hora = h => `${h.hora.slice(8, 10)}/${h.hora.slice(5, 7)} ${h.hora.slice(11, 16)}`;
const enlinea = c => `<a class="vlink" style="display:inline-block;margin-top:4px" href="https://climatologia.meteochile.gob.cl/application/diariob/visorDeDatosEma/${encodeURIComponent(c)}" target="_blank" rel="noopener" title="Abrir la estación en línea en el portal de climatología">↗ en línea</a>`;


let selEst = null;
function pintarEst(F){
  const L = [...F].sort((a, b) => (a.e.nombre || "").localeCompare(b.e.nombre || ""));
  if (!selEst || !L.some(x => x.e.codigo === selEst)) selEst = null;
  $("#zOut").innerHTML = `<div style="display:flex;gap:14px;align-items:flex-start;flex-wrap:wrap"><div style="flex:0 0 280px;max-height:700px;overflow:auto" class="bcard"><table class="xtab">
    ${L.map(({e, H}) => `<tr data-es="${e.codigo}" style="cursor:pointer;${selEst === e.codigo ? "background:color-mix(in srgb,var(--oro) 18%,transparent)" : ""}"><td class="nom"><b>${esc(e.nombre)}</b><br><small>${e.codigo}${e.ultima ? " · " + hora({hora: e.ultima}) + " UTC" : " · sin datos"}</small></td><td style="color:${H.length ? NIVC[Math.max(...H.map(h => h.nivel))] : "var(--mu)"};font-weight:600">${H.length || ""}</td></tr>`).join("")}</table></div>
    <div style="flex:1 1 520px;min-width:0" id="zEst">${selEst ? "" : `<p style="color:var(--mu)">Elija una estación de la lista para ver sus gráficos y datos por período: hora, día, semana, mes y año.</p>`}</div></div>`;
  if (selEst){ const e = (L.find(x => x.e.codigo === selEst) || {}).e; if (e) abrirEst(e); }
}
function abrirEst(e){
  const R = getR(), S = (R && R.super) || {}, H = ((S.estaciones || []).find(x => x.codigo === e.codigo) || {}).hallazgos || [];
  const c = $("#zEst"); if (!c) return;
  c.innerHTML = `<h2 style="margin:0">${esc(e.nombre)}</h2><div class="sub" style="color:var(--mu);margin-bottom:8px">${e.codigo}${e.oaci ? " · " + esc(e.oaci) : ""}${e.alt != null ? " · " + e.alt + " m" : ""} · último dato ${e.ultima ? hora({hora: e.ultima}) + " UTC" : "—"} · <a class="vlink" href="https://climatologia.meteochile.gob.cl/application/diariob/visorDeDatosEma/${encodeURIComponent(e.codigo)}" target="_blank" rel="noopener">↗ en línea</a> · ${H.length} alertas</div><div class="supbox" data-c="${e.codigo}"></div>`;
  SG.estacion(c.querySelector(".supbox"), e, "hora");
}
function filasDatos(F, tipo){
  const f = v => v == null ? "—" : String(v);
  return [...F].sort((a, b) => b.H.filter(h => h.tipo === tipo).length - a.H.filter(h => h.tipo === tipo).length || (a.e.nombre || "").localeCompare(b.e.nombre || "")).map(({e, H}) => {
    const n = H.filter(h => h.tipo === tipo), r = e.res || {};
    return `<tr data-ir="${e.codigo}" data-tp="${tipo}" style="cursor:pointer"><td class="nom"><b>${esc(e.nombre)}</b><br><small>${e.codigo}</small></td><td style="white-space:nowrap">${e.ultima ? hora({hora: e.ultima}) : "<span style='color:var(--mu)'>sin datos</span>"}</td>
      ${DATOS[tipo].map(c => `<td class="n">${f(r[c[0]])}</td>`).join("")}<td style="color:${n.length ? NIVC[Math.max(...n.map(h => h.nivel))] : "var(--mu)"};font-weight:600">${n.length || "—"}</td></tr>`; }).join("");
}
function pintar(){
  if (!$("#sup") || !$("#sup").dataset.ok) return;
  const R = getR(), S = (R && R.super) || {}, g = S.generado ? new Date(S.generado + "Z") : null;
  $("#zHora").textContent = g ? `${modo === "obs_esp" ? "Estaciones con observador (su sensor) contra todas las cercanas: DMC, INIA y otras" : "Estaciones sin observador"} · revisadas a las ${g.toLocaleTimeString("es-CL", {hour: "2-digit", minute: "2-digit"})} · últimas 24 h` : "Todavía no hay revisión del Super automático";
  const F = filas();
  if (modo === "sup"){
    const nEst = F.length, con = F.filter(x => x.H.length).length, sin = F.filter(x => x.e.nivel === 3).length;
    const cuenta = x => Object.fromEntries(COLS.map(([k]) => [k, x.H.filter(h => h.tipo === k).length]));
    const tot = Object.fromEntries(COLS.map(([k]) => [k, F.reduce((a, x) => a + x.H.filter(h => h.tipo === k).length, 0)]));
    const V = F.filter(x => x.H.length || x.e.nivel === 3).sort((a, b) => b.H.length - a.H.length || (a.e.nombre || "").localeCompare(b.e.nombre || ""));
    $("#zOut").innerHTML = `<div class="hres">${kpi(nEst, "estaciones sin observador", "var(--tx)")}${kpi(con, "con alertas", "var(--oro)")}${kpi(sin, "sin datos", "var(--mu)")}${COLS.map(([k, n]) => kpi(tot[k], n, "var(--tx)")).join("")}</div>
      ${V.length ? `<div class="bcard" style="padding:0"><table class="xtab"><tr><th>Estación</th><th>Último dato UTC</th>${COLS.map(c => `<th>${c[1]}</th>`).join("")}<th>Peor</th></tr>
      ${V.map(x => { const c = cuenta(x), niv = Math.max(0, ...x.H.map(h => h.nivel)); return `<tr><td class="nom"><b>${esc(x.e.nombre)}</b><br><small>${x.e.codigo}</small><br>${enlinea(x.e.codigo)}</td>
        <td style="white-space:nowrap">${x.e.ultima ? hora({hora: x.e.ultima}) : "<span style='color:var(--mu)'>sin datos</span>"}</td>
        ${COLS.map(([k, n, m]) => `<td class="n">${c[k] ? `<a href="#${m}" data-sup="${m}" data-c="${x.e.codigo}" style="color:var(--oro)">${c[k]}</a>` : "—"}</td>`).join("")}
        <td style="color:${NIVC[niv] || "inherit"};font-weight:600">${x.H.length ? ["", "Sospechoso", "Erróneo"][niv] : ""}</td></tr>`; }).join("")}</table></div>`
        : `<p style="color:var(--ok)">Sin alertas en las estaciones sin observador.</p>`}
      ${indiceCtl(F)}
      <p class="nota" style="color:var(--mu);font-size:12px;margin-top:10px">Control más estricto que el de «Estaciones automáticas» (umbrales cerca de la mitad), solo para estaciones sin observador. Avisa antes y puede dar más falsas alarmas: use ✗ para registrarlas. Cada pestaña muestra el detalle por variable.</p>`;
    return;
  }
  if (modo === "sup_pp") return pintarAgua(F);
  if (modo === "sup_est") return pintarEst(F);
  if (modo === "sup_bol") return pintarBol(F);
  const [tipo, nom] = TABS[modo];
  const todas = [], calza = [];
  F.forEach(({e, H}) => { H.filter(h => tipo === "esp" ? ESP.has(h.regla) : h.tipo === tipo).forEach(h => todas.push({...h, e}));
    if (tipo === "pp") ((e.res || {}).blq6 || []).forEach(([hr, inf, suma]) => { if (inf != null && suma != null && !H.some(h => h.regla === "ZR05" && h.hora === hr)) calza.push({e, hora: hr, nivel: 0, regla: "ZR05ok", tipo: "pp", ingresado: `RRR6 ${inf} mm`, deberia: `${suma} mm`, msg: "El RRR6 de la estación coincide con la suma del agua caída por minuto."}); }); });
  todas.sort((a, b) => b.hora.localeCompare(a.hora) || b.nivel - a.nivel || (a.e.nombre || "").localeCompare(b.e.nombre || ""));
  calza.sort((a, b) => b.hora.localeCompare(a.hora) || (a.e.nombre || "").localeCompare(b.e.nombre || ""));
  const cnt = {}; todas.forEach(f => cnt[f.regla] = (cnt[f.regla] || 0) + 1);
  const est = new Set(todas.map(f => f.e.codigo));
  const fila = f => `<tr class="supal" data-c="${f.e.codigo}" data-r="${f.regla}" data-h="${esc(f.hora)}" data-tp="${f.tipo}" style="cursor:pointer" title="Ver gráfico y tabla"><td class="nom"><b>${esc(f.e.nombre)}</b><br><small>${f.e.codigo}</small><br>${enlinea(f.e.codigo)}</td><td style="white-space:nowrap">${hora(f)}</td>
        <td style="color:${f.regla === "ZR05ok" ? "var(--ok)" : NIVC[f.nivel] || "inherit"};font-weight:600">${f.regla === "ZR05ok" ? "✓ RRR6 calza" : REGLAS.html(f.regla, esc)}</td><td class="n">${esc(f.ingresado || "—")}</td><td class="n" style="color:var(--oro)">${esc(f.deberia || "")}</td>
        <td>${esc(f.msg)}${f.st === "sigue" ? MARCA.aviso : ""}</td><td style="white-space:nowrap">${f.regla === "ZR05ok" ? "" : MARCA.botones(f.e.codigo, f)}</td></tr>`;
  const cab = `<tr><th>Estación</th><th>Obs. UTC</th><th>Alerta</th><th>Ingresado</th><th>Debería ir</th><th>Detalle</th><th></th></tr>`;
  $("#zOut").innerHTML = `
    ${todas.length ? `<div class="bcard" style="padding:0"><table class="xtab">${cab}${todas.map(fila).join("")}</table></div>` : `<p style="color:var(--ok)">Sin alertas de ${nom}${q ? " con ese filtro" : ""}.</p>`}
    ${tipo === "pp" || !DATOS[tipo] ? "" : `<div class="supDatosSec"><h3 style="margin:16px 0 6px;font:600 15px var(--titulo)">Datos de las estaciones sin observador · ${esc(nom)}</h3>
    <div class="bcard" style="padding:0;max-height:520px;overflow:auto"><table class="xtab"><tr><th>Estación</th><th>Último dato UTC</th>${DATOS[tipo].map(c => `<th>${esc(c[1])}${c[2] ? ` <small>(${c[2]})</small>` : ""}</th>`).join("")}<th>Alertas</th></tr>
      ${filasDatos(F, tipo)}</table></div></div>`}
    <p class="nota" style="color:var(--mu);font-size:12px;margin-top:10px">Haga clic en una fila para ver su gráfico y su tabla. ${modo === "obs_esp" ? "Sensor de las estaciones con observador contra todas las estaciones cercanas (DMC con y sin observador, INIA y otras externas, con menor peso): Ts, Td, HR y QFF (diferencia sostenida), viento medio, calma prolongada y lluvia sí/no. Lo que digita el observador se compara con su sensor en «Frente al sensor»." : NOTA[tipo]} «Resuelto» quita la alerta y la manda al Historial; no vuelve mientras el dato sea el mismo.</p>`;
}
// regla espacial → [grupo de gráficos, variable del minutario, nombre, unidad]
const VAR_R = {ZC01: ["tem", "T", "Ts", "°C"], ZC02: ["tem", "Td", "Td", "°C"], ZC03: ["tem", "HR", "HR", "%"], ZC04: ["pre", "P_mar", "QFF", "hPa"], ZC05: ["vie", "ff10", "Viento", "kt"], ZC07: ["vie", "ff10", "Viento", "kt"],
  ZC06: ["pp", "rr1m", "Lluvia 3 h", "mm"], ZE05: ["ext", "T", "Ts", "°C"], ZE08: ["ext", "T", "Ts", "°C"]};
let MAPE = null;
async function mapaEsp(el, tit, e, V2, h, hora){
  if (!window.L || e.lat == null) return;
  if (MAPE){ try { MAPE.remove(); } catch (x) {} MAPE = null; }
  const R = getR(), E = (R && R.estaciones) || [], [, v, nom, un] = VAR_R[h.regla] || ["tem", "T", "Ts", "°C"], t0 = Date.parse(hora + ":00Z");
  tit.innerHTML = `<b>${esc(nom)}</b> a las ${esc(hora.slice(11, 16))} UTC del ${esc(hora.slice(8, 10) + "/" + hora.slice(5, 7))}${v === "rr1m" ? " (suma de las 3 h previas)" : ""}`;
  const mp = L.map(el, {attributionControl: false}); MAPE = mp;
  L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {maxZoom: 13}).addTo(mp);
  const et = (n, val, col) => L.divIcon({className: "", iconSize: null, html: `<div style="transform:translate(-50%,-50%);white-space:nowrap;background:#0d1117e6;border:1.5px solid ${val == null ? "#8b949e" : col};border-radius:7px;padding:1px 6px;font:600 11px system-ui;color:#e6edf3;text-align:center">${esc(n)}<br><b style="font-size:13px;color:${val == null ? "#8b949e" : col}">${val == null ? "s/d" : (Math.round(val * 10) / 10) + " " + un}</b></div>`});
  const ext = h.regla === "ZE05" || h.regla === "ZE08" ? (h.regla === "ZE08" ? "amp" : /mínima/.test(h.msg || "") ? "min" : "max") : null;
  if (ext) tit.innerHTML = `<b>${ext === "min" ? "Ts mínima" : ext === "max" ? "Ts máxima" : "Amplitud de Ts"}</b> de las 24 h hasta las ${esc(hora.slice(11, 16))} UTC del ${esc(hora.slice(8, 10) + "/" + hora.slice(5, 7))}`;
  const valor = async c => { if (ext) try { const F = (await SG.minuto(c, t0 - 24 * 3600e3, t0 + 60e3)).filter(o => o.T != null); if (F.length < 600) return null;
      const mn = Math.min(...F.map(o => o.T)), mx = Math.max(...F.map(o => o.T)); return ext === "min" ? mn : ext === "max" ? mx : mx - mn; } catch (z) { return null; }
    try { const a = v === "rr1m" ? t0 - 3 * 3600e3 : t0 - 15 * 60e3, b = t0 + (v === "rr1m" ? 0 : 15 * 60e3), F = await SG.minuto(c, a, b + 60e3);
    if (v === "rr1m"){ const x = F.filter(o => o.rr1m != null); return x.length >= 120 ? x.reduce((s, o) => s + o.rr1m, 0) : null; }
    const x = F.filter(o => o[v] != null).sort((p, q) => Math.abs(p.t - t0) - Math.abs(q.t - t0)); return x.length ? x[0][v] : null; } catch (z) { return null; } };
  const pts = [[e.lat, e.lon]], m0 = L.marker([e.lat, e.lon], {icon: et(e.nombre, null, "#f85149"), zIndexOffset: 1000}).addTo(mp);
  valor(e.codigo).then(y => m0.setIcon(et(e.nombre, y, "#f85149")));
  const km = (a, b) => { const r = Math.PI / 180, q = Math.sin((b.lat - a.lat) * r / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin((b.lon - a.lon) * r / 2) ** 2; return Math.round(12742 * Math.asin(Math.sqrt(q))); };
  V2.forEach(w => { const x = E.find(z => z.codigo === w.codigo); if (!x || x.lat == null) return; pts.push([x.lat, x.lon]); const n = `${w.nombre} · ${km(e, x)} km`;
    const mk = L.marker([x.lat, x.lon], {icon: et(n, null, "#58a6ff")}).addTo(mp); valor(w.codigo).then(y => mk.setIcon(et(n, y, "#58a6ff"))); });
  if (pts.length > 1) mp.fitBounds(pts, {padding: [50, 50], maxZoom: 10}); else mp.setView(pts[0], 9);
}
// Boletín automático: mismo formato del Boletín diario (mínima y máxima con su hora y precipitación), de las estaciones sin observador, armado con los minutos
function pintarBol(F){
  const f = v => v == null ? "—" : String(v), fuera = v => v != null && (v < -35 || v > 45);
  const L = [...F].sort((a, b) => (b.e.lat ?? -99) - (a.e.lat ?? -99)).map(({e, H}) => ({e, H, b: e.bol || {}}));
  const dia = (L.find(x => x.b.dia) || {}).b?.dia;
  const mot = (x, k) => { if (fuera(x.b[k])) return "Fuera de rango físico: picos del sensor"; const r = x.H.find(h => ["ZE04", "ZE05", "ZE07", "ZE08"].includes(h.regla) && h.msg.includes(k === "tmin" ? "mínima" : "máxima")); return r ? r.msg : ""; };
  const est = (x, k) => { const m = mot(x, k); return m ? (fuera(x.b[k]) ? "color:var(--err);font-weight:700" : `color:${NIVC[(x.H.find(h => h.msg === m) || {}).nivel] || "var(--err)"};font-weight:700`) : ""; };
  const nMal = L.filter(x => mot(x, "tmin") || mot(x, "tmax")).length, n = L.filter(x => x.b.n).length;
  $("#zOut").innerHTML = !dia ? `<p style="color:var(--sos)">El boletín automático se arma en la próxima pasada del control.</p>` :
    `<div class="htools"><span class="tag">Día ${esc(dia.split("-").reverse().join("/"))} (hora local, 00–24 h) · calculado con los datos por minuto</span></div>
    <div class="hres">${kpi(n, "estaciones con datos", "var(--tx)")}${kpi(nMal, "con extremas dudosas", nMal ? "var(--err)" : "var(--ok)")}</div>
    <div class="bcard" style="padding:0;max-height:700px;overflow:auto"><table class="xtab"><thead>
      <tr><th rowspan="2">Estación</th><th colspan="2" style="text-align:center">Temperatura mínima (°C)</th><th colspan="2" style="text-align:center">Temperatura máxima (°C)</th><th rowspan="2">Precipitación 24 h (mm)</th><th rowspan="2">Minutos con dato</th></tr>
      <tr><th>Valor</th><th>Hora</th><th>Valor</th><th>Hora</th></tr></thead>
    <tbody>${L.map(x => `<tr><td class="nom"><b>${esc(x.e.nombre)}</b><br><small>${x.e.codigo}</small></td>
      <td class="n" style="${est(x, "tmin")}" title="${esc(mot(x, "tmin"))}">${f(x.b.tmin)}</td><td class="n">${f(x.b.tmin_h)}</td>
      <td class="n" style="${est(x, "tmax")}" title="${esc(mot(x, "tmax"))}">${f(x.b.tmax)}</td><td class="n">${f(x.b.tmax_h)}</td>
      <td class="n" style="${(x.b.rr || 0) > 0 ? "color:var(--oro);font-weight:700" : ""}">${f(x.b.rr)}</td><td class="n" style="${x.b.n != null && x.b.n < 1200 ? "color:var(--sos)" : ""}">${f(x.b.n)}</td></tr>`).join("")}</tbody></table></div>
    <p class="nota" style="color:var(--mu);font-size:12px;margin:4px 0">Estaciones automáticas sin observador (no incluye las DMC con observador), de norte a sur. Día local de ayer (00 a 24 h, UTC−3); horas locales. En rojo o amarillo, extremas fuera de rango o marcadas por el control (pase el mouse para ver el motivo). Minutos con dato en amarillo: menos de 20 h, día incompleto.</p>`;
}
// Agua caída: como el Boletín diario pero de las estaciones automáticas sin observador; toda el agua caída tal cual, por día y por bloque de 6 h
let diaAgua = null;
async function pintarAgua(F){
  const S = getR().super || {}, gen = (S.generado || new Date().toISOString()).slice(0, 10); diaAgua = diaAgua || gen;
  const dia = diaAgua, c = $("#zOut");
  c.innerHTML = `<div class="htools"><button id="aAnt">◀</button><input type="date" id="aDia" value="${dia}"><button id="aSig">▶</button><span class="tag">Día UTC (00–24 h) · suma del agua caída por minuto</span></div><div id="aOut"><p style="color:var(--mu)">Cargando…</p></div>`;
  const M = await SG.diarioMes(dia.slice(0, 7).replace("-", "/")); if (diaAgua !== dia || modo !== "sup_pp") return;
  const D = M && M.dias && M.dias[dia], cm = (M || {}).campos || [], ix = k => cm.indexOf(k), f = v => v == null ? "—" : String(v);
  const L = [...F].sort((a, b) => (b.e.lat ?? -99) - (a.e.lat ?? -99)).map(({e}) => { const v = D && D[e.codigo]; return {e, v, g: k => v && ix(k) >= 0 ? v[ix(k)] : null}; });
  const con = L.filter(x => (x.g("rr") || 0) > 0), mx = con.reduce((a, x) => !a || x.g("rr") > a.g("rr") ? x : a, null);
  const celda = v => `<td class="n" style="${(v || 0) > 0 ? "color:var(--oro);font-weight:700" : ""}">${f(v)}</td>`;
  $("#aOut").innerHTML = !D ? `<p style="color:var(--sos)">No hay resumen de agua caída para el ${esc(dia)} (el archivo parte el 8/11/2026 y se completa con cada pasada del control).</p>` :
    `<div class="bcard" style="padding:0;max-height:680px;overflow:auto"><table class="xtab"><thead><tr><th>Estación</th><th>00–06 <small>(mm)</small></th><th>06–12 <small>(mm)</small></th><th>12–18 <small>(mm)</small></th><th>18–24 <small>(mm)</small></th><th>Total del día <small>(mm)</small></th><th>Máx. en 1 min <small>(mm)</small></th><th>Minutos con dato</th></tr></thead>
    <tbody>${L.map(x => `<tr data-ir="${x.e.codigo}" data-tp="pp" style="cursor:pointer"><td class="nom"><b>${esc(x.e.nombre)}</b><br><small>${x.e.codigo}</small></td>${["rr_b0", "rr_b1", "rr_b2", "rr_b3"].map(k => celda(x.g(k))).join("")}<td class="n" style="${(x.g("rr") || 0) > 0 ? "color:var(--oro);font-weight:700" : ""}"><b>${f(x.g("rr"))}</b></td>${celda(x.g("rrmax"))}<td class="n">${f(x.g("n"))}</td></tr>`).join("")}</tbody></table></div>
    <p class="nota" style="color:var(--mu);font-size:12px;margin:4px 0">Estaciones automáticas sin observador, de norte a sur. «—» es sin pluviómetro o con menos de 10 h de datos. Haga clic en una estación para ver sus gráficos.</p>`;
}
document.addEventListener("click", ev => { const b = ev.target.closest("#aAnt, #aSig"); if (!b || !diaAgua) return; const d = new Date(diaAgua + "T12:00Z"); d.setUTCDate(d.getUTCDate() + (b.id === "aAnt" ? -1 : 1)); diaAgua = d.toISOString().slice(0, 10); pintar(); });
document.addEventListener("change", ev => { if (ev.target.id === "aDia" && ev.target.value){ diaAgua = ev.target.value; pintar(); } });
document.addEventListener("click", ev => {
  const es = ev.target.closest("tr[data-es]"); if (es){ selEst = es.dataset.es; const F = filas(); document.querySelectorAll("tr[data-es]").forEach(x => x.style.background = x === es ? "color-mix(in srgb,var(--oro) 18%,transparent)" : ""); const e = (F.find(x => x.e.codigo === selEst) || {}).e; e && abrirEst(e); return; }
  const al = ev.target.closest("tr.supal"); if (al && !ev.target.closest(".mk, a")){
    const tab = al.closest("table"), todas = [...tab.querySelectorAll("tr.supal")];
    const sig = al.nextElementSibling; if (sig && sig.classList.contains("supx")){ sig.remove(); todas.forEach(r => r.style.display = ""); document.querySelectorAll(".supDatosSec").forEach(d => d.style.display = ""); al.scrollIntoView({block: "nearest"}); return; }
    // una alerta a la vez: al abrirla se ocultan las demás; al cerrarla vuelven todas
    tab.querySelectorAll("tr.supx").forEach(r => r.remove()); todas.forEach(r => r.style.display = r === al ? "" : "none"); document.querySelectorAll(".supDatosSec").forEach(d => d.style.display = "none"); al.scrollIntoView({block: "start"});
    const F = filas(), x = F.find(y => y.e.codigo === al.dataset.c); if (!x) return;
    const tr = document.createElement("tr"); tr.className = "supx";
    if (modo === "sup_esp" || modo === "obs_esp" || ESP.has(al.dataset.r)){      // control espacial (o alerta espacial en cualquier pestaña): gráficos ya comparados con las vecinas y mapa con sus valores a la derecha
      tr.innerHTML = `<td colspan="7"><div style="display:flex;gap:12px;flex-wrap:wrap;align-items:flex-start"><div class="supbox" data-c="${al.dataset.c}" style="flex:1 1 560px;min-width:0"></div>
        <div style="flex:0 1 420px;min-width:300px"><div class="espMapT" style="font-size:12.5px;margin-bottom:4px"></div><div class="espMap" style="height:420px;border:1px solid var(--bd);border-radius:8px"></div>
        <small style="color:var(--mu)">Rojo = la estación · azul = vecinas DMC (valor a la hora de la alerta) · gris = sin dato</small></div></div></td>`; al.after(tr);
      const box = tr.querySelector(".supbox"), V2 = window.supVec ? window.supVec(al.dataset.c) : [];
      box.dataset.vec = V2.slice(0, 4).map(v => v.codigo).join(",");
      const h = x.H.find(z => z.hora === al.dataset.h && z.regla === al.dataset.r) || x.H.find(z => z.hora === al.dataset.h && ESP.has(z.regla)) || {};
      SG.alerta(box, {...x.e, hallazgos: x.H}, x.H, (VAR_R[h.regla] || [al.dataset.tp])[0], al.dataset.h);
      mapaEsp(tr.querySelector(".espMap"), tr.querySelector(".espMapT"), x.e, V2, h, al.dataset.h); return; }
    tr.innerHTML = `<td colspan="5"><div class="supbox" data-c="${al.dataset.c}"></div></td>`; al.after(tr);
    SG.alerta(tr.querySelector(".supbox"), {...x.e, hallazgos: x.H}, x.H, al.dataset.tp, al.dataset.h); return; }
  const r = ev.target.closest("tr[data-ir]"); if (r && !ev.target.closest("a")){ window.supIr(r.dataset.ir, r.dataset.tp); return; } const a = ev.target.closest("a[data-sup]"); if (!a) return; ev.preventDefault(); q = ""; window.cambiarModo(a.dataset.sup); });
window.SUPER = {init, pintar, indice: indiceCtl, CTL, tipoCtl, modos: new Set(["sup", "sup_pp", "sup_est", "sup_bol", ...Object.keys(TABS)])};
})();
