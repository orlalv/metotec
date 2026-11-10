/* Boletín diario: revisión del Informe Climatológico Diario Nacional (RE5008) frente a la estación automática,
   lo ingresado por el observador y el boletín del día anterior. La revisión la hace qc/boletin.py entre las 10:00 y
   las 13:00 hora local (cada 30 min); aquí solo se muestra, con la misma forma del boletín. */
(function(){
const $ = s => document.querySelector(s);
const COLS = ["tn", "tn_h", "tx", "tx_h", "rr24", "acum", "ant", "normal_f", "defsup", "normal_a"];
const NCOL = {tn: "T. Mínima", tn_h: "Hora de la mínima", tx: "T. Máxima ayer", tx_h: "Hora de la máxima", rr24: "Agua caída 24 h", acum: "A la fecha",
  ant: "Año pasado", normal_f: "Normal a la fecha", defsup: "Déf/Sup", normal_a: "Normal anual"};
const NIV = {err: 0, warn: 1, info: 2};
const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;"})[c]);
let clave = () => "", B = null, selFila = null;

function init(fclave){
  clave = fclave || clave;
  const s = $("#bol"); if (s.dataset.ok) return; s.dataset.ok = 1;
  const hoy = new Date(Date.now() - 3 * 3600e3).toISOString().slice(0, 10);
  s.innerHTML = `<div class="htools"><button id="bAnt">◀</button><input type="date" id="bDia" value="${hoy}"><button id="bSig">▶</button>
    <span class="tag" id="bRev" style="border-color:var(--oro);color:var(--oro)">—</span><button id="bXls">⬇ Excel con marcas</button>
    <a href="https://climatologia.meteochile.gob.cl/application/diario/boletinClimatologicoDiario" target="_blank" rel="noopener" style="color:var(--mu);font-size:12.5px;margin-left:6px">Ver el boletín en el portal ↗</a></div>
    <div id="bOut"><p style="color:var(--mu)">Cargando…</p></div>`;
  const mover = k => { const d = new Date($("#bDia").value + "T12:00Z"); d.setUTCDate(d.getUTCDate() + k); $("#bDia").value = d.toISOString().slice(0, 10); cargar(); };
  $("#bAnt").addEventListener("click", () => mover(-1)); $("#bSig").addEventListener("click", () => mover(1));
  $("#bDia").addEventListener("change", cargar); $("#bXls").addEventListener("click", excel);
  s.addEventListener("click", ev => {
    const f = ev.target.closest("[data-f]"); if (!f) return;
    selFila = selFila === f.dataset.f ? null : f.dataset.f; pintar();
    const t = document.querySelector(`#bol tbody tr[data-f="${CSS.escape(selFila || "")}"]`); t && t.scrollIntoView({block: "nearest"});
  });
  cargar(true);
}

async function cargar(ultimo){
  $("#bOut").innerHTML = `<p style="color:var(--mu)">Cargando…</p>`;
  try {
    const r = await fetch("/api/boletin" + (ultimo ? "" : "?dia=" + $("#bDia").value), {headers: {"x-clave": clave()}, cache: "no-store"});
    if (r.status === 401){ $("#bOut").innerHTML = `<p style="color:#eb5757">Clave incorrecta.</p>`; return; }
    B = await r.json(); if (ultimo && B.dia) $("#bDia").value = B.dia;
  } catch (e){ $("#bOut").innerHTML = `<p style="color:#eb5757">No se pudo cargar (${esc(e.message)}).</p>`; return; }
  selFila = null; pintar();
}

function marcasFila(f){ return Object.entries(f.marcas || {}).filter(([, m]) => m.nivel !== "info" || m.msg); }
function pintar(){
  if (!B || B.vacio){
    $("#bRev").textContent = "sin revisión";
    $("#bOut").innerHTML = `<p style="color:var(--mu)">No hay revisión del boletín para el ${esc(B ? B.dia : $("#bDia").value)}. El boletín se revisa desde las 07:00 hora local, cada 30 minutos, a medida que el portal lo va llenando; las revisiones se guardan desde el 9 de noviembre de 2026.</p>`; return;
  }
  const ps = B.pasadas || [];
  $("#bRev").textContent = `Revisado ${ps.length ? ps[ps.length - 1] : ""} hora local` + (ps.length > 1 ? ` · ${ps.length} pasadas (${ps[0]}–${ps[ps.length - 1]})` : "");
  let nErr = 0, nWarn = 0, limpias = 0;
  B.filas.forEach(f => { const m = marcasFila(f); nErr += m.filter(x => x[1].nivel === "err").length; nWarn += m.filter(x => x[1].nivel === "warn").length; if (!m.some(x => x[1].nivel !== "info")) limpias++; });
  const conLluvia = B.filas.filter(f => /^\d/.test(f.v.rr24) && parseFloat(f.v.rr24) > 0).length;
  const celda = (f, c) => {
    const m = (f.marcas || {})[c], val = f.v[c], cls = ["n"]; if (c === "tn") cls.push("tn"); if (c === "tx") cls.push("tx");
    if (m) cls.push(m.nivel);
    return `<td class="${cls.join(" ")}"${m && m.msg ? ` title="${esc(m.msg)}"` : ""}>${esc(val)}${m && m.sub ? `<small>${esc(m.sub)}</small>` : ""}</td>`;
  };
  const filas = B.filas.map(f => {
    const m = marcasFila(f), e = m.filter(x => x[1].nivel === "err").length, w = m.filter(x => x[1].nivel === "warn").length;
    const rv = !e && !w ? `<span class="ok">✓</span>` : (e ? `<span class="bb err">${e} dudoso${e > 1 ? "s" : ""}</span> ` : "") + (w ? `<span class="bb warn">${w} revisar</span>` : "");
    return `<tr data-f="${esc(f.nombre)}" class="${selFila === f.nombre ? "sel" : ""}"><td class="nom">${esc(f.nombre)}${!f.ema && !f.obs ? ` <span style="color:#8a94a6;font-size:10.5px">(sin automática)</span>` : ""}</td>${COLS.map(c => celda(f, c)).join("")}<td class="rv">${rv}</td></tr>`;
  }).join("");
  const items = (B.items || []).filter(x => !selFila || x.estacion === selFila).sort((a, b) => NIV[a.nivel] - NIV[b.nivel]);
  const realTxt = r => r ? `<br>Valor ${r.fuente === "cálculo" ? "correcto" : "real probable"}: <em>${typeof r.valor === "number" ? r.valor.toFixed(1) : esc(r.valor)}${r.hora ? " · " + esc(r.hora) : ""}</em> <span style="color:var(--mu)">(${esc(r.fuente)})</span>` : "";
  const cambios = (B.cambios || []).filter(x => !selFila || x.estacion === selFila);
  $("#bOut").innerHTML = `<div class="hres"><div><b>${B.filas.length}</b><span>estaciones del boletín</span></div><div><b style="color:#6fcf97">${limpias}</b><span>sin observaciones</span></div>
      <div><b style="color:#eb5757">${nErr}</b><span>datos dudosos</span></div><div><b style="color:#f2c94c">${nWarn}</b><span>para revisar</span></div>
      <div><b>${conLluvia} de ${B.filas.length}</b><span>con lluvia en 24 h</span></div>${(B.cambios || []).length ? `<div><b style="color:#56CCF2">${B.cambios.length}</b><span>datos cambiados entre pasadas</span></div>` : ""}</div>
    <div class="bwrap"><div class="bcard"><div class="bcab"><h3>Informe Climatológico Diario Nacional</h3><h5>Totales y normales Estaciones Climatológicas Principales</h5><b>${esc(B.fecha_txt || B.dia)}</b></div>
      <table><thead><tr><th rowspan="2">Nombre de la Estación</th><th colspan="2">T. Mínima (°C)</th><th colspan="2">T. Máxima (°C) Ayer</th><th colspan="6">Agua Caída (mm)</th><th rowspan="2">Revisión</th></tr>
      <tr><th>Valor</th><th>Hora</th><th>Valor</th><th>Hora</th><th>24 Horas</th><th>A la Fecha</th><th>Año Pasado</th><th>Normal a la Fecha</th><th>Déf/Sup (%)</th><th>Normal Anual</th></tr></thead>
      <tbody>${filas}</tbody></table></div>
    <div class="lado"><h4>Inconsistencias${selFila ? " · " + esc(selFila) + ` <a data-f="${esc(selFila)}" style="color:var(--mu);font-size:12px;cursor:pointer">(ver todas)</a>` : ""}</h4>
      <div class="ley"><span><i style="background:#f8d7da;border:1px solid #dc3545"></i>dudoso</span><span><i style="background:#fff3cd"></i>revisar</span><span><i style="background:#e7f1ff"></i>informativo</span></div>
      ${items.length ? items.map(x => `<div class="bit ${x.nivel}" data-f="${esc(x.estacion)}"><b>${esc(x.estacion)} · ${esc(NCOL[x.col] || x.col)}</b><p>${esc(x.msg).replace(/(Debería ir|Probable): ([^(]+)/, "<br>$1: <em>$2</em>")}</p></div>`).join("")
        : `<p style="color:#6fcf97;margin:0">${selFila ? "Esta estación no tiene" : "El boletín no tiene"} inconsistencias.</p>`}
      ${cambios.length ? `<h4 style="margin-top:14px">Cambios entre pasadas</h4>${cambios.map(c => `<div class="bit info"><b>${esc(c.estacion)} · ${esc(NCOL[c.col] || c.col)}</b><p>A las ${esc(c.hora)} pasó de <em>${esc(c.antes)}</em> a <em>${esc(c.ahora)}</em>.</p></div>`).join("")}` : ""}
      <p class="nota" style="margin:10px 0 0;color:var(--mu);font-size:12px">Se compara con la estación automática (mínima 00–12 UTC, máxima de ayer 12–24 UTC o el día local completo, agua caída 12–12 UTC), con lo que ingresó el observador (TnAM, TxPM y los cuatro RRR6) y con el boletín de ayer (A la fecha = ayer + 24 h). Pase el mouse por una celda marcada para ver el detalle.</p></div></div>`;
}

function excel(){
  if (!B || B.vacio) return;
  const color = {err: "#F8D7DA", warn: "#FFF3CD", info: "#E7F1FF"}, b = "border:1px solid #DEE2E6;";
  const cab = `<tr><td colspan="12" style="background:#2D4356;color:#fff;font-weight:bold;font-size:15pt">Informe Climatológico Diario Nacional</td></tr><tr><td colspan="12" style="background:#2D4356;color:#fff">Totales y normales Estaciones Climatológicas Principales · ${esc(B.fecha_txt || B.dia)}</td></tr><tr></tr>
    <tr>${["Nombre de la Estación", "T. Mín", "Hora", "T. Máx ayer", "Hora", "24 Horas", "A la Fecha", "Año Pasado", "Normal a la Fecha", "Déf/Sup (%)", "Normal Anual", "Observación"].map(x => `<td style="${b}background:#84A7A1;font-weight:bold">${x}</td>`).join("")}</tr>`;
  const filas = B.filas.map(f => `<tr><td style="${b}">${esc(f.nombre)}</td>${COLS.map(c => { const m = (f.marcas || {})[c];
      return `<td style="${b}text-align:right;mso-number-format:'\\@';${c === "tn" ? "color:#0A9FBD;" : c === "tx" ? "color:#DC3545;" : ""}${m ? "background:" + color[m.nivel] + ";" : ""}">${esc(f.v[c])}${m && m.sub ? " (" + esc(m.sub) + ")" : ""}</td>`; }).join("")}
      <td style="${b}">${esc((B.items || []).filter(x => x.estacion === f.nombre).map(x => x.msg).join(" | "))}</td></tr>`).join("");
  const html = `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel"><head><meta charset="utf-8"></head><body><table style="font-family:Arial;font-size:10pt">${cab}${filas}</table></body></html>`;
  const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob(["﻿" + html], {type: "application/vnd.ms-excel"}));
  a.download = `boletin_revisado_${B.dia}.xls`; a.click();
}
window.BOL = {init};
})();
