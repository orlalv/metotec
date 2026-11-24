/* Agro · Compendio semanal con los boletines regionales de climatología (qc/agro_boletin.py → KV qc/agro_bol/<jueves>).
   Pestañas: General (top 10 nacional de Tmax, Tmin y precipitación) · Por día · Por región · Calidad. Exporta CSV (abre en Excel).
   «Sacar del ranking» guarda en /api/agro (periodo «<jueves>|bol»): quita solo ese dato y sube el siguiente. */
(function(){
const $ = s => document.querySelector(s), esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;"}[c]));
const clave = () => { try { return sessionStorage.getItem("qcClave") || window._qc || ""; } catch (e) { return window._qc || ""; } };
const DSEM = ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"];
const diaTxt = iso => { if (!iso) return "semana"; const d = new Date(iso + "T12:00:00Z"); return `${DSEM[d.getUTCDay()]} ${iso.slice(8, 10)}/${iso.slice(5, 7)}`; };
const f1 = v => v == null ? "—" : Number(v).toFixed(1);
const VK = {tmax: "Tmax (°C)", tmin: "Tmin (°C)", pp: "Precipitación (mm)"};
let C = null, SAC = {}, VISTA = "gen", SEMANAS = [], SEM = "ult", MSG = "";

const per = () => C.semana + "|bol";
const idDe = (vk, r) => `${per()}|${vk === "pp" ? "pp24" : vk}|${r.cod}|${r.dia}`;
const sacado = (vk, r) => !!SAC[idDe(vk, r)];
const est = r => C.estaciones[r.cod] || {nombre: r.cod, prop: "", reg: r.reg};
const top = (L, vk, n = 10) => L.filter(r => !sacado(vk, r)).slice(0, n);

async function api(q, op){ const r = await fetch("/api/agro" + q, Object.assign({headers: {"x-clave": clave(), "content-type": "application/json"}}, op || {})); if (!r.ok) throw new Error(r.status + " " + (await r.text())); return r.json(); }
async function cargar(){
  const o = $("#agBol"); o.innerHTML = `<p style="color:var(--mu)">Cargando compendio…</p>`;
  try {
    if (!SEMANAS.length) SEMANAS = (await api("?bol=lista")).semanas || [];
    C = await api("?bol=" + SEM);
    SAC = (await api("?p=" + encodeURIComponent(per()))).sacados || {};
  } catch (e){ o.innerHTML = `<p style="color:var(--err)">${/404/.test(e.message) ? "Todavía no hay compendio para esa semana: se genera los jueves a las 09:13 y 10:43." : "No se pudo cargar: " + esc(e.message)}</p>`; return; }
  pintar();
}
async function sacar(vk, r){
  const mo = prompt(`Sacar del ranking: ${est(r).nombre} · ${f1(r.valor)} · ${diaTxt(r.fecha)}\nMotivo (obligatorio):`, "");
  if (!mo || mo.trim().length < 3) return;
  try { SAC = (await api("", {method: "POST", body: JSON.stringify({accion: "sacar", p: per(), id: idDe(vk, r), vk: vk === "pp" ? "pp24" : vk, cod: r.cod, dia: r.dia, valor: r.valor, motivo: mo.trim(), quien: ""})})).sacados; MSG = ""; }
  catch (e){ MSG = "No se pudo guardar: " + e.message; }
  pintar();
}
async function devolver(id){
  try { SAC = (await api("", {method: "POST", body: JSON.stringify({accion: "devolver", p: per(), id, quien: ""})})).sacados; } catch (e){ MSG = "No se pudo guardar: " + e.message; }
  pintar();
}

function tabla(vk){
  const L = C.ranking[vk] || [], T = top(L, vk), pp = vk === "pp";
  return `<div class="bcard" style="padding:10px;margin-bottom:12px"><b>${VK[vk]}</b> <span class="tag">· ${vk === "tmin" ? "10 más bajas" : "10 más altas"}${pp ? " · valores diarios" : ""}</span>
  <table class="xtab"><tr><th>#</th><th>Estación</th><th>Código</th><th>Región</th><th>Propietario</th><th class="n">Valor</th><th>Día</th>${pp ? `<th class="n">Acum. semana</th>` : ""}<th></th></tr>
  ${T.map((r, i) => `<tr><td>${i + 1}</td><td>${esc(est(r).nombre)}${r.estado === "dudoso" ? ` <span title="${esc(r.motivo)}">⚠</span>` : ""}</td><td>${r.cod}</td><td>${esc(C.regiones[r.reg])}</td><td>${esc(est(r).prop)}</td>
    <td class="n"><b>${f1(r.valor)}</b></td><td>${diaTxt(r.fecha)}</td>${pp ? `<td class="n">${f1(r.acum)}${r.ndias < 7 ? ` <small class="tag">(${r.ndias} d)</small>` : ""}</td>` : ""}
    <td><button data-sac="${vk}|${L.indexOf(r)}" title="Quita solo este dato; sube el siguiente">Sacar</button></td></tr>`).join("") || `<tr><td colspan="9" class="tag">Sin datos</td></tr>`}</table></div>`;
}
const celda = (L, vk) => { const r = top(L || [], vk, 1)[0]; return r ? `<b>${f1(r.valor)}</b> ${esc(est(r).nombre)} <small class="tag">${vk === "pp" || !r.fecha ? "" : ""}${C.regiones[r.reg] ? esc(C.regiones[r.reg]) : ""}</small>` : `<span class="tag">—</span>`; };
const celdaD = (L, vk) => { const r = top(L || [], vk, 1)[0]; return r ? `<b>${f1(r.valor)}</b> ${esc(est(r).nombre)} <small class="tag">${diaTxt(r.fecha)}</small>` : `<span class="tag">—</span>`; };

function vista(){
  if (VISTA === "gen") return ["tmax", "tmin", "pp"].map(tabla).join("");
  if (VISTA === "dia") return `<table class="xtab bcard"><tr><th>Día</th><th>Tmax más alta</th><th>Tmin más baja</th><th>Mayor precipitación</th></tr>
    ${C.por_dia.map(d => `<tr><td>${diaTxt(d.fecha)}</td><td>${celda(d.tmax, "tmax")}</td><td>${celda(d.tmin, "tmin")}</td><td>${celda(d.pp, "pp")}</td></tr>`).join("")}</table>`;
  if (VISTA === "reg") return `<table class="xtab bcard"><tr><th>Región</th><th>Tmax más alta</th><th>Tmin más baja</th><th>Mayor precipitación</th></tr>
    ${C.por_region.map(g => `<tr><td>${esc(g.nombre)}</td><td>${celdaD(g.tmax, "tmax")}</td><td>${celdaD(g.tmin, "tmin")}</td><td>${celdaD(g.pp, "pp")}</td></tr>`).join("")}</table>`;
  // Calidad: errores y dudosos agrupados por top, más lo sacado a mano
  const grupo = (vk, nom) => { const L = C.calidad.filter(r => r.vk === vk && r.estado !== "sp");
    return `<div class="bcard" style="padding:10px;margin-bottom:12px"><b>${nom}</b> <span class="tag">· ${L.length}</span><table class="xtab"><tr><th>Estación</th><th>Código</th><th>Región</th><th>Día</th><th class="n">Valor</th><th>Estado</th><th>Motivo</th></tr>
    ${L.map(r => `<tr><td>${esc(est(r).nombre)}</td><td>${r.cod}</td><td>${esc(C.regiones[r.reg])}</td><td>${diaTxt(r.fecha)}</td><td class="n">${f1(r.valor)}</td><td style="color:${r.estado === "error" ? "var(--err)" : "var(--oro)"}">${r.estado}</td><td>${esc(r.motivo)}</td></tr>`).join("") || `<tr><td colspan="7" class="tag">Sin observaciones</td></tr>`}</table></div>`; };
  const sp = C.calidad.filter(r => r.estado === "sp"), S = Object.entries(SAC);
  return grupo("tmax", "Tmax") + grupo("tmin", "Tmin") + grupo("pp24", "Precipitación") +
    `<div class="bcard" style="padding:10px;margin-bottom:12px"><b>Sacados a mano</b> <span class="tag">· ${S.length}</span><table class="xtab"><tr><th>Variable</th><th>Estación</th><th>Día</th><th class="n">Valor</th><th>Motivo</th><th>Fecha</th><th></th></tr>
    ${S.map(([id, v]) => `<tr><td>${v.vk}</td><td>${esc((C.estaciones[v.cod] || {}).nombre || v.cod)} <small class="tag">${v.cod}</small></td><td>${diaTxt(C.dias[v.dia])}</td><td class="n">${f1(v.valor)}</td><td>${esc(v.motivo)}</td><td><small>${esc(v.t)}</small></td><td><button data-dev="${esc(id)}">Devolver</button></td></tr>`).join("") || `<tr><td colspan="7" class="tag">Ninguno</td></tr>`}</table></div>
    <p class="tag">«s/p» en el boletín pluviométrico (no definido; no entra al ranking ni al acumulado): ${sp.length} registros${sp.length ? " · " + [...new Set(sp.map(r => (C.estaciones[r.cod] || {}).nombre || r.cod))].slice(0, 30).map(esc).join(", ") : ""}.</p>`;
}

function csv(){
  const q = s => `"${String(s ?? "").replace(/"/g, '""')}"`, n = v => v == null ? "" : String(Number(v).toFixed(1)).replace(".", ","), F = [];
  F.push(["Compendio Agro", `${C.dias[0]} a ${C.dias[6]}`, "Fuente: boletines regionales DMC (sin control de calidad oficial)"].map(q).join(";"));
  for (const vk of ["tmax", "tmin", "pp"]){
    F.push(""); F.push([VK[vk]].map(q).join(";"));
    F.push(["#", "Estación", "Código", "Región", "Propietario", "Valor", "Día", vk === "pp" ? "Acumulado semana" : ""].map(q).join(";"));
    top(C.ranking[vk] || [], vk).forEach((r, i) => F.push([i + 1, est(r).nombre, r.cod, C.regiones[r.reg], est(r).prop, n(r.valor), r.fecha, vk === "pp" ? n(r.acum) : ""].map((x, j) => j === 5 || j === 7 ? x : q(x)).join(";")));
  }
  const fila = (a, L, vk, conDia) => { const r = top(L || [], vk, 1)[0]; return r ? [est(r).nombre, n(r.valor), conDia ? r.fecha : C.regiones[r.reg]] : ["", "", ""]; };
  F.push(""); F.push(q("Por día")); F.push(["Día", "Tmax estación", "Tmax", "Región", "Tmin estación", "Tmin", "Región", "PP estación", "PP", "Región"].map(q).join(";"));
  C.por_dia.forEach(d => F.push([d.fecha, ...fila(0, d.tmax, "tmax"), ...fila(0, d.tmin, "tmin"), ...fila(0, d.pp, "pp")].map(q).join(";")));
  F.push(""); F.push(q("Por región")); F.push(["Región", "Tmax estación", "Tmax", "Día", "Tmin estación", "Tmin", "Día", "PP estación", "PP", "Día"].map(q).join(";"));
  C.por_region.forEach(g => F.push([g.nombre, ...fila(0, g.tmax, "tmax", 1), ...fila(0, g.tmin, "tmin", 1), ...fila(0, g.pp, "pp", 1)].map(q).join(";")));
  const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob(["﻿" + F.join("\r\n")], {type: "text/csv;charset=utf-8"}));
  a.download = `compendio_agro_${C.semana}.csv`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 3000);
}

