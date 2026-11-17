"""Contorno de la Región Metropolitana y de sus comunas (BCN, mapas vectoriales) simplificado para el mapa de evento.
Baja Regiones.zip y comunas_final.zip del sitio de la Biblioteca del Congreso Nacional (referencial, citar la fuente) y guarda
datos/mapas/rm.json  →  {"fuente", "region": GeoJSON, "comunas": GeoJSON}   (coordenadas WGS84, ~200 m de simplificación)."""
import io, json, sys, zipfile
from pathlib import Path
import requests
import shapefile                      # pyshp
from shapely.geometry import shape, mapping
from shapely.ops import transform
from pyproj import CRS, Transformer

URL = "https://www.bcn.cl/obtienearchivo?id=repositorio/10221/"
CAPAS = {"regiones": "10398/2/Regiones.zip", "comunas": "10396/5/comunas_final.zip"}


def leer(clave):
    r = requests.get(URL + CAPAS[clave], timeout=300, headers={"User-Agent": "Mozilla/5.0 metotec"})
    r.raise_for_status()
    z = zipfile.ZipFile(io.BytesIO(r.content))
    base = {n.rsplit(".", 1)[0]: n.rsplit(".", 1)[0] for n in z.namelist() if n.lower().endswith(".shp")}
    nom = sorted(base)[0]
    arch = {e: io.BytesIO(z.read(n)) for n in z.namelist() for e in ("shp", "shx", "dbf", "prj") if n.lower().endswith("." + e) and n.rsplit(".", 1)[0] == nom}
    sf = shapefile.Reader(shp=arch["shp"], shx=arch["shx"], dbf=arch["dbf"], encoding="latin-1")
    proy = None
    if "prj" in arch:
        try:
            crs = CRS.from_wkt(arch["prj"].getvalue().decode("latin-1"))
            if not crs.is_geographic:
                proy = Transformer.from_crs(crs, 4326, always_xy=True).transform
        except Exception as e:
            print("prj:", e)
    campos = [f[0] for f in sf.fields[1:]]
    print(clave, "campos:", campos, "n:", len(sf), "proyectado:", bool(proy))
    out = []
    for sr in sf.shapeRecords():
        g = shape(sr.shape.__geo_interface__)
        if proy:
            g = transform(proy, g)
        out.append((dict(zip(campos, sr.record)), g))
    return out


def main(raiz):
    R = leer("regiones")
    rm = [(a, g) for a, g in R if any("metropolitana" in str(v).lower() for v in a.values())]
    if not rm:
        print("no se encontró la RM; registros:", [a for a, _ in R][:20]); sys.exit(1)
    reg = rm[0][1]
    print("región:", {k: v for k, v in rm[0][0].items() if isinstance(v, str)})
    C = leer("comunas")
    com = [(a, g) for a, g in C if g.representative_point().within(reg.buffer(0.01))]
    def feats(L, tol, nombre):
        return {"type": "FeatureCollection", "features": [
            {"type": "Feature", "properties": {"nombre": nombre(a)}, "geometry": mapping(g.simplify(tol, preserve_topology=True))} for a, g in L]}
    nomc = lambda a: next((str(v) for k, v in a.items() if k.lower() in ("comuna", "nom_comuna", "nombre") and isinstance(v, str)), next((str(v) for v in a.values() if isinstance(v, str)), ""))
    R_ = feats([(rm[0][0], reg)], 0.003, lambda a: "Región Metropolitana de Santiago")
    C_ = feats(com, 0.002, nomc)
    d = Path(raiz) / "mapas"; d.mkdir(parents=True, exist_ok=True)
    (d / "rm.json").write_text(json.dumps({"fuente": "Biblioteca del Congreso Nacional de Chile (BCN), mapas vectoriales; referencial", "region": R_, "comunas": C_}, ensure_ascii=False, separators=(",", ":")))
    print("comunas:", len(com), "bytes:", (d / "rm.json").stat().st_size)


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "datos")
