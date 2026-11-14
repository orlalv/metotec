/* Etapa 3 · Equipo: perfiles (hasta 8, con la clave general), «Mis estaciones», «Mis alertas» y completitud de observaciones.
   - Perfil elegido arriba (lista con los nombres + «Todos»); se guarda en este navegador. Cualquiera entra a la vista de
     cualquiera (cubre ausencias). Las marcas (Resuelto, Falsa alarma, Informar) quedan con el nombre elegido.
   - La evaluación de reglas está en js/alertas_core.js, el mismo módulo que usa el Worker de cron (worker/), que además avisa por Telegram / correo. */
(function(){
const $ = s => document.querySelector(s);
const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;"})[c]);
const ZONAS = {todas: [-90, 0], norte: [-27.5, 0], centro: [-38, -27.5], sur: [-46, -38], austral: [-90, -46]};
const ZNOM = {norte: "Norte", centro: "Centro", sur: "Sur", austral: "Austral"};
const VARS = {ema: {T: "Ts (°C)", Td: "Td (°C)", HR: "HR (%)", P_mar: "QFF (hPa)", ff10: "Viento (kt)", dd10: "Dirección (°)", rr1h: "Lluvia 1 h (mm)"},
              obs: {Ts: "Ts (°C)", Td: "Td (°C)", HR: "HR (%)", ff: "Viento (kt)", VV: "Visibilidad (m)", ww: "ww (tiempo presente)", RRR6: "RRR6 (mm)", QFE: "QFE (hPa)", fen: "Fenómeno (ww o METAR)"}};
const OPS = {">": "mayor que", ">=": "mayor o igual", "<": "menor que", "<=": "menor o igual", "=": "igual a", en: "está en (códigos/rangos)", sin: "sin dato", hay: "hay (fenómeno)"};
const DONDE = {mias: "Mis estaciones", todas: "Todas", norte: "Norte", centro: "Centro", sur: "Sur", austral: "Austral", cods: "Estaciones"};
const PRESETS = [
  {nombre: "Arica: RRR6 > 0", fuente: "obs", donde: "cods", cods: ["180005"], var: "RRR6", op: ">", valor: "0"},
  {nombre: "Chubascos (ww o METAR)", fuente: "obs", donde: "todas", var: "fen", op: "hay", valor: "chubasco"},
  {nombre: "Nieve (ww o METAR)", fuente: "obs", donde: "todas", var: "fen", op: "hay", valor: "nieve"},
  {nombre: "Tormenta o granizo", fuente: "obs", donde: "todas", var: "fen", op: "hay", valor: "tormenta,granizo"},
  {nombre: "Tormenta de polvo o arena", fuente: "obs", donde: "todas", var: "ww", op: "en", valor: "07-09,30-35"},
  {nombre: "Observación sin mensaje (2 h)", fuente: "obs", donde: "mias", var: "", op: "sin", valor: ""},
  {nombre: "EMA sin datos", fuente: "ema", donde: "mias", var: "", op: "sin", valor: ""}];

let EQP = {personas: []}, cargado = false, R0 = () => null, clave = () => "";
const yo = () => { try { return localStorage.getItem("qcPersona") || ""; } catch (e) { return ""; } };
const per = n => EQP.personas.find(p => p.nombre === n);
const soloMias = () => { try { return localStorage.getItem("qcSoloMias") !== "0"; } catch (e) { return true; } };
const zona = lat => lat == null ? "" : Object.keys(ZNOM).find(z => lat >= ZONAS[z][0] && lat < ZONAS[z][1]) || "";

// las marcas quedan con el nombre elegido (sin tocar cada llamada de la página)
const F0 = window.fetch.bind(window);
window.fetch = (u, o) => {
  try {
    if (o && o.method === "POST" && typeof o.body === "string" && /\/api\/(revision|informados)$/.test(String(u)) && yo()){
      const b = JSON.parse(o.body);
      if (/revision$/.test(u)) b.quien ||= yo(); else if (b.reg) b.reg.quien ||= yo();
      o = {...o, body: JSON.stringify(b)};
    }
  } catch (e){}
  return F0(u, o);
};

async function cargar(){
  try { const r = await fetch("/api/equipo", {headers: {"x-clave": clave()}, cache: "no-store"}); if (r.ok){ EQP = await r.json(); cargado = true; } } catch (e){}
  selector(); contador();
}
async function guardar(p, antes){
  const r = await fetch("/api/equipo", {method: "POST", headers: {"x-clave": clave(), "content-type": "application/json"}, body: JSON.stringify(p ? {persona: p, antes} : {borrar: antes})});
  if (!r.ok) throw new Error(await r.text()); EQP = await r.json(); selector(); contador();
}

function selector(){
  const s = $("#persona"); if (!s) return;
  if (yo() && !per(yo()) && cargado) try { localStorage.removeItem("qcPersona"); } catch (e){}
  s.innerHTML = `<option value="">Todos</option>` + EQP.personas.map(p => `<option value="${esc(p.nombre)}"${p.nombre === yo() ? " selected" : ""}>${esc(p.nombre)}${p.ausente ? " (ausente)" : ""}</option>`).join("");
  const b = $("#soloMias"); if (b){ const p = per(yo()); b.hidden = !p || !(p.estaciones || []).length; b.classList.toggle("on", soloMias()); b.textContent = soloMias() ? "★ Mis estaciones" : "☆ Mis estaciones"; }
  window.aplicarPestanas && window.aplicarPestanas();
}

// filtro de las listas (EMA y Observaciones): con un perfil elegido que tiene estaciones y «Mis estaciones» activo
// Pestañas que ve cada persona (vacío = todas). Es solo para ordenar la pantalla: la clave sigue siendo una sola. «Equipo» siempre se ve.
const ve = m => { const p = per(yo()); return !p || !(p.pestanas || []).length || m === "equ" || p.pestanas.includes(m); };
function filtra(cod){ const p = per(yo()); return !p || !soloMias() || !(p.estaciones || []).length || p.estaciones.includes(String(cod)); }

// --------------------------------------------------------------- evaluación (módulo común js/alertas_core.js)
let CORE = null;
import("/js/alertas_core.js?v=202611132215").then(m => { CORE = m; contador(); }).catch(() => {});
function evaluar(p, R){
  if (!R || !CORE) return [];
  const fresco = R.ema_rapido && Date.now() - Date.parse(R.ema_rapido.generado) < 20 * 60e3;      // si el Worker se detuvo, vale la última pasada de qc.yml
  const ema = fresco ? R.ema_rapido : {estaciones: R.estaciones || [], datos_hasta: R.datos_hasta};      // el Worker deja un dato EMA cada ~5 min
  return CORE.evaluar(p, ema, R.observaciones).map(h => ({persona: p.nombre, regla: h.r, codigo: h.codigo, nombre: h.nombre, x: h.x, hora: h.hora.replace("T", " ")}));
}
function activas(){ const R = R0(); const P = yo() ? [per(yo())].filter(Boolean) : EQP.personas; return P.flatMap(p => evaluar(p, R)); }
let cargando = false;
function contador(){ if (!cargado && !cargando && clave()){ cargando = true; cargar().finally(() => cargando = false); return; } const b = $("#misN"); if (b){ const n = activas().length; b.textContent = n || ""; } if (modoAct === "mis" && !$("#mis").contains(document.activeElement)) pagMis(); }

// --------------------------------------------------------------- páginas
let modoAct = null;
function pagina(m){ modoAct = m; if (!cargado) cargar().then(() => pagina(m)); else (m === "equ" ? pagEqu : m === "mis" ? pagMis : pagComp)(); }

function estacionesTodas(){
  const R = R0() || {}, M = new Map();
  (R.estaciones || []).forEach(e => M.set(e.codigo, {codigo: e.codigo, nombre: e.nombre, lat: e.lat, tipo: "EMA"}));
  ((R.observaciones || {}).estaciones || []).forEach(e => { const x = M.get(e.codigo); if (x) x.tipo = "EMA + obs."; else M.set(e.codigo, {codigo: e.codigo, nombre: e.nombre, lat: e.lat, tipo: "Obs."}); });
  return [...M.values()].sort((a, b) => (b.lat ?? -99) - (a.lat ?? -99));
}
const dueños = cod => EQP.personas.filter(p => (p.estaciones || []).includes(cod)).map(p => p.nombre);

function pestanasHtml(p){
  const G = [...document.querySelectorAll(".grupos button")].map(b => [b.dataset.g, b.textContent.trim()]);
  const M = [...document.querySelectorAll(".modos button")].filter(b => b.dataset.m !== "equ").map(b => [b.dataset.m, b.firstChild.textContent.trim(), b.dataset.g]);
  const todas = !(p.pestanas || []).length, sel = new Set(p.pestanas || []);
  return `<h4 style="margin-top:14px">Pestañas que ve <b style="color:var(--oro)">${esc(p.nombre)}</b></h4>
   <p class="nota" style="color:var(--mu);font-size:12.5px;margin:0 0 6px">Solo ordena la pantalla (hay una sola clave). Sin ninguna marcada ve todas. «Equipo» siempre se ve.</p>
   ${[...G, ["gestion", "Gestión (engranaje)"]].map(([g, n]) => { const L = M.filter(x => x[2] === g); return L.length ? `<div style="margin:4px 0"><small style="color:var(--mu)">${esc(n)}</small><br>${L.map(([m, t]) => `<label style="margin-right:10px;white-space:nowrap"><input type="checkbox" data-pes="${m}"${todas || sel.has(m) ? " checked" : ""}> ${esc(t)}</label>`).join("")}</div>` : ""; }).join("")}
   <p><button class="mk" id="pesTodas">Ver todas</button></p>`;
}
function pagEqu(){
  const S = $("#equ"), p = per(yo()), q = (S.dataset.q || "").toLowerCase(), z = S.dataset.z || "";
  const L = estacionesTodas().filter(e => (!z || zona(e.lat) === z) && (!q || (e.nombre || "").toLowerCase().includes(q) || e.codigo.includes(q)));
  const sinResp = estacionesTodas().filter(e => !dueños(e.codigo).length).length;
  S.innerHTML = `<h2 style="margin:0 0 4px;font:600 20px var(--titulo)">Equipo y mis estaciones</h2>
   <p class="nota" style="color:var(--mu);font-size:13px;margin:0 0 12px">Hasta 8 personas con la misma clave. Elija su nombre arriba (o «Todos»); cualquiera puede entrar a la vista de otro para cubrir una ausencia. Las marcas quedan con el nombre elegido.</p>
   <div class="eqcols">
    <div><h4>Personas</h4><table class="xtab"><tr><th>Nombre</th><th>Estaciones</th><th>Ausente</th><th></th></tr>
     ${EQP.personas.map(x => `<tr${x.nombre === yo() ? ' style="background:color-mix(in srgb,var(--oro) 12%,transparent)"' : ""}><td><b>${esc(x.nombre)}</b></td><td>${(x.estaciones || []).length}</td>
       <td><input type="checkbox" data-aus="${esc(x.nombre)}"${x.ausente ? " checked" : ""}></td><td style="white-space:nowrap"><button class="mk" data-ver="${esc(x.nombre)}">Ver como</button><button class="mk" data-ren="${esc(x.nombre)}">Renombrar</button><button class="mk" data-del="${esc(x.nombre)}">Quitar</button></td></tr>`).join("")}</table>
     ${EQP.personas.length < 8 ? `<p><input id="eqNuevo" placeholder="Nombre" maxlength="40"> <button class="mk" id="eqAgregar">+ Agregar persona</button></p>` : `<p class="nota">Equipo completo (8).</p>`}
     ${p ? pestanasHtml(p) : ""}
     <p id="eqMsg" style="color:var(--err);font-size:13px"></p></div>
    <div><h4>Estaciones ${p ? `de <b style="color:var(--oro)">${esc(p.nombre)}</b> (${(p.estaciones || []).length})` : ""} <small style="color:var(--mu)">· ${sinResp} sin responsable</small></h4>
     ${p ? "" : `<p class="nota" style="color:var(--sos)">Elija su nombre arriba para marcar sus estaciones.</p>`}
     <div class="htools"><input id="eqQ" placeholder="Buscar estación…" value="${esc(S.dataset.q || "")}"> <select id="eqZ"><option value="">Todas las regiones</option>${Object.entries(ZNOM).map(([k, v]) => `<option value="${k}"${z === k ? " selected" : ""}>${v}</option>`).join("")}</select>
      ${p ? `<button class="mk" id="eqTodas">Marcar las visibles</button><button class="mk" id="eqNinguna">Desmarcar las visibles</button>` : ""}</div>
     <table class="xtab"><tr><th></th><th>Estación</th><th>Tipo</th><th>Zona</th><th>Responsable</th></tr>
     ${L.map(e => { const d = dueños(e.codigo); return `<tr><td>${p ? `<input type="checkbox" data-est="${e.codigo}"${(p.estaciones || []).includes(e.codigo) ? " checked" : ""}>` : ""}</td><td><b>${esc(e.nombre)}</b> <small>${e.codigo}</small></td><td><small>${e.tipo}</small></td><td><small>${ZNOM[zona(e.lat)] || "—"}</small></td>
       <td>${d.length ? esc(d.join(", ")) : `<span style="color:var(--sos);font-weight:700">sin responsable</span>`}</td></tr>`; }).join("")}</table></div></div>`;
}

function reglaTxt(r){
  const lugar = r.donde === "cods" ? (r.cods || []).join(", ") : DONDE[r.donde] || r.donde;
  return `${r.fuente === "obs" ? "Observación" : "EMA"} · ${esc(lugar)} · ${r.op === "sin" ? "sin dato" : `${esc((VARS[r.fuente] || {})[r.var] || r.var)} ${esc(OPS[r.op])} ${esc(r.valor)}`}`;
}
const COLV = {vigente: "var(--ok)", "desactivada": "var(--mu)", "vencida": "var(--err)", "aún no vigente": "var(--sos)"};
function vigTxt(r){
  const e = CORE ? CORE.estadoRegla(r) : "vigente", f = x => x.split("-").reverse().join("/");
  const per_ = r.desde || r.hasta ? `${r.desde ? "desde " + f(r.desde) : ""}${r.desde && r.hasta ? " " : ""}${r.hasta ? "hasta " + f(r.hasta) : ""}` : "sin límite";
  return `<b style="color:${COLV[e] || "inherit"}">${e}</b><br><small>${per_}</small>`;
}
const FEN_SYN = {chubasco: "Chubascos", nieve: "Nieve", tormenta: "Tormenta", granizo: "Granizo", engelante: "Engelante", ventisca: "Ventisca", lluvia: "Lluvia", llovizna: "Llovizna", niebla: "Niebla", neblina: "Neblina", calima: "Calima", polvo: "Polvo o arena"};
const FEN_DESC = {MI: "poco profundo (MI)", BC: "bancos (BC)", DR: "ventisca baja (DR)", BL: "ventisca alta (BL)", SH: "chubasco (SH)", TS: "tormenta (TS)", FZ: "engelante (FZ)", PR: "parcial (PR)"};
const FEN_MET = {DZ: "llovizna", RA: "lluvia", SN: "nieve", SG: "nieve granulada", IC: "cristales de hielo", PL: "gránulos de hielo", GR: "granizo", GS: "granizo pequeño", BR: "neblina", FG: "niebla", FU: "humo", VA: "ceniza volcánica", DU: "polvo", SA: "arena", HZ: "calima"};
function fenLista(valor){
  const sel = new Set(String(valor || "").split(",").map(t => t.trim().toLowerCase()).filter(Boolean)), ch = (k, t) => `<label class="mchk"><input type="checkbox" data-fen="${k}"${sel.has(k.toLowerCase()) ? " checked" : ""}> ${t}</label>`;
  return `<b>Tiempo presente (SYNOP ww o METAR)</b><br>${Object.entries(FEN_SYN).map(([k, t]) => ch(k, t)).join("")}<br><b>Descriptores METAR</b><br>${Object.entries(FEN_DESC).map(([k, t]) => ch(k, t)).join("")}<br><b>Fenómenos METAR</b><br>${Object.entries(FEN_MET).map(([k, t]) => ch(k, `${t} (${k})`)).join("")}`;
}
function estLista(sel, p){
  const S = $("#mis"), mias = new Set((p && p.estaciones) || []), todas = estacionesTodas(), verTodas = (S && S._verTodas) || !mias.size, q = new Set(sel.map(String));
  const L = todas.filter(e => verTodas || mias.has(e.codigo) || q.has(e.codigo));
  return `<b>${verTodas ? "Todas las estaciones" : "Mis estaciones"}</b> · <a href="#" id="mEstVer">${verTodas && mias.size ? "ver solo las mías" : mias.size ? "ver todas" : ""}</a><br>${L.map(e => `<label class="mchk"><input type="checkbox" data-est="${esc(e.codigo)}"${q.has(e.codigo) ? " checked" : ""}> ${esc(e.nombre)} <small>${esc(e.codigo)}</small></label>`).join("") || "<i>sin estaciones cargadas</i>"}`;
}
function pagMis(){
  const S = $("#mis"), p = per(yo()), A = activas();
  const form = r => `<div class="mform"><input id="mNom" placeholder="Nombre de la alerta" value="${esc(r.nombre || "")}">
    <select id="mFue">${["ema", "obs"].map(f => `<option value="${f}"${r.fuente === f ? " selected" : ""}>${f === "ema" ? "Estación automática" : "Observación (SACLIM)"}</option>`).join("")}</select>
    <select id="mDon">${Object.entries(DONDE).map(([k, v]) => `<option value="${k}"${r.donde === k ? " selected" : ""}>${v}</option>`).join("")}</select>
    <input id="mCods" value="${esc((r.cods || []).join(","))}" hidden>
    <div id="mEst" class="mfen"${r.donde === "cods" ? "" : " hidden"}>${estLista(r.cods || [], p)}</div>
    <select id="mVar">${Object.entries(VARS[r.fuente || "ema"]).map(([k, v]) => `<option value="${k}"${r.var === k ? " selected" : ""}>${v}</option>`).join("")}</select>
    <select id="mOp"${r.var === "fen" ? " hidden" : ""}>${Object.entries(OPS).map(([k, v]) => `<option value="${k}"${r.op === k ? " selected" : ""}>${v}</option>`).join("")}</select>
    <input id="mVal" placeholder="Valor (ej. 0, 07-09,30-35)" value="${esc(r.valor || "")}" style="width:170px"${r.var === "fen" ? " hidden" : ""}>
    <span id="mFen" class="mfen"${r.var === "fen" ? "" : " hidden"}>${fenLista(r.valor)}</span>
    <label class="mvig">Vigente desde <input type="date" id="mDes" value="${esc(r.desde || "")}"></label><label class="mvig">hasta <input type="date" id="mHas" value="${esc(r.hasta || "")}"></label>
    <button class="mk" id="mGuardar">${r.id ? "Guardar cambios" : "+ Agregar alerta"}</button>${r.id ? `<button class="mk" id="mCancelar">Cancelar</button>` : ""}</div>`;
  const ed = S._ed || {fuente: "ema", donde: "mias", op: ">"};
  S.innerHTML = `<h2 style="margin:0 0 4px;font:600 20px var(--titulo)">Mis alertas ${p ? `· ${esc(p.nombre)}` : "· todo el equipo"}</h2>
   <p class="nota" style="color:var(--mu);font-size:13px;margin:0 0 12px">Reglas propias sobre el último dato de las estaciones automáticas (cada ~5 min) y las observaciones. Se avisa por Telegram o correo solo cuando la condición aparece (no se repite mientras sigue) y no a quien está marcado ausente.</p>
   <h4>Activas ahora (${A.length})</h4>
   ${A.length ? `<table class="xtab"><tr>${p ? "" : "<th>Persona</th>"}<th>Alerta</th><th>Estación</th><th>Valor</th><th>Hora UTC</th></tr>${A.map(a => `<tr>${p ? "" : `<td>${esc(a.persona)}</td>`}<td><b>${esc(a.regla.nombre || "")}</b><br><small>${reglaTxt(a.regla)}</small></td><td>${esc(a.nombre)} <small>${a.codigo}</small></td><td class="n">${a.regla.op === "sin" ? "sin dato" : esc(a.x)}</td><td class="n">${esc(a.hora)}</td></tr>`).join("")}</table>` : `<p style="color:var(--ok)">Ninguna alerta propia se cumple ahora.</p>`}
   ${p ? `<h4 style="margin-top:18px">Mis reglas</h4>
   ${(p.alertas || []).length ? `<table class="xtab"><tr><th>Activa</th><th>Alerta</th><th>Condición</th><th>Vigencia</th><th></th></tr>${p.alertas.map(r => `<tr><td><input type="checkbox" data-act="${esc(r.id)}"${r.activa !== false ? " checked" : ""}></td><td><b>${esc(r.nombre)}</b></td><td>${reglaTxt(r)}</td><td>${vigTxt(r)}</td><td style="white-space:nowrap"><button class="mk" data-edit="${esc(r.id)}">Editar</button><button class="mk" data-quit="${esc(r.id)}">Quitar</button></td></tr>`).join("")}</table>` : `<p class="nota" style="color:var(--mu)">Todavía no tiene reglas.</p>`}
   <p style="font-size:13px;color:var(--mu);margin:12px 0 4px">Ejemplos: ${PRESETS.map((x, i) => `<button class="mk" data-pre="${i}">${esc(x.nombre)}</button>`).join("")}</p>
   ${form(ed)}
   <h4 style="margin-top:18px">Avisos</h4>
   <div class="mform"><label>Telegram (chat id) <input id="mTg" value="${esc(p.telegram || "")}" placeholder="ej. 123456789"></label><label>Correo <input id="mMail" value="${esc(p.correo || "")}" placeholder="nombre@dominio"></label><label><input type="checkbox" id="mAus"${p.ausente ? " checked" : ""}> Ausente (no avisar)</label><button class="mk" id="mAvisos">Guardar avisos</button></div>
   <p class="nota" style="color:var(--mu);font-size:12.5px">Telegram: escriba al bot del equipo y pida su número a @userinfobot. Los avisos salen solo si en GitHub están los secretos TELEGRAM_TOKEN (bot) o RESEND_API_KEY y RESEND_FROM (correo).</p>`
   : `<p class="nota" style="color:var(--sos);margin-top:14px">Elija su nombre arriba para crear sus reglas.</p>`}
   <p id="mMsg" style="color:var(--err);font-size:13px"></p>`;
}

// completitud de observaciones: grilla estaciones × horas (✓ / ✗ según el programa), resumen diario y mensual
let COMP = null, COMP_T = 0;
setInterval(() => { const S = $("#comp"); if (S && !S.hidden && clave()) pagComp(true); }, 5 * 60e3);     // con la pestaña abierta se actualiza sola
async function pagComp(forzar){
  const S = $("#comp");
  // se vuelve a pedir si pasaron más de 5 min (el servidor la recalcula en cada pasada de observaciones, cada 30 min)
  if (!COMP || forzar === true || Date.now() - COMP_T > 5 * 60e3){
    if (!COMP) S.innerHTML = "<p>Cargando…</p>";
    try { const r = await fetch("/api/completitud", {headers: {"x-clave": clave()}, cache: "no-store"}); if (r.ok){ COMP = await r.json(); COMP_T = Date.now(); } else if (!COMP) COMP = {estaciones: []}; } catch (e){ if (!COMP) COMP = {estaciones: []}; }
  }
  const gen = COMP.generado ? Date.parse(String(COMP.generado).replace(" ", "T") + (/Z|[+-]\d\d:?\d\d$/.test(COMP.generado) ? "" : "Z")) : NaN;
  const edadMin = isNaN(gen) ? null : Math.round((Date.now() - gen) / 60e3);
  const actual = isNaN(gen) ? "—" : `${new Date(gen).toLocaleString("es-CL", {timeZone: "America/Santiago", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false})} (hace ${edadMin < 90 ? edadMin + " min" : (edadMin / 60).toFixed(1) + " h"})`;
  const hoy = new Date().toISOString().slice(0, 10), dia = S.dataset.dia || hoy, vista = S.dataset.v || "dia", mes = dia.slice(0, 7);
  const E = (COMP.estaciones || []).filter(e => filtra(e.codigo)).sort((a, b) => (b.lat ?? -99) - (a.lat ?? -99));
  const hAct = dia === hoy ? new Date().getUTCHours() : 24;
  const pct = (s, prog, hasta = 24) => { const P = prog.filter(h => h < hasta); return P.length ? Math.round(100 * P.filter(h => s[h] === "1").length / P.length) : null; };
  const colp = v => v == null ? "" : v >= 100 ? "var(--ok)" : v >= 90 ? "var(--sos)" : "var(--err)";
  let cuerpo;
  if (vista === "dia"){
    let tp = 0, tt = 0;
    cuerpo = `<table class="cgrid"><tr><th>Estación</th>${[...Array(24).keys()].map(h => `<th>${String(h).padStart(2, "0")}</th>`).join("")}<th>%</th></tr>
     ${E.map(e => { const s = (e.dias || {})[dia] || "0".repeat(24), P = new Set(e.programa || []), v = pct(s, e.programa || [], hAct);
        const P2 = (e.programa || []).filter(h => h < hAct); tp += P2.filter(h => s[h] === "1").length; tt += P2.length;
        return `<tr><td><b>${esc(e.nombre || e.codigo)}</b> <small>${e.codigo}</small></td>${[...Array(24).keys()].map(h => { const si = s[h] === "1", pr = P.has(h);
          if (h >= hAct) return `<td class="fu"></td>`;
          return si ? `<td class="${pr ? "ok" : "fx"}" title="${pr ? "con mensaje" : "con mensaje (fuera del programa)"}">✓</td>` : pr ? `<td class="no" title="falta (hora del programa)">✗</td>` : `<td class="np"></td>`; }).join("")}
          <td style="color:${colp(v)};font-weight:700">${v ?? "—"}</td></tr>`; }).join("")}</table>
     <p class="nota" style="color:var(--mu);font-size:12.5px">✓ con mensaje · ✗ falta en hora del programa · gris: fuera del programa · azul: mensaje fuera del programa. Programa = horas con mensaje al menos la mitad de los últimos 14 días. Red: <b>${tt ? Math.round(100 * tp / tt) : "—"} %</b> (${tp} de ${tt}).</p>`;
  } else {
    const [y, m] = mes.split("-").map(Number), nd = new Date(Date.UTC(y, m, 0)).getUTCDate(), D = [...Array(nd).keys()].map(i => `${mes}-${String(i + 1).padStart(2, "0")}`).filter(d => d <= hoy);
    cuerpo = `<table class="cgrid"><tr><th>Estación</th>${D.map(d => `<th>${d.slice(8)}</th>`).join("")}<th>Mes</th></tr>
     ${E.map(e => { let a = 0, b = 0; const cel = D.map(d => { const s = (e.dias || {})[d]; if (!s) return `<td class="fu">·</td>`; const P = (e.programa || []).filter(h => h < (d === hoy ? new Date().getUTCHours() : 24));
          const n = P.filter(h => s[h] === "1").length; a += n; b += P.length; const v = P.length ? Math.round(100 * n / P.length) : null;
          return `<td style="color:${colp(v)}" title="${d}: ${n} de ${P.length}">${v ?? "—"}</td>`; }).join(""), v = b ? Math.round(100 * a / b) : null;
        return `<tr><td><b>${esc(e.nombre || e.codigo)}</b> <small>${e.codigo}</small></td>${cel}<td style="color:${colp(v)};font-weight:700">${v ?? "—"}</td></tr>`; }).join("")}</table>
     <p class="nota" style="color:var(--mu);font-size:12.5px">% de las horas del programa con mensaje, por día. «·» = día sin archivo (se guardan 40 días).</p>`;
  }
  S.innerHTML = `<h2 style="margin:0 0 4px;font:600 20px var(--titulo)">Completitud de observaciones</h2>
   <div class="htools" style="margin:8px 0 12px"><button class="mk${vista === "dia" ? " ok" : ""}" data-cv="dia">Día</button><button class="mk${vista === "mes" ? " ok" : ""}" data-cv="mes">Mes</button>
    <input type="date" id="cDia" value="${dia}" max="${hoy}"> <span style="color:var(--mu);font-size:12.5px">${E.length} estaciones${per(yo()) && soloMias() && (per(yo()).estaciones || []).length ? " (mis estaciones)" : ""} · hora UTC · se actualiza sola · última actualización de los datos: <b style="color:${edadMin != null && edadMin > 90 ? "var(--err)" : "inherit"}">${actual}</b></span>
    <button class="mk" id="cRecargar">↻</button></div>${E.length ? cuerpo : `<p style="color:var(--mu)">Todavía no hay datos de completitud (se generan en la próxima pasada de observaciones).</p>`}`;
}

// --------------------------------------------------------------- eventos
document.addEventListener("change", async ev => {
  const t = ev.target;
  if (t.id === "persona"){ try { localStorage.setItem("qcPersona", t.value); } catch (e){} selector(); contador(); window.EQ.alCambiar && window.EQ.alCambiar(); if (modoAct) pagina(modoAct); return; }
  if (t.id === "eqZ"){ $("#equ").dataset.z = t.value; return pagEqu(); }
  if (t.id === "cDia"){ $("#comp").dataset.dia = t.value; return pagComp(); }
  if (t.id === "mFue"){ const S = $("#mis"); S._ed = {...leerForm(), fuente: t.value, var: ""}; return pagMis(); }
  if (t.id === "mDon"){ $("#mEst").hidden = t.value !== "cods"; return; }
  try {
    if (t.dataset.pes){ const p = per(yo()), todas = [...document.querySelectorAll(".modos button")].map(b => b.dataset.m).filter(m => m !== "equ");
      const s = new Set((p.pestanas || []).length ? p.pestanas : todas); t.checked ? s.add(t.dataset.pes) : s.delete(t.dataset.pes);
      await guardar({...p, pestanas: s.size >= todas.length ? [] : [...s]}); return pagEqu(); }
    if (t.dataset.aus){ const p = per(t.dataset.aus); await guardar({...p, ausente: t.checked}); return pagEqu(); }
    if (t.dataset.est){ const p = per(yo()), s = new Set(p.estaciones || []); t.checked ? s.add(t.dataset.est) : s.delete(t.dataset.est); await guardar({...p, estaciones: [...s]}); window.EQ.alCambiar && window.EQ.alCambiar(); return pagEqu(); }
    if (t.dataset.act){ const p = per(yo()); await guardar({...p, alertas: p.alertas.map(r => r.id === t.dataset.act ? {...r, activa: t.checked} : r)}); return; }
  } catch (e){ const m = $("#eqMsg") || $("#mMsg"); if (m) m.textContent = "No se pudo guardar: " + e.message; }
});
document.addEventListener("input", ev => { if (ev.target.id === "eqQ"){ const S = $("#equ"); S.dataset.q = ev.target.value; const pos = ev.target.selectionStart; pagEqu(); const i = $("#eqQ"); i.focus(); i.setSelectionRange(pos, pos); } });
document.addEventListener("change", ev => {
  const t = ev.target;
  if (t.id === "mVar" && $("#mOp")){ const f = t.value === "fen"; if (f) $("#mOp").value = "hay"; $("#mOp").hidden = f; $("#mFen").hidden = !f; $("#mVal").hidden = f; }
  if (t.dataset && t.dataset.est) $("#mCods").value = [...document.querySelectorAll("#mEst input:checked")].map(x => x.dataset.est).join(",");
  if (t.dataset && t.dataset.fen) $("#mVal").value = [...document.querySelectorAll("#mFen input:checked")].map(x => x.dataset.fen).join(",");
});
function leerForm(){ return {nombre: $("#mNom").value.trim(), fuente: $("#mFue").value, donde: $("#mDon").value, cods: $("#mCods").value.split(/[,\s]+/).filter(Boolean),
  var: $("#mVar").value, op: $("#mOp").value, valor: $("#mVal").value.trim(), desde: $("#mDes").value || "", hasta: $("#mHas").value || "", id: ($("#mis")._ed || {}).id}; }
document.addEventListener("click", async ev => {
  if (ev.target.id === "mEstVer"){ ev.preventDefault(); const S = $("#mis"); S._verTodas = !S._verTodas; S._ed = leerForm(); return pagMis(); }
  const b = ev.target.closest("button"); if (!b) return;
  if (b.id === "soloMias"){ try { localStorage.setItem("qcSoloMias", soloMias() ? "0" : "1"); } catch (e){} selector(); window.EQ.alCambiar && window.EQ.alCambiar(); if (modoAct === "comp") pagComp(); return; }
  if (b.id === "pesTodas"){ const p = per(yo()); if (p){ try { await guardar({...p, pestanas: []}); } catch (e){} pagEqu(); } return; }
  if (b.dataset.cv){ $("#comp").dataset.v = b.dataset.cv; return pagComp(); }
  if (b.id === "cRecargar"){ COMP = null; return pagComp(); }
  if (b.dataset.ver){ try { localStorage.setItem("qcPersona", b.dataset.ver); } catch (e){} selector(); contador(); window.EQ.alCambiar && window.EQ.alCambiar(); return pagEqu(); }
  if (b.dataset.pre){ $("#mis")._ed = {...PRESETS[+b.dataset.pre]}; return pagMis(); }
  if (b.dataset.edit){ $("#mis")._ed = {...per(yo()).alertas.find(r => r.id === b.dataset.edit)}; return pagMis(); }
  if (b.id === "mCancelar"){ $("#mis")._ed = null; return pagMis(); }
  try {
    if (b.id === "eqAgregar"){ const n = $("#eqNuevo").value.trim(); if (!n) return; if (per(n)) throw new Error("ya existe"); await guardar({nombre: n, estaciones: [], alertas: []}); return pagEqu(); }
    if (b.dataset.ren){ const n = (prompt("Nuevo nombre", b.dataset.ren) || "").trim(); if (!n || n === b.dataset.ren) return; await guardar({...per(b.dataset.ren), nombre: n}, b.dataset.ren);
      if (yo() === b.dataset.ren) try { localStorage.setItem("qcPersona", n); } catch (e){} selector(); return pagEqu(); }
    if (b.dataset.del){ if (!confirm(`¿Quitar a ${b.dataset.del} del equipo? Se borran sus estaciones y reglas.`)) return; await guardar(null, b.dataset.del); return pagEqu(); }
    if (b.id === "eqTodas" || b.id === "eqNinguna"){ const p = per(yo()), s = new Set(p.estaciones || []); document.querySelectorAll("#equ input[data-est]").forEach(i => b.id === "eqTodas" ? s.add(i.dataset.est) : s.delete(i.dataset.est));
      await guardar({...p, estaciones: [...s]}); window.EQ.alCambiar && window.EQ.alCambiar(); return pagEqu(); }
    if (b.id === "mGuardar"){ const p = per(yo()), r = leerForm(); if (r.op !== "sin" && r.valor === "") throw new Error("falta el valor"); if (r.donde === "cods" && !r.cods.length) throw new Error("elija al menos una estación");
      if (!r.nombre) r.nombre = reglaTxt(r).replace(/<[^>]+>/g, "");
      const L = p.alertas || []; const ant = L.find(x => x.id === r.id); r.id ||= Date.now().toString(36); r.activa = ant ? ant.activa !== false : true;
      if (r.desde && r.hasta && r.hasta < r.desde) throw new Error("la fecha «hasta» es anterior a «desde»");
      await guardar({...p, alertas: L.some(x => x.id === r.id) ? L.map(x => x.id === r.id ? r : x) : [...L, r]}); $("#mis")._ed = null; return pagMis(); }
    if (b.dataset.quit){ const p = per(yo()); await guardar({...p, alertas: p.alertas.filter(r => r.id !== b.dataset.quit)}); return pagMis(); }
    if (b.id === "mAvisos"){ const p = per(yo()); await guardar({...p, telegram: $("#mTg").value.trim(), correo: $("#mMail").value.trim(), ausente: $("#mAus").checked}); $("#mMsg").style.color = "var(--ok)"; $("#mMsg").textContent = "Guardado."; return; }
  } catch (e){ const m = $("#eqMsg") || $("#mMsg"); if (m){ m.style.color = "var(--err)"; m.textContent = "No se pudo guardar: " + e.message; } }
});

window.EQ = {ve, init: (fR, fClave) => { R0 = fR; clave = fClave; return cargar(); }, filtra, contador, pagina, yo, evaluar, alCambiar: null};
})();
