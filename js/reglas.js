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
  C40: "CL sin su capa", C41: "Td mayor que Ts", C41H: "HR no calza con Ts y Td",
  E01: "Fin de precipitación sin ww 20–27", E03: "Llovizna a chubasco sin cambio de nubes", E04: "Chubasco a lluvia continua sin cambio de nubes",
  E05: "Niebla adelgaza y baja la visibilidad", E06: "Niebla espesa y sube la visibilidad", E07: "ww 01 con N que sube", E08: "ww 03 con N que baja",
  E09: "Salto de QFE en una hora", E10: "Tiempo pasado (W1) incorrecto", E11: "W1 sin ww que lo respalde", E12: "Precipitación con RRR6 0",
  E13: "RRR6 sin precipitación", E14: "ppp no cuadra con el QFE", E15: "Característica a de baja con QFE que sube", E16: "Característica a de subida con QFE que baja",
  E17: "Precipitación sin traza", E18: "Salto en la base de nubes", E19: "Valor fuera de lo posible", E20: "Error de digitación (contra la serie)",
  STs: "Ts frente al sensor", STd: "Td frente al sensor", SHR: "HR frente al sensor", SQFE: "QFE frente al sensor", SQFF: "QFF frente al sensor",
  SQNH: "QNH frente al sensor", Sff: "Viento frente al sensor", Sffkmh: "Viento anotado en km/h", Sdd: "Dirección frente al sensor", Sracha: "Racha sin informar",
  SBTs: "Diferencia constante de Ts", SBTd: "Diferencia constante de Td", SBHR: "Diferencia constante de HR", SBQFE: "Diferencia constante del QFE",
  SBQFF: "Diferencia constante del QFF", SBQNH: "Diferencia constante del QNH",
  ZT01: "Salto brusco de Ts", ZT02: "Salto brusco de Td", ZT03: "Salto brusco de HR", ZT04: "Td mayor que Ts", ZT05: "HR no calza con Ts y Td",
  ZT06: "Ts sin cambio (sensor pegado)", ZT07: "Td sin cambio (sensor pegado)", ZT08: "HR sin cambio (sensor pegado)", ZT09: "Ts fuera de lo habitual para la zona",
  ZP01: "Salto brusco de QFE", ZP02: "QFE sin cambio (sensor pegado)", ZP03: "QFE lejos de lo esperado por la altura", ZP04: "QFE cambia demasiado en 3 h", ZP05: "QFF no calza con el QFE",
  ZV01: "Cambio fuerte del viento en 10 min", ZV02: "Viento sin cambio (sensor pegado)", ZV03: "Dirección sin cambio (sensor pegado)", ZV05: "Dirección fuera de 0–360", ZV06: "Racha menor que el viento medio",
  ZR01: "Lluvia con aire seco", ZR02: "Lluvia con Ts − Td muy alta", ZR03: "Demasiada lluvia en un minuto", ZR04: "Pluviómetro pegado (mismo valor repetido)", ZR05: "Lluvia de 6 h no calza con los minutos",
  ZC01: "Ts muy distinta de sus vecinas", ZC02: "Td muy distinto de sus vecinas", ZC03: "HR muy distinta de sus vecinas", ZC04: "QFF muy distinto de sus vecinas",
  ZM01: "Ts muy distinta del modelo", ZM02: "Td muy distinto del modelo", ZM03: "HR muy distinta del modelo", ZM04: "QFF muy distinto del modelo", ZM05: "Viento muy distinto del modelo",
  ZE01: "Mínima o máxima de 12 h no coincide con la temperatura por minuto", ZE03: "Mínima de 12 h mayor que la máxima de 12 h",
  SEXT: "Extrema: valor", SEXH: "Extrema: hora", SEXF: "Extrema fuera de bloque sin ingresar", SRRR6: "RRR6 frente al pluviómetro",
  SPRE: "Pluviómetro y tiempo presente", SinDato: "Sin dato", St: "Satélite: nubosidad", Sc: "Satélite: nubes", SD: "Satélite"
};
// Controles Definidos de SACLIM (qc/reglas_sistema.json): su código es un número; el texto del aviso es el propio mensaje del sistema
const esSaclim = c => /^\d+$/.test(String(c));
const nombre = c => N[c] || (esSaclim(c) && "Control de SACLIM") || (c && c.startsWith("SB") && N["SB" + c.slice(2)]) || c;
const SIN_CODIGO = new Set(["SEXT", "SEXH"]);     // estas dos se muestran sin el código
const html = (c, esc) => `${esc(nombre(c))}${(N[c] || esSaclim(c)) && !SIN_CODIGO.has(c) ? ` <small style="color:var(--mu);font-family:var(--mono)">${esc(c)}</small>` : ""}`;

