/* Pestaña «Agro» (prueba, etapa 1): top 10 de Tmax y Tmin de la red en el periodo jueves 00:00 – miércoles 23:59 (hora local de Chile),
   solo con datos minutarios del archivo de METOTEC. Clic en una fila: serie de 10 días de la estación junto a sus vecinas.
   Por ahora SIN precipitación, SIN mapa, SIN exportar y SIN aplicar el registro de correcciones. Informativa: no guarda nada. */
(function(){
const TZ = "America/Santiago", RAW = "https://raw.githubusercontent.com/orlalv/metotec/datos/ema/";
const DIAS_SERIE = 10, SPIKE = 3, GRAD = 6.5, VEC_KM = 100, VEC_N = 4, RANGO = [-60, 60];   // °C, °C/km
const $ = s => document.querySelector(s), esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;"}[c]));
const f1 = v => v == null || !isFinite(v) ? "—" : (Math.round(v * 10) / 10).toFixed(1);

/* ---------- hora local de Chile <-> UTC ---------- */
const FMT = new Intl.DateTimeFormat("en-CA", {timeZone: TZ, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit"});
function partes(t){ const o = {}; FMT.formatToParts(new Date(t)).forEach(p => o[p.type] = +p.value); return o; }
const desfase = t => { const p = partes(t); return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute) - Math.floor(t / 60e3) * 60e3; };   // ms: hora local − UTC
function localAUtc(y, m, d, h = 0, mi = 0){ const g = Date.UTC(y, m - 1, d, h, mi); return g - desfase(g - desfase(g)); }
const locTxt = t => new Date(t).toLocaleString("es-CL", {timeZone: TZ, weekday: "short", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false});
const fechaIso = p => `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
function jueves(ms){ const p = partes(ms), d = new Date(Date.UTC(p.year, p.month - 1, p.day)); d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 3) % 7)); return d; }   // jueves de esa semana (≤ hoy)
function dia0(iso, k, modo){ const [y, m, d] = iso.split("-").map(Number); return modo === "utc" ? Date.UTC(y, m - 1, d + k) : localAUtc(y, m, d + k); }   // inicio (UTC) del día k del periodo
function periodo(iso, modo){ return {t0: dia0(iso, 0, modo), t1: dia0(iso, 7, modo), dias: Array.from({length: 8}, (_, k) => dia0(iso, k, modo))}; }
function ultimoJueves(modo){ const ahora = Date.now(); let d = jueves(ahora);
  for (let i = 0; i < 3; i++){ if (periodo(d.toISOString().slice(0, 10), modo).t1 <= ahora) break; d = new Date(d.getTime() - 7 * 86400e3); }
  return d.toISOString().slice(0, 10); }

/* ---------- lectura de los archivos horarios ---------- */
const CACHE = new Map(); let DG = {ok: 0, nf: 0, err: 0, ult: ""};
const conTiempo = async (u, ms = 20000) => { const c = new AbortController(), t = setTimeout(() => c.abort(), ms); try { return await fetch(u, {signal: c.signal}); } finally { clearTimeout(t); } };
async function hora(t){
  const k = new Date(t).toISOString().slice(0, 13);
  if (CACHE.has(k)) return CACHE.get(k);
  const url = RAW + k.replace(/-/g, "/").replace("T", "/") + ".csv.gz";
  const p = (async () => {
    for (let i = 0; i < 3; i++){
      try { let r = null;
        try { r = await conTiempo("/api/emahora?h=" + k + (i ? "&r=" + i : "")); if (!r.ok && r.status !== 404) r = null; } catch (e) { r = null; }
        if (!r) r = await conTiempo(url + (i ? "?r=" + i : ""), 12000);
        if (r.status === 404){ DG.nf++; return null; }
        if (r.ok){ const b = await r.arrayBuffer(); const tx = await new Response(new Blob([b]).stream().pipeThrough(new DecompressionStream("gzip"))).text(); DG.ok++; return tx; }
        DG.ult = "HTTP " + r.status;
      } catch (e) { DG.ult = e.name === "AbortError" ? "sin respuesta" : e.message; }
      await new Promise(z => setTimeout(z, 700 * (i + 1)));
    }
    DG.err++; return undefined;
  })();
  CACHE.set(k, p); p.then(v => { if (v === undefined) CACHE.delete(k); });
  return p;
}
async function varias(ts, par, avance){ const out = new Array(ts.length); let i = 0, n = 0;
  await Promise.all(Array.from({length: par}, async () => { while (i < ts.length){ const j = i++; out[j] = await hora(ts[j]); avance && avance(++n, ts.length); } }));
  return out; }

/* Estado de la corrida: B0 = inicio de la serie (10 días antes de t1); T[cod] = Float32Array(NT) con NaN donde no hay dato */
let S = null, EST = new Map(), TOK = 0;
function volcar(S, tx, t){
  if (!tx) return;
  const ls = tx.split("\n"), cab = ls[0].split(","), iT = cab.indexOf("T"), iR = cab.indexOf("rr1m"); if (iT < 0) return;
  const hh = new Date(t).getUTCHours(), base = Math.round((t - S.B0) / 60e3);
  for (let i = 1; i < ls.length; i++){
    const l = ls[i]; if (l.length < 20) continue;
    const v = l.split(","), x = parseFloat(v[iT]), y = iR >= 0 ? parseFloat(v[iR]) : NaN; if (!isFinite(x) && !isFinite(y)) continue;
    let m = base + (+v[1].slice(14, 16)); if (+v[1].slice(11, 13) !== hh) m = Math.round((Date.parse(v[1].replace(" ", "T") + "Z") - S.B0) / 60e3);
    if (m < 0 || m >= S.NT) continue;
    if (isFinite(x)){ let a = S.T.get(v[0]); if (!a){ a = new Float32Array(S.NT).fill(NaN); S.T.set(v[0], a); } a[m] = x; }
    if (isFinite(y)){ let b = S.R.get(v[0]); if (!b){ b = new Float32Array(S.NT).fill(NaN); S.R.set(v[0], b); } b[m] = y; }
  }
}
async function cargar(ts, avance){ const txt = await varias(ts, 6, avance); txt.forEach((tx, i) => volcar(S, tx, ts[i])); return txt.filter(x => x === undefined).length; }

/* ---------- análisis: extremos, completitud, vecinas ---------- */
function esPico(a, m, lo, hi){          // se aparta más de SPIKE °C de la mediana de hasta 5 minutos válidos a cada lado
  const v = []; for (let k = Math.max(lo, m - 5); k <= Math.min(hi, m + 5); k++) if (k !== m && isFinite(a[k])) v.push(a[k]);
  if (v.length < 3) return false; v.sort((x, y) => x - y); const md = v.length % 2 ? v[(v.length - 1) / 2] : (v[v.length / 2 - 1] + v[v.length / 2]) / 2;
  return Math.abs(a[m] - md) > SPIKE; }
function extremo(a, lo, hi, signo){      // signo +1 = máximo, −1 = mínimo; salta picos aislados y valores fuera de rango
  let picos = 0;
  for (let it = 0; it < 30; it++){
    let mejor = -1, bv = -Infinity;
    for (let m = lo; m <= hi; m++){ const x = a[m]; if (!isFinite(x) || x < RANGO[0] || x > RANGO[1]) continue; if (x * signo > bv){ bv = x * signo; mejor = m; } }
    if (mejor < 0) return null;
    if (esPico(a, mejor, lo, hi)){ picos++; a[mejor] = NaN; continue; }
    return {m: mejor, v: a[mejor], picos};
  }
  return null; }
const km = (a, b) => { const R = 6371, r = Math.PI / 180, dl = (b.lat - a.lat) * r, dn = (b.lon - a.lon) * r; const h = Math.sin(dl / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dn / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(h)); };
function vecinas(cod){
  const e = EST.get(cod); if (!e || e.lat == null) return [];
  return [...EST.values()].filter(o => o.codigo !== cod && o.lat != null && S.T.has(o.codigo)).map(o => ({cod: o.codigo, nombre: o.nombre, alt: o.alt, d: km(e, o)}))
    .filter(o => o.d <= VEC_KM).sort((x, y) => x.d - y.d).slice(0, VEC_N); }
function cerca(a, m){ for (let k = 0; k <= 5; k++) for (const s of k ? [-k, k] : [0]){ const x = a[m + s]; if (isFinite(x)) return x; } return NaN; }
function semaforo(cod, r, comp){      // verde / amarillo / rojo con motivo; las vecinas se corrigen por altitud (6,5 °C/km)
  const e = EST.get(cod) || {}, mot = [];
  let n = 0;
  if (comp < 0.5){ n = 2; mot.push(`completitud ${Math.round(comp * 100)} %`); } else if (comp < 0.8){ n = Math.max(n, 1); mot.push(`completitud ${Math.round(comp * 100)} %`); }
  if (r.picos){ n = Math.max(n, 1); mot.push(`${r.picos} pico${r.picos > 1 ? "s" : ""} descartado${r.picos > 1 ? "s" : ""}`); }
  const dev = [];
  (S.vecMemo ? S.vecMemo(cod) : vecinas(cod)).forEach(o => { const x = cerca(S.T.get(o.cod), r.m); if (isFinite(x)){ const alt = (e.alt ?? 0) - (o.alt ?? e.alt ?? 0); dev.push(r.v - (x - GRAD * alt / 1000)); } });
  let d = null;
  if (dev.length >= 2){ dev.sort((x, y) => x - y); d = dev.length % 2 ? dev[(dev.length - 1) / 2] : (dev[dev.length / 2 - 1] + dev[dev.length / 2]) / 2;
    if (Math.abs(d) > 8){ n = 2; mot.push(`${f1(d)} °C vs vecinas`); } else if (Math.abs(d) > 4){ n = Math.max(n, 1); mot.push(`${f1(d)} °C vs vecinas`); } }
  else mot.push("sin vecinas con dato");
  return {n, mot, d, nv: dev.length}; }

const nombreDia = (t, modo) => new Date(t + (modo === "utc" ? 0 : 12 * 3600e3)).toLocaleDateString("es-CL", {timeZone: modo === "utc" ? "UTC" : TZ, weekday: "short", day: "2-digit", month: "2-digit"});
function analizar(){
  const {NT, per} = S, D = per.dias, idx = k => Math.round((D[k] - S.B0) / 60e3), VEC = new Map();
  const vec = c => { if (!VEC.has(c)) VEC.set(c, vecinas(c)); return VEC.get(c); }; S.vecMemo = vec;
  const dias = Array.from({length: 7}, () => ({mx: [], mn: []})), sem = [];
  S.T.forEach((arr, cod) => {
    let nTot = 0, mxS = null, mnS = null; const c1 = arr.slice(), c2 = arr.slice();
    for (let k = 0; k < 7; k++){
      const a = idx(k), b = idx(k + 1) - 1; let n = 0; for (let m = a; m <= b; m++) if (isFinite(arr[m])) n++; nTot += n; if (!n) continue;
      const comp = n / (b - a + 1), mx = extremo(c1, a, b, 1), mn = extremo(c2, a, b, -1);
      if (mx){ const r = {cod, comp, dia: k, ...mx}; dias[k].mx.push(r); if (!mxS || r.v > mxS.v) mxS = r; }
      if (mn){ const r = {cod, comp, dia: k, ...mn}; dias[k].mn.push(r); if (!mnS || r.v < mnS.v) mnS = r; }
    }
    if (nTot) sem.push({cod, comp: nTot / S.N, mx: mxS, mn: mnS});
  });
  S.cand = {tmax: [], tmin: []}; dias.forEach(d => { S.cand.tmax.push(...d.mx); S.cand.tmin.push(...d.mn); });
  Object.values(S.cand).forEach(L => L.forEach(r => { r.sem = semaforo(r.cod, r, r.comp); }));
  S.nEst = sem.length; }

/* ---------- precipitación: ventanas deslizantes de 6 h y 24 h sobre rr1m (mm por minuto) ---------- */
const PP_MAXMIN = 5, PP_VENT = {6: 360, 24: 1440};      // mm en un solo minuto sobre esto = imposible, se descarta
function ventanas(cod, W){                                // por cada minuto final e: suma y minutos con dato de la ventana [e-W+1, e], dentro del periodo
  const a = S.R.get(cod), {i0, NT} = S, P = new Float64Array(NT + 1), C = new Uint32Array(NT + 1); let malos = 0;
  for (let m = 0; m < NT; m++){ let x = a[m]; if (isFinite(x) && x > PP_MAXMIN){ x = NaN; if (m >= i0) malos++; }
    P[m + 1] = P[m] + (isFinite(x) && x > 0 ? x : 0); C[m + 1] = C[m] + (isFinite(x) ? 1 : 0); }
  return {P, C, malos}; }
const sumaVent = (V, e, W) => ({mm: V.P[e + 1] - V.P[e + 1 - W], n: V.C[e + 1] - V.C[e + 1 - W]});
function vecinasPP(cod){ const e = EST.get(cod); if (!e || e.lat == null) return [];
  return [...EST.values()].filter(o => o.codigo !== cod && o.lat != null && S.R.has(o.codigo)).map(o => ({cod: o.codigo, nombre: o.nombre, alt: o.alt, d: km(e, o)})).filter(o => o.d <= VEC_KM).sort((x, y) => x.d - y.d).slice(0, VEC_N); }
function semaforoPP(cod, r, H){          // r.e = minuto final, r.W = ventana en minutos
  const mot = []; let n = 0;
  if (r.comp < 0.5){ n = 2; mot.push(`datos ${Math.round(r.comp * 100)} % de la ventana`); } else if (r.comp < 0.9){ n = 1; mot.push(`datos ${Math.round(r.comp * 100)} % de la ventana`); }
  if (r.malos){ n = Math.max(n, 1); mot.push(`${r.malos} minuto${r.malos > 1 ? "s" : ""} imposible${r.malos > 1 ? "s" : ""} descartado${r.malos > 1 ? "s" : ""}`); }
  const vs = (S.vecPP.get(cod) || (S.vecPP.set(cod, vecinasPP(cod)), S.vecPP.get(cod))).map(o => { const V = (S.vwin.get(o.cod + "|" + r.W) || (S.vwin.set(o.cod + "|" + r.W, ventanas(o.cod, r.W)), S.vwin.get(o.cod + "|" + r.W))), q = sumaVent(V, r.e, r.W); return q.n >= r.W / 2 ? q.mm : null; }).filter(x => x != null).sort((x, y) => x - y);
  let med = null;
  if (vs.length >= 2){ med = vs.length % 2 ? vs[(vs.length - 1) / 2] : (vs[vs.length / 2 - 1] + vs[vs.length / 2]) / 2;
    const umbr = H === 6 ? 15 : 25;
    if (r.v >= umbr && med < 0.5){ n = 2; mot.push(`vecinas ≈ ${f1(med)} mm`); } else if (r.v >= umbr / 2 && med < r.v * 0.2){ n = Math.max(n, 1); mot.push(`vecinas ${f1(med)} mm`); } }
  else mot.push("sin vecinas con pluviómetro");
  return {n, mot, med, nv: vs.length}; }
function analizarPP(){
  const {NT, i0, per} = S, D = per.dias, idx = k => Math.round((D[k] - S.B0) / 60e3); S.vecPP = new Map(); S.vwin = new Map();
  [6, 24].forEach(H => { const W = PP_VENT[H], dias = Array.from({length: 7}, () => []), sem = [];
    S.R.forEach((a, cod) => {
      let tot = 0; for (let m = i0; m < NT; m++) if (isFinite(a[m]) && a[m] > 0 && a[m] <= PP_MAXMIN) tot += a[m]; if (!tot) return;
      const V = (S.vwin.get(cod + "|" + W) || (S.vwin.set(cod + "|" + W, ventanas(cod, W)), S.vwin.get(cod + "|" + W)));
      const mejor = new Array(7).fill(null);
      for (let k = 0; k < 7; k++){ const a0 = Math.max(idx(k), i0 + W - 1), b0 = idx(k + 1) - 1;
        for (let e = a0; e <= b0; e++){ const q = sumaVent(V, e, W); if (q.n < W / 2 || q.mm <= 0) continue; if (!mejor[k] || q.mm > mejor[k].v) mejor[k] = {cod, v: Math.round(q.mm * 10) / 10, e, W, dia: k, comp: q.n / W, malos: V.malos}; } }
      mejor.forEach(r => r && dias[r.dia].push(r));
      const b = mejor.filter(Boolean).sort((x, y) => y.v - x.v)[0]; if (b) sem.push(b);
    });
    dias.forEach(L => L.forEach(r => { r.sem = semaforoPP(r.cod, r, H); })); S.cand["pp" + H] = dias.flat(); });
}

/* ---------- pantalla ---------- */
const COL = ["#2f9e44", "#e8a317", "#d6336c"], NS = ["ok", "dudoso", "malo"];
const VK = [["tmax", "Temperatura máxima", "Tmáx", "°C"], ["tmin", "Temperatura mínima", "Tmín", "°C"], ["pp6", "Precipitación en 6 h", "6 h", "mm"], ["pp24", "Precipitación en 24 h", "24 h", "mm"]];
const clave = () => { try { return sessionStorage.getItem("qcClave") || ""; } catch (e) { return window._qc || ""; } };
const idSac = (vk, r) => `${S.pid}|${vk}|${r.cod}|${r.dia}`;
const hTxt = e => new Date(S.B0 + e * 60e3).toISOString().slice(5, 16).replace("T", " ");
const nom = c => (EST.get(c) || {}).nombre || c;

/* ranking de una variable en la vista actual (semana = top de tops por estación, o un día); no cuenta lo sacado a mano ni lo «malo» */
function vista(vk){
  const V = S.vista, signo = vk === "tmin" ? -1 : 1, ord = (a, b) => signo * (b.v - a.v);
  const L = S.cand[vk].filter(r => V === "sem" || r.dia === V), sac = r => S.sacados[idSac(vk, r)];
  const uniq = A => { A = A.slice().sort(ord); if (V !== "sem") return A; const m = new Map(); A.forEach(r => { if (!m.has(r.cod)) m.set(r.cod, r); }); return [...m.values()]; };
  const vivos = L.filter(r => !sac(r)), top = uniq(vivos.filter(r => r.sem.n < 2)).slice(0, 10), corte = top.length === 10 ? top[9].v : null;
  const antes = r => corte == null || signo * (r.v - corte) >= 0;
  return {top, desc: uniq(vivos.filter(r => r.sem.n === 2)).filter(antes), manual: L.filter(sac).sort(ord), todos: uniq(vivos.filter(r => r.sem.n > 0))}; }

const CELSEM = (r, todo) => `<td style="color:${COL[r.sem.n]}" title="${esc(NS[r.sem.n] + (r.sem.mot.length ? ": " + r.sem.mot.join(" · ") : ""))}"><b>●</b>${r.sem.n ? ` <small style="color:var(--mu)">${esc(todo ? r.sem.mot.join(" · ") : r.sem.mot[0] || "")}</small>` : ""}</td>`;
const DESC = (tit, n, html, col) => n ? `<details style="margin:8px 0"><summary style="cursor:pointer;color:${col};font-size:13px">${tit} (${n})</summary>${html}</details>` : "";
function filasVk(vk, L, num, todo){
  const pp = vk[0] === "p", [, , cab, u] = VK.find(x => x[0] === vk), sem = S.vista === "sem";
  return `<div class="bcard" style="padding:0;overflow:auto"><table class="xtab"><tr><th>#</th>${sem ? "<th>Día</th>" : ""}<th>Estación</th><th>Alt.</th><th>${cab}</th><th>${pp ? "Ventana UTC" : "Hora UTC"}</th><th>Datos</th><th></th></tr>
  ${L.map((r, i) => { const id = idSac(vk, r), e = EST.get(r.cod) || {}; S.fila.set(id, {vk, r}); const t = S.B0 + (pp ? r.e : r.m) * 60e3, sa = S.sacados[id];
    return `<tr data-agid="${esc(id)}" style="cursor:pointer"><td>${num ? num(i, r) : i + 1}</td>${sem ? `<td style="white-space:nowrap">${esc(nombreDia(S.per.dias[r.dia], S.modo))}</td>` : ""}<td class="nom"><b>${esc(e.nombre || r.cod)}</b> <small style="color:var(--mu)">${r.cod}</small>${sa ? `<br><small style="color:var(--err)">sacado por ${esc(sa.quien || "?")}: ${esc(sa.motivo)}</small>` : ""}</td><td class="n">${e.alt != null ? Math.round(e.alt) : "—"}</td>
    <td class="n"><b>${f1(r.v)} ${u}</b></td><td class="n" style="white-space:nowrap" title="${esc(locTxt(t))} hora de Chile">${pp ? hTxt(r.e - r.W + 1) + " → " + hTxt(r.e) : hTxt(r.m)}</td><td class="n">${Math.round(r.comp * 100)} %</td>${CELSEM(r, todo)}</tr>`; }).join("")}</table></div>`; }
const sub = () => S.vista === "sem" ? " de la semana" : " · " + nombreDia(S.per.dias[S.vista], S.modo);
function bloque(vk, tit){
  const P = vista(vk);
  return `<h3 style="margin:16px 0 6px;font-size:15px">Top 10 ${tit.toLowerCase()}${sub()}</h3>${P.top.length ? filasVk(vk, P.top) : `<p style="color:var(--mu)">Sin datos.</p>`}`
    + DESC("Sacados a mano", P.manual.length, filasVk(vk, P.manual), "var(--mu)") + DESC("Descartados por el control («malo»)", P.desc.length, filasVk(vk, P.desc), "var(--err)"); }
function calidad(){
  return VK.filter(([k]) => S.vble === "cal").map(([vk, tit]) => { const P = vista(vk), L = P.todos.slice().sort((a, b) => b.sem.n - a.sem.n).slice(0, 80);
    return `<h3 style="margin:16px 0 6px;font-size:15px">${tit}${sub()} — ${P.todos.length} con alerta</h3>` + (L.length ? filasVk(vk, L, null, true) : `<p style="color:var(--ok)">Sin errores ni dudosos.</p>`); }).join(""); }

function pintar(){
  const o = $("#agOut"), P = S.per, v = S.vista, ble = S.vble; S.fila = new Map();
  const bt = (k, t) => `<button data-agv="${k}" class="${String(v) === String(k) ? "on" : ""}" style="margin-right:4px">${esc(t)}</button>`, bv = (k, t) => `<button data-agb="${k}" class="${ble === k ? "on" : ""}" style="margin-right:4px;font-weight:600">${t}</button>`;
  const sep = `<span style="width:1px;align-self:stretch;background:var(--bd);margin:0 6px"></span>`;
  const cuerpo = ble === "tem" ? bloque("tmax", "Temperatura máxima") + bloque("tmin", "Temperatura mínima") : ble === "pp" ? bloque("pp6", "Precipitación en 6 h") + bloque("pp24", "Precipitación en 24 h") : calidad();
  o.innerHTML = `<div class="htools" style="gap:4px;flex-wrap:wrap;align-items:center;margin-bottom:6px">${bv("tem", "Temperatura")}${bv("pp", "Precipitación")}${bv("cal", "Calidad")}${sep}${bt("sem", "Semana")}${Array.from({length: 7}, (_, k) => bt(k, nombreDia(P.dias[k], S.modo))).join("")}</div>
    <div style="font-size:12px;color:var(--mu);margin-bottom:4px" title="${S.N} minutos esperados por estación · ${esc(locTxt(P.t0))} a ${esc(locTxt(P.t1 - 60e3))} hora de Chile">${new Date(P.t0).toISOString().slice(0, 16).replace("T", " ")} → ${new Date(P.t1 - 60e3).toISOString().slice(0, 16).replace("T", " ")} ${S.modo === "utc" ? "UTC" : "(días en hora de Chile)"} · ${S.nEst} estaciones${S.fallas ? ` · <b style="color:var(--err)">${S.fallas} horas sin leer</b>` : ""}${S.sinArch ? ` · ${S.sinArch} horas sin archivo` : ""}
      · <span style="color:${COL[0]}">●</span> ok <span style="color:${COL[1]}">●</span> dudoso <span style="color:${COL[2]}">●</span> malo (sale del ranking) · <a href="#" id="agInfo">cómo se controla</a>${S.sacError ? ` · <span style="color:var(--err)">${esc(S.sacError)}</span>` : ""}</div>
    <div id="agNota" hidden class="nota" style="font-size:12px;margin:4px 0 8px;color:var(--mu)">Temperatura: máximo y mínimo de los minutarios; los picos aislados (&gt; ${SPIKE} °C sobre sus vecinos de ±5 min) no entran. Se compara con la mediana de las vecinas ≤ ${VEC_KM} km corregida por altitud (6,5 °C/km): dudoso &gt; 4 °C, malo &gt; 8 °C. Completitud &lt; 80 % dudoso, &lt; 50 % malo. Precipitación: suma de agua caída por minuto en ventanas deslizantes; la ventana cuenta para el día en que termina y cabe entera en el periodo; se pide al menos 50 % de minutos con dato; un minuto con más de ${PP_MAXMIN} mm se descarta; se compara con las vecinas con pluviómetro en la misma ventana. Umbrales provisorios. Aún no se aplican las correcciones guardadas. Clic en una fila: gráfico, mapa y botón para sacarla del ranking.</div>
    ${cuerpo}`;
  $("#agInfo").addEventListener("click", ev => { ev.preventDefault(); $("#agNota").hidden = !$("#agNota").hidden; });
  o.querySelectorAll("[data-agv]").forEach(b => b.addEventListener("click", () => { S.vista = b.dataset.agv === "sem" ? "sem" : +b.dataset.agv; pintar(); }));
  o.querySelectorAll("[data-agb]").forEach(b => b.addEventListener("click", () => { S.vble = b.dataset.agb; pintar(); }));
  o.querySelectorAll("tr[data-agid]").forEach(tr => tr.addEventListener("click", () => abrir(tr.dataset.agid)));
}

/* ---------- ventana al hacer clic: gráfico + mapa de vecinas + botón «Sacar del ranking» ---------- */
function modal(){
  let m = $("#agMod"); if (!m){ m = document.createElement("div"); m.id = "agMod"; m.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:9999;overflow:auto;padding:20px";
    m.addEventListener("click", ev => { if (ev.target === m) m.hidden = true; }); document.addEventListener("keydown", ev => { if (ev.key === "Escape") m.hidden = true; }); document.body.appendChild(m); }
  m.hidden = false; return m; }
function mapaVec(cod, vk, r){
  const pp = vk[0] === "p", e = EST.get(cod) || {}, V = pp ? vecinasPP(cod) : vecinas(cod), W = 380, H = 330, cx = W / 2, cy = H / 2;
  const val = o => { if (pp){ const q = sumaVent(S.vwin.get(o.cod + "|" + r.W) || (S.vwin.set(o.cod + "|" + r.W, ventanas(o.cod, r.W)), S.vwin.get(o.cod + "|" + r.W)), r.e, r.W); return q.n >= r.W / 2 ? f1(q.mm) + " mm" : "s/d"; } const x = cerca(S.T.get(o.cod), r.m); return isFinite(x) ? f1(x) + " °C" : "s/d"; };
  const pts = V.map(o => { const q = EST.get(o.cod) || {}; return {o, dx: (q.lon - e.lon) * Math.cos(e.lat * Math.PI / 180) * 111.32, dy: (q.lat - e.lat) * 110.57}; });
  const R = Math.max(10, ...pts.map(p => Math.hypot(p.dx, p.dy))) * 1.15, sc = Math.min(cx - 55, cy - 20) / R;
  const anillos = [0.5, 1].map(f => `<circle cx="${cx}" cy="${cy}" r="${R * f * sc}" fill="none" stroke="currentColor" opacity=".15" stroke-dasharray="3 3"/><text x="${cx + R * f * sc * .71}" y="${cy - R * f * sc * .71}" font-size="9" fill="currentColor" opacity=".5">${Math.round(R * f)} km</text>`).join("");
  const nv = pts.map(p => `<g><line x1="${cx}" y1="${cy}" x2="${cx + p.dx * sc}" y2="${cy - p.dy * sc}" stroke="currentColor" opacity=".15"/><circle cx="${cx + p.dx * sc}" cy="${cy - p.dy * sc}" r="5" fill="#1c7ed6"/><text x="${cx + p.dx * sc + 8}" y="${cy - p.dy * sc + 4}" font-size="10" fill="currentColor"><tspan font-weight="700">${val(p.o)}</tspan> ${esc(p.o.nombre.slice(0, 16))} · ${p.o.alt != null ? Math.round(p.o.alt) + " m" : ""} · ${Math.round(p.o.d)} km</text></g>`).join("");
  return `<svg viewBox="0 0 ${W} ${H}" style="width:100%;height:auto;color:var(--tx)">${anillos}${nv}<circle cx="${cx}" cy="${cy}" r="7" fill="#d6336c"/><text x="${cx}" y="${cy + 20}" text-anchor="middle" font-size="11" font-weight="700" fill="currentColor">${f1(r.v)} ${pp ? "mm" : "°C"} · ${esc((e.nombre || cod).slice(0, 22))}</text></svg>`
    + (V.length ? "" : `<p style="color:var(--mu);font-size:12px">Sin vecinas con dato dentro de ${VEC_KM} km.</p>`); }
async function abrir(id){
  const it = S.fila.get(id); if (!it) return; const {vk, r} = it, pp = vk[0] === "p", [, tit, , u] = VK.find(x => x[0] === vk), M = modal(), tok = TOK;
  M.innerHTML = `<div style="max-width:1100px;margin:0 auto;background:var(--panel);border:1px solid var(--bd);border-radius:12px;padding:16px"><p style="color:var(--mu)">Leyendo ${DIAS_SERIE} días de ${esc(nom(r.cod))} y sus vecinas…<small data-prog></small></p></div>`;
  if (!S.extra){ const ts = []; for (let t = S.B0; t < S.per.t0; t += 3600e3) ts.push(t);
    S.extra = cargar(ts, (n, N) => { const p = M.querySelector("[data-prog]"); if (p) p.textContent = ` ${n}/${N} horas`; }); }
  await S.extra; if (tok !== TOK) return;
  const RR0 = typeof R !== "undefined" ? R : null, usaFal = !pp && !!(window.FALLAS && FALLAS.grafico && RR0 && (RR0.estaciones || []).some(x => x.codigo === r.cod));
  let graf;
  if (usaFal) graf = `<div id="agFal"></div>`;
  else if (pp){ const horario = a => { const h = new Float32Array(S.NT / 60).fill(NaN); for (let k = 0; k < h.length; k++){ let t = 0, n = 0; for (let m = k * 60; m < k * 60 + 60; m++){ const x = a[m]; if (isFinite(x)){ n++; if (x <= PP_MAXMIN) t += x; } } if (n) h[k] = t; } return h; };
    const V = vecinasPP(r.cod), e = EST.get(r.cod) || {};
    graf = graficoPP([{nombre: e.nombre || r.cod, alt: e.alt, h: horario(S.R.get(r.cod)), principal: true}, ...V.map(o => ({nombre: o.nombre, alt: o.alt, d: o.d, h: horario(S.R.get(o.cod))}))], r.e, r.W) + `<p class="nota" style="font-size:12px;color:var(--mu)">mm por hora UTC. Franja rosada: la ventana de ${tit.slice(-4)} del ranking.</p>`; }
  else { const V = vecinas(r.cod), e = EST.get(r.cod) || {};
    graf = grafico([{cod: r.cod, nombre: e.nombre || r.cod, alt: e.alt, a: S.T.get(r.cod), principal: true}, ...V.map(o => ({cod: o.cod, nombre: o.nombre, alt: o.alt, d: o.d, a: S.T.get(o.cod)}))], r.m) + `<p class="nota" style="font-size:12px;color:var(--mu)">Línea vertical: hora de la extrema.</p>`; }
  const RR = typeof R !== "undefined" ? R : null, eR = RR && (RR.estaciones || []).find(x => x.codigo === r.cod);
  const usaEsp = !pp && !!(window.SUPER && SUPER.mapaEsp && window.L && window.supVec && eR && eR.lat != null), usaVer = pp && !!(window.VERIF && window.L);
  const sa = S.sacados[id], t = S.B0 + (pp ? r.e : r.m) * 60e3, puede = !!clave();
  const acc = sa ? `<p style="margin:0 0 8px"><b style="color:var(--err)">Sacado del ranking</b> por ${esc(sa.quien || "?")} el ${esc((sa.t || "").replace("T", " "))}: ${esc(sa.motivo)}</p>${puede ? `<button id="agDev">Devolver al ranking</button>` : ""}`
    : puede ? `<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center"><input id="agMot" placeholder="Motivo (obligatorio)" style="flex:1;min-width:220px;padding:6px 8px"><button id="agSac" style="font-weight:700">Sacar del ranking</button></div>` : `<p style="color:var(--mu)">Inicia sesión para sacar datos del ranking.</p>`;
  M.innerHTML = `<div style="max-width:1100px;margin:0 auto;background:var(--panel);border:1px solid var(--bd);border-radius:12px;padding:16px">
    <div style="display:flex;justify-content:space-between;gap:10px"><h3 style="margin:0;font-size:16px">${esc(nom(r.cod))} <small style="color:var(--mu)">${r.cod}</small> — ${tit}: <b>${f1(r.v)} ${u}</b> · ${esc(nombreDia(S.per.dias[r.dia], S.modo))} · ${pp ? hTxt(r.e - r.W + 1) + " → " + hTxt(r.e) : hTxt(r.m)} UTC</h3><button id="agX" style="font-size:16px">✕</button></div>
    <p style="margin:6px 0 10px;color:${COL[r.sem.n]}"><b>● ${NS[r.sem.n]}</b> <span style="color:var(--mu)">${esc(r.sem.mot.join(" · ") || "sin observaciones")} · datos ${Math.round(r.comp * 100)} %</span></p>
    <div>${graf}</div>
    ${usaEsp ? `<div style="margin-top:12px"><div class="espMapT" style="font-size:12.5px;margin-bottom:4px"></div><div class="espMap" style="height:400px;border:1px solid var(--bd);border-radius:8px"></div><small style="color:var(--mu)">Control espacial: rojo = la estación · azul = vecinas DMC · gris = sin dato</small></div>` : (usaVer || usaFal) ? "" : `<div class="bcard" style="padding:8px;margin-top:12px"><div style="font-size:12px;color:var(--mu);margin-bottom:4px">Vecinas a la hora de la extrema (≤ ${VEC_KM} km)</div>${mapaVec(r.cod, vk, r)}</div>`}
    ${usaVer ? `<div id="agVer" style="margin-top:12px"></div>` : ""}
    <div style="margin-top:12px;border-top:1px solid var(--bd);padding-top:10px">${acc}<p id="agErr" style="color:var(--err);margin:6px 0 0"></p></div></div>`;
  $("#agX").addEventListener("click", () => { M.hidden = true; });
  if (usaFal){ const t0 = S.B0 + r.m * 60e3, e0 = EST.get(r.cod) || {};
    FALLAS.grafico($("#agFal"), {codigo: r.cod, nombre: e0.nombre || r.cod, var: "T", inicio: t0, ultima: t0 + 60e3, sigue: false, minutos: 1500, alertas: []}, RR0);
    if (usaEsp){ const fm = M.querySelector("#agFal .fmap"), ft = M.querySelector("#agFal .fmapt"); if (fm) fm.style.display = "none"; if (ft) ft.style.display = "none"; } }
  if (usaEsp){ const fin = new Date(S.per.dias[r.dia + 1]).toISOString().slice(0, 16);     // las 24 h que terminan al cierre de ese día
    try { SUPER.mapaEsp(M.querySelector(".espMap"), M.querySelector(".espMapT"), eR, window.supVec(r.cod), {regla: "ZE05", msg: vk === "tmin" ? "Ts mínima" : "Ts máxima"}, fin); } catch (e) { M.querySelector(".espMapT").textContent = "No se pudo dibujar el mapa."; } }
  if (usaVer){ let hm = 0, vm = -1; for (let k = Math.floor((r.e - r.W + 1) / 60); k <= Math.floor(r.e / 60); k++){ let q = 0; for (let m = k * 60; m < k * 60 + 60; m++){ const x = S.R.get(r.cod)[m]; if (isFinite(x) && x <= PP_MAXMIN) q += x; } if (q > vm){ vm = q; hm = k; } }     // la hora más lluviosa de la ventana
    const tm = new Date(S.B0 + hm * 3600e3); VERIF.fijar(r.cod, tm.toISOString().slice(0, 10), tm.getUTCHours()); VERIF.pagina($("#agVer")); }
  const enviar = async (cuerpo) => { const nm = (() => { try { let n = localStorage.getItem("agroNombre"); if (!n){ n = prompt("Tu nombre, para el registro:") || ""; localStorage.setItem("agroNombre", n); } return n; } catch (e) { return ""; } })();
    try { const rs = await fetch("/api/agro", {method: "POST", headers: {"x-clave": clave(), "content-type": "application/json"}, body: JSON.stringify({...cuerpo, quien: nm})});
      if (!rs.ok){ $("#agErr").textContent = rs.status === 401 ? "Clave incorrecta." : (await rs.text()) || "No se pudo guardar."; return; }
      const j = await rs.json(); S.sacados = j.sacados || {}; M.hidden = true; pintar(); } catch (e) { $("#agErr").textContent = "Sin conexión: " + e.message; } };
  if ($("#agSac")) $("#agSac").addEventListener("click", () => { const mo = $("#agMot").value.trim(); if (mo.length < 3){ $("#agErr").textContent = "Escribe el motivo."; return; } enviar({accion: "sacar", p: S.pid, id, vk, cod: r.cod, dia: r.dia, valor: r.v, motivo: mo}); });
  if ($("#agDev")) $("#agDev").addEventListener("click", () => enviar({accion: "devolver", p: S.pid, id})); }

function graficoPP(series, e, W){
  const Wd = 940, Ht = 280, L = 40, R = 8, Tp = 10, B = 28, n = S.NT / 60; let hi = 1; series.forEach(s => s.h.forEach(x => { if (isFinite(x) && x > hi) hi = x; })); hi = Math.ceil(hi);
  const X = k => L + (Wd - L - R) * k / (n - 1), Y = v => Tp + (Ht - Tp - B) * (1 - v / hi), stp = hi > 40 ? 10 : hi > 15 ? 5 : hi > 6 ? 2 : 1, ejeY = [];
  for (let v = 0; v <= hi; v += stp) ejeY.push(`<line x1="${L}" x2="${Wd - R}" y1="${Y(v)}" y2="${Y(v)}" stroke="currentColor" opacity=".12"/><text x="${L - 4}" y="${Y(v) + 4}" text-anchor="end" font-size="11" fill="currentColor" opacity=".7">${v}</text>`);
  const ejeX = []; for (let t = Math.ceil(S.B0 / 86400e3) * 86400e3; t < S.per.t1; t += 86400e3){ const k = (t - S.B0) / 3600e3; ejeX.push(`<line x1="${X(k)}" x2="${X(k)}" y1="${Tp}" y2="${Ht - B}" stroke="currentColor" opacity=".12"/><text x="${X(k)}" y="${Ht - 10}" text-anchor="middle" font-size="10" fill="currentColor" opacity=".7">${new Date(t).toISOString().slice(8, 10)}/${new Date(t).toISOString().slice(5, 7)}</text>`); }
  const franja = `<rect x="${X((e - W + 1) / 60)}" y="${Tp}" width="${Math.max(2, X((e + 1) / 60) - X((e - W + 1) / 60))}" height="${Ht - Tp - B}" fill="#d6336c" opacity=".12"/>`;
  const lin = series.map((s, k) => { let d = "", pen = false; s.h.forEach((x, j) => { if (isFinite(x)){ d += (pen ? "L" : "M") + X(j).toFixed(1) + " " + Y(x).toFixed(1); pen = true; } else pen = false; });
    return `<path d="${d}" fill="none" stroke="${PAL[k % PAL.length]}" stroke-width="${s.principal ? 2 : 1}" opacity="${s.principal ? 1 : .8}"/>`; });
  const ley = series.map((s, k) => `<span style="margin-right:14px;white-space:nowrap"><b style="color:${PAL[k % PAL.length]}">━</b> ${esc(s.nombre)}${s.alt != null ? ` · ${Math.round(s.alt)} m` : ""}${s.d != null ? ` · ${Math.round(s.d)} km` : ""}</span>`).join("");
  return `<div class="bcard" style="padding:10px"><svg viewBox="0 0 ${Wd} ${Ht}" style="width:100%;height:auto;color:var(--tx,#222)">${franja}${ejeY.join("")}${ejeX.join("")}${lin.join("")}</svg><div style="font-size:12px;margin-top:6px">${ley}</div></div>`; }

const PAL = ["#111", "#1c7ed6", "#e8590c", "#2f9e44", "#9c36b5"];
function grafico(series, mExt){
  const W = 940, H = 300, L = 40, R = 8, Tp = 10, B = 28, NT = S.NT, paso = 3;
  let lo = Infinity, hi = -Infinity; series.forEach(s => { for (let m = 0; m < NT; m += 1){ const x = s.a[m]; if (isFinite(x)){ if (x < lo) lo = x; if (x > hi) hi = x; } } });
  if (!isFinite(lo)) return `<p style="color:var(--mu)">Sin datos en la ventana.</p>`;
  lo = Math.floor(lo - 1); hi = Math.ceil(hi + 1);
  const X = m => L + (W - L - R) * m / (NT - 1), Y = v => Tp + (H - Tp - B) * (1 - (v - lo) / (hi - lo));
  const ejeY = []; const stp = (hi - lo) > 30 ? 10 : (hi - lo) > 15 ? 5 : 2; for (let v = Math.ceil(lo / stp) * stp; v <= hi; v += stp) ejeY.push(`<line x1="${L}" x2="${W - R}" y1="${Y(v)}" y2="${Y(v)}" stroke="currentColor" opacity=".12"/><text x="${L - 4}" y="${Y(v) + 4}" text-anchor="end" font-size="11" fill="currentColor" opacity=".7">${v}</text>`);
  const ejeX = []; for (let t = Math.ceil(S.B0 / 86400e3) * 86400e3; t < S.per.t1; t += 86400e3){ const m = (t - S.B0) / 60e3; ejeX.push(`<line x1="${X(m)}" x2="${X(m)}" y1="${Tp}" y2="${H - B}" stroke="currentColor" opacity=".12"/><text x="${X(m)}" y="${H - 10}" text-anchor="middle" font-size="10" fill="currentColor" opacity=".7">${new Date(t).toISOString().slice(8, 10)}/${new Date(t).toISOString().slice(5, 7)}</text>`); }
  const lin = series.map((s, k) => { let d = "", pen = false;
    for (let m = 0; m < NT; m += paso){ let x = s.a[m]; for (let j = 1; j < paso && !isFinite(x); j++) x = s.a[m + j];   // sin dato: se corta la línea
      if (isFinite(x)){ d += (pen ? "L" : "M") + X(m).toFixed(1) + " " + Y(x).toFixed(1); pen = true; } else pen = false; }
    return `<path d="${d}" fill="none" stroke="${PAL[k % PAL.length]}" stroke-width="${s.principal ? 2 : 1}" opacity="${s.principal ? 1 : .8}"/>`; });
  const marca = `<line x1="${X(mExt)}" x2="${X(mExt)}" y1="${Tp}" y2="${H - B}" stroke="#d6336c" stroke-dasharray="4 3"/>`;
  const leyenda = series.map((s, k) => `<span style="margin-right:14px;white-space:nowrap"><b style="color:${PAL[k % PAL.length]}">━</b> ${esc(s.nombre)}${s.alt != null ? ` · ${Math.round(s.alt)} m` : ""}${s.d != null ? ` · ${Math.round(s.d)} km` : ""}</span>`).join("");
  return `<div class="bcard" style="padding:10px"><svg viewBox="0 0 ${W} ${H}" style="width:100%;height:auto;color:var(--tx,#222)">${ejeY.join("")}${ejeX.join("")}${lin.join("")}${marca}</svg><div style="font-size:12px;margin-top:6px">${leyenda}</div></div>`;
}

async function generar(){
  const tok = ++TOK, iso = $("#agJue").value, o = $("#agOut"); if (!iso) return;
  const modo = $("#agModo").value, per = periodo(iso, modo), now = Date.now();
  if (per.t1 > now + 3600e3 && !confirm("Ese periodo aún no termina; el ranking será parcial. ¿Continuar?")) return;
  DG = {ok: 0, nf: 0, err: 0, ult: ""};
  const N = Math.round((per.t1 - per.t0) / 60e3), NT = DIAS_SERIE * 1440, B0 = per.t1 - NT * 60e3;
  S = {per, modo, pid: iso + "|" + modo, sacados: {}, sacError: "", fila: new Map(), vista: "sem", vble: "tem", N, NT, B0, i0: Math.round((per.t0 - B0) / 60e3), T: new Map(), R: new Map(), extra: null, vec: null};
  o.innerHTML = `<p style="color:var(--mu)">Leyendo ${Math.round(N / 60)} horas de datos minutarios…<small id="agProg"></small></p>`;
  if (!EST.size){ for (const u of ["/api/minutarios?estaciones=1", "/api/datosraw?p=estaciones.json"]){ try { const j = await (await conTiempo(u, 10000)).json(); const L = Array.isArray(j) ? j : j.estaciones || []; if (L.length){ EST = new Map(L.map(e => [String(e.codigo), e])); break; } } catch (e) {} } }
  const ts = []; for (let t = per.t0; t < per.t1; t += 3600e3) ts.push(t);
  S.fallas = await cargar(ts, (n, T) => { const p = $("#agProg"); if (p && tok === TOK) p.textContent = ` ${n}/${T} horas · ${DG.nf} sin archivo`; });
  if (tok !== TOK) return;
  S.sinArch = DG.nf;
  if (!S.T.size){ o.innerHTML = `<p style="color:var(--err)">No hay datos minutarios en ese periodo (el archivo de METOTEC parte el 8-11-2026).${DG.ult ? " Último error: " + esc(DG.ult) : ""}</p>`; return; }
  try { const rs = await fetch("/api/agro?p=" + encodeURIComponent(S.pid), {headers: {"x-clave": clave()}, cache: "no-store"}); if (rs.ok) S.sacados = (await rs.json()).sacados || {}; else S.sacError = rs.status === 401 ? "sin sesión: no se ven los datos sacados" : "no se pudo leer lo sacado (" + rs.status + ")"; } catch (e) { S.sacError = "no se pudo leer lo sacado"; }
  analizar(); analizarPP(); pintar();
}

function init(){
  const s = $("#agro"); if (!s.dataset.ok){
    s.dataset.ok = 1;
    s.innerHTML = `<div class="htools" style="gap:8px;flex-wrap:wrap;align-items:center;font-size:13px"><b>Agro</b><label>Jueves de inicio <input type="date" id="agJue" value="${ultimoJueves("utc")}"></label><label>Días en <select id="agModo"><option value="utc">UTC</option><option value="loc">hora de Chile</option></select></label><button id="agGo">Generar</button><span class="tag" id="agTag"></span></div><div id="agOut" style="margin-top:8px"></div>`;
    $("#agGo").addEventListener("click", generar); $("#agModo").addEventListener("change", () => { $("#agJue").value = ultimoJueves($("#agModo").value); generar(); });
    $("#agJue").addEventListener("change", ev => { const d = new Date(ev.target.value + "T00:00:00Z"); $("#agTag").textContent = d.getUTCDay() === 4 ? "" : "Ojo: esa fecha no es jueves"; });
    generar();
  }
}
window.AGRO = {init, _t: {vble: v => { S.vble = v; pintar(); }, vista: v => { S.vista = v; pintar(); }, abrir, estado: () => S, localAUtc, periodo, ultimoJueves, extremo, esPico}};
})();
