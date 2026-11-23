"""IMERG histórico en el punto de cada estación (para validar SICCAP-DMC con casos pasados).

Usa las mismas funciones de qc/imerg.py (NASA GIBS, capa IMERG_Precipitation_Rate_30min) y guarda en datos/imerg/AAAA/MM/DD.json,
igual que la corrida normal, de modo que qc/imerg.py:tabla() los lee sin cambios.
Uso:  python qc/imerg_historico.py <carpeta_datos> <desde AAAA-MM-DD> <hasta AAAA-MM-DD> [paso_horas=1] [presupuesto_min=300]
Con paso_horas=1 se baja un paso (:00) por hora, suficiente para decidir si llovió (sí/no) y estimar el acumulado diario.
Retoma donde quedó: no vuelve a bajar los pasos ya guardados.
"""
import json
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import pandas as pd
import requests

sys.path.insert(0, str(Path(__file__).parent))
import imerg as IM

# estaciones sin coordenadas en estaciones.json (dadas por el autor)
EXTRA = {"420014": (-(42 + 20 / 60 + 25 / 3600), -(73 + 42 / 60 + 57 / 3600))}   # Mocopulli (Dalcahue)


def main():
    raiz = Path(sys.argv[1])
    desde, hasta = pd.Timestamp(sys.argv[2]), pd.Timestamp(sys.argv[3]) + pd.Timedelta(hours=23)
    paso = int(sys.argv[4]) if len(sys.argv) > 4 else 1
    presupuesto = float(sys.argv[5]) * 60 if len(sys.argv) > 5 else 300 * 60
    E = pd.DataFrame(json.load(open(raiz / "estaciones.json", encoding="utf-8")))
    E["codigo"] = E["codigo"].astype(str)
    E = E.dropna(subset=["lat", "lon"])
    for c, (la, lo) in EXTRA.items():
        if c not in set(E["codigo"]):
            E = pd.concat([E, pd.DataFrame([dict(codigo=c, lat=la, lon=lo)])], ignore_index=True)
    tengo = set(IM.pasos_guardados(raiz, desde, hasta))
    pasos = [t for t in pd.date_range(desde, hasta, freq=f"{paso}h") if t not in tengo]
    print(f"{len(pasos)} pasos por bajar entre {desde} y {hasta} ({len(tengo)} ya guardados)", flush=True)
    s = requests.Session()
    cm = s.get(IM.CMAP_URL, timeout=60)
    cm.raise_for_status()
    cmap = IM.leer_colormap(cm.text)
    t0, n, sin = time.time(), 0, 0

    def uno(t):
        if time.time() - t0 > presupuesto:
            return None
        try:
            return t, IM.muestrear_paso(s, E, t, cmap)
        except Exception as e:
            print("error", t, str(e)[:80], flush=True)
            return t, None

    with ThreadPoolExecutor(3) as ex:
        for r in ex.map(uno, pasos):
            if r is None:
                continue
            t, v = r
            if v is None:
                sin += 1
                continue
            IM.guardar_paso(raiz, t, v)
            n += 1
            if n % 200 == 0:
                print(f"{n} pasos guardados ({(time.time() - t0) / 60:.0f} min)", flush=True)
    print(f"listo: {n} pasos guardados, {sin} sin imagen completa, {(time.time() - t0) / 60:.0f} min")


if __name__ == "__main__":
    main()
