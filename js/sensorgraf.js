/* Gráfico de una alerta «frente al sensor»: la serie minuto a minuto de la estación automática en la hora previa a la
   observación, el valor que anotó el observador y un puntero para leer el valor de cualquier minuto (p. ej. :53, si en
   SACLIM se ve que la observación se ingresó a esa hora). */
(function(){
const VARS = {
  STs: {cols: ["T"], nom: "Ts", u: "°C", obs: /Ts anotado (-?[\d.]+)/},
  STd: {cols: ["Td"], nom: "Td", u: "°C", obs: /Td anotado (-?[\d.]+)/},
  SHR: {cols: ["HR"], nom: "HR", u: "%", obs: /HR anotado (-?[\d.]+)/},
  SQFE: {cols: ["P_est"], nom: "QFE", u: "hPa", obs: /QFE anotado (-?[\d.]+)/},
  SQFF: {cols: ["P_mar"], nom: "QFF", u: "hPa", obs: /QFF anotado (-?[\d.]+)/},
  Sff: {cols: ["ff10", "fx10"], nom: "Viento medio 10 min", u: "kt", obs: /viento anotado (-?[\d.]+)/},
  Sffkmh: {cols: ["ff10", "fx10"], nom: "Viento medio 10 min", u: "kt", obs: /viento anotado (-?[\d.]+)/},
  Sracha: {cols: ["ff10", "fx10"], nom: "Racha", u: "kt", obs: /racha informada (-?[\d.]+)/, racha: true},
  Sdd: {cols: ["dd10"], nom: "Dirección 10 min", u: "°", obs: /dirección anotada (-?[\d.]+)/},
};
// diferencias constantes observador − automática (SBTs, SBQFE, …): misma serie, sin valor puntual del observador
VARS.SEXT = VARS.SEXH = {cols: ["T"], nom: "Ts (período de la extrema)", u: "°C", obs: /(?:Tn|Tx)(?:AM|PM) (-?[\d.]+)/, horas: 12};
[["SBTs", "STs"], ["SBTd", "STd"], ["SBHR", "SHR"], ["SBQFE", "SQFE"], ["SBQFF", "SQFF"]].forEach(([a, b]) => VARS[a] = {...VARS[b], obs: /anotado (-?[\d.]+)/});
const COLOR = {T: "#F07A5A", Td: "#62B6E8", HR: "#5BBF8A", P_est: "#C9A0F0", P_mar: "#C9A0F0", ff10: "#62B6E8", fx10: "#F07A5A", dd10: "#62B6E8"};
const NOMCOL = {ff10: "medio 10 min", fx10: "racha"};
const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;"})[c]);
const hm = t => new Date(t).toISOString().slice(11, 16);
const tiene = regla => !!VARS[regla];

async function abrir(cont, cod, hora, regla, msg){
  const V = VARS[regla]; if (!V) return;
  cont.innerHTML = `<p style="color:var(--mu);margin:6px 0">Cargando el minutario…</p>`;
  const t = Date.parse(hora.slice(0, 16) + ":00Z"), HRS = V.horas || 1, ini = t - HRS * 60 * 60e3;
  const h = x => new Date(x).toISOString().slice(0, 13);
  let D;
  try {
    const r = await fetch(`/api/minutarios?cod=${encodeURIComponent(cod)}&desde=${h(ini - 3600e3)}&hasta=${h(t)}`);
    D = await r.json(); if (!D.cab) throw new Error(D.error || "sin datos");
  } catch (e){ cont.innerHTML = `<p style="color:var(--err);margin:6px 0">No se pudo cargar el minutario (${esc(e.message)}).</p>`; return; }
  const cab = D.cab.split(","), im = cab.indexOf("momento"), ix = V.cols.map(c => cab.indexOf(c));
  const F = D.filas.map(l => l.split(",")).map(c => ({t: Date.parse(c[im].replace(" ", "T") + "Z"), v: ix.map(i => c[i] === "" || c[i] == null ? null : +c[i])}))
    .filter(o => o.t > ini && o.t <= t).sort((a, b) => a.t - b.t);
  if (!F.length){ cont.innerHTML = `<p style="color:var(--mu);margin:6px 0">No hay minutario para esa hora.</p>`; return; }
  const m = (msg || "").match(V.obs), ob = m ? +m[1] : null;
  const vals = F.flatMap(o => o.v).filter(x => x != null).concat(ob != null ? [ob] : []);
  if (V.racha) F.forEach(o => o.v[0] != null && vals.push(o.v[0] + 10));
  let lo = Math.min(...vals), hi = Math.max(...vals); const pad = Math.max((hi - lo) * .12, V.u === "°C" ? .3 : V.u === "hPa" ? .3 : 1); lo -= pad; hi += pad;
  const W = 720, H = 250, ml = 46, mr = 14, mt = 14, mb = 28, X = x => ml + (W - ml - mr) * (x - ini) / (t - ini), Y = y => mt + (H - mt - mb) * (1 - (y - lo) / (hi - lo));
  let svg = HRS > 1 ? "" : `<rect x="${X(t - 15 * 60e3)}" y="${mt}" width="${X(t) - X(t - 15 * 60e3)}" height="${H - mt - mb}" fill="var(--oro)" opacity=".09"/>
    <text x="${X(t - 7.5 * 60e3)}" y="${mt + 12}" text-anchor="middle" font-size="10.5" fill="var(--oro)">minutos de observación</text>`;
  const pasoY = (hi - lo) / 5;
  for (let k = 0; k <= 5; k++){ const y = lo + k * pasoY; svg += `<line x1="${ml}" x2="${W - mr}" y1="${Y(y)}" y2="${Y(y)}" stroke="var(--bd)" stroke-width=".6"/><text x="${ml - 5}" y="${Y(y) + 4}" text-anchor="end" font-size="10.5" fill="var(--mu)">${y.toFixed(V.u === "%" || V.u === "°" ? 0 : 1)}</text>`; }
  for (let k = 0; k <= 60 * HRS; k += HRS > 1 ? 120 : 10){ const x = ini + k * 60e3; svg += `<text x="${X(x)}" y="${H - 9}" text-anchor="middle" font-size="10.5" fill="var(--mu)">${hm(x)}</text>`; }
  V.cols.forEach((c, j) => {
    let d = "", pen = false;
    F.forEach(o => { const y = o.v[j]; if (y == null){ pen = false; return; } d += (pen ? "L" : "M") + X(o.t).toFixed(1) + " " + Y(y).toFixed(1); pen = true; });
    svg += `<path d="${d}" fill="none" stroke="${COLOR[c]}" stroke-width="2"/>`;
  });
  if (V.racha){ let d = "", pen = false; F.forEach(o => { const y = o.v[0]; if (y == null){ pen = false; return; } d += (pen ? "L" : "M") + X(o.t).toFixed(1) + " " + Y(y + 10).toFixed(1); pen = true; });
    svg += `<path d="${d}" fill="none" stroke="${COLOR.ff10}" stroke-width="1.2" stroke-dasharray="3 3" opacity=".8"/>`; }
  if (ob != null) svg += `<line x1="${ml}" x2="${W - mr}" y1="${Y(ob)}" y2="${Y(ob)}" stroke="var(--tx)" stroke-width="1.6" stroke-dasharray="6 4"/>
    <text x="${ml + 6}" y="${Y(ob) - 5}" font-size="11" font-weight="700" fill="var(--tx)">observador ${ob} ${V.u}</text>`;
  svg += `<line class="sgcur" x1="0" x2="0" y1="${mt}" y2="${H - mb}" stroke="var(--tx)" stroke-width="1" opacity="0"/><g class="sgpts"></g>
    <rect class="sghit" x="${ml}" y="${mt}" width="${W - ml - mr}" height="${H - mt - mb}" fill="transparent" style="cursor:crosshair"/>`;
  const ley = V.cols.map(c => `<span><i style="background:${COLOR[c]}"></i>${esc(NOMCOL[c] || V.nom)}</span>`).join("") + (V.racha ? `<span><i style="background:${COLOR.ff10};opacity:.6"></i>medio + 10 kt (umbral de racha)</span>` : "")
    + (ob != null ? `<span><i style="background:var(--tx)"></i>lo que anotó el observador</span>` : "");
  const ult = HRS > 1 ? [] : F.filter(o => o.t > t - 16 * 60e3);
  const fmt = y => y == null ? "—" : (V.u === "%" || V.u === "°" ? y.toFixed(0) : y.toFixed(1));
  cont.innerHTML = `<div class="sgraf">
    <div class="sgtop"><b>${esc(V.nom)} · estación automática ${hm(ini)}–${hm(t)} UTC</b>
      <label${HRS > 1 ? ' style="display:none"' : ""}>Minuto en que observó: <input type="number" min="0" max="59" placeholder="53" class="sgmin"></label><span class="sgval"></span></div>
    <svg viewBox="0 0 ${W} ${H}" style="width:100%;max-width:${W}px">${svg}</svg>
    <div class="sgley">${ley}</div>
    ${HRS > 1 ? `<p class="sgnota">Horas en UTC. Pase el mouse para ver la hora y el valor de cada minuto; la línea blanca es lo que ingresó el observador.</p>` : ""}<div style="overflow-x:auto"${HRS > 1 ? ' hidden' : ""}><table class="sgtab"><tr><th>UTC</th>${ult.map(o => `<th data-t="${o.t}">${hm(o.t).slice(3)}</th>`).join("")}</tr>
      ${V.cols.map((c, j) => `<tr><td>${esc(NOMCOL[c] || V.nom)}</td>${ult.map(o => `<td data-t="${o.t}">${fmt(o.v[j])}</td>`).join("")}</tr>`).join("")}</table></div>
    <p class="sgnota">Mueva el mouse sobre el gráfico o escriba el minuto en que se ingresó la observación (lo que muestra SACLIM) para ver el valor que marcaba la estación en ese momento.${/descontada/.test(msg || "") ? " En presión, la alerta ya descuenta la diferencia fija habitual de la estación; el gráfico muestra el valor tal como lo guarda el minutario." : ""}</p></div>`;
  const S = cont.querySelector("svg"), cur = S.querySelector(".sgcur"), pts = S.querySelector(".sgpts"), out = cont.querySelector(".sgval");
  const mostrar = tt => {
    let o = F.reduce((a, b) => Math.abs(b.t - tt) < Math.abs(a.t - tt) ? b : a, F[0]);
    cur.setAttribute("x1", X(o.t)); cur.setAttribute("x2", X(o.t)); cur.setAttribute("opacity", .5);
    // etiqueta junto al punto: hora y valor de ese minuto (a la izquierda si el punto está cerca del borde derecho)
    pts.innerHTML = V.cols.map((c, j) => {
      if (o.v[j] == null) return "";
      const x = X(o.t), y = Y(o.v[j]), txt = `${hm(o.t)}  ${fmt(o.v[j])} ${V.u}`, w = txt.length * 6.6 + 12, izq = x + w + 12 > W - mr;
      const bx = izq ? x - w - 8 : x + 8, by = Math.max(mt, Math.min(H - mb - 20, y - 24 + j * 24));
      return `<circle cx="${x}" cy="${y}" r="4.5" fill="${COLOR[c]}" stroke="var(--panel)" stroke-width="1.5"/>
        <rect x="${bx}" y="${by}" width="${w}" height="20" rx="5" fill="var(--panel)" stroke="${COLOR[c]}" stroke-width="1"/>
        <text x="${bx + 6}" y="${by + 14}" font-size="12" font-family="var(--mono)" font-weight="600" fill="var(--tx)">${txt}</text>`;
    }).join("");
    const txt = V.cols.map((c, j) => `${esc(NOMCOL[c] || V.nom)} <b>${fmt(o.v[j])} ${V.u}</b>`).join(" · ");
    const dif = ob != null && o.v[V.racha ? 1 : 0] != null ? ob - o.v[V.racha ? 1 : 0] : null;
    out.innerHTML = `${hm(o.t)} UTC → ${txt}` + (dif != null ? ` · observador ${ob} (${dif >= 0 ? "+" : ""}${fmt(dif)})` + (Math.abs(dif) > (V.u === "°C" || V.u === "hPa" ? .1 : 1) ? ` · <span style="color:var(--oro)">debería ir ${fmt(o.v[V.racha ? 1 : 0])}</span>` : " · calza") : "");
    cont.querySelectorAll(".sgtab [data-t]").forEach(x => x.classList.toggle("on", +x.dataset.t === o.t));
  };
  S.querySelector(".sghit").addEventListener("mousemove", ev => { const b = S.getBoundingClientRect(); const px = (ev.clientX - b.left) * W / b.width; mostrar(ini + (px - ml) / (W - ml - mr) * (t - ini)); });
  cont.querySelector(".sgmin").addEventListener("input", ev => { const mm = +ev.target.value; if (ev.target.value === "" || mm < 0 || mm > 59) return;
    const base = t - 3600e3; mostrar(mm === 0 ? t : base + mm * 60e3); });
  mostrar(t);
}
window.SGRAF = {abrir, tiene};
})();
