// Lectura rápida de la red EMA (getDatosRecientesRedEma): último dato de cada estación y lluvia de la última hora.
// Equivale a qc/dmc.py (leer) pero solo con lo que necesitan «Mis alertas»; no hace control de calidad.
const BASE = "https://climatologia.meteochile.gob.cl/application/servicios/";
const NUM = /-?\d+(?:\.\d+)?/;

export function numero(v){
  if (v == null) return null;
  if (typeof v === "number") return isFinite(v) ? v : null;
  const m = NUM.exec(String(v)); return m ? parseFloat(m[0]) : null;
}
// arregla acentos mal codificados ("QuimÃ¡vida" → "Quimávida")
export function texto(s){
  if (typeof s !== "string" || !/[ÃÂ]/.test(s)) return s;
  try { return new TextDecoder("utf-8", {fatal: true}).decode(Uint8Array.from(s, c => { if (c.charCodeAt(0) > 255) throw 0; return c.charCodeAt(0); })); }
  catch (e) { return s; }
}
const iso = m => String(m ?? "").replace(" ", "T");
const ms = m => { const s = iso(m); return Date.parse(/(Z|[+-]\d\d:?\d\d)$/.test(s) ? s : s + "Z"); };
const r1 = x => x == null ? null : Math.round(x * 10) / 10;

export async function descargar(env, timeoutMs = 150000){
  const u = new URL(BASE + "getDatosRecientesRedEma");
  u.searchParams.set("usuario", env.DMC_USUARIO); u.searchParams.set("token", env.DMC_TOKEN);
  const r = await fetch(u, {signal: AbortSignal.timeout(timeoutMs)});
  if (!r.ok) throw new Error("DMC HTTP " + r.status);
  return r.json();
}

/** js (respuesta del servicio) → {generado, datos_hasta, estaciones: [{codigo, nombre, lat, nivel, hora, valores}]}.
    valores = último registro de la estación; rr1h = lluvia sumada en los 60 min previos a ese registro.
    nivel 3 = la estación no trae ningún dato en la última hora del servicio. */
export function resumir(js, ahora = Date.now()){
  const estaciones = []; let hasta = "";
  for (const e of js.datosEstaciones || []){
    const m = e.estacion || {}, D = (e.datos || []).filter(d => d && d.momento);
    const base = {codigo: String(m.codigoNacional), nombre: texto(m.nombreEstacion), lat: numero(m.latitud)};
    if (!D.length){ estaciones.push({...base, nivel: 3, hora: null, valores: {}}); continue; }
    const u = D.reduce((a, b) => iso(b.momento) > iso(a.momento) ? b : a), t = ms(u.momento);
    let lluvia = 0;
    for (const d of D){ const dt = ms(d.momento); if (isNaN(t) || isNaN(dt) || (dt <= t && t - dt < 3600e3)) lluvia += numero(d.aguaCaidaDelMinuto) || 0; }
    const hora = iso(u.momento).replace("T", " ");
    if (hora > hasta) hasta = hora;
    estaciones.push({...base, nivel: 0, hora, valores: {
      T: r1(numero(u.temperatura)), Td: r1(numero(u.puntoDeRocio)), HR: r1(numero(u.humedadRelativa)), P_mar: r1(numero(u.presionNivelDelMar)),
      ff10: r1(numero(u.fuerzaDelVientoPromedio10Minutos)), dd10: r1(numero(u.direccionDelVientoPromedio10Minutos)), rr1h: r1(lluvia)}});
  }
  return {generado: new Date(ahora).toISOString().slice(0, 19) + "Z", datos_hasta: hasta || null, estaciones};
}
