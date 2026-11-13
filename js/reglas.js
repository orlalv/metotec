/* Nombres claros de las reglas (el código va chico al lado) y página «Reglas» con los umbrales.
   Si se agrega una regla en qc/sensorial.py, agregar aquí su nombre. */
(function(){
const N = {
  C01: "Niebla con visibilidad ≥ 1000 m", C02: "Neblina con visibilidad < 1000 m", C03: "Humo o calima con visibilidad > 5000 m",
  C04: "Niebla baja con visibilidad < 1000 m", C05: "Visibilidad reducida sin fenómeno", C06: "Visibilidad no cifrable en SYNOP",
  C07: "Neblina con aire seco", C08: "Calima con aire húmedo", C09: "Llovizna con nubes cumuliformes", C10: "Chubasco sin nubes que lo den",
  C11: "Tormenta sin Cb (CL)", C12: "Precipitación continua sin cielo cubierto", C13: "Lluvia o llovizna bajo 0 °C", C14: "N 0 con capas",
  C15: "Capa con más octas que N", C16: "N sin capas", C17: "Capas desordenadas", C18: "N mayor que la suma de capas",
  C19: "Capas sobre una de 8 octas", C20: "Nh mayor que N", C21: "CL de Cb sin capa Cb", C22: "Capa Cb con CL distinto de 3/9",
  C23: "Dirección de nubes sin esas nubes", C24: "Calma con dirección", C25: "Viento con dirección 0", C26: "Dirección de viento inválida",
  C27: "W1 menor que W2", C29: "Tormenta sin capa Cb", C30: "Precipitación continua solo con cumuliformes", C31: "Llovizna solo con cumuliformes",
  C32: "Capa TCu con CL incorrecto", C33: "Visibilidad < 5000 m sin fenómeno", C34: "METAR DZ/RA sin precipitación en SYNOP",
  C35: "METAR BR distinto del ww", C36: "METAR FG sin niebla en ww", C37: "METAR HZ distinto del ww", C38: "St muy alto", C39: "Nube baja muy alta",
  C40: "CL sin su capa", C41: "Td mayor que Ts",
  E01: "Fin de precipitación sin ww 20–27", E03: "Llovizna a chubasco sin cambio de nubes", E04: "Chubasco a lluvia continua sin cambio de nubes",
  E05: "Niebla adelgaza y baja la visibilidad", E06: "Niebla espesa y sube la visibilidad", E07: "ww 01 con N que sube", E08: "ww 03 con N que baja",
  E09: "Salto de QFE en una hora", E10: "Tiempo pasado (W1) incorrecto", E11: "W1 sin ww que lo respalde", E12: "Precipitación con RRR6 0",
  E13: "RRR6 sin precipitación", E14: "ppp no cuadra con el QFE", E15: "Característica a de baja con QFE que sube", E16: "Característica a de subida con QFE que baja",
  E17: "Precipitación sin traza", E18: "Salto en la base de nubes", E19: "Valor fuera de lo posible", E20: "Error de digitación (contra la serie)",
  STs: "Ts frente al sensor", STd: "Td frente al sensor", SHR: "HR frente al sensor", SQFE: "QFE frente al sensor", SQFF: "QFF frente al sensor",
  SQNH: "QNH frente al sensor", Sff: "Viento frente al sensor", Sffkmh: "Viento anotado en km/h", Sdd: "Dirección frente al sensor", Sracha: "Racha sin informar",
  SBTs: "Diferencia constante de Ts", SBTd: "Diferencia constante de Td", SBHR: "Diferencia constante de HR", SBQFE: "Diferencia constante del QFE",
  SBQFF: "Diferencia constante del QFF", SBQNH: "Diferencia constante del QNH",
  SEXT: "Extrema: valor", SEXH: "Extrema: hora", SEXF: "Extrema fuera de bloque sin ingresar", SRRR6: "RRR6 frente al pluviómetro",
  SPRE: "Pluviómetro y tiempo presente", SinDato: "Sin dato", St: "Satélite: nubosidad", Sc: "Satélite: nubes", SD: "Satélite"
};
const nombre = c => N[c] || (c && c.startsWith("SB") && N["SB" + c.slice(2)]) || c;
const html = (c, esc) => `${esc(nombre(c))}${N[c] ? ` <small style="color:var(--mu);font-family:var(--mono)">${esc(c)}</small>` : ""}`;

// a qué pestaña va cada regla de observaciones (cada alerta vive en un solo lugar; lo demás queda en «Observaciones»)
const PESTANA = {SEXT: "ext", SEXH: "ext", SEXF: "ext",
  SRRR6: "pp", SPRE: "pp", E12: "pp", E13: "pp", E17: "pp",
  STs: "tem", STd: "tem", SHR: "tem", SBTs: "tem", SBTd: "tem", SBHR: "tem", C41: "tem"};
const pestana = c => PESTANA[c] || "obs";

const UMBRALES = [
  ["Frente al sensor (observaciones)", [
    "Presión (QFE, QFF, QNH): se alerta sobre 2 hPa, descontada la diferencia propia de la estación; en aeródromos se acepta el sensor de pista.",
    "Ts: sobre 1,5 °C. Viento: sobre 10 kt. Si el valor anotado aparece en algún minuto de la hora previa, no se alerta.",
    "Tolerancias base: presiones 0,5 hPa · Ts y Td 0,3 °C · HR 3 %.",
    "Viento en km/h (Sffkmh): solo si la diferencia con el sensor es ≥ 3 kt y el valor en km/h calza mejor.",
    "Diferencia constante (SB…): una vez por estación y día, informativa."]],
  ["Contra la propia serie del observador", [
    "Error de digitación (E20) en presión, Ts, Td, HR y viento: un valor que rompe la secuencia de las horas vecinas. Si el sensor también tuvo el salto, es real y no se alerta."]],
  ["Precipitación", [
    "RRR6 debe calzar con la suma del pluviómetro en las 6 h que cierran a las 00, 06, 12 y 18 UTC.",
    "Traza con pluviómetro ≥ 0,2 mm → dudoso («Debería ir: RRR6 x.x»). Traza con RRR6 ≠ 0.0 → dudoso. Traza sin fenómenos en 6 h y pluviómetro 0 → informativo."]],
  ["Extremas", [
    "TnAM/TxAM (00–12 UTC) y TnPM/TxPM (12–00 UTC) frente a la extrema oficial de la estación automática, en valor y hora (hora local)."]],
  ["Codificación y visibilidad", [
    "Fenómenos que reducen la visibilidad (humo, calima, polvo, neblina): se avisa solo con VV > 8000 m.",
    "C40 (CL sin su capa): solo si no hay ninguna capa baja."]],
  ["Estaciones automáticas", [
    "HR pegada: solo si el mismo valor dura 10 h o más.",
    "Modelos: no se compara QFF sobre 1500 m; más tolerancia en estaciones de altura aisladas. Temperatura 6 °C, humedad 35 %, viento 15 kt, QFF 5 hPa, Td 9 °C.",
    "Fallas de sensor (rango, salto, valor pegado, radiación) se agrupan por episodio: inicio, fin y duración."]],
];
function pagina(cont, esc){
  const filas = Object.keys(N).sort().map(c => `<tr><td style="font-family:var(--mono)">${esc(c)}</td><td>${esc(N[c])}</td><td>${({ext: "Extremas", pp: "Precipitación", tem: "Temperaturas", obs: "Observaciones"})[pestana(c)]}</td></tr>`).join("");
  cont.innerHTML = `<h2 style="font:600 18px var(--titulo);margin:0 0 10px">Reglas y umbrales</h2>
    ${UMBRALES.map(([t, L]) => `<h4 style="margin:14px 0 4px;font:600 14px var(--titulo)">${esc(t)}</h4><ul style="margin:0;padding-left:20px">${L.map(x => `<li>${esc(x)}</li>`).join("")}</ul>`).join("")}
    <h4 style="margin:18px 0 6px;font:600 14px var(--titulo)">Reglas de las observaciones</h4>
    <table style="width:auto"><tr><th>Código</th><th>Nombre</th><th>Pestaña</th></tr>${filas}</table>`;
}
window.REGLAS = {nombre, html, pestana, pagina};
})();
