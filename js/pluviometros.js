/* Pluviómetros posiblemente obstruidos: estaciones donde probablemente llovió y el pluviómetro marcó 0 o casi nada.
   Lo calcula qc/pluviometros.py (cada 6 h). Aquí se ve, para cada estación sospechosa, qué evidencias coincidieron hora por hora:
   vecinas, modelo y satélite GOES (nube fría, tope más frío, rayos). Es una sospecha para mandar a revisión, nunca una corrección del dato. */
(function(){
const $ = s => document.querySelector(s);
const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;"})[c]);
const COL = {sospecha_obstruccion: "#f85149", revisar: "#d29922", sin_dato_con_lluvia: "#8b949e"};
const TXT = {sospecha_obstruccion: "Sospecha de obstrucción", revisar: "Revisar", sin_dato_con_lluvia: "Sin dato con lluvia (comunicación)"};
let clave = () => "", D = null, filtro = "todas", q = "";
const f5 = t => esc(String(t || "").slice(5));

function init(fclave){
  clave = fclave || clave;
  const s = $("#plu"); if (!s.dataset.ok){
    s.dataset.ok = 1;
    s.innerHTML = `<div class="htools"><span id="pRes"></span><input id="pQ" placeholder="Buscar estación o código" style="min-width:200px"><button id="pRec">↻ Actualizar</button></div>
      <div id="pOut"><p style="color:var(--mu)">Cargando…</p></div>`;
    $("#pQ").addEventListener("input", ev => { q = ev.target.value.trim().toLowerCase(); pintar(); });
    $("#pRec").addEventListener("click", cargar);
    s.addEventListener("click", ev => { const b = ev.target.closest("button[data-f]"); if (b){ filtro = b.dataset.f; pintar(); } });
  }
  cargar();
}
async function cargar(){
  try {
    const r = await fetch("/api/reputacion", {headers: {"x-clave": clave()}, cache: "no-store"});
    if (!r.ok) throw new Error(await r.text());
    D = (await r.json()).pluviometros;
  } catch (e){ $("#pOut").innerHTML = `<p style="color:#f85149">No se pudo cargar: ${esc(e.message)}</p>`; return; }
  pintar();
}
function celda(v, extra){ return `<td style="text-align:right${extra || ""}">${v}</td>`; }
const n1 = v => (Math.round(v * 10) / 10).toLocaleString("es-CL");
const GRAV = {sospecha_obstruccion: 0, revisar: 1, sin_dato_con_lluvia: 2};
let orden = (() => { try { return localStorage.getItem("qcPluOrd") || "grav"; } catch (e) { return "grav"; } })();
const dots = n => `<span title="${n} de 4 evidencias coinciden (vecinas, modelo, satélite, IMERG)" style="letter-spacing:1px;color:${n >= 3 ? "#3fb950" : n === 2 ? "#d29922" : "var(--mu)"}">${"●".repeat(n)}${"○".repeat(4 - n)}</span>`;
const confianza = e => Math.max(0, ...(e.episodios || []).map(x => Object.values(x.evidencia || {}).filter(Boolean).length));
const medido = e => { let t = 0, hay = false; (e.episodios || []).forEach(x => (x.detalle || []).forEach(d => { if (d.sospechosa){ hay = true; t += d.est || 0; } })); return hay ? t : null; };
const esperado = e => (e.episodios || []).reduce((t, x) => t + ((x.mm_vecinas || 0) > 0 ? x.mm_vecinas : (x.mm_modelo || 0)), 0);

/* gráfico por episodio: barra = estación; ● vecinas, ▬ modelo (esta hora), ▲ IMERG */
function grafico(det){
  if (!det.length) return "";
  const vals = det.flatMap(d => [d.est, d.n_tot ? d.vec : null, (d.mod3 || [])[1], d.imerg]).filter(v => v != null);
  const mx = Math.max(1, ...vals) * 1.15, W = 70, H = 120, base = 100, y = v => base - (v / mx) * (base - 8);
  const cols = det.map((d, i) => { const x = 20 + i * W, c = x + W / 2 - 10, m = (d.mod3 || [])[1];
    return `<g><rect x="${x + 4}" y="0" width="${W - 8}" height="${base}" fill="${d.sospechosa ? "#f8514914" : "transparent"}"/>
      ${d.est == null ? `<text x="${c}" y="${base - 6}" text-anchor="middle" font-size="10" fill="#8b949e">s/d</text>` : `<rect x="${c - 12}" y="${y(d.est)}" width="24" height="${Math.max(1, base - y(d.est))}" fill="${d.sospechosa ? "#f85149" : "#8b949e"}"><title>Estación ${n1(d.est)} mm</title></rect>`}
      ${d.n_tot ? `<circle cx="${c - 14}" cy="${y(d.vec)}" r="4" fill="#58a6ff"><title>Vecinas ${n1(d.vec)} mm (${d.n_vec}/${d.n_tot} llueven)</title></circle>` : ""}
      ${m != null ? `<rect x="${c + 6}" y="${y(m) - 1.5}" width="16" height="3" fill="#d29922"><title>Modelo ${n1(m)} mm</title></rect>` : ""}
      ${d.imerg != null ? `<path d="M${c + 14} ${y(d.imerg) - 5} l5 9 h-10 z" fill="#3fb950"><title>IMERG ${n1(d.imerg)} mm</title></path>` : ""}
      <text x="${c}" y="${base + 14}" text-anchor="middle" font-size="10" fill="#8b949e">${esc(d.hora.slice(6))}</text></g>`; }).join("");
  const w = 40 + det.length * W;
  return `<div style="overflow-x:auto"><svg viewBox="0 0 ${w} ${H + 6}" style="width:${w}px;max-width:100%;height:auto" role="img" aria-label="mm por hora: estación, vecinas, modelo e IMERG">
    <line x1="18" y1="${base}" x2="${w}" y2="${base}" stroke="#30363d"/><text x="2" y="${y(mx / 1.15) + 3}" font-size="9" fill="#8b949e">${n1(mx / 1.15)}</text><text x="2" y="${base}" font-size="9" fill="#8b949e">0</text>${cols}</svg></div>
    <div style="font-size:11.5px;color:var(--mu);margin:2px 0 6px"><span style="color:#f85149">■</span> estación (mm/h) · <span style="color:#58a6ff">●</span> vecinas · <span style="color:#d29922">▬</span> modelo (esta hora) · <span style="color:#3fb950">▲</span> IMERG · fondo rojo = hora sospechosa · horas UTC</div>`;
}
function episodio(e, abierto){
  const ev = e.evidencia || {}, det = e.detalle || [], num = (v, d, u) => v == null ? "—" : v.toFixed(d ?? 0) + (u || "");
  const imm = det.reduce((t, d) => t + (d.sospechosa && d.imerg ? d.imerg : 0), 0);
  const motivo = `<b>${e.horas} h</b> con ${n1(det.length ? det.filter(d => d.sospechosa).reduce((t, d) => t + (d.est || 0), 0) : 0)} mm medidos${e.sin_dato >= e.horas / 2 ? " (sin dato: comunicación)" : ""} · vecinas ${n1(e.mm_vecinas)} mm · modelo ${n1(e.mm_modelo)} mm${imm ? ` · IMERG ${n1(imm)} mm` : ""}${e.descarga_tardia ? " · <b>descarga tardía</b>" : ""}`;
  // columnas opcionales: solo las que traen algún dato en este episodio
  const COLS = [["Satélite", d => d.sat ? "✓" : "·", d => d.sat], ["Nube 10 km", d => num(d.nub10, 0, " %"), d => d.nub10 != null], ["Nube 30 km", d => num(d.nub30, 0, " %"), d => d.nub30 != null],
    ["Tope más frío", d => num(d.tope, 0, " °C"), d => d.tope != null], ["Área < −40 °C", d => num(d.frio30, 0, " %"), d => d.frio30 != null], ["Lluvia est. mm/h", d => num(d.rr10, 1), d => d.rr10 != null],
    ["Rayos", d => d.ray == null ? "—" : d.ray, d => d.ray != null], ["Imágenes", d => d.imagenes ?? "—", d => d.imagenes != null]].filter(c => det.some(c[2]));
  const filas = det.map(d => `<tr style="${d.sospechosa ? "background:#f8514916" : ""}"><td>${esc(d.hora)}</td>
    ${celda(d.est == null ? "<span style='color:var(--mu)'>sin dato</span>" : d.est.toFixed(1), d.sospechosa ? ";font-weight:600" : "")}
    ${celda(d.n_tot ? `${d.vec.toFixed(1)} <small style="color:var(--mu)">(${d.n_vec}/${d.n_tot})</small>` : "—")}
    ${celda((d.mod3 || []).map(x => x == null ? "·" : x.toFixed(1)).join(" / "))}${celda(num(d.imerg, 1))}${COLS.map(c => celda(c[1](d))).join("")}</tr>`).join("");
  const vv = {}; det.forEach(d => (d.vecs || []).forEach(([n, km]) => { vv[n] = km; }));
  const nombres = Object.keys(vv).sort((a, b) => vv[a] - vv[b]);
  const vecTabla = nombres.length ? `<details style="margin:6px 0"><summary style="cursor:pointer">Vecinas una a una (${nombres.length})</summary>
    <table class="tb" style="font-size:12px;margin-top:4px"><tr><th>Vecina</th><th>km</th>${det.map(d => `<th>${esc(d.hora.slice(6))}</th>`).join("")}</tr>
    ${nombres.map(n => `<tr><td>${esc(n)}</td>${celda(vv[n])}${det.map(d => { const x = (d.vecs || []).find(z => z[0] === n); const v = x ? x[2] : null;
      return `<td style="text-align:right;${v != null && v >= 1 ? "background:#1f6feb44" : ""}">${v == null ? "<span style='color:var(--mu)'>s/d</span>" : v.toFixed(1)}</td>`; }).join("")}</tr>`).join("")}
    </table><small style="color:var(--mu)">Resaltadas las que midieron ≥ 1 mm; s/d = sin dato. Horas UTC.</small></details>` : "";
  const sinVec = det.length && det.every(d => !d.n_tot);
  const insig = (sinVec ? `<span style="font-size:11px;padding:1px 7px;border-radius:9px;border:1px solid #d29922;color:#d29922" title="Sin vecinas con dato a ≤ 60 km: la sospecha se apoya solo en modelo y satélite">menor confianza · sin vecinas</span>` : "")
    + [["vecinas", ev.vecinas], ["modelo", ev.modelo], ["satélite", ev.satelite], ["IMERG", ev.imerg]].filter(x => x[1]).map(([n]) => `<span style="font-size:11px;padding:1px 7px;border-radius:9px;margin-left:4px;background:#1f6feb55;border:1px solid #1f6feb">${n}</span>`).join("");
  return `<details ${abierto ? "open" : ""} style="margin:6px 0;border-top:1px solid var(--bd,#30363d);padding-top:6px"><summary style="cursor:pointer"><b>${f5(e.inicio)} → ${f5(e.fin)}</b> UTC · ${motivo}</summary>
    <div style="margin:6px 0">${insig}</div>
    ${det.length ? grafico(det) : `<div style="color:var(--mu);margin:4px 0">El detalle hora por hora se genera en la próxima corrida del análisis (cada 6 h).</div>`}
    ${det.length ? `<details style="margin:4px 0"><summary style="cursor:pointer">Tabla hora por hora</summary><div style="overflow-x:auto"><table class="tb" style="font-size:12px"><tr><th>Hora UTC</th><th>Estación mm</th><th>Vecinas mm (llueven/con dato)</th><th>Modelo mm (ant. / esta / sig.)</th><th>IMERG mm</th>${COLS.map(c => `<th>${c[0]}</th>`).join("")}</tr>${filas}</table></div></details>` : ""}
    ${vecTabla}</details>`;
}
function tarjeta(e, i){
  const partes = [];
  if (e.eventos_sin_marcar) partes.push(`<b>Lleva ${e.eventos_sin_marcar} evento${e.eventos_sin_marcar > 1 ? "s" : ""} de lluvia sin marcar</b>, desde ${f5(e.sin_marcar_desde)} UTC${e.ultima_vez_que_marco ? ` (última vez que marcó: ${f5(e.ultima_vez_que_marco)})` : ""}`);
  (e.goteo || []).slice(-2).forEach(g => partes.push(`<b>Goteo</b>: ${g.horas} h seguidas con 0,1–0,2 mm sin lluvia alrededor (${g.mm} mm), ${f5(g.inicio)} → ${f5(g.fin)} UTC`));
  if ((e.lluvia_con_cielo_despejado || []).length) partes.push(`<b>Lluvia con cielo despejado</b>: ${e.lluvia_con_cielo_despejado.map(x => `${f5(x.hora)} (${x.mm} mm)`).join(", ")}`);
  if (e.razon_vecinas != null) partes.push(`En el periodo marca ${Math.round(e.razon_vecinas * 100)} % de lo que miden sus vecinas (${e.vecinas_comparadas} comparadas)`);
  const eps = (e.episodios || []).slice(0, 3), ult = eps[0], md = medido(e), ex = esperado(e);
  return `<details data-cod="${esc(e.codigo)}" ${abiertos.has(e.codigo) ? "open" : ""} style="border:1px solid var(--bd,#30363d);border-left:4px solid ${COL[e.estado]};border-radius:6px;padding:8px 12px;margin:6px 0">
    <summary style="cursor:pointer;display:grid;grid-template-columns:minmax(250px,2.2fr) 190px 95px minmax(190px,1.4fr) 170px auto;gap:4px 14px;align-items:baseline;list-style:none">
      <span style="font-size:14.5px"><span style="color:var(--mu)">▸</span> <b>${esc(e.nombre)}</b> <small style="color:var(--mu)">${esc(e.codigo)}</small></span>
      <span style="color:${COL[e.estado]}">${TXT[e.estado]}</span>
      <span>${e.horas_sospechosas} h${e.horas_sin_dato ? ` <small style="color:var(--mu)">(${e.horas_sin_dato} sin dato)</small>` : ""}</span>
      <span title="mm medidos en horas sospechosas / mm esperados según vecinas o modelo">${md == null ? "—" : n1(md)} medidos · ~${n1(ex)} esperados</span>
      <span style="color:var(--mu)">${ult ? `último: ${f5(ult.inicio)} UTC` : ""}</span>${dots(confianza(e))}</summary>
    ${partes.map(t => `<div style="margin:6px 0 0">${t}</div>`).join("")}
    ${eps.map((x, k) => episodio(x, k === 0)).join("")}</details>`;
}
const abiertos = new Set();
function pintar(){
  const L0 = (D.estaciones || []).filter(e => e.estado !== "ok"), R = D.resumen || {};
  const chip = (f, t, n, c) => `<button data-f="${f}" class="${filtro === f ? "on" : ""}" style="${c ? `border-color:${c};` : ""}">${t}<b>${n ?? ""}</b></button>`;
  $("#pRes").innerHTML = chip("todas", "Todas las dudosas", L0.length) + chip("sospecha_obstruccion", "Sospecha de obstrucción", R.sospecha_obstruccion, COL.sospecha_obstruccion)
    + chip("revisar", "Revisar", R.revisar, COL.revisar) + chip("sin_dato_con_lluvia", "Sin dato con lluvia", R.sin_dato_con_lluvia, COL.sin_dato_con_lluvia);
  if (window.ppContar) ppContar("binaria", L0.length);
  let L = L0.filter(e => !q || (e.nombre || "").toLowerCase().includes(q) || e.codigo.includes(q));
  if (filtro !== "todas") L = L.filter(e => e.estado === filtro);
  const ORD = {grav: (a, b) => GRAV[a.estado] - GRAV[b.estado] || confianza(b) - confianza(a) || b.horas_sospechosas - a.horas_sospechosas, horas: (a, b) => b.horas_sospechosas - a.horas_sospechosas,
    mm: (a, b) => esperado(b) - esperado(a), nombre: (a, b) => (a.nombre || "").localeCompare(b.nombre || "")};
  L = L.slice().sort(ORD[orden] || ORD.grav);
  const f = D.fuentes || {};
  const fuentes = [["vecinas", "vecinas"], ["modelo", "modelo"], ["satelite", `satélite GOES${f.satelite_horas ? ` (${f.satelite_horas} h archivadas)` : ""}`], ["imerg", "IMERG (NASA)"]]
    .map(([k, n]) => `<span style="color:${f[k] ? "#3fb950" : "var(--mu)"}">${f[k] ? "●" : "○"} ${n}</span>`).join(" &nbsp; ");
  $("#pOut").innerHTML = `<div class="htools" style="margin:6px 0"><label>Ordenar por <select id="pOrd">${[["grav", "gravedad"], ["horas", "horas sospechosas"], ["mm", "mm esperados"], ["nombre", "nombre"]].map(([k, t]) => `<option value="${k}"${orden === k ? " selected" : ""}>${t}</option>`).join("")}</select></label>
      <button id="pAbrir">Abrir todo</button><button id="pCerrar">Cerrar todo</button><span style="color:var(--mu)">${L.length} estaciones · ●●●● = las 4 evidencias coinciden</span></div>
    ${L.map(tarjeta).join("") || `<p style="color:var(--mu)">Ningún pluviómetro dudoso con este filtro en el periodo analizado.</p>`}
    <details style="margin-top:12px;color:var(--mu);font-size:12.5px"><summary style="cursor:pointer">Cómo se decide · periodo y fuentes</summary><p>Periodo analizado: ${esc(D.desde || "—")} → ${esc(D.hasta || "—")} UTC (${D.dias ?? "—"} días, hasta donde hay datos minutarios). Actualizado ${esc(D.generado || "—")} UTC. Evidencias: ${fuentes}.<br>
    Una hora es sospechosa si la estación marcó menos de 0,2 mm (o no tuvo dato) y coinciden al menos 2 evidencias de lluvia, una de ellas las estaciones vecinas con dato. Si las vecinas están secas, no se sospecha. Es una sospecha para revisar en terreno, no una corrección.</p></details>`;
  const o = $("#pOut"); o.querySelector("#pOrd").onchange = ev => { orden = ev.target.value; try { localStorage.setItem("qcPluOrd", orden); } catch (e) {} pintar(); };
  o.querySelector("#pAbrir").onclick = () => { L.forEach(e => abiertos.add(e.codigo)); pintar(); };
  o.querySelector("#pCerrar").onclick = () => { abiertos.clear(); pintar(); };
  o.querySelectorAll("details[data-cod]").forEach(d => d.addEventListener("toggle", () => { d.open ? abiertos.add(d.dataset.cod) : abiertos.delete(d.dataset.cod); }));
}
async function contar(fclave){                  // solo el número de estaciones dudosas, para el contador de la subopción (sin pintar nada)
  clave = fclave || clave;
  try { const r = await fetch("/api/reputacion", {headers: {"x-clave": clave()}, cache: "no-store"}); if (!r.ok) return; const d = (await r.json()).pluviometros;
    if (window.ppContar) ppContar("binaria", ((d && d.estaciones) || []).filter(e => e.estado !== "ok").length); } catch (e){}
}
window.PLU = {init, contar};
})();
