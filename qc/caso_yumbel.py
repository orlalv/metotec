"""Caso Yumbel 21-nov-2026: lluvia en estaciones, IMERG, GOES-19 (Tb canal 13, GLM), viento 850/700 hPa y CAPE.
Corre en GitHub Actions (llega a la DMC, NASA GIBS, AWS NOAA y Open-Meteo). Imprime un JSON con todo lo obtenido.
Uso: python qc/caso_yumbel.py --datos datos --salida caso_yumbel.json
"""
import argparse, gzip, io, json, math, os, re, sys, tempfile, time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from pathlib import Path

import numpy as np
import pandas as pd
import requests

sys.path.insert(0, os.path.dirname(__file__))
import imerg as IM
import goes_hist as GH

UTC = timezone.utc
DIAS = ["2026-11-21", "2026-11-22", "2026-11-23"]
T0, T1 = datetime(2026, 11, 21, 5, tzinfo=UTC), datetime(2026, 11, 22, 0, tzinfo=UTC)
RADIO = 60.0
OUT = {"fuentes": {}, "errores": []}


def km(a1, o1, a2, o2):
    r = math.radians
    q = math.sin(r(a2 - a1) / 2) ** 2 + math.cos(r(a1)) * math.cos(r(a2)) * math.sin(r(o2 - o1) / 2) ** 2
    return 12742 * math.asin(math.sqrt(q))


def rumbo(a1, o1, a2, o2):
    y = math.sin(math.radians(o2 - o1)) * math.cos(math.radians(a2))
    x = math.cos(math.radians(a1)) * math.sin(math.radians(a2)) - math.sin(math.radians(a1)) * math.cos(math.radians(a2)) * math.cos(math.radians(o2 - o1))
    return (math.degrees(math.atan2(y, x)) + 360) % 360


# ------------------------------------------------------------------ 0. coordenada de Yumbel
def coordenada():
    try:
        r = requests.get("https://geocoding-api.open-meteo.com/v1/search", params={"name": "Yumbel", "count": 5, "language": "es", "country_code": "CL"}, timeout=30).json()
        c = [x for x in r.get("results", []) if x.get("country_code") == "CL"]
        OUT["yumbel_geocoding"] = c[:3]
        OUT["fuentes"]["coordenada"] = "Open-Meteo Geocoding API (GeoNames), búsqueda «Yumbel»"
        if c:
            return float(c[0]["latitude"]), float(c[0]["longitude"])
    except Exception as e:
        OUT["errores"].append(f"geocoding: {e}")
    return -37.098, -72.558


