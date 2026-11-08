"""Valores de modelo en cada estación (Open-Meteo, mejor modelo disponible, horario, UTC).

Se pasa la altura de la estación: Open-Meteo corrige la temperatura por la diferencia
entre la altura real y la del modelo.
"""
import requests
import pandas as pd

URL = "https://api.open-meteo.com/v1/forecast"
VARS = ["temperature_2m", "dew_point_2m", "relative_humidity_2m", "pressure_msl", "surface_pressure", "precipitation", "wind_speed_10m"]
REN = {"temperature_2m": "T", "dew_point_2m": "Td", "relative_humidity_2m": "HR", "pressure_msl": "P_mar",
       "surface_pressure": "P_est", "precipitation": "rr1h", "wind_speed_10m": "ff10"}


def obtener(E, lote=50, timeout=120):
    """E: DataFrame con codigo, lat, lon, alt. Devuelve DataFrame (codigo, momento, T, Td, HR, P_mar, P_est, rr1h, ff10)."""
    E = E.dropna(subset=["lat", "lon"]).reset_index(drop=True)
    salida = []
    for i in range(0, len(E), lote):
        L = E.iloc[i:i + lote]
        p = dict(latitude=",".join(f"{x:.4f}" for x in L.lat), longitude=",".join(f"{x:.4f}" for x in L.lon),
                 elevation=",".join(f"{(x if pd.notna(x) else 0):.0f}" for x in L.alt),
                 hourly=",".join(VARS), past_days=1, forecast_days=1, timezone="GMT", wind_speed_unit="kn")
        r = requests.get(URL, params=p, timeout=timeout)
        r.raise_for_status()
        js = r.json()
        js = js if isinstance(js, list) else [js]
        for cod, j in zip(L.codigo, js):
            h = j.get("hourly") or {}
            df = pd.DataFrame({REN[v]: h.get(v) for v in VARS})
            df["momento"] = pd.to_datetime(h.get("time"))
            df["codigo"] = cod
            salida.append(df)
    return pd.concat(salida, ignore_index=True) if salida else pd.DataFrame()
