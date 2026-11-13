/* Gráficos y tablas del Super automático.
   - SG.alerta(box, e, H, grp, hora): gráficos de 24 h (minutario) de la variable de una alerta, con las alertas marcadas, y la tabla (cada 30 min o minuto a minuto ±30 min de la alerta).
   - SG.estacion(box, e, periodo): pestaña «Estación»: Hora (24 h por minuto), Día (2 días por hora), Semana (7 días por hora), Mes y Año (valores diarios).
   Fuentes: /api/minutarios (archivo horario de la rama «datos», desde el 8/11/2026) y datos/diario/AAAA/MM.json (resumen diario que arma el control en cada pasada). */
(function(){
const $ = s => document.querySelector(s);
const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;"})[c]);
const RAW = "https://raw.githubusercontent.com/orlalv/metotec/datos/";
const V = {T: ["Ts", "°C", "#e7b03b"], Td: ["Td", "°C", "#5aa9e6"], HR: ["HR", "%", "#5aa9e6"], P_est: ["QFE", "hPa", "#e7b03b"], P_mar: ["QFF", "hPa", "#5aa9e6"], ff10: ["Viento 10 min", "kt", "#e7b03b"], fx10: ["Racha", "kt", "#e5534b"],
  dd10: ["Dirección", "°", "#5aa9e6"], rr1m: ["Agua caída 1 min", "mm", "#5aa9e6"], rr6: ["RRR6 informada", "mm", "#e7b03b"], Tn12: ["Tn12 (mínima 12 h)", "°C", "#5aa9e6"], Tx12: ["Tx12 (máxima 12 h)", "°C", "#e5534b"],
  rrh: ["Agua caída (suma)", "mm", "#5aa9e6"],
  tmin: ["Ts mínima", "°C", "#5aa9e6"], tmax: ["Ts máxima", "°C", "#e5534b"], tmed: ["Ts media", "°C", "#e7b03b"], hrmed: ["HR media", "%", "#5aa9e6"], pest: ["QFE medio", "hPa", "#e7b03b"], pmar: ["QFF medio", "hPa", "#5aa9e6"],
  ffmax: ["Viento máx.", "kt", "#e7b03b"], fxmax: ["Racha máx.", "kt", "#e5534b"], rr: ["Agua caída del día", "mm", "#5aa9e6"]};
const GR = {tem: ["Temperaturas", [["T", "Td"], ["HR"]]], pre: ["Presiones", [["P_est"], ["P_mar"]]], vie: ["Viento", [["ff10", "fx10"], ["dd10"]]], pp: ["Agua caída", [["rr1m"], ["rr6"]]], ext: ["Extremas", [["T", "Tn12", "Tx12"]]]};
const f2 = v => v == null ? "—" : (Math.round(v * 100) / 100).toString();
const iso = t => new Date(t).toISOString().slice(0, 13);

// ---------------------------------------------------------------- datos
const CM = new Map();
async function minuto(cod, a, b){            // filas minutarias entre a y b (ms), en tramos de 48 h
  const k = `${cod}|${iso(a)}|${iso(b)}`; if (CM.has(k)) return CM.get(k);
  const tramos = []; for (let t = a; t < b; t += 48 * 3600e3) tramos.push([t, Math.min(t + 48 * 3600e3, b)]);
  const p = Promise.all(tramos.map(async ([x, y]) => { const r = await fetch(`/api/minutarios?cod=${cod}&desde=${iso(x)}&hasta=${iso(y)}`, {cache: "no-store"}); if (!r.ok) throw new Error(r.status); return r.json(); })).then(R => {
    const F = new Map();
    R.forEach(j => { const cab = (j.cab || "").split(","); (j.filas || []).forEach(l => { const v = l.split(","), o = {t: Date.parse(v[1].replace(" ", "T") + "Z")}; cab.forEach((c, i) => { if (i > 1) o[c] = v[i] === "" ? null : +v[i]; }); F.set(o.t, o); }); });
    return [...F.values()].filter(o => o.t > a && o.t <= b).sort((p, q) => p.t - q.t); });
  CM.set(k, p); p.catch(() => CM.delete(k)); return p;
}
function porHora(F){                           // un valor por hora: el del minuto 00 (o el primero), lluvia sumada, racha máxima
  const G = new Map(); F.forEach(o => { const h = Math.floor(o.t / 3600e3) * 3600e3; (G.get(h) || G.set(h, []).get(h)).push(o); });
  return [...G.entries()].map(([h, L]) => { const pr = L.find(o => new Date(o.t).getUTCMinutes() === 0) || L[0], o = {...pr, t: h};
    o.rrh = L.some(x => x.rr1m != null) ? Math.round(L.reduce((a, x) => a + (x.rr1m || 0), 0) * 10) / 10 : null; o.fx10 = Math.max(...L.map(x => x.fx10 ?? -1)); if (o.fx10 < 0) o.fx10 = null; return o; }).sort((a, b) => a.t - b.t);
}
const CD = new Map();
async function diarios(cod, a, b){             // valores diarios (resumen del control) entre a y b (ms)
  const meses = []; for (let d = new Date(Date.UTC(new Date(a).getUTCFullYear(), new Date(a).getUTCMonth(), 1)); d.getTime() <= b; d = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1))) meses.push(d.toISOString().slice(0, 7).replace("-", "/"));
  const out = [];
  await Promise.all(meses.map(async m => { if (!CD.has(m)) CD.set(m, fetch(`${RAW}diario/${m}.json`).then(r => r.ok ? r.json() : null).catch(() => null)); }));
  for (const m of meses){ const M = await CD.get(m); if (!M) continue;
    Object.entries(M.dias || {}).forEach(([d, E]) => { const v = E[cod]; if (!v) return; const t = Date.parse(d + "T12:00:00Z"); if (t < a || t > b) return; const o = {t}; M.campos.forEach((c, i) => o[c] = v[i]); out.push(o); }); }
  return out.sort((x, y) => x.t - y.t);
}

