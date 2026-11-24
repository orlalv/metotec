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
const loc = t => new Date(t).toLocaleString("es-CL", {timeZone: "America/Santiago", day: "2-digit", month: "2-digit", hour: "2-digit", hourCycle: "h23", minute: "2-digit", hour12: false});
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
const CACHE_M = new Map();   // trozos de minutario ya pedidos (código + rango)
async function serie(cod, col, desde, hasta){
  const h = x => new Date(x).toISOString().slice(0, 13), out = [], T = [];
  for (let a = desde; a < hasta; a += 48 * 3600e3) T.push([a, Math.min(hasta, a + 47 * 3600e3)]);
  const R = await Promise.all(T.map(([a, b]) => { const k = `${cod}|${h(a)}|${h(b)}`;      // los trozos se piden en paralelo
    if (!CACHE_M.has(k)) CACHE_M.set(k, fetch(`/api/minutarios?cod=${encodeURIComponent(cod)}&desde=${h(a)}&hasta=${h(b)}`).then(r => r.json()).catch(er => { CACHE_M.delete(k); throw er; }));
    return CACHE_M.get(k); }));
  R.forEach(D => { if (!D.cab) return;
    const cab = D.cab.split(","), im = cab.indexOf("momento"), ic = cab.indexOf(col);
    if (ic < 0) return;
    D.filas.forEach(l => { const c = l.split(","), t = ms(c[im]), y = parseFloat(c[ic]); if (!isNaN(t) && !isNaN(y) && t >= desde && t <= hasta) out.push([t, y]); }); });
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
// mapa bajo el gráfico: la estación y sus vecinas con el valor de cada una al inicio de la falla
async function mapaVec(cont, e, ep, vec, gv){
  const M = cont.querySelector(".fmap"); if (!window.L || e.lat == null){ M.remove(); return; }
  const v = gv(), t0 = ep.inicio, mp = L.map(M, {attributionControl: false});
  L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {maxZoom: 13}).addTo(mp);
  const et = (n, val, col) => L.divIcon({className: "", iconSize: null, html: `<div style="transform:translate(-50%,-100%);white-space:nowrap;background:#0d1117dd;border:1px solid ${col};color:#fff;border-radius:6px;padding:1px 6px;font:600 11.5px system-ui;text-align:center">${esc(n)}<br><b style="color:${col}">${val}</b></div>`});
  const valEn = async c => { try { const P = await serie(c, v, t0 - 10 * 60e3, t0 + 10 * 60e3); if (!P.length) return null; P.sort((a, b) => Math.abs(a[0] - t0) - Math.abs(b[0] - t0)); return P[0][1]; } catch (er){ return null; } };
  const fm = y => y == null ? "sin dato" : `${Math.round(y * 10) / 10} ${UNI[v] || ""}`;
  const pts = [[e.lat, e.lon]], m0 = L.marker([e.lat, e.lon], {icon: et(ep.nombre, "…", "#f85149")}).addTo(mp);
  valEn(ep.codigo).then(y => m0.setIcon(et(ep.nombre, fm(y), "#f85149")));
  vec.filter(z => z[3].lat != null).forEach(([c, n, d, x]) => { pts.push([x.lat, x.lon]);
    const mk = L.marker([x.lat, x.lon], {icon: et(`${n} · ${d} km`, "…", "#58a6ff")}).addTo(mp);
    valEn(c).then(y => mk.setIcon(et(`${n} · ${d} km`, fm(y), "#58a6ff"))); });
  if (pts.length > 1) mp.fitBounds(pts, {padding: [50, 50], maxZoom: 10}); else mp.setView(pts[0], 9);
  cont.querySelector(".fmapt").textContent = `${NOMV[v] || v} al inicio de la falla (${utc(t0)} UTC) · rojo = la estación, azul = vecinas que usa el control${vec.length ? "" : " (no tiene vecinas cercanas)"}`;
}
async function grafico(cont, ep, R){
  const e = (R.estaciones || []).find(x => x.codigo === ep.codigo) || {};
  const km = (a, b) => { const r = Math.PI / 180, q = Math.sin((b.lat - a.lat) * r / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin((b.lon - a.lon) * r / 2) ** 2; return 12742 * Math.asin(Math.sqrt(q)); };
  const vec = (e.vecinas || []).map(c => { const x = (R.estaciones || []).find(y => y.codigo === c) || {}; return [c, x.nombre || c, x.lat != null && e.lat != null ? Math.round(km(e, x)) : null, x]; });
  let k = 0, ref = "", vs = String(ep.var).split("+"), v = vs[0];
  cont.innerHTML = `<div class="sgtop"><button class="sgbtn" data-z="-1" title="Acercar">−</button><button class="sgbtn" data-z="1" title="Alejar">+</button>
    ${vs.length > 1 ? `<label>Variable <select class="fvar" style="background:var(--fondo);color:var(--tx);border:1px solid var(--bd);border-radius:6px;padding:2px 6px">${vs.map(x => `<option value="${esc(x)}">${esc(NOMV[x] || x)}</option>`).join("")}</select></label>` : ""}
    <label>Referencia <select class="fref" style="background:var(--fondo);color:var(--tx);border:1px solid var(--bd);border-radius:6px;padding:2px 6px"><option value="">${vec.length ? "ninguna" : "sin vecinas cercanas"}</option>${vec.map(([c, n, d]) => `<option value="${esc(c)}">${esc(n)}${d != null ? ` · ${d} km` : ""}</option>`).join("")}</select></label>
    <span class="sgval"></span></div><div class="fg"></div>
    <div class="sgley"><span><i style="background:#5AA9E6"></i>${esc(ep.nombre)}</span><span><i style="background:var(--err)"></i>tramo con falla</span><span class="lref" hidden><i style="background:#C9A54C"></i>vecina</span><span class="lctl" hidden><i style="background:#3fb950"></i><span class="tctl"></span></span><span class="lvar"></span></div>
    <div class="fmap" style="height:300px;margin-top:8px;border:1px solid var(--bd);border-radius:8px"></div><div class="fmapt" style="font-size:12px;color:var(--mu);margin-top:3px"></div>`;
  mapaVec(cont, e, ep, vec, () => v);
  const dib = async () => {
    const [a, b] = ventana(ep, k), G = cont.querySelector(".fg");
    G.innerHTML = `<p style="color:var(--mu)">Cargando ${dur((b - a) / 60e3)} de minutario…</p>`;
    let S, Rf = [];
    cont.querySelector(".lvar").textContent = `${NOMV[v] || v} (${UNI[v] || ""}), hora UTC`;
    try { S = await serie(ep.codigo, v, a, b); if (ref) Rf = await serie(ref, v, a, b); }
    catch (er){ G.innerHTML = `<p style="color:var(--err)">No se pudo cargar el minutario (${esc(er.message)}).</p>`; return; }
    cont.querySelector(".lref").hidden = !ref;
    if (S.length > 30){ const m = Math.max(3, Math.round(S.length / 120)), h2 = m >> 1;   // suavizado: media móvil centrada
      S = S.map((p, i) => { let t = 0, n = 0; for (let j = Math.max(0, i - h2); j <= Math.min(S.length - 1, i + h2); j++){ if (Math.abs(S[j][0] - p[0]) <= h2 * 60e3 * 2){ t += S[j][1]; n++; } } return [p[0], t / n]; }); }
    // valor con que lo comparó el control (vecinas, modelo, rango…), de la alerta de esa variable
    const al = (ep.alertas || []).filter(x => String(x.var).split("+").includes(v) && x.ref != null).slice(-1)[0];
    const ctl = al ? +al.ref : null;
    cont.querySelector(".lctl").hidden = ctl == null;
    if (al) cont.querySelector(".tctl").textContent = `con qué se comparó: ${ctl} ${UNI[v] || ""} (${al.prueba === "modelo" ? "Open-Meteo" : al.prueba === "wrf" ? "WRF-DMC" : al.prueba})`;
    if (!S.length){ G.innerHTML = `<p style="color:var(--mu)">Sin datos minutarios en ese período.</p>`; return; }
    const ys = S.concat(Rf).map(p => p[1]).concat(ctl == null ? [] : [ctl]); let lo = Math.min(...ys), hi = Math.max(...ys); if (hi - lo < 1){ lo -= .5; hi += .5; }
    const W = 760, H = 260, x0 = 46, y0 = 10, w = W - x0 - 10, h = H - y0 - 30, X = t => x0 + w * (t - a) / (b - a), Y = y => y0 + h * (1 - (y - lo) / (hi - lo));
    const fin = ep.sigue ? b : ep.ultima + 60e3;
    const lin = (P, f) => { let d = "", ant = null, q = null; P.forEach(p => { if (f && !f(p)){ ant = null; return; } const x = X(p[0]), y = Y(p[1]);
      if (ant && p[0] - ant < 30 * 60e3){ const mx = (q[0] + x) / 2; d += `Q${q[0].toFixed(1)},${q[1].toFixed(1)} ${mx.toFixed(1)},${((q[1] + y) / 2).toFixed(1)}`; } else d += `M${x.toFixed(1)},${y.toFixed(1)}`;
      q = [x, y]; ant = p[0]; }); return d; };
    const ticks = [0, .5, 1].map(f => lo + (hi - lo) * f).map(t => `<text x="${x0 - 5}" y="${Y(t) + 4}" text-anchor="end" fill="#9fb0cc" font-size="11">${t.toFixed(1)}</text><line x1="${x0}" x2="${W - 10}" y1="${Y(t)}" y2="${Y(t)}" stroke="#ffffff14"/>`).join("");
    const xt = [0, .25, .5, .75, 1].map(f => a + (b - a) * f).map(t => `<text x="${X(t)}" y="${H - 10}" text-anchor="middle" fill="#9fb0cc" font-size="11">${utc(t).slice(8, 10)}/${utc(t).slice(5, 7)} ${utc(t).slice(11, 16)}</text>`).join("");
    G.innerHTML = `<svg viewBox="0 0 ${W} ${H}" width="100%" style="display:block"><rect x="${X(Math.max(a, ep.inicio))}" y="${y0}" width="${Math.max(2, X(Math.min(b, fin)) - X(Math.max(a, ep.inicio)))}" height="${h}" fill="#E0525222"/>${ticks}${xt}
      ${Rf.length ? `<path d="${lin(Rf)}" fill="none" stroke="#C9A54C" stroke-width="1.5" stroke-dasharray="5 4"/>` : ""}
      ${ctl != null ? `<line x1="${x0}" x2="${W - 10}" y1="${Y(ctl)}" y2="${Y(ctl)}" stroke="#3fb950" stroke-width="1.6" stroke-dasharray="7 4"/><text x="${W - 12}" y="${Y(ctl) - 4}" text-anchor="end" fill="#3fb950" font-size="11">${ctl}</text>` : ""}
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