function pintar(){
  const o = $("#agBol"), b = (v, t) => `<button data-v="${v}" class="${VISTA === v ? "on" : ""}">${t}</button>`;
  const ncal = C.calidad.filter(r => r.estado !== "sp").length;
  o.innerHTML = `<div class="htools" style="gap:6px;flex-wrap:wrap;align-items:center;margin-bottom:8px">${b("gen", "General")}${b("dia", "Por día")}${b("reg", "Por región")}${b("cal", "Calidad · " + ncal)}
    <span style="flex:1"></span><select id="agSem">${["ult", ...SEMANAS].map(s => `<option value="${s}"${s === SEM ? " selected" : ""}>${s === "ult" ? "Última semana" : "Semana del " + s}</option>`).join("")}</select><button id="agCsv">Exportar (Excel)</button></div>
    <p class="tag" style="margin:0 0 10px">Jueves ${diaTxt(C.dias[0])} a miércoles ${diaTxt(C.dias[6])} · boletines regionales de Coquimbo a Los Lagos · generado ${esc(C.generado.slice(0, 16).replace("T", " "))} UTC.
      Temperatura: 21:01–21:00 · precipitación: 8:00–8:00 (hora local), según la DMC. Sin control de calidad oficial: los registros incoherentes van a Calidad y no entran al ranking.</p>
    ${MSG ? `<p style="color:var(--err)">${esc(MSG)}</p>` : ""}${vista()}`;
  o.querySelectorAll("[data-v]").forEach(x => x.onclick = () => { VISTA = x.dataset.v; pintar(); });
  o.querySelectorAll("[data-sac]").forEach(x => x.onclick = () => { const [vk, i] = x.dataset.sac.split("|"); sacar(vk, C.ranking[vk][+i]); });
  o.querySelectorAll("[data-dev]").forEach(x => x.onclick = () => devolver(x.dataset.dev));
  $("#agSem").onchange = e => { SEM = e.target.value; cargar(); };
  $("#agCsv").onclick = csv;
}
window.AGROBOL = {init: cargar};
})();
