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
  C43: "METAR BR y FG juntos", C44: "METAR fenómeno repetido", C45: "METAR con intensidad donde no corresponde", C46: "METAR SH mal combinado", C47: "METAR DR mal combinado", C48: "METAR ventisca baja con poco viento", C49: "METAR BR y HZ juntos", C53: "METAR VC mal combinado", C54: "METAR MI/BC/PR sin niebla", C55: "METAR TS mal combinado", C56: "METAR VCFG con visibilidad baja", C57: "METAR FZ mal combinado", C58: "METAR tiempo reciente igual al presente", C59: "METAR tiempo reciente igual al ww del SYNOP", C50: "METAR FG bajo 0 °C sin FZ", C51: "METAR FG con HR baja", C52: "METAR precipitaciones mezcladas en grupos separados", C40: "CL sin su capa", C41: "Td mayor que Ts", C41H: "HR no calza con Ts y Td",
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
  ZC01: "Ts muy distinta de sus vecinas", ZC02: "Td muy distinto de sus vecinas", ZC03: "HR muy distinta de sus vecinas", ZC04: "QFF muy distinto de sus vecinas", ZC05: "Viento medio muy distinto de sus vecinas", ZC06: "Lluvia muy distinta de sus vecinas",
  ZM01: "Ts muy distinta del modelo", ZM02: "Td muy distinto del modelo", ZM03: "HR muy distinta del modelo", ZM04: "QFF muy distinto del modelo", ZM05: "Viento muy distinto del modelo",
  ZE01: "Mínima o máxima de 12 h no coincide con la temperatura por minuto", ZE03: "Mínima de 12 h mayor que la máxima de 12 h", ZE04: "Extrema de 24 h (minutos) fuera de rango físico: picos del sensor", ZE05: "Extrema de 24 h muy distinta de la de sus vecinas", ZE06: "(desactivada) Tn12/Tx12 contra las 12 h previas", ZE07: "Misma mínima o máxima 3 días seguidos", ZE08: "Amplitud del día muy distinta de la de sus vecinas", ZT10: "Ts casi sin variar en 24 h (poco probable)", ZV08: "Viento medio sobre 70 kt (poco probable)", ZV09: "Racha más de 4 veces el viento medio (poco probable)", ZC07: "Calma prolongada con viento en las vecinas", ZS01: "Lluvia con cielo despejado según GOES", ZC08: "Dirección del viento muy distinta de sus vecinas", ZK01: "Six Sigma: diferencia con las vecinas fuera de lo habitual (σ)", ZC09: "Hora desfasada: la curva de Ts calza con las vecinas corrida 1–3 h", ZC10: "Deriva lenta contra vecinas (varios días)", ZS02: "Pluviómetro en 0 durante ≥ 4 h con lluvia estimada y nube fría (GOES)",
  SEXT: "Extrema: valor", SEXH: "Extrema: hora", RHA: "Récord histórico de temperatura", RHM: "Récord del mes de temperatura", RHP: "Récord histórico de lluvia", RHPM: "Récord del mes de lluvia", RHV: "Récord histórico de viento", RHVM: "Récord del mes de viento", SXRA: "Extrema repetida: mismo valor y hora que ayer", SXRV: "Extrema repetida: mismo valor que ayer", SXRH: "Extrema repetida: misma hora que ayer", SEXF: "Extrema fuera de bloque sin ingresar", SEXC: "Ts fuera de las extremas del período", SRRR6: "RRR6 frente al pluviómetro",
  SPRE: "Pluviómetro y tiempo presente", SinDato: "Sin dato", St: "Satélite: nubosidad", Sc: "Satélite: nubes", SD: "Satélite"
};
// Controles Definidos de SACLIM (qc/reglas_sistema.json): su código es un número; el texto del aviso es el propio mensaje del sistema
const esSaclim = c => /^\d+$/.test(String(c));
const nombre = c => N[c] || (esSaclim(c) && "Control de SACLIM") || (c && c.startsWith("SB") && N["SB" + c.slice(2)]) || c;
const SIN_CODIGO = new Set(["SEXT", "SEXH"]);     // estas dos se muestran sin el código
const html = (c, esc) => `${esc(nombre(c))}${(N[c] || esSaclim(c)) && !SIN_CODIGO.has(c) ? ` <small style="color:var(--mu);font-family:var(--mono)">${esc(c)}</small>` : ""}`;

