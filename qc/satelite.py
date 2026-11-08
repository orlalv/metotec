"""
Cruces con el satélite GOES-19.

El resumen por estación lo produce el visor satelital (repositorio conveccion-chile) en cada
imagen nueva (~10 min) y lo publica como data/sat_estaciones.json (últimas 12 h).
Campos por estación: ver CAMPOS en conveccion-chile/sat_estaciones.py.

Pruebas:
  estaciones automáticas (hora cerrada)
    SAT-RR0   el satélite ve lluvia sobre la estación y el pluviómetro marca 0
    SAT-RRD   el pluviómetro marca lluvia con cielo despejado
    SAT-RAD   radiación muy baja con cielo despejado (sensor sucio, sombra o desnivelado)
  observaciones (cada hora)
    SAT1 N 0 con nubes sobre la estación          SAT2 N 8 con cielo despejado
    SAT3 precipitación con cielo despejado        SAT4 tormenta sin rayos ni topes fríos
    SAT5 rayos cercanos sin tormenta informada    SAT6 cumulonimbo sin topes fríos
    SAT7 convección profunda y nubes bajas estratiformes o sin nubes bajas
    SAT8 niebla con cielo despejado
Todas son de nivel 1 (sospechoso) salvo SAT3 con todo despejado a 30 km (nivel 2).
"""

import math
import numpy as np
import pandas as pd
import requests

URLS = ["https://satelite.metotec.cl/data/sat_estaciones.json",
        "https://orlalv.github.io/conveccion-chile/data/sat_estaciones.json"]
TORMENTA = {17, 29} | set(range(91, 100))


def obtener(urls=URLS):
    err = []
    for u in urls:
        try:
            r = requests.get(u, timeout=40, headers={"User-Agent": "metotec-qc/0.1"})
            r.raise_for_status()
            return r.json()
        except Exception as e:
            err.append(f"{u}: {e}")
    raise RuntimeError(" | ".join(err))


def series(js):
    """{codigo: [(momento, {campo: valor}), ...]} en orden temporal."""
    if not js:
        return {}
    C = js["campos"]
    out = {}
    for f in js.get("frames", []):
        t = pd.Timestamp(f["t"]).tz_localize(None)
        for cod, fila in f["d"].items():
            d = dict(zip(C, fila))
            d["_glm"] = f.get("glm", False)
            out.setdefault(cod, []).append((t, d))
    return out


def ventana(S, desde, hasta):
    return [d for t, d in S if desde < t <= hasta]


def _vals(F, k):
    return [f[k] for f in F if f.get(k) is not None]


def _todos(F, k, cond, minimo=2):
    x = _vals(F, k)
    return len(x) >= minimo and all(cond(v) for v in x)


# ------------------------------------------------------------------ estaciones automáticas
def ghi_despejado(lat, lon, t):
    """Radiación global con cielo despejado (Haurwitz), W/m²; t en UTC."""
    doy = t.dayofyear
    g = 2 * math.pi / 365 * (doy - 1 + (t.hour - 12) / 24)
    decl = 0.006918 - 0.399912 * math.cos(g) + 0.070257 * math.sin(g) - 0.006758 * math.cos(2 * g) + 0.000907 * math.sin(2 * g)
    eqt = 229.18 * (0.000075 + 0.001868 * math.cos(g) - 0.032077 * math.sin(g) - 0.014615 * math.cos(2 * g) - 0.040849 * math.sin(2 * g))
    hs = t.hour + t.minute / 60 + (eqt + 4 * lon) / 60
    ha = math.radians(15 * (hs - 12))
    la = math.radians(lat)
    cz = math.sin(la) * math.sin(decl) + math.cos(la) * math.cos(decl) * math.cos(ha)
    return (0.0, cz) if cz <= 0 else (1098 * cz * math.exp(-0.057 / cz), cz)