// ---------------------------------------------------------------- dibujo
function linea(F, vs, o = {}){
  const W = 760, Ht = 170, mi = 46, md = 10, mt = 10, mb = 20; if (!F.length) return "";
  const t0 = F[0].t, t1 = F[F.length - 1].t, x = t => mi + (t - t0) / ((t1 - t0) || 1) * (W - mi - md);
  const Z = F.flatMap(r => vs.map(v => r[v]).filter(y => y != null)); if (!Z.length) return "";
  let lo = Math.min(...Z), hi = Math.max(...Z); if (o.cero) lo = Math.min(0, lo); if (hi - lo < 1e-6){ lo -= 1; hi += 1; } const pad = (hi - lo) * .08; if (!o.cero) lo -= pad; hi += pad;
  const y = v => mt + (1 - (v - lo) / (hi - lo)) * (Ht - mt - mb);
  const ejes = [0, .5, 1].map(f => { const v = lo + (hi - lo) * f; return `<line x1="${mi}" x2="${W - md}" y1="${y(v)}" y2="${y(v)}" stroke="var(--bd)" stroke-width=".6"/><text x="${mi - 4}" y="${y(v) + 3}" text-anchor="end" font-size="10" fill="var(--mu)">${v.toFixed(Math.abs(hi - lo) < 5 ? 1 : 0)}</text>`; }).join("");
  const largo = (t1 - t0) / 864e5, paso = largo <= 3 ? 3 * 3600e3 : largo <= 9 ? 864e5 : largo <= 40 ? 5 * 864e5 : 30 * 864e5, ej = [];
  for (let t = Math.ceil(t0 / paso) * paso; t <= t1; t += paso) ej.push(t);
  const eje = ej.map(t => `<text x="${x(t)}" y="${Ht - 5}" text-anchor="middle" font-size="10" fill="var(--mu)">${largo <= 3 ? new Date(t).toISOString().slice(11, 13) : new Date(t).toISOString().slice(8, 10) + "/" + new Date(t).toISOString().slice(5, 7)}</text>`).join("");
  const bw = Math.max(1.5, (W - mi - md) / Math.max(F.length, 1) * .7);
  const dib = vs.map(v => o.barras ? F.filter(r => r[v] != null).map(r => `<rect x="${(x(r.t) - bw / 2).toFixed(1)}" y="${y(r[v]).toFixed(1)}" width="${bw.toFixed(1)}" height="${Math.max(0, y(Math.max(lo, 0)) - y(r[v])).toFixed(1)}" fill="${V[v][2]}"/>`).join("")
    : (() => { const pts = F.filter(r => r[v] != null).map(r => `${x(r.t).toFixed(1)},${y(r[v]).toFixed(1)}`); return pts.length ? `<polyline fill="none" stroke="${V[v][2]}" stroke-width="1.4" points="${pts.join(" ")}"/>` : ""; })()).join("");
  const mk = (o.marcas || []).filter(t => t >= t0 && t <= t1).map(t => `<line x1="${x(t)}" x2="${x(t)}" y1="${mt}" y2="${Ht - mb}" stroke="#e5534b" stroke-width="1.2" stroke-dasharray="3 3"/>`).join("") + (o.sel && o.sel >= t0 && o.sel <= t1 ? `<line x1="${x(o.sel)}" x2="${x(o.sel)}" y1="${mt}" y2="${Ht - mb}" stroke="var(--oro)" stroke-width="2"/>` : "");
  return `<div style="margin-bottom:6px"><div style="font-size:12px;color:var(--mu)">${vs.map(v => `<b style="color:${V[v][2]}">━</b> ${V[v][0]} (${V[v][1]})`).join(" &nbsp; ")} · hora UTC${(o.marcas || []).length ? ' · <span style="color:#e5534b">┆ alerta</span>' : ""}</div>
    <svg viewBox="0 0 ${W} ${Ht}" style="width:100%;max-width:${W}px;height:auto">${ejes}${eje}${dib}${mk}</svg></div>`;
}
const fecha = (t, dia) => { const s = new Date(t).toISOString(); return dia ? `${s.slice(8, 10)}/${s.slice(5, 7)}/${s.slice(0, 4)}` : `${s.slice(8, 10)}/${s.slice(5, 7)} ${s.slice(11, 16)}`; };
const tabla = (F, cols, sel, dia) => `<div style="max-height:260px;overflow:auto"><table class="xtab"><tr><th>${dia ? "Día" : "UTC"}</th>${cols.map(v => `<th>${esc(V[v][0])}${V[v][1] ? ` <small>(${V[v][1]})</small>` : ""}</th>`).join("")}</tr>${F.map(o => `<tr${sel && o.t === sel ? ' style="background:color-mix(in srgb,var(--oro) 18%,transparent)"' : ""}><td style="white-space:nowrap">${fecha(o.t, dia)}</td>${cols.map(v => `<td class="n">${f2(o[v])}</td>`).join("")}</tr>`).join("")}</table></div>`;

