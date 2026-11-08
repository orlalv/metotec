"""Modelo WRF-DMC por estación (servicio getDatosModelo del portal de la DMC).

El servicio entrega, para una estación, las últimas corridas del WRF (00 y 12 UTC, con
condiciones iniciales GFS y, en la zona centro, también ECMWF), pero solo desde la hora
siguiente en adelante. Por eso cada corrida nueva se guarda en el archivo y, cuando llega
la observación de esa hora, se compara con lo que habían pronosticado las corridas.
"""
import json, os, time
from datetime import datetime, timedelta
from pathlib import Path
import pandas as pd
import requests

URL = "https://climatologia.meteochile.gob.cl/application/serviciosb/getDatosModelo/{}"
VARS = {"T": "T", "HR": "HR", "VV": "ff10", "RRhh": "rr1h"}
REF = "330021"          # estación usada para saber si hay corridas nuevas (Pudahuel)


def _pedir(cod, timeout=60):
    r = requests.get(URL.format(cod), params={"usuario": os.environ["DMC_USUARIO"], "token": os.environ["DMC_TOKEN"]}, timeout=timeout)
    r.raise_for_status()
    return r.json()


def _fecha_corrida(clave, ref):
    """'08_12_gfs' -> (datetime de la corrida, fuente). El mes se deduce de la fecha de referencia."""
    dd, hh, fuente = clave.split("_")[:3]
    d = ref.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    for k in (0, -1):                       # este mes o el anterior
        m = (d + timedelta(days=32 * k)).replace(day=1) if k else d
        try:
            c = m.replace(day=int(dd), hour=int(hh))
        except ValueError:
            continue
        if c <= ref + timedelta(hours=1):
            return c, fuente
    return d.replace(day=int(dd), hour=int(hh)), fuente


def leer(js, cod):
    ref = pd.to_datetime(js.get("fechaCreacion")).to_pydatetime() if js.get("fechaCreacion") else datetime.utcnow()
    filas = {}
    for e in js.get("elementos") or []:
        s = (e.get("elemento") or {}).get("sigla")
        if s not in VARS:
            continue
        for k, v in e.items():
            if k == "elemento" or not isinstance(v, dict):
                continue
            corrida, fuente = _fecha_corrida(k, ref)
            for p in v.get("valorPronosticado") or []:
                key = (corrida, fuente, p.get("fecha"))
                f = filas.setdefault(key, {"codigo": str(cod), "corrida": corrida, "fuente": fuente, "momento": p.get("fecha")})
                try:
                    f[VARS[s]] = float(p.get("valor"))
                except (TypeError, ValueError):
                    f[VARS[s]] = None
    D = pd.DataFrame(list(filas.values()))
    if len(D):
        D["momento"] = pd.to_datetime(D["momento"])
    return D


def sincronizar(E, raiz, pausa=0.3):
    """Si apareció una corrida nueva, la baja para todas las estaciones y la guarda. Devuelve un resumen."""
    raiz = Path(raiz) / "wrf"
    raiz.mkdir(parents=True, exist_ok=True)
    reg = raiz / "corridas.json"
    hechas = set(json.loads(reg.read_text())) if reg.exists() else set()
    R = leer(_pedir(REF), REF)
    if R.empty:
        return {"wrf": "sin datos en la estación de referencia"}
    disp = {f"{c:%Y%m%d%H}_{f}" for c, f in R[["corrida", "fuente"]].drop_duplicates().itertuples(index=False)}
    nuevas = disp - hechas
    if not nuevas:
        return {"wrf": "sin corridas nuevas", "corridas": sorted(disp)}
    partes, fallas = [], 0
    for cod in E["codigo"]:
        try:
            D = R if cod == REF else leer(_pedir(cod), cod)
            if len(D):
                D["id"] = D["corrida"].dt.strftime("%Y%m%d%H") + "_" + D["fuente"]
                partes.append(D[D["id"].isin(nuevas)])
        except Exception:
            fallas += 1
        time.sleep(pausa)
    if partes:
        A = pd.concat(partes, ignore_index=True)
        for cid, g in A.groupby("id"):
            f = raiz / f"{cid[:4]}/{cid[4:6]}/{cid}.csv.gz"
            f.parent.mkdir(parents=True, exist_ok=True)
            g.drop(columns=["id"]).to_csv(f, index=False, float_format="%.4g", compression={"method": "gzip", "mtime": 0})
    reg.write_text(json.dumps(sorted(hechas | nuevas)))
    return {"wrf": "corridas nuevas", "nuevas": sorted(nuevas), "estaciones": int(len(E) - fallas), "fallas": fallas}


def referencia(raiz, desde, hasta, ultimas=5):
    """Para cada estación y hora: mediana y dispersión de las últimas corridas que pronosticaron esa hora."""
    raiz = Path(raiz) / "wrf"
    fs = sorted(raiz.glob("*/*/*.csv.gz"))
    lim = (desde - pd.Timedelta(days=4)).strftime("%Y%m%d%H")
    fs = [f for f in fs if f.name[:10] >= lim]
    if not fs:
        return pd.DataFrame()
    W = pd.concat([pd.read_csv(f, parse_dates=["corrida", "momento"], dtype={"codigo": str}) for f in fs], ignore_index=True)
    W = W[(W["momento"] >= desde) & (W["momento"] <= hasta) & (W["corrida"] < W["momento"])]
    if W.empty:
        return W
    W = W.sort_values("corrida").groupby(["codigo", "momento"]).tail(ultimas)
    g = W.groupby(["codigo", "momento"])
    out = g[["T", "HR", "ff10", "rr1h"]].median().add_suffix("_w")
    out["T_sd_w"] = g["T"].std()
    out["n_w"] = g.size()
    return out.reset_index()