// a qué pestaña va cada regla de observaciones (cada alerta vive en un solo lugar; lo demás queda en «Observaciones»)
const PESTANA = {SEXT: "ext", SEXH: "ext", SEXF: "ext",
  SRRR6: "pp", SPRE: "pp", E12: "pp", E13: "pp", E17: "pp",
  STs: "tem", STd: "tem", SHR: "tem", SBTs: "tem", SBTd: "tem", SBHR: "tem", C41: "tem", C41H: "tem"};
const pestana = c => PESTANA[c] || (/^Z[TPVRECM]\d\d$/.test(c) ? "super" : "obs");

/* Registro de cambios de reglas. Al cambiar una regla o umbral en qc/, agregar una fila ARRIBA: [fecha AAAA-MM-DD, códigos, qué cambió, por qué].
   Lo que se vea aquí debe coincidir con lo que dicen las pruebas fijas (qc/casos.py). */
const CAMBIOS = [
  ["2026-11-13", "2972, 3102, C02", "Neblina (BR METAR o ww 10) con visibilidad entre 1000 y 5000 m: ya no se avisa por el control de SACLIM 2972 / 3102 (la visibilidad se ingresa tal cual). Solo avisa con menos de 1000 m (es niebla) o con más de 8000 m. Se agregó el chequeo para el METAR (C02).", "En SACLIM esa regla no existe; la visibilidad se ingresa como se mide."],
  ["2026-11-13", "Resuelto", "«Resuelto» ya no devuelve la alerta si en la pasada siguiente el dato sigue igual (observaciones y Super automático); solo vuelve si el mensaje o el valor cambian.", "El servicio de observaciones no refleja las correcciones hechas en SACLIM, así que la etiqueta «el dato sigue igual» era una falsa alarma permanente."],
  ["2026-11-13", "ZT01–ZT09, ZP01–ZP05, ZV01–ZV06, ZR01–ZR05, ZE01, ZE03", "Nuevo grupo «Super automático»: estaciones automáticas sin observador. Compara Ts, Td, HR y QFF con la mediana de las vecinas (≥ 3, con corrección por altura) y con el modelo, con diferencias sostenidas en 2 de las últimas 3 horas; además saltos groseros, valores pegados 3 h y consistencia interna.", "Detectar errores groseros de sensor (temperaturas malas, vientos raros, presiones) sin avisar por el ruido normal minuto a minuto."],
  ["2026-11-13", "SEXH", "Si el valor de la extrema se repite en varias horas del minutario (un solo decimal) y no hay hora oficial del resumen diario, no se avisa por la hora: no se puede saber cuál es la que da el portal. El aviso por el valor (SEXT) se mantiene y lista las horas empatadas.", "El minutario no permite desempatar como lo hace el portal."],
  ["2026-11-13", "E10, E11", "El tiempo pasado (W1 W2) mira solo las horas anteriores a la observación y no cuenta el ww ni el METAR de la propia hora (tiempo presente). Principales (00, 06, 12, 18 UTC): 6 h; intermedias (03, 09, 15, 21 UTC): 3 h. E11 sí acepta el tiempo presente como respaldo de un W1 de precipitación. El mensaje de E10 indica también W2. Los avisos E10 y E11 guardados con la regla anterior se borraron del historial.", "Un ww 50 de las 09 UTC se usaba como «tiempo pasado» de la observación de las 09 UTC."],
  ["2026-11-13", "SEXF", "Solo avisa si la Tmax AM / Tmin PM del día no se ingresó en su bloque (AM 00–12 UTC, PM 12–00 UTC); se busca en todas las observaciones del bloque. El texto dice «se dio una máxima AM (valor, hora) y no se ingresó».", "Pudahuel 10/11 00:00: avisaba que faltaba la Tmax AM aunque el observador ya la había reportado."],
  ["2026-11-13", "SEXT, SEXH", "La extrema del resumen diario se valida antes de usarla (rango físico y coherencia con los minutos: más de 2 °C de diferencia se descarta y se usan los minutos; la falla se informa aparte en estaciones automáticas). Nombres: Tmax AM, Tmin AM, Tmax PM, Tmin PM; los códigos SEXT/SEXH ya no se muestran.", "Frei 13/11: máxima «322.0 °C» (era la dirección del viento)."],
  ["2026-11-13", "C41, C41H", "C41 se divide en dos casos con su propio nombre: «Td mayor que Ts» (C41) y «HR no calza con Ts y Td» (C41H).", "Melinka 12/11 18:00 salía como «Td mayor que Ts» siendo un problema de HR."],
  ["2026-11-13", "Todas las de observaciones", "Las columnas «Ingresado» y «Debería ir» se completan siempre que se pueda deducir: lo anotado, y lo que marcó el sensor o la secuencia de horas vecinas.", "Muchas alertas salían con esas columnas vacías."],
  ["2026-11-13", "Todas", "Se agrega este registro de cambios a la página «Reglas».", "Saber desde cuándo rige cada umbral al revisar un aviso viejo en el Historial."],
  ["2026-11-13", "E20 y S*", "Serie del observador como alerta principal (Ts, Td, HR, presiones, viento y dirección); si el sensor marcó el valor en la hora previa, no se alerta. «Frente al sensor» solo con diferencias grandes: presión > 2 hPa, Ts > 1,5 °C, Td > 2,5 °C, HR > 12 %, viento > 10 kt.", "Menos ruido: los avisos por diferencias chicas eran casi todos falsas alarmas."],
  ["2026-11-13", "Sffkmh", "Solo si la diferencia con el sensor es ≥ 3 kt y el valor en km/h calza mejor.", "Evitar avisos cuando la diferencia es pequeña."],
  ["2026-11-13", "SBQFE, SBQFF, SBQNH", "Una vez por estación y día (hora 00:00), nivel informativo, solo si la diferencia es ≥ 0,5 hPa.", "Eran avisos repetidos cada hora por la misma diferencia constante."],
  ["2026-11-13", "EMA: rango, salto, pegado", "Fallas de sensor agrupadas por episodio (un aviso por estación y sensor, con inicio, duración y si sigue). HR pegada desde 10 h. Rangos por zona (latitud y altura).", "Un solo aviso por falla en vez de decenas."],
  ["2026-11-13", "C02, C03, C40", "Humo, calima, polvo y neblina solo con VV > 8000 m. C40 solo si no hay ninguna capa baja.", "Reducir falsos avisos de codificación."],
  ["2026-11-13", "SRRR6, C42, E21", "Traza: con pluviómetro ≥ 0,2 mm → dudoso; traza con RRR6 ≠ 0 → dudoso; traza sin fenómenos y pluviómetro 0 → informativo.", "La traza se codificaba de forma inconsistente."],
  ["2026-11-13", "Modelos / WRF", "Sin QFF sobre 1500 m; tolerancia ×1,5 en estaciones aisladas sobre 2000 m.", "Los modelos no representan bien la altura."],
  ["2026-11-13", "SEXT, SEXH", "Las extremas oficiales (getEmaResumenDiario) mandan sobre el minutario.", "Usar el valor y la hora oficiales de la estación."]
];

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
    "Tmin AM/Tmax AM (00–12 UTC) y Tmin PM/Tmax PM (12–00 UTC) frente a la extrema oficial de la estación automática, en valor y hora (hora local)."]],
  ["Controles Definidos de SACLIM", [
    "Se aplican las reglas propias del sistema de ingreso (qc/reglas_sistema.json) sobre lo grabado por el observador; se avisan como «Control de SACLIM» con el número de la regla y su mensaje.",
    "Solo se evalúan cuando todos los elementos de la regla están en la observación; en nivel erróneo si el sistema la exige, y dudoso si no."]],
  ["Codificación y visibilidad", [
    "Fenómenos que reducen la visibilidad (humo, calima, polvo, neblina): se avisa solo con VV > 8000 m.",
    "C40 (CL sin su capa): solo si no hay ninguna capa baja."]],
  ["Estaciones automáticas", [
    "HR pegada: solo si el mismo valor dura 10 h o más.",
    "Modelos: no se compara QFF sobre 1500 m; más tolerancia en estaciones de altura aisladas. Temperatura 6 °C, humedad 35 %, viento 15 kt, QFF 5 hPa, Td 9 °C.",
    "Fallas de sensor (rango, salto, valor pegado, radiación) se agrupan por episodio: inicio, fin y duración."]],
];
function pagina(cont, esc){
  const filas = Object.keys(N).sort().map(c => `<tr><td style="font-family:var(--mono)">${esc(c)}</td><td>${esc(N[c])}</td><td>${({ext: "Extremas", pp: "Precipitación", tem: "Temperaturas", obs: "Observaciones", super: "Super automático"})[pestana(c)]}</td></tr>`).join("");
  cont.innerHTML = `<h2 style="font:600 18px var(--titulo);margin:0 0 10px">Reglas y umbrales</h2>
    ${UMBRALES.map(([t, L]) => `<h4 style="margin:14px 0 4px;font:600 14px var(--titulo)">${esc(t)}</h4><ul style="margin:0;padding-left:20px">${L.map(x => `<li>${esc(x)}</li>`).join("")}</ul>`).join("")}
    <h4 style="margin:18px 0 6px;font:600 14px var(--titulo)">Registro de cambios</h4>
    <table style="width:auto"><tr><th>Fecha</th><th>Reglas</th><th>Cambio</th><th>Por qué</th></tr>${CAMBIOS.map(c => `<tr><td style="white-space:nowrap">${esc(c[0].split("-").reverse().join("-"))}</td><td style="font-family:var(--mono)">${esc(c[1])}</td><td>${esc(c[2])}</td><td>${esc(c[3])}</td></tr>`).join("")}</table>
    <h4 style="margin:18px 0 6px;font:600 14px var(--titulo)">Reglas de las observaciones</h4>
    <table style="width:auto"><tr><th>Código</th><th>Nombre</th><th>Pestaña</th></tr>${filas}</table>`;
}
window.REGLAS = {nombre, html, pestana, pagina};
})();
