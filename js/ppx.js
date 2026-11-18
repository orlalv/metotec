/* Subopciones «Series» y «Sensores» de Precipitación.
   Series (etapa 2): faltantes de agua caída minutaria. Sensores sigue como pantalla informativa (etapa 3). */
(function(){
const TXT = {
  sensores: {
    t: "Sensores",
    p: ["Aquí se detectará un pluviómetro tapado o con fallas del propio aparato: el mismo valor repetido minuto a minuto (por ejemplo 0,2 0,2 0,2 0,2…), un cero sostenido mientras las vecinas sí registran lluvia y el goteo posterior a una obstrucción.",
        "Se separa de «Precipitación binaria»: allí se juzga si llovió o no en cada hora; aquí se juzga el comportamiento del sensor."],
    n: "Mientras tanto, algunos casos de goteo ya aparecen en «Precipitación binaria»."
  }
};

/* ---------- Series: faltantes de agua caída minutaria (rr1m) ---------- */
const RAW = "https://raw.githubusercontent.com/orlalv/metotec/datos/ema/";
const MIN_HUECO = 30;                                  // minutos seguidos sin dato para avisar
const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;"}[c]));
const HORAS = [[6, "últimas 6 h"], [24, "últimas 24 h"], [72, "últimos 3 días"]];
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
      try { const r = await fetch(url + (i ? "?r=" + i : "")); if (r.status === 404) return null;
        if (r.ok) return await new Response(r.body.pipeThrough(new DecompressionStream("gzip"))).text(); } catch (e) {}
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
async function catalogo(){
  if (EST) return EST;
  for (const u of ["/api/minutarios?estaciones=1", "https://raw.githubusercontent.com/orlalv/metotec/datos/estaciones.json"]){
    try { const j = await (await fetch(u)).json(); const L = Array.isArray(j) ? j : j.estaciones || []; if (L.length){ EST = new Map(L.map(e => [String(e.codigo), e])); return EST; } } catch (e) {}
  }
  return EST = new Map();
}

/* Lee la ventana y arma, por estación, los huecos de rr1m. Un «hueco del archivo» (ninguna estación tiene fila ese minuto) no se culpa a la estación. */
async function analizar(H){
  const ahora = Date.now(), h0 = Math.floor(ahora / 3600e3) * 3600e3, ts = [];
  for (let i = H - 1; i >= 0; i--) ts.push(h0 - i * 3600e3);
  const [txt, pistas] = await Promise.all([varias(ts), muestras(h0)]);
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
    const a = fila.get(cod), b = rr.get(cod), huecos = [];
    let ini = -1, falta = 0;
    for (let m = 0; m <= fin; m++){
      const ok = !glob[m] || (b && b[m]);              // minuto sin ninguna fila en el archivo: no cuenta
      if (!ok){ if (ini < 0) ini = m; falta++; }
      else if (ini >= 0){ huecos.push([ini, m - 1]); ini = -1; }
    }
    if (ini >= 0) huecos.push([ini, fin]);
    const grandes = huecos.filter(g => g[1] - g[0] + 1 >= MIN_HUECO); if (!grandes.length) continue;
    const abierto = grandes[grandes.length - 1][1] === fin;
    const ug = grandes[grandes.length - 1], sinFila = (() => { for (let m = ug[0]; m <= ug[1]; m++) if (a && a[m]) return false; return true; })();
    const e = cat.get(cod) || {};
    lista.push({cod, nombre: e.nombre || cod, huecos: grandes.map(g => ({a: t0 + g[0] * 60e3, b: t0 + g[1] * 60e3, n: g[1] - g[0] + 1})),
      falta: grandes.reduce((s, g) => s + g[1] - g[0] + 1, 0), abierto, todo: !b, sinFila, ultimo: b ? ult(b, fin, t0) : null});
  }
  lista.sort((x, y) => (y.abierto - x.abierto) || (y.huecos[y.huecos.length - 1].n - x.huecos[x.huecos.length - 1].n) || x.cod.localeCompare(y.cod));
  return {H, t0, fin: fin >= 0 ? t0 + fin * 60e3 : null, lista, total: universo.size, fallas, tFin: Date.now()};
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

function cuenta(r){ return r ? r.lista.length : 0; }
async function cargar(el){
  const tok = ++TOK;
  el.querySelector("#ppsOut").innerHTML = `<p style="color:var(--mu)">Leyendo ${venH <= 24 ? venH + " horas" : Math.round(venH / 24) + " días"} de datos minutarios…</p>`;
  try { const r = await analizar(venH); if (tok !== TOK) return; RES = r; if (window.ppContar) window.ppContar("series", cuenta(r)); dibujar(el); }
  catch (e) { if (tok === TOK) el.querySelector("#ppsOut").innerHTML = `<p style="color:#e5534b">No pude leer los datos (${esc(e.message)}). Pruebe de nuevo.</p>`; }
}
function dibujar(el){
  const r = RES, out = el.querySelector("#ppsOut"); if (!r) return;
  if (r.fin == null){ out.innerHTML = `<p style="color:var(--mu)">No hay datos minutarios en el archivo para esta ventana.</p>`; return; }
  const L = r.lista.filter(x => !soloAb || x.abierto), ab = r.lista.filter(x => x.abierto).length;
  const fila = x => { const u = x.huecos[x.huecos.length - 1], hs = x.huecos.slice(-3).map(g => `${hh(g.a)}–${hh(g.b)} (${dur(g.n)})`).join(" · ") + (x.huecos.length > 3 ? ` · +${x.huecos.length - 3} antes` : "");
    return `<tr><td><b>${esc(x.cod)}</b> · ${esc(x.nombre)}</td>
      <td>${x.abierto ? `<span style="color:#e5534b;font-weight:700">sin dato ahora</span>` : `<span style="color:#e7b03b;font-weight:700">se recuperó</span>`}${x.todo ? `<br><small style="color:var(--mu)">no informó agua caída en toda la ventana</small>` : x.sinFila ? `<br><small style="color:var(--mu)">la estación no envió nada</small>` : `<br><small style="color:var(--mu)">solo falta la lluvia</small>`}</td>
      <td style="white-space:nowrap">${dd(u.a).slice(5).split("-").reverse().join("/")} ${hh(u.a)} UTC<br><small style="color:var(--mu)">${loc(u.a)} hora local</small></td>
      <td style="text-align:right"><b>${dur(x.falta)}</b><br><small style="color:var(--mu)">${x.huecos.length} ${x.huecos.length === 1 ? "hueco" : "huecos"}</small></td>
      <td style="font-size:12px;color:var(--mu)">${hs}</td>
      <td><button class="ppsAbrir" data-c="${esc(x.cod)}" data-d="${dd(u.a)}" title="Abre «Relleno de series» en esta estación y día">Abrir en Relleno</button></td></tr>`; };
  out.innerHTML = `<p style="margin:2px 0 8px;color:var(--mu);font-size:12.5px">${r.lista.length ? `<b style="color:var(--tx)">${r.lista.length}</b> de ${r.total} estaciones con pluviómetro tienen huecos de ${MIN_HUECO} min o más (${ab} siguen sin dato).` : `Ninguna de las ${r.total} estaciones con pluviómetro tiene huecos de ${MIN_HUECO} min o más.`} Datos hasta ${hh(r.fin)} UTC (${loc(r.fin)} hora local).${r.fallas ? ` <b style="color:#e7b03b">No se pudieron leer ${r.fallas} horas del archivo; los resultados pueden estar incompletos.</b>` : ""}</p>
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
function pagina(el, sub){
  if (sub === "series") return serie(el);
  const d = TXT[sub] || TXT.sensores;
  el.innerHTML = `<div class="ppx"><h3>${d.t} <small style="color:var(--mu);font-weight:400">· próximamente</small></h3>${d.p.map(x => `<p style="margin:6px 0">${x}</p>`).join("")}<p style="margin:10px 0 0"><i>${d.n}</i></p></div>`;
}
window.PPX = {pagina, contar};
})();