// a qué pestaña va cada regla de observaciones (cada alerta vive en un solo lugar; lo demás queda en «Observaciones»)
const PESTANA = {SEXT: "ext", SEXH: "ext", SEXF: "ext", SEXC: "ext", SXRA: "ext", SXRV: "ext", SXRH: "ext", RHA: "rec", RHM: "rec", RHP: "rec", RHPM: "rec", RHV: "rec", RHVM: "rec",
  SRRR6: "pp", SPRE: "pp", E12: "pp", E13: "pp", E17: "pp",
  STs: "tem", STd: "tem", SHR: "tem", SBTs: "tem", SBTd: "tem", SBHR: "tem", C41: "tem", C41H: "tem"};
const pestana = c => PESTANA[c] || (/^Z[TPVRECM]\d\d$/.test(c) ? "super" : "obs");

/* Registro de cambios de reglas. Al cambiar una regla o umbral en qc/, agregar una fila ARRIBA: [fecha AAAA-MM-DD, códigos, qué cambió, por qué].
   Lo que se vea aquí debe coincidir con lo que dicen las pruebas fijas (qc/casos.py). */
const CAMBIOS = [
  ["2026-11-18", "ZC01–ZC06, vecinas, lluvia, pluviómetros, Sensores, Verificar", "Las estaciones externas (INIA, CEAZA, SERVIMET…) ahora ayudan como vecinas, con menor peso (la mitad; el viento, 0,3) y a lo más 4 por estación (3 en pluviómetros). No se muestran como estaciones: a lo más una línea en el detalle de la alerta que se apoyó en ellas. Se pueden activar o desactivar en Gestión (⚙) → Vecinas externas.", "Con pocas vecinas DMC cerca, la comparación quedaba sin referencia (estaciones aisladas). INIA, CEAZA y otras redes dan más puntos de comparación sin cambiar lo que se muestra."],
  ["2026-11-17", "SEXC", "Nueva en Extremas. SEXC: un Ts ingresado en el período (12 h que cierran a las 00 y 12 UTC) queda más bajo que la mínima real o más alto que la máxima real del mismo período según la estación automática (sin margen, solo el redondeo de 0,05 °C; siempre nivel 2 (error de digitación)). Un Ts instantáneo no puede salirse de las extremas del período.", "Detectar Ts mal digitados que ni la extrema real del período permite."],
  ["2026-11-17", "RHP, RHPM, RHV, RHVM", "Récords de lluvia y viento en la pestaña «Récord histórico». RHP (sospechoso): el RRR6 o el acumulado de 24 h del observador supera la máxima diaria de toda la serie de la estación; RHPM (informativo): supera la máxima diaria de ese mes. RHV / RHVM: lo mismo con el viento medio, solo en las 6 estaciones con archivo horario SACLIM (Arica, Quinta Normal, Pudahuel, Curicó, Puerto Montt, Punta Arenas). Lluvia: 43 estaciones desde 1995.", "Detectar lluvias o vientos fuera de lo que la estación ha visto en 30 años."],
  ["2026-11-17", "RHA, RHM", "Nueva pestaña «Récord histórico». RHA (sospechoso): la Tmin/Tmax AM/PM ingresada supera la máxima o mínima más alta o más baja de toda la serie de la estación (1990 en adelante); confirmar que el dato es correcto. RHM (informativo): supera el récord de ese mes. Se calcula con los anuarios de temperatura guardados (37 estaciones; las que no tienen serie no se revisan).", "Detectar valores que rompen la historia: o son un récord real o un error de digitación."],
  ["2026-11-17", "SXRA, SXRV, SXRH", "Nuevo en Extremas: la Tmin/Tmax AM/PM ingresada igual a la del día anterior (o de varios días seguidos). SXRA: mismo valor y misma hora (al minuto), sospechoso, y reemplaza a los otros dos. SXRV: solo el valor, informativo. SXRH: solo la hora, informativo.", "Con 26 años de 6 estaciones, el valor se repite entre 1 % y 6 % de los días, la hora entre 0,3 % y 6 %, y los dos juntos solo entre 0,01 % y 0,2 %: «ambos» casi nunca es casualidad."],
  ["2026-11-17", "Boletín: máxima y mínima", "El valor de la máxima y de la mínima del boletín debe ser igual al de la estación automática (a 1 decimal): se avisa con cualquier diferencia sobre 0,05 °C (antes, sobre 0,5 °C). La hora ya debía coincidir con el minuto del extremo.", "El Loa, Calama: boletín 25,6 °C a las 16:44 y la automática 25,7 °C a las 16:52; se avisaba la hora y no el valor. Con los datos de hoy solo esa estación pasa a avisarse (21 revisadas)."],
  ["2026-11-13", "2972, 3102, C02", "Neblina (BR METAR o ww 10) con visibilidad entre 1000 y 5000 m: ya no se avisa por el control de SACLIM 2972 / 3102 (la visibilidad se ingresa tal cual). Solo avisa con menos de 1000 m (es niebla) o con más de 8000 m. Se agregó el chequeo para el METAR (C02).", "En SACLIM esa regla no existe; la visibilidad se ingresa como se mide."],
  ["2026-11-13", "Resuelto", "«Resuelto» ya no devuelve la alerta si en la pasada siguiente el dato sigue igual (observaciones y Super automático); solo vuelve si el mensaje o el valor cambian.", "El servicio de observaciones no refleja las correcciones hechas en SACLIM, así que la etiqueta «el dato sigue igual» era una falsa alarma permanente."],
  ["2026-11-19", "ZK01 (Six Sigma)", "Diferencia de Ts, Td, HR, QFF y viento medio contra la mediana de las vecinas, medida en σ de la diferencia habitual de cada estación (media y σ móviles ~30 días; lo raro no entra a la estadística). ≥ 4σ sostenido 2 h sospechoso; ≥ 6σ erróneo. Para estaciones con y sin observador.", "Umbral propio de cada estación en vez de una tolerancia fija igual para todas."],
  ["2026-11-19", "ZC08–ZC10", "Control espacial: dirección del viento contra vecinas (> 90° en 3 de 4 horas con viento ≥ 5 kt), hora desfasada (la curva de Ts de 24 h calza con las vecinas solo corrida 1–3 h) y deriva lenta (diferencia de Ts media o QFF medio contra vecinas que crece día a día en 6 días hasta ≥ 2 °C/hPa). Se aplican también a las estaciones con observador.", "Detectar veletas mal orientadas, relojes mal configurados y sensores que se descalibran de a poco."],
  ["2026-11-18", "ZS01, ZS02", "Super automático contra satélite GOES: lluvia en el pluviómetro con cielo despejado (≥ 2 h en 24 h) y pluviómetro en 0 durante ≥ 3 h seguidas con lluvia estimada o nube fría. Índice por tipo de control en la pestaña Estaciones.", "Sumar la imagen satelital como referencia independiente de vecinas y modelo."],
  ["2026-11-18", "ZE06–ZE08, ZT10, ZV08, ZV09, ZC07", "Super automático: extremas de la mañana y de la tarde contra sus 12 h de minutos, extrema repetida 3 días, amplitud contra vecinas, Ts sin variación, viento y racha poco probables y calma prolongada contra vecinas. Nuevas pestañas «Control espacial» y «Boletín automático».", "Más controles espaciales y de valores poco probables en las estaciones sin observador."],
  ["2026-11-18", "ZE04, ZE05", "Super automático: la mínima y máxima de 24 h (de los minutos) se revisan contra el rango físico (−35 a 45 °C) y contra la mediana de las vecinas (≥ 3, corregida por altura; > 6 °C sospechoso, > 10 °C erróneo).", "Detectar extremas del día contaminadas por picos del sensor (ej. Jardín Botánico −48,6 °C) y extremas que no calzan con la zona."],
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
  ["2026-11-13", "C43–C59", "Errores de cifrado del tiempo presente METAR: BR y FG juntos, intensidad en neblina/niebla/calima/ventisca, SH o DR con fenómenos que no admiten, fenómeno repetido, FG bajo 0 °C o con HR baja, mezclas en grupos separados.", "Basado en la guía de tiempo presente METAR y SYNOP."],
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
  ["Récord histórico", [
    "Ts fuera de las extremas (SEXC): cada Ts ingresado en el período AM o PM contra la mínima y la máxima reales de la automática en ese período; sin margen (solo el redondeo).",
    "Lluvia (RHP, RHPM) y viento (RHV, RHVM): RRR6 y acumulado de 24 h contra la máxima diaria de la historia (sospechoso) o del mes (informativo); viento medio contra su máximo, solo 6 estaciones. Margen de 0,05 mm en lluvia.",
    "Temperatura (RHA, RHM): la extrema ingresada se compara con la máxima y la mínima diarias de la estación desde 1990 (anuarios del portal, guardados en la rama de datos). Supera el récord de toda la historia → sospechoso; supera el récord del mes → informativo. Margen de 0,05 °C.",
    "Solo se revisan las estaciones con serie guardada; el resto no avisa."]],
  ["Extremas", [
    "Repetición (SXRA, SXRV, SXRH): la extrema ingresada se compara con la misma extrema de los días anteriores. Valor y hora (al minuto) iguales → sospechoso (SXRA); solo el valor (SXRV) o solo la hora (SXRH) → informativo. Cuenta los días seguidos.",
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
  const filas = Object.keys(N).sort().map(c => `<tr><td style="font-family:var(--mono)">${esc(c)}</td><td>${esc(N[c])}</td><td>${({rec: "Récord histórico", ext: "Extremas", pp: "Precipitación", tem: "Temperaturas", obs: "Observaciones", super: "Super automático"})[pestana(c)]}</td></tr>`).join("");
  cont.innerHTML = `<h2 style="font:600 18px var(--titulo);margin:0 0 10px">Reglas y umbrales</h2>
    ${UMBRALES.map(([t, L]) => `<h4 style="margin:14px 0 4px;font:600 14px var(--titulo)">${esc(t)}</h4><ul style="margin:0;padding-left:20px">${L.map(x => `<li>${esc(x)}</li>`).join("")}</ul>`).join("")}
    <h4 style="margin:18px 0 6px;font:600 14px var(--titulo)">Registro de cambios</h4>
    <table style="width:auto"><tr><th>Fecha</th><th>Reglas</th><th>Cambio</th><th>Por qué</th></tr>${CAMBIOS.map(c => `<tr><td style="white-space:nowrap">${esc(c[0].split("-").reverse().join("-"))}</td><td style="font-family:var(--mono)">${esc(c[1])}</td><td>${esc(c[2])}</td><td>${esc(c[3])}</td></tr>`).join("")}</table>
    <h4 style="margin:18px 0 6px;font:600 14px var(--titulo)">Reglas de las observaciones</h4>
    <table style="width:auto"><tr><th>Código</th><th>Nombre</th><th>Pestaña</th></tr>${filas}</table>`;
}
window.REGLAS = {nombre, html, pestana, pagina};
})();
