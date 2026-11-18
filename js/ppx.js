/* Subopciones «Series» y «Sensores» de Precipitación.
   Series (etapa 2): faltantes de agua caída minutaria. Sensores (etapa 3): comportamiento del pluviómetro (pegado, cero sostenido, goteo); pantalla informativa, sin botones de revisión. */
(function(){
/* ---------- Series: faltantes de agua caída minutaria (rr1m) ---------- */
const RAW = "https://raw.githubusercontent.com/orlalv/metotec/datos/ema/";
const MIN_HUECO = 30;                                  // minutos seguidos sin dato para avisar
const conTiempo = async (u, ms = 20000) => { const c = new AbortController(), t = setTimeout(() => c.abort(), ms); try { return await fetch(u, {signal: c.signal}); } finally { clearTimeout(t); } };
const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;"}[c]));
const HORAS = [[6, "últimas 6 h"], [24, "últimas 24 h"], [72, "últimos 3 días"]];
let PPX_ERR = ""; const DG = {ok: 0, nf: 0, api: 0, raw: 0, ult: ""};                  // diagnóstico de lectura: horas leídas / sin archivo / errores por ruta
const dgTxt = () => `leídas ${DG.ok} · sin archivo ${DG.nf} · fallos de /api/emahora ${DG.api} · de GitHub ${DG.raw}${DG.ult ? " · último error: " + esc(DG.ult) : ""}`;
let venH = (() => { try { return +localStorage.getItem("qcPpSerH") || 24; } catch (e) { return 24; } })(), soloAb = false, RES = null, TOK = 0, CACHE = new Map(), EST = null;
const hh = t => new Date(t).toISOString().slice(11, 16);
const loc = t => new Date(t).toLocaleTimeString("es-CL", {timeZone: "America/Santiago", hour: "2-digit", minute: "2-digit"});
const dd = t => new Date(t).toISOString().slice(0, 10);
const dur = m => m >= 1440 ? (Math.floor(m / 60 / 24) + " d " + Math.floor(m / 60 % 24) + " h") : m >= 60 ? (Math.floor(m / 60) + " h " + (m % 60 ? m % 60 + " min" : "")).trim() : m + " min";

async function hora(t){                                // un archivo horario (todas las estaciones); null si no existe aún
  const k = new Date(t).toISOString().slice(0, 13);
  if (CACHE.has(k) && CACHE.get(k).vence > Date.now()) return CACHE.get(k).p;
  const url = RAW + k.replace(/-/g, "/").replace("T", "/") + ".csv.gz";
  const p = (async () => {
    for (let i = 0; i < 3; i++){
      try { let r = null; try { r = await conTiempo("/api/emahora?h=" + k + (i ? "&r=" + i : "")); if (!r.ok && r.status !== 404){ DG.api++; DG.ult = "/api/emahora HTTP " + r.status; r = null; } } catch (e) { DG.api++; DG.ult = "/api/emahora " + (e.name === "AbortError" ? "sin respuesta en 20 s" : e.message); r = null; }       // mismo dominio primero (algunas redes bloquean raw.githubusercontent.com)
        if (!r){ try { r = await conTiempo(url + (i ? "?r=" + i : ""), 12000); } catch (e) { DG.raw++; DG.ult = "GitHub " + (e.name === "AbortError" ? "sin respuesta en 12 s" : e.message); throw e; } }
        if (r.status === 404){ DG.nf++; return null; }
        if (r.ok){ const b = await r.arrayBuffer(); const tx = await new Response(new Blob([b]).stream().pipeThrough(new DecompressionStream("gzip"))).text(); DG.ok++; return tx; }
        DG.raw++; DG.ult = "HTTP " + r.status;
      } catch (e) { PPX_ERR = e && e.message || String(e); }
      await new Promise(z => setTimeout(z, 700 * (i + 1)));
    }
    return undefined;                                   // no se pudo leer (distinto de «no existe»)
  })();
  CACHE.set(k, {p, vence: Date.now() + 5 * 60e3});
  return p;
}
async function varias(ts, par = 6){                    // descarga con pocas conexiones a la vez
  const out = new Array(ts.length); let i = 0;
  await Promise.all(Array.from({length: par}, async () => { while (i < ts.length){ const j = i++; out[j] = await hora(ts[j]); } }));
  return out;
}
/* Rellenos guardados en «Relleno de series» (registro de correcciones, KV qc/correcciones): {cod -> [[desde ms, hasta ms], …]} solo de agua caída (rr1m) */
let REL = null;
async function rellenos(){
  if (REL && Date.now() - REL.t < 60e3) return REL;
  const out = {t: Date.now(), por: new Map(), sinClave: false, error: ""};
  let clave = ""; try { clave = sessionStorage.getItem("qcClave") || ""; } catch (e) {}
  if (!clave) out.sinClave = true;
  else { try {
    const c = new AbortController(), t = setTimeout(() => c.abort(), 15000);
    const r = await fetch("/api/correcciones", {headers: {"x-clave": clave}, cache: "no-store", signal: c.signal}); clearTimeout(t);
    if (!r.ok) out.error = "registro de correcciones HTTP " + r.status;
    else { const C = await r.json(); Object.values(C).forEach(x => { if (x.estado !== "rellenado" || x.var !== "rr1m") return;
      const a = Date.parse(x.momento.replace(" ", "T") + ":00Z"), b = Date.parse((x.hasta || x.momento).replace(" ", "T") + ":00Z"); if (!isFinite(a) || !isFinite(b)) return;
      if (!out.por.has(x.cod)) out.por.set(x.cod, []); out.por.get(x.cod).push([a, b]); }); }
  } catch (e) { out.error = "registro de correcciones: " + (e.name === "AbortError" ? "sin respuesta" : e.message); } }
  return REL = out;
}
async function catalogo(){
  if (EST) return EST;
  for (const u of ["/api/minutarios?estaciones=1", "/api/datosraw?p=estaciones.json"]){
    try { const j = await (await conTiempo(u, 10000)).json(); const L = Array.isArray(j) ? j : j.estaciones || []; if (L.length){ EST = new Map(L.map(e => [String(e.codigo), e])); return EST; } } catch (e) {}
  }
  return new Map();                                       // sin catálogo: no se guarda, se reintenta la próxima vez
}

/* Lee la ventana y arma, por estación, los huecos de rr1m. Un «hueco del archivo» (ninguna estación tiene fila ese minuto) no se culpa a la estación. */
async function analizar(H){
  const ahora = Date.now(), h0 = Math.floor(ahora / 3600e3) * 3600e3, ts = [];
  for (let i = H - 1; i >= 0; i--) ts.push(h0 - i * 3600e3);
  const [txt, pistas, rel] = await Promise.all([varias(ts), muestras(h0), rellenos()]);
  const t0 = ts[0], N = H * 60, fila = new Map(), rr = new Map(), glob = new Uint16Array(N);
  let fin = -1, fallas = 0;
  txt.forEach((tx, h) => {
    if (tx === undefined){ if (ts[h] < ahora - 3600e3) fallas++; return; }
    if (!tx) return;
    const ls = tx.split("\n"), c = ls[0].split(","), iR = c.indexOf("rr1m"); if (iR < 0) return;
    for (let i = 1; i < ls.length; i++){
      const l = ls[i]; if (l.length < 20) continue;
      const v = l.split(","), t = Date.parse(v[1].replace(" ", "T") + "Z"), m = Math.round((t - t0) / 60e3);
      if (m < 0 || m >= N) continue;
      let a = fila.get(v[0]); if (!a){ a = new Uint8Array(N); fila.set(v[0], a); }
      a[m] = 1; glob[m]++; if (m > fin) fin = m;
      if (v[iR] !== ""){ let b = rr.get(v[0]); if (!b){ b = new Uint8Array(N); rr.set(v[0], b); } b[m] = 1; }
    }
  });
  const cat = await catalogo(), universo = new Set([...rr.keys(), ...pistas]);   // con pluviómetro: informó agua caída en la ventana o en las muestras de los últimos 7 días
  const lista = [];
  for (const cod of universo){
    const a = fila.get(cod), b = rr.get(cod), fr = rel.por.get(cod), llenos = new Uint8Array(N);
    (fr || []).forEach(([x, y]) => { for (let m = Math.max(0, Math.round((x - t0) / 60e3)); m <= Math.min(N - 1, Math.round((y - t0) / 60e3)); m++) llenos[m] = 1; });
    const tramos = ok => { const out = []; let ini = -1;                          // tramos de minutos «sin dato» según el criterio ok(m); minuto sin ninguna fila en el archivo no cuenta
      for (let m = 0; m <= fin; m++){ const bien = !glob[m] || (b && b[m]) || ok(m); if (!bien){ if (ini < 0) ini = m; } else if (ini >= 0){ out.push([ini, m - 1]); ini = -1; } }
      if (ini >= 0) out.push([ini, fin]); return out.filter(g => g[1] - g[0] + 1 >= MIN_HUECO); };
    const orig = tramos(() => false); if (!orig.length) continue;
    const pend = tramos(m => llenos[m]), pendiente = pend.length > 0, grandes = pendiente ? pend : orig;
    let rell = 0; orig.forEach(g => { for (let m = g[0]; m <= g[1]; m++) if (llenos[m]) rell++; });
    const abierto = grandes[grandes.length - 1][1] === fin && pendiente;
    const ug = grandes[grandes.length - 1], sinFila = (() => { for (let m = ug[0]; m <= ug[1]; m++) if (a && a[m]) return false; return true; })();
    const e = cat.get(cod) || {};
    lista.push({cod, nombre: e.nombre || cod, huecos: grandes.map(g => ({a: t0 + g[0] * 60e3, b: t0 + g[1] * 60e3, n: g[1] - g[0] + 1})), pendiente, rell,
      falta: grandes.reduce((s, g) => s + g[1] - g[0] + 1, 0), abierto, todo: !b, sinFila, ultimo: b ? ult(b, fin, t0) : null});
  }
  lista.sort((x, y) => (y.pendiente - x.pendiente) || (y.abierto - x.abierto) || (y.huecos[y.huecos.length - 1].n - x.huecos[x.huecos.length - 1].n) || x.cod.localeCompare(y.cod));
  return {H, t0, fin: fin >= 0 ? t0 + fin * 60e3 : null, lista, total: universo.size, fallas, tFin: Date.now(), rel: {sinClave: rel.sinClave, error: rel.error}};
}
function ult(b, fin, t0){ for (let m = fin; m >= 0; m--) if (b[m]) return t0 + m * 60e3; return null; }
/* una hora al día, de los 6 días anteriores a la ventana: sirve para saber qué estaciones tienen pluviómetro aunque hoy no informen nada */
async function muestras(h0){
  const ts = []; for (let d = 1; d <= 7; d++) ts.push(h0 - d * 86400e3);
  const out = new Set(), txt = await varias(ts, 4);
  txt.forEach(tx => { if (!tx) return; const ls = tx.split("\n"), iR = ls[0].split(",").indexOf("rr1m"); if (iR < 0) return;
    for (let i = 1; i < ls.length; i++){ const l = ls[i]; if (l.length < 20) continue; const v = l.split(","); if (v[iR] !== "") out.add(v[0]); } });
  return out;
}

function cuenta(r){ return r ? r.lista.filter(x => x.pendiente).length : 0; }
const progreso = (el, tok, T) => { const iv = setInterval(() => { const o = el.querySelector("#ppsOut"); if (tok !== T() || !o || !o.querySelector("[data-leyendo]")){ clearInterval(iv); return; } o.querySelector("[data-leyendo]").innerHTML = " " + dgTxt(); }, 700); };
async function cargar(el){
  const tok = ++TOK; Object.assign(DG, {ok: 0, nf: 0, api: 0, raw: 0, ult: ""}); progreso(el, tok, () => TOK);
  el.querySelector("#ppsOut").innerHTML = `<p style="color:var(--mu)">Leyendo ${venH <= 24 ? venH + " horas" : Math.round(venH / 24) + " días"} de datos minutarios…<small data-leyendo style="display:block"></small></p>`;
  try { const r = await analizar(venH); if (tok !== TOK) return; RES = r; if (window.ppContar) window.ppContar("series", cuenta(r)); dibujar(el); }
  catch (e) { if (tok === TOK) el.querySelector("#ppsOut").innerHTML = `<p style="color:#e5534b">No pude leer los datos (${esc(e.message)}). Pruebe de nuevo.</p>`; }
}
function dibujar(el){
  const r = RES, out = el.querySelector("#ppsOut"); if (!r) return;
  if (r.fin == null){ out.innerHTML = `<p style="color:var(--mu)">No hay datos minutarios en el archivo para esta ventana.</p>`; return; }
  const pen = r.lista.filter(x => x.pendiente), nRel = r.lista.length - pen.length, L = r.lista.filter(x => !soloAb || x.abierto), ab = r.lista.filter(x => x.abierto).length;
  const fila = x => { const u = x.huecos[x.huecos.length - 1], hs = x.huecos.slice(-3).map(g => `${hh(g.a)}–${hh(g.b)} (${dur(g.n)})`).join(" · ") + (x.huecos.length > 3 ? ` · +${x.huecos.length - 3} antes` : "");
    return `<tr><td><b>${esc(x.cod)}</b> · ${esc(x.nombre)}</td>
      <td>${!x.pendiente ? `<span style="color:#3fb950;font-weight:700">rellenado (guardado)</span><br><small style="color:var(--mu)">${dur(x.rell)} guardados en el registro de correcciones</small>` : x.abierto ? `<span style="color:#e5534b;font-weight:700">sin dato ahora</span>` : `<span style="color:#e7b03b;font-weight:700">se recuperó</span>`}${x.pendiente && x.rell ? `<br><small style="color:#3fb950">${dur(x.rell)} ya rellenados y guardados</small>` : ""}${x.todo ? `<br><small style="color:var(--mu)">no informó agua caída en toda la ventana</small>` : x.sinFila ? `<br><small style="color:var(--mu)">la estación no envió nada</small>` : `<br><small style="color:var(--mu)">solo falta la lluvia</small>`}</td>
      <td style="white-space:nowrap">${dd(u.a).slice(5).split("-").reverse().join("/")} ${hh(u.a)} UTC<br><small style="color:var(--mu)">${loc(u.a)} hora local</small></td>
      <td style="text-align:right"><b>${dur(x.falta)}</b><br><small style="color:var(--mu)">${x.pendiente ? "" : "eran "}${x.huecos.length} ${x.huecos.length === 1 ? "hueco" : "huecos"}</small></td>
      <td style="font-size:12px;color:var(--mu)">${hs}</td>
      <td><button class="ppsAbrir" data-c="${esc(x.cod)}" data-d="${dd(u.a)}" title="Abre «Relleno de series» en esta estación y día">Abrir en Relleno</button></td></tr>`; };
  out.innerHTML = `<p style="margin:2px 0 8px;color:var(--mu);font-size:12.5px">${r.lista.length ? `<b style="color:var(--tx)">${pen.length}</b> de ${r.total} estaciones con pluviómetro tienen huecos de ${MIN_HUECO} min o más por rellenar (${ab} siguen sin dato)${nRel ? `; <b style="color:#3fb950">${nRel} ya rellenadas y guardadas</b>` : ""}.` : `Ninguna de las ${r.total} estaciones con pluviómetro tiene huecos de ${MIN_HUECO} min o más.`} Datos hasta ${hh(r.fin)} UTC (${loc(r.fin)} hora local).${r.rel && r.rel.sinClave ? ` <b style="color:#e7b03b">Sin clave: no se pueden mostrar los rellenos guardados.</b>` : r.rel && r.rel.error ? ` <b style="color:#e7b03b">No pude leer los rellenos guardados (${esc(r.rel.error)}).</b>` : ""}${r.fallas ? ` <b style="color:#e7b03b">No se pudieron leer ${r.fallas} horas del archivo${" (" + dgTxt() + ")"}; los resultados pueden estar incompletos.</b>` : ""}</p>
    ${L.length ? `<div style="overflow-x:auto"><table class="tb"><tr><th>Estación</th><th>Estado</th><th>Último hueco desde</th><th>Falta</th><th>Huecos (hora UTC)</th><th></th></tr>${L.map(fila).join("")}</table></div>` : `<p style="color:var(--mu)">Nada que mostrar con este filtro.</p>`}`;
}
function serie(el){
  el.innerHTML = `<div class="ppx ppser"><h3>Series <small style="color:var(--mu);font-weight:400">· agua caída minutaria que falta</small></h3>
    <div class="htools"><select id="ppsH">${HORAS.map(([h, t]) => `<option value="${h}"${h === venH ? " selected" : ""}>${t}</option>`).join("")}</select>
      <label><input type="checkbox" id="ppsAb"${soloAb ? " checked" : ""}> solo los que siguen sin dato</label><button id="ppsAct">Actualizar</button></div>
    <div id="ppsOut"></div></div>`;
  el.querySelector("#ppsH").onchange = ev => { venH = +ev.target.value; try { localStorage.setItem("qcPpSerH", venH); } catch (e) {} cargar(el); };
  el.querySelector("#ppsAb").onchange = ev => { soloAb = ev.target.checked; dibujar(el); };
  el.querySelector("#ppsAct").onclick = () => { CACHE.clear(); cargar(el); };
  el.onclick = ev => { const b = ev.target.closest(".ppsAbrir"); if (b && window.ppAbrirRelleno) window.ppAbrirRelleno(b.dataset.c, b.dataset.d); };
  if (RES && RES.H === venH && Date.now() - RES.tFin < 5 * 60e3) dibujar(el); else cargar(el);
}
function contar(){                                      // para el contador de la barra sin abrir la pantalla
  if (RES && Date.now() - RES.tFin < 5 * 60e3) return window.ppContar && window.ppContar("series", cuenta(RES));
  analizar(venH).then(r => { RES = r; window.ppContar && window.ppContar("series", cuenta(r)); }).catch(() => {});
}

/* ---------- Sensores: comportamiento del pluviómetro (informativo) ---------- */
const SEN = {pegMin: 20, peg01: 60, ceroH: 3, ceroVec: 1.0, goteoH: 12, vecKm: 60, vecMin: 2, horaMin: 30};  // minutos/horas seguidos y mm por hora
const SENH = [[24, "últimas 24 h"], [72, "últimos 3 días"]];
let senH = (() => { try { return +localStorage.getItem("qcPpSenH") || 24; } catch (e) { return 24; } })(), SRES = null, STOK = 0;
const km = (a, b) => { const r = Math.PI / 180, dl = (b.lat - a.lat) * r, dn = (b.lon - a.lon) * r, x = Math.sin(dl / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dn / 2) ** 2; return 12742 * Math.asin(Math.sqrt(x)); };
const f1 = x => (Math.round(x * 10) / 10).toLocaleString("es-CL");

async function analizarSens(H){
  const h0 = Math.floor(Date.now() / 3600e3) * 3600e3, ts = []; for (let i = H - 1; i >= 0; i--) ts.push(h0 - i * 3600e3);
  const [txt, cat] = await Promise.all([varias(ts), catalogo()]);
  const t0 = ts[0], N = H * 60, rr = new Map(); let fallas = 0, fin = -1;
  txt.forEach((tx, h) => {
    if (tx === undefined){ if (ts[h] < Date.now() - 3600e3) fallas++; return; }
    if (!tx) return;
    const ls = tx.split("\n"), iR = ls[0].split(",").indexOf("rr1m"); if (iR < 0) return;
    for (let i = 1; i < ls.length; i++){
      const l = ls[i]; if (l.length < 20) continue;
      const v = l.split(","); if (v[iR] === "") continue;
      const m = Math.round((Date.parse(v[1].replace(" ", "T") + "Z") - t0) / 60e3); if (m < 0 || m >= N) continue;
      let a = rr.get(v[0]); if (!a){ a = new Float32Array(N).fill(NaN); rr.set(v[0], a); }
      a[m] = +v[iR]; if (m > fin) fin = m;
    }
  });
  const sum = new Map(), con = new Map();                       // suma por hora y si la hora tiene dato suficiente
  for (const [c, a] of rr){ const s = new Float32Array(H), k = new Uint8Array(H);
    for (let m = 0; m < N; m++) if (a[m] === a[m]){ s[m / 60 | 0] += a[m]; k[m / 60 | 0]++; }
    sum.set(c, s); con.set(c, Array.from(k, x => x >= SEN.horaMin)); }
  const pos = c => { const e = cat.get(c); return e && isFinite(e.lat) && isFinite(e.lon) ? {lat: +e.lat, lon: +e.lon} : null; };
  const vecs = new Map(); for (const c of rr.keys()){ const p = pos(c); if (!p) continue;
    vecs.set(c, [...rr.keys()].filter(o => o !== c && pos(o)).map(o => [o, km(p, pos(o))]).filter(x => x[1] <= SEN.vecKm).sort((x, y) => x[1] - y[1]).slice(0, 6)); }
  const lista = [], nom = c => (cat.get(c) || {}).nombre || c;
  const horas = (c, fn) => { const out = []; let ini = -1; const s = sum.get(c), k = con.get(c);       // tramos de horas seguidas donde fn(h) es cierto
    for (let h = 0; h <= H; h++){ const ok = h < H && k[h] && fn(h); if (ok && ini < 0) ini = h; else if (!ok && ini >= 0){ out.push([ini, h - 1]); ini = -1; } } return out; };
  const vh = (c, h) => (vecs.get(c) || []).filter(([o]) => con.get(o)[h]);
  for (const [c, a] of rr){
    const e = {cod: c, nombre: nom(c), hallazgos: []};
    // 1) pegado: mismo valor positivo repetido minuto a minuto
    const cerrar = (i, f) => { const n = f - i + 1, v = a[i], min = v > 0.15 ? SEN.pegMin : SEN.peg01;
      if (n >= min) e.hallazgos.push({k: "peg", a: t0 + i * 60e3, b: t0 + f * 60e3, n, det: `${f1(v)} mm cada minuto durante ${dur(n)} (${f1(v * n)} mm acumulados)`, abierto: f >= fin - 1}); };
    for (let m = 0, i = 0; m < N; m++){
      if (!(a[m] > 0)) continue;
      i = m; while (m + 1 < N && a[m + 1] === a[i]) m++;
      cerrar(i, m);
    }
    // 2) cero sostenido con vecinas lloviendo
    for (const [i, f] of horas(c, h => sum.get(c)[h] < 0.05 && vh(c, h).filter(([o]) => sum.get(o)[h] >= SEN.ceroVec).length >= SEN.vecMin)){
      if (f - i + 1 < SEN.ceroH) continue;
      const vs = vh(c, f).filter(([o]) => sum.get(o)[f] >= SEN.ceroVec).slice(0, 3);
      let tot = {}; vs.forEach(([o]) => { let t = 0; for (let h = i; h <= f; h++) t += sum.get(o)[h]; tot[o] = t; });
      e.hallazgos.push({k: "cero", a: t0 + i * 3600e3, b: t0 + (f + 1) * 3600e3, n: (f - i + 1) * 60, det: `0 mm durante ${f - i + 1} h; vecinas: ` + vs.map(([o, d]) => `${nom(o)} (${Math.round(d)} km) ${f1(tot[o])} mm`).join(" · "), abierto: f === H - 1}); }
    // 3) goteo: 0,1–0,4 mm por hora con vecinas secas
    for (const [i, f] of horas(c, h => sum.get(c)[h] >= 0.1 && sum.get(c)[h] <= 0.4 && vh(c, h).length >= SEN.vecMin && vh(c, h).every(([o]) => sum.get(o)[h] < 0.05))){
      if (f - i + 1 < SEN.goteoH) continue; let t = 0; for (let h = i; h <= f; h++) t += sum.get(c)[h];
      e.hallazgos.push({k: "gota", a: t0 + i * 3600e3, b: t0 + (f + 1) * 3600e3, n: (f - i + 1) * 60, det: `${f1(t)} mm en ${f - i + 1} h (0,1–0,4 mm por hora) con las vecinas cercanas secas`, abierto: f === H - 1}); }
    if (e.hallazgos.length){                                       // un mismo tipo repetido: se muestran los 2 más largos y cuántos más hubo
      const por = {}; e.hallazgos.forEach(h => (por[h.k] = por[h.k] || []).push(h));
      e.hallazgos = Object.values(por).flatMap(L => { L.sort((x, y) => y.n - x.n); const top = L.slice(0, 2); if (L.length > 2) top[1] = {...top[1], det: top[1].det + ` · y ${L.length - 2} episodios más parecidos`}; return top; })
        .sort((x, y) => x.a - y.a);
      lista.push(e);
    }
  }
  lista.sort((x, y) => (y.hallazgos.some(h => h.abierto) - x.hallazgos.some(h => h.abierto)) || x.cod.localeCompare(y.cod));
  return {H, t0, fin: fin >= 0 ? t0 + fin * 60e3 : null, lista, total: rr.size, fallas, tFin: Date.now()};
}
const SK = {peg: "Valor pegado", cero: "Cero con vecinas lloviendo", gota: "Goteo sin lluvia alrededor"};
function dibujarSens(el){
  const r = SRES, out = el.querySelector("#ppsOut"); if (!r) return;
  if (r.fin == null){ out.innerHTML = `<p style="color:var(--mu)">No hay datos minutarios en el archivo para esta ventana.</p>`; return; }
  const fila = x => x.hallazgos.map((h, i) => `<tr>${i ? "" : `<td rowspan="${x.hallazgos.length}"><b>${esc(x.cod)}</b> · ${esc(x.nombre)}</td>`}
    <td><b>${SK[h.k]}</b>${h.abierto ? `<br><small style="color:#e5534b">sigue ahora</small>` : ""}</td>
    <td style="white-space:nowrap">${dd(h.a).slice(5).split("-").reverse().join("/")} ${hh(h.a)}–${hh(h.b)} UTC<br><small style="color:var(--mu)">${loc(h.a)}–${loc(h.b)} hora local</small></td>
    <td style="font-size:12.5px">${esc(h.det)}</td></tr>`).join("");
  out.innerHTML = `<p style="margin:2px 0 8px;color:var(--mu);font-size:12.5px">${r.lista.length ? `<b style="color:var(--tx)">${r.lista.length}</b> de ${r.total} estaciones con pluviómetro muestran un comportamiento sospechoso.` : `Ninguna de las ${r.total} estaciones con pluviómetro muestra un comportamiento sospechoso.`} Datos hasta ${hh(r.fin)} UTC (${loc(r.fin)} hora local). Pantalla informativa: solo señala; si llovió o no se juzga en «Precipitación binaria».${r.fallas ? ` <b style="color:#e7b03b">No se pudieron leer ${r.fallas} horas del archivo${" (" + dgTxt() + ")"}; los resultados pueden estar incompletos.</b>` : ""}</p>
    ${r.lista.length ? `<div style="overflow-x:auto"><table class="tb"><tr><th>Estación</th><th>Comportamiento</th><th>Cuándo</th><th>Detalle</th></tr>${r.lista.map(fila).join("")}</table></div>` : ""}
    <details style="margin-top:10px;font-size:12.5px;color:var(--mu)"><summary>Cómo se decide</summary><ul style="margin:6px 0 0 18px">
      <li><b>Valor pegado:</b> el mismo valor mayor que 0 en cada minuto durante ${SEN.pegMin} min o más (${SEN.peg01} min si es 0,1 mm).</li>
      <li><b>Cero con vecinas lloviendo:</b> ${SEN.ceroH} h seguidas o más con 0 mm mientras al menos ${SEN.vecMin} vecinas (≤ ${SEN.vecKm} km) marcan ${SEN.ceroVec} mm o más cada hora.</li>
      <li><b>Goteo:</b> ${SEN.goteoH} h seguidas o más con 0,1–0,4 mm por hora mientras al menos ${SEN.vecMin} vecinas (≤ ${SEN.vecKm} km) marcan 0. Solo se puede ver con ventana de 24 h o más.</li>
      <li>Las estaciones sin vecinas cercanas con dato solo se revisan por valor pegado. Las que informan cada 10 min o más no alcanzan a mostrar un valor pegado minuto a minuto.</li></ul></details>`;
}
async function cargarSens(el){
  const tok = ++STOK; Object.assign(DG, {ok: 0, nf: 0, api: 0, raw: 0, ult: ""}); progreso(el, tok, () => STOK); el.querySelector("#ppsOut").innerHTML = `<p style="color:var(--mu)">Leyendo ${senH <= 24 ? senH + " horas" : Math.round(senH / 24) + " días"} de datos minutarios…<small data-leyendo style="display:block"></small></p>`;
  try { const r = await analizarSens(senH); if (tok !== STOK) return; SRES = r; if (window.ppContar) window.ppContar("sensores", r.lista.length); dibujarSens(el); }
  catch (e) { if (tok === STOK) el.querySelector("#ppsOut").innerHTML = `<p style="color:#e5534b">No pude leer los datos (${esc(e.message)}). Pruebe de nuevo.</p>`; }
}
function sensores(el){
  el.innerHTML = `<div class="ppx ppser"><h3>Sensores <small style="color:var(--mu);font-weight:400">· comportamiento del pluviómetro</small></h3>
    <div class="htools"><select id="ppsH">${SENH.map(([h, t]) => `<option value="${h}"${h === senH ? " selected" : ""}>${t}</option>`).join("")}</select><button id="ppsAct">Actualizar</button></div>
    <div id="ppsOut"></div></div>`;
  el.querySelector("#ppsH").onchange = ev => { senH = +ev.target.value; try { localStorage.setItem("qcPpSenH", senH); } catch (e) {} cargarSens(el); };
  el.querySelector("#ppsAct").onclick = () => { CACHE.clear(); cargarSens(el); };
  el.onclick = null;
  if (SRES && SRES.H === senH && Date.now() - SRES.tFin < 5 * 60e3) dibujarSens(el); else cargarSens(el);
}
function contarSens(){
  if (SRES && Date.now() - SRES.tFin < 5 * 60e3) return window.ppContar && window.ppContar("sensores", SRES.lista.length);
  analizarSens(senH).then(r => { SRES = r; window.ppContar && window.ppContar("sensores", r.lista.length); }).catch(() => {});
}
function pagina(el, sub){
  if (sub === "verificar") return window.VERIF ? window.VERIF.pagina(el) : (el.innerHTML = `<div class="ppx"><p style="color:var(--mu)">Cargando…</p></div>`);
  if (sub === "sensores") return sensores(el);
  return serie(el);
}
window.PPX = {util: {varias, catalogo, catalogoSync: () => EST, conTiempo, dg: dgTxt}, pagina, contar: k => { if (k !== "sensores") contar(); if (k !== "series") contarSens(); }};
})();
