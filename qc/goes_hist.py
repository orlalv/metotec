"""GOES histórico desde los archivos originales de NOAA en AWS (noaa-goes16 / noaa-goes19, sin clave).
Atiende un pedido de «Verificar»: {id, cod, lat, lon, t (AAAA-MM-DDTHH:MM, UTC), prod: "ir" | "color", radio_km}.
  ir     → ABI-L2-CMIPF banda 13 (temperatura de brillo, 10.3 µm), pintada con paleta de nubes frías.
  color  → bandas 1, 2 y 3 (azul, rojo, infrarrojo cercano); el verde se sintetiza (0.45 R + 0.10 NIR + 0.45 B). De noche sale oscuro.
Recorta un cuadrado alrededor de la estación y lo reproyecta a Mercator (la misma proyección del mapa), así se superpone sin deformarse.
Deja en el KV:  qc/goes/{id}  (JSON con estado y límites)  y  qc/goesimg/{id}  (PNG con transparencia fuera del disco)."""
import argparse, io, json, math, os, re, sys, tempfile
from datetime import datetime, timedelta, timezone
import numpy as np
import requests

UTC = timezone.utc
R_TIERRA = 6371.0
CAMBIO_G19 = datetime(2025, 4, 7, tzinfo=UTC)          # GOES-19 pasa a ser GOES-East
INICIO_ABI = datetime(2017, 7, 1, tzinfo=UTC)
# Paleta del infrarrojo (K → RGB): gris para lo cálido, color para topes fríos (convección).
PALETA = [(193, (255, 255, 255)), (203, (200, 0, 160)), (213, (255, 0, 0)), (223, (255, 150, 0)), (233, (255, 255, 0)),
          (243, (0, 220, 120)), (253, (0, 170, 255)), (273, (190, 190, 190)), (313, (10, 10, 10))]


def kv_url(clave):
    return f"https://api.cloudflare.com/client/v4/accounts/{os.environ['CLOUDFLARE_ACCOUNT_ID']}/storage/kv/namespaces/{os.environ['KV_ID']}/values/{clave}"


def kv_put(clave, datos, tipo="application/json"):
    if not os.environ.get("CLOUDFLARE_API_TOKEN"):
        return "sin credenciales"
    r = requests.put(kv_url(clave), headers={"Authorization": f"Bearer {os.environ['CLOUDFLARE_API_TOKEN']}", "Content-Type": tipo},
                     data=datos if isinstance(datos, bytes) else datos.encode("utf-8"), timeout=120,
                     params={"expiration_ttl": 60 * 60 * 24 * 90})
    return str(r.status_code)


def balde_orden(t):
    return ["noaa-goes19", "noaa-goes16"] if t >= CAMBIO_G19 else ["noaa-goes16", "noaa-goes19"]


def inicio_escaneo(k):
    m = re.search(r"_s(\d{4})(\d{3})(\d{2})(\d{2})(\d{2})\d_", k)
    if not m:
        return None
    a, d, h, mi, s = map(int, m.groups())
    return datetime(a, 1, 1, h, mi, s, tzinfo=UTC) + timedelta(days=d - 1)


def listar(balde, prod, t):
    claves = []
    for dh in (-1, 0, 1):
        tt = t + timedelta(hours=dh)
        pre = f"{prod}/{tt:%Y}/{tt.timetuple().tm_yday:03d}/{tt:%H}/"
        r = requests.get(f"https://{balde}.s3.amazonaws.com/", params={"list-type": "2", "prefix": pre}, timeout=60)
        r.raise_for_status()
        claves += re.findall(r"<Key>([^<]+)</Key>", r.text)
    return claves


def elegir(claves, banda, t, tol_min=20):
    c = [(abs((inicio_escaneo(k) - t).total_seconds()), k) for k in claves if re.search(rf"-M\dC{banda:02d}_G\d\d_s", k) and inicio_escaneo(k)]
    c = [x for x in c if x[0] <= tol_min * 60]
    return min(c)[1] if c else None


def bajar(balde, clave, carpeta):
    ruta = os.path.join(carpeta, clave.rsplit("/", 1)[1])
    with requests.get(f"https://{balde}.s3.amazonaws.com/{clave}", stream=True, timeout=120) as r:
        r.raise_for_status()
        with open(ruta, "wb") as f:
            for b in r.iter_content(1 << 20):
                f.write(b)
    print(f"  bajado {clave.rsplit('/', 1)[1]} ({os.path.getsize(ruta) // 1024} kB)", flush=True)
    return ruta