# ------------------------------------------------------------------ 1. estaciones DMC (archivo minutario propio)
def dmc(raiz, la0, lo0):
    E = json.loads((Path(raiz) / "estaciones.json").read_text(encoding="utf-8"))
    cerca = {e["codigo"]: e for e in E if e.get("lat") is not None and km(la0, lo0, float(e["lat"]), float(e["lon"])) <= RADIO}
    for c in ("360011", "360046", "360019", "370077", "370033", "370036"):        # las del caso, aunque estén a más de 60 km
        cerca.setdefault(c, next((e for e in E if e["codigo"] == c), None))
    cerca = {c: e for c, e in cerca.items() if e}
    filas = []
    for d in DIAS + ["2026-11-24"]:
        for h in range(24):
            f = Path(raiz) / "ema" / d[:4] / d[5:7] / d[8:10] / f"{h:02d}.csv.gz"
            if f.exists():
                try:
                    D = pd.read_csv(f, usecols=lambda c: c in ("codigo", "momento", "rr1m"), dtype={"codigo": str})
                    filas.append(D[D["codigo"].isin(cerca)])
                except Exception as e:
                    OUT["errores"].append(f"{f}: {e}")
    A = pd.concat(filas, ignore_index=True) if filas else pd.DataFrame(columns=["codigo", "momento", "rr1m"])
    A["momento"] = pd.to_datetime(A["momento"])
    A = A.drop_duplicates(["codigo", "momento"])
    A["hora"] = A["momento"].dt.ceil("h")                              # hora que termina (h-1, h]
    G = A.groupby(["codigo", "hora"])["rr1m"].agg(["sum", "count"]).reset_index()
    res = {}
    for c, e in cerca.items():
        g = G[G["codigo"] == c]
        hor = {f"{t:%Y-%m-%d %H}": round(float(s), 1) for t, s, n in zip(g["hora"], g["sum"], g["count"]) if n > 0}
        dia = {}
        for d in DIAS:                                                   # día UTC: horas que terminan en (d 01 … d+1 00]
            a = pd.Timestamp(d) + pd.Timedelta(hours=1); b = a + pd.Timedelta(hours=23)
            gg = g[(g["hora"] >= a) & (g["hora"] <= b)]
            dia[d] = dict(mm=round(float(gg["sum"].sum()), 1) if len(gg) else None, horas_con_dato=int((gg["count"] > 0).sum()),
                          horas_lluvia=[f"{t:%H}" for t, s in zip(gg["hora"], gg["sum"]) if s >= 0.2])
        res[c] = dict(nombre=e["nombre"], lat=e["lat"], lon=e["lon"], alt=e.get("alt"), km=round(km(la0, lo0, float(e["lat"]), float(e["lon"])), 1),
                      rumbo=round(rumbo(la0, lo0, float(e["lat"]), float(e["lon"]))), dias=dia, horaria=hor)
    OUT["dmc"] = res
    OUT["fuentes"]["dmc"] = "Archivo minutario METOTEC (datos/ema/AAAA/MM/DD/HH.csv.gz, servicio DMC getDatosRecientesRedEma); suma de rr1m por hora UTC (h−1, h]"


# ------------------------------------------------------------------ 1b. Cabrero (cooperativa 370001): SACLIM y agua caída
def cabrero():
    r = {}
    for var in ("Agua6Horas", "AguaCaida", "Agua24Horas"):
        u = f"https://climatologia.meteochile.gob.cl/application/datos/getDatosSaclim/370001_2026_{var}_"
        try:
            q = requests.get(u, timeout=60)
            r[var] = dict(status=q.status_code, bytes=len(q.content), tipo=q.headers.get("content-type"))
            if q.status_code == 200 and q.content[:2] == b"PK":
                import zipfile
                z = zipfile.ZipFile(io.BytesIO(q.content))
                for n in z.namelist():
                    txt = z.read(n).decode("utf-8", "replace")
                    lin = [l for l in txt.splitlines() if "2026-11-2" in l or "21-11-2026" in l or "22-11-2026" in l or "23-11-2026" in l]
                    r[var]["archivo"] = n; r[var]["cabecera"] = txt.splitlines()[:2]; r[var]["lineas"] = lin[:80]
        except Exception as e:
            r[var] = dict(error=str(e))
    try:
        q = requests.get("https://climatologia.meteochile.gob.cl/application/serviciosb/getAguaCaidaDiaria/370001", timeout=60)
        js = q.json()
        r["getAguaCaidaDiaria"] = dict(status=q.status_code, nov2026=(((js.get("datos") or {}).get("2026") or {}).get("11")) if isinstance(js, dict) else None,
                                       estacion=js.get("estacion") if isinstance(js, dict) else None)
    except Exception as e:
        r["getAguaCaidaDiaria"] = dict(error=str(e))
    OUT["cabrero_370001"] = r


