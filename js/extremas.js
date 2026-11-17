/* Pestañas «Precipitación», «Temperaturas (Ts, Td, HR)» y «Extremas»: las alertas de observaciones de cada grupo
   (REGLAS.pestana), con lo ingresado, lo que debería ir, el gráfico y los botones Resuelto / Falsa alarma. */
(function(){
const $ = s => document.querySelector(s);
const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;"})[c]);
const NIVC = ["var(--ok)", "var(--sos)", "var(--err)"];
const TIT = {pp: "precipitación", tem: "temperatura y humedad", ext: "extremas", rec: "récords históricos"};
let getR = () => null, tipo = "pp", q = "";

function init(fR, t){
  getR = fR || getR; if (t) tipo = t;
  const s = $("#ext");
  if (!s.dataset.ok){
    s.dataset.ok = 1;
    s.innerHTML = `<div class="htools"><input id="xBus" placeholder="Buscar estación…"><span class="tag" id="xHora"></span></div><div id="xOut"></div>`;
    $("#xBus").addEventListener("input", ev => { q = ev.target.value.trim().toLowerCase(); pintar(); });
  }
  $("#xBus").value = q;
  pintar();
}

const recAnt = m => { const x = (m || "").match(/Récord anterior: ([^()]+?) el (\d\d-\d\d-\d{4})/); return x ? `${x[1]} · ${x[2]}` : "—"; };
const deb = m => { const x = (m || "").match(/Debería ir: ([^.]+(?:\.\d[^.]*)?)\.?$/); return x ? x[1] : ""; };
const ing = f => { const m = (f.msg || "").match(/^(T(?:min|max) (?:AM|PM)) (-?[\d.]+) °C(?: a las (\d\d:\d\d))?/) || (f.msg || "").match(/^(?:(T(?:min|max) (?:AM|PM)) con hora (\d\d:\d\d))/);
  if (m && m[2] && /^-?[\d.]+$/.test(m[2])) return `${m[1]} ${m[2]} °C${m[3] ? " · " + m[3] : ""}`;
  if (m) return `${m[1]} · ${m[2]}`;
  const tsx = (f.msg || "").match(/^Ts (-?[\d.]+) °C a las (\d\d:\d\d) UTC/); if (tsx) return `Ts ${tsx[1]} °C · ${tsx[2]} UTC`;
  const r = (f.msg || "").match(/RRR6 (?:anotado )?(-?[\d.]+)/); if (r) return `RRR6 ${r[1]} mm`;
  const s = (f.msg || "").match(/(Ts|Td|HR) anotad[oa] (-?[\d.]+)/); return s ? `${s[1]} ${s[2]}` : ""; };

function pintar(){
  const R = getR(), O = (R && R.observaciones) || {};
  if (!$("#ext") || !$("#ext").dataset.ok) return;
  const filas = [];
  (O.estaciones || []).filter(e => !window.EQ || EQ.filtra(e.codigo)).forEach(e => (e.hallazgos || []).forEach(h => { if (REGLAS.pestana(h.regla) === tipo){ const st = MARCA.estado(e.codigo, h); if (st !== "oculta") filas.push({...h, e, st}); } }));
  const cnt = {}; filas.forEach(f => cnt[f.regla] = (cnt[f.regla] || 0) + 1);
  const est = new Set(filas.map(f => f.e.codigo));
  const g = O.generado ? new Date(O.generado) : null;
  $("#xHora").textContent = g ? `Observaciones revisadas a las ${g.toLocaleTimeString("es-CL", {hour: "2-digit", minute: "2-digit"})} (${tipo === "tem" ? "últimas 24 h" : "últimos 4 días"})` : "Sin revisión de observaciones";
  const V = filas.filter(f => !q || (f.e.nombre || "").toLowerCase().includes(q) || f.e.codigo.includes(q))
    .sort((a, b) => b.hora.localeCompare(a.hora) || b.nivel - a.nivel || (a.e.nombre || "").localeCompare(b.e.nombre || ""));
  if (tipo !== "rec"){                          // una sola celda de estación; sus alertas, una debajo de otra
    const G = new Map(); V.forEach(f => { if (!G.has(f.e.codigo)) G.set(f.e.codigo, []); G.get(f.e.codigo).push(f); });
    const orden = [...G.values()].sort((a, b) => Math.max(...b.map(x => x.nivel)) - Math.max(...a.map(x => x.nivel)) || b[0].hora.localeCompare(a[0].hora) || (a[0].e.nombre || "").localeCompare(b[0].e.nombre || ""));
    V.length = 0; orden.forEach(g => g.forEach((f, i) => { f._ini = i === 0; f._n = g.length; V.push(f); }));
  }
  const cel = f => `<td class="nom"${f._n > 1 ? ` rowspan="${f._n}"` : ""}><b>${esc(f.e.nombre)}</b><br><small>${f.e.codigo}</small><br><a class="vlink" style="display:inline-block;margin-top:4px" href="https://climatologia.meteochile.gob.cl/application/diariob/visorDeDatosEma/${encodeURIComponent(f.e.codigo)}" target="_blank" rel="noopener" title="Abrir la estación en línea en el portal de climatología">↗ en línea</a></td>`;
  const kpi = (n, t, c) => `<div><b style="color:${c}">${n}</b><span>${esc(t)}</span></div>`;
  const porRegla = Object.entries(cnt).sort((a, b) => b[1] - a[1]).map(([k, n]) => kpi(n, REGLAS.nombre(k), "var(--tx)")).join("");
  $("#xOut").innerHTML = `<div class="hres">${kpi(est.size, "estaciones con alertas", "var(--oro)")}${porRegla}</div>
    ${V.length ? `<div class="bcard" style="padding:0"><table class="xtab"><tr><th>Estación</th><th>Obs. UTC</th><th>Alerta</th><th>Ingresado</th><th>${tipo === "rec" ? "Récord anterior" : "Debería ir"}</th><th>Detalle</th><th></th></tr>
      ${V.map(f => `<tr${f._ini ? ' class="gini"' : ""}>${f._ini || tipo === "rec" ? cel(f) : ""}<td style="white-space:nowrap">${f.hora.slice(8, 10)}/${f.hora.slice(5, 7)} ${f.hora.slice(11, 16)}</td>
        <td style="color:${NIVC[f.nivel] || "inherit"};font-weight:600">${REGLAS.html(f.regla, esc)}</td><td class="n">${esc(f.ingresado || ing(f) || (f.regla === "SEXF" ? "No ingresada" : "—"))}</td><td class="n" style="color:var(--oro)">${esc(tipo === "rec" ? recAnt(f.msg) : (f.deberia || deb(f.msg)))}</td>
        <td>${esc(f.msg)}${f.st === "sigue" ? MARCA.aviso : ""}</td><td style="white-space:nowrap">${MARCA.botones(f.e.codigo, f)}<br>${SGRAF.tiene(f.regla) ? `<button class="sgbtn" data-sg="${esc(f.hora)}|${esc(f.regla)}|${esc(f.e.codigo)}" data-msg="${esc(f.msg)}">${SGRAF.etiqueta(f.regla)}</button>` : ""}</td></tr>`).join("")}</table></div>`
      : `<p style="color:var(--ok)">Sin alertas de ${TIT[tipo]}${q ? " con ese filtro" : ""}.</p>`}
    <p class="nota" style="color:var(--mu);font-size:12px;margin-top:10px">${tipo === "ext" ? "Extremas: Tmin AM y Tmax AM (00–12 UTC) y Tmin PM y Tmax PM (12–00 UTC), comparadas con la extrema oficial de la estación automática, en valor y hora (la hora del observador es local)."
      : tipo === "pp" ? "Precipitación: el RRR6 debe calzar exacto con la suma del pluviómetro en las 6 h que cierran a las 00, 06, 12 y 18 UTC."
      : tipo === "rec" ? "Récord histórico: Tmin y Tmax AM/PM ingresadas por el observador frente a la máxima y mínima diarias de la estación desde 1990. Rojo/naranja: supera el récord de toda la historia (confirmar que el dato es correcto). Gris: supera el récord del mes."
      : "Ts, Td y HR del observador frente al sensor de la estación automática, y las diferencias constantes."} «Resuelto» quita la alerta y la manda al Historial; no vuelve mientras el dato sea el mismo.</p>
    ${tipo === "rec" ? `<h4 style="margin:18px 0 6px;font:600 14px var(--titulo)">Récords de temperatura por estación</h4><div id="xRec"><p style="color:var(--mu)">Cargando…</p></div>` : ""}`;
  if (tipo === "rec") pintarRecords();
}
let RECS = null;
async function pintarRecords(){
  const el = $("#xRec"); if (!el) return;
  try {
    if (!RECS){ const r = await fetch("/api/productos?tipo=records"); if (!r.ok) throw new Error(r.status); RECS = await r.json(); }
    const F = (x, u, d = 1) => x ? `<b>${x[0].toFixed(d)}</b> ${u}<br><small>${x[1].split("-").reverse().join("-")}</small>` : "—";
    const O = ((getR() || {}).observaciones || {}).estaciones || [];
    const nom = {}; O.forEach(e => nom[e.codigo] = e.nombre);
    const T = RECS.t || {}, P = RECS.p || {}, V = RECS.v || {};
    const cods = [...new Set([...Object.keys(T), ...Object.keys(P), ...Object.keys(V)])];
    const filas = cods.map(c => ({c, n: (T[c] || {}).nombre || nom[c] || "Estación " + c})).filter(x => !q || x.n.toLowerCase().includes(q) || x.c.includes(q)).sort((a, b) => a.n.localeCompare(b.n));
    const ser = (e, k) => e ? `${esc((e.desde || "").slice(0, 4))}–${esc((e.hasta || "").slice(0, 4))}` : "";
    el.innerHTML = `<table class="xtab"><tr><th>Estación</th><th>Máxima más alta</th><th>Mínima más baja</th><th>Lluvia máx. diaria</th><th>Lluvia máx. mensual</th><th>Viento medio máx.</th></tr>${filas.map(({c, n}) => {
      const t = T[c] || {}, p = P[c], v = V[c];
      return `<tr><td class="nom"><b>${esc(n)}</b><br><small>${c}</small></td><td class="n">${F((t.tx || {}).max, "°C")}</td><td class="n">${F((t.tn || {}).min, "°C")}</td><td class="n">${p ? F(p.dia, "mm") : "—"}</td><td class="n">${p ? `<b>${p.mensual[0].toFixed(1)}</b> mm<br><small>${p.mensual[1].split("-").reverse().join("-")}</small>` : "—"}</td><td class="n">${v ? F(v.max, "kt", 0) : "—"}</td></tr>`;
    }).join("")}</table><p style="color:var(--mu);font-size:12px;margin-top:6px">Temperatura: serie de 1990 en adelante. Lluvia: 1995 en adelante (2026 solo en las estaciones con archivo SACLIM). Viento: solo seis estaciones con archivo horario SACLIM (viento medio, no racha).</p>`;
  } catch (err){ el.innerHTML = `<p style="color:var(--mu)">Aún no hay récords publicados (se generan en la próxima pasada del control).</p>`; }
}
window.EXT = {init, pintar};
})();
