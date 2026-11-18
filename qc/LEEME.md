# Control de calidad en vivo (piloto)

Cada 30 minutos (GitHub Actions, `.github/workflows/qc.yml`):

1. Descarga la última hora de la red automática de la DMC (`getDatosRecientesRedEma`).
2. Guarda los datos minutarios en la rama `datos` (`ema/AAAA/MM/DD/HH.csv.gz`), porque el portal solo entrega la última hora.
3. Baja el modelo en cada estación (Open-Meteo, corregido por altura).
4. Corre las pruebas (`pruebas.py`): rango, saltos, valor pegado, coherencia interna, estaciones vecinas, modelo, lluvia y completitud.
5. Sube el resultado al KV de Cloudflare (`qc/ultimo`). Se ve en `metotec.cl/qc.html` con la clave docente.

## Agrupaciones (clusters)
Si existe `qc/clusters.csv` (columnas: codigo, grupo), las vecinas de cada estación son las de su mismo grupo.
Si no, se usan las estaciones a menos de 120 km y 500 m de diferencia de altura.
Una estación con menos de 3 vecinas se marca como aislada y el modelo pasa a ser su referencia principal.

## Pendiente
- Satélite (GOES-19): lluvia con cielo despejado, posible pluviómetro obstruido bajo convección.
- Estaciones con personal (`getRecientesSaclim`): N, ww, visibilidad contra satélite.
- Sesgo propio de cada estación frente al modelo (historial).

## Satélite (GOES-19)
El visor satelital (repositorio conveccion-chile) publica en cada imagen `data/sat_estaciones.json`
con lo que ve el satélite a 10 y 30 km de cada estación (banda 13, máscara de nubes ACM, lluvia RRQPE,
altura de topes ACHA y rayos GLM), últimas 12 h. `qc/satelite.py` lo lee y aplica:
- automáticas: SAT-RR0 (lluvia satelital y pluviómetro en 0), SAT-RRD (lluvia con cielo despejado), SAT-RAD (radiación baja con cielo despejado);
- observaciones: SAT1–SAT8 (N, precipitación, tormenta, rayos, cumulonimbo, convección vs CL, niebla).

## Historial (nada se borra)
`qc/historial.py` guarda cada hallazgo por día UTC en `hallazgos/AAAA/MM/DD.json` (rama datos) y en el KV `qc/hist/AAAA-MM-DD`.
Observaciones: abierto / corregido (con hora de corrección; se reabre si vuelve a fallar). Automáticas: eventos con nº de pasadas.
Se consulta en qc.html → Historial (rango de fechas, filtros y CSV) vía `/api/historial?desde=&hasta=`.

## Vecinas externas (INIA, CEAZA, SERVIMET…)
`qc/externas.py` (cada 15 min, `externas.yml`) deja en el KV `qc/externas/cat` y `qc/externas/<VAR>`. `qc/externas_vec.py` las convierte (viento km/h → kt, QFF desde la presión de estación con la altura y sin QFF sobre 1500 m, Td desde TA y HR) y entrega, por estación DMC, hasta 4 externas a ≤ 80 km y ≤ 400 m de diferencia de altura.
- Solo comparación: no se muestran como estaciones ni entran a contadores; una alerta que se apoyó en ellas lo dice en una línea de su detalle.
- Pesan la mitad que una DMC (viento 0,3); cada mediana de vecinas exige ≥ 3 vecinas y peso total ≥ 2,5.
- Desactivadas: KV `qc/externas/off` (`{"off": [id…]}`), se edita en Gestión (⚙) → Vecinas externas (`POST /api/externas`). Señal «se desvía de sus vecinas»: KV `qc/externas/desvio`.
- Usan las externas: `superauto.comparar` (ZC01–ZC06), `pruebas.vecinas`, `pruebas.lluvia`, `pluviometros.analizar` y, en JS, Sensores (`ppx.js`) y Verificar (`verificar.js`, solo la media de la tabla horaria). La lluvia horaria de las externas se archiva en `datos/ext/pp/` (el KV guarda ~42 h).
- No aplican a las series diarias (INIA da ~7 días).
- Si la comparación del Super automático falla, el error queda en `errores` del resultado (`qc/super`) y en `estado.json`; un fallo en una estación no tumba las demás.
