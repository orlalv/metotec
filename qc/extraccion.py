"""Lectura de la «Extracción de datos» de SACLIM (Excel: una hoja por estación, un bloque por elemento) a la misma forma
que entrega getRecientesSaclim: {Timestamp UTC: {Elemento: {componente: valor}}}."""
import re
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo
import openpyxl, pandas as pd

SD = "SD"
NUBE = {"CI": 0, "CC": 1, "CS": 2, "AC": 3, "AS": 4, "NS": 5, "SC": 6, "ST": 7, "CU": 8, "CB": 9, "TCU": 10}
FEN = {"DZ": 1, "RA": 2, "BR": 9, "FG": 10, "HZ": 15}

# título del bloque → (elemento SACLIM, [componentes en el orden de las columnas])
BLOQUES = {
    "Temperatura del Aire Seco": ("Ts", ["Ts"]),
    "Temperatura de Rocío": ("Td", ["Td"]),
    "Humedad Relativa del Aire": ("HR", ["HR"]),
    "Presión Atm. a Nivel de Estación (QFE)": ("QFE", ["QFE"]),
    "Presión Atm. a Nivel Medio del Mar (QFF)": ("QFF", ["QFF"]),
    "Presión Atm. Estándar OACI (QNH)": ("QNH", ["QNH"]),
    "Tendencia Barométrica": ("a", ["a", "ppp"]),
    "Viento a 10 m. de Altura": ("VTO", ["dd", "ff", "VRB"]),
    "Viento promedio 2 minutos": ("VTO02", ["dd", "ff"]),
    "Racha de Viento": ("Racha", ["fmfm"]),
    "Variación de la Dirección del Viento": ("VarDirVto", ["dndndn", "dxdxdx"]),
    "Cantidad de Cielo Cubierto": ("N", ["N"]),
    "Descripción Nubosidad": ("Nubes", ["Nh", "Cl", "Cm", "Ch"]),
    "Capa de Nubes": ("CapaNube", [f"{c}{s}" for s in ("", "2", "3", "4", "5", "6") for c in ("Ns", "C", "hshshs")]),
    "Dirección de las Nubes": ("DirNubes", ["Dl", "Dm", "Dh"]),
    "Tiempo Presente Sinóptico": ("WWSINOP", ["ww"]),
    "Tiempo Pasado Sinóptico": ("W1W2", ["W1", "W2"]),
    "Tiempo Presente METAR": ("WWMETAR", ["IntProx", "DESC", "FEN1", "FEN2", "FEN3", "IntProx2", "DESC2", "FEN12", "FEN22", "FEN32",
                                          "IntProx3", "DESC3", "FEN13", "FEN23", "FEN33"]),
    "Tiempo Reciente METAR": ("reWW", ["reWW", "reWW2", "reWW3"]),
    "Visibilidad Horizontal Sinóptica": ("VVSINOP", ["VV"]),
    "Visibilidad METAR": ("VVMETAR", ["Reinante", "Minima", "Dv"]),
    "Visibilidad Vertical": ("VisVert", ["VisVert"]),
    "Agua caída durante 1 hora": ("RRR1h", ["RRR1h"]),
    "Agua Caida, Acumulada  6 Horas": ("RRR6", ["RRR6", "_calc", "Traza"]),
}
EXTREMAS = {"Temperatura Mínima AM": "TnAM", "Temp. Máxima AM": "TxAM", "Temp. Mínima PM": "TnPM", "Temperatura Máxima PM": "TxPM"}
ZONA = {"270001": "Pacific/Easter"}


def _val(comp, x):
    if x is None or x == "":
        return None
    if isinstance(x, bool):
        return int(x)
    if isinstance(x, (int, float)):
        return x
    s = str(x).strip()
    if s in ("True", "False"):
        return int(s == "True")
    m = re.fullmatch(r"(\d)/8", s)
    if m:
        return int(m.group(1))
    if s.upper() in NUBE and comp.startswith("C"):
        return NUBE[s.upper()]
    if s.upper() in FEN and comp.startswith("FEN"):
        return FEN[s.upper()]
    if s == "/" or s.upper() in ("SD", "SIN DATO"):
        return SD
    try:
        return float(s) if "." in s else int(s)
    except ValueError:
        return s


def leer(ruta):
    """Devuelve {codigo: {'nombre', 'obs': {Timestamp: obs}}}."""
    wb = openpyxl.load_workbook(ruta, read_only=True, data_only=True)
    out = {}
    for ws in wb.worksheets:
        ws.reset_dimensions()          # el archivo de SACLIM declara mal su tamaño
        R = [list(r) for r in ws.iter_rows(values_only=True)]
        cod = str(ws.title).strip()
        nombre = next((str(r[0]) for r in R[:15] if r and isinstance(r[0], str) and r[0].startswith(cod)), cod)
        obs = {}
        Z = ZoneInfo(ZONA.get(cod, "America/Santiago"))
        i = 0
        while i < len(R) - 1:
            r = R[i]
            tit = r[1] if len(r) > 1 else None
            if not (isinstance(tit, str) and len(R[i + 1]) > 1 and R[i + 1][1] in ("Momento", "Período")):
                i += 1; continue
            tit = tit.strip()
            j = i + 2
            filas = []
            while j < len(R) and len(R[j]) > 1 and isinstance(R[j][1], (datetime, pd.Timestamp)):
                filas.append(R[j]); j += 1
            if tit in BLOQUES:
                el, comps = BLOQUES[tit]
                for f in filas:
                    t = pd.Timestamp(f[1])
                    if t.minute or t.second:          # SPECI / horas no redondas
                        continue
                    d = {}
                    for k, comp in enumerate(comps):
                        if comp.startswith("_"):
                            continue
                        x = _val(comp, f[3 + k] if 3 + k < len(f) else None)
                        if x is not None:
                            d[comp] = x
                    if d:
                        obs.setdefault(t, {})[el] = d
            elif tit in EXTREMAS:
                el = EXTREMAS[tit]
                for f in filas:
                    v, fh = _val(el, f[3] if len(f) > 3 else None), f[4] if len(f) > 4 else None
                    if v is None or not isinstance(fh, (datetime, pd.Timestamp)):
                        continue
                    fh = pd.Timestamp(fh)
                    utc = fh.tz_localize(Z, ambiguous="NaT", nonexistent="shift_forward").tz_convert("UTC").tz_localize(None)
                    if pd.isna(utc):
                        continue
                    # TnAM/TxAM (00–12 UTC) van con la observación de las 12 UTC; TnPM/TxPM (12–00 UTC) con la de las 00 UTC siguiente
                    t = utc.normalize() + (pd.Timedelta(hours=12) if el.endswith("AM") else pd.Timedelta(days=1))
                    if el.endswith("PM") and utc.hour < 12:
                        t = utc.normalize()
                    obs.setdefault(t, {})[el] = {el: v, "FechaHora": f"{fh:%Y-%m-%d %H:%M:%S}"}
            i = j
        out[cod] = dict(nombre=nombre, obs=dict(sorted(obs.items())))
    return out
