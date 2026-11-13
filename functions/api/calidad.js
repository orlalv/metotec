// GET /api/calidad?cod=330006&desde=AAAA-MM-DD&hasta=AAAA-MM-DD  (público, máx. 31 días)
// Calidad de los datos de UNA estación, como tramos de tiempo por variable. Une tres fuentes:
//   · avisos automáticos del control de calidad (KV qc/hist/<día>): nivel 2 = erróneo, nivel 1 = dudoso
//   · revisión manual (KV qc/rev/<día>): «falsa alarma» → revisado y correcto
//   · correcciones registradas (KV qc/correcciones): corregido (valor anterior, fecha, quién, motivo) o rellenado
// Sin tramo = dato original. Estados: erroneo · dudoso · revisado · corregido · rellenado.
// No se entregan textos internos de las reglas ni nombres de revisores salvo en las correcciones (que son parte del registro).
import { json } from "./_kv.js";
const GRUPO = { T: "temp", Td: "temp", HR: "hr", P_est: "pres", P_mar: "pres", P_std: "pres", ff10: "vien", dd10: "vien", fx10: "vien", ff2: "vien", dd2: "vien",
  rr1m: "lluv", rr6: "lluv", rr24: "lluv" };
const SENSOR = { "termohigrómetro": ["temp", "hr"], "barómetro": ["pres"], "anemómetro": ["vien"], "veleta": ["vien"], "pluviómetro": ["lluv"] };
const min = t => Date.parse(String(t).slice(0, 16).replace(" ", "T") + ":00Z");

export async function onRequestGet({ request, env }){
  const u = new URL(request.url), cod = (u.searchParams.get("cod") || "").trim();
  const dia = d => d.toISOString().slice(0, 10);
  if (!/^\d{4,8}$/.test(cod)) return json({ error: "parámetro cod inválido" }, { status: 400 });
  const hasta = new Date((u.searchParams.get("hasta") || dia(new Date())) + "T00:00:00Z");
  let desde = new Date((u.searchParams.get("desde") || dia(new Date(hasta - 29 * 864e5))) + "T00:00:00Z");
  if (isNaN(hasta) || isNaN(desde)) return json({ error: "fechas inválidas" }, { status: 400 });
  if ((hasta - desde) / 864e5 > 30) desde = new Date(hasta - 30 * 864e5);
  const dias = []; for (let t = +desde; t <= +hasta; t += 864e5) dias.push(dia(new Date(t)));
  const [hist, revs, cor] = await Promise.all([
    Promise.all(dias.map(d => env.DATOS.get("qc/hist/" + d, "json"))),
    Promise.all(dias.map(d => env.DATOS.get("qc/rev/" + d, "json"))),
    env.DATOS.get("qc/correcciones", "json")]);
  const rev = Object.assign({}, ...revs.map(r => r || {}));
  const tramos = [];
  hist.forEach(H => { if (!H) return;
    for (const [id, r] of Object.entries(H.ema || {})){
      if (r.codigo !== cod || !(r.nivel >= 1)) continue;
      const ep = r.episodio, ini = min(ep ? ep.inicio : r.momento);
      const fin = ep ? (ep.sigue ? Date.now() : min(ep.fin || ep.ultima || ep.inicio) + 60e3) : ini + 60e3;
      const vars = ep && SENSOR[ep.sensor] ? SENSOR[ep.sensor] : [GRUPO[r.var] || "todas"];
      const m = rev[id];
      const estado = m && m.v === "falsa" ? "revisado" : r.nivel >= 2 ? "erroneo" : "dudoso";
      for (const g of vars) tramos.push({ id, g, var: r.var, ini, fin, estado, regla: r.prueba, sigue: !!(ep && ep.sigue), resuelto: m && m.v === "resuelto" || undefined });
    } });
  for (const [id, c] of Object.entries(cor || {})){
    if (c.cod !== cod) continue;
    const ini = min(c.momento), fin = c.hasta ? min(c.hasta) + 60e3 : ini + 60e3;
    if (fin < +desde || ini > +hasta + 864e5) continue;
    tramos.push({ id, g: GRUPO[c.var] || "todas", var: c.var, ini, fin, estado: c.estado === "rellenado" ? "rellenado" : "corregido",
      anterior: c.anterior, nuevo: c.nuevo, motivo: c.motivo, quien: c.quien, t: c.t });
  }
  tramos.sort((a, b) => a.ini - b.ini);
  return json({ cod, desde: dia(desde), hasta: dia(hasta), tramos }, { headers: { "Cache-Control": "public, max-age=120", "Access-Control-Allow-Origin": "*" } });
}