def malla(lat0, lon0, radio_km, paso_km=1.0):
    """Malla regular en Mercator (cuadrada en kilómetros) alrededor de (lat0, lon0). Devuelve LAT, LON y los límites [[sur, oeste], [norte, este]]."""
    n = max(20, int(round(2 * radio_km / paso_km)))
    mitad = radio_km / R_TIERRA / math.cos(math.radians(lat0))               # radianes de Mercator (x e y)
    y0 = math.log(math.tan(math.pi / 4 + math.radians(lat0) / 2))
    ys = np.linspace(y0 + mitad, y0 - mitad, n)                                # de norte a sur
    xs = np.linspace(math.radians(lon0) - mitad, math.radians(lon0) + mitad, n)
    lat = np.degrees(2 * np.arctan(np.exp(ys)) - math.pi / 2)
    lon = np.degrees(xs)
    LON, LAT = np.meshgrid(lon, lat)
    lims = [[float(lat[-1]), float(lon[0])], [float(lat[0]), float(lon[-1])]]
    return LAT, LON, lims


def a_angulos(LAT, LON, h, req, rpol, lon_o):
    """Latitud/longitud → ángulos de escaneo x, y (rad) del ABI (GOES-R PUG, 4.2.8.2). Devuelve x, y y máscara de lo visible."""
    H = h + req
    phi, lam, lam0 = np.radians(LAT), np.radians(LON), math.radians(lon_o)
    e2 = (req ** 2 - rpol ** 2) / req ** 2
    phic = np.arctan((rpol ** 2 / req ** 2) * np.tan(phi))
    rc = rpol / np.sqrt(1 - e2 * np.cos(phic) ** 2)
    sx = H - rc * np.cos(phic) * np.cos(lam - lam0)
    sy = -rc * np.cos(phic) * np.sin(lam - lam0)
    sz = rc * np.sin(phic)
    vis = H * (H - sx) >= sy ** 2 + (req ** 2 / rpol ** 2) * sz ** 2
    return np.arcsin(-sy / np.sqrt(sx ** 2 + sy ** 2 + sz ** 2)), np.arctan(sz / sx), vis


def leer(ruta, LAT, LON):
    """Valores de CMI del archivo sobre la malla (vecino más cercano). NaN donde no hay dato."""
    from netCDF4 import Dataset
    with Dataset(ruta) as ds:
        pr = ds["goes_imager_projection"]
        x = np.ma.filled(ds["x"][:].astype("float64"), np.nan)
        y = np.ma.filled(ds["y"][:].astype("float64"), np.nan)
        xa, ya, vis = a_angulos(LAT, LON, float(pr.perspective_point_height), float(pr.semi_major_axis), float(pr.semi_minor_axis),
                                float(pr.longitude_of_projection_origin))
        i = np.rint((xa - x[0]) / (x[1] - x[0])).astype(int)
        j = np.rint((ya - y[0]) / (y[1] - y[0])).astype(int)
        ok = vis & (i >= 0) & (i < len(x)) & (j >= 0) & (j < len(y))
        out = np.full(LAT.shape, np.nan, dtype="float32")
        if not ok.any():
            return out, str(getattr(pr, "long_name", "")), ds.getncattr("platform_ID") if "platform_ID" in ds.ncattrs() else ""
        j0, j1, i0, i1 = j[ok].min(), j[ok].max() + 1, i[ok].min(), i[ok].max() + 1
        V = np.ma.filled(ds["CMI"][j0:j1, i0:i1].astype("float32"), np.nan)
        out[ok] = V[j[ok] - j0, i[ok] - i0]
        return out, "", ds.getncattr("platform_ID") if "platform_ID" in ds.ncattrs() else ""


def pintar_ir(T):
    k = np.array([p[0] for p in PALETA], dtype="float64")
    rgb = np.zeros(T.shape + (4,), dtype="uint8")
    Tn = np.nan_to_num(T, nan=313.0)
    for c in range(3):
        rgb[..., c] = np.interp(Tn, k, [p[1][c] for p in PALETA]).astype("uint8")
    rgb[..., 3] = np.where(np.isnan(T), 0, 230)
    return rgb


