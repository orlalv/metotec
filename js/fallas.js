/* Fallas de sensor de las estaciones automáticas: episodios (inicio, última vez, duración), texto para «Informar»
   y gráfico «Ver gráfico» del minutario con el tramo malo en rojo, botones + / − y una estación de referencia opcional. */
(function(){
const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;"})[c]);
const FALLA = new Set(["rango", "salto", "pegado", "coherencia"]);
const SENSOR = {T: "Temperatura (termohigrómetro)", Td: "Punto de rocío (termohigrómetro)", HR: "Humedad relativa (termohigrómetro)", P_est: "Presión (barómetro)",
  P_mar: "Presión (barómetro)", P_std: "Presión (barómetro)", ff10: "Viento (anemómetro)", ff2: "Viento (anemómetro)", fx10: "Viento (anemómetro)", dd10: "Dirección del viento (veleta)",
  dd2: "Dirección del viento (veleta)", rr1m: "Precipitación (pluviómetro)", rr1h: "Precipitación (pluviómetro)", Rad: "Radiación (piranómetro)"};
const UNI = {T: "°C", Td: "°C", HR: "%", P_est: "hPa", P_mar: "hPa", P_std: "hPa", ff10: "kt", ff2: "kt", fx10: "kt", dd10: "°", dd2: "°", rr1m: "mm", Rad: "W/m²"};
const QUE = {rango: "valores fuera de rango", salto: "saltos bruscos", pegado: "valor pegado (sin variación)", coherencia: "datos incoherentes entre variables"};
const ms = s => Date.parse(String(s).slice(0, 16).replace(" ", "T") + ":00Z");
const utc = t => new Date(t).toISOString().slice(0, 16).replace("T", " ");
const loc = t => new Date(t).toLocaleString("es-CL", {timeZone: "America/Santiago", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false});
const dur = m => m < 60 ? Math.round(m) + " min" : m < 48 * 60 ? (m / 60).toFixed(1).replace(".0", "") + " h" : (m / 1440).toFixed(1).replace(".0", "") + " días";

const NOMV = {T: "Ts", Td: "Td", HR: "HR", P_est: "QFE", P_mar: "QFF", P_std: "QNH", ff10: "viento", dd10: "dirección", rr1m: "lluvia", Rad: "radiación"};
const cap = t => t ? t[0].toUpperCase() + t.slice(1) : t;
// nombre del sensor con sus variables, ej. «Termohigrómetro (Ts y HR)»
const sensor = p => { const vs = String(p.var).split("+"); return p.sensor ? `${cap(p.sensor)} (${vs.map(v => NOMV[v] || v).join(" y ")})` : (SENSOR[vs[0]] || p.var); };
const que = p => (p.pruebas || [p.prueba]).map(x => QUE[x] || x).join(", ");
const esFalla = a => !!a.episodio || FALLA.has(a.prueba);

// episodios activos de una estación: cada aviso con «episodio» (agrupado en el servidor, qc/episodios.py);
// lo antiguo sin «episodio» se agrupa aquí por prueba y variable
function episodios(e, R){
  const hasta = R && R.datos_hasta ? ms(R.datos_hasta) : Date.now(), out = [];
  const inf = base => Object.entries((R && R.informados) || {}).find(([c, r]) => c.startsWith(base + "|") && !r.fin);
  (e.alertas || []).filter(a => a.episodio).forEach(a => { const ep = a.episodio, base = e.codigo + "|" + ep.sensor, I = inf(base);
    const pr = [...new Set((a.detalle || []).map(d => (d.match(/ · (\w+):/) || [])[1]).filter(Boolean))];
    out.push({codigo: e.codigo, nombre: e.nombre, prueba: a.prueba, pruebas: pr.length ? pr : [a.prueba], var: a.var, sensor: ep.sensor, alertas: [a], nivel: a.nivel,
      inicio: ms(ep.inicio), ultima: ms(ep.fin), sigue: ep.sigue, minutos: ep.minutos, informado: I ? I[0] : null, base, msg: a.msg, detalle: a.detalle || []}); });
  // sin «episodio» del servidor: se agrupa aquí por estación y sensor (Ts, Td y HR = termohigrómetro), igual que qc/episodios.py
  const SEN = {T: "termohigrómetro", HR: "termohigrómetro", Td: "termohigrómetro", P_est: "barómetro", P_mar: "barómetro", P_std: "barómetro",
    ff10: "anemómetro", ff2: "anemómetro", fx10: "anemómetro", dd10: "veleta", dd2: "veleta", rr1m: "pluviómetro", Rad: "piranómetro (radiación)"};
  const g = {};
  (e.alertas || []).filter(a => !a.episodio && FALLA.has(a.prueba)).forEach(a => { const k = SEN[a.var] || a.var; (g[k] ||= []).push(a); });
  Object.entries(g).forEach(([sen, L]) => {
    const t = L.map(a => ms(a.momento)).filter(x => !isNaN(x)).sort((a, b) => a - b), base = e.codigo + "|" + sen, I = inf(base);
    const vs = [...new Set(L.flatMap(a => String(a.var).split("+")))], pr = [...new Set(L.map(a => a.prueba))];
    const sigue = true, fin = hasta;      // está en la pasada actual: sigue activa
    out.push({codigo: e.codigo, nombre: e.nombre, prueba: pr[0], pruebas: pr, var: vs.join("+"), sensor: SEN[vs[0]] ? sen : null, alertas: L, nivel: Math.max(...L.map(a => a.nivel)),
      inicio: t[0], ultima: fin, sigue, minutos: (fin - t[0]) / 60e3, informado: I ? I[0] : null, base, msg: L.map(a => a.msg).join(" · "), detalle: L.map(a => `${utc(ms(a.momento))} · ${a.prueba}: ${a.msg}`)});
  });
  return out.sort((a, b) => b.nivel - a.nivel || b.ultima - a.ultima);
}

function texto(ep){
  const dia = utc(ep.inicio).slice(0, 10).split("-").reverse().join("-");
  return [
    `Asunto: Falla de sensor – ${ep.nombre} (${ep.codigo}) – ${dia}`,
    ``,
    `Estación: ${ep.nombre} (${ep.codigo})`,
    `Sensor: ${sensor(ep)}`,
    `Período: ${utc(ep.inicio)} a ${ep.sigue ? "la fecha (continúa)" : utc(ep.ultima)} UTC (hora local ${loc(ep.inicio)} a ${ep.sigue ? "la fecha" : loc(ep.ultima)}), ${dur(ep.minutos)}`,
    `Qué se observó: ${que(ep)}.`,
    `Estado actual: ${ep.sigue ? "la falla continúa" : "la falla terminó; los datos volvieron a la normalidad"}.`,
    ``,
    `Se solicita revisar el sensor y su conexión. Los datos de ese período fueron marcados como erróneos.`
  ].join("\n");
}

// ---------- gráfico ----------
async function serie(cod, col, desde, hasta){
  const h = x => new Date(x).toISOString().slice(0, 13), out = [];
  for (let a = desde; a < hasta; a += 48 * 3600e3){
    const b = Math.min(hasta, a + 47 * 3600e3);
    const r = await fetch(`/api/minutarios?cod=${encodeURIComponent(cod)}&desde=${h(a)}&hasta=${h(b)}`); const D = await r.json();
    if (!D.cab) continue;
    const cab = D.cab.split(","), im = cab.indexOf("momento"), ic = cab.indexOf(col);
    if (ic < 0) continue;
    D.filas.forEach(l => { const c = l.split(","), t = ms(c[im]), y = parseFloat(c[ic]); if (!isNaN(t) && !isNaN(y) && t >= desde && t <= hasta) out.push([t, y]); });
  }
  return out.sort((a, b) => a[0] - b[0]);
}
function ventana(ep, k){
  const m = ep.minutos, fin = ep.sigue ? Date.now() : ep.ultima;
  let a, b;
  if (m < 60){ a = ep.inicio - 3600e3; b = fin + 3600e3; }
  else if (m < 1440){ a = ep.inicio - 6 * 3600e3; b = fin + 6 * 3600e3; }
  else { a = Math.floor(ep.inicio / 864e5) * 864e5; b = (Math.floor(fin / 864e5) + 2) * 864e5; }
  const c = (a + b) / 2, w = (b - a) * Math.pow(1.6, k);
  return [Math.round(c - w / 2), Math.min(Date.now(), Math.round(c + w / 2))];
}
async function grafico(cont, ep, R){
  const e = (R.estaciones || []).find(x => x.codigo === ep.codigo) || {};
  const vec = (e.vecinas || []).map(c => [c, ((R.estaciones || []).find(x => x.codigo === c) || {}).nombre || c]);
  let k = 0, ref = "", vs = String(ep.var).split("+"), v = vs[0];
  cont.innerHTML = `<div class="sgtop"><button class="sgbtn" data-z="-1" title="Acercar">−</button><button class="sgbtn" data-z="1" title="Alejar">+</button>
    ${vs.length > 1 ? `<label>Variable <select class="fvar" style="background:var(--fondo);color:var(--tx);border:1px solid var(--bd);border-radius:6px;padding:2px 6px">${vs.map(x => `<option value="${esc(x)}">${esc(NOMV[x] || x)}</option>`).join("")}</select></label>` : ""}
    <label>Referencia <select class="fref" style="background:var(--fondo);color:var(--tx);border:1px solid var(--bd);border-radius:6px;padding:2px 6px"><option value="">ninguna</option>${vec.map(([c, n]) => `<option value="${esc(c)}">${esc(n)}</option>`).join("")}</select></label>
    <span class="sgval"></span></div><div class="fg"></div>
    <div class="sgley"><span><i style="background:#5AA9E6"></i>${esc(ep.nombre)}</span><span><i style="background:var(--err)"></i>tramo con falla</span><span class="lref" hidden><i style="background:#C9A54C"></i>referencia</span><span class="lvar"></span></div>`;
  const dib = async () => {
    const [a, b] = ventana(ep, k), G = cont.querySelector(".fg");
    G.innerHTML = `<p style="color:var(--mu)">Cargando ${dur((b - a) / 60e3)} de minutario…</p>`;
    let S, Rf = [];
    cont.querySelector(".lvar").textContent = `${NOMV[v] || v} (${UNI[v] || ""}), hora UTC`;
    try { S = await serie(ep.codigo, v, a, b); if (ref) Rf = await serie(ref, v, a, b); }
    catch (er){ G.innerHTML = `<p style="color:var(--err)">No se pudo cargar el minutario (${esc(er.message)}).</p>`; return; }
    cont.querySelector(".lref").hidden = !ref;
    if (!S.length){ G.innerHTML = `<p style="color:var(--mu)">Sin datos minutarios en ese período.</p>`; return; }
    const ys = S.concat(Rf).map(p => p[1]); let lo = Math.min(...ys), hi = Math.max(...ys); if (hi - lo < 1){ lo -= .5; hi += .5; }
    const W = 760, H = 260, x0 = 46, y0 = 10, w = W - x0 - 10, h = H - y0 - 30, X = t => x0 + w * (t - a) / (b - a), Y = y => y0 + h * (1 - (y - lo) / (hi - lo));
    const fin = ep.sigue ? b : ep.ultima + 60e3;
    const lin = (P, f) => { let d = "", ant = null; P.forEach(p => { if (f && !f(p)){ ant = null; return; } d += (ant && p[0] - ant < 30 * 60e3 ? "L" : "M") + X(p[0]).toFixed(1) + "," + Y(p[1]).toFixed(1); ant = p[0]; }); return d; };
    const ticks = [0, .5, 1].map(f => lo + (hi - lo) * f).map(t => `<text x="${x0 - 5}" y="${Y(t) + 4}" text-anchor="end" fill="#9fb0cc" font-size="11">${t.toFixed(1)}</text><line x1="${x0}" x2="${W - 10}" y1="${Y(t)}" y2="${Y(t)}" stroke="#ffffff14"/>`).join("");
    const xt = [0, .25, .5, .75, 1].map(f => a + (b - a) * f).map(t => `<text x="${X(t)}" y="${H - 10}" text-anchor="middle" fill="#9fb0cc" font-size="11">${utc(t).slice(8, 10)}/${utc(t).slice(5, 7)} ${utc(t).slice(11, 16)}</text>`).join("");
    G.innerHTML = `<svg viewBox="0 0 ${W} ${H}" width="100%" style="display:block"><rect x="${X(Math.max(a, ep.inicio))}" y="${y0}" width="${Math.max(2, X(Math.min(b, fin)) - X(Math.max(a, ep.inicio)))}" height="${h}" fill="#E0525222"/>${ticks}${xt}
      ${Rf.length ? `<path d="${lin(Rf)}" fill="none" stroke="#C9A54C" stroke-width="1.5" stroke-dasharray="5 4"/>` : ""}
      <path d="${lin(S)}" fill="none" stroke="#5AA9E6" stroke-width="1.6"/><path d="${lin(S, p => p[0] >= ep.inicio && p[0] <= fin)}" fill="none" stroke="#E05252" stroke-width="2.2"/></svg>`;
    cont.querySelector(".sgval").textContent = `${utc(a)} a ${utc(b)} UTC · ${S.length} minutos`;
  };
  cont.addEventListener("click", ev => { const z = ev.target.closest("[data-z]"); if (z){ k = Math.max(-4, Math.min(5, k + +z.dataset.z)); dib(); } });
  cont.querySelector(".fref").addEventListener("change", ev => { ref = ev.target.value; dib(); });
  const fv = cont.querySelector(".fvar"); if (fv) fv.addEventListener("change", ev => { v = ev.target.value; dib(); });
  dib();
}
window.FALLAS = {episodios, texto, grafico, dur, utc, loc, sensor, que, esFalla};
})();
