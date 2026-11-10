"""Descarga/actualiza los anuarios de temperatura máxima y mínima y revisa las series (ver series.py).
  --modo piloto   estaciones con observador, --desde..--hasta (todo)
  --modo actual   solo el año en curso y el anterior (actualización semanal)
  --modo todo     vuelve a bajar todos los años guardados (mensual: detecta correcciones en años antiguos)"""
import argparse, json, sys
from datetime import date
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent))
import series as SR
from correr import ESTACIONES_OBS

PILOTO = sorted(set(ESTACIONES_OBS) | {"340045", "330020", "330031", "380013", "950002", "950003"})


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--datos", default="datos")
    ap.add_argument("--modo", default="piloto", choices=["piloto", "actual", "todo", "revisar"])
    ap.add_argument("--cods", default="")
    ap.add_argument("--desde", type=int, default=1990)
    ap.add_argument("--hasta", type=int, default=date.today().year)
    a = ap.parse_args()
    cods = [c for c in a.cods.split(",") if c] or PILOTO
    if a.modo == "revisar" and a.cods == "debug":
        import requests
        t = requests.get(SR.URL.format(p=SR.PAG["tx"], cod="180005", a=2025), headers=SR.UA, timeout=60).text
        i = t.lower().find("enero"); print(len(t), i); print(t[max(0, i - 3000):i + 3000]); return
    hoy = date.today().year
    if a.modo == "piloto":
        print(SR.actualizar(a.datos, cods, a.desde, a.hasta, solo_faltantes=True))
    elif a.modo == "actual":
        print(SR.actualizar(a.datos, cods, hoy - 1, hoy))
    elif a.modo == "todo":
        print(SR.actualizar(a.datos, cods, a.desde, hoy))
    E = {e["codigo"]: e for e in json.loads((Path(a.datos) / "estaciones.json").read_text())}
    R = SR.revisar_todo(a.datos, cods, E)
    for r in R[:15]:
        print(r["codigo"], r["nombre"], r["desde"], r["hasta"], "dudosos", r["dudosos"], "revisar", r["revisar"], r["reglas"])


if __name__ == "__main__":
    main()