# ------------------------------------------------------------------ 1c. externas (INIA, ARAUCO…): catálogo en KV y archivo horario propio
def externas(raiz, la0, lo0):
    acc, tok = os.environ.get("CLOUDFLARE_ACCOUNT_ID"), os.environ.get("CLOUDFLARE_API_TOKEN")
    try:
        C = requests.get(f"https://api.cloudflare.com/client/v4/accounts/{acc}/storage/kv/namespaces/0d6aa4b37a834b5983ac9c7f638e2dbb/values/qc/externas/cat",
                         headers={"Authorization": f"Bearer {tok}"}, timeout=60).json()["estaciones"]
    except Exception as e:
        OUT["errores"].append(f"catálogo externas: {e}"); return
    cerca = {v["id"]: v for v in C if v.get("lat") is not None and km(la0, lo0, v["lat"], v["lon"]) <= RADIO}
    arch = {}
    for d in DIAS + ["2026-11-24"]:
        f = Path(raiz) / "ext" / "pp" / d[:4] / d[5:7] / f"{d[8:10]}.json"
        if f.exists():
            arch[d] = json.loads(f.read_text(encoding="utf-8"))
    res = {}
    for i, v in cerca.items():
        hor = {}
        for d, A in arch.items():
            for hh, x in (A.get(i) or {}).items():
                if x is not None:
                    hor[f"{d} {hh}"] = x                     # hora UTC en que termina el acumulado
        dia = {}
        for d in DIAS:
            sig = (datetime.fromisoformat(d) + timedelta(days=1)).strftime("%Y-%m-%d")
            hs = [f"{d} {h:02d}" for h in range(1, 24)] + [f"{sig} 00"]
            vals = [hor[k] for k in hs if k in hor]
            dia[d] = dict(mm=round(sum(vals), 1) if vals else None, horas_con_dato=len(vals), horas_lluvia=[k[-2:] for k in hs if hor.get(k, 0) >= 0.2])
        res[i] = dict(nombre=v.get("nombre"), inst=v.get("inst"), estado=v.get("estado"), lat=v["lat"], lon=v["lon"], alt=v.get("alt"),
                      km=round(km(la0, lo0, v["lat"], v["lon"]), 1), rumbo=round(rumbo(la0, lo0, v["lat"], v["lon"])), dias=dia,
                      horaria={k: x for k, x in sorted(hor.items()) if k[:10] in DIAS})
    OUT["externas"] = res
    OUT["fuentes"]["externas"] = "Catálogo y lluvia horaria de agrometeorologia.cl (INIA y redes asociadas), archivo METOTEC datos/ext/pp (hora UTC en que termina; etiqueta INIA UTC−4 + 5 h)"


