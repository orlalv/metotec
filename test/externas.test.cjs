// js/externas.js: vecinas más cercanas, estaciones desactivadas fuera y lluvia por hora (hora UTC en que termina), sin navegador.
const fs = require("fs"), assert = require("assert");
const resp = (j, ok = true) => Promise.resolve({ok, json: () => Promise.resolve(j)});
const API = {
  cat: {estaciones: [{id: "INIA:1", nombre: "A", inst: "INIA", lat: -33.00, lon: -70.0, alt: 100}, {id: "INIA:2", nombre: "B", inst: "INIA", lat: -33.10, lon: -70.0, alt: 100},
    {id: "CEAZA:3", nombre: "C", inst: "CEAZA", lat: -33.20, lon: -70.0, alt: 100}, {id: "INIA:4", nombre: "D", inst: "INIA", lat: -33.30, lon: -70.0, alt: 100}, {id: "INIA:9", nombre: "Lejos", inst: "INIA", lat: -20, lon: -70, alt: 5}]},
  PP: {datos: {"INIA:1": {"2026-11-18T10": 1.2, "2026-11-18T11": 0.4}, "INIA:2": {"2026-11-18T10": 0.0}, "INIA:4": {"2026-11-18T10": 3}}},
  off: {off: ["INIA:4"]}};
global.sessionStorage = {getItem: () => "clave"};
global.window = global;
global.fetch = u => { const v = new URL(u, "http://x").searchParams.get("v"); return resp(API[v] || null, !!API[v]); };
new Function(fs.readFileSync(__dirname + "/../js/externas.js", "utf8"))();
(async () => {
  const X = await EXTV.datos(true);
  assert(!X.cat.has("INIA:4"), "una estación desactivada no debe entrar");
  assert.equal(X.pp.get("INIA:1").get(Date.UTC(2026, 10, 18, 10)), 1.2);
  const v = EXTV.vecinas(X, -33.02, -70.0, 60);
  assert.deepEqual(v.map(x => x[0]), ["INIA:1", "INIA:2", "CEAZA:3"]);          // la lejana (> 60 km) y la desactivada quedan fuera
  assert.equal(EXTV.vecinas(X, -33.02, -70.0, 60, 2).length, 2);                 // tope
  assert.equal(EXTV.PESO, 0.5);
  console.log("externas.js OK");
})().catch(e => { console.error(e); process.exit(1); });
