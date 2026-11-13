import test from "node:test";
import assert from "node:assert/strict";
import { evaluar, cumple } from "../../js/alertas_core.js";
import { numero, texto, resumir } from "../src/dmc.js";
import { planificar, mensaje } from "../src/avisos.js";
import { correr } from "../src/index.js";

const ahora = Date.parse("2026-11-13T12:00:00Z");
const ema = {datos_hasta: "2026-11-13 11:55:00", estaciones: [
  {codigo: "180005", nombre: "Arica", lat: -18.3, nivel: 0, hora: "2026-11-13 11:55:00", valores: {T: 21.4, rr1h: 0.4, ff10: 12}},
  {codigo: "330020", nombre: "Santiago", lat: -33.4, nivel: 3, hora: null, valores: {}}]};
const obs = {estaciones: [
  {codigo: "180005", nombre: "Arica", lat: -18.3, ultima: "2026-11-13T11:00:00", ult: [{h: "2026-11-13T11:00:00", ww: 8, RRR6: 0}]},
  {codigo: "330020", nombre: "Santiago", lat: -33.4, ultima: "2026-11-13T08:00:00", ult: [{h: "2026-11-13T08:00:00", ww: 2}]}]};
const P = alertas => ({nombre: "Ana", estaciones: ["330020"], alertas});

test("operadores y rangos", () => {
  assert.ok(cumple(8, "en", "07-09,30-35")); assert.ok(!cumple(10, "en", "07-09,30-35")); assert.ok(cumple(32, "en", "07-09,30-35"));
  assert.ok(cumple(0.4, ">", "0")); assert.ok(!cumple(0, ">", "0")); assert.ok(!cumple(null, ">", "0")); assert.ok(!cumple("x", "=", "x"));
});
test("EMA por umbral, zona y sin dato", () => {
  const H = evaluar(P([{id: "a", fuente: "ema", donde: "norte", var: "rr1h", op: ">", valor: "0"}, {id: "b", fuente: "ema", donde: "mias", op: "sin"}]), ema, obs, ahora);
  assert.deepEqual(H.map(h => h.id), ["a|180005", "b|330020"]);
  assert.match(H[0].texto, /lluvia 1 h \(mm\) = 0.4 \(> 0\)/);
});
test("observaciones: ww en rango y sin mensaje en 2 h", () => {
  const H = evaluar(P([{id: "c", fuente: "obs", donde: "todas", var: "ww", op: "en", valor: "07-09"}, {id: "d", fuente: "obs", donde: "todas", op: "sin"}]), ema, obs, ahora);
  assert.deepEqual(H.map(h => h.id), ["c|180005", "d|330020"]);       // Arica a las 11:00 aún está dentro de 2 h; Santiago (08:00) no
});
test("reglas inactivas no se evalúan", () => {
  assert.equal(evaluar(P([{id: "a", fuente: "ema", donde: "todas", var: "rr1h", op: ">", valor: "0", activa: false}]), ema, obs, ahora).length, 0);
});

test("avisos: solo lo nuevo, no a ausentes, y se conserva el estado si falla una fuente", () => {
  const eq = {personas: [{...P([{id: "a", fuente: "ema", donde: "todas", var: "rr1h", op: ">", valor: "0"}, {id: "d", fuente: "obs", donde: "todas", op: "sin"}]), telegram: "1"},
                         {nombre: "Beto", ausente: true, telegram: "2", alertas: [{id: "a", fuente: "ema", donde: "todas", var: "rr1h", op: ">", valor: "0"}]}]};
  const p1 = planificar(eq, ema, obs, {}, {ahora});
  assert.deepEqual(p1.avisar.map(x => [x.persona.nombre, x.nuevos.length]), [["Ana", 2]]);
  assert.deepEqual(p1.estado, {Ana: ["a|180005", "d|330020"], Beto: ["a|180005"]});
  assert.equal(planificar(eq, ema, obs, p1.estado, {ahora}).avisar.length, 0);                       // sin cambios: no repite
  const p3 = planificar(eq, null, obs, p1.estado, {ahora, sinEma: true});                            // DMC caída: la lluvia no se da por terminada
  assert.deepEqual(p3.estado.Ana, ["a|180005", "d|330020"]); assert.equal(p3.avisar.length, 0);
  const p4 = planificar(eq, {estaciones: [{...ema.estaciones[0], valores: {rr1h: 0}}]}, obs, p1.estado, {ahora});   // cesa y vuelve a aparecer
  assert.deepEqual(p4.estado.Ana, ["d|330020"]);
  assert.equal(planificar(eq, ema, obs, p4.estado, {ahora}).avisar[0].nuevos[0].id, "a|180005");
});
test("mensaje corta a 30 líneas", () => assert.equal(mensaje(Array.from({length: 40}, (_, i) => ({texto: "x" + i}))).split("\n").length, 31));

