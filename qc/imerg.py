"""IMERG (NASA GPM) en el punto de cada estación, a partir de las imágenes de NASA GIBS (sin clave).

GIBS publica la capa «IMERG_Precipitation_Rate_30min» (tasa de lluvia en mm/h, promedio de 30 min) con unas 5 h de retraso.
Cada imagen es un mosaico de 512 px pintado con una paleta; el mapa de colores oficial (GPM_Precipitation_Rate.xml) traduce el color a mm/h:
  gris 191 transparente = menos de 0,1 mm/h (seco) · gris 128 transparente = sin dato · color = rango de mm/h (se usa el centro del rango).
Se pide la matriz «2km» en el nivel 4 (píxel de 0,035°, parecido a la resolución real de IMERG, 0,1°).
Cada corrida baja los pasos de 30 min que faltan (hasta MAX_PASOS, los más recientes primero) y los archiva en datos/imerg/AAAA/MM/DD.json,
así la evidencia de lluvia queda para analizar periodos largos. Es una evidencia más, nunca decide sola: en zonas áridas y en cordillera se equivoca.
La hora del paso que publica GIBS se toma como el inicio de los 30 minutos; el error posible de ±30 min se absorbe con la tolerancia de ±1 h del análisis.
"""
import io
import json
import re
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta
from pathlib import Path
import numpy as np
import pandas as pd

URL = "https://gibs.earthdata.nasa.gov/wmts/epsg4326/best/IMERG_Precipitation_Rate_30min/default/{t}/2km/{z}/{r}/{c}.png"
CMAP_URL = "https://gibs.earthdata.nasa.gov/colormaps/v1.3/GPM_Precipitation_Rate.xml"
Z, TAM = 4, 512                  # nivel 4 de la matriz 2km: 20 × 10 mosaicos de 18° (se confirmó en el diagnóstico de GIBS)
ANCHO_GRADOS = 360.0 / 20
ESPERA_H = 6                     # no se piden pasos más recientes que 6 h (llegan con ~5 h de retraso)
MAX_PASOS = 96                   # pasos de 30 min por corrida (los más recientes primero); el resto se baja en las corridas siguientes
BACKFILL_DIAS = 3
PRESUPUESTO_S = 240


def leer_colormap(xml):
    """(rgb N×3, mm/h N) con el centro de cada rango; None en mm para «sin dato». Devuelve también el color de «sin dato» y de «seco»."""
    rgb, val, sd, seco = [], [], None, None
    for m in re.finditer(r"<ColorMapEntry\b([^>]*)/?>", xml):
        a = m.group(1)
        c = re.search(r'rgb="(\d+),(\d+),(\d+)"', a)
        if not c:
            continue
        c = tuple(int(x) for x in c.groups())
        if 'nodata="true"' in a:
            sd = c
            continue
        v = re.search(r'value="([\[\(])([^,]+),([^\)\]]+)[\)\]]"', a)
        if not v:
            continue
        lo = float("-inf") if "INF" in v.group(2) else float(v.group(2))
        hi = float("inf") if "INF" in v.group(3) else float(v.group(3))
        if lo == float("-inf"):
            seco = c
            continue
        rgb.append(c)
        val.append(lo if hi == float("inf") else (lo + hi) / 2)
    return np.array(rgb, dtype=float), np.array(val), sd, seco


def mm_pixel(px, cmap):
    """Un píxel RGBA → mm/h (0.0 si seco, None si sin dato)."""
    rgb, val, sd, seco = cmap
    r, g, b, a = px
    if a == 0:
        return None if sd is not None and (r, g, b) == sd else 0.0
    return float(val[int(np.argmin(((rgb - np.array([r, g, b], dtype=float)) ** 2).sum(1)))])