# ------------------------------------------------------------------ 2a. IMERG
def imerg(la0, lo0):
    s = requests.Session(); s.headers["User-Agent"] = "metotec-caso/0.1"
    xml = s.get(IM.CMAP_URL, timeout=60).text
    cmap = IM.leer_colormap(xml)
    from PIL import Image
    # recuadro ±2,5° alrededor de Yumbel, en la grilla del nivel 4 (0,03515625° por píxel)
    px = IM.ANCHO_GRADOS / IM.TAM
    lats = np.arange(la0 + 2.5, la0 - 2.5, -px); lons = np.arange(lo0 - 2.5, lo0 + 2.5, px)
    tiles = sorted({IM.posicion(a, o)[:2] for a in (lats[0], lats[-1]) for o in (lons[0], lons[-1])})
    pasos, campos = [], {}
    t = T0
    while t <= T1:
        pasos.append(t); t += timedelta(minutes=30)
    cache = {}
    def bajar(tt):
        imgs = {}
        for rc in tiles:
            b = IM._bajar(s, tt, *rc)
            if b is None:
                return tt, None
            imgs[rc] = Image.open(io.BytesIO(b)).convert("RGBA")
        return tt, imgs
    with ThreadPoolExecutor(6) as ex:
        for tt, imgs in ex.map(bajar, pasos):
            cache[tt] = imgs
    # tabla de colores → mm/h vectorizada
    rgb, val, sd, seco = cmap
    serie = {}
    for tt in pasos:
        imgs = cache.get(tt)
        if not imgs:
            serie[f"{tt:%Y-%m-%dT%H:%MZ}"] = None; continue
        F = np.full((len(lats), len(lons)), np.nan, dtype="float32")
        arr = {rc: np.asarray(im) for rc, im in imgs.items()}
        for i, a in enumerate(lats):
            for j, o in enumerate(lons):
                r, c, y, x = IM.posicion(a, o)
                p = arr[(r, c)][min(y, IM.TAM - 1), min(x, IM.TAM - 1)]
                if p[3] == 0:
                    F[i, j] = np.nan if sd is not None and tuple(p[:3]) == tuple(sd) else 0.0
                else:
                    F[i, j] = float(val[int(np.argmin(((rgb - p[:3].astype(float)) ** 2).sum(1)))])
        campos[tt] = F
        i0, j0 = int(round((lats[0] - la0) / px)), int(round((lo0 - lons[0]) / px))
        v = F[i0, j0]
        # 3×3 píxeles (~10 km) y radio 30 km
        bloque = F[i0 - 1:i0 + 2, j0 - 1:j0 + 2]
        LAT, LON = np.meshgrid(lats, lons, indexing="ij")
        dist = np.vectorize(lambda a, o: km(la0, lo0, a, o))(LAT, LON) if tt == pasos[0] else dist_cache["d"]
        dist_cache["d"] = dist
        r30 = F[dist <= 30]
        llu = F > 1.0
        cen = None
        if np.nansum(llu & (dist <= 250)) >= 5:
            m = llu & (dist <= 250)
            cen = [round(float(LAT[m].mean()), 3), round(float(LON[m].mean()), 3)]
        serie[f"{tt:%Y-%m-%dT%H:%MZ}"] = dict(yumbel_mmh=None if np.isnan(v) else float(v), media_10km=float(np.nanmean(bloque)),
                                               media_30km=float(np.nanmean(r30)), max_30km=float(np.nanmax(r30)),
                                               area_lluvia_250km_px=int(np.nansum(llu & (dist <= 250))), centroide_lluvia_250km=cen)
    OUT["imerg"] = serie
    OUT["imerg_tiles"] = [f"{IM.URL.format(t='<paso>', z=IM.Z, r=r, c=c)}" for r, c in tiles]
    # desplazamiento por correlación entre campos sucesivos (cada 1 h)
    mov = []
    ks = sorted(campos)
    for a, b in zip(ks, ks[2:] + [None] * 2):
        if b is None or b not in campos:
            continue
        A, B = np.nan_to_num(campos[a]), np.nan_to_num(campos[b])
        if (A > 0.5).sum() < 20 or (B > 0.5).sum() < 20:
            continue
        mejor = None
        for dy in range(-20, 21):
            for dx in range(-20, 21):
                Bs = np.roll(np.roll(B, -dy, 0), -dx, 1)
                c = np.corrcoef(A[25:-25, 25:-25].ravel(), Bs[25:-25, 25:-25].ravel())[0, 1]
                if mejor is None or c > mejor[0]:
                    mejor = (c, dy, dx)
        c, dy, dx = mejor
        dn, de = -dy * px * 111.2, dx * px * 111.2 * math.cos(math.radians(la0))      # km hacia el norte y el este en 1 h
        vel = math.hypot(dn, de); hacia = (math.degrees(math.atan2(de, dn)) + 360) % 360
        mov.append(dict(desde=f"{a:%H:%M}", hasta=f"{b:%H:%M}", correlacion=round(float(c), 2), km_h=round(vel, 1), hacia_grados=round(hacia)))
    OUT["imerg_desplazamiento"] = mov
    OUT["fuentes"]["imerg"] = "NASA GIBS WMTS IMERG_Precipitation_Rate_30min (EPSG:4326, matriz 2km, nivel 4), paleta oficial GPM_Precipitation_Rate.xml; hora = inicio del paso de 30 min"


dist_cache = {}


