// Marcas manuales del boletín revisado: «Correcto / sin efecto» (v:"omitir") y «Resuelto» (v:"resuelto").
// Se guardan con /api/revision en qc/rev/<día del boletín> con id  b|<día>|<estación>|<columna>.
// Quitan la marca del boletín (tabla, lista de inconsistencias y versión pública) y quedan registradas en «revisados».
// «omitir» no vuelve nunca; «resuelto» vuelve solo si el aviso cambió de texto.
export const idB = (dia, estacion, col) => `b|${dia}|${estacion}|${col}`;

export async function aplicar(env, b){
  if (!b || !b.dia || !b.filas) return b;
  let R = {};
  try { R = (await env.DATOS.get("qc/rev/" + b.dia, "json")) || {}; } catch (e){}
  const revisados = [];
  const oculta = (est, col, msg) => {
    const m = R[idB(b.dia, est, col)];
    if (!m || !["omitir", "resuelto"].includes(m.v)) return false;
    return m.v === "omitir" || !m.msg || m.msg === msg;
  };
  const items = (b.items || []).filter(x => {
    if (!oculta(x.estacion, x.col, x.msg)) return true;
    const m = R[idB(b.dia, x.estacion, x.col)];
    revisados.push({ estacion: x.estacion, col: x.col, msg: x.msg, v: m.v, t: m.t, quien: m.quien });
    return false;
  });
  // «Resuelto» con el valor corregido: se muestra el valor nuevo (azul) hasta que el portal lo traiga; si el portal sigue con el
  // valor anterior, se avisa
  const corr = [];
  const filas = b.filas.map(f => {
    const marcas = {}, v = { ...f.v };
    for (const [c, m] of Object.entries(f.marcas || {})) if (!oculta(f.nombre, c, m && m.msg)) marcas[c] = m;
    for (const c of Object.keys(f.v || {})){
      const m = R[idB(b.dia, f.nombre, c)];
      if (!m || m.v !== "resuelto" || m.valor == null) continue;
      const portal = String(f.v[c] ?? "").trim();
      if (portal === m.valor || parseFloat(portal) === parseFloat(m.valor)){
        marcas[c] = { nivel: "corr", sub: "corregido", msg: `Corregido a ${m.valor}${m.quien ? " por " + m.quien : ""} y confirmado en el portal` };
      } else {
        v[c] = m.valor;
        marcas[c] = { nivel: "corr", sub: "antes " + portal, msg: `Marcado como corregido a ${m.valor}${m.quien ? " por " + m.quien : ""} (${m.t} UTC), pero el portal aún muestra ${portal}. Se confirmará en la próxima revisión del boletín.` };
        corr.push({ estacion: f.nombre, col: c, antes: portal, ahora: m.valor, t: m.t, quien: m.quien });
      }
    }
    return { ...f, v, marcas };
  });
  return { ...b, items, filas, revisados, pendientes_portal: corr };
}
