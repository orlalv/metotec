// node --test test/boletin_marcas.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { aplicar, igual, idB } from "../functions/api/_boletin_marcas.js";

const bol = () => ({ dia: "2026-11-16", filas: [{ nombre: "Chacalluta", v: { tn: "22.5", tn_h: "04:04", rr24: "S/P" },
  marcas: { tn: { nivel: "err", msg: "Mínima 22.5, la automática marcó 21.9" }, tn_h: { nivel: "warn", msg: "Hora 04:04, la mínima fue a las 04:12" } } }],
  items: [{ estacion: "Chacalluta", col: "tn", nivel: "err", msg: "Mínima 22.5, la automática marcó 21.9" }, { estacion: "Chacalluta", col: "tn_h", nivel: "warn", msg: "Hora 04:04, la mínima fue a las 04:12" }] });
const env = R => ({ DATOS: { get: async () => R } });

test("igual: las horas se comparan como hh:mm, no como número", () => {
  assert.equal(igual("04:04", "04:30"), false);
  assert.equal(igual("4:12", "04:12"), true);
  assert.equal(igual("21.90", "21.9"), true);
  assert.equal(igual("S/P", "S/P"), true);
  assert.equal(igual("22.5", "21.9"), false);
});
test("valor corregido: la marca se quita y la celda muestra el valor nuevo hasta que el portal lo traiga", async () => {
  const R = { [idB("2026-11-16", "Chacalluta", "tn")]: { v: "resuelto", valor: "21.9", t: "2026-11-16T13:00:00", msg: "Mínima 22.5, la automática marcó 21.9", quien: "Orlando" } };
  const r = await aplicar(env(R), bol());
  assert.equal(r.items.length, 1);                       // el aviso de la mínima ya no sale
  assert.equal(r.filas[0].v.tn, "21.9");                 // se ve el valor correcto
  assert.equal(r.filas[0].marcas.tn.nivel, "corr");
  assert.match(r.filas[0].marcas.tn.sub, /antes 22.5/);
  assert.equal(r.revisados[0].valor, "21.9");
  assert.equal(r.pendientes_portal.length, 1);
});
test("hora corregida distinta de la del portal sigue pendiente (04:30 ≠ 04:04)", async () => {
  const R = { [idB("2026-11-16", "Chacalluta", "tn_h")]: { v: "resuelto", valor: "04:12", t: "2026-11-16T13:00:00", msg: "Hora 04:04, la mínima fue a las 04:12" } };
  const r = await aplicar(env(R), bol());
  assert.equal(r.filas[0].v.tn_h, "04:12");
  assert.equal(r.filas[0].marcas.tn_h.nivel, "corr");
});
test("cuando el portal ya trae el valor, queda confirmado", async () => {
  const b = bol(); b.filas[0].v.tn = "21.9";
  const R = { [idB("2026-11-16", "Chacalluta", "tn")]: { v: "resuelto", valor: "21.9", t: "x", msg: "Mínima 22.5, la automática marcó 21.9" } };
  const r = await aplicar(env(R), b);
  assert.equal(r.filas[0].marcas.tn.sub, "corregido");
  assert.equal(r.pendientes_portal.length, 0);
});
test("sin marcas manuales no cambia nada", async () => {
  const r = await aplicar(env({}), bol());
  assert.equal(r.items.length, 2); assert.equal(r.filas[0].marcas.tn.nivel, "err");
});
