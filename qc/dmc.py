"""Lectura de la red de estaciones automáticas de la DMC (servicio getDatosRecientesRedEma).

El servicio entrega la última hora de datos (minutarios en la mayoría de las estaciones).
Los valores vienen como texto con unidad ("20.2 °C", "1011.6 hPas.") o null.
"""
import json, os, re
import requests
import pandas as pd

BASE = "https://climatologia.meteochile.gob.cl/application/servicios/"

# nombre en el servicio -> columna corta
CAMPOS = {
    "temperatura": "T", "puntoDeRocio": "Td", "humedadRelativa": "HR",
    "presionEstacion": "P_est", "presionNivelDelMar": "P_mar", "presionNivelEstandar": "P_std",
    "aguaCaidaDelMinuto": "rr1m", "aguaCaida6Horas": "rr6", "aguaCaida24Horas": "rr24",
    "direccionDelVientoPromedio10Minutos": "dd10", "fuerzaDelVientoPromedio10Minutos": "ff10",
    "direccionDelVientoPromedio2Minutos": "dd2", "fuerzaDelVientoPromedio2Minutos": "ff2",
    "fuerzaDelViento10MinutosMax": "fx10", "radiacionGlobalInst": "Rad",
    "temperaturaMinima12Horas": "Tn12", "temperaturaMaxima12Horas": "Tx12",
}
COLS = ["codigo", "momento"] + list(CAMPOS.values())
_NUM = re.compile(r"-?\d+(?:\.\d+)?")


def texto(s):
    """Arregla acentos mal codificados ("QuimÃ¡vida" → "Quimávida")."""
    if isinstance(s, str) and ("Ã" in s or "Â" in s):
        try:
            return s.encode("latin-1").decode("utf-8")
        except (UnicodeEncodeError, UnicodeDecodeError):
            return s
    return s


def numero(v):
    if v is None:
        return None
    if isinstance(v, (int, float)):
        return float(v)
    m = _NUM.search(str(v))
    return float(m.group()) if m else None


def descargar(servicio="getDatosRecientesRedEma", usuario=None, token=None, timeout=240):
    usuario = usuario or os.environ["DMC_USUARIO"]
    token = token or os.environ["DMC_TOKEN"]
    r = requests.get(BASE + servicio, params={"usuario": usuario, "token": token}, timeout=timeout)
    r.raise_for_status()
    return r.json()


def leer(js):
    """Devuelve (estaciones: DataFrame, datos: DataFrame largo con una fila por estación y momento)."""
    est, filas = [], []
    for e in js.get("datosEstaciones") or []:
        m = e.get("estacion") or {}
        cod = str(m.get("codigoNacional"))
        est.append(dict(codigo=cod, nombre=texto(m.get("nombreEstacion")), omm=m.get("codigoOMM") or "", oaci=m.get("codigoOACI") or "",
                        lat=numero(m.get("latitud")), lon=numero(m.get("longitud")), alt=numero(m.get("altura")),
                        registros=m.get("registros"), status=m.get("status")))
        for d in e.get("datos") or []:
            f = {"codigo": cod, "momento": d.get("momento")}
            for k, c in CAMPOS.items():
                f[c] = numero(d.get(k))
            filas.append(f)
    E = pd.DataFrame(est)
    D = pd.DataFrame(filas, columns=COLS)
    if len(D):
        D["momento"] = pd.to_datetime(D["momento"])
        D = D.sort_values(["codigo", "momento"]).drop_duplicates(["codigo", "momento"], keep="last")
    return E, D


if __name__ == "__main__":
    import sys
    E, D = leer(json.load(open(sys.argv[1], encoding="utf-8")))
    print(len(E), "estaciones;", len(D), "registros;", D["momento"].min(), "→", D["momento"].max())
    print(D.describe().T[["count", "min", "max"]])
