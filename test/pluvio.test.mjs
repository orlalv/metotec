// node --test test/pluvio.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { normalizar } from "../functions/api/_aguacaida.js";
import { analizar, km } from "../js/pluvio.js";

test("normalizar: año → mes → día con ruido de decimales y encabezado erróneo", () => {
  const js = { momento: "x", hayDatos: false, anoDesde: null,
    datos: { 2005: { 7: { 15: { parcial: 0, total: 17.799999237, traza: 0 }, 16: { parcial: null, total: null, traza: 0 } }, 8: { 30: { parcial: 0, total: 3.9000000954, traza: 1 } } } } };
  const N = normalizar(js);
  assert.equal(N.n, 3);
  assert.deepEqual(N.dias[0], ["2005-07-15", 0, 17.8, 0]);
  assert.deepEqual(N.dias[1], ["2005-07-16", null, null, 0]);
  assert.deepEqual(N.dias[2], ["2005-08-30", 0, 3.9, 1]);
});
test("normalizar: meses con nombre, claves con ceros y arreglos con campos propios", () => {
  const a = normalizar({ anos: { "2006": { Enero: { "01": { parcial: 1.1, total: 1.1, traza: false } } } } });
  assert.deepEqual(a.dias, [["2006-01-01", 1.1, 1.1, 0]]);
  const b = normalizar({ datos: [{ ano: 2007, meses: [{ mes: 3, dias: [{ dia: 4, parcial: "0,5", total: "0,5", traza: "1" }] }] }] });
  assert.deepEqual(b.dias, [["2007-03-04", 0.5, 0.5, 1]]);
  const c = normalizar({ x: [{ fecha: "2008-02-29", total: 2 }, { fecha: "2008-02-30", total: 9 }] });
  assert.equal(c.n, 1); assert.equal(c.sinFecha, 1);
});
test("normalizar: formato desconocido no inventa días", () => {
  const N = normalizar({ mensaje: "False indicar el usuario y/o el token de consulta" });
  assert.equal(N.n, 0); assert.match(N.mensaje, /token/);
});

// serie sintética 2009-2012 con los errores del caso real
function serie(){
  const dias = []; let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let t = Date.parse("2009-01-01T00:00:00Z"); t <= Date.parse("2012-12-31T00:00:00Z"); t += 864e5){
    const f = new Date(t).toISOString().slice(0, 10), llueve = rnd() < 0.04, v = llueve ? Math.round(rnd() * 30) / 10 + 0.1 : 0;
    dias.push([f, v, v, 0]);
  }
  return dias;
}
const set = (dias, f, p, t, z = 0) => { const d = dias.find(x => x[0] === f); d[1] = p; d[2] = t; d[3] = z; };

test("analizar: completitud, rachas y reglas internas", () => {
  const dias = serie();
  for (const d of dias) if (d[0] >= "2010-03-01" && d[0] <= "2010-03-10") { d[1] = null; d[2] = null; }   // racha de 10 días
  set(dias, "2010-07-15", 0, 17.8);      // total a las 12 sin repartir
  set(dias, "2011-05-02", 0.6, 6.0);     // decimal ×10
  set(dias, "2011-06-03", 1.8, 0.8);     // parcial ≠ total
  set(dias, "2011-08-09", 25.2, 25.2);   // valor alto
  const A = analizar(dias, { desde: "2009-01-01", hasta: "2012-12-31", umbralAlto: 5 });
  assert.equal(A.dias, 1461);
  assert.equal(A.cont.falta, 10);
  assert.equal(A.rachas[0].dias, 10); assert.equal(A.rachas[0].desde, "2010-03-01");
  const cod = f => A.marcas.filter(m => m.f === f).map(m => m.cod);
  assert.ok(cod("2010-07-15").includes("PT0"));   // 17.8 mm además supera el umbral de valor alto
  assert.deepEqual(cod("2011-05-02"), ["X10"]);
  assert.deepEqual(cod("2011-06-03"), ["PTD"]);
  assert.ok(cod("2011-08-09").includes("ALTO"));
  assert.ok(A.completitud < 100 && A.completitud > 99);
  assert.equal(A.epocas.antes.dias + A.epocas.despues.dias, 1461);
  assert.equal(A.anios.length, 4);
});
test("analizar: vacío, cero y traza son estados distintos", () => {
  const dias = [["2020-01-01", 0, 0, 0], ["2020-01-02", null, null, 0], ["2020-01-03", 0, 0, 1], ["2020-01-04", 2, 2, 0], ["2020-01-05", 1.5, null, 0]];
  const A = analizar(dias, { desde: "2020-01-01", hasta: "2020-01-06" });
  assert.deepEqual(A.reg.map(r => r.e), ["cero", "falta", "traza", "valor", "parcial", "falta"]);
  assert.equal(A.cont.sinFila, 1);
  assert.equal(A.completitud, 50);   // cuentan cero, traza y valor; no la falta ni el solo parcial
});
test("analizar: vecinas detectan decimal, lluvia aislada y faltante con lluvia", () => {
  const base = [], vecA = [], vecB = [];
  for (let d = 1; d <= 20; d++){ const f = `2015-03-${String(d).padStart(2, "0")}`; base.push([f, 0, 0, 0]); vecA.push([f, 0, 0, 0]); vecB.push([f, 0, 0, 0]); }
  const poner = (a, i, v) => { a[i - 1][1] = v; a[i - 1][2] = v; };
  poner(base, 5, 12.0); poner(vecA, 5, 1.2); poner(vecB, 5, 1.0);   // decimal: debería ser 1.2
  poner(base, 10, 6.0);                                             // aislada: ninguna vecina
  base[14][1] = null; base[14][2] = null; poner(vecA, 15, 4.0); poner(vecB, 15, 3.2);   // sin dato pero llovió
  const v = [{ cod: "A", nombre: "A", km: 20, dias: vecA }, { cod: "B", nombre: "B", km: 40, dias: vecB }];
  const R = analizar(base, { desde: "2015-03-01", hasta: "2015-03-20", vecinas: v, umbralAlto: 50 });
  const cod = f => R.marcas.filter(m => m.f === f).map(m => m.cod);
  assert.deepEqual(cod("2015-03-05"), ["V10"]);
  assert.equal(R.marcas.find(m => m.f === "2015-03-05").probable, 1.2);
  assert.deepEqual(cod("2015-03-10"), ["VSOLO"]);
  assert.deepEqual(cod("2015-03-15"), ["VFALTA"]);
});
test("analizar: una tormenta real (25 mm aquí, 4 mm en vecinas) no se marca como error de decimal", () => {
  const f = "2011-07-08", un = v => [[f, v, v, 0]];
  const R = analizar(un(25.2), { desde: f, hasta: f, umbralAlto: 50, vecinas: [{ cod: "A", nombre: "A", km: 10, dias: un(3.9) }, { cod: "B", nombre: "B", km: 20, dias: un(4.0) }] });
  assert.deepEqual(R.marcas.map(m => m.cod), []);
});
test("km: Caldera–Copiapó ≈ 52 km", () => {
  const d = km({ lat: -27.25444, lon: -70.78111 }, { lat: -27.35889, lon: -70.35333 });
  assert.ok(d > 40 && d < 60, String(d));
});
