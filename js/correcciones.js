/* Punto 35 · Registro de correcciones: formulario y lista sobre /api/correcciones (KV qc/correcciones).
   Lo registrado se ve en la ficha de cada estación (azul = corregido, gris = rellenado) y en /api/calidad.
   Las horas se anotan en UTC, igual que el resto del control de calidad. */
(function(){
const $ = s => document.querySelector(s);
const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;"})[c]);
const VARS = {T: "Temperatura (T)", Td: "Punto de rocío (Td)", HR: "Humedad (HR)", P_est: "Presión estación", P_mar: "Presión QFF", ff10: "Viento (ff10)", dd10: "Dirección (dd10)",
  fx10: "Racha (fx10)", rr1m: "Lluvia 1 min", rr6: "Lluvia 6 h (RRR6)", rr24: "Lluvia 24 h"};
const EST = {corregido: "Corregido (azul)", rellenado: "Rellenado (gris)"};
let clave = () => "", C = {}, filtro = "", ok = false;

const num = v => { v = String(v ?? "").trim().replace(",", "."); if (v === "") return null; const n = Number(v); return isNaN(n) ? v : n; };
const lim = v => String(v || "").replace(" ", "T").slice(0, 16);
const fh = v => { v = lim(v); return v ? v.slice(8, 10) + "/" + v.slice(5, 7) + " " + v.slice(11, 16) : ""; };

async function api(cuerpo){
  const r = await fetch("/api/correcciones", cuerpo ? {method: "POST", headers: {"x-clave": clave(), "content-type": "application/json"}, body: JSON.stringify(cuerpo)}
    : {headers: {"x-clave": clave()}, cache: "no-store"});
  if (!r.ok) throw new Error(r.status === 401 ? "Clave incorrecta" : await r.text());
  return r.json();
}
async function cargar(){
  try { C = await api(); } catch (e){ $("#corMsg").textContent = e.message; $("#corMsg").style.color = "var(--sos)"; return; }
  lista();
}
function lista(){
  const f = filtro.trim().toLowerCase();
  const A = Object.entries(C).map(([id, x]) => ({id, ...x})).filter(x => !f || x.cod.includes(f) || (x.motivo || "").toLowerCase().includes(f) || (x.quien || "").toLowerCase().includes(f))
    .sort((a, b) => (b.t || "").localeCompare(a.t || ""));
  $("#corLista").innerHTML = A.length ? `<table class="xtab"><tr><th>Estación</th><th>Desde (UTC)</th><th>Hasta</th><th>Variable</th><th>Anterior</th><th>Nuevo</th><th>Estado</th><th>Motivo</th><th>Quién</th><th>Registrado</th><th></th></tr>${
    A.map(x => `<tr><td><b>${esc(x.cod)}</b></td><td class="n">${fh(x.momento)}</td><td class="n">${fh(x.hasta) || "—"}</td><td>${esc(VARS[x.var] || x.var)}</td><td class="n">${esc(x.anterior ?? "—")}</td><td class="n">${esc(x.nuevo ?? "—")}</td>
    <td>${esc(EST[x.estado] || x.estado)}</td><td>${esc(x.motivo)}</td><td>${esc(x.quien)}</td><td class="n">${esc((x.t || "").replace("T", " ").slice(0, 16))}</td>
    <td style="white-space:nowrap"><button class="mk" data-ed="${esc(x.id)}">Editar</button><button class="mk" data-qt="${esc(x.id)}">Quitar</button></td></tr>`).join("")}</table>`
    : `<p style="color:var(--mu)">${Object.keys(C).length ? "Nada coincide con el filtro." : "Todavía no hay correcciones registradas."}</p>`;
}
function llenar(x){
  $("#corCod").value = x.cod || ""; $("#corDesde").value = lim(x.momento); $("#corHasta").value = lim(x.hasta);
  $("#corVar").value = x.var || "T"; $("#corEst").value = x.estado || "corregido";
  $("#corAnt").value = x.anterior ?? ""; $("#corNue").value = x.nuevo ?? ""; $("#corMot").value = x.motivo || "";
  $("#corId").value = x.id || "";
}
async function guardar(){
  const m = $("#corMsg"); m.style.color = "var(--mu)"; m.textContent = "Guardando…";
  const b = {cod: $("#corCod").value.trim(), momento: $("#corDesde").value, hasta: $("#corHasta").value || undefined, var: $("#corVar").value, estado: $("#corEst").value,
    anterior: num($("#corAnt").value), nuevo: num($("#corNue").value), motivo: $("#corMot").value.trim(), quien: ($("#corQuien").value || "").trim()};
  if ($("#corId").value) b.id = $("#corId").value;
  if (!b.cod || !b.momento){ m.style.color = "var(--sos)"; m.textContent = "Falta el código de la estación o la fecha y hora."; return; }
  if (b.hasta && b.hasta < b.momento){ m.style.color = "var(--sos)"; m.textContent = "«Hasta» debe ser posterior a «Desde»."; return; }
  if (!b.motivo){ m.style.color = "var(--sos)"; m.textContent = "Anote el motivo."; return; }
  try { const r = await api(b); C[r.id] = r.reg; m.style.color = "var(--ok)"; m.textContent = "Guardado. Ya se ve en la ficha de la estación."; llenar({}); lista(); }
  catch (e){ m.style.color = "var(--sos)"; m.textContent = e.message; }
}
function pagina(fclave){
  clave = fclave || clave;
  const s = $("#cor"); if (s.dataset.ok){ cargar(); return; } s.dataset.ok = 1;
  const quien = (window.EQ && EQ.yo && EQ.yo()) || "";
  s.innerHTML = `<h4>Registrar una corrección</h4>
    <p class="nota" style="color:var(--mu);font-size:13px;margin:0 0 10px">Anote cada dato que se cambió o rellenó, con el valor anterior y el motivo. Las horas son UTC. Un mismo registro (estación, hora y variable) se reemplaza al guardar.</p>
    <div class="htools"><input id="corCod" placeholder="Código estación" size="12" inputmode="numeric">
      <label>Desde (UTC) <input type="datetime-local" id="corDesde"></label><label>Hasta (opcional) <input type="datetime-local" id="corHasta"></label>
      <select id="corVar">${Object.entries(VARS).map(([k, v]) => `<option value="${k}">${v}</option>`).join("")}</select>
      <select id="corEst">${Object.entries(EST).map(([k, v]) => `<option value="${k}">${v}</option>`).join("")}</select></div>
    <div class="htools"><input id="corAnt" placeholder="Valor anterior" size="10"><input id="corNue" placeholder="Valor nuevo" size="10">
      <input id="corMot" placeholder="Motivo (ej. pluviómetro tapado)" size="42" maxlength="300"><input id="corQuien" placeholder="Responsable" size="14" maxlength="40" value="${esc(quien)}">
      <input type="hidden" id="corId"><button id="corGuardar">Guardar</button><button id="corLimpiar">Limpiar</button><span id="corMsg" style="font-size:13px"></span></div>
    <h4 style="margin-top:18px">Correcciones registradas</h4>
    <div class="htools"><input id="corFiltro" placeholder="Filtrar por estación, motivo o responsable" size="36"></div><div id="corLista"><p style="color:var(--mu)">Cargando…</p></div>`;
  $("#corGuardar").addEventListener("click", guardar);
  $("#corLimpiar").addEventListener("click", () => { llenar({}); $("#corMsg").textContent = ""; });
  $("#corFiltro").addEventListener("input", ev => { filtro = ev.target.value; lista(); });
  s.addEventListener("click", async ev => {
    const q = ev.target.dataset.qt, e = ev.target.dataset.ed;
    if (e && C[e]){ llenar({id: e, ...C[e]}); $("#corMsg").style.color = "var(--mu)"; $("#corMsg").textContent = "Editando: modifique y pulse Guardar."; scrollTo({top: 0, behavior: "smooth"}); }
    if (q && confirm("¿Quitar esta corrección? El dato vuelve a verse como original.")){
      try { await api({borrar: q}); delete C[q]; lista(); } catch (er){ $("#corMsg").style.color = "var(--sos)"; $("#corMsg").textContent = er.message; }
    }
  });
  cargar();
}
window.CORR = {pagina};
})();
