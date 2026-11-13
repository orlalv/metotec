"""Descarga/actualiza las series horarias de SACLIM (getDatosSaclim) y las revisa (ver series_h.py).
  --modo piloto  años faltantes de --cods (por omisión, unas pocas estaciones)
  --modo actual  año en curso y anterior (semanal)
  --modo todo    vuelve a bajar todo lo guardado (mensual: detecta correcciones)
  --modo revisar solo revisa lo guardado
  --modo completar completa huecos ≤ 10 h (completar.py) y los guarda en saclim/completado/"""
import argparse, json, sys
from datetime import date
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent))
import series_h as SH
from correr import ESTACIONES_OBS

PILOTO = ["180005", "330020", "330021", "340031", "410005", "520006"]


def guardadas(datos):
    d = Path(datos) / "saclim"
    return sorted(p.name for p in d.iterdir() if p.is_dir() and p.name.isdigit()) if d.exists() else []


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--datos", default="datos")
    ap.add_argument("--modo", default="piloto", choices=["piloto", "actual", "todo", "revisar", "completar"])
    ap.add_argument("--cods", default="")
    ap.add_argument("--desde", type=int, default=1995)
    ap.add_argument("--hasta", type=int, default=date.today().year)
    a = ap.parse_args()
    hoy = date.today().year
    cods = [c for c in a.cods.split(",") if c] or (PILOTO if a.modo == "piloto" else guardadas(a.datos) or PILOTO)
    if a.cods == "obs":
        cods = list(ESTACIONES_OBS)
    if a.modo == "piloto":
        print(SH.actualizar(a.datos, cods, a.desde, a.hasta, solo_faltantes=True))
    elif a.modo == "actual":
        print(SH.actualizar(a.datos, cods, hoy - 1, hoy))
    elif a.modo == "todo":
        print(SH.actualizar(a.datos, cods, a.desde, hoy))
    if a.modo == "completar":
        import completar as CP
        CP.completar_todo(a.datos, cods if a.cods else guardadas(a.datos))
        return
    E = {e["codigo"]: e for e in json.loads((Path(a.datos) / "estaciones.json").read_text())}
    todas = sorted(set(cods) | set(guardadas(a.datos)))
    for r in SH.revisar_todo(a.datos, todas, E):
        print(r["codigo"], r["nombre"], r["desde"], r["hasta"], "dudosos", r["dudosos"], "revisar", r["revisar"], r["reglas"])


if __name__ == "__main__":
    main()
