/* Revisar período: revisa días pasados de una estación con observador a partir de los mensajes METAR y SYNOP que codificó
   SACLIM (portal de climatología, público). El pedido lo atiende GitHub Actions (qc/revisar_periodo.py) en 1–3 minutos. */
(function(){
const $ = s => document.querySelector(s);
const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;"})[c]);
const NIVC = ["var(--ok)", "var(--sos)", "var(--err)"], NIVT = ["info", "revisar", "dudoso"];
const NOM = {CMS: "METAR y SYNOP no coinciden", FALTA: "Mensaje que falta", STs: "Ts frente al sensor", STd: "Td frente al sensor", SQFE: "QFE frente al sensor",
  SQFF: "QFF frente al sensor", SQNH: "QNH frente al sensor", Sff: "Viento frente al sensor", Sffkmh: "Viento en km/h", Sdd: "Dirección frente al sensor",
  Sracha: "Racha", SRRR6: "RRR6 frente al pluviómetro", SPRE: "Lluvia del pluviómetro y tiempo presente", SEXT: "Extrema: valor", SEXF: "Extrema fuera de bloque",
  E10: "Tiempo pasado W1W2", E11: "W1 sin respaldo", E12: "Precipitación con RRR6 0", E13: "RRR6 sin precipitación", E14: "ppp y QFE", E15: "Tendencia a y QFE",
  E16: "Tendencia a y QFE", E17: "Precipitación sin traza", E19: "Valor inusual", E20: "Posible error de digitación", C41: "Td mayor que Ts", C41H: "HR no calza con Ts y Td"};
let clave = () => "", getR = () => null, P = null, idAct = null, timer = null, filtro = "";

function init(fclave, fR){
  clave = fclave || clave; getR = fR || getR;
  const s = $("#per"); if (s.dataset.ok){ lista(); return; } s.dataset.ok = 1;
  const ayer = new Date(Date.now() - 864e5).toISOString().slice(0, 10), sem = new Date(Date.now() - 7 * 864e5).toISOString().slice(0, 10);
  s.innerHTML = `<div class="htools"><select id="pEst"></select><label>Desde <input type="date" id="pDes" value="${sem}" min="2000-01-01" max="${ayer}"></label>
      <label>Hasta <input type="date" id="pHas" value="${ayer}" min="2000-01-01" max="${ayer}"></label><button id="pIr" class="rvbtn" style="margin:0">Revisar período</button>
      <label class="rvbtn" style="margin:0;cursor:pointer" title="Excel de la «Extracción de datos» de SACLIM (puede elegir varios)">⬆ Subir extracción de SACLIM<input type="file" id="pArch" accept=".xlsx" multiple hidden></label>
      <span class="tag" id="pEstado"></span><button id="pXls" hidden>⬇ Excel</button></div>
    <p class="nota" style="color:var(--mu);font-size:12.5px;margin:4px 0 10px">Revisa los METAR y SYNOP que codificó SACLIM (hasta 31 días). Se aplican las reglas de las observaciones de hoy más la coherencia METAR–SYNOP
      y los mensajes que faltan. No viajan en los mensajes la HR, la hora de las extremas, Tmax AM/Tmin PM ni el ww 00–03, así que eso no se revisa. Las reglas frente al sensor solo corren desde el 8-11-2026 (minutario guardado por METOTEC).</p>
    <div id="pLista"></div><div id="pOut"></div>`;
  const E = ((getR() || {}).observaciones || {}).estaciones || [];
  $("#pEst").innerHTML = E.slice().sort((a, b) => (a.nombre || "").localeCompare(b.nombre || "")).map(e => `<option value="${e.codigo}">${esc(e.nombre)} (${e.codigo})</option>`).join("")
    || `<option value="180005">Chacalluta (180005)</option>`;
  $("#pIr").addEventListener("click", pedir); $("#pArch").addEventListener("change", subir); $("#pXls").addEventListener("click", excel);
  s.addEventListener("click", ev => {
    const l = ev.target.closest("[data-pid]"); if (l){ abrir(l.dataset.pid); return; }
    const f = ev.target.closest("[data-pf]"); if (f){ filtro = filtro === f.dataset.pf ? "" : f.dataset.pf; pintar(); return; }
    const m = ev.target.closest("[data-msj]"); if (m){ const r = m.closest("tr").nextElementSibling; r.hidden = !r.hidden; }
  });
  lista();
}

const H = () => ({"x-clave": clave(), "Content-Type": "application/json"});
async function lista(){
  try {
    const L = await (await fetch("/api/periodo", {headers: H(), cache: "no-store"})).json();
    $("#pLista").innerHTML = L.length ? `<div style="font-size:12.5px;color:var(--mu);margin-bottom:8px">Revisiones anteriores: ${L.slice(0, 10).map(x =>
      `<a data-pid="${esc(x.id)}" style="cursor:pointer;color:var(--oro);margin-right:10px">${x.tipo === "archivo" ? "archivo " + esc((x.nombres || [])[0] || "") + " · " + new Date(x.pedido).toLocaleString("es-CL", {dateStyle: "short", timeStyle: "short"})
        : esc(x.cod) + " · " + x.desde.slice(8, 10) + "/" + x.desde.slice(5, 7) + "–" + x.hasta.slice(8, 10) + "/" + x.hasta.slice(5, 7) + "/" + x.hasta.slice(0, 4)}</a>`).join("")}</div>` : "";
  } catch (e){}
}
async function subir(ev){
  const fs = [...ev.target.files]; if (!fs.length) return;
  const claves = [];
  for (const [i, f] of fs.entries()){
    $("#pEstado").textContent = `Subiendo ${f.name} (${i + 1} de ${fs.length}, ${(f.size / 1048576).toFixed(1)} MB)…`;
    const r = await fetch("/api/subir", {method: "POST", headers: {"x-clave": clave()}, body: f});
    if (!r.ok){ $("#pEstado").textContent = `${f.name}: ${await r.text()}`; ev.target.value = ""; return; }
    claves.push((await r.json()).clave);
  }
  ev.target.value = "";
  const r = await fetch("/api/periodo", {method: "POST", headers: H(), body: JSON.stringify({archivos: claves, nombres: fs.map(f => f.name)})});
  if (!r.ok){ $("#pEstado").textContent = await r.text(); return; }
  const {id} = await r.json(); lista(); abrir(id);
}
// el campo de fecha deja escribir el año con 2 dígitos («24» queda como 0024): se corrige a 2024
const fecha = el => { let x = el.value; const m = x.match(/^(\d{4})-(\d\d)-(\d\d)$/); if (m && +m[1] < 100){ x = `${2000 + +m[1]}-${m[2]}-${m[3]}`; el.value = x; } return x; };
async function pedir(){
  const b = {cod: $("#pEst").value, desde: fecha($("#pDes")), hasta: fecha($("#pHas"))};
  if (!b.desde || !b.hasta){ $("#pEstado").textContent = "Falta una fecha"; return; }
  if (b.desde < "2000-01-01"){ $("#pEstado").textContent = "Revise el año de la fecha inicial"; return; }
  const dias = (Date.parse(b.hasta) - Date.parse(b.desde)) / 864e5 + 1;
  if (dias < 1){ $("#pEstado").textContent = "La fecha final es anterior a la inicial"; return; }
  if (dias > 31){ $("#pEstado").textContent = `Son ${dias} días: el máximo es 31 por revisión`; return; }
  $("#pEstado").textContent = "Enviando…";
  const r = await fetch("/api/periodo", {method: "POST", headers: H(), body: JSON.stringify(b)});
  if (!r.ok){ $("#pEstado").textContent = await r.text(); return; }
  const {id} = await r.json(); lista(); abrir(id);
}
async function abrir(id){
  idAct = id; clearTimeout(timer);
  let r; try { r = await (await fetch("/api/periodo?id=" + encodeURIComponent(id), {headers: H(), cache: "no-store"})).json(); } catch (e){ $("#pEstado").textContent = "No se pudo consultar"; return; }
  if (id !== idAct) return;
  if (r.estado === "pendiente" || r.estado === "revisando"){
    $("#pEstado").textContent = r.estado === "pendiente" ? "En cola: comienza en menos de un minuto…" : "Bajando y revisando los mensajes…";
    $("#pOut").innerHTML = `<p style="color:var(--mu)">Revisando ${esc(r.cod)} del ${esc(r.desde)} al ${esc(r.hasta)}. Tarda 1 a 3 minutos; esta página se actualiza sola.</p>`;
    $("#pXls").hidden = true; timer = setTimeout(() => abrir(id), 10e3); return;
  }
  if (r.estado === "error"){ $("#pEstado").textContent = "Error: " + (r.error || ""); return; }
  P = r; filtro = ""; $("#pXls").hidden = false; pintar();
}

function pintar(){
  if (!P) return;
  const hs = P.hallazgos || [], cnt = {}, porDia = {};
  hs.forEach(h => { cnt[h.regla] = (cnt[h.regla] || 0) + 1; const d = h.hora.slice(0, 10); (porDia[d] = porDia[d] || [0, 0, 0])[h.nivel]++; });
  const n2 = hs.filter(h => h.nivel === 2).length, n1 = hs.filter(h => h.nivel === 1).length;
  $("#pEstado").textContent = `${P.nombre || P.codigo} · ${P.desde} a ${P.hasta} · revisado ${new Date(P.generado).toLocaleString("es-CL", {dateStyle: "short", timeStyle: "short"})}`;
  const V = hs.filter(h => !filtro || h.regla === filtro);
  const reglas = Object.entries(cnt).sort((a, b) => b[1] - a[1]);
  const dias = Object.keys(porDia).sort(), multiA = (P.desde || "").slice(0, 4) !== (P.hasta || "").slice(0, 4), multiE = (P.estaciones || []).length > 1;
  $("#pOut").innerHTML = `<div class="hres"><div><b>${P.dias}</b><span>días</span></div>${P.origen === "archivo" ? `<div><b>${(P.estaciones || []).reduce((a, e) => a + e.horas, 0)}</b><span>horas (extracción SACLIM)</span></div><div><b>${(P.estaciones || []).length}</b><span>estaciones</span></div>`
        : `<div><b>${P.metar}</b><span>METAR</span></div><div><b>${P.synop}</b><span>SYNOP</span></div>`}
      <div><b style="color:var(--err)">${n2}</b><span>dudosos</span></div><div><b style="color:var(--sos)">${n1}</b><span>para revisar</span></div>
      <div><b>${P.con_ema ? "sí" : "no"}</b><span>minutario EMA</span></div></div>
    ${(P.fallas || []).length ? `<p style="color:var(--sos);font-size:12.5px">No se pudieron bajar: ${P.fallas.map(esc).join("; ")}</p>` : ""}
    <div style="display:flex;gap:18px;flex-wrap:wrap;align-items:flex-start;margin:10px 0">
      <div><h4 style="margin:0 0 6px">Por regla</h4><table class="sgtab">${reglas.map(([k, n]) => `<tr data-pf="${esc(k)}" style="cursor:pointer" class="${filtro === k ? "on" : ""}"><td>${esc(NOM[k] || k)} <small style="color:var(--mu)">${esc(k)}</small></td><td>${n}</td></tr>`).join("") || "<tr><td>Sin hallazgos</td></tr>"}</table>
        ${filtro ? `<a data-pf="${esc(filtro)}" style="cursor:pointer;color:var(--oro);font-size:12px">ver todas</a>` : ""}</div>
      <div><h4 style="margin:0 0 6px">Por día</h4><table class="sgtab"><tr><th>Día</th><th>dudosos</th><th>revisar</th></tr>${dias.map(d => `<tr><td>${d.slice(8, 10)}/${d.slice(5, 7)}${multiA ? "/" + d.slice(2, 4) : ""}</td><td style="color:var(--err)">${porDia[d][2] || ""}</td><td style="color:var(--sos)">${porDia[d][1] || ""}</td></tr>`).join("")}</table></div></div>
    ${V.length ? `<table><tr><th>Día y hora UTC</th>${multiE ? "<th>Estación</th>" : ""}<th>Nivel</th><th>Regla</th><th>Detalle</th><th></th></tr>${V.slice(0, 1500).map(h => {
      const m = (P.mensajes || {})[h.hora.slice(0, 19)] || {};
      return `<tr><td style="white-space:nowrap">${h.hora.slice(8, 10)}/${h.hora.slice(5, 7)}${multiA ? "/" + h.hora.slice(2, 4) : ""} ${h.hora.slice(11, 16)}</td>${multiE ? `<td>${esc(h.nombre || h.codigo)}</td>` : ""}<td style="color:${NIVC[h.nivel]}">${NIVT[h.nivel]}</td><td>${esc(NOM[h.regla] || h.regla)}<br><small style="color:var(--mu)">${esc(h.regla)}</small></td><td>${esc(h.msg)}</td>
        <td>${m.metar || m.synop ? `<button class="sgbtn" data-msj>mensajes</button>` : ""}</td></tr><tr hidden><td colspan="5" style="font:12px var(--mono);color:var(--mu)">${m.metar ? esc(m.metar) + "<br>" : ""}${m.synop ? esc(m.synop) : ""}</td></tr>`; }).join("")}</table>`
      : `<p style="color:var(--ok)">Sin hallazgos en el período.</p>`}`;
}

function excel(){
  if (!P) return;
  const b = "border:1px solid #DEE2E6;", cab = ["Estación", "Código", "Día y hora UTC", "Nivel", "Regla", "Nombre de la regla", "Detalle", "METAR", "SYNOP"];
  const filas = (P.hallazgos || []).map(h => { const m = (P.mensajes || {})[h.hora.slice(0, 19)] || {};
    return `<tr>${[P.nombre || "", P.codigo, h.hora.slice(0, 16), NIVT[h.nivel], h.regla, NOM[h.regla] || "", h.msg, m.metar || "", m.synop || ""].map(x => `<td style="${b}mso-number-format:'\\@'">${esc(x)}</td>`).join("")}</tr>`; }).join("");
  const html = `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel"><head><meta charset="utf-8"></head><body><table style="font-family:Arial;font-size:10pt">
    <tr><td colspan="9" style="background:#2D4356;color:#fff;font-weight:bold;font-size:14pt">Revisión de período · ${esc(P.nombre || P.codigo)} · ${P.desde} a ${P.hasta}</td></tr>
    <tr><td colspan="9">${P.dias} días · ${P.metar} METAR · ${P.synop} SYNOP · minutario EMA: ${P.con_ema ? "sí" : "no"}</td></tr><tr></tr>
    <tr>${cab.map(x => `<td style="${b}background:#84A7A1;font-weight:bold">${x}</td>`).join("")}</tr>${filas}</table></body></html>`;
  const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob(["\ufeff" + html], {type: "application/vnd.ms-excel"}));
  a.download = `revision_${P.codigo}_${P.desde}_${P.hasta}.xls`; a.click();
}
window.PER = {init};
})();
