"""Diagnóstico de acceso a datos de la NASA y GOES desde GitHub Actions (solo lectura, no escribe nada).
Se ejecuta a mano con el flujo «Diagnóstico NASA» y deja el resultado en el registro del flujo. Sirve para saber qué se puede
leer antes de escribir el módulo de IMERG: GIBS (imágenes sin clave), GES DISC (datos con clave Earthdata) y GOES en AWS."""
import io, os, re, sys
import requests

def paso(t):
    print(f"\n=== {t} ===", flush=True)

def get(u, **k):
    k.setdefault("timeout", 60)
    try:
        r = requests.get(u, **k)
        print(f"{r.status_code} {len(r.content)} bytes  {u[:150]}")
        return r
    except Exception as e:
        print(f"ERROR {type(e).__name__}: {str(e)[:150]}  {u[:120]}")

paso("GOES-19 en AWS (listado de archivos)")
for prod in ("ABI-L2-RRQPEF", "ABI-L2-CMIPF", "GLM-L2-LCFA"):
    r = get(f"https://noaa-goes19.s3.amazonaws.com/?list-type=2&prefix={prod}/2026/322/12/&max-keys=2")
    if r is not None and r.ok:
        print("   ", re.findall(r"<Key>([^<]+)</Key>", r.text)[:2], re.findall(r"<Size>(\d+)</Size>", r.text)[:2])

paso("NASA GIBS: capacidades WMTS")
r = get("https://gibs.earthdata.nasa.gov/wmts/epsg4326/best/wmts.cgi?SERVICE=WMTS&REQUEST=GetCapabilities", timeout=120)
if r is not None and r.ok:
    x = r.text
    caps = re.findall(r"<Layer>.*?</Layer>", x, flags=re.S)
    capas = [c for c in caps if re.search(r"<ows:Identifier>IMERG[^<]*</ows:Identifier>", c)]
    print("capas IMERG:", [re.search(r"<ows:Identifier>([^<]+)", c).group(1) for c in capas])
    for c in capas[:3]:
        ident = re.search(r"<ows:Identifier>([^<]+)", c).group(1)
        if "Precipitation" not in ident:
            continue
        print("\n---", ident)
        print("formato:", re.findall(r"<Format>([^<]+)</Format>", c)[:2], "| TileMatrixSet:", re.findall(r"<TileMatrixSet>([^<]+)</TileMatrixSet>", c)[:3])
        print("plantilla:", re.findall(r'<ResourceURL[^>]*template="([^"]+)"', c)[:1])
        dim = re.search(r"<Dimension>.*?</Dimension>", c, flags=re.S)
        if dim:
            print("tiempo por defecto:", re.findall(r"<Default>([^<]+)</Default>", dim.group(0)), "| valores (cola):", re.findall(r"<Value>([^<]+)</Value>", dim.group(0))[-3:])
        print("metadatos:", re.findall(r'xlink:href="([^"]+)"', c)[:4])
    tms = re.findall(r"<TileMatrixSet>\s*<ows:Identifier>(2km|1km|500m)</ows:Identifier>.*?</TileMatrixSet>", x, flags=re.S)
    print("matrices disponibles:", set(tms))

paso("NASA GIBS: mapa de colores de IMERG")
for u in ("https://gibs.earthdata.nasa.gov/colormaps/v1.3/IMERG_Precipitation_Rate.xml", "https://gibs.earthdata.nasa.gov/colormaps/v1.3/IMERG_Precipitation_Rate.json"):
    r = get(u)
    if r is not None and r.ok:
        print(r.text[:600].replace("\n", " "))
        break

paso("NASA GES DISC (IMERG original): sin clave y con clave")
get("https://gpm1.gesdisc.eosdis.nasa.gov/data/GPM_L3/GPM_3IMERGHHE.07/2026/322/", allow_redirects=False)
tok = os.environ.get("EARTHDATA_TOKEN")
print("EARTHDATA_TOKEN en secretos:", "sí" if tok else "no")
if tok:
    r = get("https://gpm1.gesdisc.eosdis.nasa.gov/data/GPM_L3/GPM_3IMERGHHE.07/2026/322/", headers={"Authorization": f"Bearer {tok}"})
    if r is not None and r.ok:
        print("   ", re.findall(r'href="(3B-HHR-E[^"]+\.HDF5)"', r.text)[:2])
paso("fin")
