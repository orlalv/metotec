/* Estado de estaciones: semáforo según el tiempo con problema (sin dato + falla de sensor) en 7 y 30 días, y estado
   (cuarentena / en revisión / operativa). Incluye el diagnóstico de pluviómetros: horas en que probablemente llovió y la
   estación marcó 0 o no tuvo dato. Lo calculan qc/reputacion.py y qc/pluviometros.py en cada corrida; aquí solo se muestra. */
(function(){
const $ = s => document.querySelector(s);
const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;"})[c]);
const COL = {verde: "#3fb950", amarillo: "#d29922", rojo: "#f85149"};
const EST = {cuarentena: "En cuarentena", en_revision: "En revisión", operativa: "Operativa"};
const PLU = {sospecha_obstruccion: "⚠ Sospecha de obstrucción", revisar: "Revisar", sin_dato_con_lluvia: "Sin dato con lluvia", ok: ""};
let clave = () => "", D = null, filtro = "todas", q = "";

function init(fclave){
  clave = fclave || clave;
  const s = $("#est"); if (!s.dataset.ok){
    s.dataset.ok = 1;
    s.innerHTML = `<div class="htools"><span id="eRes"></span><input id="eQ" placeholder="Buscar estación o código" style="min-width:200px"><button id="eRec">↻ Actualizar</button></div>
      <div id="eOut"><p style="color:var(--mu)">Cargando…</p></div>`;
    $("#eQ").addEventListener("input", ev => { q = ev.target.value.trim().toLowerCase(); pintar(); });
    $("#eRec").addEventListener("click", cargar);
    s.addEventListener("click", ev => { const b = ev.target.closest("button[data-f]"); if (b){ filtro = b.dataset.f; pintar(); } });
  }
  cargar();
}
async function cargar(){
  try {
    const r = await fetch("/api/reputacion", {headers: {"x-clave": clave()}, cache: "no-store"});
    if (!r.ok) throw new Error(await r.text());
    D = await r.json();
  } catch (e){ $("#eOut").innerHTML = `<p style="color:var(--rojo,#f85149)">No se pudo cargar: ${esc(e.message)}</p>`; return; }
  pintar();
}
function detallePluv(p){
  if (!p || !p.estado || p.estado === "ok") return "";
  const m = t => `<br><small style="color:var(--mu)">${t}</small>`, f = t => esc(String(t).slice(5));
  let h = "";
  if (p.eventos_sin_marcar) h += m(`lleva ${p.eventos_sin_marcar} evento${p.eventos_sin_marcar > 1 ? "s" : ""} de lluvia sin marcar, desde ${f(p.sin_marcar_desde)}${p.ultima_vez_que_marco ? `; última vez que marcó: ${f(p.ultima_vez_que_marco)}` : ""}`);
  const g = (p.goteo || []).slice(-1)[0]; if (g) h += m(`goteo: ${g.horas} h con 0,1–0,2 mm sin lluvia alrededor (${g.mm} mm, ${f(g.inicio)} → ${f(g.fin)})`);
  const ep = (p.episodios || [])[0]; if (ep) h += m(`${f(ep.inicio)} → ${f(ep.fin)}: ${ep.horas} h probables de lluvia, ${ep.mm_vecinas} mm en vecinas${ep.descarga_tardia ? "; descarga tardía" : ""}${ep.sin_dato >= ep.horas / 2 ? " (sin dato: comunicación)" : ""}`);
  if ((p.lluvia_con_cielo_despejado || []).length) h += m(`lluvia con cielo despejado: ${p.lluvia_con_cielo_despejado.length} h (última ${f(p.lluvia_con_cielo_despejado.slice(-1)[0].hora)})`);
  if (p.razon_vecinas != null) h += m(`marca ${Math.round(p.razon_vecinas * 100)} % de lo de sus vecinas`);
  return h;
}
function pintar(){
  const rep = D.reputacion, plu = D.pluviometros, R = rep.resumen || {};
  const P = Object.fromEntries((plu.estaciones || []).map(e => [e.codigo, e]));
  const chip = (f, t, n, c) => `<button data-f="${f}" class="${filtro === f ? "on" : ""}" style="${c ? `border-color:${c};` : ""}">${t}<b>${n ?? ""}</b></button>`;
  $("#eRes").innerHTML = chip("todas", "Todas", (rep.estaciones || []).length) + chip("en_revision", "En revisión", R.en_revision, COL.rojo) + chip("cuarentena", "En cuarentena", R.cuarentena, COL.amarillo)
    + chip("aprobar", "Listas para aprobar", R.listas_para_aprobar, COL.verde) + chip("pluv", "Pluviómetro dudoso", (plu.resumen || {}).sospecha_obstruccion + (plu.resumen || {}).revisar || 0) + chip("operativa", "Operativas", R.operativa);
  let L = (rep.estaciones || []).filter(e => (!q || (e.nombre || "").toLowerCase().includes(q) || e.codigo.includes(q)));
  if (filtro === "aprobar") L = L.filter(e => e.lista_aprobar);
  else if (filtro === "pluv") L = L.filter(e => ["sospecha_obstruccion", "revisar"].includes((P[e.codigo] || {}).estado));
  else if (filtro !== "todas") L = L.filter(e => e.estado === filtro);
  const f = plu.fuentes || {};
  const fuentes = ["vecinas", "modelo", "satelite", "imerg"].map(k => `<span style="color:${f[k] ? "var(--ok,#3fb950)" : "var(--mu)"}">${f[k] ? "●" : "○"} ${{vecinas: "vecinas", modelo: "modelo", satelite: "satélite GOES", imerg: "IMERG"}[k]}</span>`).join(" &nbsp; ");
  $("#eOut").innerHTML = `<p style="color:var(--mu);margin:6px 0">Semáforo sobre ${rep.dias_7d ?? 7} días (verde &lt; ${rep.criterios?.verde ?? 5} %, rojo ≥ ${rep.criterios?.amarillo ?? 20} % del tiempo con problema). Actualizado ${esc(rep.generado || "—")} UTC.
    <br>Pluviómetros (${plu.dias ?? "—"} días, actualizado ${esc(plu.generado || "—")} UTC): evidencias usadas: ${fuentes}</p>
    <table class="tb"><tr><th></th><th>Estación</th><th>Estado</th><th>% con problema (7 d)</th><th>Sin dato</th><th>Falla de sensor (7 d / 30 d)</th><th>Pluviómetro</th><th>Qué hacer</th><th>Detalle</th></tr>
    ${L.map(e => { const p = P[e.codigo] || {};
      return `<tr><td><span title="${esc(e.semaforo)}" style="display:inline-block;width:12px;height:12px;border-radius:50%;background:${COL[e.semaforo]}"></span></td>
      <td><b>${esc(e.nombre)}</b><br><small style="color:var(--mu)">${esc(e.codigo)}</small></td>
      <td>${EST[e.estado]}${e.manual ? " <small>(a mano)</small>" : ""}${e.lista_aprobar ? " ✓" : ""}</td>
      <td>${e.problema_7d} %</td><td>${e.sin_dato_7d} %</td><td>${e.falla_7d} % / ${e.falla_30d} %${e.sensor_top ? `<br><small style="color:var(--mu)">${esc(e.sensor_top)}</small>` : ""}</td>
      <td>${esc(PLU[p.estado] || "")}${detallePluv(p)}</td>
      <td>${esc(e.sugerido)}</td><td><small>${esc(e.nota)}</small></td></tr>`; }).join("") || `<tr><td colspan="9" style="color:var(--mu)">Sin estaciones con ese filtro.</td></tr>`}</table>`;
}
window.EST = {init};
})();