def posicion(lat, lon):
    """(fila, columna, y, x) del píxel que contiene el punto, en el nivel Z."""
    px = ANCHO_GRADOS / TAM
    col, row = int((lon + 180) // ANCHO_GRADOS), int((90 - lat) // ANCHO_GRADOS)
    return row, col, int((90 - lat - row * ANCHO_GRADOS) / px), int((lon + 180 - col * ANCHO_GRADOS) / px)


def _archivo(raiz, t):
    return Path(raiz) / "imerg" / f"{t:%Y/%m/%d}.json"


def _leer(f):
    try:
        return json.loads(Path(f).read_text(encoding="utf-8"))
    except Exception:
        return {}


def guardar_paso(raiz, t, valores):
    """Archiva un paso de 30 min: {código: mm/h} solo con lo > 0 (la presencia del paso significa que se descargó)."""
    f = _archivo(raiz, t)
    f.parent.mkdir(parents=True, exist_ok=True)
    d = _leer(f)
    d.setdefault("pasos", {})[f"{t:%H:%M}"] = {c: round(v, 2) for c, v in valores.items() if v and v > 0}
    f.write_text(json.dumps(d, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")


def pasos_guardados(raiz, desde, hasta):
    out, t = {}, pd.Timestamp(desde).floor("D")
    while t <= pd.Timestamp(hasta):
        for hm, v in _leer(_archivo(raiz, t)).get("pasos", {}).items():
            out[t + pd.Timedelta(hours=int(hm[:2]), minutes=int(hm[3:]))] = v
        t += pd.Timedelta(days=1)
    return out


def tabla(raiz, horas, codigos):
    """DataFrame hora × código con los mm de la hora cerrada (h−1, h]: promedio de los pasos :00 y :30 de esa hora; NaN si faltan ambos."""
    P = pasos_guardados(raiz, min(horas) - pd.Timedelta(hours=1), max(horas))
    out = pd.DataFrame(np.nan, index=horas, columns=codigos)
    for h in horas:
        t0, t1 = h - pd.Timedelta(hours=1), h - pd.Timedelta(minutes=30)
        pas = [P[t] for t in (t0, t1) if t in P]
        if not pas:
            continue
        for c in codigos:
            out.at[h, c] = sum(p.get(c, 0.0) for p in pas) / len(pas)
    return out


def _bajar(sesion, t, r, c):
    u = URL.format(t=f"{t:%Y-%m-%dT%H:%M:%SZ}", z=Z, r=r, c=c)
    for _ in range(2):
        try:
            q = sesion.get(u, timeout=30)
            if q.status_code == 200:
                return q.content
            if q.status_code == 404:
                return None
        except Exception:
            time.sleep(1)
    return None


def muestrear_paso(sesion, E, t, cmap):
    """{código: mm/h} de todas las estaciones en el paso t, o None si falta algún mosaico (no se archiva a medias)."""
    from PIL import Image
    pos = {str(c): posicion(la, lo) for c, la, lo in zip(E["codigo"], E["lat"], E["lon"]) if pd.notna(la) and pd.notna(lo)}
    mos = sorted({(p[0], p[1]) for p in pos.values()})
    with ThreadPoolExecutor(6) as ex:
        res = list(ex.map(lambda rc: _bajar(sesion, t, *rc), mos))
    img = {}
    for rc, b in zip(mos, res):
        if b is None:
            return None
        img[rc] = Image.open(io.BytesIO(b)).convert("RGBA")
    out = {}
    for c, (r, col, y, x) in pos.items():
        v = mm_pixel(img[(r, col)].getpixel((min(x, TAM - 1), min(y, TAM - 1))), cmap)
        if v is not None:
            out[c] = v
    return out


def actualizar(raiz, E, ahora, backfill_dias=BACKFILL_DIAS, max_pasos=MAX_PASOS):
    """Baja los pasos que faltan (más recientes primero). Devuelve cuántos pasos se archivaron."""
    import requests
    fin = (pd.Timestamp(ahora) - pd.Timedelta(hours=ESPERA_H)).floor("30min")
    ini = fin - pd.Timedelta(days=backfill_dias)
    tengo = set(pasos_guardados(raiz, ini, fin))
    faltan = [t for t in pd.date_range(ini, fin, freq="30min")[::-1] if t not in tengo][:max_pasos]
    if not faltan:
        return 0
    s = requests.Session()
    cm = s.get(CMAP_URL, timeout=60)
    cm.raise_for_status()
    cmap = leer_colormap(cm.text)
    t_ini, n = time.time(), 0
    for t in faltan:
        if time.time() - t_ini > PRESUPUESTO_S:
            break
        v = muestrear_paso(s, E, t, cmap)
        if v is not None:
            guardar_paso(raiz, t, v)
            n += 1
    return n