// ---------------------------------------------------------------- alertas: gráfico de 24 h de la variable de la alerta
async function alerta(box, e, H, grp, hora){
  const fin = Date.parse(((window.supGen && window.supGen()) || new Date().toISOString().slice(0, 19)) + "Z");
  box.dataset.c = e.codigo; box.dataset.g = GR[grp] ? grp : "tem"; if (hora !== undefined) box.dataset.h = hora || "";
  const g = box.dataset.g, sel = box.dataset.h || "", ms = sel ? Date.parse(sel + ":00Z") : null;
  box.innerHTML = `<div class="sgsub">${Object.entries(GR).map(([k, [n]]) => `<button data-sg2="${k}" class="${k === g ? "on" : ""}">${n}</button>`).join("")}</div><div class="supc" style="color:var(--mu)">Cargando…</div>`;
  let F; try { F = await minuto(e.codigo, fin - 24 * 3600e3, fin); } catch (x) { box.querySelector(".supc").textContent = "No se pudieron leer los datos (" + x.message + ")."; return; }
  if (box.dataset.c !== e.codigo || box.dataset.g !== g) return;
  const c = box.querySelector(".supc"); if (!F.length){ c.textContent = "Sin datos minutarios en las últimas 24 h."; return; }
  const marcas = H.filter(h => h.tipo === g).map(h => Date.parse(h.hora + ":00Z"));
  const cols = GR[g][1].flat().filter((v, i, a) => a.indexOf(v) === i);
  const filas = ms ? F.filter(o => Math.abs(o.t - ms) <= 30 * 60e3) : F.filter(o => new Date(o.t).getUTCMinutes() % 30 === 0).reverse();
  c.style.color = "";
  c.innerHTML = GR[g][1].map(vs => linea(F, vs, {marcas, sel: ms, barras: false})).join("") +
    `<div style="font-size:12px;color:var(--mu);margin:4px 0">${ms ? `Minuto a minuto, ±30 min de la alerta ${esc(fecha(ms))} UTC · <a href="#" data-sg2h="">volver a cada 30 min</a>` : "Cada 30 min (haga clic en una alerta para ver minuto a minuto)"}</div>` + tabla(filas, cols, ms);
}

