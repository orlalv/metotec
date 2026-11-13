/* «Super automático»: estaciones automáticas SIN observador, con un control más estricto sobre el minutario (qc/superauto.py).
   Vista «Estaciones» (resumen por estación y variable) y una pestaña por variable: Precipitación, Extremas, Presiones, Temperaturas, Viento.
   Los datos vienen en R.super; las marcas (Resuelto / Falsa alarma / Omitir) usan el mismo mecanismo que las observaciones. */
(function(){
const $ = s => document.querySelector(s);
const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;"})[c]);
const NIVC = ["var(--ok)", "var(--sos)", "var(--err)"];
const TABS = {sup_prc: ["pp", "precipitación"], sup_ext: ["ext", "extremas"], sup_pre: ["pre", "presiones"], sup_tem: ["tem", "temperaturas (Ts, Td, HR)"], sup_vie: ["vie", "viento"]};
const COLS = [["pp", "Precipitación", "sup_prc"], ["ext", "Extremas", "sup_ext"], ["pre", "Presiones", "sup_pre"], ["tem", "Temperaturas", "sup_tem"], ["vie", "Viento", "sup_vie"]];
const NOTA = {
  pp: "Agua caída del pluviómetro: lluvia con aire seco, más de 2 mm en un minuto, el mismo valor repetido 10 minutos (pluviómetro pegado) y el acumulado de 6 h contra la suma de los minutos.",
  ext: "La temperatura mínima y máxima de 12 h que informa la estación (Tn12 y Tx12) contra la temperatura por minuto de las últimas 24 h (avisa si pasa más de 1 °C; error sobre 1,5 °C).",
  pre: "QFF contra la mediana de las vecinas y contra el modelo (diferencia sostenida en 2 de las últimas 3 horas), QFE pegado 3 h, QFE lejos de lo esperado por altura, saltos groseros, cambio sobre 10 hPa en 3 h y QFF contra el QFE reducido.",
  tem: "Ts, Td y HR contra la mediana de las vecinas (≥ 3, corregida por altura) y contra el modelo, con diferencia sostenida en 2 de las últimas 3 horas; Td mayor que Ts, HR que no calza con Ts y Td, valores pegados (3 h; HR 8 h), saltos groseros y Ts fuera de lo habitual para la zona.",
  vie: "Viento contra el modelo (sostenido), cambio del viento medio sobre 15 kt en 10 min, viento o dirección pegados, dirección fuera de 0–360 y racha menor que el viento medio."};
// columnas de la tabla de datos de cada pestaña: [campo del resumen, título, unidad]
const DATOS = {
  pp: [["rr_24h", "Lluvia 24 h (suma de minutos)", "mm"], ["rr_1h", "Lluvia última hora", "mm"], ["rr_min", "Máx. en un minuto", "mm"], ["rr6", "RRR6 informada", "mm"], ["rr24", "RRR24 informada", "mm"], ["HR", "HR", "%"]],
  ext: [["Tmin24", "Ts mínima 24 h (por minuto)", "°C"], ["Tmax24", "Ts máxima 24 h (por minuto)", "°C"], ["Tn12", "Mínima 12 h informada (Tn12)", "°C"], ["Tx12", "Máxima 12 h informada (Tx12)", "°C"]],
  pre: [["P_est", "QFE", "hPa"], ["P_mar", "QFF", "hPa"], ["dP3", "Cambio del QFE en 3 h", "hPa"]],
  tem: [["T", "Ts", "°C"], ["Td", "Td", "°C"], ["HR", "HR", "%"], ["Tmin24", "Ts mín. 24 h", "°C"], ["Tmax24", "Ts máx. 24 h", "°C"]],
  vie: [["ff10", "Viento medio 10 min", "kt"], ["fx10", "Racha", "kt"], ["dd10", "Dirección", "°"], ["ffmax24", "Viento máx. 24 h", "kt"], ["fxmax24", "Racha máx. 24 h", "kt"]]};
let getR = () => null, modo = "sup", q = "";

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
  (S.estaciones || []).forEach(e => {
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
  $("#zHora").textContent = g ? `Estaciones sin observador · revisadas a las ${g.toLocaleTimeString("es-CL", {hour: "2-digit", minute: "2-digit"})} · últimas 24 h` : "Todavía no hay revisión del Super automático";
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
      <p class="nota" style="color:var(--mu);font-size:12px;margin-top:10px">Control más estricto que el de «Estaciones automáticas» (umbrales cerca de la mitad), solo para estaciones sin observador. Avisa antes y puede dar más falsas alarmas: use ✗ para registrarlas. Cada pestaña muestra el detalle por variable.</p>`;
    return;
  }
  if (modo === "sup_pp") return pintarAgua(F);
  if (modo === "sup_est") return pintarEst(F);
  const [tipo, nom] = TABS[modo];
  const todas = [], calza = [];
  F.forEach(({e, H}) => { H.filter(h => h.tipo === tipo).forEach(h => todas.push({...h, e}));
    if (tipo === "pp") ((e.res || {}).blq6 || []).forEach(([hr, inf, suma]) => { if (inf != null && suma != null && !H.some(h => h.regla === "ZR05" && h.hora === hr)) calza.push({e, hora: hr, nivel: 0, regla: "ZR05ok", tipo: "pp", ingresado: `RRR6 ${inf} mm`, deberia: `${suma} mm`, msg: "El RRR6 de la estación coincide con la suma del agua caída por minuto."}); }); });
  todas.sort((a, b) => b.hora.localeCompare(a.hora) || b.nivel - a.nivel || (a.e.nombre || "").localeCompare(b.e.nombre || ""));
  calza.sort((a, b) => b.hora.localeCompare(a.hora) || (a.e.nombre || "").localeCompare(b.e.nombre || ""));
  const cnt = {}; todas.forEach(f => cnt[f.regla] = (cnt[f.regla] || 0) + 1);
  const est = new Set(todas.map(f => f.e.codigo));
  const fila = f => `<tr class="supal" data-c="${f.e.codigo}" data-h="${esc(f.hora)}" data-tp="${f.tipo}" style="cursor:pointer" title="Ver gráfico y tabla"><td class="nom"><b>${esc(f.e.nombre)}</b><br><small>${f.e.codigo}</small><br>${enlinea(f.e.codigo)}</td><td style="white-space:nowrap">${hora(f)}</td>
        <td style="color:${f.regla === "ZR05ok" ? "var(--ok)" : NIVC[f.nivel] || "inherit"};font-weight:600">${f.regla === "ZR05ok" ? "✓ RRR6 calza" : REGLAS.html(f.regla, esc)}</td><td class="n">${esc(f.ingresado || "—")}</td><td class="n" style="color:var(--oro)">${esc(f.deberia || "")}</td>
        <td>${esc(f.msg)}${f.st === "sigue" ? MARCA.aviso : ""}</td><td style="white-space:nowrap">${f.regla === "ZR05ok" ? "" : MARCA.botones(f.e.codigo, f)}</td></tr>`;
  const cab = `<tr><th>Estación</th><th>Obs. UTC</th><th>Alerta</th><th>Ingresado</th><th>Debería ir</th><th>Detalle</th><th></th></tr>`;
  $("#zOut").innerHTML = `<div class="hres">${kpi(est.size, "estaciones con alertas", "var(--oro)")}${Object.entries(cnt).sort((a, b) => b[1] - a[1]).map(([k, n]) => kpi(n, REGLAS.nombre(k), "var(--tx)")).join("")}${tipo === "pp" ? kpi(calza.length, "bloques de 6 h que calzan", "var(--ok)") : ""}</div>
    ${todas.length ? `<div class="bcard" style="padding:0"><table class="xtab">${cab}${todas.map(fila).join("")}</table></div>` : `<p style="color:var(--ok)">Sin alertas de ${nom}${q ? " con ese filtro" : ""}.</p>`}
    ${tipo === "pp" && calza.length ? `<h3 style="margin:16px 0 6px;font:600 15px var(--titulo)">RRR6 que calza con el pluviómetro (con lluvia)</h3><div class="bcard" style="padding:0;max-height:420px;overflow:auto"><table class="xtab">${cab}${calza.map(fila).join("")}</table></div>` : ""}
    ${tipo === "pp" ? "" : `<h3 style="margin:16px 0 6px;font:600 15px var(--titulo)">Datos de las estaciones sin observador · ${esc(nom)}</h3>
    <div class="bcard" style="padding:0;max-height:520px;overflow:auto"><table class="xtab"><tr><th>Estación</th><th>Último dato UTC</th>${DATOS[tipo].map(c => `<th>${esc(c[1])}${c[2] ? ` <small>(${c[2]})</small>` : ""}</th>`).join("")}<th>Alertas</th></tr>
      ${filasDatos(F, tipo)}</table></div>`}
    <p class="nota" style="color:var(--mu);font-size:12px;margin-top:10px">Haga clic en una fila para ver su gráfico y su tabla. ${NOTA[tipo]} «Resuelto» quita la alerta y la manda al Historial; no vuelve mientras el dato sea el mismo.</p>`;
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
    `<div class="hres">${kpi(L.filter(x => x.v).length, "estaciones con datos", "var(--tx)")}${kpi(con.length, "con agua caída", "var(--oro)")}${kpi(mx ? mx.g("rr") + " mm" : "—", mx ? "máxima: " + mx.e.nombre : "máxima del día", "var(--tx)")}</div>
    <div class="bcard" style="padding:0;max-height:680px;overflow:auto"><table class="xtab"><thead><tr><th>Estación</th><th>00–06 <small>(mm)</small></th><th>06–12 <small>(mm)</small></th><th>12–18 <small>(mm)</small></th><th>18–24 <small>(mm)</small></th><th>Total del día <small>(mm)</small></th><th>Máx. en 1 min <small>(mm)</small></th><th>Minutos con dato</th></tr></thead>
    <tbody>${L.map(x => `<tr data-ir="${x.e.codigo}" data-tp="pp" style="cursor:pointer"><td class="nom"><b>${esc(x.e.nombre)}</b><br><small>${x.e.codigo}</small></td>${["rr_b0", "rr_b1", "rr_b2", "rr_b3"].map(k => celda(x.g(k))).join("")}<td class="n" style="${(x.g("rr") || 0) > 0 ? "color:var(--oro);font-weight:700" : ""}"><b>${f(x.g("rr"))}</b></td>${celda(x.g("rrmax"))}<td class="n">${f(x.g("n"))}</td></tr>`).join("")}</tbody></table></div>
    <p class="nota" style="color:var(--mu);font-size:12px;margin:4px 0">Estaciones automáticas sin observador, de norte a sur. «—» es sin pluviómetro o con menos de 10 h de datos. Haga clic en una estación para ver sus gráficos.</p>`;
}
document.addEventListener("click", ev => { const b = ev.target.closest("#aAnt, #aSig"); if (!b || !diaAgua) return; const d = new Date(diaAgua + "T12:00Z"); d.setUTCDate(d.getUTCDate() + (b.id === "aAnt" ? -1 : 1)); diaAgua = d.toISOString().slice(0, 10); pintar(); });
document.addEventListener("change", ev => { if (ev.target.id === "aDia" && ev.target.value){ diaAgua = ev.target.value; pintar(); } });
document.addEventListener("click", ev => {
  const es = ev.target.closest("tr[data-es]"); if (es){ selEst = es.dataset.es; const F = filas(); document.querySelectorAll("tr[data-es]").forEach(x => x.style.background = x === es ? "color-mix(in srgb,var(--oro) 18%,transparent)" : ""); const e = (F.find(x => x.e.codigo === selEst) || {}).e; e && abrirEst(e); return; }
  const al = ev.target.closest("tr.supal"); if (al && !ev.target.closest(".mk, a")){
    const sig = al.nextElementSibling; if (sig && sig.classList.contains("supx")){ sig.remove(); return; }
    const F = filas(), x = F.find(y => y.e.codigo === al.dataset.c); if (!x) return;
    const tr = document.createElement("tr"); tr.className = "supx"; tr.innerHTML = `<td colspan="5"><div class="supbox" data-c="${al.dataset.c}"></div></td>`; al.after(tr);
    SG.alerta(tr.querySelector(".supbox"), {...x.e, hallazgos: x.H}, x.H, al.dataset.tp, al.dataset.h); return; }
  const r = ev.target.closest("tr[data-ir]"); if (r && !ev.target.closest("a")){ window.supIr(r.dataset.ir, r.dataset.tp); return; } const a = ev.target.closest("a[data-sup]"); if (!a) return; ev.preventDefault(); q = ""; window.cambiarModo(a.dataset.sup); });
window.SUPER = {init, pintar, modos: new Set(["sup", "sup_pp", "sup_est", ...Object.keys(TABS)])};
})();
