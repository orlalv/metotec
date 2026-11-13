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
(function(){ const st = document.createElement("style"); st.textContent = `.supgrid{display:grid;grid-template-columns:repeat(auto-fit,minmax(470px,1fr));gap:12px;margin-bottom:10px}
.supch{position:relative;background:var(--panel);border:1px solid var(--bd);border-radius:10px;padding:8px 10px 4px}.supch h5{margin:0 0 2px;font:700 13px var(--titulo,inherit);display:flex;flex-wrap:wrap;gap:4px 14px;align-items:baseline}
.supch h5 small{font:500 11.5px inherit;color:var(--mu)}.supch h5 i{display:inline-block;width:10px;height:10px;border-radius:50%;margin-right:4px;vertical-align:-1px}.supch svg{display:block;width:100%;height:auto;cursor:crosshair}
.sgtip{position:absolute;pointer-events:none;background:var(--panel);border:1px solid var(--oro);border-radius:8px;padding:5px 9px;font-size:12px;line-height:1.45;white-space:nowrap;z-index:6;box-shadow:0 4px 14px rgba(0,0,0,.35)}.sgtip b{display:block;color:var(--oro);margin-bottom:1px}
.supkpi{display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:8px;margin:6px 0 12px}.supkpi div{background:var(--panel);border:1px solid var(--bd);border-radius:10px;padding:8px 12px}.supkpi b{display:block;font:700 19px var(--titulo,inherit)}.supkpi span{font-size:12px;color:var(--mu)}`; document.head.appendChild(st); })();
const CH = new Map(); let CHN = 0;
function ticks(lo, hi, n = 5){                 // marcas "redondas" del eje y
  const paso0 = (hi - lo) / n, mag = Math.pow(10, Math.floor(Math.log10(paso0))), f = paso0 / mag, paso = (f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10) * mag, T = [];
  for (let v = Math.ceil(lo / paso) * paso; v <= hi + 1e-9; v += paso) T.push(Math.round(v / paso) * paso);
  return {T, paso};
}
function linea(F, vs, o = {}){
  const W = 640, Ht = 240, mi = 54, md = 16, mt = 14, mb = 28; if (!F.length) return "";
  const t0 = F[0].t, t1 = F[F.length - 1].t, x = t => mi + (t - t0) / ((t1 - t0) || 1) * (W - mi - md);
  const otros = (o.barras ? [] : o.otros || []).filter(q => q.F && q.F.length);
  const Z = F.flatMap(r => vs.map(v => r[v]).filter(y => y != null)).concat(otros.flatMap(q => q.F.map(r => r[vs[0]]).filter(y => y != null))); if (!Z.length) return "";
  let lo = Math.min(...Z), hi = Math.max(...Z); if (o.cero) lo = Math.min(0, lo); if (hi - lo < 1e-6){ lo -= 1; hi += 1; } const pad = (hi - lo) * .1; if (!o.cero) lo -= pad; hi += pad;
  const y = v => mt + (1 - (v - lo) / (hi - lo)) * (Ht - mt - mb), tk = ticks(lo, hi), dec = tk.paso < 1 ? (tk.paso < .1 ? 2 : 1) : 0;
  const ejes = tk.T.map(v => `<line x1="${mi}" x2="${W - md}" y1="${y(v).toFixed(1)}" y2="${y(v).toFixed(1)}" stroke="var(--bd)" stroke-width=".6" stroke-dasharray="${v === 0 ? "0" : "2 3"}"/><text x="${mi - 6}" y="${(y(v) + 3.5).toFixed(1)}" text-anchor="end" font-size="11" fill="var(--mu)">${v.toFixed(dec)}</text>`).join("");
  const largo = (t1 - t0) / 864e5, paso = largo <= 1.2 ? 3 * 3600e3 : largo <= 3 ? 6 * 3600e3 : largo <= 9 ? 864e5 : largo <= 40 ? 5 * 864e5 : 30 * 864e5, ej = [];
  for (let t = Math.ceil(t0 / paso) * paso; t <= t1; t += paso) ej.push(t);
  const etq = t => { const d = new Date(t).toISOString(); return largo <= 3 ? (d.slice(11, 13) === "00" && largo > 1.2 ? d.slice(8, 10) + "/" + d.slice(5, 7) : d.slice(11, 13) + "h") : d.slice(8, 10) + "/" + d.slice(5, 7); };
  const eje = ej.map(t => `<line x1="${x(t).toFixed(1)}" x2="${x(t).toFixed(1)}" y1="${mt}" y2="${Ht - mb}" stroke="var(--bd)" stroke-width=".4"/><text x="${x(t).toFixed(1)}" y="${Ht - 9}" text-anchor="middle" font-size="11" fill="var(--mu)">${etq(t)}</text>`).join("");
  const bw = Math.max(2, (W - mi - md) / Math.max(F.length, 1) * .72), y0 = y(Math.max(lo, 0));
  const dib = vs.map(v => { const c = V[v][2], P = F.filter(r => r[v] != null);
    if (o.barras) return P.map(r => `<rect x="${(x(r.t) - bw / 2).toFixed(1)}" y="${y(r[v]).toFixed(1)}" width="${bw.toFixed(1)}" height="${Math.max(0, y0 - y(r[v])).toFixed(1)}" fill="${c}" opacity=".85"/>`).join("");
    if (!P.length) return "";
    const pts = P.map(r => `${x(r.t).toFixed(1)},${y(r[v]).toFixed(1)}`), area = vs.length === 1 ? `<polygon points="${x(P[0].t).toFixed(1)},${y0.toFixed(1)} ${pts.join(" ")} ${x(P[P.length - 1].t).toFixed(1)},${y0.toFixed(1)}" fill="${c}" opacity=".13"/>` : "";
    return area + `<polyline fill="none" stroke="${c}" stroke-width="1.8" stroke-linejoin="round" points="${pts.join(" ")}"/>`; }).join("");
  const ext = o.barras ? "" : (() => { const v = vs[0], P = F.filter(r => r[v] != null); if (!P.length) return ""; const mn = P.reduce((a, r) => r[v] < a[v] ? r : a), mx = P.reduce((a, r) => r[v] > a[v] ? r : a);
    const m = (r, up) => `<circle cx="${x(r.t).toFixed(1)}" cy="${y(r[v]).toFixed(1)}" r="3" fill="${V[v][2]}" stroke="var(--panel)" stroke-width="1"/><text x="${Math.min(Math.max(x(r.t), mi + 14), W - md - 14).toFixed(1)}" y="${(y(r[v]) + (up ? -7 : 14)).toFixed(1)}" text-anchor="middle" font-size="10.5" font-weight="700" fill="${V[v][2]}">${r[v].toFixed(dec > 0 ? 1 : 0)}</text>`;
    return (mx === mn ? "" : m(mx, true) + m(mn, false)); })();
  const dibO = otros.map(q => { const P = q.F.filter(r => r[vs[0]] != null && r.t >= t0 && r.t <= t1); return P.length ? `<polyline fill="none" stroke="${q.color}" stroke-width="1.5" stroke-dasharray="5 3" stroke-linejoin="round" points="${P.map(r => `${x(r.t).toFixed(1)},${y(r[vs[0]]).toFixed(1)}`).join(" ")}"/>` : ""; }).join("");
  const mk = (o.marcas || []).filter(t => t >= t0 && t <= t1).map(t => `<line x1="${x(t).toFixed(1)}" x2="${x(t).toFixed(1)}" y1="${mt}" y2="${Ht - mb}" stroke="#e5534b" stroke-width="1.4" stroke-dasharray="4 3"/>`).join("") + (o.sel && o.sel >= t0 && o.sel <= t1 ? `<line x1="${x(o.sel).toFixed(1)}" x2="${x(o.sel).toFixed(1)}" y1="${mt}" y2="${Ht - mb}" stroke="var(--oro)" stroke-width="2.4"/>` : "");
  const id = "c" + (++CHN); CH.set(id, {otros, F, vs, W, mi, md, t0, t1, mt, Ht, mb, y, x, lo, hi, dia: o.dia});
  if (CH.size > 80) CH.delete(CH.keys().next().value);
  return `<div class="supch" data-id="${id}"><h5>${vs.map(v => `<span><i style="background:${V[v][2]}"></i>${esc(V[v][0])} <small>(${V[v][1]})</small></span>`).join("")}${otros.map(q => `<span><i style="background:${q.color}"></i>${esc(q.nom)} <small>(${esc(V[vs[0]][0])}, punteado)</small></span>`).join("")}${(o.marcas || []).length ? '<small style="color:#e5534b">┆ alerta</small>' : ""}</h5>
    <svg viewBox="0 0 ${W} ${Ht}">${ejes}${eje}${dib}${dibO}${ext}${mk}<line class="xh" y1="${mt}" y2="${Ht - mb}" stroke="var(--tx)" stroke-width="1" opacity="0" stroke-dasharray="3 3"/><g class="dots"></g></svg><div class="sgtip" hidden></div></div>`;
}
const cercano = (F, t) => { let a = 0, b = F.length - 1; if (!F.length) return null; while (b - a > 1){ const m = (a + b) >> 1; (F[m].t < t ? a = m : b = m); } const r = Math.abs(F[a].t - t) <= Math.abs(F[b].t - t) ? F[a] : F[b]; return Math.abs(r.t - t) <= 36 * 3600e3 / 24 ? r : null; };
const COLV = ["#8bd17c", "#c792ea", "#ff9f6b", "#59d0c9"];
const grid = L => `<div class="supgrid">${L.join("")}</div>`;
// al pasar el mouse: línea guía, puntos y recuadro con los valores de ese instante
document.addEventListener("mousemove", ev => {
  const svg = ev.target.closest && ev.target.closest(".supch svg"); if (!svg){ document.querySelectorAll(".supch .sgtip:not([hidden])").forEach(t => { t.hidden = true; const s = t.parentNode.querySelector("svg"); s.querySelector(".xh").setAttribute("opacity", 0); s.querySelector(".dots").innerHTML = ""; }); return; }
  const box = svg.parentNode, c = CH.get(box.dataset.id); if (!c) return;
  const r = svg.getBoundingClientRect(), sx = (ev.clientX - r.left) / r.width * c.W, t = c.t0 + (sx - c.mi) / (c.W - c.mi - c.md) * (c.t1 - c.t0);
  let a = 0, b = c.F.length - 1; while (b - a > 1){ const m = (a + b) >> 1; (c.F[m].t < t ? a = m : b = m); }
  const o = Math.abs(c.F[a].t - t) <= Math.abs(c.F[b].t - t) ? c.F[a] : c.F[b], xx = c.x(o.t);
  const xh = svg.querySelector(".xh"); xh.setAttribute("x1", xx); xh.setAttribute("x2", xx); xh.setAttribute("opacity", .7);
  svg.querySelector(".dots").innerHTML = c.vs.filter(v => o[v] != null).map(v => `<circle cx="${xx}" cy="${c.y(o[v])}" r="4" fill="${V[v][2]}" stroke="var(--panel)" stroke-width="1.5"/>`).join("");
  const tip = box.querySelector(".sgtip"); tip.hidden = false;
  tip.innerHTML = `<b>${fecha(o.t, c.dia)}${c.dia ? "" : " UTC"}</b>` + c.vs.map(v => `<span style="color:${V[v][2]}">●</span> ${esc(V[v][0])}: <b style="display:inline;color:var(--tx)">${o[v] == null ? "—" : f2(o[v])} ${V[v][1]}</b>`).join("<br>") +
    (c.otros || []).map(q => { const k = cercano(q.F, o.t); return `<br><span style="color:${q.color}">●</span> ${esc(q.nom)}: <b style="display:inline;color:var(--tx)">${k && k[c.vs[0]] != null ? f2(k[c.vs[0]]) + " " + V[c.vs[0]][1] : "—"}</b>`; }).join("");
  const px = (xx / c.W) * r.width, bw = box.getBoundingClientRect(), left = px + (svg.getBoundingClientRect().left - bw.left);
  tip.style.left = (left + 14 + tip.offsetWidth > bw.width ? left - tip.offsetWidth - 14 : left + 14) + "px"; tip.style.top = "38px";
});
const fecha = (t, dia) => { const s = new Date(t).toISOString(); return dia ? `${s.slice(8, 10)}/${s.slice(5, 7)}/${s.slice(0, 4)}` : `${s.slice(8, 10)}/${s.slice(5, 7)} ${s.slice(11, 16)}`; };
const tabla = (F, cols, sel, dia) => `<div style="max-height:260px;overflow:auto"><table class="xtab"><tr><th>${dia ? "Día" : "UTC"}</th>${cols.map(v => `<th>${esc(V[v][0])}${V[v][1] ? ` <small>(${V[v][1]})</small>` : ""}</th>`).join("")}</tr>${F.map(o => `<tr${sel && o.t === sel ? ' style="background:color-mix(in srgb,var(--oro) 18%,transparent)"' : ""}><td style="white-space:nowrap">${fecha(o.t, dia)}</td>${cols.map(v => `<td class="n">${f2(o[v])}</td>`).join("")}</tr>`).join("")}</table></div>`;

