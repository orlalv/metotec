"""GOES-East (NOAA, AWS) en el punto de cada estación, para validar SICCAP-DMC con fechas pasadas.
Baja ABI-L2-CMIPF banda 13 (temperatura de brillo, K) del paso más cercano a cada hora pedida y guarda solo el valor sobre cada estación:
  datos/goes_pt/AAAA/MM/DD.json  →  {"pasos": {"HH:MM": {"código": K, …}}}
Usa las funciones de qc/goes_hist.py (listado en S3, elección del archivo, geometría del satélite).
Uso:  python qc/goes_puntos.py <carpeta_datos> <desde AAAA-MM-DD> <hasta AAAA-MM-DD> [paso_horas=3] [presupuesto_min=300] [códigos separados por coma]
Retoma donde quedó: no vuelve a bajar los pasos ya guardados."""
import json, os, sys, tempfile, time
from datetime import datetime, timedelta, timezone
from pathlib import Path
import numpy as np
sys.path.insert(0, str(Path(__file__).parent))
import goes_hist as G

UTC = timezone.utc
EXTRA = {"420014": (-(42 + 20 / 60 + 25 / 3600), -(73 + 42 / 60 + 57 / 3600))}   # Mocopulli (Dalcahue)


def archivo(raiz, t):
    return Path(raiz) / "goes_pt" / f"{t:%Y}" / f"{t:%m}" / f"{t:%d}.json"


def main():
    raiz = Path(sys.argv[1])
    desde = datetime.strptime(sys.argv[2], "%Y-%m-%d").replace(tzinfo=UTC)
    hasta = datetime.strptime(sys.argv[3], "%Y-%m-%d").replace(tzinfo=UTC) + timedelta(hours=23)
    paso = int(sys.argv[4]) if len(sys.argv) > 4 else 3
    presupuesto = float(sys.argv[5]) * 60 if len(sys.argv) > 5 else 300 * 60
    cods = [c for c in (sys.argv[6].split(",") if len(sys.argv) > 6 else []) if c]
    est = json.load(open(raiz / "estaciones.json", encoding="utf-8"))
    pos = {str(e["codigo"]): (float(e["lat"]), float(e["lon"])) for e in est if e.get("lat") is not None and e.get("lon") is not None}
    for c, p in EXTRA.items():
        pos.setdefault(c, p)
    if cods:
        pos = {c: p for c, p in pos.items() if c in cods}
    ids = sorted(pos)
    LAT = np.array([pos[c][0] for c in ids]); LON = np.array([pos[c][1] for c in ids])
    t0, n, falla = time.time(), 0, 0
    t = desde
    while t <= hasta and time.time() - t0 < presupuesto:
        f = archivo(raiz, t)
        d = json.load(open(f))["pasos"] if f.exists() else {}
        clave = f"{t:%H:%M}"
        if clave not in d:
            try:
                ok = None
                for balde in G.balde_orden(t):
                    k = G.elegir(G.listar(balde, "ABI-L2-CMIPF", t), 13, t)
                    if k:
                        ok = (balde, k); break
                if not ok:
                    print("sin archivo", t, flush=True); falla += 1
                else:
                    with tempfile.TemporaryDirectory() as tmp:
                        ruta = G.bajar(ok[0], ok[1], tmp)
                        V, _, plat = G.leer(ruta, LAT, LON)
                    d[clave] = {c: round(float(v), 1) for c, v in zip(ids, V) if np.isfinite(v)}
                    f.parent.mkdir(parents=True, exist_ok=True)
                    f.write_text(json.dumps({"pasos": d}, separators=(",", ":")))
                    n += 1
                    if n % 20 == 0:
                        print(f"{n} pasos guardados ({(time.time() - t0) / 60:.0f} min)", flush=True)
            except Exception as e:
                print("error", t, str(e)[:120], flush=True); falla += 1
        t += timedelta(hours=paso)
    print(f"listo: {n} pasos guardados, {falla} fallas, {(time.time() - t0) / 60:.0f} min")


if __name__ == "__main__":
    main()
