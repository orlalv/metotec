/* Precipitación → «Verificar»: una estación y una fecha, con las 3 imágenes de satélite a la vez (NASA IMERG, GOES infrarrojo, GOES color real),
   la estación y sus vecinas en un gráfico y las tablas de precipitación.
   · Si el archivo minutario de METOTEC tiene ese día (rama «datos», ema/AAAA/MM/DD/HH.csv.gz): gráfico por hora y por minuto, con vecinas ≤ 60 km.
   · Si no lo tiene: lluvia diaria de la DMC (/api/aguacaida, con clave) de la estación y sus vecinas, ±15 días alrededor de la fecha.
   Pantalla informativa: no guarda ni corrige nada. */
(function(){
const $ = (s, r) => (r || document).querySelector(s);
const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;"})[c]);
const n1 = v => (Math.round(v * 10) / 10).toLocaleString("es-CL");
const p2 = n => String(n).padStart(2, "0");
const GIBS = "https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/";
const CAPAS = [
  {k: "imerg", t: "Lluvia · NASA IMERG", id: "IMERG_Precipitation_Rate", niv: [["GoogleMapsCompatible_Level6", 6]], ext: "png", op: .85},
  {k: "ir", t: "GOES · infrarrojo", id: "GOES-East_ABI_Band13_Clean_Infrared", niv: [["GoogleMapsCompatible_Level6", 6], ["GoogleMapsCompatible_Level7", 7], ["GoogleMapsCompatible_Level8", 8]], ext: "png", op: .75,
    dia: [["MODIS_Terra_Brightness_Temp_Band31_Day", "MODIS Terra · temperatura de nubes (día)"], ["MODIS_Terra_Brightness_Temp_Band31_Night", "MODIS Terra · temperatura de nubes (noche)"], ["MODIS_Aqua_Brightness_Temp_Band31_Day", "MODIS Aqua · temperatura de nubes (día)"], ["MODIS_Aqua_Brightness_Temp_Band31_Night", "MODIS Aqua · temperatura de nubes (noche)"]], diaNiv: [["GoogleMapsCompatible_Level7", 7], ["GoogleMapsCompatible_Level6", 6]], diaExt: "png", diaOp: .8},
  {k: "goes", t: "GOES · color real", id: "GOES-East_ABI_GeoColor", niv: [["GoogleMapsCompatible_Level7", 7]], ext: "jpeg", op: .9,
    dia: [["VIIRS_SNPP_CorrectedReflectance_TrueColor", "VIIRS Suomi NPP · color real"], ["MODIS_Terra_CorrectedReflectance_TrueColor", "MODIS Terra · color real"], ["MODIS_Aqua_CorrectedReflectance_TrueColor", "MODIS Aqua · color real"]], diaNiv: [["GoogleMapsCompatible_Level9", 9]], diaExt: "jpeg", diaOp: 1}];
const COL = ["#58a6ff", "#3fb950", "#d29922", "#bc8cff", "#39c5cf", "#ff7b72"];
const RADIO_KM = 60, MAX_VEC = 6, MIN_FILAS_H = 3;
const hoyUTC = () => new Date().toISOString().slice(0, 10);
let ST = (() => { try { const j = JSON.parse(localStorage.getItem("qcVerif") || "{}"); return {cod: j.cod || "", dia: j.dia || "", hora: Number.isFinite(j.hora) ? j.hora : 12}; } catch (e) { return {cod: "", dia: "", hora: 12}; } })();
if (!ST.dia) ST.dia = hoyUTC();
let D = null, MAPS = [], EL = null, TOK = 0;
const guardar = () => { try { localStorage.setItem("qcVerif", JSON.stringify(ST)); } catch (e) {} };
const U = () => window.PPX && window.PPX.util;
const km = (a, b) => { const r = Math.PI / 180, dl = (b.lat - a.lat) * r, dn = (b.lon - a.lon) * r, x = Math.sin(dl / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dn / 2) ** 2; return 12742 * Math.asin(Math.sqrt(x)); };
const ms = (dia, h, m) => Date.parse(`${dia}T${p2(h || 0)}:${p2(m || 0)}:00Z`);
const loc = t => new Date(t).toLocaleTimeString("es-CL", {timeZone: "America/Santiago", hour: "2-digit", minute: "2-digit"});
const locD = t => new Date(t).toLocaleString("es-CL", {timeZone: "America/Santiago", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit"});
const clave = () => { try { return sessionStorage.getItem("qcClave") || ""; } catch (e) { return ""; } };

/* ---------- lectura de datos ---------- */
async function cargar(){
  const tok = ++TOK, out = $("#vOut", EL); if (!out) return;
  out.innerHTML = `<p style="color:var(--mu)">Leyendo datos…</p>`; D = null;
  const cat = await U().catalogo(), e0 = cat.get(ST.cod);
  if (!e0){ out.innerHTML = `<p style="color:#e7b03b">Elija una estación de la lista.</p>`; actualizarMapas(); return; }
  const pos = e => ({lat: +e.lat, lon: +e.lon}), p0 = pos(e0);
  const cand = [...cat.values()].filter(e => e.codigo !== e0.codigo && isFinite(e.lat) && isFinite(e.lon)).map(e => ({e, km: km(p0, pos(e))})).sort((a, b) => a.km - b.km);
  const ts = Array.from({length: 24}, (_, h) => ms(ST.dia, h));
  const txt = await U().varias(ts, 6); if (tok !== TOK) return;
  const hay = txt.some(t => typeof t === "string" && t.length > 50), falla = txt.some(t => t === undefined);
  if (hay){ D = leerMinutos(txt, e0, cand); }
  else if (falla && !txt.some(t => t === null)){ out.innerHTML = `<p style="color:#e5534b">No pude leer los archivos de ese día (${esc(U().dg())}). Pruebe de nuevo.</p>`; actualizarMapas(); return; }
  else { D = await leerDiario(e0, cand); if (tok !== TOK) return; }
  if (D) D.e0 = e0;
  actualizarMapas(); pintar();
}
function leerMinutos(txt, e0, cand){
  const por = new Map();                                   // cod -> Float32Array(1440) con rr1m por minuto UTC del día
  txt.forEach((tx, h) => { if (typeof tx !== "string" || !tx) return;
    const ls = tx.split("\n"), iR = ls[0].split(",").indexOf("rr1m"); if (iR < 0) return;
    for (let i = 1; i < ls.length; i++){ const l = ls[i]; if (l.length < 20) continue; const v = l.split(","); if (v[iR] === "") continue;
      const m = +v[1].slice(11, 13) * 60 + +v[1].slice(14, 16); let a = por.get(v[0]); if (!a){ a = new Float32Array(1440).fill(NaN); por.set(v[0], a); } a[m] = +v[iR]; } });
  const mia = por.get(e0.codigo);
  const vec = cand.filter(c => c.km <= RADIO_KM && por.has(c.e.codigo)).slice(0, MAX_VEC).map((c, i) => ({cod: c.e.codigo, nombre: c.e.nombre, km: c.km, lat: +c.e.lat, lon: +c.e.lon, color: COL[i % COL.length], min: por.get(c.e.codigo)}));
  const horas = a => Array.from({length: 24}, (_, h) => { let s = 0, n = 0; for (let m = h * 60; m < h * 60 + 60; m++) if (a[m] === a[m]){ s += a[m]; n++; } return n >= MIN_FILAS_H ? s : null; });
  return {modo: "min", mia, vec, hs: mia ? horas(mia) : null, hv: vec.map(v => horas(v.min)), sinPluvio: !mia};
}
async function leerDiario(e0, cand){
  const k = clave(); if (!k) return {modo: "dia", error: "Sin clave: para días sin archivo minutario hace falta la clave de qc.html (la lluvia diaria viene del servicio de la DMC)."};
  const lista = [e0, ...cand.filter(c => c.km <= 100).slice(0, 10).map(c => c.e)];
  const pedir = async e => { try { const c = new AbortController(), t = setTimeout(() => c.abort(), 32000);
      const r = await fetch("/api/aguacaida?cod=" + e.codigo, {headers: {"x-clave": k}, signal: c.signal}); clearTimeout(t);
      if (!r.ok) return {e, error: "HTTP " + r.status}; const j = await r.json(); return {e, dias: new Map((j.dias || []).map(d => [d[0], d]))}; } catch (err) { return {e, error: err.name === "AbortError" ? "sin respuesta" : err.message}; } };
  const rs = await Promise.all(lista.map(pedir)), mia = rs[0];
  if (mia.error) return {modo: "dia", error: "La estación no tiene lluvia diaria disponible (" + mia.error + ")."};
  const vec = rs.slice(1).filter(r => r.dias && r.dias.size).slice(0, 4).map((r, i) => ({cod: r.e.codigo, nombre: r.e.nombre, km: km({lat: +e0.lat, lon: +e0.lon}, {lat: +r.e.lat, lon: +r.e.lon}), lat: +r.e.lat, lon: +r.e.lon, color: COL[i], dias: r.dias}));
  const fechas = []; for (let d = -15; d <= 15; d++) fechas.push(new Date(ms(ST.dia, 12) + d * 864e5).toISOString().slice(0, 10));
  return {modo: "dia", mia: mia.dias, vec, fechas};
}

/* ---------- gráficos y tablas ---------- */
function svgBarras(vals, ref, sel, onKey, etiq, titulo){      // barras superpuestas con transparencia: estación (rojo) y vecinas (su color); vals: [n], ref: [[color, [n]]]
  const W = 30, H = 130, base = 108, n = vals.length;
  const todos = [...vals, ...ref.flatMap(r => r[1])].filter(v => v != null && isFinite(v)), mx = Math.max(1, ...todos) * 1.12, y = v => base - (v / mx) * (base - 8);
  const cols = vals.map((v, i) => { const x = 34 + i * W;
    return `<g class="vclick" data-k="${onKey(i)}" style="cursor:pointer"><title>${esc(etiq(i))}${v == null ? " · sin dato" : " · estación " + n1(v) + " mm"}${ref.map(([c, a]) => a[i] == null ? "" : " · vecina " + n1(a[i])).join("")}</title>
      <rect x="${x}" y="2" width="${W - 2}" height="${base - 2}" fill="${i === sel ? "#58a6ff26" : "transparent"}"/>
      ${ref.map(([c, a]) => a[i] == null || a[i] <= 0 ? "" : `<rect x="${x + 3}" y="${y(a[i])}" width="${W - 8}" height="${Math.max(1, base - y(a[i]))}" fill="${c}" fill-opacity=".5" stroke="${c}" stroke-opacity=".9"/>`).join("")}
      ${v == null ? `<text x="${x + W / 2 - 1}" y="${base - 4}" text-anchor="middle" font-size="9" fill="#8b949e">s/d</text>` : v <= 0 ? "" : `<rect x="${x + 3}" y="${y(v)}" width="${W - 8}" height="${Math.max(1, base - y(v))}" fill="#f85149" fill-opacity=".5" stroke="#f85149" stroke-opacity=".9"/>`}
      <text x="${x + W / 2 - 1}" y="${base + 13}" text-anchor="middle" font-size="9.5" fill="${i === sel ? "#58a6ff" : "#8b949e"}">${esc(etiq(i, true))}</text></g>`; }).join("");
  const w = 44 + n * W;
  return `<div style="overflow-x:auto"><svg viewBox="0 0 ${w} ${H + 4}" style="width:${w}px;max-width:100%;min-width:${Math.min(w, 520)}px;height:auto" role="img" aria-label="${esc(titulo)}">
    <line x1="30" y1="${base}" x2="${w}" y2="${base}" stroke="#30363d"/><text x="2" y="${y(mx / 1.12) + 3}" font-size="9" fill="#8b949e">${n1(mx / 1.12)}</text><text x="2" y="${base}" font-size="9" fill="#8b949e">0</text>${cols}</svg></div>`;
}
const leyenda = (D) => `<div style="font-size:12px;color:var(--mu);margin:2px 0 8px"><span style="color:#f85149">■</span> <b style="color:var(--tx)">${esc(D.e0.nombre)}</b> (estación) ${D.vec.map(v => `· <span style="color:${v.color}">●</span> ${esc(v.nombre)} (${Math.round(v.km)} km)`).join(" ")}</div>`;
function pintar(){
  const out = $("#vOut", EL); if (!out || !D) return;
  if (D.error){ out.innerHTML = `<p style="color:#e7b03b">${esc(D.error)}</p>`; return; }
  if (D.modo === "min") return pintarMin(out);
  pintarDia(out);
}
function pintarMin(out){
  if (D.sinPluvio){ out.innerHTML = `<p style="color:#e7b03b">Esta estación no informó agua caída (rr1m) ese día. Se muestran igual las imágenes.</p>`; return; }
  const h = ST.hora, v = D.mia, tot = D.hs.reduce((s, x) => s + (x || 0), 0), sel = D.hs[h];
  const mh = D.vec.map((vv, i) => D.hv[i][h]), medH = a => { const x = a.filter(z => z != null); return x.length ? x.reduce((s, z) => s + z, 0) / x.length : null; };
  const resumen = `Hora ${p2(h)}:00 UTC (${loc(ms(ST.dia, h))} local): estación <b>${sel == null ? "sin dato" : n1(sel) + " mm"}</b> · vecinas ${D.vec.length ? mh.map((x, i) => `<span style="color:${D.vec[i].color}">${x == null ? "s/d" : n1(x)}</span>`).join(" / ") + " mm" : "sin vecinas con dato a ≤ " + RADIO_KM + " km"} · total del día en la estación <b>${n1(tot)} mm</b>.`;
  const hs = svgBarras(D.hs, D.vec.map((vv, i) => [vv.color, D.hv[i]]), h, i => i, (i, c) => c ? p2(i) : `${p2(i)}:00 UTC (${loc(ms(ST.dia, i))} local)`, "mm por hora");
  // minuto a minuto de la hora elegida
  const mm = Array.from({length: 60}, (_, i) => v[h * 60 + i]), veM = D.vec.map(x => Array.from({length: 60}, (_, i) => x.min[h * 60 + i]));
  const mxm = Math.max(0.5, ...mm.filter(z => z === z), ...veM.flat().filter(z => z === z)) * 1.12, W = 11, base = 96, y = z => base - (z / mxm) * (base - 6);
  const lin = a => { let d = "", on = false; a.forEach((z, i) => { if (z !== z){ on = false; return; } d += (on ? "L" : "M") + (30 + i * W + W / 2) + " " + y(z); on = true; }); return d; };
  const wm = 40 + 60 * W;
  const minG = `<svg viewBox="0 0 ${wm} ${base + 20}" style="width:${wm}px;max-width:100%;height:auto" role="img" aria-label="mm por minuto en la hora elegida"><line x1="28" y1="${base}" x2="${wm}" y2="${base}" stroke="#30363d"/>
    <text x="2" y="${y(mxm / 1.12) + 3}" font-size="9" fill="#8b949e">${n1(mxm / 1.12)}</text><text x="2" y="${base}" font-size="9" fill="#8b949e">0</text>
    ${mm.map((z, i) => z !== z ? `<rect x="${30 + i * W}" y="${base - 3}" width="${W - 1}" height="3" fill="#8b949e55"><title>${p2(h)}:${p2(i)} sin dato</title></rect>` : `<rect x="${30 + i * W}" y="${y(z)}" width="${W - 2}" height="${Math.max(0.5, base - y(z))}" fill="#f85149"><title>${p2(h)}:${p2(i)} · ${n1(z)} mm</title></rect>`).join("")}
    ${veM.map((a, i) => `<path d="${lin(a)}" fill="none" stroke="${D.vec[i].color}" stroke-width="1.4" stroke-opacity=".9"/>`).join("")}
    ${[0, 10, 20, 30, 40, 50].map(i => `<text x="${30 + i * W}" y="${base + 13}" font-size="9.5" fill="#8b949e">${p2(h)}:${p2(i)}</text>`).join("")}</svg>`;
  // tabla horaria
  const filas = D.hs.map((x, i) => { const mv = medH(D.hv.map(a => a[i])), sosp = x != null && x < 0.2 && mv != null && mv >= 1;
    return `<tr class="vclick" data-k="${i}" style="cursor:pointer;${i === h ? "background:#1f6feb33;" : sosp ? "background:#f8514916;" : ""}"><td>${p2(i)}:00</td><td style="white-space:nowrap">${loc(ms(ST.dia, i))}</td><td style="text-align:right;font-weight:600">${x == null ? "s/d" : n1(x)}</td>
      ${D.hv.map(a => `<td style="text-align:right">${a[i] == null ? "s/d" : n1(a[i])}</td>`).join("")}<td style="text-align:right">${mv == null ? "—" : n1(mv)}</td></tr>`; }).join("");
  const tot2 = D.hv.map(a => a.reduce((s, z) => s + (z || 0), 0));
  out.innerHTML = `<p style="margin:4px 0">${resumen}</p>
    <h4 style="margin:10px 0 2px">Lluvia por hora · ${esc(ST.dia)} (UTC) <small style="color:var(--mu);font-weight:400">· clic en una hora para cambiar las imágenes</small></h4>${leyenda(D)}${hs}
    <h4 style="margin:12px 0 2px">Minuto a minuto · ${p2(h)}:00–${p2(h)}:59 UTC</h4>${minG}
    <details open style="margin-top:10px"><summary style="cursor:pointer"><b>Tabla de precipitación por hora (mm)</b></summary><div style="overflow-x:auto"><table class="tb" style="margin-top:4px"><tr><th>Hora UTC</th><th>Hora local</th><th>${esc(D.e0.nombre)}</th>${D.vec.map(x => `<th style="color:${x.color};text-align:right">${esc(x.nombre)}<br><small>${Math.round(x.km)} km</small></th>`).join("")}<th style="text-align:right">Media vecinas</th></tr>${filas}
      <tr style="font-weight:700"><td colspan="2">Total del día</td><td style="text-align:right">${n1(tot)}</td>${tot2.map(z => `<td style="text-align:right">${n1(z)}</td>`).join("")}<td></td></tr></table></div>
      <small style="color:var(--mu)">Fila rosada = la estación marcó menos de 0,2 mm mientras las vecinas marcaron 1 mm o más en promedio. s/d = menos de ${MIN_FILAS_H} datos en la hora.</small></details>`;
}
function pintarDia(out){
  const f = D.fechas, sel = f.indexOf(ST.dia), val = d => { const r = D.mia.get(d); return r ? r[2] ?? r[1] : null; };
  const vals = f.map(val), refs = D.vec.map(v => [v.color, f.map(d => { const r = v.dias.get(d); return r ? (r[2] ?? r[1]) : null; })]);
  const g = svgBarras(vals, refs, sel, i => i, (i, c) => c ? f[i].slice(8) : f[i], "mm por día");
  const filas = f.map((d, i) => { const r = D.mia.get(d), mv = refs.map(x => x[1][i]), mn = mv.filter(z => z != null), m = mn.length ? mn.reduce((s, z) => s + z, 0) / mn.length : null, x = vals[i], sosp = x != null && x < 0.2 && m != null && m >= 1;
    return `<tr class="vclick" data-k="${i}" style="cursor:pointer;${i === sel ? "background:#1f6feb33;" : sosp ? "background:#f8514916;" : ""}"><td style="white-space:nowrap">${d}</td><td style="text-align:right;font-weight:600">${x == null ? "s/d" : n1(x)}${r && r[3] ? " <small>(traza)</small>" : ""}</td>${mv.map(z => `<td style="text-align:right">${z == null ? "s/d" : n1(z)}</td>`).join("")}<td style="text-align:right">${m == null ? "—" : n1(m)}</td></tr>`; }).join("");
  out.innerHTML = `<p style="margin:4px 0;color:#e7b03b">No hay archivo minutario de METOTEC para ${esc(ST.dia)}: se muestra la lluvia <b>diaria</b> de la DMC (±15 días). Las imágenes sí son de la fecha elegida (hora ${p2(ST.hora)}:00 UTC).</p>
    <h4 style="margin:10px 0 2px">Lluvia diaria · clic en un día para cambiar la fecha</h4>${leyenda(D)}${g}
    <details style="margin-top:10px"><summary style="cursor:pointer"><b>Tabla de precipitación diaria (mm)</b></summary><div style="overflow-x:auto"><table class="tb" style="margin-top:4px;width:auto"><tr><th>Fecha</th><th style="text-align:right">${esc(D.e0.nombre)}</th>${D.vec.map(x => `<th style="color:${x.color};text-align:right">${esc(x.nombre)}<br><small>${Math.round(x.km)} km</small></th>`).join("")}<th style="text-align:right">Media vecinas</th></tr>${filas}</table></div>
      <small style="color:var(--mu)">Fila rosada = la estación marcó menos de 0,2 mm mientras las vecinas marcaron 1 mm o más en promedio. Los valores diarios cierran a las 12 UTC según el servicio.</small></details>`;
}

/* ---------- las 3 imágenes ---------- */
function actualizarMapas(){
  const cat = U().catalogoSync(), e0 = cat && cat.get(ST.cod); if (!MAPS.length || !window.L) return;
  const t = ms(ST.dia, ST.hora), iso = new Date(t).toISOString().slice(0, 19) + "Z", futuro = t > Date.now();
  $("#vHoraT", EL).textContent = `${ST.dia} ${p2(ST.hora)}:00 UTC · ${locD(t)} local`;
  MAPS.forEach((M, ci) => { const C = CAPAS[ci], diag = $("#vD" + ci, EL);
    if (M.capa){ M.mapa.removeLayer(M.capa); M.capa = null; } M.grupo.clearLayers(); if (M.goesCapa){ M.mapa.removeLayer(M.goesCapa); M.goesCapa = null; } M.goesTok = (M.goesTok || 0) + 1; const bg = $("#vG" + ci, EL); if (bg) bg.innerHTML = "";
    const viejo = C.k !== "imerg" && t < Date.now() - 90 * 864e5;                    // GOES en NASA GIBS: solo ventana móvil de ~90 días → imagen diaria de MODIS/VIIRS
    const opc = viejo ? C.dia.flatMap(([id, n]) => C.diaNiv.map(([niv, z]) => ({id, n, niv, z, ext: C.diaExt, tiempo: ST.dia, op: C.diaOp}))) : C.niv.map(([niv, z]) => ({id: C.id, n: "", niv, z, ext: C.ext, tiempo: iso, op: C.op}));
    let alt = 0, ok = 0, mal = 0;
    const info = () => { diag.innerHTML = futuro ? `<span style="color:#d29922">hora futura: sin imagen</span>` : mal && !ok && alt >= opc.length - 1 ? `<span style="color:#e5534b">sin imagen para esta fecha/hora (${mal} teselas con error)</span>` : `${viejo ? `<span style="color:#d29922">GOES solo guarda ~90 días → imagen diaria: ${esc(opc[alt].n)}</span> · ` : ""}${ok} teselas cargadas${mal ? ` · ${mal} con error` : ""}`; };
    const mk = () => { const o = opc[alt], ly = L.tileLayer(`${GIBS}${o.id}/default/${o.tiempo}/${o.niv}/{z}/{y}/{x}.${o.ext}`, {pane: "sat", maxNativeZoom: o.z, maxZoom: 12, opacity: o.op, attribution: "NASA GIBS"}).addTo(M.mapa);
      ly.on("tileload", () => { ok++; info(); }); ly.on("tileerror", () => { mal++; info(); if (ok === 0 && mal >= 3 && alt + 1 < opc.length && ly === M.capa){ alt++; M.mapa.removeLayer(ly); mal = 0; M.capa = mk(); info(); } }); return ly; };
    if (!futuro) M.capa = mk(); info();
    if (viejo && !futuro && e0) goesOriginal(ci, e0, t);
    if (!e0) return; const g = M.grupo;
    L.circle([e0.lat, e0.lon], {radius: RADIO_KM * 1000, color: "#f85149", weight: 1, dashArray: "6 6", fill: false, interactive: false}).addTo(g);
    L.circleMarker([e0.lat, e0.lon], {radius: 15, color: "#f85149", weight: 3, fill: false, interactive: false}).addTo(g);
    L.circleMarker([e0.lat, e0.lon], {radius: 7, color: "#fff", weight: 2, fillColor: "#f85149", fillOpacity: 1}).bindTooltip(`${e0.nombre}${D && D.modo === "min" && D.hs && D.hs[ST.hora] != null ? " · " + n1(D.hs[ST.hora]) + " mm" : ""}`, {permanent: true, direction: "right"}).addTo(g);
    ((D && D.vec) || []).forEach((v, i) => { const x = D.modo === "min" ? D.hv[i][ST.hora] : null;
      L.circleMarker([v.lat, v.lon], {radius: 6, color: "#fff", weight: 2, fillColor: v.color, fillOpacity: 1}).bindTooltip(x != null ? `${n1(x)} mm` : `${v.nombre} (${Math.round(v.km)} km)`, {permanent: x != null, direction: "right"}).bindPopup(`<b>${esc(v.nombre)}</b><br>${Math.round(v.km)} km${x != null ? " · " + n1(x) + " mm esa hora" : ""}`).addTo(g); });
    if (M.estacion !== ST.cod && e0){ M.estacion = ST.cod; M.sync = true; M.mapa.setView([e0.lat, e0.lon], 8, {animate: false}); M.sync = false; }
  });
}
/* GOES original (NOAA AWS) para fechas de más de 90 días: pedido a /api/goes → GitHub Actions → imagen en el KV */
const GOES_PROD = {ir: "ir", goes: "color"};
function goesOriginal(ci, e0, t){
  const M = MAPS[ci], C = CAPAS[ci], box = $("#vG" + ci, EL), prod = GOES_PROD[C.k]; if (!box || !prod) return;
  const tt = new Date(t).toISOString().slice(0, 16), id = `${prod}_${ST.cod}_${tt.replace(/[-:]/g, "")}`, tok = M.goesTok;
  const vivo = () => tok === M.goesTok;
  const mostrar = m => { if (!vivo()) return; if (M.capa){ M.mapa.removeLayer(M.capa); M.capa = null; } if (M.goesCapa) M.mapa.removeLayer(M.goesCapa);
    M.goesCapa = L.imageOverlay(`/api/goes?id=${id}&img=1`, m.limites, {pane: "sat", opacity: prod === "ir" ? .8 : 1, attribution: "NOAA GOES"}).addTo(M.mapa);
    const d = $("#vD" + ci, EL); if (d) d.innerHTML = `<span style="color:#3fb950">${esc(m.sat)} original · escaneo ${esc(m.escaneo)}</span>${m.noche ? ` · <span style="color:#d29922">de noche el color real sale oscuro</span>` : ""}`;
    box.innerHTML = `<span style="color:var(--mu)" title="${esc(m.leyenda || "")}">ⓘ ${esc(m.leyenda || "")}</span>`; };
  const estado = async () => { try { const r = await fetch(`/api/goes?id=${id}`, {cache: "no-store"}); return r.ok ? await r.json() : null; } catch (e) { return null; } };
  const sondear = async n => { if (!vivo()) return; const m = await estado(); if (!vivo()) return;
    if (m && m.estado === "listo") return mostrar(m);
    if (m && m.estado === "error"){ box.innerHTML = `<span style="color:#e5534b">GOES original: ${esc(m.error || "error")}</span> <button data-g="1" style="background:none;border:1px solid var(--bd);color:var(--oro);border-radius:6px;padding:1px 8px;cursor:pointer;font:600 11.5px inherit">reintentar</button>`; return; }
    if (n > 60){ box.innerHTML = `<span style="color:#e5534b">GOES original: tardó demasiado</span> <button data-g="1" style="background:none;border:1px solid var(--bd);color:var(--oro);border-radius:6px;padding:1px 8px;cursor:pointer;font:600 11.5px inherit">reintentar</button>`; return; }
    box.innerHTML = `<span style="color:#d29922">⏳ GOES original en proceso (${m && m.estado === "procesando" ? "procesando" : "en cola"}, 1–2 min)…</span>`; setTimeout(() => sondear(n + 1), 6000); };
  const pedir = async () => { const k = clave(); if (!k){ box.innerHTML = `<span style="color:#e5534b">falta la clave: vuelve a entrar a la página</span>`; return; }
    box.innerHTML = `<span style="color:#d29922">pidiendo…</span>`;
    try { const r = await fetch("/api/goes", {method: "POST", headers: {"x-clave": k, "content-type": "application/json"}, body: JSON.stringify({cod: ST.cod, lat: e0.lat, lon: e0.lon, t: tt, prod})});
      if (!r.ok) throw new Error(r.status === 401 ? "clave incorrecta" : (await r.text()).slice(0, 120)); sondear(0); }
    catch (e) { box.innerHTML = `<span style="color:#e5534b">${esc(e.message || e)}</span> <button data-g="1" style="background:none;border:1px solid var(--bd);color:var(--oro);border-radius:6px;padding:1px 8px;cursor:pointer;font:600 11.5px inherit">reintentar</button>`; } };
  box.onclick = ev => { if (ev.target.closest("[data-g]")) pedir(); };
  estado().then(m => { if (!vivo()) return; if (m && ["listo", "pendiente", "procesando"].includes(m.estado)) return sondear(0); box.innerHTML = `<button data-g="1" style="background:none;border:1px solid var(--bd);color:var(--oro);border-radius:6px;padding:1px 8px;cursor:pointer;font:600 11.5px inherit" title="Baja el archivo original de NOAA (AWS) y lo dibuja; tarda 1–2 min la primera vez">GOES original (NOAA)</button>`; });
}
function crearMapas(){
  MAPS = CAPAS.map((C, i) => { const mapa = L.map("vM" + i, {zoomControl: true, attributionControl: i === 2});
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {maxZoom: 12, attribution: "© OpenStreetMap"}).addTo(mapa); mapa.createPane("sat").style.zIndex = 250;
    mapa.setView([-33.4, -70.7], 5); return {mapa, grupo: L.layerGroup().addTo(mapa), capa: null, estacion: null, sync: false}; });
  MAPS.forEach(M => M.mapa.on("moveend", () => { if (M.sync) return; const c = M.mapa.getCenter(), z = M.mapa.getZoom();
    MAPS.forEach(o => { if (o === M) return; const c2 = o.mapa.getCenter(); if (o.mapa.getZoom() === z && Math.abs(c2.lat - c.lat) < 1e-6 && Math.abs(c2.lng - c.lng) < 1e-6) return; o.sync = true; o.mapa.setView(c, z, {animate: false}); o.sync = false; }); }));
  setTimeout(() => MAPS.forEach(M => M.mapa.invalidateSize()), 80);
}

/* ---------- pantalla ---------- */
function pagina(el){
  EL = el;
  if (!U() || !window.L){ el.innerHTML = `<div class="ppx"><p style="color:var(--mu)">Cargando…</p></div>`; return; }
  const ayer = new Date(Date.now() - 864e5).toISOString().slice(0, 10);
  el.innerHTML = `<div class="ppx ppver" style="max-width:none;border-style:solid"><h3>Verificar <small style="color:var(--mu);font-weight:400">· una estación, una fecha: 3 imágenes + vecinas + tablas</small></h3>
    <div class="htools" style="margin-bottom:6px"><input id="vEst" list="vLista" placeholder="Estación (código o nombre)" style="min-width:260px" value=""><datalist id="vLista"></datalist>
      <label>Día (UTC) <input type="date" id="vDia" value="${esc(ST.dia)}" max="${hoyUTC()}"></label>
      <label>Hora UTC <select id="vHora">${Array.from({length: 24}, (_, h) => `<option value="${h}"${h === ST.hora ? " selected" : ""}>${p2(h)}:00</option>`).join("")}</select></label>
      <button id="vAnt">‹ hora</button><button id="vSig">hora ›</button><button id="vAyer" title="Ayer (UTC)">Ayer</button><button id="vAct">↻ Cargar</button><b id="vHoraT" style="margin-left:6px"></b></div>
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:8px;margin:6px 0">${CAPAS.map((C, i) => `<div><div style="font-size:12.5px;margin-bottom:2px"><b>${C.t}</b> <span id="vD${i}" style="color:var(--mu);font-size:11.5px"></span><span id="vG${i}" style="font-size:11.5px"></span></div><div id="vM${i}" style="height:330px;border-radius:8px"></div></div>`).join("")}</div>
    <div style="font-size:11.5px;color:var(--mu);margin-bottom:6px">Rojo = estación (anillo y cruz) · círculo punteado = ${RADIO_KM} km · puntos de color = vecinas. Los 3 mapas se mueven juntos. IMERG llega con ~5 h de retraso y existe desde el año 2000. GOES (infrarrojo y color) en NASA GIBS solo guarda los últimos ~90 días: en fechas anteriores esos dos mapas muestran la imagen diaria de MODIS/VIIRS (una pasada por día, no la hora elegida).</div>
    <div id="vOut"></div></div>`;
  crearMapas();
  U().catalogo().then(cat => { const L2 = [...cat.values()].sort((a, b) => a.nombre.localeCompare(b.nombre));
    $("#vLista", el).innerHTML = L2.map(e => `<option value="${esc(e.codigo + " · " + e.nombre)}"></option>`).join("");
    if (ST.cod && cat.get(ST.cod)) $("#vEst", el).value = ST.cod + " · " + cat.get(ST.cod).nombre; if (ST.cod) cargar(); else $("#vOut", el).innerHTML = `<p style="color:var(--mu)">Elija una estación de la lista y una fecha.</p>`; });
  const elegirEst = () => { const m = /^(\d{4,7})/.exec($("#vEst", el).value.trim()); if (m){ ST.cod = m[1]; guardar(); cargar(); } };
  $("#vEst", el).addEventListener("change", elegirEst);
  $("#vDia", el).addEventListener("change", ev => { if (ev.target.value){ ST.dia = ev.target.value; guardar(); cargar(); } });
  $("#vHora", el).addEventListener("change", ev => fijarHora(+ev.target.value));
  $("#vAnt", el).onclick = () => paso(-1); $("#vSig", el).onclick = () => paso(1);
  $("#vAyer", el).onclick = () => { ST.dia = ayer; $("#vDia", el).value = ayer; guardar(); cargar(); };
  $("#vAct", el).onclick = () => { elegirEst(); };
  el.addEventListener("click", ev => { const c = ev.target.closest(".vclick"); if (!c || !D) return; const k = +c.dataset.k;
    if (D.modo === "min") fijarHora(k); else { ST.dia = D.fechas[k]; $("#vDia", el).value = ST.dia; guardar(); cargar(); } });
}
function fijarHora(h){ ST.hora = ((h % 24) + 24) % 24; const s = $("#vHora", EL); if (s) s.value = ST.hora; guardar(); actualizarMapas(); pintar(); }
function paso(d){ let h = ST.hora + d; if (h < 0 || h > 23){ ST.dia = new Date(ms(ST.dia, 12) + (h < 0 ? -1 : 1) * 864e5).toISOString().slice(0, 10); const s = $("#vDia", EL); if (s) s.value = ST.dia; guardar(); ST.hora = (h + 24) % 24; const sh = $("#vHora", EL); if (sh) sh.value = ST.hora; cargar(); return; } fijarHora(h); }
function fijar(cod, dia, hora){ if (cod) ST.cod = String(cod); if (dia) ST.dia = dia; if (Number.isFinite(hora)) ST.hora = hora; guardar(); }
window.VERIF = {pagina, fijar};
})();
