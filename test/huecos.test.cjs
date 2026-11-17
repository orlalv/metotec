const fs = require("fs"), assert = require("assert"), mod = {exports: {}};
new Function("module", fs.readFileSync(__dirname + "/../js/huecos.js", "utf8"))(mod);
const H = mod.exports;
const cad = 600e3, ini = Date.UTC(2026, 10, 10), n = 144;
const mk = (f, borrar = []) => Array.from({length: n}, (_, k) => borrar.includes(k) ? null : {t: ini + (k + 1) * cad, T: f(k)}).filter(Boolean);
const lim = ini + n * cad, L = H.LIM.T;
// 1) interpolación: hueco de 1 hora (6 pasos) en una recta
let F = mk(k => 10 + k * .1, [50, 51, 52, 53, 54, 55]);
let S = H.analizar(F, "T", ini, lim, cad, true, []);
assert.equal(S.gaps.length, 1); assert.equal(S.gaps[0].met, "interpolación"); assert.equal(S.gaps[0].n, 6);
S.gaps[0].est.forEach((x, i) => assert(Math.abs(x - (10 + (50 + i) * .1)) < 1e-9));
// 2) hueco largo (5 h) sin vecinas: sin método
F = mk(k => 10 + Math.sin(k / 20) * 5, Array.from({length: 30}, (_, i) => 40 + i));
S = H.analizar(F, "T", ini, lim, cad, true, []);
assert.equal(S.gaps[0].met, "ninguno"); assert.equal(H.valores(S.gaps[0]), null);
// 3) hueco largo con una vecina que sigue a la estación (T_v = 0.8·T + 2) → regresión, error pequeño
const f = k => 12 + Math.sin(k / 20) * 5, borrar = Array.from({length: 30}, (_, i) => 40 + i);
const vec = [{cod: "X", nombre: "Vecina", F: mk(k => 0.8 * f(k) + 2)}, {cod: "Y", nombre: "Mala", F: mk(k => Math.cos(k * 1.3) * 9)}];
S = H.analizar(mk(f, borrar), "T", ini, lim, cad, true, vec);
const g = S.gaps[0]; assert.equal(g.met, "regresión"); assert(/Vecina/.test(g.det));
g.est.forEach((x, i) => assert(Math.abs(x - f(40 + i)) < .05, `reg ${i} ${x} vs ${f(40 + i)}`));
// 4) hueco al final: solo cuenta si el día ya terminó
F = mk(k => 10, Array.from({length: 20}, (_, i) => n - 20 + i));
assert.equal(H.analizar(F, "T", ini, lim, cad, false, []).gaps.length, 0);
assert.equal(H.analizar(F, "T", ini, lim, cad, true, []).gaps.length, 1);
// 5) valores fuera de rango o con pico marcado cuentan como hueco
F = mk(k => 10); F[30].T = 99; F[60]._pT = true;
assert.equal(H.analizar(F, "T", ini, lim, cad, true, []).gaps.length, 2);
// 6) curva a mano: pasa por los puntos de control y se ancla a los bordes
F = mk(k => 10, [50, 51, 52, 53, 54, 55]); S = H.analizar(F, "T", ini, lim, cad, true, []); const gp = S.gaps[0];
gp.hand = H.manoInicial(gp, S.g, gp.est, L); gp.hand[0].y = 14; gp.tocado = true; const c = H.curvaMano(gp, gp.hand);
assert.equal(c.length, 6); assert(c.every(x => x >= 9.99 && x <= 14.01)); assert(Math.abs(c[gp.hand[0].k - gp.k0] - 14) < 1e-9);
// 7) CSV: solo estimados, marcados
const csv = H.csv(S, "T", "330020", "Quinta Normal", "2026-11-10"); assert(/VALORES ESTIMADOS/.test(csv)); assert(csv.split("\n").length === 2 + 6); assert(/manual/.test(csv));
// 8) una sola ausencia en una serie cada 10 min
F = mk(k => 15, [70]); S = H.analizar(F, "T", ini, lim, cad, true, []); assert.equal(S.gaps[0].n, 1); assert(Math.abs(S.gaps[0].est[0] - 15) < 1e-9);
console.log("huecos: 8 pruebas OK");
