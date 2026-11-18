/* Vecinas externas (INIA, CEAZA, SERVIMET…): solo para comparar en los controles. No se dibujan como estaciones, no entran a listas ni contadores.
   · EXTV.datos()      catálogo y lluvia horaria de las externas activas (con clave; /api/externas), con caché de 5 min
   · EXTV.vecinas(lat, lon, km, tope)  las más cercanas (id, km) para un punto
   · EXTV.pagina(el)   pestaña «Vecinas externas» de Gestión (⚙): activar o desactivar cada estación, con filtro por institución y buscador
   La lista de desactivadas vive en el KV (qc/externas/off) y la respetan igual los controles de Python (qc/externas_vec.py). */
(function(){
const PESO = 0.5, TOPE = 3;                              // igual que EXT_PESO y EXT_TOPE de qc/pluviometros.py
const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;"}[c]));
const clave = () => { try { return sessionStorage.getItem("qcClave") || ""; } catch (e) { return ""; } };
const km = (a, b) => { const r = Math.PI / 180, dl = (b.lat - a.lat) * r, dn = (b.lon - a.lon) * r, x = Math.sin(dl / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dn / 2) ** 2; return 12742 * Math.asin(Math.sqrt(x)); };
async function api(v, ms = 25000){
  const c = new AbortController(), t = setTimeout(() => c.abort(), ms);
  try { const r = await fetch("/api/externas?v=" + v, {headers: {"x-clave": clave()}, cache: "no-store", signal: c.signal}); return r.ok ? await r.json() : null; }
  catch (e) { return null; } finally { clearTimeout(t); }
}
let CACHE = null;
async function datos(forzar){
  if (!forzar && CACHE && Date.now() - CACHE.t < 5 * 60e3) return CACHE.d;
  if (!clave()) return null;
  const [cat, pp, off] = await Promise.all([api("cat"), api("PP"), api("off")]);
  if (!cat || !cat.estaciones) return null;
  const apagadas = new Set((off && off.off) || []);
  const C = new Map(cat.estaciones.filter(e => !apagadas.has(e.id) && isFinite(e.lat) && isFinite(e.lon)).map(e => [e.id, e]));
  const P = new Map();                                    // id → Map(ms de la hora en que termina → mm)
  if (pp && pp.datos) for (const [id, s] of Object.entries(pp.datos)){
    if (!C.has(id)) continue;
    const m = new Map(); for (const [h, v] of Object.entries(s)){ const t = Date.parse(h + ":00:00Z"); if (isFinite(t) && v != null) m.set(t, v); }
    P.set(id, m);
  }
  const d = {cat: C, pp: P, off: apagadas};
  CACHE = {t: Date.now(), d};
  return d;
}
function vecinas(d, lat, lon, radio, tope = TOPE){
  if (!d) return [];
  const p = {lat, lon};
  return [...d.cat.values()].map(e => [e.id, km(p, e)]).filter(x => x[1] <= radio).sort((a, b) => a[1] - b[1]).slice(0, tope);
}
window.EXTV = {PESO, TOPE, datos, vecinas, refrescar: () => { CACHE = null; }};

/* ---------------- Gestión: activar / desactivar cada estación externa ---------------- */
let ST = {cat: [], off: new Set(), des: {}, inst: "", q: "", solo: "", cargando: false, error: ""};
async function cargarPag(el){
  ST.cargando = true; ST.error = ""; pintar(el);
  const [cat, off, des] = await Promise.all([api("cat"), api("off"), api("desvio")]);
  ST.cargando = false;
  if (!cat || !cat.estaciones){ ST.error = "No pude leer el catálogo de externas (¿clave o primera corrida de qc/externas.py?)."; return pintar(el); }
  ST.cat = cat.estaciones.slice().sort((a, b) => a.inst.localeCompare(b.inst) || String(a.nombre).localeCompare(String(b.nombre)));
  ST.off = new Set((off && off.off) || []); ST.des = (des && des.desvios) || {}; ST.gen = cat.generado;
  pintar(el);
}
async function poner(ids, activa, el){
  try {
    const r = await fetch("/api/externas", {method: "POST", headers: {"x-clave": clave(), "content-type": "application/json"}, body: JSON.stringify({ids, activa})});
    if (!r.ok) throw new Error(await r.text());
    ST.off = new Set((await r.json()).off || []); CACHE = null;
  } catch (e) { ST.error = "No se pudo guardar: " + e.message; }
  pintar(el);
}
const visibles = () => { const q = ST.q.trim().toLowerCase(); return ST.cat.filter(e => (!ST.inst || e.inst === ST.inst) && (!q || (e.nombre + " " + e.id).toLowerCase().includes(q))
  && (!ST.solo || (ST.solo === "off" ? ST.off.has(e.id) : ST.solo === "on" ? !ST.off.has(e.id) : !!ST.des[e.id]))); };
function pintar(el){
  if (!el) return;
  const insts = [...new Set(ST.cat.map(e => e.inst))], V = visibles(), act = ST.cat.length - ST.cat.filter(e => ST.off.has(e.id)).length;
  const des = e => { const d = ST.des[e.id]; return d ? `<span title="Se aparta de la mediana de sus estaciones DMC vecinas de forma sostenida en las últimas 24 h" style="color:#d29922">⚠ se desvía${d.T != null ? ` ${d.T > 0 ? "+" : ""}${d.T} °C` : ""}${d.HR != null ? ` ${d.HR > 0 ? "+" : ""}${d.HR} % HR` : ""}</span>` : ""; };
  el.innerHTML = `<div class="ppx" style="max-width:none"><h3>Vecinas externas <small style="color:var(--mu);font-weight:400">· solo comparación en los controles</small></h3>
    <p class="nota" style="margin:0 0 8px">Estaciones de otras instituciones (INIA, CEAZA, SERVIMET…) que sirven de vecinas con menor peso. No se muestran como estaciones en mapas, listas ni contadores; a lo más una línea en el detalle de una alerta que se apoye en ellas. Desactive las que den datos dudosos: el control las deja de usar en la siguiente pasada.</p>
    <div class="htools"><select id="vxI"><option value="">Todas las instituciones</option>${insts.map(i => `<option${i === ST.inst ? " selected" : ""} value="${esc(i)}">${esc(i)} (${ST.cat.filter(e => e.inst === i && !ST.off.has(e.id)).length}/${ST.cat.filter(e => e.inst === i).length})</option>`).join("")}</select>
      <select id="vxS"><option value="">Todas</option><option value="on"${ST.solo === "on" ? " selected" : ""}>Solo activas</option><option value="off"${ST.solo === "off" ? " selected" : ""}>Solo desactivadas</option><option value="des"${ST.solo === "des" ? " selected" : ""}>Solo las que se desvían</option></select>
      <input id="vxQ" placeholder="Buscar estación…" value="${esc(ST.q)}">
      <button id="vxOn" title="Activa las estaciones que se ven con el filtro actual">Activar visibles</button><button id="vxOff" title="Desactiva las estaciones que se ven con el filtro actual">Desactivar visibles</button><button id="vxAct">Actualizar</button></div>
    ${ST.error ? `<p style="color:#e5534b">${esc(ST.error)}</p>` : ""}
    <p style="margin:6px 0;color:var(--mu);font-size:12.5px">${ST.cargando ? "Cargando…" : `<b style="color:var(--tx)">${act}</b> de ${ST.cat.length} estaciones externas activas · ${V.length} a la vista${ST.gen ? " · catálogo de " + esc(String(ST.gen).replace("T", " ").slice(0, 16)) + " UTC" : ""}`}</p>
    <div style="overflow-x:auto;max-height:70vh"><table class="tb"><tr><th>Activa</th><th>Estación</th><th>Institución</th><th>Altura (m)</th><th>Señal</th></tr>${V.slice(0, 600).map(e => `<tr${ST.off.has(e.id) ? ' style="opacity:.55"' : ""}><td><input type="checkbox" data-id="${esc(e.id)}"${ST.off.has(e.id) ? "" : " checked"}></td><td>${esc(e.nombre)} <small style="color:var(--mu)">${esc(e.id)}</small></td><td>${esc(e.inst)}</td><td style="text-align:right">${e.alt == null ? "—" : Math.round(e.alt)}</td><td>${des(e)}</td></tr>`).join("")}</table>${V.length > 600 ? `<p class="nota">Se muestran 600; afine el filtro.</p>` : ""}</div></div>`;
  el.onchange = ev => { const t = ev.target;
    if (t.id === "vxI"){ ST.inst = t.value; pintar(el); } else if (t.id === "vxS"){ ST.solo = t.value; pintar(el); } else if (t.dataset && t.dataset.id) poner([t.dataset.id], t.checked, el); };
  el.oninput = ev => { if (ev.target.id === "vxQ"){ ST.q = ev.target.value; const pos = ev.target.selectionStart; pintar(el); const i = el.querySelector("#vxQ"); i.focus(); i.setSelectionRange(pos, pos); } };
  el.onclick = ev => { const b = ev.target.closest("button"); if (!b) return;
    if (b.id === "vxAct") cargarPag(el);
    else if (b.id === "vxOn" || b.id === "vxOff"){ const ids = visibles().map(e => e.id); if (ids.length && (ids.length < 20 || confirm(`${b.id === "vxOn" ? "Activar" : "Desactivar"} ${ids.length} estaciones?`))) poner(ids, b.id === "vxOn", el); } };
}
window.EXTV.pagina = el => { if (!ST.cat.length && !ST.cargando) cargarPag(el); else pintar(el); };
})();