// ---------------------------------------------------------------- pestaña «Estación»: Hora, Día, Semana, Mes, Año
const PER = {hora: ["Hora", "últimas 24 h, minuto a minuto"], dia: ["Día", "últimos 2 días, un valor por hora"], semana: ["Semana", "últimos 7 días, un valor por hora"], mes: ["Mes", "últimos 30 días, valores diarios"], anio: ["Año", "últimos 365 días, valores diarios"]};
const kpi = (n, t) => `<div><b>${n}</b><span>${esc(t)}</span></div>`;
const mm = (L, v, f) => { const x = L.map(o => o[v]).filter(y => y != null); return x.length ? f(...x) : null; };
async function estacion(box, e, per){
  per = PER[per] ? per : "hora"; box.dataset.c = e.codigo; box.dataset.p = per;
  const fin = Date.parse(((window.supGen && window.supGen()) || new Date().toISOString().slice(0, 19)) + "Z");
  box.innerHTML = `<div class="sgsub">${Object.entries(PER).map(([k, [n]]) => `<button data-per="${k}" class="${k === per ? "on" : ""}">${n}</button>`).join("")}</div><div class="supc" style="color:var(--mu)">Cargando…</div>`;
  const c = box.querySelector(".supc"), ok = () => box.dataset.c === e.codigo && box.dataset.p === per;
  const dias = {hora: 1, dia: 2, semana: 7, mes: 30, anio: 365}[per], a = fin - dias * 864e5, diario = per === "mes" || per === "anio";
  let F; try { F = diario ? await diarios(e.codigo, a, fin) : await minuto(e.codigo, a, fin); if (!diario && per !== "hora") F = porHora(F); } catch (x) { if (ok()) c.textContent = "No se pudieron leer los datos (" + x.message + ")."; return; }
  if (!ok()) return;
  const desde = "8/11/2026", nota = `<p class="nota" style="color:var(--mu);font-size:12px;margin:2px 0 8px">${esc(PER[per][1])}. El archivo de datos minutarios parte el ${desde}${diario ? "; los valores diarios se acumulan desde esa fecha y se van completando con cada pasada del control" : ""}.</p>`;
  if (!F.length){ c.innerHTML = nota + `<p style="color:var(--sos)">Sin datos en ese período para esta estación.</p>`; return; }
  const dia1 = new Date(F[0].t).toISOString().slice(0, 10), falta = diario && F[0].t > a + 3 * 864e5 ? `<p style="color:var(--sos);font-size:12.5px">Hay datos desde el ${fecha(F[0].t, true)} (${F.length} días); el resto del período es anterior al archivo.</p>` : "";
  let kp, graf, cols;
  if (diario){
    kp = [kpi(f2(mm(F, "tmin", Math.min)) + " °C", "Ts mínima"), kpi(f2(mm(F, "tmax", Math.max)) + " °C", "Ts máxima"), kpi(f2(mm(F, "rr", (...x) => Math.round(x.reduce((p, q) => p + q, 0) * 10) / 10)) + " mm", "agua caída total"), kpi(f2(mm(F, "ffmax", Math.max)) + " kt", "viento máx."), kpi(f2(mm(F, "fxmax", Math.max)) + " kt", "racha máx."), kpi(F.length, "días con datos")];
    graf = [["tmax", "tmin", "tmed"], ["hrmed"], ["pest"], ["pmar"], ["ffmax", "fxmax"]].map(vs => linea(F, vs)).join("") + linea(F, ["rr"], {barras: true, cero: true});
    cols = ["tmin", "tmax", "tmed", "hrmed", "pest", "pmar", "ffmax", "fxmax", "rr"];
  } else {
    const rr = per === "hora" ? F.reduce((p, o) => p + (o.rr1m || 0), 0) : F.reduce((p, o) => p + (o.rrh || 0), 0);
    kp = [kpi(f2(mm(F, "T", Math.min)) + " °C", "Ts mínima"), kpi(f2(mm(F, "T", Math.max)) + " °C", "Ts máxima"), kpi(f2(Math.round(rr * 10) / 10) + " mm", "agua caída"), kpi(f2(mm(F, "ff10", Math.max)) + " kt", "viento máx."), kpi(f2(mm(F, "fx10", Math.max)) + " kt", "racha máx."), kpi(f2(mm(F, "P_est", Math.min)) + " – " + f2(mm(F, "P_est", Math.max)), "QFE (hPa)")];
    graf = [["T", "Td"], ["HR"], ["P_est"], ["P_mar"], ["ff10", "fx10"]].map(vs => linea(F, vs)).join("") + linea(F, [per === "hora" ? "rr1m" : "rrh"], {barras: true, cero: true});
    cols = per === "hora" ? ["T", "Td", "HR", "P_est", "P_mar", "ff10", "fx10", "dd10", "rr1m"] : ["T", "Td", "HR", "P_est", "P_mar", "ff10", "fx10", "dd10", "rrh"];
  }
  const filas = per === "hora" ? F.filter(o => new Date(o.t).getUTCMinutes() % 10 === 0).reverse() : [...F].reverse();
  c.style.color = ""; c.innerHTML = nota + falta + `<div class="hres" style="margin-bottom:8px">${kp.join("")}</div>${graf}<h4 style="margin:10px 0 4px">Tabla${per === "hora" ? " (cada 10 min)" : ""}</h4>` + tabla(filas, cols, 0, diario);
}

// los botones de período y de variable se resuelven aquí para cualquier caja .supbox
document.addEventListener("click", ev => {
  const bp = ev.target.closest("button[data-per]"), bg = ev.target.closest("button[data-sg2]"), a = ev.target.closest("a[data-sg2h]");
  const box = (bp || bg || a) && (bp || bg || a).closest(".supbox"); if (!box) return;
  const e = window.supEst && window.supEst(box.dataset.c); if (!e) return;
  if (bp) return estacion(box, e, bp.dataset.per);
  if (a){ ev.preventDefault(); return alerta(box, e, e.hallazgos, box.dataset.g, ""); }
  alerta(box, e, e.hallazgos, bg.dataset.sg2, box.dataset.h);
});
window.SG = {alerta, estacion, GR, PER};
})();
