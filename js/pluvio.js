// Completitud y control de calidad de la precipitación diaria (agua caída) de una estación.
// Entrada: filas [fecha, parcial, total, traza] (de /api/aguacaida) y, si se quiere, la misma serie de estaciones vecinas.
// Todo son reglas fijas (sin IA): corre en el navegador y no gasta nada al usarlo.
const D = 864e5;
const iso = t => new Date(t).toISOString().slice(0, 10);
const ms = f => Date.parse(f + "T00:00:00Z");
export const r1 = x => x == null ? null : Math.round(x * 10) / 10;
export function percentil(v, p){
  if (!v.length) return null;
  const s = [...v].sort((a, b) => a - b), i = (s.length - 1) * p, a = Math.floor(i), b = Math.ceil(i);
  return s[a] + (s[b] - s[a]) * (i - a);
}
export function km(a, b){   // distancia entre dos estaciones {lat, lon}
  const R = 6371, t = x => x * Math.PI / 180, dLa = t(b.lat - a.lat), dLo = t(b.lon - a.lon);
  const h = Math.sin(dLa / 2) ** 2 + Math.cos(t(a.lat)) * Math.cos(t(b.lat)) * Math.sin(dLo / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export const NOMBRES = {
  X10: "Parcial y total difieren ×10", PT0: "Parcial 0 y total con valor", PTD: "Parcial distinto de total",
  ALTO: "Valor alto para la estación", V10: "Posible error de decimal (vecinas)", VSOLO: "Llovió aquí y no en las vecinas", VFALTA: "Sin dato, con lluvia en las vecinas"
};
export const EXPLICA = {
  X10: "El parcial y el total del mismo día son iguales salvo por un factor 10 (por ejemplo 0.6 y 6.0): casi siempre es un decimal mal digitado en uno de los dos.",
  PT0: "El parcial es 0 y el total tiene valor. Puede ser lluvia que se anotó como total del día (antes se totalizaba a las 12) y no se repartió en las observaciones de 6 horas.",
  PTD: "El parcial (lo sumado de las observaciones) no coincide con el total del día: pueden faltar observaciones o haber un valor mal digitado.",
  ALTO: "Total diario sobre el umbral de la estación: el mayor entre el umbral que usted fija y 3 veces el percentil 90 de sus días con lluvia. Revisar contra vecinas y contra las observaciones de ese día.",
  V10: "Con vecinas con lluvia ese día (±1 día), el total dividido por 10 (o multiplicado por 10) coincide con ellas: posible coma mal puesta. Solo marca cuando la razón es cercana a 10, no ante simples diferencias de intensidad.",
  VSOLO: "Total de 3 mm o más en esta estación y ninguna vecina con dato registró lluvia (±1 día). En zonas áridas puede ser real, pero conviene confirmar.",
  VFALTA: "Día sin dato en esta estación y lluvia de 1 mm o más el mismo día en la mitad o más de las vecinas con dato."
};

/** dias: [[fecha, parcial, total, traza]…]. o: {desde, hasta (AAAA-MM-DD), epoca, umbralAlto, minRacha, vecinas: [{cod, nombre, km, dias}]} */
export function analizar(dias, o = {}){
  if (!dias || !dias.length) return null;
  const desde = o.desde || dias[0][0], hasta = o.hasta || dias[dias.length - 1][0];
  const epoca = o.epoca || "2011-01-01", umbralAlto = o.umbralAlto ?? 5, minRacha = o.minRacha ?? 3;
  const M = new Map(dias.map(d => [d[0], d]));
  const t0 = ms(desde), t1 = ms(hasta);
  if (!(t1 >= t0)) return null;

  // 1. una fila por cada día del período; estado = falta | parcial | traza | cero | valor
  const reg = [], cont = { falta: 0, parcial: 0, traza: 0, cero: 0, valor: 0, sinFila: 0 };
  for (let t = t0; t <= t1; t += D){
    const f = iso(t), d = M.get(f), p = d ? d[1] : null, tt = d ? d[2] : null, z = d ? d[3] : 0;
    let e;
    if (tt == null && p == null && !z) e = "falta";
    else if (tt == null && p != null) e = "parcial";
    else if (z && !(tt >= 0.1)) e = "traza";
    else e = tt >= 0.1 ? "valor" : "cero";
    cont[e]++; if (!d) cont.sinFila++;
    reg.push({ f, t, p, v: tt, z, e, m: [] });
  }

  // 2. umbral de valor alto
  const lluv = reg.filter(r => r.v >= 0.1).map(r => r.v);
  const p90 = lluv.length >= 10 ? percentil(lluv, 0.9) : null;
  const umbral = Math.max(umbralAlto, p90 != null ? 3 * p90 : 0);

  // 3. vecinas
  const vec = (o.vecinas || []).filter(v => v.dias && v.dias.length).map(v => ({ cod: v.cod, nombre: v.nombre, km: v.km, m: new Map(v.dias.map(d => [d[0], d[2]])), n: v.dias.length }));
  const ventana = (m, t) => { let mx = null; for (const k of [-1, 0, 1]){ const x = m.get(iso(t + k * D)); if (x != null && (mx == null || x > mx)) mx = x; } return mx; };

  const marca = (r, cod, nivel, texto, probable) => r.m.push({ cod, nivel, texto, probable: probable ?? null });
  for (const r of reg){
    const { p, v } = r;
    // 4a. consistencia entre parcial y total del mismo día
    if (p != null && v != null){
      if (p > 0 && v > 0 && p !== v && (Math.abs(p * 10 - v) <= 0.15 || Math.abs(v * 10 - p) <= 0.15))
        marca(r, "X10", 2, `Parcial ${p} y total ${v} mm: difieren por un factor 10.`);
      else if (p === 0 && v > 0) marca(r, "PT0", 1, `Parcial 0 y total ${v} mm.`);
      else if (Math.abs(p - v) >= 0.1) marca(r, "PTD", 1, `Parcial ${p} mm y total ${v} mm.`);
    }
    // 4b. valor alto
    if (v != null && v >= umbral) marca(r, "ALTO", v >= 2 * umbral ? 2 : 1, `Total ${v} mm (umbral ${r1(umbral)} mm).`);
    // 4c. contraste con vecinas
    if (vec.length){
      const w = vec.map(x => ({ x, mx: ventana(x.m, r.t), hoy: x.m.get(r.f) }));
      const con = w.filter(a => a.mx != null), llu = con.filter(a => a.mx >= 0.1);
      const resumen = con.map(a => `${a.x.nombre || a.x.cod}: ${a.mx}`).join(" · ");
      if (v != null && v >= 3 && con.length && !llu.length) marca(r, "VSOLO", 1, `Total ${v} mm y ninguna de las ${con.length} vecinas con dato registró lluvia (máx. ±1 día: ${resumen}).`);
      else if (v != null && llu.length){
        const m = percentil(llu.map(a => a.mx), 0.5);
        if (v >= 5 && m > 0 && Math.abs(v / 10 - m) / m <= 0.25)
          marca(r, "V10", 2, `Total ${v} mm; las vecinas con lluvia dan ${r1(m)} mm (mediana, ±1 día: ${resumen}).`, r1(v / 10));
        else if (v > 0 && v <= 3 && Math.abs(v * 10 - m) / m <= 0.25)
          marca(r, "V10", 1, `Total ${v} mm; las vecinas con lluvia dan ${r1(m)} mm (mediana, ±1 día: ${resumen}).`, r1(v * 10));
      }
      if (r.e === "falta" || r.e === "parcial"){
        const hoy = w.filter(a => a.hoy != null), lh = hoy.filter(a => a.hoy >= 1);
        if (hoy.length && lh.length >= Math.max(1, Math.ceil(hoy.length / 2)))
          marca(r, "VFALTA", 1, `Sin total en esta estación; ese día llovió ${lh.map(a => `${a.x.nombre || a.x.cod}: ${a.hoy}`).join(" · ")} mm.`);
      }
    }
  }

  // 5. resúmenes por año y mes
  const porAnio = new Map(), meses = {};
  for (const r of reg){
    const a = +r.f.slice(0, 4), m = +r.f.slice(5, 7);
    const A = porAnio.get(a) || porAnio.set(a, { anio: a, dias: 0, falta: 0, parcial: 0, traza: 0, cero: 0, valor: 0, mm: 0, pt: 0, marcas: 0 }).get(a);
    A.dias++; A[r.e]++; if (r.v != null) A.mm += r.v;
    if (r.m.some(x => x.cod === "PT0" || x.cod === "PTD" || x.cod === "X10")) A.pt++;
    if (r.m.length) A.marcas++;
    const k = (meses[a] ||= Array.from({ length: 12 }, () => ({ esp: 0, con: 0 })))[m - 1];
    k.esp++; if (r.e !== "falta" && r.e !== "parcial") k.con++;
  }
  const anios = [...porAnio.values()].map(A => ({ ...A, mm: r1(A.mm), completitud: Math.round(1000 * (A.dias - A.falta - A.parcial) / A.dias) / 10 }));

  // 6. rachas de días sin dato
  const rachas = []; let ini = null, n = 0;
  const cerrar = f => { if (n >= minRacha) rachas.push({ desde: ini, hasta: f, dias: n }); ini = null; n = 0; };
  let ant = null;
  for (const r of reg){ if (r.e === "falta"){ if (ini == null) ini = r.f; n++; ant = r.f; } else if (ini != null) cerrar(ant); }
  if (ini != null) cerrar(ant);
  const maxRacha = rachas.reduce((m, x) => Math.max(m, x.dias), 0);

  // 7. antes y después del cambio de formulario a digitación (SACLIM)
  const ep = () => ({ dias: 0, falta: 0, traza: 0, valor: 0, pt: 0, enteros: 0 });
  const E = { antes: ep(), despues: ep() };
  for (const r of reg){
    const e = E[r.f < epoca ? "antes" : "despues"];
    e.dias++; if (r.e === "falta") e.falta++; if (r.e === "traza") e.traza++;
    if (r.e === "valor"){ e.valor++; if (Number.isInteger(r.v)) e.enteros++; }
    if (r.m.some(x => x.cod === "PT0" || x.cod === "PTD" || x.cod === "X10")) e.pt++;
  }

  const marcas = [];
  for (const r of reg) for (const x of r.m) marcas.push({ f: r.f, p: r.p, v: r.v, z: r.z, ...x });
  marcas.sort((a, b) => b.nivel - a.nivel || (a.f < b.f ? -1 : 1));
  const completos = reg.length - cont.falta - cont.parcial;
  return { desde, hasta, epoca, umbral: r1(umbral), p90: r1(p90), umbralAlto, dias: reg.length, cont,
    completitud: Math.round(1000 * completos / reg.length) / 10, anios, meses, rachas: rachas.sort((a, b) => b.dias - a.dias), maxRacha,
    epocas: E, marcas, reg, vecinas: vec.map(v => ({ cod: v.cod, nombre: v.nombre, km: v.km, n: v.n })) };
}
