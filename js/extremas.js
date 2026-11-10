/* Extremas y precipitación: solo las alertas de TnAM/TxAM/TnPM/TxPM (valor y hora) y de precipitación (RRR6 frente al
   pluviómetro, precipitación sin RRR6 o RRR6 sin precipitación), con lo ingresado, lo que debería ir y el gráfico. */
(function(){
const $ = s => document.querySelector(s);
const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;"})[c]);
const TIPOS = {SEXT: ["Extrema: valor", "ext"], SEXH: ["Extrema: hora", "ext"], SEXF: ["Extrema fuera de bloque sin ingresar", "ext"], SRRR6: ["RRR6 frente al pluviómetro", "pp"],
  E12: ["Precipitación con RRR6 0", "pp"], E13: ["RRR6 sin precipitación", "pp"], E17: ["Precipitación sin traza", "pp"], SPRE: ["Lluvia del pluviómetro y tiempo presente", "pp"]};
const NIVC = ["var(--ok)", "var(--sos)", "var(--err)"];
let getR = () => null, filtro = "", q = "";

function init(fR){
  getR = fR || getR;
  const s = $("#ext");
  if (!s.dataset.ok){
    s.dataset.ok = 1;
    s.innerHTML = `<div class="htools"><input id="xBus" placeholder="Buscar estación…"><span id="xFil"></span><button id="xTodas" title="Vuelve a revisar desde SACLIM todas las estaciones con alertas en esta lista">🔄 Revisar todas</button><span class="tag" id="xHora"></span></div><div id="xOut"></div>`;
    $("#xBus").addEventListener("input", ev => { q = ev.target.value.trim().toLowerCase(); pintar(); });
    $("#xTodas").addEventListener("click", revisarTodas);
    s.addEventListener("click", ev => { const f = ev.target.closest("[data-xf]"); if (f){ filtro = filtro === f.dataset.xf ? "" : f.dataset.xf; pintar(); } });
  }
  pintar();
}

function pintar(){
  const R = getR(), O = (R && R.observaciones) || {};
  if (!$("#ext") || $("#ext").hidden && !$("#ext").dataset.ok) return;
  const filas = [];
  (O.estaciones || []).forEach(e => (e.hallazgos || []).forEach(h => { if (TIPOS[h.regla]) filas.push({...h, e}); }));
  const cnt = {}; filas.forEach(f => cnt[f.regla] = (cnt[f.regla] || 0) + 1);
  const est = new Set(filas.map(f => f.e.codigo));
  const g = O.generado ? new Date(O.generado) : null;
  $("#xHora").textContent = g ? `Observaciones revisadas a las ${g.toLocaleTimeString("es-CL", {hour: "2-digit", minute: "2-digit"})} (últimos 4 días)` : "Sin revisión de observaciones";
  $("#xFil").innerHTML = [["", "Todas"], ["ext", "Extremas"], ["pp", "Precipitación"]].map(([k, n]) =>
    `<button data-xf="${k}" class="${filtro === k ? "on" : ""}">${n}</button>`).join(" ");
  const V = filas.filter(f => (!filtro || TIPOS[f.regla][1] === filtro) && (!q || (f.e.nombre || "").toLowerCase().includes(q) || f.e.codigo.includes(q)))
    .sort((a, b) => b.hora.localeCompare(a.hora) || b.nivel - a.nivel || (a.e.nombre || "").localeCompare(b.e.nombre || ""));
  const kpi = (n, t, c) => `<div><b style="color:${c}">${n}</b><span>${t}</span></div>`;
  const deb = m => { const x = (m || "").match(/Debería ir: ([^.]+(?:\.\d[^.]*)?)\.?$/); return x ? x[1] : ""; };
  const ing = (f) => { const m = (f.msg || "").match(/^((?:Tn|Tx)(?:AM|PM)) (-?[\d.]+) °C(?: a las (\d\d:\d\d))?/) || (f.msg || "").match(/^(?:(TnAM|TxAM|TnPM|TxPM) con hora (\d\d:\d\d))/);
    if (m && m[2] && /^-?[\d.]+$/.test(m[2])) return `${m[1]} ${m[2]} °C${m[3] ? " · " + m[3] : ""}`;
    if (m) return `${m[1]} · ${m[2]}`;
    const r = (f.msg || "").match(/RRR6 (?:anotado )?(-?[\d.]+)/); return r ? `RRR6 ${r[1]} mm` : ""; };
  $("#xOut").innerHTML = `<div class="hres">${kpi(est.size, "estaciones con alertas", "var(--tx)")}${kpi(cnt.SEXT || 0, "extremas con valor mal", "var(--err)")}
      ${kpi(cnt.SEXH || 0, "extremas con hora mal", "var(--sos)")}${kpi(cnt.SRRR6 || 0, "RRR6 que no cuadra con el pluviómetro", "var(--err)")}
      ${kpi((cnt.E12 || 0) + (cnt.E13 || 0) + (cnt.E17 || 0), "precipitación sin respaldo", "var(--sos)")}</div>
    ${V.length ? `<div class="bcard" style="padding:0"><table class="xtab"><tr><th>Estación</th><th>Obs. UTC</th><th>Alerta</th><th>Ingresado</th><th>Debería ir</th><th>Detalle</th><th></th></tr>
      ${V.map(f => `<tr><td class="nom"><b>${esc(f.e.nombre)}</b><br><small>${f.e.codigo}</small><br><a class="vlink" style="display:inline-block;margin-top:4px" href="https://climatologia.meteochile.gob.cl/application/diariob/visorDeDatosEma/${encodeURIComponent(f.e.codigo)}" target="_blank" rel="noopener" title="Abrir la estación en línea en el portal de climatología">↗ en línea</a></td><td style="white-space:nowrap">${f.hora.slice(8, 10)}/${f.hora.slice(5, 7)} ${f.hora.slice(11, 16)}</td>
        <td style="color:${NIVC[f.nivel] || "inherit"};font-weight:600">${TIPOS[f.regla][0]}</td><td class="n">${esc(ing(f))}</td><td class="n" style="color:var(--oro)">${esc(deb(f.msg))}</td>
        <td>${esc(f.msg)}</td><td style="white-space:nowrap"><button class="rvbtn" data-rv="${esc(f.e.codigo)}" style="margin:0 0 4px">🔄 Revisar ahora</button><br>${SGRAF.tiene(f.regla) ? `<button class="sgbtn" data-sg="${esc(f.hora)}|${esc(f.regla)}|${esc(f.e.codigo)}" data-msg="${esc(f.msg)}">📈 ver gráfico</button>` : ""}</td></tr>`).join("")}</table></div>`
      : `<p style="color:var(--ok)">Sin alertas de extremas ni de precipitación en los últimos 4 días${filtro || q ? " con ese filtro" : ""}.</p>`}
    <p class="nota" style="color:var(--mu);font-size:12px;margin-top:10px">Extremas: TnAM y TxAM (período 00–12 UTC, 21:00–09:00 hora local en verano) y TnPM y TxPM (12–00 UTC), comparadas con la extrema de la estación automática y su minutario, en valor y hora (la hora del observador es local). Precipitación: el RRR6 debe calzar exacto con la suma del pluviómetro en las 6 h que cierran a las 00, 06, 12 y 18 UTC.</p>`;
}
// pide revisar todas las estaciones de la lista (las que tienen alertas visibles) y espera a que terminen
async function revisarTodas(){
  const b = $("#xTodas"), cods = [...new Set([...document.querySelectorAll("#xOut .rvbtn")].map(x => x.dataset.rv))];
  if (!cods.length || b.disabled) return;
  b.disabled = true; b.textContent = `⏳ Pidiendo ${cods.length} estaciones…`;
  const clave = () => { try { return sessionStorage.getItem("qcClave") || ""; } catch (e) { return window._qc || ""; } }, t0 = new Date().toISOString();
  for (const cod of cods) await fetch("/api/revisar", {method: "POST", headers: {"x-clave": clave(), "content-type": "application/json"}, body: JSON.stringify({cod})}).catch(() => {});
  const ini = Date.now();
  const ver = async () => {
    let listos = 0;
    for (const cod of cods){ try { const r = await (await fetch("/api/revisar?cod=" + cod, {headers: {"x-clave": clave()}, cache: "no-store"})).json(); if (r.revisado && r.revisado.hora > t0) listos++; } catch (e){} }
    if (listos === cods.length){ b.textContent = `✓ ${cods.length} estaciones revisadas`; b.disabled = false; if (window.cargar) await window.cargar(); return; }
    b.textContent = `⏳ Revisando… ${listos} de ${cods.length}`;
    if (Date.now() - ini < 15 * 60e3) setTimeout(ver, 20e3); else { b.textContent = "🔄 Revisar todas (no respondió; intente de nuevo)"; b.disabled = false; }
  };
  setTimeout(ver, 15e3);
}
window.EXT = {init, pintar};
})();
