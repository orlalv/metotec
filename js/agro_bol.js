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
  ${T.map((r, i) => `<tr data-ab="${vk}|${L.indexOf(r)}" style="cursor:pointer"><td>${i + 1}</td><td>${esc(est(r).nombre)}${r.estado !== "ok" ? ` <span title="${esc(r.motivo)}" style="color:${r.estado === "error" ? "var(--err)" : "var(--oro)"};cursor:help">⚠ ${r.estado}</span>` : ""}</td><td>${r.cod}</td><td>${esc(C.regiones[r.reg])}</td><td>${esc(est(r).prop)}</td>
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
  return `<p class="tag" style="margin:0 0 8px">Los <b style="color:var(--err)">errores</b> groseros (mínima mayor que máxima, fuera de rango físico) quedan <b>fuera del ranking</b> y solo aparecen aquí. Los <b style="color:var(--oro)">dudosos</b> entran al ranking marcados ⚠ y se sacan a mano.</p>` + grupo("tmax", "Tmax") + grupo("tmin", "Tmin") + grupo("pp24", "Precipitación") +
    `<div class="bcard" style="padding:10px;margin-bottom:12px"><b>Sacados a mano</b> <span class="tag">· ${S.length}</span><table class="xtab"><tr><th>Variable</th><th>Estación</th><th>Día</th><th class="n">Valor</th><th>Motivo</th><th>Fecha</th><th></th></tr>
    ${S.map(([id, v]) => `<tr><td>${v.vk}</td><td>${esc((C.estaciones[v.cod] || {}).nombre || v.cod)} <small class="tag">${v.cod}</small></td><td>${diaTxt(C.dias[v.dia])}</td><td class="n">${f1(v.valor)}</td><td>${esc(v.motivo)}</td><td><small>${esc(v.t)}</small></td><td><button data-dev="${esc(id)}">Devolver</button></td></tr>`).join("") || `<tr><td colspan="7" class="tag">Ninguno</td></tr>`}</table></div>
    <p class="tag">«s/p» del boletín pluviométrico se cuenta como sin precipitación (0 mm).</p>`;
}

/* catálogo de estaciones con vecinas (como R.estaciones del control) para la ventana de Fallas */
let CAT = null;
async function catalogo(){
  if (CAT) return CAT;
  if (typeof R !== "undefined" && R && R.estaciones) return (CAT = R);
  let L = [];
  for (const u of ["/api/minutarios?estaciones=1", "/api/datosraw?p=estaciones.json"]){ try { const j = await (await fetch(u)).json(); L = Array.isArray(j) ? j : j.estaciones || []; if (L.length) break; } catch (e) {} }
  const km = (a, b) => { const r = Math.PI / 180, q = Math.sin((b.lat - a.lat) * r / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin((b.lon - a.lon) * r / 2) ** 2; return 12742 * Math.asin(Math.sqrt(q)); };
  L = L.map(e => Object.assign({}, e, {codigo: String(e.codigo)}));
  L.forEach(e => { e.vecinas = e.lat == null ? [] : L.filter(o => o !== e && o.lat != null).map(o => [o.codigo, km(e, o)]).filter(x => x[1] <= 120).sort((x, y) => x[1] - y[1]).slice(0, 5).map(x => x[0]); });
  return (CAT = {estaciones: L});
}
function modalB(){ let M = $("#agBolM"); if (!M){ M = document.createElement("div"); M.id = "agBolM"; M.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:50;overflow:auto;padding:30px 12px"; document.body.appendChild(M); M.addEventListener("click", e => { if (e.target === M) M.hidden = true; }); } M.hidden = false; return M; }
/* ---------- ventana: la estación y sus vecinas (misma provincia; si son menos de 3, la región) durante la semana ---------- */
const IX = {tmax: 1, tmin: 0, pp: 2};
const kmE = (a, b) => { const r = Math.PI / 180, q = Math.sin((b.lat - a.lat) * r / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin((b.lon - a.lon) * r / 2) ** 2; return 12742 * Math.asin(Math.sqrt(q)); };
function vecinas(cod){
  const e = C.estaciones[cod] || {}, todos = Object.keys(C.serie).filter(c => c !== cod && C.estaciones[c]);
  if (e.lat != null){      // con ubicación: las más cercanas (≤ 60 km, hasta 10)
    const V = todos.filter(c => C.estaciones[c].lat != null).map(c => [c, kmE(e, C.estaciones[c])]).filter(x => x[1] <= 60).sort((a, b) => a[1] - b[1]).slice(0, 10);
    if (V.length >= 2) return {V: V.map(x => x[0]), nivel: "≤ 60 km", dist: Object.fromEntries(V)};
  }
  let V = todos.filter(c => C.estaciones[c].prov === e.prov && C.estaciones[c].reg === e.reg), nivel = "provincia de " + (e.prov || "?");
  if (V.length < 3){ V = todos.filter(c => C.estaciones[c].reg === e.reg); nivel = "región de " + (C.regiones[e.reg] || "?"); }
  return {V, nivel};
}
const mediana = a => { const b = a.filter(x => x != null).sort((x, y) => x - y); return b.length ? (b.length % 2 ? b[(b.length - 1) / 2] : (b[b.length / 2 - 1] + b[b.length / 2]) / 2) : null; };
function graficoSemana(vk, cod, V, diaSel){
  const k = IX[vk], W = 820, Hh = 300, ml = 46, mr = 16, mt = 16, mb = 34, pp = vk === "pp", u = pp ? "mm" : "°C";
  const serie = c => (C.serie[c] || []).map(d => d[k]);
  const todos = [serie(cod), ...V.map(serie)].flat().filter(x => x != null);
  if (!todos.length) return "<p class='tag'>Sin datos</p>";
  let lo = Math.min(...todos, pp ? 0 : Infinity), hi = Math.max(...todos); const pad = pp ? 0 : Math.max(1, (hi - lo) * 0.08); lo -= pad; hi += pad; if (hi - lo < 2) hi = lo + 2;
  const X = i => ml + (W - ml - mr) * (i + 0.5) / 7, Y = v => mt + (Hh - mt - mb) * (1 - (v - lo) / (hi - lo));
  const curva = a => {      // curva suavizada (Catmull-Rom) por tramos con dato
    let d = "", seg = [];
    const corta = () => { if (seg.length === 1) d += `M${seg[0][0]} ${seg[0][1]}`; else if (seg.length > 1){ d += `M${seg[0][0]} ${seg[0][1]}`; for (let i = 0; i < seg.length - 1; i++){ const p0 = seg[i - 1] || seg[i], p1 = seg[i], p2 = seg[i + 1], p3 = seg[i + 2] || p2;
      d += `C${(p1[0] + (p2[0] - p0[0]) / 6).toFixed(1)} ${(p1[1] + (p2[1] - p0[1]) / 6).toFixed(1)} ${(p2[0] - (p3[0] - p1[0]) / 6).toFixed(1)} ${(p2[1] - (p3[1] - p1[1]) / 6).toFixed(1)} ${p2[0].toFixed(1)} ${p2[1].toFixed(1)}`; } } seg = []; };
    a.forEach((v, i) => { if (v == null) corta(); else seg.push([X(i), Y(v)]); }); corta(); return d; };
  const med = Array.from({length: 7}, (_, i) => mediana(V.map(c => serie(c)[i])));
  let g = "";
  const bw7 = (W - ml - mr) / 7, s0 = diaSel != null ? diaSel : 0;
  g += `<rect class="gsSel" data-x0="${X(s0) - bw7 / 2}" data-i0="${s0}" data-w="${bw7}" x="${X(s0) - bw7 / 2}" y="${mt}" width="${bw7}" height="${Hh - mt - mb}" fill="#5fa8d3" opacity=".10"/>`;
  for (let j = 0; j <= 4; j++){ const v = lo + (hi - lo) * j / 4; g += `<line x1="${ml}" x2="${W - mr}" y1="${Y(v)}" y2="${Y(v)}" stroke="var(--bd)" stroke-dasharray="2 4"/><text x="${ml - 6}" y="${Y(v) + 4}" text-anchor="end" font-size="11" fill="var(--mu)">${v.toFixed(pp ? 0 : 1)}</text>`; }
  g += `<text x="${ml - 6}" y="10" text-anchor="end" font-size="10.5" fill="var(--mu)">${u}</text>`;
  C.dias.forEach((d, i) => g += `<text x="${X(i)}" y="${Hh - 12}" text-anchor="middle" font-size="11.5" fill="${i === diaSel ? "#e8783a" : "var(--mu)"}" font-weight="${i === diaSel ? 700 : 400}">${diaTxt(d)}</text>`);
  if (pp){ const bw = (W - ml - mr) / 7 * 0.3;
    serie(cod).forEach((v, i) => { if (v != null) g += `<rect x="${X(i) - bw}" y="${Y(v)}" width="${bw}" height="${Y(lo) - Y(v)}" rx="2" fill="#e8783a"/>`; });
    med.forEach((v, i) => { if (v != null) g += `<rect x="${X(i) + 1}" y="${Y(v)}" width="${bw}" height="${Y(lo) - Y(v)}" rx="2" fill="#5fa8d3" opacity=".75"/>`; });
  } else {
    V.forEach(c => g += `<path data-vec="${c}" d="${curva(serie(c))}" fill="none" stroke="#8e99a2" stroke-width="1" opacity=".35"/>`);
    g += `<path d="${curva(med)}" fill="none" stroke="#5fa8d3" stroke-width="2.2"/><path d="${curva(serie(cod))}" fill="none" stroke="#e8783a" stroke-width="2.8"/>`;
    med.forEach((v, i) => { if (v != null) g += `<circle cx="${X(i)}" cy="${Y(v)}" r="3" fill="#5fa8d3"/>`; });
    serie(cod).forEach((v, i) => { if (v != null) g += `<circle cx="${X(i)}" cy="${Y(v)}" r="4" fill="#e8783a"/><text x="${X(i)}" y="${Y(v) - 9}" text-anchor="middle" font-size="11" font-weight="700" fill="#e8783a">${f1(v)}</text>`; });
  }
  g += `<line class="gsCur" x1="0" x2="0" y1="${mt}" y2="${Hh - mb}" stroke="var(--mu)" stroke-width="1" opacity="0"/>`;
  for (let i = 0; i < 7; i++) g += `<rect class="gsZona" data-i="${i}" x="${X(i) - (W - ml - mr) / 14}" y="${mt}" width="${(W - ml - mr) / 7}" height="${Hh - mt - mb}" fill="transparent" style="cursor:pointer"/>`;
  const datos = encodeURIComponent(JSON.stringify({u, est: [est({cod}).nombre, serie(cod)], med, vec: V.map(c => [(C.estaciones[c] || {}).nombre || c, serie(c), c])}));
  return `<div class="gsWrap" data-gs="${datos}" style="position:relative"><svg viewBox="0 0 ${W} ${Hh}" style="width:100%;height:auto;background:var(--fondo);border:1px solid var(--bd);border-radius:8px">${g}</svg>
    <div class="gsTip" hidden style="position:absolute;pointer-events:none;background:#0d1117f2;border:1px solid var(--bd);border-radius:8px;padding:8px 10px;font-size:12px;min-width:200px;max-width:280px;z-index:3"></div></div>
    <small class="tag"><span style="color:#e8783a">●</span> la estación · <span style="color:#5fa8d3">●</span> mediana de las vecinas${pp ? "" : " · gris: cada vecina"} · pase el mouse para ver los valores del día · valores del boletín</small>`;
}
function activarGrafico(raiz){
  raiz.querySelectorAll(".gsWrap").forEach(w => {
    const D = JSON.parse(decodeURIComponent(w.dataset.gs)), tip = w.querySelector(".gsTip"), cur = w.querySelector(".gsCur"), svg = w.querySelector("svg");
    w.querySelectorAll(".gsZona").forEach(z => {
      z.addEventListener("mousemove", ev => {
        const i = +z.dataset.i, x = +z.getAttribute("x") + +z.getAttribute("width") / 2; cur.setAttribute("x1", x); cur.setAttribute("x2", x); cur.setAttribute("opacity", ".6");
        const v = D.est[1][i], m = D.med[i], dif = v != null && m != null ? v - m : null;
        const fil = D.vec.map(([n, s]) => [n, s[i]]).filter(x => x[1] != null).sort((a, b) => b[1] - a[1]);
        tip.innerHTML = `<b>${esc(diaTxt(C.dias[i]))}</b><div style="margin:4px 0;color:#e8783a"><b>${esc(D.est[0])}: ${f1(v)} ${D.u}</b></div>
          <div style="color:#5fa8d3">Mediana vecinas: ${f1(m)} ${D.u}${dif != null ? ` · diferencia ${dif > 0 ? "+" : ""}${f1(dif)}` : ""}</div>
          <div style="margin-top:5px;border-top:1px solid var(--bd);padding-top:4px;max-height:170px;overflow:hidden">${fil.map(([n, x]) => `<div style="display:flex;justify-content:space-between;gap:10px"><span style="color:var(--mu)">${esc(n)}</span><span>${f1(x)}</span></div>`).join("") || "<span class='tag'>Sin vecinas con dato</span>"}</div>`;
        tip.hidden = false; const r = w.getBoundingClientRect(), px = ev.clientX - r.left, tw = tip.offsetWidth;
        tip.style.left = Math.min(r.width - tw - 4, Math.max(4, px + (px > r.width / 2 ? -tw - 14 : 14))) + "px"; tip.style.top = Math.max(4, Math.min(r.height - tip.offsetHeight - 4, ev.clientY - r.top - 40)) + "px";
      });
      z.addEventListener("mouseleave", () => { tip.hidden = true; cur.setAttribute("opacity", "0"); });
    });
    void svg;
  });
}

async function ventana(vk, r){
  const e0 = est(r), sa0 = SAC[idDe(vk, r)];
  if (window.FALLAS && window.L && e0.prop === "DMC" && r.fecha){        // estaciones DMC: la misma ventana de Fallas (minutario con zoom + mapa de vecinas)
    const RR = await catalogo(), eR = RR.estaciones.find(x => x.codigo === r.cod);
    if (eR && eR.lat != null){
      const [y, mo, d] = r.fecha.split("-").map(Number), lu = AGRO._t.localAUtc, pp = vk === "pp", col = pp ? "rr1m" : "T";
      const a = pp ? lu(y, mo, d, 8, 0) : lu(y, mo, d - 1, 21, 1), b = pp ? lu(y, mo, d + 1, 8, 0) : lu(y, mo, d, 21, 0);
      let tx = null; if (!pp){ try { const P = await FALLAS.serie(r.cod, "T", a, b); if (P.length) tx = P.reduce((m, q) => (vk === "tmax" ? q[1] > m[1] : q[1] < m[1]) ? q : m)[0]; } catch (er) {} }
      const RRq = typeof R !== "undefined" ? R : null, eQ = RRq && (RRq.estaciones || []).find(x => x.codigo === r.cod);
      const esp = !pp && !!(window.SUPER && SUPER.mapaEsp && window.supVec && eQ && eQ.lat != null);
      const M = modalB();
      M.innerHTML = `<div style="max-width:1100px;margin:0 auto;background:var(--panel);border:1px solid var(--bd);border-radius:12px;padding:16px">
        <div style="display:flex;justify-content:space-between;gap:10px;align-items:flex-start"><div><h3 style="margin:0;font-size:16px">${esc(e0.nombre)} <small class="tag">${r.cod} · ${esc(e0.comuna || "")}, ${esc(C.regiones[r.reg])}</small></h3>
        <p style="margin:6px 0 0">${VK[vk]} del boletín: <b>${f1(r.valor)}</b> · ${diaTxt(r.fecha)} <span class="tag">· tramo marcado = día del boletín (${pp ? "8:00 a 8:00" : "21:01 a 21:00"} hora local)</span></p>
        ${r.estado !== "ok" ? `<p style="margin:4px 0 0;color:${r.estado === "error" ? "var(--err)" : "var(--oro)"}">⚠ ${r.estado}: ${esc(r.motivo)}</p>` : ""}</div><button data-x>✕ Cerrar</button></div>
        <div id="agBolFal" style="margin-top:10px"></div>
        ${esp ? `<div style="margin-top:12px"><b style="font-size:13px">Control espacial</b><div class="espMapT" style="font-size:12.5px;margin:4px 0"></div><div class="espMap" style="height:420px;border:1px solid var(--bd);border-radius:8px"></div><small style="color:var(--mu)">Rojo = la estación · azul = vecinas DMC · naranja = externas (INIA y otras)</small></div>` : ""}
        <div style="margin-top:12px;border-top:1px solid var(--bd);padding-top:10px">${sa0 ? `<span style="color:var(--err)">Sacado del ranking: ${esc(sa0.motivo)}</span>` : `<button data-sac style="font-weight:700">Sacar del ranking</button>`}</div></div>`;
      M.querySelector("[data-x]").onclick = () => { M.hidden = true; };
      const bs = M.querySelector("[data-sac]"); if (bs) bs.onclick = async () => { M.hidden = true; await sacar(vk, r); };
      FALLAS.grafico(M.querySelector("#agBolFal"), {codigo: r.cod, nombre: e0.nombre, var: col, inicio: a, ultima: b, sigue: false, minutos: (b - a) / 60e3, alertas: [], etiqueta: "día del boletín",
        tmapa: tx || (pp ? b : a + (b - a) / 2), tmapaTxt: tx ? `en el momento de la ${vk === "tmax" ? "máxima" : "mínima"}` : (pp ? "al cierre del día del boletín" : "a mitad del día del boletín")}, RR);
      if (esp){ setTimeout(() => { const fm = M.querySelector("#agBolFal .fmap"), ft = M.querySelector("#agBolFal .fmapt"); if (fm) fm.style.display = "none"; if (ft) ft.style.display = "none"; }, 50);
        try { SUPER.mapaEsp(M.querySelector(".espMap"), M.querySelector(".espMapT"), eQ, window.supVec(r.cod), {regla: "ZE05", msg: vk === "tmin" ? "Ts mínima" : "Ts máxima"}, new Date(b).toISOString().slice(0, 16)); }
        catch (er){ M.querySelector(".espMapT").textContent = "No se pudo dibujar el mapa."; } }
      return;
    }
  }
  let M = $("#agBolM"); if (!M){ M = document.createElement("div"); M.id = "agBolM"; M.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:50;overflow:auto;padding:30px 12px"; document.body.appendChild(M); M.addEventListener("click", e => { if (e.target === M) M.hidden = true; }); }
  const e = est(r), {V, nivel, dist} = vecinas(r.cod), k = IX[vk], dia = r.dia, u = vk === "pp" ? "mm" : "°C";
  const filas = V.map(c => ({c, v: (C.serie[c][dia] || [])[k]})).filter(x => x.v != null).sort((a, b) => vk === "tmin" ? a.v - b.v : b.v - a.v);
  const med = mediana(filas.map(x => x.v)), dif = med == null || dia == null ? null : r.valor - med;
  const sa = SAC[idDe(vk, r)];
  M.hidden = false;
  M.innerHTML = `<div style="max-width:1000px;margin:0 auto;background:var(--panel);border:1px solid var(--bd);border-radius:12px;padding:16px">
    <div style="display:flex;justify-content:space-between;gap:10px;align-items:flex-start"><div><h3 style="margin:0;font-size:16px">${esc(e.nombre)} <small class="tag">${r.cod} · ${esc(e.prop)} · ${esc(e.comuna || "")}, ${esc(C.regiones[r.reg])}</small></h3>
      <p style="margin:6px 0 0">${VK[vk]}: <b>${f1(r.valor)} ${u}</b> · ${diaTxt(r.fecha)}${dif != null ? ` · <span style="color:${Math.abs(dif) > (vk === "pp" ? 10 : 5) ? "var(--err)" : "var(--mu)"}">${dif > 0 ? "+" : ""}${f1(dif)} ${u} respecto de la mediana de sus vecinas (${f1(med)})</span>` : ""}</p>
      ${r.estado !== "ok" ? `<p style="margin:4px 0 0;color:${r.estado === "error" ? "var(--err)" : "var(--oro)"}">⚠ ${r.estado}: ${esc(r.motivo)}</p>` : ""}</div>
      <button id="agBolX">✕ Cerrar</button></div>
    <div style="margin-top:12px">${graficoSemana(vk, r.cod, V, r.dia)}</div>
    <div class="htools" id="agBolDias" style="gap:4px;flex-wrap:wrap;margin:8px 0 0">${C.dias.map((d, i) => `<button data-d="${i}">${diaTxt(d)}</button>`).join("")}<span class="tag" style="align-self:center;margin-left:6px">clic en un día (o en el gráfico) para ver ese día en el mapa y la tabla</span></div>
    ${e.lat != null && window.L ? `<div id="agBolMap" style="height:380px;margin-top:10px;border:1px solid var(--bd);border-radius:8px"></div><small class="tag" id="agBolMapT"></small>` : ""}
    <div id="agBolTab"></div>
    <div style="margin-top:12px;border-top:1px solid var(--bd);padding-top:10px;display:flex;gap:8px;align-items:center;flex-wrap:wrap">
      ${sa ? `<span style="color:var(--err)">Sacado del ranking: ${esc(sa.motivo)}</span>` : (dia != null ? `<button id="agBolSac" style="font-weight:700">Sacar del ranking</button>` : "")}
      ${e.prop === "DMC" ? `<a href="estacion.html?cod=${r.cod}" target="_blank">Ver datos minutarios de la estación ↗</a>` : ""}</div></div>`;
  $("#agBolX").onclick = () => { M.hidden = true; };
  activarGrafico(M);
  // mapa (se crea una vez) y tabla, para el día elegido
  let mp = null, capa = null;
  const et = (n, v, col) => L.divIcon({className: "", iconSize: null, html: `<div style="transform:translate(-50%,-100%);white-space:nowrap;background:#0d1117dd;border:1px solid ${col};color:#fff;border-radius:6px;padding:1px 6px;font:600 11.5px system-ui;text-align:center">${esc(n)}<br><span style="color:${col}">${v}</span></div>`});
  const verDia = i => {
    const ve = (C.serie[r.cod][i] || [])[k], fl = V.map(c => ({c, v: (C.serie[c][i] || [])[k]})).filter(x => x.v != null).sort((a, b) => vk === "tmin" ? a.v - b.v : b.v - a.v);
    const md = mediana(fl.map(x => x.v)), df = ve == null || md == null ? null : ve - md;
    M.querySelectorAll("#agBolDias [data-d]").forEach(b => b.classList.toggle("on", +b.dataset.d === i));
    M.querySelectorAll(".gsSel").forEach(x => x.setAttribute("x", x.dataset.x0 - 0 + (i - (x.dataset.i0 - 0)) * (x.dataset.w - 0)));
    $("#agBolTab").innerHTML = `<h4 style="margin:14px 0 6px;font-size:13px">Vecinas · ${esc(nivel)} · ${diaTxt(C.dias[i])} <span class="tag">(${fl.length} con dato · mediana ${f1(md)} ${u})</span></h4>
      <div style="max-height:300px;overflow:auto"><table class="xtab"><tr><th>Estación</th><th>Código</th><th>Comuna</th><th>Propietario</th><th class="n">${VK[vk]}</th><th class="n">Diferencia</th></tr>
      <tr style="background:var(--hover)"><td><b>${esc(e.nombre)}</b></td><td>${r.cod}</td><td>${esc(e.comuna || "")}</td><td>${esc(e.prop)}</td><td class="n"><b>${f1(ve)}</b></td><td class="n">${df != null ? (df > 0 ? "+" : "") + f1(df) : "—"}</td></tr>
      ${fl.map(x => { const o = C.estaciones[x.c] || {}; return `<tr><td>${esc(o.nombre)}${dist ? ` <small class="tag">${Math.round(dist[x.c])} km</small>` : ""}</td><td>${x.c}</td><td>${esc(o.comuna || "")}</td><td>${esc(o.prop)}</td><td class="n">${f1(x.v)}</td><td class="n">${ve == null ? "—" : f1(ve - x.v)}</td></tr>`; }).join("")}</table></div>`;
    if (!$("#agBolMap")) return;
    if (!mp){ mp = L.map($("#agBolMap"), {attributionControl: false}); L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {maxZoom: 13}).addTo(mp);
      const pts = [[e.lat, e.lon], ...V.map(c => C.estaciones[c]).filter(o => o && o.lat != null).map(o => [o.lat, o.lon])];
      if (pts.length > 1) mp.fitBounds(pts, {padding: [50, 50], maxZoom: 11}); else mp.setView(pts[0], 10); }
    if (capa) capa.remove(); capa = L.layerGroup().addTo(mp);
    L.marker([e.lat, e.lon], {icon: et(e.nombre, ve == null ? "sin dato" : f1(ve) + " " + u, "#f85149"), zIndexOffset: 1000}).addTo(capa);
    V.forEach(c => { const o = C.estaciones[c]; if (!o || o.lat == null) return; const v = (C.serie[c][i] || [])[k];
      L.marker([o.lat, o.lon], {icon: et(`${o.nombre}${dist ? " · " + Math.round(dist[c]) + " km" : ""}`, v == null ? "sin dato" : f1(v) + " " + u, v == null ? "#8e99a2" : "#58a6ff")}).addTo(capa); });
    $("#agBolMapT").textContent = `Valores del boletín del ${diaTxt(C.dias[i])} · rojo = la estación, azul = vecinas, gris = sin dato${e.ext ? ` · ubicada como «${e.ext_nombre || e.ext}» de la red externa` : ""}`;
  };
  M.querySelectorAll("#agBolDias [data-d]").forEach(b => b.onclick = () => verDia(+b.dataset.d));
  M.querySelectorAll(".gsZona").forEach(z => z.addEventListener("click", () => verDia(+z.dataset.i)));
  verDia(dia != null ? dia : 0);
  if ($("#agBolSac")) $("#agBolSac").onclick = async () => { M.hidden = true; await sacar(vk, r); };
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
      Temperatura: 21:01–21:00 · precipitación: 8:00–8:00 (hora local), según la DMC. Sin control de calidad oficial: nada se excluye solo; los datos marcados ⚠ (error o dudoso, ver motivo en Calidad) se sacan a mano con «Sacar».</p>
    ${MSG ? `<p style="color:var(--err)">${esc(MSG)}</p>` : ""}${vista()}`;
  o.querySelectorAll("[data-v]").forEach(x => x.onclick = () => { VISTA = x.dataset.v; pintar(); });
  o.querySelectorAll("[data-sac]").forEach(x => x.onclick = ev => { ev.stopPropagation(); const [vk, i] = x.dataset.sac.split("|"); sacar(vk, C.ranking[vk][+i]); });
  o.querySelectorAll("[data-ab]").forEach(x => x.onclick = () => { const [vk, i] = x.dataset.ab.split("|"); ventana(vk, C.ranking[vk][+i]); });
  o.querySelectorAll("[data-dev]").forEach(x => x.onclick = () => devolver(x.dataset.dev));
  $("#agSem").onchange = e => { SEM = e.target.value; cargar(); };
  $("#agCsv").onclick = csv;
}
/* En qc.html (pestaña Agro del control) se monta el mismo selector «Compendio semanal / Minutario» que en agro.html */
function montar(){
  if ($("#agBol")){ if (!C) cargar(); return; }
  const ag = $("#agro"); if (!ag) return;            // qc.html: todo va dentro de la sección «agro» (se oculta con las demás pestañas)
  ag.innerHTML = `<div class="htools" style="gap:6px;margin:0 0 12px"><button id="mBol" class="on">Compendio semanal (boletines)</button><button id="mMin">Minutario (UTC)</button></div><section id="agBol"></section><section id="agroMin" hidden></section>`;
  let minIni = false; const modo = m => { $("#mBol").classList.toggle("on", m === "bol"); $("#mMin").classList.toggle("on", m === "min"); $("#agBol").hidden = m !== "bol"; $("#agroMin").hidden = m !== "min"; if (m === "min" && !minIni){ minIni = true; AGRO.init(); } };
  $("#mBol").onclick = () => modo("bol"); $("#mMin").onclick = () => modo("min"); cargar();
}
window.AGROBOL = {init: cargar, montar};
})();