def ema(H, A, E, js):
    from pruebas import alerta
    out = []
    S = series(js)
    if H.empty or not S:
        return out
    fin = H["momento"].max()
    ini = fin - pd.Timedelta(hours=1)
    U = H[H["momento"] == fin].set_index("codigo")
    pos = E.set_index("codigo")[["lat", "lon"]].to_dict("index")
    for cod, F in ((c, ventana(S.get(c, []), ini, fin)) for c in U.index):
        if len(F) < 4:
            continue
        rr, n = U.at[cod, "rr1h"], U.at[cod, "n"]
        if pd.notna(rr) and n >= 50:
            lluvia_sat = sum(1 for f in F if (f.get("rr10") or 0) >= 2 and (f.get("nub10") or 0) >= 90)
            rayos = sum(f.get("ray10") or 0 for f in F)
            if rr == 0 and (lluvia_sat >= 3 or (lluvia_sat >= 2 and rayos >= 5)):
                mx = max(_vals(F, "rr10"))
                out.append(alerta(cod, "satelite", "rr1h", 1, fin, rr, mx,
                                  f"el satélite estima lluvia sobre la estación en {lluvia_sat} de {len(F)} imágenes (hasta {mx:g} mm/h) y el pluviómetro marca 0"))
            if rr >= 1 and _todos(F, "nub30", lambda v: v <= 5, 4):
                out.append(alerta(cod, "satelite", "rr1h", 1, fin, rr, 0,
                                  f"{rr:g} mm en la hora con cielo despejado en 30 km según el satélite (¿riego, mantención, falla?)"))
        # radiación con cielo despejado
        if A is not None and "Rad" in A and cod in pos and _todos(F, "nub30", lambda v: v <= 5, 4):
            g = A[(A["codigo"] == cod) & (A["momento"] > ini) & (A["momento"] <= fin)]["Rad"].dropna()
            if len(g) >= 40:
                cs, cz = ghi_despejado(pos[cod]["lat"], pos[cod]["lon"], ini + pd.Timedelta(minutes=30))
                if cz >= 0.35 and g.mean() < 0.55 * cs:
                    out.append(alerta(cod, "satelite", "Rad", 1, fin, g.mean(), cs,
                                      f"radiación media {g.mean():.0f} W/m² con cielo despejado; lo esperable es ~{cs:.0f} W/m² (¿sensor sucio o sombreado?)"))
    return out


# ------------------------------------------------------------------ observaciones
def sensorial(t, o, S):
    """t: hora de la observación (UTC). S: serie satelital de la estación. Devuelve [(tipo, regla, nivel, msg)]."""
    from sensorial import v, PRECIP
    out = []
    if not S:
        return out
    add = lambda cod, niv, msg: out.append(("satelite", cod, niv, msg))
    F = ventana(S, t - pd.Timedelta(minutes=30), t + pd.Timedelta(minutes=5))      # la observación se hace ~10 min antes de la hora
    Fh = ventana(S, t - pd.Timedelta(minutes=60), t + pd.Timedelta(minutes=5))     # hora previa (tormenta, rayos)
    if len(F) < 2:
        return out
    ww, N = v(o, "WWSINOP", "ww"), v(o, "N")
    CL = v(o, "Nubes", "Cl")
    if N == 0 and _todos(F, "nub10", lambda x: x >= 90):
        add("SAT1", 1, "cielo despejado (N 0) y el satélite ve nubes sobre la estación (≥ 90 % a 10 km)")
    if N == 8 and _todos(F, "nub30", lambda x: x <= 5):
        add("SAT2", 1, "cielo cubierto (N 8) y el satélite ve despejado en 30 km a la redonda")
    if ww in PRECIP and _todos(F, "nub10", lambda x: x <= 5):
        todo = _todos(F, "nub30", lambda x: x <= 5)
        add("SAT3", 2 if todo else 1, f"precipitación (ww {ww}) y el satélite no ve nubes sobre la estación" + (" ni en 30 km" if todo else ""))
    glm_ok = len(Fh) >= 4 and all(f.get("_glm") for f in Fh)
    rayos30 = sum(f.get("ray30") or 0 for f in Fh)
    rayos10 = sum(f.get("ray10") or 0 for f in Fh)
    tmin = min(_vals(Fh, "t13n10") or [None]) if _vals(Fh, "t13n10") else None
    if ww in TORMENTA and glm_ok and rayos30 == 0 and tmin is not None and tmin > -30:
        add("SAT4", 1, f"tormenta (ww {ww}) sin rayos GLM a 30 km en la hora y topes no muy fríos (mínimo {tmin:g} °C)")
    if glm_ok and rayos10 >= 3 and ww is not None and ww not in TORMENTA | {13}:
        add("SAT5", 1, f"el GLM detectó {rayos10} rayos a ≤ 10 km en la última hora y no se informa tormenta (ww {ww:02d})")
    if CL in (3, 9) and tmin is not None and tmin > -15 and rayos30 == 0:
        add("SAT6", 1, f"cumulonimbo (CL {CL}) y los topes a 10 km no bajan de {tmin:g} °C")
    frio = _vals(F, "frio30")
    sd = _vals(F, "t13sd30")
    if CL in (0, 5, 6, 7) and frio and sd and max(frio) >= 20 and max(sd) >= 8 and rayos30 > 0:
        add("SAT7", 1, f"el satélite muestra convección profunda (topes < −40 °C en {max(frio):g} % del área y rayos) y CL es {CL}")
    if ww is not None and 42 <= ww <= 49 and _todos(F, "nub30", lambda x: x <= 5):
        add("SAT8", 1, f"niebla (ww {ww}) y el satélite ve despejado en 30 km")
    return out
