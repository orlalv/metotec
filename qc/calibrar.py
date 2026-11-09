"""
Calibración del control O−B y verificación de modelos.

Lee el archivo horario ob/AAAA/MM/DD.csv.gz (estación, Open-Meteo y WRF-DMC por hora) de los últimos 30 días y calcula,
para cada estación, variable, modelo y bloque de 6 horas UTC:
  - sesgo b   = mediana de (O − B)
  - dispersión σ = 1,4826 · MAD de (O − B)   (desviación estándar robusta)
  - n         = cantidad de horas usadas
y la verificación de cada modelo por estación y variable: error medio absoluto, sesgo y % de horas dentro de una
tolerancia fina (T y Td 2 °C, HR 10 %, QFF 2 hPa, viento 5 kt).

El control usa la calibración (prueba |O − B − b| > máx(piso, 3σ)) solo donde haya al menos MIN_N horas y la
calibración tenga 14 días o más; si no, sigue con las tolerancias fijas.
"""
import json
from datetime import datetime, timedelta, timezone
from pathlib import Path

import numpy as np
import pandas as pd

VARS = {"T": ("_w", "_om"), "Td": ("_om",), "HR": ("_w", "_om"), "P_mar": ("_om",), "ff10": ("_w", "_om")}
NOM = {"_w": "wrf", "_om": "om"}
FINA = {"T": 2, "Td": 2, "HR": 10, "P_mar": 2, "ff10": 5}
MIN_N = 30
DIAS = 30


def leer(raiz, dias=DIAS):
    hoy = datetime.now(timezone.utc).date()
    partes = []
    for k in range(dias + 1):
        d = hoy - timedelta(days=k)
        f = Path(raiz) / "ob" / f"{d:%Y/%m/%d}.csv.gz"
        if f.exists():
            partes.append(pd.read_csv(f, parse_dates=["momento"], dtype={"codigo": str}))
    return pd.concat(partes, ignore_index=True) if partes else pd.DataFrame()


def calcular(X):
    est, verif, res = {}, {}, {}
    if X.empty:
        return est, verif, res
    X = X.copy()
    X["bloque"] = (X["momento"].dt.hour // 6).astype(int)
    for v, mods in VARS.items():
        if v not in X:
            continue
        for suf in mods:
            c = v + suf
            if c not in X:
                continue
            Y = X[["codigo", "bloque", v, c]].dropna()
            if Y.empty:
                continue
            Y["d"] = Y[v] - Y[c]
            for (cod, bl), g in Y.groupby(["codigo", "bloque"]):
                b = float(g["d"].median()); s = float(1.4826 * (g["d"] - b).abs().median())
                est.setdefault(cod, {}).setdefault(v, {}).setdefault(NOM[suf], {})[str(bl)] = [round(b, 2), round(s, 2), int(len(g))]
            for cod, g in Y.groupby("codigo"):
                verif.setdefault(cod, {}).setdefault(v, {})[NOM[suf]] = [round(float(g["d"].abs().mean()), 2), round(float(g["d"].mean()), 2),
                                                                        round(float(100 * (g["d"].abs() <= FINA[v]).mean()), 1), int(len(g))]
            res.setdefault(v, {})[NOM[suf]] = [round(float(Y["d"].abs().mean()), 2), round(float(Y["d"].mean()), 2),
                                               round(float(100 * (Y["d"].abs() <= FINA[v]).mean()), 1), int(len(Y))]
    return est, verif, res


def ejecutar(raiz):
    X = leer(raiz)
    est, verif, res = calcular(X)
    dias = int(X["momento"].dt.floor("D").nunique()) if len(X) else 0
    js = {"generado": datetime.now(timezone.utc).isoformat(timespec="seconds"), "dias": dias, "filas": int(len(X)),
          "campos_est": ["sesgo", "sigma", "n"], "campos_verif": ["error_medio_abs", "sesgo", "pct_dentro_fina", "n"],
          "tolerancia_fina": FINA, "est": est, "verif": verif, "resumen": res}
    (Path(raiz) / "calibracion.json").write_text(json.dumps(js, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    return js


def cargar(raiz, max_dias_viejo=1):
    """Devuelve la calibración vigente; la recalcula una vez al día."""
    p = Path(raiz) / "calibracion.json"
    if p.exists():
        js = json.loads(p.read_text(encoding="utf-8"))
        if datetime.now(timezone.utc) - datetime.fromisoformat(js["generado"]) < timedelta(days=max_dias_viejo):
            return js
    return ejecutar(raiz)


def umbral(cal, cod, v, modelo, hora, pisos):
    """(sesgo, umbral sospechoso, umbral erróneo) calibrados, o None si no hay datos suficientes."""
    if not cal or cal.get("dias", 0) < 14:
        return None
    e = cal["est"].get(cod, {}).get(v, {}).get(modelo, {}).get(str(hora // 6))
    if not e or e[2] < MIN_N:
        return None
    b, s, _ = e
    p1, p2 = pisos
    return b, max(p1, 3 * s), max(p2, 5 * s)