// estaciones cercanas (con o sin observador) para comparar en los mismos gráficos
const vecinas = cod => (window.supVec ? window.supVec(cod) : []);
function chipsVec(box, e){
  const V2 = vecinas(e.codigo), sel = (box.dataset.vec || "").split(",").filter(Boolean); if (!V2.length) return "";
  return `<div class="sgsub" style="align-items:center"><span style="font-size:12px;color:var(--mu)">Comparar con estaciones cercanas:</span>${V2.map(v => `<button data-vec="${v.codigo}" class="${sel.includes(v.codigo) ? "on" : ""}" title="${v.obs ? "con observador" : "sin observador"} · ${v.codigo}">${esc(v.nombre)}${v.obs ? " · obs." : ""}</button>`).join("")}</div>`;
}
async function cargarVec(box, e, traer){
  const V2 = vecinas(e.codigo), sel = (box.dataset.vec || "").split(",").filter(Boolean).filter(c => V2.some(v => v.codigo === c));
  return Promise.all(sel.map(async (c, i) => ({nom: (V2.find(v => v.codigo === c) || {}).nombre || c, color: COLV[i % COLV.length], F: await traer(c).catch(() => [])})));
}
// ---------------------------------------------------------------- alertas: gráfico de 24 h de la variable de la alerta
async function alerta(box, e, H, grp, hora){
  const fin = Date.parse(((window.supGen && window.supGen()) || new Date().toISOString().slice(0, 19)) + "Z");
  box.dataset.c = e.codigo; box.dataset.g = GR[grp] ? grp : "tem"; if (hora !== undefined) box.dataset.h = hora || "";
  const g = box.dataset.g, sel = box.dataset.h || "", ms = sel ? Date.parse(sel + ":00Z") : null;
  box.innerHTML = `<div class="sgsub">${Object.entries(GR).map(([k, [n]]) => `<button data-sg2="${k}" class="${k === g ? "on" : ""}">${n}</button>`).join("")}</div>${chipsVec(box, e)}<div class="supc" style="color:var(--mu)">Cargando…</div>`;
  let F, otros; try { F = await minuto(e.codigo, fin - 24 * 3600e3, fin); otros = await cargarVec(box, e, c => minuto(c, fin - 24 * 3600e3, fin)); } catch (x) { box.querySelector(".supc").textContent = "No se pudieron leer los datos (" + x.message + ")."; return; }
  if (box.dataset.c !== e.codigo || box.dataset.g !== g) return;
  const c = box.querySelector(".supc"); if (!F.length){ c.textContent = "Sin datos minutarios en las últimas 24 h."; return; }
  const marcas = H.filter(h => h.tipo === g).map(h => Date.parse(h.hora + ":00Z"));
  const cols = GR[g][1].flat().filter((v, i, a) => a.indexOf(v) === i);
  const filas = ms ? F.filter(o => Math.abs(o.t - ms) <= 30 * 60e3) : F.filter(o => new Date(o.t).getUTCMinutes() % 30 === 0).reverse();
  c.style.color = "";
  c.innerHTML = grid(GR[g][1].map(vs => linea(F, vs, {marcas, sel: ms, otros}))) +
    `<div style="font-size:12px;color:var(--mu);margin:4px 0">${ms ? `Minuto a minuto, ±30 min de la alerta ${esc(fecha(ms))} UTC · <a href="#" data-sg2h="">volver a cada 30 min</a>` : "Cada 30 min (haga clic en una alerta para ver minuto a minuto)"}</div>` + tabla(filas, cols, ms);
}