# ------------------------------------------------------------------ 2b. GOES-19 canal 13 y GLM
def goes(la0, lo0):
    LAT, LON, _ = GH.malla(la0, lo0, 150, paso_km=2.0)
    D = np.vectorize(lambda a, o: km(la0, lo0, a, o))(LAT, LON)
    res, campos = {}, {}
    tmp = tempfile.mkdtemp()
    t = T0
    horas = []
    while t <= T1:
        horas.append(t); t += timedelta(hours=1)
    for tt in horas:
        try:
            claves = GH.listar("noaa-goes19", "ABI-L2-CMIPF", tt)
            k = GH.elegir(claves, 13, tt, tol_min=10)
            if not k:
                res[f"{tt:%Y-%m-%dT%H:%MZ}"] = None; continue
            ruta = GH.bajar("noaa-goes19", k, tmp)
            T, _, _ = GH.leer(ruta, LAT, LON)
            os.remove(ruta)
            Tc = T - 273.15
            campos[tt] = Tc
            n = Tc.shape[0] // 2
            r10, r30 = Tc[D <= 10], Tc[D <= 30]
            area = lambda u, r: round(float(np.nansum((Tc < u) & (D <= r)) * 4.0), 0)          # px de 2×2 km
            frio = (Tc < -35) & (D <= 150)
            cen = [round(float(LAT[frio].mean()), 3), round(float(LON[frio].mean()), 3)] if frio.sum() >= 5 else None
            res[f"{tt:%Y-%m-%dT%H:%MZ}"] = dict(archivo=k.rsplit("/", 1)[1], Tb_yumbel=round(float(Tc[n, n]), 1),
                                                 Tb_min_10km=round(float(np.nanmin(r10)), 1), Tb_min_30km=round(float(np.nanmin(r30)), 1),
                                                 Tb_media_30km=round(float(np.nanmean(r30)), 1),
                                                 km2_bajo_m40_30km=area(-40, 30), km2_bajo_m35_30km=area(-35, 30),
                                                 km2_bajo_m40_150km=area(-40, 150), km2_bajo_m35_150km=area(-35, 150), centroide_bajo_m35_150km=cen)
        except Exception as e:
            OUT["errores"].append(f"GOES {tt}: {e}")
    OUT["goes_c13"] = res
    mov = []
    ks = sorted(campos)
    for a, b in zip(ks, ks[1:]):
        A, B = np.nan_to_num(-campos[a]), np.nan_to_num(-campos[b])
        A = np.clip(A - 20, 0, None); B = np.clip(B - 20, 0, None)       # solo nubes más frías que −20 °C
        if (A > 0).sum() < 50 or (B > 0).sum() < 50:
            continue
        mejor = None
        for dy in range(-25, 26):
            for dx in range(-25, 26):
                Bs = np.roll(np.roll(B, -dy, 0), -dx, 1)
                c = np.corrcoef(A[30:-30, 30:-30].ravel(), Bs[30:-30, 30:-30].ravel())[0, 1]
                if mejor is None or c > mejor[0]:
                    mejor = (c, dy, dx)
        c, dy, dx = mejor
        dn, de = -dy * 2.0, dx * 2.0
        mov.append(dict(desde=f"{a:%H:%M}", hasta=f"{b:%H:%M}", correlacion=round(float(c), 2), km_h=round(math.hypot(dn, de), 1),
                        hacia_grados=round((math.degrees(math.atan2(de, dn)) + 360) % 360)))
    OUT["goes_desplazamiento"] = mov
    OUT["fuentes"]["goes"] = "NOAA GOES-19 ABI-L2-CMIPF banda 13 (10,3 µm), bucket noaa-goes19 en AWS; malla Mercator de 2 km, vecino más cercano"


