/* Tabla de las casillas que ingresó el observador en las horas anteriores a una alerta (hasta 12 observaciones), con la hora
   de la alerta resaltada. Al pasar el mouse sobre un número se muestra qué significa (ww, W1/W2, nubes, N, fenómenos METAR…). */
(function(){
const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;"})[c]);
const WW = {0: "Sin evolución de las nubes observada", 1: "Nubes disolviéndose o menos desarrolladas", 2: "Estado del cielo sin cambio", 3: "Nubes formándose o desarrollándose", 4: "Visibilidad reducida por humo", 5: "Calima", 6: "Polvo en suspensión", 7: "Polvo o arena levantados por el viento", 8: "Torbellinos de polvo o arena", 9: "Tormenta de polvo o arena a la vista",
  10: "Neblina (bruma)", 11: "Bancos de niebla poco profundos", 12: "Niebla poco profunda continua", 13: "Relámpagos sin trueno", 14: "Precipitación a la vista, no llega al suelo", 15: "Precipitación a la vista, lejana (más de 5 km)", 16: "Precipitación a la vista, cercana (menos de 5 km)", 17: "Tormenta sin precipitación", 18: "Turbonada", 19: "Tromba marina o embudo",
  20: "Llovizna reciente (no al momento)", 21: "Lluvia reciente", 22: "Nieve reciente", 23: "Lluvia y nieve reciente", 24: "Llovizna o lluvia engelante reciente", 25: "Chubasco de lluvia reciente", 26: "Chubasco de nieve reciente", 27: "Chubasco de granizo reciente", 28: "Niebla reciente", 29: "Tormenta reciente",
  30: "Tormenta de polvo/arena débil o moderada, disminuyendo", 31: "Tormenta de polvo/arena sin cambio", 32: "Tormenta de polvo/arena, comenzando", 33: "Tormenta de polvo/arena fuerte, disminuyendo", 34: "Tormenta de polvo/arena fuerte, sin cambio", 35: "Tormenta de polvo/arena fuerte, aumentando", 36: "Ventisca baja débil", 37: "Ventisca baja fuerte", 38: "Ventisca alta débil", 39: "Ventisca alta fuerte",
  40: "Niebla a distancia", 41: "Niebla en bancos", 42: "Niebla, cielo visible, se adelgaza", 43: "Niebla, cielo invisible, se adelgaza", 44: "Niebla, cielo visible, sin cambio", 45: "Niebla, cielo invisible, sin cambio", 46: "Niebla, cielo visible, se espesa", 47: "Niebla, cielo invisible, se espesa", 48: "Niebla con escarcha, cielo visible", 49: "Niebla con escarcha, cielo invisible",
  50: "Llovizna débil intermitente", 51: "Llovizna débil continua", 52: "Llovizna moderada intermitente", 53: "Llovizna moderada continua", 54: "Llovizna fuerte intermitente", 55: "Llovizna fuerte continua", 56: "Llovizna engelante débil", 57: "Llovizna engelante moderada o fuerte", 58: "Llovizna y lluvia débiles", 59: "Llovizna y lluvia moderadas o fuertes",
  60: "Lluvia débil intermitente", 61: "Lluvia débil continua", 62: "Lluvia moderada intermitente", 63: "Lluvia moderada continua", 64: "Lluvia fuerte intermitente", 65: "Lluvia fuerte continua", 66: "Lluvia engelante débil", 67: "Lluvia engelante moderada o fuerte", 68: "Lluvia y nieve débiles", 69: "Lluvia y nieve moderadas o fuertes",
  70: "Nevada débil intermitente", 71: "Nevada débil continua", 72: "Nevada moderada intermitente", 73: "Nevada moderada continua", 74: "Nevada fuerte intermitente", 75: "Nevada fuerte continua", 76: "Cristales de hielo", 77: "Granos de nieve", 78: "Cristales de nieve aislados", 79: "Gránulos de hielo",
  80: "Chubascos de lluvia débiles", 81: "Chubascos de lluvia moderados o fuertes", 82: "Chubascos de lluvia violentos", 83: "Chubascos de lluvia y nieve débiles", 84: "Chubascos de lluvia y nieve moderados o fuertes", 85: "Chubascos de nieve débiles", 86: "Chubascos de nieve moderados o fuertes", 87: "Chubascos de granizo menudo débiles", 88: "Chubascos de granizo menudo moderados o fuertes", 89: "Chubascos de granizo débiles",
  90: "Chubascos de granizo moderados o fuertes", 91: "Lluvia débil, tormenta en la hora anterior", 92: "Lluvia moderada o fuerte, tormenta en la hora anterior", 93: "Nieve o granizo débil, tormenta en la hora anterior", 94: "Nieve o granizo moderado o fuerte, tormenta en la hora anterior", 95: "Tormenta débil o moderada, con lluvia o nieve", 96: "Tormenta débil o moderada, con granizo", 97: "Tormenta fuerte, con lluvia o nieve", 98: "Tormenta con tormenta de polvo o arena", 99: "Tormenta fuerte con granizo"};
const WP = {0: "Nubosidad ≤ 1/2 todo el período", 1: "Nubosidad > 1/2 parte del período y ≤ 1/2 el resto", 2: "Nubosidad > 1/2 todo el período", 3: "Tormenta de arena, polvo o ventisca", 4: "Niebla o bruma", 5: "Llovizna", 6: "Lluvia", 7: "Nieve, o lluvia y nieve", 8: "Chubasco(s)", 9: "Tormenta (con o sin precipitación)"};
const CL = {0: "Sin nubes bajas", 1: "Cu de buen tiempo (poco desarrollo)", 2: "Cu de desarrollo moderado o fuerte", 3: "Cb sin yunque", 4: "Sc formado por extensión de Cu", 5: "Sc no formado por Cu", 6: "St o Fs (mal tiempo no)", 7: "Fs o Fc de mal tiempo", 8: "Cu y Sc a distinto nivel", 9: "Cb con yunque"};
const CM = {0: "Sin nubes medias", 1: "As delgado", 2: "As grueso o Ns", 3: "Ac delgado, un nivel", 4: "Ac en bancos lenticulares", 5: "Ac en bandas que invaden el cielo", 6: "Ac por extensión de Cu", 7: "Ac doble o con As/Ns", 8: "Ac con torres o flóculos", 9: "Ac de cielo caótico"};
const CH = {0: "Sin nubes altas", 1: "Ci en filamentos", 2: "Ci densos en copos", 3: "Ci densos de Cb", 4: "Ci en ganchos, extendiéndose", 5: "Ci o Cs que invaden el cielo, < 45° de altura", 6: "Ci o Cs que invaden el cielo, > 45° de altura", 7: "Cs que cubre todo el cielo", 8: "Cs que no invade el cielo", 9: "Cc solo o con Ci/Cs"};
const GEN = {0: "Ci (cirros)", 1: "Cc (cirrocúmulos)", 2: "Cs (cirroestratos)", 3: "Ac (altocúmulos)", 4: "As (altoestratos)", 5: "Ns (nimboestratos)", 6: "Sc (estratocúmulos)", 7: "St (estratos)", 8: "Cu (cúmulos)", 9: "Cb (cumulonimbos)", 10: "TCu (cúmulos congestus)"};
const FEN = {1: "DZ llovizna", 2: "RA lluvia", 9: "BR neblina", 10: "FG niebla", 15: "HZ calima"};
const comp = c => /^FEN/.test(c) ? "FEN" : /^C$|^C\d$/.test(c) ? "C" : /^Ns\d?$/.test(c) ? "Ns" : /^hshshs\d?$/.test(c) ? "hshshs" : c;
const SIG = {
  ww: n => WW[n] != null ? `ww ${n}: ${WW[n]}` : null, W1: n => WP[n] != null ? `W1 ${n}: ${WP[n]}` : null, W2: n => WP[n] != null ? `W2 ${n}: ${WP[n]}` : null,
  Cl: n => CL[n] != null ? `CL ${n}: ${CL[n]}` : null, Cm: n => CM[n] != null ? `CM ${n}: ${CM[n]}` : null, Ch: n => CH[n] != null ? `CH ${n}: ${CH[n]}` : null,
  C: n => GEN[n] != null ? `Tipo de nube: ${GEN[n]}` : null, N: n => n === 9 ? "N 9: cielo oscurecido" : `N ${n}: ${n} octas de cielo cubierto`, Ns: n => `Ns ${n}: ${n} octas en esta capa`,
  hshshs: n => `Base de la capa: ${n} (altura en pies, según SACLIM)`, VV: n => `Visibilidad: ${n} m`, FEN: n => FEN[n] ? `Fenómeno METAR: ${FEN[n]}` : `Fenómeno METAR código ${n}`,
};
const NOMBRE = {WWSINOP: "ww", W1W2: "", VVSINOP: "VV", WWMETAR: "", N: "N", Nubes: "", CapaNube: "Capa"};
const ORDEN = ["WWSINOP", "W1W2", "a", "N", "Nubes", "CapaNube", "VVSINOP", "WWMETAR", "Ts", "Td", "HR", "QFE", "QFF", "QNH", "VTO", "RRR6", "TxAM", "TnAM", "TxPM", "TnPM"];
const tiene = (e, hora) => !!(e && e.cas && Object.keys(e.cas).length);
// casillas que intervienen en cada regla (columnas que se señalan); si no está en la lista se buscan nombres de casilla en el mensaje
const POR_REGLA = [[/^E14$/, ["ppp", "QFE"]], [/^E1[56]$/, ["a", "QFE"]], [/^E0[346]$/, ["ww", "Cl", "VV"]], [/^E0[78]$/, ["ww", "N"]], [/^E18$/, ["C", "hshshs"]], [/^S?B?Ts$|^STs/, ["Ts"]], [/^S?B?Td$/, ["Td"]], [/^S?B?HR$/, ["HR"]], [/QFE/, ["QFE"]], [/QFF/, ["QFF"]], [/QNH/, ["QNH"]], [/^Sff|^Sracha/, ["ff"]], [/^Sdd/, ["dd", "ff"]],
  [/^C41/, ["Ts", "Td", "HR"]], [/^SRRR6$|^E1[237]$/, ["RRR6", "Traza", "ww"]], [/^SPRE$/, ["ww"]], [/^C0[147]$|^C35$/, ["ww", "VV", "FEN1", "FEN12", "FEN13"]], [/^C11$/, ["ww", "Cl"]], [/^C15$|^C19$/, ["N", "Ns", "Ns2", "Ns3", "Ns4"]],
  [/^C27$/, ["W1", "W2"]], [/^C32$|^C40$/, ["Cl", "C", "C2", "C3"]], [/^E01$|^E05$/, ["ww", "VV"]], [/^E09$/, ["QFE"]]];
function involucradas(regla, msg){
  const r = POR_REGLA.find(([re]) => re.test(regla)), s = new Set(r ? r[1] : []);
  if (/^SEX/.test(regla)){ const m = (msg || "").match(/T(min|max) (AM|PM)/); if (m) s.add((m[1] === "min" ? "Tn" : "Tx") + m[2]); else ["TxAM", "TnAM", "TxPM", "TnPM"].forEach(x => s.add(x)); }
  const pm = (msg || "").match(/^(Ts|Td|HR|QFE|QFF|QNH|ff|dd|RRR6|VV|N)\b/); if (pm) s.add(pm[1]);
  [["ww", /\bww\b/], ["W1", /\bW1\b/], ["W2", /\bW2\b/], ["Cl", /\bCL\b/], ["Cm", /\bCM\b/], ["Ch", /\bCH\b/], ["N", /\bN\b/], ["VV", /visibilidad|\bVV\b/i], ["RRR6", /RRR6|agua ca[ií]da/i], ["Traza", /traza/i], ["QFE", /QFE/], ["QFF", /QFF/], ["QNH", /QNH/], ["Ts", /\bTs\b|temperatura/i], ["Td", /\bTd\b|rocío/i], ["HR", /\bHR\b|humedad/i],
    ["dd", /direcci[oó]n|\bdd\b/i], ["ff", /viento|racha|\bff\b/i], ["Cl", /\bCl\b|nubes bajas/i], ["Cm", /nubes medias/i], ["Ch", /nubes altas/i], ["C", /capa|TCu|\bCb\b|\bCu\b|\bSc\b|\bSt\b|\bAc\b|\bAs\b|\bNs\b|\bCi\b|\bCs\b|\bCc\b/], ["Ns", /octas|capa/i], ["hshshs", /altura|base|hshshs/i],
    ["FEN1", /METAR|\bBR\b|\bFG\b|\bDZ\b|\bRA\b|\bHZ\b/], ["FEN12", /METAR/], ["FEN13", /METAR/]].forEach(([c, re]) => { if (re.test(msg || "")) s.add(c); });
  return s;
}
function tabla(cas, hora, msg, regla){
  const clave = hora.slice(0, 16).replace("T", " "), todos = Object.keys(cas).sort();
  let i = todos.indexOf(clave); if (i < 0) i = todos.filter(t => t <= clave).length - 1;
  if (i < 0 || todos[i] > clave && false) return `<p class="sgnota">La observación de ${clave.slice(8, 10)}/${clave.slice(5, 7)} ${clave.slice(11, 16)} ya no está en las casillas guardadas (se guardan las últimas ${todos.length} observaciones).</p>`;
  const exacta = todos[i] === clave, ts = todos.slice(Math.max(0, i - 8), i + 4), mal = involucradas(regla || "", msg);
  const cols = []; ORDEN.forEach(el => { const s = new Set(); ts.forEach(t => Object.keys((cas[t] || {})[el] || {}).forEach(c => s.add(c))); [...s].sort().forEach(c => cols.push([el, c])); });
  // capas, fenómenos METAR, descripciones e intensidades: solo las que traen dato; si ninguna lo trae se deja una sola columna del grupo
  const vacio = x => x == null || x === "SD" || x === "";
  const tiene_ = (el, c) => ts.some(t => !vacio(((cas[t] || {})[el] || {})[c]));
  const fam = (el, c) => el === "CapaNube" && /^(C|Ns|hshshs)\d?$/.test(c) ? "Capa " + c.replace(/\d$/, "") : /^FEN\d+$/.test(c) ? "FEN" : /^(DESC|IntProx)\d?$/.test(c) ? c.replace(/\d$/, "") : null;
  const visto = new Set(), cols2 = [];
  cols.forEach(([el, c]) => { const f = fam(el, c);
    if (f){ if (tiene_(el, c) || !visto.has(f)){ if (!tiene_(el, c) && cols.some(([e2, c2]) => fam(e2, c2) === f && tiene_(e2, c2))) return; cols2.push([el, c]); visto.add(f); } }
    else if (tiene_(el, c)) cols2.push([el, c]); });
  cols.length = 0; cols2.forEach(x => cols.push(x));
  if (!cols.length) return "";
  const rot = (el, c) => (NOMBRE[el] ? NOMBRE[el] + (/^(ww|VV|N)$/.test(c) ? "" : " ") : "") + (/^(ww|VV|N)$/.test(c) && NOMBRE[el] === c ? "" : c);
  const usado = (el, c) => (c.length > 2 && (msg || "").includes(c)) || (el === "WWSINOP" && /\bww\b/.test(msg || ""));
  const OFF = {E14: [-3], E15: [-3], E16: [-3], E20: [-1, 1]}, offs = /^E(0[1-9]|1[4-6]|18|19|20)$/.test(regla || "") ? (OFF[regla] || [-1]) : [];
  const cmp = new Set(offs.map(o => new Date(Date.parse(clave.replace(" ", "T") + ":00Z") + o * 3600e3).toISOString().slice(0, 16).replace("T", " ")));
  const algunaMal = cols.some(([el, c]) => mal.has(c) && ((cas[clave] || {})[el] || {})[c] != null);
  const filas = ts.map(t => `<tr${t === clave ? ' class="sgalerta"' : ""}><td style="white-space:nowrap"><b>${t.slice(8, 10)}/${t.slice(5, 7)} ${t.slice(11, 16)}</b></td>${cols.map(([el, c]) => {
    const x = ((cas[t] || {})[el] || {})[c], k = comp(c), f = SIG[k];
    const tt = x == null ? "" : typeof x === "number" && f ? (f(x) || "") : "";
    const comp_ = cmp.has(t) && mal.has(c) && x != null;
    const falla = t === clave && x != null && (mal.has(c) || (!algunaMal && el !== "Ts" && el !== "Td" && el !== "HR" && el !== "QFE" && el !== "QFF" && el !== "QNH")), est = (tt ? "cursor:help;text-decoration:underline dotted;" : "") + (falla ? "background:var(--err);color:#fff;font-weight:800;outline:2px solid var(--err);" : "") + (comp_ ? "outline:2px dashed var(--oro);background:color-mix(in srgb,var(--oro) 28%,transparent);font-weight:800;" : "");
    return `<td${comp_ ? ` title="${esc((tt ? tt + " · " : "") + "Casilla con la que se compara")}"` : tt ? ` title="${esc(tt)}"` : ""}${est ? ` style="${est}"` : ""}>${x == null ? "—" : esc(x)}</td>`; }).join("")}</tr>`).join("");
  return `<div class="sgcas"><h4 style="margin:10px 0 4px">Casillas ingresadas por el observador · ${ts.length} observaciones alrededor de la alerta</h4>
    <div style="overflow-x:auto"><table class="sgtab"><tr><th>Hora UTC</th>${cols.map(([el, c]) => `<th title="${esc(el)} · ${esc(c)}"${usado(el, c) || mal.has(c) ? ' style="color:var(--oro)"' : ""}>${esc(rot(el, c))}</th>`).join("")}</tr>${filas}</table></div>
    <p class="sgnota">La fila de la alerta va resaltada y las casillas cuestionadas en rojo; con borde dorado, la casilla con la que se compara (hora anterior o tres horas antes, según la regla); si la regla no apunta a una casilla concreta, se marcan todas las de codificación de esa hora. Se ocultan las casillas vacías. Pase el mouse sobre un número subrayado para ver qué significa.</p></div>`;
}
const f2 = t => t ? `${t.slice(8, 10)}/${t.slice(5, 7)} ${t.slice(11, 16)}` : "";
function cambios(e, hora){
  const clave = hora.slice(0, 16).replace("T", " "), L = (e && e.cambios || []).slice(-40).reverse();
  if (!L.length) return `<p class="sgnota">Cambios en SACLIM: ninguno detectado desde que se empezó a registrar (el sistema compara cada pasada con la anterior).</p>`;
  return `<h4 style="margin:10px 0 4px">Cambios detectados en SACLIM</h4><table class="sgtab"><tr><th>Detectado (UTC)</th><th>Observación</th><th>Casilla</th><th>Antes</th><th>Ahora</th></tr>${L.map(x =>
    `<tr${x.hora === clave ? ' class="sgalerta"' : ""}><td>${f2(x.visto)}</td><td>${f2(x.hora)}</td><td>${esc(x.el)} · ${esc(x.c)}</td><td>${x.antes == null ? "—" : esc(x.antes)}</td><td>${x.despues == null ? "(borrado)" : esc(x.despues)}</td></tr>`).join("")}</table>
    <p class="sgnota">Si la alerta es de una observación que aparece aquí, la corrección ya se leyó; la alerta se recalcula en la misma pasada.</p>`;
}
function abrir(cont, e, hora, msg, regla){
  const d = document.createElement("div"); d.innerHTML = (e && e.cas ? tabla(e.cas, hora, msg, regla) : "") + (e ? cambios(e, hora) : "");
  if (!e || !e.cas) d.innerHTML = `<p class="sgnota">No hay casillas guardadas para esta estación (se llenan en la próxima pasada del control).</p>`;
  cont.appendChild(d);
}
window.CAS = {abrir, tiene, SIG, comp};
})();
