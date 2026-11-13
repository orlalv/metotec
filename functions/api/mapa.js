// GET /api/mapa: último dato de cada estación automática y valores derivados para los mapas (público).
// Lee unos pocos archivos horarios del archivo de METOTEC (rama «datos»): el último disponible, la hora anterior
// (lluvia de 1 h), 12 h antes (extremas), 24 h y 48 h antes (lluvia de 72 h).
//   T Td HR P_mar ff10 dd10 fx10 → último registro · rr1h = suma de rr1m de los 60 min previos
//   rr24 = columna rr24 del último registro · rr72 = rr24 ahora + hace 24 h + hace 48 h (aproximada)
//   Tx24 / Tn24 = máx de Tx12 y mín de Tn12 ahora y hace 12 h (extremas de las últimas 24 h)
const RAW = "https://raw.githubusercontent.com/orlalv/metotec/datos/ema/";
const H = 3600e3;
const num = s => { if (s == null || s === "") return null; const v = parseFloat(s); return isFinite(v) ? v : null; };
const ms = s => Date.parse(String(s).replace(" ", "T") + "Z");
const ruta = t => new Date(t).toISOString().slice(0, 13).replace(/-/g, "/").replace("T", "/") + ".csv.gz";

async function archivo(t){
  const viejo = t < Date.now() - 2 * H;
  try {
    const r = await fetch(RAW + ruta(t), { cf: { cacheTtl: viejo ? 86400 : 120, cacheEverything: true } });
    if (!r.ok) return null;
    const tx = await new Response(r.body.pipeThrough(new DecompressionStream("gzip"))).text();
    const ls = tx.split("\n"), cab = ls[0].split(","), ix = {}; cab.forEach((c, i) => ix[c] = i);
    const filas = [];
    for (let i = 1; i < ls.length; i++){ if (!ls[i]) continue; const f = ls[i].split(","); filas.push({ cod: f[0], t: ms(f[1]), f, ix }); }
    return filas;
  } catch (e){ return null; }
}
// último registro de cada estación con momento ≤ corte (y no más de 40 min antes del corte)
function ultimos(filas, corte){
  const m = new Map();
  for (const x of filas || []){ if (x.t > corte || x.t < corte - 40 * 60e3) continue; const a = m.get(x.cod); if (!a || x.t > a.t) m.set(x.cod, x); }
  return m;
}
const val = (x, c) => x ? num(x.f[x.ix[c]]) : null;
const r1 = v => v == null ? null : Math.round(v * 10) / 10;

export async function onRequestGet(){
  const base = Math.floor(Date.now() / H) * H;
  let t0 = null, f0 = null;
  for (let k = 0; k < 4 && !f0; k++){ f0 = await archivo(base - k * H); if (f0) t0 = base - k * H; }
  if (!f0) return new Response(JSON.stringify({ error: "sin datos recientes en el archivo" }), { status: 503, headers: { "content-type": "application/json" } });
  const L = f0.reduce((a, x) => x.t > a ? x.t : a, 0);
  const [f1, f12, f24, f48] = await Promise.all([archivo(t0 - H), archivo(t0 - 12 * H), archivo(t0 - 24 * H), archivo(t0 - 48 * H)]);
  const ahora = ultimos(f0, L), h12 = ultimos(f12, L - 12 * H), h24 = ultimos(f24, L - 24 * H), h48 = ultimos(f48, L - 48 * H);
  const lluvia = new Map();   // rr1m de los 60 min previos a L
  for (const fl of [f0, f1]) for (const x of fl || []) if (x.t <= L && x.t > L - H){ const v = val(x, "rr1m"); if (v != null) lluvia.set(x.cod, (lluvia.get(x.cod) || 0) + v); }
  const est = {};
  for (const [cod, x] of ahora){
    const a24 = val(x, "rr24"), b = val(h24.get(cod), "rr24"), c = val(h48.get(cod), "rr24");
    const tx = [val(x, "Tx12"), val(h12.get(cod), "Tx12")].filter(v => v != null), tn = [val(x, "Tn12"), val(h12.get(cod), "Tn12")].filter(v => v != null);
    est[cod] = {
      hora: new Date(x.t).toISOString().slice(0, 16) + "Z",
      T: val(x, "T"), Td: val(x, "Td"), HR: val(x, "HR"), P_mar: val(x, "P_mar"),
      ff10: val(x, "ff10"), dd10: val(x, "dd10"), fx10: val(x, "fx10"),
      rr1h: r1(lluvia.get(cod) ?? null), rr24: a24,
      rr72: a24 == null ? null : r1(a24 + (b ?? 0) + (c ?? 0)),
      Tx24: tx.length ? Math.max(...tx) : null, Tn24: tn.length ? Math.min(...tn) : null
    };
  }
  return new Response(JSON.stringify({ generado: new Date().toISOString().slice(0, 19) + "Z", hasta: new Date(L).toISOString().slice(0, 16) + "Z", estaciones: est }), {
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "public, max-age=120", "access-control-allow-origin": "*" } });
}
