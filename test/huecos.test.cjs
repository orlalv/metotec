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
// ---- lluvia (rr1m): intensidad previa, nunca interpolación ----
const cad1 = 60e3, ini1 = Date.UTC(2026, 10, 17), n1 = 1440, lim1 = ini1 + n1 * cad1;
const mkL = (f, borrar = [], extra = {}) => Array.from({length: n1}, (_, k) => borrar.includes(k) ? null : Object.assign({t: ini1 + (k + 1) * cad1, rr1m: f(k)}, extra[k] || {})).filter(Boolean);
const rango = (a, b) => Array.from({length: b - a + 1}, (_, i) => a + i);
// 9) lloviendo 0.02 mm/min y se corta 15 min sin RRR6: se prolonga la intensidad (0.02 × 15 = 0.30 mm), no se interpola
let FL = mkL(k => k >= 960 && k < 1100 ? .02 : 0, rango(990, 1004));
let SL = H.analizar(FL, "rr1m", ini1, lim1, cad1, true, []); let gl = SL.gaps[0];
assert.equal(SL.gaps.length, 1); assert.equal(gl.met, "intensidad previa"); assert.equal(gl.est.length, 15);
assert(gl.est.every(x => Math.abs(x - .02) < 1e-9)); assert(/estimaci/.test(gl.det));
// 10) sin lluvia antes ni después: relleno con 0 (no se inventa lluvia entre dos ceros)
FL = mkL(k => 0, rango(300, 314)); SL = H.analizar(FL, "rr1m", ini1, lim1, cad1, true, []);
assert.equal(SL.gaps[0].met, "relleno 0"); assert(SL.gaps[0].est.every(x => x === 0));
// 11) no llovía antes y sí después: no se estima, se deja a mano
FL = mkL(k => k >= 315 ? .05 : 0, rango(300, 314)); SL = H.analizar(FL, "rr1m", ini1, lim1, cad1, true, []);
assert.equal(SL.gaps[0].met, "ninguno");
// 12) lluvia continua > 1 h sin RRR6: no se prolonga
FL = mkL(k => .03, rango(500, 580)); SL = H.analizar(FL, "rr1m", ini1, lim1, cad1, true, []); assert.equal(SL.gaps[0].met, "ninguno");
// 13) con RRR6 informada: el total del hueco es RRR6 − observado y la intensidad solo lo reparte
// período 12–18 UTC = minutos 720..1079; lluvia .02 mm/min, hueco de 15 min dentro, RRR6 informada = 8.0 mm (observado 6.9 mm)
FL = mkL(k => k >= 720 && k < 1080 ? .02 : 0, rango(900, 914), {1079: {rr6: 8}}); SL = H.analizar(FL, "rr1m", ini1, lim1, cad1, true, []);
gl = SL.gaps[0]; const obs6 = 345 * .02;
assert.equal(gl.met, "intensidad previa + RRR6"); assert(Math.abs(gl.total - (8 - obs6)) < 1e-3, "total " + gl.total);
assert(Math.abs(gl.est.reduce((a, b) => a + b, 0) - (8 - obs6)) < 0.015);          // se conserva el total (salvo redondeo del reparto)
// 14) lo observado ya supera la RRR6: se avisa, no se estima
FL = mkL(k => k >= 720 && k < 1080 ? .02 : 0, rango(900, 914), {1079: {rr6: 3}}); SL = H.analizar(FL, "rr1m", ini1, lim1, cad1, true, []);
assert.equal(SL.gaps[0].met, "ninguno"); assert(/supera la RRR6/.test(SL.gaps[0].det));
// 15) a mano (lluvia): curva acumulada no decreciente, nunca negativa, que respeta el total anclado
FL = mkL(k => k >= 720 && k < 1080 ? .02 : 0, rango(900, 914), {1079: {rr6: 8}}); SL = H.analizar(FL, "rr1m", ini1, lim1, cad1, true, []); gl = SL.gaps[0];
gl.hand = H.manoInicial(gl, SL.g, gl.est, SL.L); assert(gl.hand.length >= 5); gl.hand[1].y = 0; gl.hand[2].y = .5; gl.tocado = true;   // 2.º punto por debajo del 3.º: sigue siendo monótona
const incs = H.valores(gl); assert.equal(incs.length, 15); assert(incs.every(x => x >= 0 && x <= 5));
assert(Math.abs(incs.reduce((a, b) => a + b, 0) - gl.total) < 0.02);
// 16) CSV de lluvia con 3 decimales y marcado como estimado
assert(/,rr1m,0\.\d{1,3},manual,/.test(H.csv(SL, "rr1m", "430002", "Futaleufú", "2026-11-17")));
console.log("huecos lluvia: 8 pruebas OK");