def glm(la0, lo0):
    from netCDF4 import Dataset
    cuenta = {}
    tmp = tempfile.mkdtemp()
    t = T0
    while t < T1:
        pre = f"GLM-L2-LCFA/{t:%Y}/{t.timetuple().tm_yday:03d}/{t:%H}/"
        try:
            r = requests.get("https://noaa-goes19.s3.amazonaws.com/", params={"list-type": "2", "prefix": pre}, timeout=60)
            claves = re.findall(r"<Key>([^<]+)</Key>", r.text)
        except Exception as e:
            OUT["errores"].append(f"GLM {t}: {e}"); claves = []
        def bajar(k):
            try:
                return requests.get(f"https://noaa-goes19.s3.amazonaws.com/{k}", timeout=60).content
            except Exception:
                return None
        with ThreadPoolExecutor(12) as ex:
            B = list(ex.map(bajar, claves))
        R = []
        for b in B:                       # netCDF/HDF5 no es seguro con hilos: se lee de a uno
            if not b:
                continue
            try:
                f = os.path.join(tmp, "glm.nc"); open(f, "wb").write(b)
                with Dataset(f) as ds:
                    la, lo = np.asarray(ds["flash_lat"][:], float), np.asarray(ds["flash_lon"][:], float)
                d = np.array([km(la0, lo0, a, o) for a, o in zip(la, lo)]) if len(la) else np.array([])
                R.append((int((d <= 10).sum()), int((d <= 30).sum()), int((d <= 100).sum())))
            except Exception:
                pass
        cuenta[f"{t + timedelta(hours=1):%Y-%m-%dT%H:%MZ}"] = dict(archivos=len(claves), leidos=len(R), flashes_10km=sum(x[0] for x in R),
                                                                   flashes_30km=sum(x[1] for x in R), flashes_100km=sum(x[2] for x in R))
        t += timedelta(hours=1)
    OUT["glm"] = cuenta
    OUT["fuentes"]["glm"] = "NOAA GOES-19 GLM-L2-LCFA (flashes), bucket noaa-goes19 en AWS; hora = fin de la hora contada"


# ------------------------------------------------------------------ 3. viento y CAPE
def viento(la0, lo0):
    hv = "wind_speed_850hPa,wind_direction_850hPa,wind_speed_700hPa,wind_direction_700hPa,cape,precipitation,lifted_index,freezing_level_height,temperature_850hPa,temperature_500hPa"
    r = {}
    for nom, url, extra in (("historical_forecast", "https://historical-forecast-api.open-meteo.com/v1/forecast", {}),
                             ("era5", "https://archive-api.open-meteo.com/v1/archive", {"models": "era5"})):
        try:
            p = dict(latitude=la0, longitude=lo0, start_date="2026-11-21", end_date="2026-11-22", hourly=hv if nom != "era5" else "cape,precipitation,wind_speed_10m,wind_direction_10m",
                     wind_speed_unit="kn", timezone="GMT", **extra)
            q = requests.get(url, params=p, timeout=60)
            r[nom] = q.json() if q.status_code == 200 else dict(status=q.status_code, texto=q.text[:300])
        except Exception as e:
            r[nom] = dict(error=str(e))
    OUT["viento_cape"] = r
    OUT["fuentes"]["viento_cape"] = "Open-Meteo Historical Forecast API (modelo «best match») para 850/700 hPa, CAPE e índice de levantamiento; Open-Meteo ERA5 (archive-api) para CAPE y viento de 10 m"


def main():
    ap = argparse.ArgumentParser(); ap.add_argument("--datos", default="datos"); ap.add_argument("--salida", default="caso_yumbel.json")
    a = ap.parse_args()
    la0, lo0 = coordenada()
    OUT["yumbel"] = [la0, lo0]
    for nom, f in (("dmc", lambda: dmc(a.datos, la0, lo0)), ("cabrero", cabrero), ("externas", lambda: externas(a.datos, la0, lo0)),
                   ("viento", lambda: viento(la0, lo0)), ("imerg", lambda: imerg(la0, lo0)), ("goes", lambda: goes(la0, lo0)), ("glm", lambda: glm(la0, lo0))):
        t = time.time()
        try:
            f()
        except Exception as e:
            import traceback
            OUT["errores"].append(f"{nom}: {traceback.format_exc(limit=3)}")
        print(f"{nom}: {time.time() - t:.0f} s", flush=True)
        Path(a.salida).write_text(json.dumps(OUT, ensure_ascii=False, default=str), encoding="utf-8")       # se guarda tras cada parte
    Path(a.salida).write_text(json.dumps(OUT, ensure_ascii=False, default=str), encoding="utf-8")


if __name__ == "__main__":
    main()
