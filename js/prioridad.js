/* Prioridad de los hallazgos de observaciones: primero lo que va en los mensajes SYNOP/METAR. */
const ELEM = [
  ["presion", "Presión", 6, /^(E09|E14|E15|E16|SQFE|SQFF|SBQFE|SBQFF)$/, /presi|QFE|QFF|QNH|tendencia|ppp/i],
  ["viento", "Viento", 5, /^(C24|C25|C26|Sff|Sffkmh|Sdd|Sracha)$/, /viento|racha|rapidez/i],
  ["vis", "Visibilidad", 5, /^(C0[1-6]|E05|E06|SAT8)$/, /visib/i],
  ["tiempo", "Tiempo presente y pasado", 5, /^(C0[7-9]|C1[0-3]|C2[7-9]|C3[01]|E01|E03|E04|E1[01]|SAT[345])$/, /tiempo|fen[oó]meno|W1|ww/i],
  ["temp", "Temperatura y humedad", 4, /^((S|SB)(Ts|Td|HR)|SEXT|SEXH)$/, /temperatura|roc[ií]o|humedad/i],
  ["precip", "Precipitación", 4, /^(E12|E13|SRRR6)$/, /precipitaci|RRR|lluvia/i],
  ["nubes", "Nubosidad", 3, /^(C1[4-9]|C2[0-3]|C32|C38|C39|C40|E18|SAT[1267])$/, /nub|octa|capa|N\b/i],
];
function elementoDe(h){
  for (const [k, n, p, re, kw] of ELEM) if (re.test(h.regla)) return {k, n, p};
  for (const [k, n, p, re, kw] of ELEM) if (kw.test(h.msg || "")) return {k, n, p};
  return {k: "otro", n: "Otros", p: 2};
}
function prioridad(h){
  const e = elementoDe(h), puntos = h.nivel * 10 + e.p;
  const nivel = h.nivel >= 2 && e.p >= 4 ? 3 : (h.nivel >= 2 || e.p >= 5) ? 2 : 1;
  return {...h, elem: e.n, puntos, prio: nivel, prioNom: ["", "Baja", "Media", "Alta"][nivel]};
}
const PRIO_COL = {3: "#eb5757", 2: "#f2c94c", 1: "#8aa0bf"};
function ordenar(L){ return L.map(prioridad).sort((a, b) => b.puntos - a.puntos || b.hora.localeCompare(a.hora)); }