// ---------------------------------------------------------------- pestaña «Estación»: Hora, Día, Semana, Mes, Año
const PER = {hora: ["Hora", "últimas 24 h, minuto a minuto"], dia: ["Día", "últimos 2 días, un valor por hora"], semana: ["Semana", "últimos 7 días, un valor por hora"], mes: ["Mes", "últimos 30 días, valores diarios"], anio: ["Año", "últimos 365 días, valores diarios"]};
const kpi = (n, t) => `<div><b>${n}</b><span>${esc(t)}</span></div>`;
const fmtF = (t, dia) => fecha(t, dia);
const mm = (L, v, f) => { const x = L.map(o => o[v]).filter(y => y != null); return x.length ? f(...x) : null; };
async function estacion(box, e, per){
  per = PER[per] ? per : "hora"; box.dataset.c = e.codigo; box.dataset.p = per;
  const fin = Date.parse(((window.supGen && window.supGen()) || new Date().toISOString().slice(0, 19)) + "Z");
  box.innerHTML = `<div class="sgsub">${Object.entries(PER).map(([k, [n]]) => `<button data-per="${k}" class="${k === per ? "on" : ""}">${n}</button>`).join("")}</div>${chipsVec(box, e)}<div class="supc" style="color:var(--mu)">Cargando…</div>`;
  const c = box.querySelector(".supc"), ok = () => box.dataset.c === e.codigo && box.dataset.p === per;
  const dias = {hora: 1, dia: 2, semana: 7, mes: 30, anio: 365}[per], a = fin - dias * 864e5, diario = per === "mes" || per === "anio";
  const traer = async c => { let X = diario ? await diarios(c, a, fin) : await minuto(c, a, fin); if (!diario && per !== "hora") X = porHora(X); return X; };
  let F, otros; try { F = await traer(e.codigo); otros = await cargarVec(box, e, traer); } catch (x) { if (ok()) c.textContent = "No se pudieron leer los datos (" + x.message + ")."; return; }
  if (!ok()) return;
  const desde = "8/11/2026", nota = `<p class="nota" style="color:var(--mu);font-size:12px;margin:2px 0 8px">${esc(PER[per][1])}. El archivo de datos minutarios parte el ${desde}${diario ? "; los valores diarios se acumulan desde esa fecha y se van completando con cada pasada del control" : ""}.</p>`;
  if (!F.length){ c.innerHTML = nota + `<p style="color:var(--sos)">Sin datos en ese período para esta estación.</p>`; return; }
  const dia1 = new Date(F[0].t).toISOString().slice(0, 10), falta = diario && F[0].t > a + 3 * 864e5 ? `<p style="color:var(--sos);font-size:12.5px">Hay datos desde el ${fecha(F[0].t, true)} (${F.length} días); el resto del período es anterior al archivo.</p>` : "";
  let kp, graf, cols;
  if (diario){
    kp = [kpi(f2(mm(F, "tmin", Math.min)) + " °C", "Ts mínima"), kpi(f2(mm(F, "tmax", Math.max)) + " °C", "Ts máxima"), kpi(f2(mm(F, "rr", (...x) => Math.round(x.reduce((p, q) => p + q, 0) * 10) / 10)) + " mm", "agua caída total"), kpi(f2(mm(F, "ffmax", Math.max)) + " kt", "viento máx."), kpi(f2(mm(F, "fxmax", Math.max)) + " kt", "racha máx."), kpi(F.length, "días con datos")];
    graf = grid([["tmax", "tmin", "tmed"], ["hrmed"], ["pest"], ["pmar"], ["ffmax", "fxmax"]].map(vs => linea(F, vs, {dia: true, otros})).concat(linea(F, ["rr"], {barras: true, cero: true, dia: true})));
    cols = ["tmin", "tmax", "tmed", "hrmed", "pest", "pmar", "ffmax", "fxmax", "rr"];
  } else {
    const rr = per === "hora" ? F.reduce((p, o) => p + (o.rr1m || 0), 0) : F.reduce((p, o) => p + (o.rrh || 0), 0);
    kp = [kpi(f2(mm(F, "T", Math.min)) + " °C", "Ts mínima"), kpi(f2(mm(F, "T", Math.max)) + " °C", "Ts máxima"), kpi(f2(Math.round(rr * 10) / 10) + " mm", "agua caída"), kpi(f2(mm(F, "ff10", Math.max)) + " kt", "viento máx."), kpi(f2(mm(F, "fx10", Math.max)) + " kt", "racha máx."), kpi(f2(mm(F, "P_est", Math.min)) + " – " + f2(mm(F, "P_est", Math.max)), "QFE (hPa)")];
    graf = grid([["T", "Td"], ["HR"], ["P_est"], ["P_mar"], ["ff10", "fx10"]].map(vs => linea(F, vs, {otros})).concat(linea(F, [per === "hora" ? "rr1m" : "rrh"], {barras: true, cero: true})));
    cols = per === "hora" ? ["T", "Td", "HR", "P_est", "P_mar", "ff10", "fx10", "dd10", "rr1m"] : ["T", "Td", "HR", "P_est", "P_mar", "ff10", "fx10", "dd10", "rrh"];
  }
  const filas = per === "hora" ? F.filter(o => new Date(o.t).getUTCMinutes() % 10 === 0).reverse() : [...F].reverse();
  c.style.color = ""; c.innerHTML = nota + falta + `<div class="supkpi">${kp.join("")}</div>${graf}<h4 style="margin:10px 0 4px">Tabla${per === "hora" ? " (cada 10 min)" : ""}</h4>` + tabla(filas, cols, 0, diario);
}

