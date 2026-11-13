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


# ======================================================================= resumen diario (extremas oficiales)
def extremas_oficiales(js):
    """Extremas oficiales de temperatura desde getEmaResumenDiario/{cod} (decimales completos y hora).
    El lector es tolerante: recorre el JSON y toma cada objeto con un «momento» y un valor de mínima o máxima
    (temperaturaExtremas por día, maxima06, extremas6Horas…). Devuelve [dict(tipo='min'|'max', valor, momento, fuente)].
    getDatosRecientesRedEma trae 1 decimal y sin hora de Tn12/Tx12; por eso se prefiere esto."""
    out = []

    def tipo_de(k):
        k = k.lower()
        if "min" in k:
            return "min"
        if "max" in k:
            return "max"
        return None

    def recorrer(n, ruta):
        if isinstance(n, dict):
            mom = next((n[k] for k in n if k.lower() in ("momento", "fechahora", "hora", "momentoutc")), None)
            for k, x in n.items():
                t = tipo_de(k) or (tipo_de(ruta[-1]) if ruta else None)
                if mom and t and not isinstance(x, (dict, list)) and k.lower() not in ("momento", "fechahora", "hora", "momentoutc"):
                    val = numero(x)
                    if val is not None:
                        try:
                            out.append(dict(tipo=t, valor=val, momento=pd.Timestamp(str(mom)[:19]), fuente=".".join(ruta + [k])))
                        except ValueError:
                            pass
                recorrer(x, ruta + [k])
        elif isinstance(n, list):
            for x in n:
                recorrer(x, ruta)

    recorrer(js, [])
    # solo temperatura (el resumen trae también otras variables)
    return [x for x in out if "temp" in x["fuente"].lower() or "maxima06" in x["fuente"].lower() or "extremas" in x["fuente"].lower()]
