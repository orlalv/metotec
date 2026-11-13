/* «Super automático»: estaciones automáticas SIN observador, con un control más estricto sobre el minutario (qc/superauto.py).
   Vista «Estaciones» (resumen por estación y variable) y una pestaña por variable: Precipitación, Extremas, Presiones, Temperaturas, Viento.
   Los datos vienen en R.super; las marcas (Resuelto / Falsa alarma / Omitir) usan el mismo mecanismo que las observaciones. */
(function(){
const $ = s => document.querySelector(s);
const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;"})[c]);
const NIVC = ["var(--ok)", "var(--sos)", "var(--err)"];
const TABS = {sup_pp: ["pp", "precipitación"], sup_ext: ["ext", "extremas"], sup_pre: ["pre", "presiones"], sup_tem: ["tem", "temperaturas (Ts, Td, HR)"], sup_vie: ["vie", "viento"]};
const COLS = [["pp", "Precipitación", "sup_pp"], ["ext", "Extremas", "sup_ext"], ["pre", "Presiones", "sup_pre"], ["tem", "Temperaturas", "sup_tem"], ["vie", "Viento", "sup_vie"]];
const NOTA = {
  pp: "Lluvia con aire seco, más de 2 mm en un minuto, el mismo valor repetido 10 minutos (pluviómetro pegado) y el acumulado de 6 h contra la suma de los minutos.",
  ext: "La temperatura mínima y máxima de 12 h que informa la estación (Tn12 y Tx12) contra la temperatura por minuto de las últimas 24 h (avisa si pasa más de 1 °C; error sobre 1,5 °C).",
  pre: "Saltos de QFE sobre 0,8 hPa en un minuto, QFE pegado 2 h, QFE lejos de lo esperado por altura, cambio sobre 8 hPa en 3 h y QFF contra el QFE reducido.",
  tem: "Saltos de Ts, Td y HR, Td mayor que Ts, HR que no calza con Ts y Td, valores pegados (Ts y Td 2 h, HR 6 h) y Ts fuera de lo habitual para la zona.",
  vie: "Cambio del viento medio sobre 10 kt en 10 min (tendencia, no minuto a minuto), viento o dirección pegados, dirección fuera de 0–360 y racha menor que el viento medio."};
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
  const [tipo, nom] = TABS[modo];
  const todas = [];
  F.forEach(({e, H}) => H.filter(h => h.tipo === tipo).forEach(h => todas.push({...h, e})));
  todas.sort((a, b) => b.nivel - a.nivel || b.hora.localeCompare(a.hora) || (a.e.nombre || "").localeCompare(b.e.nombre || ""));
  const cnt = {}; todas.forEach(f => cnt[f.regla] = (cnt[f.regla] || 0) + 1);
  const est = new Set(todas.map(f => f.e.codigo));
  $("#zOut").innerHTML = `<div class="hres">${kpi(est.size, "estaciones con alertas", "var(--oro)")}${Object.entries(cnt).sort((a, b) => b[1] - a[1]).map(([k, n]) => kpi(n, REGLAS.nombre(k), "var(--tx)")).join("")}</div>
    ${todas.length ? `<div class="bcard" style="padding:0"><table class="xtab"><tr><th>Estación</th><th>Dato UTC</th><th>Alerta</th><th>Detalle</th><th></th></tr>
      ${todas.map(f => `<tr><td class="nom"><b>${esc(f.e.nombre)}</b><br><small>${f.e.codigo}</small><br>${enlinea(f.e.codigo)}</td><td style="white-space:nowrap">${hora(f)}</td>
        <td style="color:${NIVC[f.nivel] || "inherit"};font-weight:600">${REGLAS.html(f.regla, esc)}</td>
        <td>${esc(f.msg)}${f.st === "sigue" ? MARCA.aviso : ""}</td><td style="white-space:nowrap">${MARCA.botones(f.e.codigo, f)}</td></tr>`).join("")}</table></div>`
      : `<p style="color:var(--ok)">Sin alertas de ${nom}${q ? " con ese filtro" : ""}.</p>`}
    <p class="nota" style="color:var(--mu);font-size:12px;margin-top:10px">${NOTA[tipo]} «Resuelto» quita la alerta y la manda al Historial; no vuelve mientras el dato sea el mismo.</p>`;
}
document.addEventListener("click", ev => { const a = ev.target.closest("a[data-sup]"); if (!a) return; ev.preventDefault(); q = ""; window.cambiarModo(a.dataset.sup); });
window.SUPER = {init, pintar, modos: new Set(["sup", ...Object.keys(TABS)])};
})();
