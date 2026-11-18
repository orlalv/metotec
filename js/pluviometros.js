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
function episodio(e){
  const ev = e.evidencia || {};
  const chips = [["vecinas", ev.vecinas], ["modelo", ev.modelo], ["satélite", ev.satelite], ["IMERG", ev.imerg]]
    .map(([n, v]) => `<span style="padding:1px 7px;border-radius:9px;margin-right:4px;font-size:11px;background:${v ? "#1f6feb55" : "transparent"};border:1px solid ${v ? "#1f6feb" : "var(--bd,#30363d)"};color:${v ? "inherit" : "var(--mu)"}">${n}</span>`).join("");
  const filas = (e.detalle || []).map(d => `<tr style="${d.sospechosa ? "background:#f8514916" : ""}"><td>${esc(d.hora)}</td>
    ${celda(d.est == null ? "<span style='color:var(--mu)'>sin dato</span>" : d.est.toFixed(1), d.sospechosa ? ";font-weight:600" : "")}
    ${celda(d.n_tot ? `${d.vec.toFixed(1)} <small style="color:var(--mu)">(${d.n_vec}/${d.n_tot})</small>` : "—")}
    ${celda(d.mod.toFixed(1))}
    <td style="text-align:center">${d.sat ? "✓" : "·"}</td>
    ${celda(d.tope == null ? "—" : d.tope.toFixed(0) + " °C")}
    ${celda(d.ray == null ? "—" : d.ray)}</tr>`).join("");
  return `<div style="margin:8px 0 12px 0"><b>${f5(e.inicio)} → ${f5(e.fin)}</b> UTC · ${e.horas} h sospechosas${e.sin_dato >= e.horas / 2 ? " (sin dato: comunicación)" : ""}${e.descarga_tardia ? " · <b>descarga tardía</b>" : ""} · vecinas ${e.mm_vecinas} mm, modelo ${e.mm_modelo} mm<br>
    <div style="margin:4px 0">${chips}</div>
    <table class="tb" style="font-size:12px"><tr><th>Hora UTC</th><th>Estación mm</th><th>Vecinas mm (llueven/con dato)</th><th>Modelo mm</th><th>Satélite: lluvia o nube fría</th><th>Tope más frío</th><th>Rayos</th></tr>${filas}</table></div>`;
}
function tarjeta(e){
  const partes = [];
  if (e.eventos_sin_marcar) partes.push(`<b>Lleva ${e.eventos_sin_marcar} evento${e.eventos_sin_marcar > 1 ? "s" : ""} de lluvia sin marcar</b>, desde ${f5(e.sin_marcar_desde)} UTC${e.ultima_vez_que_marco ? ` (última vez que marcó: ${f5(e.ultima_vez_que_marco)})` : " (sin registro de cuándo marcó por última vez en el periodo)"}`);
  (e.goteo || []).slice(-2).forEach(g => partes.push(`<b>Goteo</b>: ${g.horas} h seguidas con 0,1–0,2 mm sin lluvia alrededor (${g.mm} mm), ${f5(g.inicio)} → ${f5(g.fin)} UTC`));
  if ((e.lluvia_con_cielo_despejado || []).length) partes.push(`<b>Lluvia con cielo despejado</b>: ${e.lluvia_con_cielo_despejado.map(x => `${f5(x.hora)} (${x.mm} mm)`).join(", ")}`);
  if (e.razon_vecinas != null) partes.push(`En el periodo marca ${Math.round(e.razon_vecinas * 100)} % de lo que miden sus vecinas (${e.vecinas_comparadas} comparadas)`);
  return `<div style="border:1px solid var(--bd,#30363d);border-left:4px solid ${COL[e.estado]};border-radius:6px;padding:10px 14px;margin:10px 0">
    <div style="font-size:15px"><b>${esc(e.nombre)}</b> <small style="color:var(--mu)">${esc(e.codigo)}</small> · <span style="color:${COL[e.estado]}">${TXT[e.estado]}</span>
      · ${e.horas_sospechosas} h sospechosas${e.horas_sin_dato ? ` (${e.horas_sin_dato} sin dato)` : ""}</div>
    ${partes.map(t => `<div style="margin:4px 0">${t}</div>`).join("")}
    ${(e.episodios || []).slice(0, 3).map(episodio).join("")}</div>`;
}
function pintar(){
  const L0 = (D.estaciones || []).filter(e => e.estado !== "ok"), R = D.resumen || {};
  const chip = (f, t, n, c) => `<button data-f="${f}" class="${filtro === f ? "on" : ""}" style="${c ? `border-color:${c};` : ""}">${t}<b>${n ?? ""}</b></button>`;
  $("#pRes").innerHTML = chip("todas", "Todas las dudosas", L0.length) + chip("sospecha_obstruccion", "Sospecha de obstrucción", R.sospecha_obstruccion, COL.sospecha_obstruccion)
    + chip("revisar", "Revisar", R.revisar, COL.revisar) + chip("sin_dato_con_lluvia", "Sin dato con lluvia", R.sin_dato_con_lluvia, COL.sin_dato_con_lluvia);
  let L = L0.filter(e => !q || (e.nombre || "").toLowerCase().includes(q) || e.codigo.includes(q));
  if (filtro !== "todas") L = L.filter(e => e.estado === filtro);
  const f = D.fuentes || {};
  const fuentes = [["vecinas", "vecinas"], ["modelo", "modelo"], ["satelite", `satélite GOES${f.satelite_horas ? ` (${f.satelite_horas} h archivadas)` : ""}`], ["imerg", "IMERG (NASA)"]]
    .map(([k, n]) => `<span style="color:${f[k] ? "#3fb950" : "var(--mu)"}">${f[k] ? "●" : "○"} ${n}</span>`).join(" &nbsp; ");
  $("#pOut").innerHTML = `<p style="color:var(--mu);margin:6px 0">Periodo analizado: ${esc(D.desde || "—")} → ${esc(D.hasta || "—")} UTC (${D.dias ?? "—"} días, hasta donde hay datos minutarios). Actualizado ${esc(D.generado || "—")} UTC. Evidencias: ${fuentes}.<br>
    Una hora es sospechosa si la estación marcó menos de 0,2 mm (o no tuvo dato) y coinciden al menos 2 evidencias de lluvia, una de ellas las estaciones vecinas con dato. Si las vecinas están secas, no se sospecha. Es una sospecha para revisar en terreno, no una corrección.</p>
    ${L.map(tarjeta).join("") || `<p style="color:var(--mu)">Ningún pluviómetro dudoso con este filtro en el periodo analizado.</p>`}`;
}
window.PLU = {init};
})();
