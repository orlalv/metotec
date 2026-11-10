/* Series de temperatura: control de calidad de las máximas y mínimas diarias históricas (anuarios del portal).
   El barrido y la revisión los hace qc/correr_series.py en GitHub (semanal el año en curso, mensual todo). */
(function(){
const $ = s => document.querySelector(s);
const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;"})[c]);
const NIVT = ["info", "revisar", "dudoso"], NIVC = ["var(--info)", "var(--sos)", "var(--err)"];
const NOM = {RANGO: "Fuera de rango físico", TNTX: "Mínima mayor que máxima", IGUAL: "Mínima igual a máxima", CLIMA: "Fuera de lo normal del mes",
  PICO: "Pico aislado", REPE: "Valor repetido", ENTEROS: "Mes con valores enteros", HUECO: "Mes sin datos"};
const MES = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];
let clave = () => "", RES = null, E = null, anio = null, verVar = "tx", filtro = "", soloDud = true, fuente = "dia";
Object.assign(NOM, {DIG: "Posible error de digitación", PEGADO: "Valor pegado", HRTD: "HR no calza con Ts y Td", TDTS: "Td mayor que Ts", SALTO: "Salto de presión", EXTH: "Extrema y Ts horarias"});
const H = () => ({"x-clave": clave()});

function init(fclave){
  clave = fclave || clave;
  const s = $("#ser"); if (s.dataset.ok) return; s.dataset.ok = 1;
  s.innerHTML = `<div class="htools"><span id="sFue"><button data-fu="dia" class="rvbtn" style="margin:0">Máx./mín. diarias (anuarios)</button> <button data-fu="hora" style="margin:0">Horarias SACLIM (Ts, Td, HR, QFE, QFF, viento, RRR6, extremas)</button></span><select id="sEst"><option value="">Resumen de todas las estaciones</option></select><select id="sAnio" hidden></select>
    <span id="sVar"></span><label><input type="checkbox" id="sDud" checked> solo dudosos y para revisar</label><span class="tag" id="sTag"></span><button id="sXls">⬇ Excel</button></div><div id="sOut"><p style="color:var(--mu)">Cargando…</p></div>`;
  $("#sEst").addEventListener("change", () => cargar($("#sEst").value));
  $("#sAnio").addEventListener("change", () => { anio = +$("#sAnio").value; fuente === "hora" ? pintarH() : pintarE(); });
  $("#sDud").addEventListener("change", ev => { soloDud = ev.target.checked; E ? (fuente === "hora" ? pintarH() : pintarE()) : pintarR(); });
  $("#sXls").addEventListener("click", excel);
  s.addEventListener("click", ev => {
    const fu = ev.target.closest("[data-fu]"); if (fu){ fuente = fu.dataset.fu; document.querySelectorAll("#sFue button").forEach(b => b.className = b === fu ? "rvbtn" : ""); E = null; resumen(); return; }
    const c = ev.target.closest("[data-sc]"); if (c){ $("#sEst").value = c.dataset.sc; cargar(c.dataset.sc); return; }
    const a = ev.target.closest("[data-sa]"); if (a){ anio = +a.dataset.sa; $("#sAnio").value = anio; fuente === "hora" ? pintarH() : pintarE(); return; }
    const v = ev.target.closest("[data-sv]"); if (v){ verVar = v.dataset.sv; pintarE(); return; }
    const f = ev.target.closest("[data-sf]"); if (f){ filtro = filtro === f.dataset.sf ? "" : f.dataset.sf; fuente === "hora" ? pintarH() : pintarE(); return; }
    const h = ev.target.closest("[data-sh]"); if (h){ const [a2, v2] = h.dataset.sh.split("|"); anio = +a2.slice(0, 4); verVar = v2; $("#sAnio").value = anio; pintarE(a2); }
  });
  resumen();
}
async function resumen(){
  try { RES = await (await fetch("/api/series?fuente=" + fuente, {headers: H(), cache: "no-store"})).json(); } catch (e){ $("#sOut").innerHTML = "<p>No se pudo cargar.</p>"; return; }
  $("#sEst").innerHTML = `<option value="">Resumen de todas las estaciones</option>` + (RES.estaciones || []).slice().sort((a, b) => (a.nombre || "").localeCompare(b.nombre || ""))
    .map(e => `<option value="${e.codigo}">${esc(e.nombre)} (${e.codigo})</option>`).join("");
  pintarR();
}
function pintarR(){
  E = null; $("#sAnio").hidden = true; $("#sVar").innerHTML = "";
  const L = RES.estaciones || [];
  $("#sTag").textContent = RES.generado ? `Revisado ${new Date(RES.generado).toLocaleString("es-CL", {dateStyle: "short", timeStyle: "short"})}` : "Aún sin revisión";
  if (!L.length){ $("#sOut").innerHTML = `<p style="color:var(--mu)">Todavía no hay series revisadas de esta fuente. El primer barrido (piloto) está en curso.</p>`; return; }
  const tot = k => L.reduce((s, e) => s + (e[k] || 0), 0);
  $("#sOut").innerHTML = `<div class="hres"><div><b>${L.length}</b><span>estaciones</span></div><div><b style="color:var(--err)">${tot("dudosos")}</b><span>datos dudosos</span></div>
      <div><b style="color:var(--sos)">${tot("revisar")}</b><span>para revisar</span></div><div><b style="color:var(--ok)">${tot("corregidos")}</b><span>corregidos desde la revisión anterior</span></div></div>
    <table class="sgtab" style="font-family:inherit"><tr><th>Estación</th><th>Años</th><th>Completitud</th><th>Dudosos</th><th>Revisar</th><th>Corregidos</th><th>Reglas</th></tr>
    ${L.map(e => `<tr data-sc="${e.codigo}" style="cursor:pointer"><td style="text-align:left">${esc(e.nombre)} <small style="color:var(--mu)">${e.codigo}</small></td><td>${e.desde}–${e.hasta}</td><td>${e.completitud}%</td>
      <td style="color:var(--err);font-weight:700">${e.dudosos || ""}</td><td style="color:var(--sos)">${e.revisar || ""}</td><td style="color:var(--ok)">${e.corregidos || ""}</td>
      <td style="text-align:left;font-size:11.5px">${Object.entries(e.reglas || {}).filter(x => x[1]).map(([k, n]) => `${esc(NOM[k] || k)} ${n}`).join(" · ")}</td></tr>`).join("")}</table>
    <p class="nota" style="color:var(--mu);font-size:12.5px;margin-top:10px">Máximas y mínimas diarias de los anuarios del portal de climatología. Cada lunes se vuelve a bajar el año en curso y el anterior, y el día 3 de cada mes todos los años:
      si un valor cambió en el portal queda registrado (antes → ahora) y su alerta pasa a «corregido». Clic en una estación para ver el detalle.</p>`;
}
async function cargar(cod){
  if (!cod){ pintarR(); return; }
  $("#sOut").innerHTML = `<p style="color:var(--mu)">Cargando…</p>`;
  E = await (await fetch("/api/series?fuente=" + fuente + "&cod=" + cod, {headers: H(), cache: "no-store"})).json();
  if (E.vacio){ $("#sOut").innerHTML = "<p>Sin datos.</p>"; return; }
  const anios = Object.keys(E.anios || {}).map(Number).sort((a, b) => b - a);
  const conH = new Set(E.hallazgos.filter(h => h.nivel > 0).map(h => +h.fecha.slice(0, 4)));
  anio = anios.find(a => conH.has(a)) || anios[0];
  $("#sAnio").innerHTML = anios.map(a => `<option value="${a}">${a}${conH.has(a) ? " •" : ""}</option>`).join(""); $("#sAnio").value = anio; $("#sAnio").hidden = false;
  filtro = ""; fuente === "hora" ? pintarH() : pintarE();
}
function pintarH(){
  const Hs = E.hallazgos.filter(h => (!soloDud || h.nivel > 0) && (!filtro || h.regla === filtro) && (!anio || +h.fecha.slice(0, 4) === anio));
  $("#sVar").innerHTML = ""; $("#sTag").textContent = `${E.nombre || E.codigo} · ${E.desde.slice(0, 4)}–${E.hasta.slice(0, 4)} · ${E.total} alertas en total`;
  const cnt = {}; E.hallazgos.filter(h => (!soloDud || h.nivel > 0) && (!anio || +h.fecha.slice(0, 4) === anio)).forEach(h => cnt[h.regla] = (cnt[h.regla] || 0) + 1);
  const porAnio = {}; E.hallazgos.filter(h => h.nivel > 0).forEach(h => { const a = h.fecha.slice(0, 4); porAnio[a] = (porAnio[a] || 0) + 1; });
  const V = ["Ts", "Td", "HR", "QFE", "QFF", "ff"];
  $("#sOut").innerHTML = `<h4 style="margin:4px 0 6px">Completitud por año (% de horas con dato) y alertas</h4>
    <table class="sgtab"><tr><th>Año</th>${V.map(v => `<th>${v === "ff" ? "viento" : v}</th>`).join("")}<th>alertas</th></tr>${Object.keys(E.anios).sort().reverse().map(a => { const r = E.anios[a];
      return `<tr data-sa="${a}" style="cursor:pointer" class="${+a === anio ? "on" : ""}"><td>${a}</td>${V.map(v => { const c = r[v] == null ? null : Math.round(100 * r[v] / r.esperadas);
        return `<td style="color:${c == null ? "var(--mu)" : c >= 95 ? "var(--ok)" : c >= 70 ? "var(--sos)" : "var(--err)"}">${c == null ? "—" : c + "%"}</td>`; }).join("")}<td style="color:var(--err);font-weight:700">${porAnio[a] || ""}</td></tr>`; }).join("")}</table>
    <h4 style="margin:12px 0 6px">Por regla ${anio ? "· " + anio : ""}</h4>${Object.entries(cnt).map(([k, n]) => `<button data-sf="${k}" class="${filtro === k ? "rvbtn" : ""}" style="margin:2px">${esc(NOM[k] || k)} ${n}</button>`).join("") || "<p style='color:var(--ok)'>Sin alertas.</p>"}
    ${(E.corregidos || []).length ? `<h4 style="margin:12px 0 6px">Corregidos</h4><table class="sgtab" style="font-family:inherit">${E.corregidos.slice(-30).reverse().map(c => `<tr><td>${c.fecha}</td><td>${esc(c.var)}</td><td>${c.antes ?? "—"} → ${c.ahora ?? "—"}</td><td style="text-align:left">${esc(NOM[c.regla] || c.regla)}</td></tr>`).join("")}</table>` : ""}
    <h4 style="margin:14px 0 6px">Alertas ${anio || ""} (${Hs.length})</h4>
    <table><tr><th>Fecha y hora UTC</th><th>Variable</th><th>Nivel</th><th>Regla</th><th>Detalle</th></tr>${Hs.slice().reverse().slice(0, 800).map(h => `<tr><td style="white-space:nowrap">${h.fecha}</td><td>${esc(h.var)}</td>
      <td style="color:${NIVC[h.nivel]}">${NIVT[h.nivel]}</td><td>${esc(NOM[h.regla] || h.regla)}</td><td>${esc(h.msg).replace(/(Probable: [^(]+)/, "<b>$1</b>")}</td></tr>`).join("")}</table>`;
}
function pintarE(selFecha){
  if (!E) return;
  $("#sVar").innerHTML = [["tx", "Máximas"], ["tn", "Mínimas"]].map(([k, n]) => `<button data-sv="${k}" class="${verVar === k ? "rvbtn" : ""}" style="margin:0">${n}</button>`).join(" ");
  $("#sTag").textContent = `${E.nombre || E.codigo} · ${E.desde.slice(0, 4)}–${E.hasta.slice(0, 4)}` + (E.vecinas.length ? ` · vecinas: ${E.vecinas.join(", ")}` : " · sin vecinas en el piloto");
  const Hs = E.hallazgos.filter(h => (!soloDud || h.nivel > 0) && (!filtro || h.regla === filtro));
  const marca = {}; E.hallazgos.forEach(h => { const k = h.fecha + "|" + h.var; if (!marca[k] || marca[k].nivel < h.nivel) marca[k] = h; });
  const D = E.datos[verVar] || {};
  let grid = `<tr><th>Día</th>${MES.map(m => `<th>${m}</th>`).join("")}</tr>`;
  for (let d = 1; d <= 31; d++){
    grid += `<tr><th>${d}</th>`;
    for (let m = 1; m <= 12; m++){
      const f = `${anio}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`, x = D[f], h = marca[f + "|" + verVar] || (verVar === "tn" ? null : marca[f + "|tn"] && marca[f + "|tn"].regla === "TNTX" ? marca[f + "|tn"] : null);
      const valida = new Date(f + "T12:00Z").getUTCDate() === d;
      grid += valida ? `<td class="${h && h.regla !== "ENTEROS" && h.regla !== "HUECO" ? "n" + h.nivel : ""}${selFecha === f ? " sel" : ""}"${h ? ` title="${esc(h.msg)}"` : ""}>${x == null ? "·" : x.toFixed(1)}</td>` : `<td style="border:0"></td>`;
    }
    grid += "</tr>";
  }
  const cnt = {}; E.hallazgos.filter(h => !soloDud || h.nivel > 0).forEach(h => cnt[h.regla] = (cnt[h.regla] || 0) + 1);
  const porAnio = {}; E.hallazgos.filter(h => h.nivel > 0).forEach(h => { const a = h.fecha.slice(0, 4); porAnio[a] = (porAnio[a] || 0) + 1; });
  const anios = Object.keys(E.anios).sort();
  $("#sOut").innerHTML = `<div style="display:flex;gap:18px;flex-wrap:wrap;align-items:flex-start">
    <div><h4 style="margin:4px 0 6px">${verVar === "tx" ? "Máximas" : "Mínimas"} ${anio}</h4><table class="sgrid">${grid}</table>
      <p class="nota" style="color:var(--mu);font-size:12px">Rojo: dudoso · amarillo: revisar · azul: informativo. Pase el mouse por una celda marcada.</p></div>
    <div style="flex:1;min-width:320px"><h4 style="margin:4px 0 6px">Completitud y alertas por año</h4><div style="display:flex;flex-wrap:wrap;gap:4px">${anios.map(a => { const r = E.anios[a], c = Math.round(100 * (r.tx + r.tn) / (2 * r.esperados));
        return `<span data-sa="${a}" title="${r.tx} máximas y ${r.tn} mínimas de ${r.esperados} días" style="cursor:pointer;border:1px solid ${+a === anio ? "var(--oro)" : "var(--bd)"};border-radius:6px;padding:2px 6px;font:12px var(--mono)">${a} <span style="color:${c >= 95 ? "var(--ok)" : c >= 70 ? "var(--sos)" : "var(--err)"}">${c}%</span>${porAnio[a] ? ` <b style="color:var(--err)">${porAnio[a]}</b>` : ""}</span>`; }).join("")}</div>
      <h4 style="margin:12px 0 6px">Por regla</h4>${Object.entries(cnt).map(([k, n]) => `<button data-sf="${k}" class="${filtro === k ? "rvbtn" : ""}" style="margin:2px">${esc(NOM[k] || k)} ${n}</button>`).join("") || "<p style='color:var(--ok)'>Sin alertas.</p>"}
      ${(E.corregidos || []).length ? `<h4 style="margin:12px 0 6px">Corregidos</h4><table class="sgtab" style="font-family:inherit">${E.corregidos.slice(-30).reverse().map(c => `<tr><td>${c.fecha}</td><td>${c.var === "tx" ? "máx" : "mín"}</td><td>${c.antes ?? "—"} → ${c.ahora ?? "—"}</td><td style="text-align:left">${esc(NOM[c.regla] || c.regla)}</td></tr>`).join("")}</table>` : ""}
      ${(E.cambios || []).length ? `<h4 style="margin:12px 0 6px">Valores cambiados en el portal</h4><table class="sgtab" style="font-family:inherit">${E.cambios.slice(-30).reverse().map(c => `<tr><td>${c.fecha}</td><td>${c.var === "tx" ? "máx" : "mín"}</td><td>${c.antes ?? "—"} → ${c.ahora ?? "—"}</td><td>${c.detectado.slice(0, 10)}</td></tr>`).join("")}</table>` : ""}
    </div></div>
    <h4 style="margin:14px 0 6px">Alertas (${Hs.length})</h4>
    <table><tr><th>Fecha</th><th>Variable</th><th>Nivel</th><th>Regla</th><th>Detalle</th></tr>${Hs.slice().reverse().slice(0, 400).map(h => `<tr data-sh="${h.fecha}|${h.var}" style="cursor:pointer"><td style="white-space:nowrap">${h.fecha}</td><td>${h.var === "tx" ? "máxima" : "mínima"}</td>
      <td style="color:${NIVC[h.nivel]}">${NIVT[h.nivel]}</td><td>${esc(NOM[h.regla] || h.regla)}</td><td>${esc(h.msg).replace(/(Probable: [^(]+)/, "<b>$1</b>")}</td></tr>`).join("")}</table>`;
}
function excel(){
  const b = "border:1px solid #DEE2E6;";
  let filas, titulo;
  if (E){
    titulo = `Series de temperatura · ${E.nombre || E.codigo} (${E.codigo})`;
    filas = [["Fecha", "Variable", "Nivel", "Regla", "Valor", "Probable", "Detalle"]].concat(E.hallazgos.filter(h => !soloDud || h.nivel > 0)
      .map(h => [h.fecha, h.var === "tx" ? "máxima" : "mínima", NIVT[h.nivel], NOM[h.regla] || h.regla, h.valor ?? "", h.probable ?? "", h.msg]));
    if ((E.corregidos || []).length) filas = filas.concat([[""], ["Corregidos"], ["Fecha", "Variable", "Antes", "Ahora", "Regla", "Detectado"]],
      E.corregidos.map(c => [c.fecha, c.var === "tx" ? "máxima" : "mínima", c.antes ?? "", c.ahora ?? "", NOM[c.regla] || c.regla, (c.corregido || "").slice(0, 10)]));
  } else {
    titulo = "Series de temperatura · resumen";
    filas = [["Código", "Estación", "Desde", "Hasta", "Completitud %", "Dudosos", "Revisar", "Corregidos"]].concat((RES.estaciones || []).map(e => [e.codigo, e.nombre, e.desde, e.hasta, e.completitud, e.dudosos, e.revisar, e.corregidos]));
  }
  const html = `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel"><head><meta charset="utf-8"></head><body><table style="font-family:Arial;font-size:10pt">
    <tr><td colspan="7" style="background:#2D4356;color:#fff;font-weight:bold;font-size:14pt">${esc(titulo)}</td></tr><tr></tr>${filas.map((f, i) => `<tr>${f.map(x => `<td style="${b}${i === 0 ? "background:#84A7A1;font-weight:bold;" : ""}">${esc(x)}</td>`).join("")}</tr>`).join("")}</table></body></html>`;
  const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob(["﻿" + html], {type: "application/vnd.ms-excel"}));
  a.download = E ? `series_${E.codigo}.xls` : "series_resumen.xls"; a.click();
}
window.SER = {init};
})();