// los botones de período y de variable se resuelven aquí para cualquier caja .supbox
document.addEventListener("click", ev => {
  const bp = ev.target.closest("button[data-per]"), bg = ev.target.closest("button[data-sg2]"), a = ev.target.closest("a[data-sg2h]"), bv = ev.target.closest("button[data-vec]");
  const box = (bp || bg || a || bv) && (bp || bg || a || bv).closest(".supbox"); if (!box) return;
  const e = window.supEst && window.supEst(box.dataset.c); if (!e) return;
  if (bv){ const L = (box.dataset.vec || "").split(",").filter(Boolean), c = bv.dataset.vec, i = L.indexOf(c); if (i >= 0) L.splice(i, 1); else if (L.length < 4) L.push(c); box.dataset.vec = L.join(",");
    return box.dataset.p && !box.dataset.g ? estacion(box, e, box.dataset.p) : alerta(box, e, e.hallazgos || [], box.dataset.g, box.dataset.h); }
  if (bp) return estacion(box, e, bp.dataset.per);
  if (a){ ev.preventDefault(); return alerta(box, e, e.hallazgos, box.dataset.g, ""); }
  alerta(box, e, e.hallazgos, bg.dataset.sg2, box.dataset.h);
});
window.SG = {alerta, estacion, GR, PER, diarioMes: async m => { if (!CD.has(m)) CD.set(m, fetch(`${RAW}diario/${m}.json`).then(r => r.ok ? r.json() : null).catch(() => null)); return CD.get(m); }};
})();