test("DMC: valores con unidad, último registro y lluvia de la última hora", () => {
  assert.equal(numero("1011.6 hPas."), 1011.6); assert.equal(numero(null), null); assert.equal(texto("QuimÃ¡vida"), "Quimávida");
  const mk = (m, extra) => ({momento: m, temperatura: "20.24 °C", aguaCaidaDelMinuto: "0.2 mm", ...extra});
  const js = {datosEstaciones: [
    {estacion: {codigoNacional: 180005, nombreEstacion: "Arica", latitud: "-18.35"}, datos: [mk("2026-11-13 10:30:00"), mk("2026-11-13 11:00:00"), mk("2026-11-13 11:50:00", {puntoDeRocio: "10.0 °C"})]},
    {estacion: {codigoNacional: 330020, nombreEstacion: "Santiago", latitud: "-33.4"}, datos: []}]};
  const r = resumir(js, ahora), a = r.estaciones[0];
  assert.equal(a.valores.T, 20.2); assert.equal(a.valores.Td, 10); assert.equal(a.valores.rr1h, 0.4);   // el de las 10:30 queda fuera (>60 min)
  assert.equal(a.hora, "2026-11-13 11:50:00"); assert.equal(r.datos_hasta, a.hora); assert.equal(r.estaciones[1].nivel, 3);
});

test("correr: KV, envío fallido se reintenta y no avisa dos veces", async () => {
  const kv = new Map([["qc/equipo", {personas: [{nombre: "Ana", telegram: "1", estaciones: [], alertas: [{id: "a", fuente: "ema", donde: "todas", var: "rr1h", op: ">", valor: "0"}]}]}], ["qc/sensorial", obs]]);
  const env = {DMC_USUARIO: "u", DMC_TOKEN: "t", TELEGRAM_TOKEN: "tk",
    DATOS: {get: async k => kv.has(k) ? JSON.parse(JSON.stringify(kv.get(k))) : null, put: async (k, v) => kv.set(k, JSON.parse(v))}};
  const js = {datosEstaciones: [{estacion: {codigoNacional: 1, nombreEstacion: "A", latitud: "-20"}, datos: [{momento: "2026-11-13 11:55:00", aguaCaidaDelMinuto: "1 mm"}]}]};
  let tg = [], okTg = false; const f0 = globalThis.fetch;
  globalThis.fetch = async u => { u = String(u); if (u.includes("getDatosRecientesRedEma")) return new Response(JSON.stringify(js)); tg.push(u); return new Response("{}", {status: okTg ? 200 : 500}); };
  try {
    let r = await correr(env, ahora); assert.equal(tg.length, 1); assert.equal(r.envios, 0); assert.deepEqual(kv.get("qc/avisos_enviados").Ana, []);   // falló: queda pendiente
    okTg = true; r = await correr(env, ahora); assert.equal(tg.length, 2); assert.equal(r.envios, 1); assert.deepEqual(kv.get("qc/avisos_enviados").Ana, ["a|1"]);
    await correr(env, ahora); assert.equal(tg.length, 2);                                                                                          // ya avisado
    assert.equal(kv.get("qc/ema_rapido").estaciones[0].valores.rr1h, 1);
  } finally { globalThis.fetch = f0; }
});

test("fenómeno (ww o METAR): chubascos y nieve sin importar quién los informe", () => {
  const o = {estaciones: [
    {codigo: "1", nombre: "A", lat: -33, ultima: "2026-11-13T11:30:00", ult: [{h: "2026-11-13T11:00:00", ww: 10}, {h: "2026-11-13T11:30:00", fm: "SHSN BR"}]},
    {codigo: "2", nombre: "B", lat: -33, ultima: "2026-11-13T11:00:00", ult: [{h: "2026-11-13T11:00:00", ww: 81}]},
    {codigo: "3", nombre: "C", lat: -33, ultima: "2026-11-13T11:00:00", ult: [{h: "2026-11-13T11:00:00", ww: 61, fm: "-RA VCSH"}]},
    {codigo: "4", nombre: "D", lat: -33, ultima: "2026-11-13T11:00:00", ult: [{h: "2026-11-13T11:00:00", fm: "SN BLSN"}]},
    {codigo: "5", nombre: "E", lat: -33, ultima: "2026-11-13T05:00:00", ult: [{h: "2026-11-13T05:00:00", ww: 80}]}]};
  const ch = evaluar(P([{id: "x", fuente: "obs", donde: "todas", var: "fen", op: "hay", valor: "chubasco"}]), ema, o, ahora).map(h => h.codigo);
  assert.deepEqual(ch, ["1", "2"]);                       // 3: VCSH no cuenta; 5: hace más de 3 h
  const ni = evaluar(P([{id: "y", fuente: "obs", donde: "todas", var: "fen", op: "hay", valor: "nieve"}]), ema, o, ahora).map(h => h.codigo);
  assert.deepEqual(ni, ["1", "4"]);
  const sig = evaluar(P([{id: "z", fuente: "obs", donde: "todas", var: "fen", op: "hay", valor: "SHSN"}]), ema, o, ahora).map(h => h.codigo);
  assert.deepEqual(sig, ["1"]);
});
