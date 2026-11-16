// Normaliza la respuesta de serviciosb/getAguaCaidaDiaria/{cod} a filas [fecha, parcial, total, traza].
// El servicio entrega año → mes → día con los campos «parcial», «total» y «traza». Como no hay un formato
// documentado, el lector es tolerante: recorre todo el JSON, toma como «día» cualquier objeto que tenga alguno
// de esos tres campos y saca la fecha de las claves del camino (2005 → 7 → 15) o de campos propios (ano, mes, dia, fecha).
// Los valores vienen con «basura» de decimales (0.10000000149): se redondean a 1 decimal.
const MESES = { enero: 1, febrero: 2, marzo: 3, abril: 4, mayo: 5, junio: 6, julio: 7, agosto: 8, septiembre: 9, setiembre: 9, octubre: 10, noviembre: 11, diciembre: 12,
  ene: 1, feb: 2, mar: 3, abr: 4, may: 5, jun: 6, jul: 7, ago: 8, sep: 9, sept: 9, oct: 10, nov: 11, dic: 12 };
const sinTilde = s => String(s).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim();

export function numero(v){
  if (v == null || typeof v === "boolean" || typeof v === "object") return null;
  if (typeof v === "number") return isFinite(v) && v >= 0 ? Math.round(v * 10) / 10 : null;
  const m = /-?\d+(?:[.,]\d+)?/.exec(String(v).trim());
  if (!m) return null;
  const x = parseFloat(m[0].replace(",", "."));
  return isFinite(x) && x >= 0 ? Math.round(x * 10) / 10 : null;
}
export function esTraza(v){
  if (v === true) return 1;
  if (v == null || v === false) return 0;
  if (typeof v === "number") return v > 0 ? 1 : 0;
  return /^(1|t|true|si|x|traza|inap.*)$/.test(sinTilde(v)) ? 1 : 0;
}
const campo = (o, ...nombres) => { for (const k in o) if (nombres.includes(sinTilde(k))) return o[k]; return undefined; };

// asigna una clave del camino (año, mes o día) al contexto
function asignar(ctx, k, porIndice){
  const s = sinTilde(k);
  if (/^(19|20)\d\d$/.test(s) && ctx.a == null) return { ...ctx, a: +s };
  if (ctx.m == null && ctx.a != null && MESES[s]) return { ...ctx, m: MESES[s] };
  if (/^\d+$/.test(s) && ctx.a != null){
    const n = +s + (porIndice ? 1 : 0);
    if (ctx.m == null && n >= 1 && n <= 12) return { ...ctx, m: n };
    if (ctx.m != null && ctx.d == null && n >= 1 && n <= 31) return { ...ctx, d: n };
  }
  return ctx;
}
function propios(o, ctx){
  let c = ctx;
  const a = campo(o, "ano", "anio", "year"), m = campo(o, "mes", "month"), d = campo(o, "dia", "day"), f = campo(o, "fecha", "date");
  if (typeof f === "string"){
    let x = /^(\d{4})-(\d\d)-(\d\d)/.exec(f); if (x) c = { a: +x[1], m: +x[2], d: +x[3] };
    else if ((x = /^(\d\d?)[-/](\d\d?)[-/](\d{4})/.exec(f))) c = { a: +x[3], m: +x[2], d: +x[1] };
  }
  if (a != null && typeof a !== "object" && /^\d{4}$/.test(String(a))) c = { ...c, a: +a };
  if (m != null && typeof m !== "object"){ const n = MESES[sinTilde(m)] || (/^\d+$/.test(String(m)) ? +m : null); if (n >= 1 && n <= 12) c = { ...c, m: n }; }
  if (d != null && typeof d !== "object" && /^\d+$/.test(String(d)) && +d >= 1 && +d <= 31) c = { ...c, d: +d };
  return c;
}
const p2 = n => String(n).padStart(2, "0");

export function normalizar(js){
  const out = new Map(); let hojas = 0, sinFecha = 0;
  function ir(nodo, ctx){
    if (nodo == null || typeof nodo !== "object") return;
    if (Array.isArray(nodo)){ nodo.forEach((x, i) => ir(x, asignar(ctx, String(i), true))); return; }
    ctx = propios(nodo, ctx);
    const P = campo(nodo, "parcial"), T = campo(nodo, "total"), Z = campo(nodo, "traza");
    if (P !== undefined || T !== undefined || Z !== undefined){
      hojas++;
      const { a, m, d } = ctx;
      if (a != null && m != null && d != null){
        const t = new Date(Date.UTC(a, m - 1, d));
        if (t.getUTCFullYear() === a && t.getUTCMonth() === m - 1 && t.getUTCDate() === d){
          const f = `${a}-${p2(m)}-${p2(d)}`, fila = [f, numero(P), numero(T), esTraza(Z)], previa = out.get(f);
          const lleno = x => (x[1] != null) + (x[2] != null) + x[3];
          if (!previa || lleno(fila) > lleno(previa)) out.set(f, fila);
          return;
        }
      }
      sinFecha++;
      return;
    }
    for (const k of Object.keys(nodo)) ir(nodo[k], asignar(ctx, k, false));
  }
  ir(js, {});
  const dias = [...out.values()].sort((x, y) => x[0] < y[0] ? -1 : x[0] > y[0] ? 1 : 0);
  return { dias, n: dias.length, desde: dias[0] ? dias[0][0] : null, hasta: dias.length ? dias[dias.length - 1][0] : null, hojas, sinFecha,
    mensaje: js && typeof js === "object" && typeof js.mensaje === "string" ? js.mensaje : null };
}
