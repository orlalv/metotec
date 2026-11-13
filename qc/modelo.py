"""Valores de modelo en cada estación (Open-Meteo, mejor modelo disponible, horario, UTC).

Se pasa la altura de la estación: Open-Meteo corrige la temperatura por la diferencia
entre la altura real y la del modelo.
"""
import time
import requests
import pandas as pd

URL = "https://api.open-meteo.com/v1/forecast"
VARS = ["temperature_2m", "dew_point_2m", "relative_humidity_2m", "pressure_msl", "surface_pressure", "precipitation", "wind_speed_10m"]
REN = {"temperature_2m": "T", "dew_point_2m": "Td", "relative_humidity_2m": "HR", "pressure_msl": "P_mar",
       "surface_pressure": "P_est", "precipitation": "rr1h", "wind_speed_10m": "ff10"}


ULTIMOS_ERRORES = []        # motivo de cada lote que falló en la última llamada (lo muestra el indicador «Servicios»)


def _pedir(p, timeout, intentos=3):
    """GET con reintentos y espera creciente: Open-Meteo responde 429 (límite por minuto) o 5xx cuando está cargado."""
    ultimo = None
    for k in range(intentos):
        try:
            r = requests.get(URL, params=p, timeout=timeout)
            if r.status_code == 429 or r.status_code >= 500:
                ultimo = f"HTTP {r.status_code} {r.text[:120]}"
            else:
                r.raise_for_status()
                return r.json()
        except requests.RequestException as e:
            ultimo = f"{type(e).__name__}: {str(e)[:120]}"
        time.sleep(4 * (k + 1))
    raise RuntimeError(ultimo or "sin respuesta")


def obtener(E, lote=25, timeout=60, pausa=1.5, presupuesto=420):
    """E: DataFrame con codigo, lat, lon, alt. Devuelve DataFrame (codigo, momento, T, Td, HR, P_mar, P_est, rr1h, ff10).
    Lotes de 25 estaciones, con reintentos y una pausa entre lotes. Si algún lote no responde se siguen usando los demás (el motivo
    queda en ULTIMOS_ERRORES); solo falla del todo si ninguno respondió."""
    ULTIMOS_ERRORES.clear()
    E = E.dropna(subset=["lat", "lon"]).reset_index(drop=True)
    salida = []
    t0 = time.time()
    for i in range(0, len(E), lote):
        if time.time() - t0 > presupuesto:        # tope de 7 min en total: el flujo completo tiene 20 min
            ULTIMOS_ERRORES.append(f"lote {i // lote + 1} en adelante: se agotó el tiempo ({presupuesto} s)")
            break
        L = E.iloc[i:i + lote]
        p = dict(latitude=",".join(f"{x:.4f}" for x in L.lat), longitude=",".join(f"{x:.4f}" for x in L.lon),
                 elevation=",".join(f"{(x if pd.notna(x) else 0):.0f}" for x in L.alt),
                 hourly=",".join(VARS), past_days=1, forecast_days=1, timezone="GMT", wind_speed_unit="kn")
        try:
            js = _pedir(p, timeout)
        except Exception as e:
            ULTIMOS_ERRORES.append(f"lote {i // lote + 1}: {e}")
            continue
        js = js if isinstance(js, list) else [js]
        for cod, j in zip(L.codigo, js):
            h = j.get("hourly") or {}
            df = pd.DataFrame({REN[v]: h.get(v) for v in VARS})
            df["momento"] = pd.to_datetime(h.get("time"))
            df["codigo"] = cod
            salida.append(df)
        time.sleep(pausa)
    if not salida:
        raise RuntimeError("; ".join(ULTIMOS_ERRORES[:3]) or "sin estaciones")
    return pd.concat(salida, ignore_index=True)
