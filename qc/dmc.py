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
    """Extremas oficiales de temperatura desde getEmaResumenDiario/{cod}: datos.temperaturaExtremas[día].maxima|minima
    {valor, momento en hora LOCAL de la estación}, con todos los decimales y su hora. Solo la extrema de cada día (no maxima06 ni extremas6Horas,
    que son de tramos parciales y podrían no ser la extrema del período). Devuelve [dict(tipo='min'|'max', valor, momento)]."""
    out = []
    te = ((js or {}).get("datos") or {}).get("temperaturaExtremas") or {}
    for dia, d in te.items():
        for k, t in (("minima", "min"), ("maxima", "max")):
            x = (d or {}).get(k) or {}
            val = numero(x.get("valor"))
            if val is None or not x.get("momento"):
                continue
            try:
                out.append(dict(tipo=t, valor=val, momento=pd.Timestamp(str(x["momento"])[:19]), fuente=f"temperaturaExtremas.{dia}.{k}"))
            except ValueError:
                pass
    return out


LIM_FISICO = (-60.0, 60.0)      # °C: fuera de esto el valor del resumen diario es imposible (ej. 322.0 °C de Frei, 13-11-2026)
DIF_MAX = 2.0                   # °C: diferencia máxima aceptada entre la extrema del resumen y los minutos


def validar_extremas(oficial, A):
    """Valida las extremas del resumen diario ANTES de usarlas: rango físico y coherencia con los minutos de la estación (A: minutario
    de esa estación). Si el valor es imposible o difiere en más de DIF_MAX °C de lo que marcaron los minutos en las 12 h que terminan
    en su hora, se descarta (el control usa los minutos) y se informa la falla del sensor aparte, en estaciones automáticas.
    Devuelve (extremas válidas, [dict(tipo, valor, momento, ref, motivo)])."""
    ok, mal = [], []
    for x in oficial or []:
        val = x["valor"]
        if val < LIM_FISICO[0] or val > LIM_FISICO[1]:
            mal.append(dict(x, ref=None, motivo="fuera de rango físico")); continue
        if A is not None and len(A) and "T" in A:
            # el momento viene en hora local (UTC−3/−4/−5/−6): el hecho real cae entre m+2 h y m+7 h en UTC; se compara con los minutos
            # de esa ventana, y solo si el minutario la cubre entera (si no, solo vale el rango físico)
            m = x["momento"]
            ini, fin = m - pd.Timedelta(hours=2), m + pd.Timedelta(hours=8)
            W = A[(A["momento"] >= ini) & (A["momento"] <= fin)].dropna(subset=["T"])
            if A["momento"].min() <= ini and A["momento"].max() >= fin and len(W) > 30:
                ref = float(W["T"].min() if x["tipo"] == "min" else W["T"].max())
                if (x["tipo"] == "min" and val < ref - DIF_MAX) or (x["tipo"] == "max" and val > ref + DIF_MAX):
                    mal.append(dict(x, ref=ref, motivo=f"difiere {abs(val - ref):.1f} °C de los minutos")); continue
        ok.append(x)
    return ok, mal
