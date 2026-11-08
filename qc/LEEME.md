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