def pintar_color(R, G, B):
    g = 0.45 * R + 0.10 * G + 0.45 * B
    img = np.stack([R, g, B], axis=-1)
    valido = ~np.isnan(img).any(axis=-1)
    img = np.clip(np.nan_to_num(img, nan=0.0), 0, 1) ** (1 / 2.2)
    rgba = np.zeros(img.shape[:2] + (4,), dtype="uint8")
    rgba[..., :3] = (img * 255).astype("uint8")
    rgba[..., 3] = np.where(valido, 255, 0)
    return rgba, float(np.nanmean(np.stack([R, B])) if valido.any() else 0)


def png(rgba):
    from PIL import Image
    b = io.BytesIO()
    Image.fromarray(rgba, "RGBA").save(b, "PNG", optimize=True)
    return b.getvalue()


def generar(p, carpeta):
    t = datetime.fromisoformat(p["t"].replace("Z", "")).replace(tzinfo=UTC)
    if t < INICIO_ABI:
        raise RuntimeError("GOES-R (ABI) no existe antes de 2017: no hay imagen para esa fecha")
    if t > datetime.now(UTC) - timedelta(minutes=30):
        raise RuntimeError("esa hora es muy reciente o futura; usa la imagen de NASA GIBS")
    prod = p.get("prod", "ir")
    LAT, LON, lims = malla(float(p["lat"]), float(p["lon"]), float(p.get("radio_km") or 250))
    bandas = [13] if prod == "ir" else [2, 1, 3]
    ult = None
    for balde in balde_orden(t):
        try:
            claves = listar(balde, "ABI-L2-CMIPF", t)
        except Exception as e:
            ult = e
            continue
        k0 = elegir(claves, bandas[0], t)
        if not k0:
            continue
        s0 = re.search(r"_s\d{14}_", k0).group()
        ks = [k0] + [next((k for k in claves if re.search(rf"-M\dC{b:02d}_G\d\d{s0}", k)), None) for b in bandas[1:]]
        if None in ks:
            continue
        print(f"{balde}: escaneo {inicio_escaneo(k0):%Y-%m-%d %H:%M}Z", flush=True)
        V = [leer(bajar(balde, k, carpeta), LAT, LON) for k in ks]
        sat = "GOES-" + balde[-2:]
        if prod == "ir":
            img = pintar_ir(V[0][0])
            extra = {"leyenda": "temperatura de brillo: gris = cálido/bajo · celeste < −20 °C · verde < −30 · amarillo < −40 · naranjo < −50 · rojo < −60 · magenta < −70 °C"}
        else:
            img, brillo = pintar_color(V[0][0], V[1][0], V[2][0])
            extra = {"noche": brillo < 0.02, "leyenda": "color real sintético (azul, rojo e infrarrojo cercano; de noche sale oscuro)"}
        if np.isnan(V[0][0]).all():
            raise RuntimeError("la estación queda fuera del disco visible del satélite")
        return {"estado": "listo", "sat": sat, "escaneo": inicio_escaneo(k0).strftime("%Y-%m-%d %H:%M") + "Z", "limites": lims, "prod": prod, **extra}, png(img)
    raise RuntimeError(f"no hay archivo GOES cerca de {t:%Y-%m-%d %H:%M}Z" + (f" ({ult})" if ult else ""))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--pedido", required=True)
    ap.add_argument("--salida", help="si se indica, guarda PNG y JSON en esta carpeta en vez de subir al KV (pruebas)")
    a = ap.parse_args()
    p = json.loads(a.pedido)
    ident = p["id"]
    if not a.salida:
        print("kv:", kv_put(f"qc/goes/{ident}", json.dumps({**p, "estado": "procesando"})))
    try:
        with tempfile.TemporaryDirectory() as carpeta:
            meta, img = generar(p, carpeta)
    except Exception as e:
        print("error:", e)
        if not a.salida:
            kv_put(f"qc/goes/{ident}", json.dumps({**p, "estado": "error", "error": str(e)[:300]}, ensure_ascii=False))
        raise SystemExit(1)
    meta = {**p, **meta, "generado": datetime.now(UTC).isoformat(timespec="seconds")}
    if a.salida:
        os.makedirs(a.salida, exist_ok=True)
        open(os.path.join(a.salida, ident + ".png"), "wb").write(img)
        open(os.path.join(a.salida, ident + ".json"), "w").write(json.dumps(meta, ensure_ascii=False))
        print("guardado", ident, len(img) // 1024, "kB")
        return
    print("img:", kv_put(f"qc/goesimg/{ident}", img, "image/png"), len(img) // 1024, "kB")
    print("meta:", kv_put(f"qc/goes/{ident}", json.dumps(meta, ensure_ascii=False)))


if __name__ == "__main__":
    main()
